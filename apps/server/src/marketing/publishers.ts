/**
 * 发布适配器。各平台能做到的程度不同，这里如实区分：
 * - 微信公众号：调用官方接口（stable_token → 上传图片 → draft/add → 可选 freepublish/submit）。
 *   ⚠ 未用真实公众号联调；接口权限以公众号后台为准，需要在后台配置服务器 IP 白名单。
 * - 小红书：默认“辅助发布”（复制文案、下载图片、打开小红书）；系统设置填了发布接口后改为调用该接口。
 *   接口协议见 apps/server/README.md「小红书发布接口约定」，由你方中转服务或开放平台网关实现。
 * - 朋友圈：个人微信没有发布接口，只做辅助发布。
 * - 门店海报：前端生成 PNG，服务端只记录下载。
 */
import type { Article, AssistPackage, Platform, Post, StoreProfile } from "@hwpc/contracts";

export class PublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishError";
  }
}

export interface PublishOutcome {
  method: "api" | "assist" | "download";
  state: "draft_created" | "published" | "pending_manual" | "failed";
  message: string;
  url?: string;
  externalId?: string;
  assist?: AssistPackage;
}

export interface ImageSource {
  imageId: string;
  caption: string;
  read(): Promise<{ bytes: Uint8Array; mimeType: string }>;
  /** 本服务内的图片地址（给前端下载用）。 */
  url: string;
}

/* ------------------------------ 文本整理 ------------------------------ */

const paragraphs = (a: Article) => a.blocks.flatMap((b) => (b.type === "paragraph" ? [b.heading ? `${b.heading}\n${b.text}` : b.text] : []));
const imagesOf = (a: Article) => a.blocks.flatMap((b) => (b.type === "image" ? [b] : []));

/** 打开平台的链接。App 深链在不同系统 / 版本上可能失效，前端会同时给出网页入口。 */
const OPEN_URLS: Record<Platform, AssistPackage["openUrls"]> = {
  xiaohongshu: { app: "xhsdiscover://", web: "https://creator.xiaohongshu.com/publish/publish" },
  store_moments: { app: "weixin://" },
  wechat_article: { web: "https://mp.weixin.qq.com/" },
  store_poster: {},
};

export function assistPackage(platform: Platform, article: Article, images: ImageSource[]): AssistPackage {
  const body = paragraphs(article);
  const lines: string[] = [];
  if (platform === "store_moments") {
    lines.push([article.title, ...body].join("\n"), article.callToAction);
  } else {
    if (article.lead) lines.push(article.lead);
    lines.push(...body, article.callToAction);
    if (article.tags.length) lines.push(article.tags.map((t) => `#${t}`).join(" "));
  }
  const used = new Set(imagesOf(article).map((b) => b.imageId));
  return {
    platform,
    title: platform === "xiaohongshu" ? [...article.title].slice(0, 20).join("") : article.title,
    text: lines.filter(Boolean).join("\n\n"),
    tags: article.tags,
    images: images.filter((i) => used.has(i.imageId)).map((i) => ({ imageId: i.imageId, url: i.url, caption: i.caption })),
    openUrls: OPEN_URLS[platform],
  };
}

/* ------------------------------ 微信公众号 ------------------------------ */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

interface WxResult {
  errcode?: number;
  errmsg?: string;
  [k: string]: unknown;
}

export class WechatMpClient {
  constructor(
    private base: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(path: string, init: RequestInit): Promise<WxResult> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, { ...init, signal: AbortSignal.timeout(20000) });
    } catch (e) {
      throw new PublishError(`无法连接微信接口：${e instanceof Error ? e.message : e}`);
    }
    const data = (await res.json().catch(() => ({}))) as WxResult;
    if (!res.ok || (data.errcode !== undefined && data.errcode !== 0)) {
      throw new PublishError(`微信接口返回错误 ${data.errcode ?? res.status}：${data.errmsg ?? "未知错误"}`);
    }
    return data;
  }

  async token(appId: string, appSecret: string): Promise<string> {
    const r = await this.call("/cgi-bin/stable_token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "client_credential", appid: appId, secret: appSecret, force_refresh: false }),
    });
    if (typeof r.access_token !== "string") throw new PublishError("微信接口没有返回 access_token");
    return r.access_token;
  }

  private form(bytes: Uint8Array, mimeType: string): FormData {
    const ext = mimeType.includes("png") ? "png" : "jpg";
    const fd = new FormData();
    fd.append("media", new Blob([bytes], { type: mimeType }), `image.${ext}`);
    return fd;
  }

  /** 正文内图片：返回微信域名下的图片地址。 */
  async uploadContentImage(token: string, bytes: Uint8Array, mimeType: string): Promise<string> {
    const r = await this.call(`/cgi-bin/media/uploadimg?access_token=${encodeURIComponent(token)}`, { method: "POST", body: this.form(bytes, mimeType) });
    if (typeof r.url !== "string") throw new PublishError("上传正文图片失败：没有返回 url");
    return r.url;
  }

  /** 封面图：永久素材，返回 media_id。 */
  async uploadThumb(token: string, bytes: Uint8Array, mimeType: string): Promise<string> {
    const r = await this.call(`/cgi-bin/material/add_material?access_token=${encodeURIComponent(token)}&type=image`, { method: "POST", body: this.form(bytes, mimeType) });
    if (typeof r.media_id !== "string") throw new PublishError("上传封面失败：没有返回 media_id");
    return r.media_id;
  }

  async addDraft(token: string, article: { title: string; author: string; digest: string; content: string; thumbMediaId: string }): Promise<string> {
    const r = await this.call(`/cgi-bin/draft/add?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ articles: [{ title: article.title, author: article.author, digest: article.digest, content: article.content, thumb_media_id: article.thumbMediaId, need_open_comment: 0, only_fans_can_comment: 0 }] }),
    });
    if (typeof r.media_id !== "string") throw new PublishError("新建草稿失败：没有返回 media_id");
    return r.media_id;
  }

  async submit(token: string, mediaId: string): Promise<string> {
    const r = await this.call(`/cgi-bin/freepublish/submit?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ media_id: mediaId }),
    });
    return String(r.publish_id ?? "");
  }
}

/** 公众号正文 HTML：只用最基本的标签，样式内联（公众号会过滤外部样式）。 */
export function wechatHtml(article: Article, imageUrls: Map<string, string>): string {
  const out: string[] = [];
  if (article.lead) out.push(`<p style="color:#555;">${esc(article.lead)}</p>`);
  for (const b of article.blocks) {
    if (b.type === "paragraph") {
      if (b.heading) out.push(`<h3 style="font-size:17px;margin:24px 0 8px;">${esc(b.heading)}</h3>`);
      out.push(`<p style="line-height:1.8;">${esc(b.text)}</p>`);
    } else {
      const url = imageUrls.get(b.imageId);
      if (url) out.push(`<p style="text-align:center;"><img src="${esc(url)}" /></p><p style="text-align:center;color:#888;font-size:13px;">${esc(b.caption)}</p>`);
    }
  }
  out.push(`<p style="line-height:1.8;margin-top:24px;">${esc(article.callToAction).replace(/\n/g, "<br/>")}</p>`);
  return out.join("\n");
}

export async function publishWechat(input: {
  client: WechatMpClient;
  appId: string;
  appSecret: string;
  mode: "draft" | "publish";
  author: string;
  article: Article;
  images: ImageSource[];
}): Promise<PublishOutcome> {
  const { client, article } = input;
  const token = await client.token(input.appId, input.appSecret);
  const used = imagesOf(article);
  if (!used.length) throw new PublishError("公众号文章需要至少一张图作为封面，当前稿件没有图片");
  const byId = new Map(input.images.map((i) => [i.imageId, i]));
  const urls = new Map<string, string>();
  let thumb: string | undefined;
  for (const b of used) {
    const src = byId.get(b.imageId);
    if (!src) continue;
    const { bytes, mimeType } = await src.read();
    urls.set(b.imageId, await client.uploadContentImage(token, bytes, mimeType));
    thumb ??= await client.uploadThumb(token, bytes, mimeType);
  }
  if (!thumb) throw new PublishError("封面图片读取失败");
  const digest = (article.lead ?? paragraphs(article)[0] ?? "").slice(0, 110);
  const mediaId = await client.addDraft(token, { title: [...article.title].slice(0, 60).join(""), author: input.author.slice(0, 16), digest, content: wechatHtml(article, urls), thumbMediaId: thumb });
  if (input.mode === "draft") {
    return { method: "api", state: "draft_created", externalId: mediaId, message: "已存入公众号草稿箱，请在公众号后台预览并群发 / 发布" };
  }
  const publishId = await client.submit(token, mediaId);
  return { method: "api", state: "published", externalId: publishId || mediaId, message: "已提交公众号发布，审核结果以公众号后台为准" };
}

/* ------------------------------ 小红书（接口模式） ------------------------------ */

/** 调用你方配置的小红书发布接口。协议：POST JSON，返回 { ok, id?, url?, message? }。 */
export async function publishXiaohongshuApi(input: {
  publishUrl: string;
  systemKey?: string;
  accountId: string;
  accessToken?: string;
  store: StoreProfile;
  post: Post;
  pkg: AssistPackage;
  images: ImageSource[];
  fetchImpl?: typeof fetch;
}): Promise<PublishOutcome> {
  const images = await Promise.all(
    input.pkg.images.map(async (i) => {
      const src = input.images.find((x) => x.imageId === i.imageId);
      if (!src) throw new PublishError(`图片 ${i.imageId} 不可用`);
      const { bytes, mimeType } = await src.read();
      return { imageId: i.imageId, mimeType, caption: i.caption, base64: Buffer.from(bytes).toString("base64") };
    }),
  );
  let res: Response;
  try {
    res = await (input.fetchImpl ?? fetch)(input.publishUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.systemKey ? { authorization: `Bearer ${input.systemKey}` } : {}),
        ...(input.accessToken ? { "x-store-token": input.accessToken } : {}),
      },
      body: JSON.stringify({ storeId: input.store.storeId, accountId: input.accountId, postId: input.post.postId, title: input.pkg.title, content: input.pkg.text, tags: input.pkg.tags, images }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    throw new PublishError(`无法连接小红书发布接口：${e instanceof Error ? e.message : e}`);
  }
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; url?: string; message?: string };
  if (!res.ok || data.ok === false) throw new PublishError(`小红书发布接口返回失败（HTTP ${res.status}）：${data.message ?? "未知原因"}`);
  return { method: "api", state: data.url ? "published" : "draft_created", message: data.message ?? "已提交到小红书发布接口", ...(data.url ? { url: data.url } : {}), ...(data.id ? { externalId: data.id } : {}) };
}
