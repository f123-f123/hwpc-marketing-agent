import type { Article, Platform, VisualStyle } from "@hwpc/contracts";
import { canvasFont, DEFAULT_THEME, themeOf, themeVars, type PosterTheme } from "../../lib/creativeTheme";
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

/** 多条限制条件用分号连接；原文末尾的句号、分号先去掉，避免出现“。；”。 */
const joinNotes = (notes: string[]) => notes.map((n) => n.trim().replace(/[。；;]+$/, "")).join("；");

/** 限制条件：小字，紧跟在它所属的段落后面。 */
function Notes({ notes }: { notes?: string[] }) {
  return notes?.length ? <p className="pv-note">{joinNotes(notes)}</p> : null;
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

export function CoverText({ text, theme }: { text: string; theme?: PosterTheme }) {
  // 有视觉风格时，封面字用风格的强调色做色带、背景色做字色（两者对比度已在规范库测试中保证）
  const style = theme?.name ? { background: theme.accent, color: theme.bg, fontFamily: theme.headFont } : undefined;
  return (
    <div className="pv-cover-text" aria-hidden="true">
      {text.split("\n").map((l, i) => <span key={i} style={style}>{l}</span>)}
    </div>
  );
}

function Xhs({ a, img, storeName, theme }: { a: Article; img: ImgUrl; storeName: string; theme: PosterTheme }) {
  const pics = imgs(a);
  return (
    <article className="pv pv-xhs">
      {pics[0] && (
        <div className="pv-xhs-cover">
          <img src={img(pics[0].imageId)} alt={pics[0].caption} loading="lazy" />
          {a.coverText && <CoverText text={a.coverText} theme={theme} />}
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

function Poster({ a, img, theme }: { a: Article; img: ImgUrl; theme: PosterTheme }) {
  const pic = imgs(a)[0];
  const { points, notes } = posterLines(a);
  const [first, ...rest] = a.callToAction.split("\n");
  const themed = theme.name ? ` is-themed ${theme.dark ? "is-dark" : "is-light"}` : "";
  return (
    <article className={`pv pv-poster${themed}`} style={theme.name ? themeVars(theme) : undefined}>
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
      {notes.length > 0 && <p className="pv-poster-note">{joinNotes(notes)}</p>}
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

/** visual：本版本的视觉风格（海报与小红书封面使用）；早期稿件没有风格时用默认样式。 */
export function Preview({ platform, article, img, storeName, visual }: { platform: Platform; article: Article; img: ImgUrl; storeName: string; visual?: VisualStyle }) {
  const theme = themeOf(visual);
  switch (platform) {
    case "wechat_article":
      return <Wechat a={article} img={img} storeName={storeName} />;
    case "xiaohongshu":
      return <Xhs a={article} img={img} storeName={storeName} theme={theme} />;
    case "store_moments":
      return <Moments a={article} img={img} storeName={storeName} />;
    case "store_poster":
      return <Poster a={article} img={img} theme={theme} />;
  }
}

/* ------------------------------ 图片导出（海报 PNG、小红书封面 PNG） ------------------------------ */

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

const rgba = (hex: string, a: number) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",")},${a})`;

/** 按 contain 方式把图片放进矩形（完整保留产品轮廓）。 */
function drawContain(ctx: CanvasRenderingContext2D, im: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.min(w / im.width, h / im.height);
  const dw = im.width * scale;
  const dh = im.height * scale;
  ctx.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/**
 * 门店海报 1080×1440。
 * 深色主题（含默认样式）：上半张图 + 渐变压标题；浅色主题：产品图完整放在浅底上，标题在图下。
 * 中间编号卖点，底部行动引导带和二维码位。
 */
export async function renderPosterPng(article: Article, img: ImgUrl, visual?: VisualStyle): Promise<Blob> {
  const t = themeOf(visual);
  const W = 1080;
  const H = 1440;
  const x = 80;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  // 默认样式保留原来的白底正文；有风格时整张用风格背景色
  const page = t.name ? t.bg : "#ffffff";
  const ink = t.name ? t.fg : "#1b1d21";
  ctx.fillStyle = page;
  ctx.fillRect(0, 0, W, H);
  const pic = imgs(article)[0];
  const picture = pic ? await loadImage(img(pic.imageId)) : undefined;

  let y: number;
  if (t.dark) {
    const heroH = 760;
    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, W, heroH);
    if (picture) drawCover(ctx, picture, 0, 0, W, heroH);
    const g = ctx.createLinearGradient(0, heroH * 0.35, 0, heroH);
    g.addColorStop(0, rgba(t.bg, 0));
    g.addColorStop(1, rgba(t.bg, 0.92));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, heroH);
    ctx.fillStyle = t.fg;
    ctx.font = canvasFont(t, 96, t.headWeight, true);
    const titleLines = wrap(ctx, article.title, W - x * 2);
    y = heroH - 60 - (article.lead ? 70 : 0) - (titleLines.length - 1) * 108;
    for (const l of titleLines) {
      ctx.fillText(l, x, y);
      y += 108;
    }
    if (article.lead) {
      ctx.fillStyle = rgba(t.fg, 0.78);
      ctx.font = canvasFont(t, 40, 400);
      ctx.fillText(wrap(ctx, article.lead, W - x * 2)[0] ?? "", x, y - 20);
    }
    y = heroH + 120;
  } else {
    const heroH = 560;
    ctx.fillStyle = t.surface;
    ctx.fillRect(0, 0, W, heroH);
    if (picture) drawContain(ctx, picture, x, 48, W - x * 2, heroH - 96);
    ctx.fillStyle = t.fg;
    ctx.font = canvasFont(t, 80, t.headWeight, true);
    y = heroH + 110;
    for (const l of wrap(ctx, article.title, W - x * 2).slice(0, 2)) {
      ctx.fillText(l, x, y);
      y += 92;
    }
    if (article.lead) {
      ctx.fillStyle = rgba(t.fg, 0.75);
      ctx.font = canvasFont(t, 36, 400);
      ctx.fillText(wrap(ctx, article.lead, W - x * 2)[0] ?? "", x, y - 32);
      y += 28;
    }
    y += 50;
  }

  const footH = t.dark ? 230 : 200;
  const { points, notes } = posterLines(article);
  const gap = t.dark ? 28 : 18;
  // 卖点与限制条件都要完整显示在行动引导带上方：放不下时逐步缩小卖点字号；限制条件固定 24px、不截断
  ctx.font = canvasFont(t, 24, 400);
  const noteLines = notes.length ? wrap(ctx, joinNotes(notes), W - x * 2) : [];
  const heightAt = (size: number) => {
    ctx.font = canvasFont(t, size, 600);
    return points.reduce((h, p) => h + wrap(ctx, p, W - x * 2 - 100).length * (size + 14) + gap, 0) + noteLines.length * 34;
  };
  let pointSize = t.dark ? 48 : 44;
  while (pointSize > 32 && y + heightAt(pointSize) > H - footH - 24) pointSize -= 2;
  for (const [i, p] of points.entries()) {
    ctx.fillStyle = t.accent;
    ctx.font = canvasFont(t, pointSize - 4, 700);
    ctx.fillText(String(i + 1).padStart(2, "0"), x, y);
    ctx.fillStyle = ink;
    ctx.font = canvasFont(t, pointSize, 600);
    for (const l of wrap(ctx, p, W - x * 2 - 100)) {
      ctx.fillText(l, x + 100, y);
      y += pointSize + 14;
    }
    y += gap;
  }
  if (noteLines.length) {
    ctx.fillStyle = rgba(ink, 0.62);
    ctx.font = canvasFont(t, 24, 400);
    for (const l of noteLines) {
      ctx.fillText(l, x, y);
      y += 34;
    }
  }

  // 底部：行动引导带 + 二维码位（由门店添加）
  const foot = t.name ? t.surface : "#0a0b0d";
  const footInk = t.name ? t.fg : "#ffffff";
  ctx.fillStyle = foot;
  ctx.fillRect(0, H - footH, W, footH);
  const [first, ...rest] = article.callToAction.split("\n");
  ctx.fillStyle = footInk;
  ctx.font = canvasFont(t, 44, 700, true);
  ctx.fillText(first ?? "", x, H - footH + 90);
  ctx.fillStyle = rgba(footInk, 0.7);
  ctx.font = canvasFont(t, 28, 400);
  let fy = H - footH + 140;
  for (const l of rest.flatMap((r) => wrap(ctx, r, W - x * 2 - 220)).slice(0, 2)) {
    ctx.fillText(l, x, fy);
    fy += 40;
  }
  const qr = 150;
  ctx.strokeStyle = rgba(footInk, 0.6);
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 3;
  ctx.strokeRect(W - x - qr, H - footH + (footH - qr) / 2, qr, qr);
  ctx.setLineDash([]);
  ctx.fillStyle = rgba(footInk, 0.7);
  ctx.font = canvasFont(t, 24, 400);
  ctx.textAlign = "center";
  ctx.fillText("二维码", W - x - qr / 2, H - footH / 2 - 8);
  ctx.fillText("由门店添加", W - x - qr / 2, H - footH / 2 + 26);
  ctx.textAlign = "left";
  return toBlob(canvas, "海报");
}

/** 小红书封面 1080×1440（3:4）：首图铺满，封面大字压在左下，每行一条色带（默认黄底黑字，有风格时用风格强调色）。 */
export async function renderXhsCover(imageUrl: string | undefined, coverText: string, visual?: VisualStyle): Promise<Blob> {
  const t = themeOf(visual);
  const W = 1080;
  const H = 1440;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = t.name ? t.surface : DEFAULT_THEME.surface;
  ctx.fillRect(0, 0, W, H);
  if (imageUrl) drawCover(ctx, await loadImage(imageUrl), 0, 0, W, H);
  const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const lines = coverText.split("\n").slice(0, 3);
  ctx.font = canvasFont(t, 110, t.name ? Math.max(700, t.headWeight) : 800, Boolean(t.name));
  const lh = 150;
  let y = H - 120 - (lines.length - 1) * lh;
  for (const l of lines) {
    const w = ctx.measureText(l).width;
    ctx.fillStyle = t.name ? t.accent : "#ffe14d";
    ctx.fillRect(70, y - 96, w + 40, 124);
    ctx.fillStyle = t.name ? t.bg : "#1b1d21";
    ctx.fillText(l, 90, y);
    y += lh;
  }
  return toBlob(canvas, "封面");
}
