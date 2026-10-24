import { useEffect, useMemo, useState } from "react";
import { LIBRARY_SECTION_LABEL, type CatalogEntry, type CatalogPrice, type CatalogSearchHit, type LibraryDoc } from "@hwpc/contracts";
import { marketingApi } from "../../api/marketing";
import { href } from "../../lib/router";
import { useLoad } from "../../lib/useLoad";
import type { Auth } from "../../state/useAuth";
import { Alert, Badge, EmptyState } from "../ui";
import { DocSheet } from "./DocSheet";

const short = (model: string) => model.replace(/^HUAWEI\s+/i, "");
const yuan = (n: number) => `${n.toLocaleString("zh-CN")} 元`;

/** 价格一行：金额 + 口径 + 核验日期；不是商城页面价、已下架都写明。 */
export function priceLine(p: CatalogPrice | undefined): string {
  if (!p) return "资料里没有官方公开价格";
  const head = p.amount ? `${p.priceType} ${yuan(p.amount)}起` : p.priceType;
  return [head, p.offShelf ? "商城已下架或无公开商城价" : "", `${p.checkedAt} 核验`].filter(Boolean).join(" · ");
}

const OS_FILTER = { all: "全部系统", harmony: "鸿蒙", windows: "Windows" } as const;
type OsFilter = keyof typeof OS_FILTER;
const osOf = (e: CatalogEntry): OsFilter[] => [
  ...(e.os.some((o) => /harmony|鸿蒙/i.test(o)) ? (["harmony"] as const) : []),
  ...(e.os.some((o) => /windows/i.test(o)) ? (["windows"] as const) : []),
];

function Coverage({ e }: { e: CatalogEntry }) {
  const c = e.coverage;
  return (
    <p className="lib-coverage small">
      <span>{c.facts} 条参数</span>
      {c.pendingFacts > 0 && <span className="is-warn">{c.pendingFacts} 条待审核</span>}
      <span>{c.prices ? `${c.prices} 条价格` : "无价格"}</span>
      <span>{c.docs} 份资料</span>
      <span>{c.images} 张图</span>
    </p>
  );
}

function Card({ e }: { e: CatalogEntry }) {
  return (
    <li>
      <a className="lib-card" href={href("library", e.productId)}>
        <div className="lib-card-pic">{e.heroImageId ? <img src={marketingApi.libraryImage(e.heroImageId)} alt="" loading="lazy" /> : <span className="muted small">没有登记的图片</span>}</div>
        <div className="lib-card-body">
          <h2>{short(e.model)}</h2>
          {e.positioning && <p className="lib-card-pos">{e.positioning}</p>}
          <p className={`lib-card-price${e.price?.amount ? "" : " is-muted"}`}>{priceLine(e.price)}</p>
          <dl className="lib-figs">
            {e.figures.map((f) => (
              <div key={f.label}>
                <dt>{f.label}</dt>
                <dd>{f.value}{f.pending && <Badge tone="warning">待审核</Badge>}</dd>
              </div>
            ))}
          </dl>
          <Coverage e={e} />
        </div>
      </a>
    </li>
  );
}

const TABLE_COLS = ["系统", "屏幕", "处理器", "内存", "存储", "重量", "电池"];

function QuickTable({ entries }: { entries: CatalogEntry[] }) {
  return (
    <div className="table-wrap lib-table">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">型号</th>
            <th scope="col">价格（口径 · 核验日期）</th>
            {TABLE_COLS.map((c) => <th key={c} scope="col">{c}</th>)}
            <th scope="col">资料</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.productId}>
              <th scope="row"><a href={href("library", e.productId)}>{short(e.model)}</a></th>
              <td>{priceLine(e.price)}</td>
              {TABLE_COLS.map((c) => {
                const f = e.figures.find((x) => x.label === c);
                return <td key={c} className={f?.pending ? "is-warn" : undefined}>{f ? `${f.value}${f.pending ? "（待审核）" : ""}` : <span className="muted">—</span>}</td>;
              })}
              <td className="lib-table-cov">{e.coverage.facts} 条参数{e.coverage.pendingFacts > 0 && <span className="is-warn">{e.coverage.pendingFacts} 条待审核</span>}<span>{e.coverage.docs} 份资料</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 查资料原文：全库全文检索（型号资料、常见问题、客户场景、营销素材），顾客原话里的软件名、功能名也能搜到。 */
function Search({ auth, docs, entries }: { auth: Auth; docs: LibraryDoc[]; entries: CatalogEntry[] }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CatalogSearchHit[]>();
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string>();
  const names = useMemo(() => new Map(entries.map((e) => [e.productId, short(e.model)])), [entries]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of docs) m.set(d.section, (m.get(d.section) ?? 0) + 1);
    return [...m];
  }, [docs]);
  useEffect(() => {
    const text = q.trim();
    if (!text) return setHits(undefined);
    const t = setTimeout(() => {
      marketingApi
        .catalogSearch(text)
        .then((r) => { setHits(r); setError(""); })
        .catch((e: unknown) => { auth.handleError(e); setError(e instanceof Error ? e.message : "搜索失败"); });
    }, 300);
    return () => clearTimeout(t);
  }, [q, auth]);
  return (
    <section className="lib-general" aria-labelledby="lib-search-title">
      <h2 id="lib-search-title" className="subhead-inline">查资料原文</h2>
      <p className="muted small">
        顾客问到软件安装、协同条件、售后这类问题时，在这里搜原文再回答。除了各型号资料，还有{counts.map(([s, n]) => `${LIBRARY_SECTION_LABEL[s as keyof typeof LIBRARY_SECTION_LABEL]} ${n} 份`).join("、")}。
      </p>
      <input className="input" type="search" placeholder="用顾客的话搜，如：鸿蒙版能装 Photoshop 吗、怎么投屏、电池保养" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜索资料原文" />
      {error && <Alert tone="danger">{error}</Alert>}
      {hits && hits.length === 0 && <p className="muted small">没有找到相关原文。换个说法，或到型号详情里看这款的资料。</p>}
      {hits && hits.length > 0 && (
        <ul className="lib-hits">
          {hits.map((h, i) => (
            <li key={`${h.docId}-${i}`}>
              <button type="button" className="link" onClick={() => setOpen(h.docId)}>{h.title}{h.heading ? ` · ${h.heading}` : ""}</button>
              <span className="muted small">
                {" "}{LIBRARY_SECTION_LABEL[h.section]}{h.productIds.length ? ` · ${h.productIds.map((id) => names.get(id) ?? id).join("、")}` : ""}
              </span>
              <q>{h.excerpt}</q>
            </li>
          ))}
        </ul>
      )}
      {open && <DocSheet auth={auth} docId={open} onClose={() => setOpen(undefined)} />}
    </section>
  );
}

/** 资料库总览：知识库里有哪些型号、每款的关键参数、价格口径和资料覆盖。 */
export function LibraryHome({ auth }: { auth: Auth }) {
  const data = useLoad(() => marketingApi.catalog(), [], auth.handleError);
  const [q, setQ] = useState("");
  const [os, setOs] = useState<OsFilter>("all");
  const [sort, setSort] = useState<"default" | "price">("default");
  const [view, setView] = useState<"cards" | "table">("cards");
  const o = data.data;

  const entries = useMemo(() => {
    if (!o) return [];
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = o.entries.filter((e) => {
      if (os !== "all" && !osOf(e).includes(os)) return false;
      const text = `${e.model} ${e.positioning ?? ""} ${e.figures.map((f) => f.value).join(" ")}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
    if (sort === "price") list.sort((a, b) => (a.price?.amount ?? Infinity) - (b.price?.amount ?? Infinity));
    return list;
  }, [o, q, os, sort]);

  return (
    <main className="page lib">
      <header className="page-head">
        <div>
          <h1 className="page-title">资料库</h1>
          <p className="muted">知识库里有哪些型号、每款资料到什么程度。参数都是资料原文；标“待审核”的原文标签可能错位，只供了解，不能直接引用。</p>
        </div>
        {o?.library && (
          <p className="lib-stats small">
            <span><b>{o.entries.length}</b> 个型号</span>
            <span><b>{o.library.documents}</b> 份文档</span>
            <span><b>{o.library.images}</b> 张图片</span>
            <span><b>{o.library.prices}</b> 条官方价格</span>
          </p>
        )}
      </header>
      {o?.isMock && <Alert tone="warning">当前是模拟资料，不是真实华为产品信息。</Alert>}
      {data.error && <Alert tone="danger" action={<button type="button" className="btn btn-sm" onClick={() => void data.reload()}>重试</button>}>{data.error}</Alert>}
      {!o && !data.error && <div className="skeleton skeleton-block" />}

      {o && (
        <>
          <div className="lib-filters">
            <input className="input" type="search" placeholder="搜型号或参数，如：Pro S、OLED、16 英寸、麒麟" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜索型号" />
            <div className="row" role="group" aria-label="系统">
              {(Object.keys(OS_FILTER) as OsFilter[]).map((k) => (
                <button key={k} type="button" className="chip" aria-pressed={os === k} onClick={() => setOs(k)}>{OS_FILTER[k]}</button>
              ))}
            </div>
            <div className="row" role="group" aria-label="排序与视图">
              <button type="button" className="chip" aria-pressed={sort === "price"} onClick={() => setSort(sort === "price" ? "default" : "price")}>价格从低到高</button>
              <button type="button" className="chip" aria-pressed={view === "table"} onClick={() => setView(view === "table" ? "cards" : "table")}>速查表</button>
            </div>
          </div>
          {entries.length === 0 ? (
            <EmptyState title="没有符合条件的型号">换个关键词，或者清空筛选。</EmptyState>
          ) : view === "table" ? (
            <QuickTable entries={entries} />
          ) : (
            <ul className="lib-cards">{entries.map((e) => <Card key={e.productId} e={e} />)}</ul>
          )}
          {o.library && <Search auth={auth} docs={o.library.general} entries={o.entries} />}
        </>
      )}
    </main>
  );
}
