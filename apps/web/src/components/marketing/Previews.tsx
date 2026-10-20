import type { Article, Platform } from "@hwpc/contracts";

type ImgUrl = (imageId: string) => string;

const paras = (a: Article) => a.blocks.flatMap((b) => (b.type === "paragraph" ? [b] : []));

/** 海报正文：每行一个卖点；以“（”开头的行是限制条件注释。 */
function posterLines(a: Article): { points: string[]; notes: string[] } {
  const lines = paras(a).flatMap((p) => p.text.split("\n")).map((l) => l.trim()).filter(Boolean);
  return { points: lines.filter((l) => !l.startsWith("（")).map((l) => l.replace(/^·\s*/, "")), notes: lines.filter((l) => l.startsWith("（")) };
}
const imgs = (a: Article) => a.blocks.flatMap((b) => (b.type === "image" ? [b] : []));

function Cta({ text }: { text: string }) {
  return <div className="pv-cta">{text.split("\n").map((l, i) => <p key={i}>{l}</p>)}</div>;
}

function Wechat({ a, img, storeName }: { a: Article; img: ImgUrl; storeName: string }) {
  return (
    <article className="pv pv-wechat">
      <h3 className="pv-wx-title">{a.title}</h3>
      <p className="pv-wx-meta">{storeName} · 公众号文章</p>
      {a.lead && <p className="pv-wx-lead">{a.lead}</p>}
      {a.blocks.map((b, i) =>
        b.type === "paragraph" ? (
          <section key={i}>
            {b.heading && <h4>{b.heading}</h4>}
            <p>{b.text}</p>
          </section>
        ) : (
          <figure key={i}>
            <img src={img(b.imageId)} alt={b.caption} loading="lazy" />
            <figcaption>{b.caption}</figcaption>
          </figure>
        ),
      )}
      <Cta text={a.callToAction} />
    </article>
  );
}

function Xhs({ a, img }: { a: Article; img: ImgUrl }) {
  const pics = imgs(a);
  return (
    <article className="pv pv-xhs">
      {pics[0] && (
        <div className="pv-xhs-cover">
          <img src={img(pics[0].imageId)} alt={pics[0].caption} loading="lazy" />
          {pics.length > 1 && <span className="pv-xhs-count">1/{pics.length}</span>}
        </div>
      )}
      {pics.length > 1 && (
        <div className="pv-xhs-thumbs">
          {pics.slice(1).map((p) => <img key={p.imageId} src={img(p.imageId)} alt={p.caption} loading="lazy" />)}
        </div>
      )}
      <h3 className="pv-xhs-title">{a.title}</h3>
      {paras(a).map((p, i) => <p key={i}>{p.heading ? `${p.heading}｜` : ""}{p.text}</p>)}
      <Cta text={a.callToAction} />
      {a.tags.length > 0 && <p className="pv-xhs-tags">{a.tags.map((t) => `#${t}`).join(" ")}</p>}
    </article>
  );
}

function Moments({ a, img, storeName }: { a: Article; img: ImgUrl; storeName: string }) {
  const pics = imgs(a);
  return (
    <article className="pv pv-moments">
      <span className="pv-avatar" aria-hidden="true">{storeName.slice(0, 1)}</span>
      <div className="pv-moments-body">
        <p className="pv-moments-name">{storeName}</p>
        <p>{a.title}</p>
        {paras(a).map((p, i) => <p key={i}>{p.text}</p>)}
        <Cta text={a.callToAction} />
        {pics.length > 0 && (
          <div className={`pv-moments-grid n${Math.min(pics.length, 3)}`}>
            {pics.slice(0, 3).map((p) => <img key={p.imageId} src={img(p.imageId)} alt={p.caption} loading="lazy" />)}
          </div>
        )}
        <p className="pv-moments-time">刚刚</p>
      </div>
    </article>
  );
}

function Poster({ a, img }: { a: Article; img: ImgUrl }) {
  const pic = imgs(a)[0];
  return (
    <article className="pv pv-poster">
      {pic && <img className="pv-poster-img" src={img(pic.imageId)} alt={pic.caption} loading="lazy" />}
      <div className="pv-poster-text">
        <h3>{a.title}</h3>
        {a.lead && <p className="pv-poster-sub">{a.lead}</p>}
        <ul>{posterLines(a).points.map((p, i) => <li key={i}>{p}</li>)}</ul>
        {posterLines(a).notes.map((n, i) => <p key={i} className="pv-poster-note">{n}</p>)}
        <Cta text={a.callToAction} />
      </div>
    </article>
  );
}

export function Preview({ platform, article, img, storeName }: { platform: Platform; article: Article; img: ImgUrl; storeName: string }) {
  switch (platform) {
    case "wechat_article":
      return <Wechat a={article} img={img} storeName={storeName} />;
    case "xiaohongshu":
      return <Xhs a={article} img={img} />;
    case "store_moments":
      return <Moments a={article} img={img} storeName={storeName} />;
    case "store_poster":
      return <Poster a={article} img={img} />;
  }
}

/* ------------------------------ 海报 PNG ------------------------------ */

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
    im.onerror = () => reject(new Error("海报图片加载失败"));
    im.src = src;
  });

/** 用 canvas 生成 1080×1440 的海报 PNG（同源图片，不会污染画布）。 */
export async function renderPosterPng(article: Article, img: ImgUrl): Promise<Blob> {
  const W = 1080;
  const H = 1440;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const font = (size: number, weight = 400) => `${weight} ${size}px "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  const pic = imgs(article)[0];
  const imgH = 700;
  if (pic) {
    const im = await loadImage(img(pic.imageId));
    const scale = Math.max(W / im.width, imgH / im.height);
    const sw = W / scale;
    const sh = imgH / scale;
    ctx.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, 0, 0, W, imgH);
  }
  let y = (pic ? imgH : 80) + 90;
  const x = 72;
  ctx.fillStyle = "#c7000b";
  ctx.fillRect(x, y - 60, 8, 64);
  ctx.fillStyle = "#1b1d21";
  ctx.font = font(64, 700);
  for (const l of wrap(ctx, article.title, W - x * 2)) {
    ctx.fillText(l, x + 28, y);
    y += 78;
  }
  if (article.lead) {
    ctx.fillStyle = "#4a4f58";
    ctx.font = font(36);
    for (const l of wrap(ctx, article.lead, W - x * 2)) {
      ctx.fillText(l, x, y + 10);
      y += 50;
    }
  }
  y += 40;
  const { points, notes } = posterLines(article);
  ctx.font = font(36);
  for (const p of points) {
    ctx.fillStyle = "#c7000b";
    ctx.beginPath();
    ctx.arc(x + 8, y - 12, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1b1d21";
    for (const l of wrap(ctx, p, W - x * 2 - 40)) {
      ctx.fillText(l, x + 36, y);
      y += 50;
    }
    y += 10;
  }
  ctx.font = font(24);
  ctx.fillStyle = "#6a707b";
  for (const n of notes) {
    for (const l of wrap(ctx, n, W - x * 2)) {
      ctx.fillText(l, x, y);
      y += 34;
    }
  }
  ctx.fillStyle = "#f4f5f7";
  ctx.fillRect(0, H - 220, W, 220);
  ctx.fillStyle = "#1b1d21";
  ctx.font = font(32, 600);
  let cy = H - 150;
  for (const l of wrap(ctx, article.callToAction, W - x * 2).slice(0, 3)) {
    ctx.fillText(l, x, cy);
    cy += 46;
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("海报生成失败"))), "image/png"));
}
