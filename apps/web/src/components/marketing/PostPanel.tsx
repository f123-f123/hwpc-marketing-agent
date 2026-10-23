import { useState } from "react";
import { PLATFORM_NAME, platformStylePool, visualById, voiceById, type AssistPackage, type Campaign, type ChannelBindingView, type Platform, type Post, type StyleChoice } from "@hwpc/contracts";
import { marketingApi } from "../../api/marketing";
import { downloadBlob } from "../../lib/share";
import { useAction } from "../../lib/useLoad";
import type { Auth } from "../../state/useAuth";
import { Alert, Badge, EmptyState, Icon } from "../ui";
import { ArticleEditor } from "./ArticleEditor";
import { AssistSheet } from "./AssistSheet";
import { DELIVERY_LABEL, DELIVERY_TONE, PUBLISH_STATE } from "./labels";
import { Preview, renderPosterPng } from "./Previews";
import { VerifyReport } from "./VerifyReport";

/** 发布按钮文案：如实告诉导购这一下会发生什么。 */
function publishLabel(platform: Platform, channels: ChannelBindingView[]): string {
  const wx = channels.find((c) => c.channel === "wechat_mp");
  const xhs = channels.find((c) => c.channel === "xiaohongshu");
  switch (platform) {
    case "wechat_article":
      return wx?.bound ? (wx.settings.publishMode === "publish" ? "发布到公众号" : "存入公众号草稿箱") : "复制图文（公众号未绑定）";
    case "xiaohongshu":
      return xhs?.bound && xhs.settings.mode === "api" ? "发布到小红书" : "一键复制，去小红书发布";
    case "store_moments":
      return "一键复制，去发朋友圈";
    case "store_poster":
      return "下载海报 PNG";
  }
}

export function PostPanel({ auth, campaign, platform, initial, channels, storeName, onChanged }: {
  auth: Auth;
  campaign: Campaign;
  platform: Platform;
  initial: Post | undefined;
  channels: ChannelBindingView[];
  storeName: string;
  /** 稿件有变化时回传，父组件据此更新任务进度并缓存最新稿件。 */
  onChanged: (post: Post) => void;
}) {
  const [post, setPost] = useState<Post | undefined>(initial);
  const [editing, setEditing] = useState(false);
  const [assist, setAssist] = useState<{ pkg: AssistPackage; message: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [style, setStyle] = useState<StyleChoice>({});
  const pool = platformStylePool(platform);
  /** 视觉风格只影响海报和小红书封面，其他平台不显示视觉选项。 */
  const visualMatters = platform === "store_poster" || platform === "xiaohongshu";
  const action = useAction(auth.handleError);
  const img = (imageId: string) => (post ? marketingApi.imageUrl(post.postId, imageId) : "");

  const update = (p: Post | undefined) => {
    if (!p) return;
    setPost(p);
    onChanged(p);
  };

  if (!post || post.variants.length === 0) {
    return (
      <div className="post-empty">
        <EmptyState
          title={`为${PLATFORM_NAME[platform]}写 3 个版本`}
          action={
            <button type="button" className="btn btn-primary btn-lg" disabled={action.busy} onClick={() => void action.run(async () => update(await marketingApi.openPost(campaign.campaignId, platform)))}>
              {action.busy ? "正在写作并核验…（约半分钟）" : "生成 3 个版本"}
            </button>
          }
        >
          每个版本从不同角度切入；参数由程序按知识库原文填入，写完自动核验。你只需要挑一个。
        </EmptyState>
        {action.error && <Alert tone="danger">{action.error}</Alert>}
      </div>
    );
  }

  const selected = post.variants.find((v) => v.variantId === post.selectedVariantId);
  const selectedVisual = visualById(selected?.style?.visual);
  const current = post.edited ?? (selected ? { article: selected.article, report: selected.report } : undefined);
  const lastPublish = post.publishes.at(-1);

  const publish = () =>
    action.run(async () => {
      if (!current) return;
      if (platform === "store_poster") {
        downloadBlob(await renderPosterPng(current.article, img, selectedVisual), `${campaign.title}-${storeName}-海报.png`);
      }
      const r = await marketingApi.publish(post.postId);
      update(r.post);
      if (r.record.state === "failed") setNotice(r.record.message);
      else if (platform !== "store_poster" && r.assist && r.record.method !== "api") setAssist({ pkg: r.assist, message: r.record.message });
      else setNotice(r.record.message);
    });

  return (
    <div className="post">
      {post.isMock && <Alert tone="warning">本稿使用了模拟资料（MOCK），不能作为真实产品宣传发布。</Alert>}
      {post.gaps.length > 0 && <p className="muted small">资料说明：{post.gaps.join("；")}</p>}

      <section aria-label="候选版本">
        <div className="post-bar">
          <h3 className="subhead-inline">挑一个版本</h3>
          <span className="row style-pick">
            <label className="style-select">
              <span>语言风格</span>
              <select className="input" value={style.voice ?? ""} onChange={(e) => setStyle((s) => ({ ...s, voice: e.target.value || undefined }))}>
                <option value="">自动搭配</option>
                {pool.voices.map((id) => <option key={id} value={id}>{voiceById(id)?.name}</option>)}
              </select>
            </label>
            {visualMatters && (
              <label className="style-select">
                <span>视觉风格</span>
                <select className="input" value={style.visual ?? ""} onChange={(e) => setStyle((s) => ({ ...s, visual: e.target.value || undefined }))}>
                  <option value="">自动搭配</option>
                  {pool.visuals.map((id) => <option key={id} value={id}>{visualById(id)?.name}</option>)}
                </select>
              </label>
            )}
            <button type="button" className="btn btn-sm" disabled={action.busy || post.status === "published"} onClick={() => void action.run(async () => update(await marketingApi.regenerate(post.postId, style)))}>
              {action.busy ? "生成中…" : style.voice || style.visual ? "按所选风格重写" : "换一批角度"}
            </button>
          </span>
        </div>
        <div className="variants">
          {post.variants.map((v) => {
            const on = v.variantId === post.selectedVariantId;
            return (
              <article key={v.variantId} className={`variant${on ? " is-selected" : ""}`}>
                <header className="variant-head">
                  <span className="variant-title">
                    <strong>{v.angle}</strong>
                    {v.style && (
                      <span className="variant-style">
                        {voiceById(v.style.voice)?.name}
                        {visualMatters && <> · {visualById(v.style.visual)?.name}</>}
                      </span>
                    )}
                  </span>
                  <span className="row">
                    <Badge tone={DELIVERY_TONE[v.report.deliveryStatus] ?? "neutral"}>{DELIVERY_LABEL[v.report.deliveryStatus]}</Badge>
                    {v.mode === "template" && <Badge tone="warning">模板稿</Badge>}
                    {v.similarity >= 0.55 && <Badge tone="warning">与他店相似 {Math.round(v.similarity * 100)}%</Badge>}
                  </span>
                </header>
                <div className="variant-preview">
                  <Preview platform={platform} article={v.article} img={img} storeName={storeName} visual={visualById(v.style?.visual)} />
                </div>
                <button
                  type="button"
                  className={on ? "btn btn-sm" : "btn btn-sm btn-primary"}
                  disabled={action.busy || on || v.report.deliveryStatus === "blocked"}
                  onClick={() => void action.run(async () => { setEditing(false); update(await marketingApi.select(post.postId, v.variantId)); })}
                >
                  {on ? <><Icon name="check" />已选这个</> : v.report.deliveryStatus === "blocked" ? "核验未通过，不能选" : "用这个版本"}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      {action.error && <Alert tone="danger">{action.error}</Alert>}
      {notice && <Alert tone={lastPublish?.state === "failed" ? "danger" : "success"} action={<button type="button" className="btn btn-sm btn-ghost" onClick={() => setNotice("")}>知道了</button>}>{notice}</Alert>}

      {current && (
        <section className="chosen" aria-labelledby={`chosen-${platform}`}>
          <div className="post-bar">
            <h3 id={`chosen-${platform}`} className="subhead-inline">选定稿{post.edited ? "（已修改）" : ""}</h3>
            <span className="row">
              {!editing && <button type="button" className="btn btn-sm" onClick={() => setEditing(true)} disabled={post.status === "published"}>修改文字</button>}
              <a className="btn btn-sm btn-ghost" href={marketingApi.exportUrl(post.postId)} download>导出四段式</a>
            </span>
          </div>
          <div className="chosen-grid">
            <div className="chosen-preview">
              {editing ? (
                <ArticleEditor
                  article={current.article}
                  busy={action.busy}
                  onCancel={() => setEditing(false)}
                  onSave={(a) => action.run(async () => { update(await marketingApi.edit(post.postId, a)); setEditing(false); })}
                />
              ) : (
                <Preview platform={platform} article={current.article} img={img} storeName={storeName} visual={selectedVisual} />
              )}
            </div>
            <div className="chosen-side">
              <VerifyReport report={current.report} />
              <div className="publish">
                <button type="button" className="btn btn-primary btn-lg" disabled={action.busy || editing || current.report.deliveryStatus === "blocked"} onClick={() => void publish()}>
                  {action.busy ? "处理中…" : publishLabel(platform, channels)}
                </button>
                {current.report.deliveryStatus === "blocked" && <p className="small" role="alert">核验未通过的稿件不能发布，请换一个版本或修改。</p>}
                {post.status !== "published" && lastPublish && lastPublish.state !== "published" && (
                  <button type="button" className="btn btn-sm btn-ghost" disabled={action.busy} onClick={() => void action.run(async () => update(await marketingApi.receipt(post.postId)))}>
                    已在平台发布？标记为已发布
                  </button>
                )}
              </div>
              {post.publishes.length > 0 && (
                <ul className="publish-log small">
                  {post.publishes.map((r) => (
                    <li key={r.recordId}>
                      <Badge tone={r.state === "published" ? "success" : r.state === "failed" ? "danger" : "neutral"}>{PUBLISH_STATE[r.state]}</Badge>{" "}
                      {new Date(r.at).toLocaleString()} · {r.message}
                      {r.url && <> · <a href={r.url} target="_blank" rel="noopener">查看</a></>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      {assist && (
        <AssistSheet
          pkg={assist.pkg}
          message={assist.message}
          busy={action.busy}
          visual={selectedVisual}
          onClose={() => setAssist(null)}
          onReceipt={(url) => action.run(async () => { update(await marketingApi.receipt(post.postId, url)); return true; })}
        />
      )}
    </div>
  );
}
