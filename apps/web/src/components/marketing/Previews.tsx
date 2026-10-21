import type { Article, Platform } from "@hwpc/contracts";
import { Icon } from "../ui";

type ImgUrl = (imageId: string) => string;
type Para = Extract<Article["blocks"][number], { type: "paragraph" }>;

const paras = (a: Article) => a.blocks.flatMap((b): Para[] => (b.type === "paragraph" ? [b] : []));
const imgs = (a: Article) => a.blocks.flatMap((b) => (b.type === "image" ? [b] : []));

/** 海报正文：每行一个卖点；限制条件来自段落注释。 */
function posterLines(a: Article): { points: string[]; notes: string[] } {
  const ps = paras(a);
  return {
    points: ps.flatMap((p) => p.text.split("\n")).map((l) => l.trim().replace(/^[·•]\s*/, "")).filter(Boolean),
    notes: ps.flatMap((p) => p.notes ?? []),
  };
}

/** 限制条件：小字，紧跟在它所属的段落后面。 */
function Notes({ notes }: { notes?: string[] }) {
  return notes?.length ? <p className="pv-note">{notes.join("；")}</p> : null;
}

function Cta({ text, className = "pv-cta" }: { text: string; className?: string }) {
  return <div className={className}>{text.split("\n").map((l, i) => <p key={i}>{l}</p>)}</div>;
}

/* ------------------------------ 微信公众号：文章页 ------------------------------ */

function Wechat({ a, img, storeName }: { a: Article; img: ImgUrl; storeName: string }) {
  let n = 0;
  return (
    <article className="pv pv-wechat">
      <h3 className="pv-wx-title">{a.title}</h3>
      <p className="pv-wx-meta"><span className="pv-wx-acct">{storeName}</span><span>刚刚</span></p>
      {a.lead && <blockquote className="pv-wx-lead">{a.lead}</blockquote>}
      {a.blocks.map((b, i) =>
        b.type === "paragraph" ? (
          <section key={i} className="pv-wx-sec">
            {b.heading && (
              <h4><span className="pv-wx-no">{String(++n).padStart(2, "0")}</span>{b.heading}</h4>
            )}
            <p>{b.text}</p>
            <Notes notes={b.notes} />
          </section>
        ) : (
          <figure key={i}>
            <img src={img(b.imageId)} alt={b.caption} loading="lazy" />
            <figcaption>{b.caption}</figcaption>
          </figure>
        ),
      )}
      <div className="pv-wx-cta">
        <strong>到店指南</strong>
        <Cta text={a.callToAction} className="" />
      </div>
    </article>
  );
}

/* ------------------------------ 小红书：笔记页 ------------------------------ */

export function CoverText({ text }: { text: string }) {
  return (
    <div className="pv-cover-text" aria-hidden="true">
      {text.split("\n").map((l, i) => <span key={i}>{l}</span>)}
    </div>
  );
}

function Xhs({ a, img, storeName }: { a: Article; img: ImgUrl; storeName: string }) {
  const pics = imgs(a);
  return (
    <article className="pv pv-xhs">
      {pics[0] && (
        <div className="pv-xhs-cover">
          <img src={img(pics[0].imageId)} alt={pics[0].caption} loading="lazy" />
          {a.coverText && <CoverText text={a.coverText} />}
          {pics.length > 1 && <span className="pv-xhs-count">1/{pics.length}</span>}
        </div>
      )}
      {pics.length > 1 && (
        <div className="pv-xhs-dots" aria-hidden="true">{pics.map((p, i) => <i key={p.imageId} className={i === 0 ? "is-on" : undefined} />)}</div>
      )}
      <div className="pv-xhs-body">
        <p className="pv-xhs-author">
          <span className="pv-xhs-avatar" aria-hidden="true">{storeName.slice(0, 1)}</span>
          <span>{storeName}</span>
          <span className="pv-xhs-follow">关注</span>
        </p>
        <h3 className="pv-xhs-title">{a.title}</h3>
        {paras(a).map((p, i) => (
          <div key={i} className="pv-xhs-p">
            {p.heading && <strong>{p.heading}</strong>}
            <p>{p.text}</p>
            <Notes notes={p.notes} />
          </div>
        ))}
        <Cta text={a.callToAction} />
        {a.tags.length > 0 && <p className="pv-xhs-tags">{a.tags.map((t) => `#${t}`).join(" ")}</p>}
        <p className="pv-xhs-time">刚刚</p>
      </div>
      <footer className="pv-xhs-bar" aria-hidden="true">
        <span className="pv-xhs-say">说点什么…</span>
        <span><Icon name="spark" size={14} />赞</span>
        <span><Icon name="plus" size={14} />收藏</span>
        <span><Icon name="message" size={14} />评论</span>
      </footer>
    </article>
  );
}

/* ------------------------------ 朋友圈 ------------------------------ */

function Moments({ a, img, storeName }: { a: Article; img: ImgUrl; storeName: string }) {
  const pics = imgs(a).slice(0, 9);
  return (
    <article className="pv pv-moments">
      <span className="pv-avatar" aria-hidden="true">{storeName.slice(0, 1)}</span>
      <div className="pv-moments-body">
        <p className="pv-moments-name">{storeName}</p>
        <p>{a.title}</p>
        {paras(a).map((p, i) => (
          <div key={i}>
            <p>{p.text}</p>
            <Notes notes={p.notes} />
          </div>
        ))}
        <Cta text={a.callToAction} className="pv-moments-cta" />
        {pics.length > 0 && (
          <div className={`pv-moments-grid n${pics.length === 1 ? 1 : pics.length === 4 ? 4 : 3}`}>
            {pics.map((p) => <img key={p.imageId} src={img(p.imageId)} alt={p.caption} loading="lazy" />)}
          </div>
        )}
        <p className="pv-moments-time"><span>刚刚</span><span className="pv-moments-more" aria-hidden="true">··</span></p>
      </div>
    </article>
  );
}

/* ------------------------------ 门店海报 ------------------------------ */

function Poster({ a, img }: { a: Article; img: ImgUrl }) {
  const pic = imgs(a)[0];
  const { points, notes } = posterLines(a);
  const [first, ...rest] = a.callToAction.split("\n");
  return (
    <article className="pv pv-poster">
      <div className="pv-poster-hero">
        {pic && <img src={img(pic.imageId)} alt={pic.caption} loading="lazy" />}
        <div className="pv-poster-head">
          <h3>{a.title}</h3>
          {a.lead && <p>{a.lead}</p>}
        </div>
      </div>
      <ol className="pv-poster-points">
        {points.map((p, i) => <li key={i}><span>{String(i + 1).padStart(2, "0")}</span>{p}</li>)}
      </ol>
      {notes.length > 0 && <p className="pv-poster-note">{notes.join("；")}</p>}
      <footer className="pv-poster-foot">
        <div>
          <strong>{first}</strong>
          {rest.map((l, i) => <span key={i}>{l}</span>)}
        </div>
        <span className="pv-poster-qr">二维码<br />由门店添加</span>
      </footer>
    </article>
  );
}

export function Preview({ platform, article, img, storeName }: { platform: Platform; article: Article; img: ImgUrl; storeName: string }) {
  switch (platform) {
    case "wechat_article":
      return <Wechat a={article} img={img} storeName={storeName} />;
    case "xiaohongshu":
      return <Xhs a={article} img={img} storeName={storeName} />;
    case "store_moments":
      return <Moments a={article} img={img} storeName={storeName} />;
    case "store_poster":
      return <Poster a={article} img={img} />;
  }
}

/* ------------------------------ 图片导出（海报 PNG、小红书封面 PNG） ------------------------------ */

/** 画布颜色与界面的设计 token 一致（画布不能读 CSS 变量，这里集中写一份）。 */
const INK = { fg: "#1b1d21", soft: "#4a4f58", muted: "#6a707b", brand: "#c7000b", paper: "#ffffff", dark: "#0a0b0d", band: "#f4f5f7" };
const font = (size: number, weight = 400) => `${weight} ${size}px "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`;

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const ch of para) {
      if (ctx.measureText(line + ch).width > maxWidth && line) {
        lines.push(line);
        line = ch;
      } else line += ch;
    }
    lines.push(line);
  }
  return lines;
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("图片加载失败"));
    im.src = src;
  });

/** 按 cover 方式把图片铺进矩形。 */
function drawCover(ctx: CanvasRenderingContext2D, im: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / im.width, h / im.height);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, x, y, w, h);
}

const toBlob = (canvas: HTMLCanvasElement, what: string) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(`${what}生成失败`))), "image/png"));

/** 门店海报 1080×1440：上半张图 + 深色渐变压标题，中间三行编号卖点，底部深色行动引导带和二维码位。 */
export async function renderPosterPng(article: Article, img: ImgUrl): Promise<Blob> {
  const W = 1080;
  const H = 1440;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = INK.paper;
  ctx.fillRect(0, 0, W, H);

  const heroH = 760;
  const pic = imgs(article)[0];
  ctx.fillStyle = INK.dark;
  ctx.fillRect(0, 0, W, heroH);
  if (pic) drawCover(ctx, await loadImage(img(pic.imageId)), 0, 0, W, heroH);
  const g = ctx.createLinearGradient(0, heroH * 0.35, 0, heroH);
  g.addColorStop(0, "rgba(10,11,13,0)");
  g.addColorStop(1, "rgba(10,11,13,0.92)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, heroH);

  const x = 80;
  ctx.fillStyle = INK.paper;
  ctx.font = font(96, 700);
  const titleLines = wrap(ctx, article.title, W - x * 2);
  let y = heroH - 60 - (article.lead ? 70 : 0) - (titleLines.length - 1) * 108;
  for (const l of titleLines) {
    ctx.fillText(l, x, y);
    y += 108;
  }
  if (article.lead) {
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = font(40);
    ctx.fillText(wrap(ctx, article.lead, W - x * 2)[0] ?? "", x, y - 20);
  }

  const { points, notes } = posterLines(article);
  y = heroH + 120;
  for (const [i, p] of points.entries()) {
    ctx.fillStyle = INK.brand;
    ctx.font = font(44, 700);
    ctx.fillText(String(i + 1).padStart(2, "0"), x, y);
    ctx.fillStyle = INK.fg;
    ctx.font = font(48, 600);
    for (const l of wrap(ctx, p, W - x * 2 - 100)) {
      ctx.fillText(l, x + 100, y);
      y += 62;
    }
    y += 28;
  }
  if (notes.length) {
    ctx.fillStyle = INK.muted;
    ctx.font = font(24);
    for (const l of wrap(ctx, notes.join("；"), W - x * 2).slice(0, 3)) {
      ctx.fillText(l, x, y);
      y += 34;
    }
  }

  // 底部：深色行动引导带 + 二维码位（由门店添加）
  const footH = 230;
  ctx.fillStyle = INK.dark;
  ctx.fillRect(0, H - footH, W, footH);
  const [first, ...rest] = article.callToAction.split("\n");
  ctx.fillStyle = INK.paper;
  ctx.font = font(44, 700);
  ctx.fillText(first ?? "", x, H - footH + 90);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = font(28);
  let fy = H - footH + 140;
  for (const l of rest.flatMap((r) => wrap(ctx, r, W - x * 2 - 220)).slice(0, 2)) {
    ctx.fillText(l, x, fy);
    fy += 40;
  }
  const qr = 150;
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 3;
  ctx.strokeRect(W - x - qr, H - footH + 40, qr, qr);
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = font(24);
  ctx.textAlign = "center";
  ctx.fillText("二维码", W - x - qr / 2, H - footH + 108);
  ctx.fillText("由门店添加", W - x - qr / 2, H - footH + 142);
  ctx.textAlign = "left";
  return toBlob(canvas, "海报");
}

/** 小红书封面 1080×1440（3:4）：首图铺满，封面大字压在左下，每行一条高亮色带。 */
export async function renderXhsCover(imageUrl: string | undefined, coverText: string): Promise<Blob> {
  const W = 1080;
  const H = 1440;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = INK.band;
  ctx.fillRect(0, 0, W, H);
  if (imageUrl) drawCover(ctx, await loadImage(imageUrl), 0, 0, W, H);
  const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const lines = coverText.split("\n").slice(0, 3);
  ctx.font = font(110, 800);
  const lh = 150;
  let y = H - 120 - (lines.length - 1) * lh;
  for (const l of lines) {
    const w = ctx.measureText(l).width;
    ctx.fillStyle = "#ffe14d";
    ctx.fillRect(70, y - 96, w + 40, 124);
    ctx.fillStyle = INK.fg;
    ctx.fillText(l, 90, y);
    y += lh;
  }
  return toBlob(canvas, "封面");
}
