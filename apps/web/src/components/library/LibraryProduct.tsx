import { useState } from "react";
import { LIBRARY_SECTION_LABEL, type CatalogDetail, type LibraryDoc } from "@hwpc/contracts";
import { marketingApi } from "../../api/marketing";
import { href } from "../../lib/router";
import { useLoad } from "../../lib/useLoad";
import type { Auth } from "../../state/useAuth";
import { Alert, Badge, Icon } from "../ui";
import { DocSheet } from "./DocSheet";
import { priceLine } from "./LibraryHome";

const short = (model: string) => model.replace(/^HUAWEI\s+/i, "");
/** 文档标题里重复的“型号｜”前缀去掉，只留卡片名。 */
const docName = (d: LibraryDoc) => d.title.split("｜").at(-1) ?? d.title;

function Brief({ d }: { d: CatalogDetail }) {
  const b = d.brief;
  if (!b) return null;
  const cols = [
    { title: "适合", items: b.fits, tone: "ok" },
    { title: "不适合或需先验证", items: b.notFits, tone: "bad" },
    { title: "待核验", items: b.toVerify, tone: "muted" },
    { title: "限制", items: b.limits, tone: "muted" },
  ].filter((c) => c.items.length > 0);
  return (
    <section id="lib-brief" aria-labelledby="lib-brief-title">
      <h2 id="lib-brief-title" className="subhead-inline">适合谁</h2>
      <p className="muted small">出处：{b.source.title}</p>
      <div className="lib-brief">
        {cols.map((c) => (
          <div key={c.title} className={`lib-brief-col is-${c.tone}`}>
            <h3>{c.title}</h3>
            <ul>{c.items.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function Prices({ d }: { d: CatalogDetail }) {
  return (
    <section id="lib-prices" aria-labelledby="lib-prices-title">
      <h2 id="lib-prices-title" className="subhead-inline">官方公开价格</h2>
      {d.prices.length === 0 ? (
        <p className="muted">资料里没有官方公开价格。报价以门店当日为准，推文不写价格。</p>
      ) : (
        <>
          <p className="muted small">原样登记，不推算。“官网参考起价”“预估到手价”不是当前商城成交价；对顾客报价前以门店和官方商城结算页为准。</p>
          <div className="table-wrap">
            <table className="table lib-price-table">
              <thead>
                <tr><th scope="col">款式</th><th scope="col">价格类型</th><th scope="col">金额</th><th scope="col">条件</th><th scope="col">库存</th><th scope="col">核验日期</th></tr>
              </thead>
              <tbody>
                {d.prices.map((p) => (
                  <tr key={p.recordId}>
                    <td>{p.variant || "—"}</td>
                    <td>{p.priceType}</td>
                    <td>{p.amount ? `${p.amount.toLocaleString("zh-CN")} 元` : "—"}{p.listAmount && p.listAmount !== p.amount ? <span className="muted small">（标价 {p.listAmount.toLocaleString("zh-CN")}）</span> : null}</td>
                    <td>{p.conditions || "—"}</td>
                    <td>{p.stock || "—"}</td>
                    <td>{p.checkedAt.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Facts({ d }: { d: CatalogDetail }) {
  const [hidePending, setHidePending] = useState(false);
  const pending = d.entry.coverage.pendingFacts;
  return (
    <section id="lib-facts" aria-labelledby="lib-facts-title">
      <div className="post-bar">
        <h2 id="lib-facts-title" className="subhead-inline">参数（资料原文）</h2>
        {pending > 0 && (
          <button type="button" className="chip" aria-pressed={hidePending} onClick={() => setHidePending(!hidePending)}>只看已审核（隐藏 {pending} 条待审核）</button>
        )}
      </div>
      {d.groups.map((g) => {
        const facts = hidePending ? g.facts.filter((f) => f.reviewStatus === "verified") : g.facts;
        if (!facts.length) return null;
        return (
          <div key={g.category} className="lib-fact-group">
            <h3>{g.label}</h3>
            <dl>
              {facts.map((f) => (
                <div key={f.factId} className={f.reviewStatus === "pending_review" ? "is-pending" : undefined}>
                  <dt>{f.field.split("·").at(-1)}</dt>
                  <dd>
                    {f.value}
                    {f.reviewStatus === "pending_review" && <Badge tone="warning">待审核 · 不能直接引用</Badge>}
                    {f.qualifiers.length > 0 && <span className="lib-qual">{f.qualifiers.join("；")}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
      <p className="muted small">出处：{[...new Set(d.groups.flatMap((g) => g.facts.map((f) => f.source.locator)))].join("、")}</p>
    </section>
  );
}

function Docs({ d, onOpen }: { d: CatalogDetail; onOpen: (id: string) => void }) {
  if (!d.docs.length) return null;
  const sections = [...new Set(d.docs.map((x) => x.section))];
  return (
    <section id="lib-docs" aria-labelledby="lib-docs-title">
      <h2 id="lib-docs-title" className="subhead-inline">这款的资料原文</h2>
      <p className="muted small">卖点与限制、型号检索卡、按顾客角色写好的沟通卡。点开看全文，接待前可以先读对应的沟通卡。</p>
      <div className="lib-doc-cols">
        {sections.map((s) => (
          <div key={s}>
            <h3>{LIBRARY_SECTION_LABEL[s]}</h3>
            <ul className="lib-doc-list">
              {d.docs.filter((x) => x.section === s).map((x) => (
                <li key={x.docId}>
                  <button type="button" className="link" onClick={() => onOpen(x.docId)}>{docName(x)}</button>
                  {x.headings.length > 0 && <span className="muted small"> · {x.headings.slice(0, 3).join("、")}{x.headings.length > 3 ? "…" : ""}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/** 型号详情：一款型号在知识库里的全部资料。 */
export function LibraryProduct({ auth, productId }: { auth: Auth; productId: string }) {
  const data = useLoad(() => marketingApi.catalogProduct(productId), [productId], auth.handleError);
  const [doc, setDoc] = useState<string>();
  const d = data.data;
  const e = d?.entry;
  return (
    <main className="page lib">
      <a className="back-link" href={href("library")}><Icon name="back" />全部型号</a>
      {data.error && <Alert tone="danger" action={<button type="button" className="btn btn-sm" onClick={() => void data.reload()}>重试</button>}>{data.error}</Alert>}
      {!d && !data.error && <div className="skeleton skeleton-block" />}
      {d && e && (
        <>
          <header className="lib-hero">
            <div className="lib-hero-pic">{e.heroImageId ? <img src={marketingApi.libraryImage(e.heroImageId)} alt={`${short(e.model)} 产品图`} /> : null}</div>
            <div>
              <h1 className="page-title">{e.model}</h1>
              {e.positioning && <p className="lib-hero-pos">{e.positioning}</p>}
              <p className={`lib-card-price${e.price?.amount ? "" : " is-muted"}`}>{priceLine(e.price)}{e.price?.note ? `（${e.price.note}）` : ""}</p>
              <dl className="lib-figs">
                {e.figures.map((f) => (
                  <div key={f.label}><dt>{f.label}</dt><dd>{f.value}{f.pending && <Badge tone="warning">待审核</Badge>}</dd></div>
                ))}
              </dl>
              <nav className="lib-jump small" aria-label="本页内容">
                {d.brief && <a href="#lib-brief" onClick={(ev) => { ev.preventDefault(); document.getElementById("lib-brief")?.scrollIntoView({ behavior: "smooth" }); }}>适合谁</a>}
                {[["lib-prices", "价格"], ["lib-facts", "参数"], ["lib-images", "图片"], ["lib-docs", "资料原文"]].map(([id, label]) => (
                  <a key={id} href={`#${id}`} onClick={(ev) => { ev.preventDefault(); document.getElementById(id!)?.scrollIntoView({ behavior: "smooth" }); }}>{label}</a>
                ))}
              </nav>
            </div>
          </header>
          {e.isMock && <Alert tone="warning">当前是模拟资料，不是真实华为产品信息。</Alert>}
          {d.gaps.length > 0 && (
            <Alert tone="warning">
              <strong>资料缺口：</strong>
              <ul>{d.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
            </Alert>
          )}
          <Brief d={d} />
          <Prices d={d} />
          <Facts d={d} />
          {d.images.length > 0 && (
            <section id="lib-images" aria-labelledby="lib-images-title">
              <h2 id="lib-images-title" className="subhead-inline">知识库图片（{d.images.length}）</h2>
              <p className="muted small">推文配图只从这里取，与型号绑定；用于说明外观，不代表具体配置。</p>
              <ul className="lib-images">
                {d.images.map((im) => (
                  <li key={im.imageId}>
                    <img src={marketingApi.libraryImage(im.imageId)} alt={im.description} loading="lazy" />
                    <span className="small muted">{im.description}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <Docs d={d} onOpen={setDoc} />
        </>
      )}
      {doc && <DocSheet auth={auth} docId={doc} onClose={() => setDoc(undefined)} />}
    </main>
  );
}
