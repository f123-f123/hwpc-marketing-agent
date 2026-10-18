import { useMemo, useState } from "react";
import type { FactRecord, ImageRecord } from "@hwpc/contracts";
import type { AdvisorClient } from "../advisor/client";
import {
  DELIVERY_LABEL,
  ORIGIN_LABEL,
  PLATFORM_LABEL,
  RESOLUTION_LABEL,
  checkPlan,
  factLine,
  lookupFor,
  scopeText,
} from "../advisor/resolve";
import type { AdvisorSnapshot, InteractivePlan, WorkView } from "../advisor/types";
import { ExportPanel } from "./ExportPanel";

type Tab = "platform" | "interactive" | "evidence" | "export";

interface Props {
  sessionId: string;
  snap: AdvisorSnapshot;
  work: WorkView;
  client: AdvisorClient;
  busy: boolean;
  onSelectVersion: (v: number) => void;
  onRevise: (instruction: string) => void;
  onChangeRequirement: (note: string) => void;
}

export function WorkArea(props: Props) {
  const { work, snap } = props;
  const [tab, setTab] = useState<Tab>("platform");
  const [focus, setFocus] = useState<{ type: "fact" | "image" | "block"; id: string } | null>(null);
  const rv = work.result;
  const meta = work.meta;
  const hasInteractive = !!work.interactive;
  const ds = rv.verification.deliveryStatus;
  const lk = useMemo(() => lookupFor(rv), [rv]);

  const openEvidence = (f: { type: "fact" | "image" | "block"; id: string }) => {
    setFocus(f);
    setTab("evidence");
  };

  return (
    <section className="work" aria-label="作品区">
      <header className="work-head">
        <h2>作品</h2>
        <label className="ver-pick">
          版本
          <select value={work.version} onChange={(e) => props.onSelectVersion(Number(e.target.value))} aria-label="选择作品版本">
            {snap.versions.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version}{v.currentRequirement ? "（当前）" : "（历史）"}
              </option>
            ))}
          </select>
        </label>
        {/* 只对当前版本显示核验结论；历史版本显示失效说明，不沿用通过徽标。 */}
        {meta.currentRequirement ? (
          <span className={`tag ds-${ds}`}>核验：{DELIVERY_LABEL[ds]}</span>
        ) : (
          <span className="tag tag-stale">核验结论不适用于当前需求</span>
        )}
        {rv.isMock && <span className="tag tag-mock">MOCK 模拟内容</span>}
      </header>

      {!meta.currentRequirement && (
        <div className="alert alert-warn" role="status">
          <strong>这是历史版本。</strong>{meta.staleReason ?? "它不对应当前需求"}。以下内容仅供查看与对比，其核验结果不能当作当前版本的结论；不要发布。
        </div>
      )}
      {meta.currentRequirement && (ds === "blocked" || ds === "needs_confirmation") && (
        <div className="alert alert-error" role="alert">
          <strong>{DELIVERY_LABEL[ds]}。</strong>
          {rv.verification.pendingConfirmations.join("；") || "存在未解决的核验问题。"}
        </div>
      )}

      <details className="basis">
        <summary>本版本依据的需求（第 {meta.requirementVersion || "—"} 版）</summary>
        {work.basisSummary ? (
          <dl>
            {work.basisSummary.fields.map((f) => (
              <div key={f.key} className="req-row"><dt>{f.label}</dt><dd>{f.value}</dd></div>
            ))}
          </dl>
        ) : (
          <p className="muted small">后端未提供该版本对应的需求摘要。</p>
        )}
      </details>

      <div role="tablist" className="tabs" aria-label="作品内容类型">
        <TabBtn id="platform" cur={tab} set={setTab}>平台内容</TabBtn>
        <TabBtn id="interactive" cur={tab} set={setTab}>互动网页体验</TabBtn>
        <TabBtn id="evidence" cur={tab} set={setTab}>依据与核验</TabBtn>
        <TabBtn id="export" cur={tab} set={setTab}>导出</TabBtn>
      </div>

      {tab === "platform" && <PlatformContent work={work} snap={snap} client={props.client} lkFact={lk.fact} onOpen={openEvidence} />}
      {tab === "interactive" && (
        hasInteractive ? (
          <InteractiveView plan={work.interactive!} work={work} client={props.client} sessionId={props.sessionId} onOpen={openEvidence} onChangeRequirement={props.onChangeRequirement} busy={props.busy} />
        ) : (
          <div className="empty">
            <p>本版本没有互动网页。</p>
            <p className="muted small">你确认的交付形式不含互动网页，所以没有制作。若需要，请通过“修改需求”调整交付形式，重新确认后会生成新版本。</p>
          </div>
        )
      )}
      {tab === "evidence" && <EvidenceView work={work} snap={snap} client={props.client} sessionId={props.sessionId} focus={focus} onFocus={setFocus} />}
      {tab === "export" && <ExportPanel work={work} client={props.client} sessionId={props.sessionId} />}

      {meta.currentRequirement && snap.versions.at(-1)?.version === work.version && (
        <ReviseBox busy={props.busy} onRevise={props.onRevise} onChangeRequirement={props.onChangeRequirement} />
      )}
    </section>
  );
}

function TabBtn({ id, cur, set, children }: { id: Tab; cur: Tab; set: (t: Tab) => void; children: React.ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={cur === id} className={cur === id ? "on" : ""} onClick={() => set(id)}>
      {children}
    </button>
  );
}

/* ---------------- 平台内容 ---------------- */

function VImg({ client, sessionId, work, image, className }: { client: AdvisorClient; sessionId: string; work: WorkView; image: ImageRecord | undefined; className?: string }) {
  const url = image ? client.imageUrl(sessionId, work.version, image.imageId) : null;
  if (!image) return <div className="img-missing">图片记录缺失</div>;
  if (!url) return <div className="img-missing">此版本的图片暂不可访问（后端尚未提供按版本绑定的图片地址），为避免显示错误图片未加载。</div>;
  return <img className={className} src={url} alt={image.description} loading="lazy" />;
}

function PlatformContent({ work, snap, client, lkFact, onOpen }: { work: WorkView; snap: AdvisorSnapshot; client: AdvisorClient; lkFact: (id: string) => FactRecord | undefined; onOpen: (f: { type: "fact" | "image" | "block"; id: string }) => void }) {
  const rv = work.result;
  const a = rv.article;
  const lk = lookupFor(rv);
  const plan = rv.strategy.platformPlan;
  const imgCount = a.blocks.filter((b) => b.type === "image").length;
  return (
    <div className="platform" role="tabpanel">
      <p className="muted small">
        这是可用于<strong>{PLATFORM_LABEL[a.platform]}</strong>的图文内容（需自行发布）。点击“依据”查看每句话的资料出处与限制条件。
        结构：{plan.structure.join(" → ")}；图片 {imgCount} 张（建议 {plan.imageCount.min}–{plan.imageCount.max} 张）。
      </p>
      {imgCount < plan.imageCount.min && <p className="notice-inline">配图少于该平台建议数量，原因见“依据与核验”中的资料缺口。</p>}
      <article className="post">
        <h3>{a.title}</h3>
        {a.lead && <p className="lead">{a.lead}</p>}
        {a.blocks.map((b, i) =>
          b.type === "paragraph" ? (
            <div key={i} className="blk" data-block={i}>
              {b.heading && <h4>{b.heading}</h4>}
              <p>{b.text}</p>
              {b.factIds.map((id) => {
                const f = lkFact(id);
                return f ? (
                  <button key={id} type="button" className="link small" onClick={() => onOpen({ type: "fact", id })}>
                    依据：{f.field}{f.qualifiers.length ? "（有限制条件）" : ""}
                  </button>
                ) : (
                  <span key={id} className="tag tag-warn">依据缺失：{id}</span>
                );
              })}
            </div>
          ) : (
            <figure key={i} className="blk" data-block={i}>
              <VImg client={client} sessionId={snap.sessionId} work={work} image={lk.image(b.imageId)} />
              <figcaption>
                {b.caption}
                <small className="muted">　位置：{b.placementReason}</small>
                <button type="button" className="link small" onClick={() => onOpen({ type: "image", id: b.imageId })}>图片来源</button>
              </figcaption>
            </figure>
          ),
        )}
        <p className="cta"><strong>行动引导：</strong>{a.callToAction}</p>
        {a.tags.length > 0 && <p className="tags">{a.tags.join(" ")}</p>}
      </article>
    </div>
  );
}

/* ---------------- 互动网页（受控渲染） ---------------- */

function InteractiveView({ plan, work, client, sessionId, onOpen, onChangeRequirement, busy }: { plan: InteractivePlan; work: WorkView; client: AdvisorClient; sessionId: string; onOpen: (f: { type: "fact" | "image" | "block"; id: string }) => void; onChangeRequirement: (note: string) => void; busy: boolean }) {
  const rv = work.result;
  const lk = lookupFor(rv);
  const chk = useMemo(() => checkPlan(plan, rv), [plan, rv]);
  const entries: { id: string; label: string; kind: string }[] = [
    ...plan.scenes.map((s) => ({ id: s.stateId, label: s.label, kind: "场景" })),
    ...plan.claims.map((c) => ({ id: c.stateId, label: c.headline, kind: "卖点" })),
    ...(plan.compare ? [{ id: plan.compare.stateId, label: "型号差异", kind: "对比" }] : []),
  ].filter((e) => chk.renderable.has(e.id));
  const [cur, setCur] = useState<string | null>(entries[0]?.id ?? null);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const active = entries.find((e) => e.id === cur) ?? entries[0];

  const factItem = (f: FactRecord) => (
    <li key={f.factId} className="fact-item">
      <div>
        <strong>{f.field}</strong>：{f.value}
        {f.qualifiers.length > 0 && <small className="q">限制：{f.qualifiers.join("；")}</small>}
      </div>
      <button type="button" className="link small" onClick={() => onOpen({ type: "fact", id: f.factId })}>查看原文依据</button>
    </li>
  );

  const body = () => {
    if (!active) return null;
    const scene = plan.scenes.find((s) => s.stateId === active.id);
    if (scene) {
      return (
        <>
          <p>{scene.why}</p>
          <ul className="facts">{[...new Set(scene.items.flatMap((i) => i.factIds))].map((id) => lk.fact(id)).filter((f): f is FactRecord => !!f).map(factItem)}</ul>
          <div className="imgs">{scene.items.flatMap((i) => (i.imageId ? [i.imageId] : [])).map((id) => <ImgWithSource key={id} id={id} work={work} client={client} sessionId={sessionId} onOpen={onOpen} />)}</div>
        </>
      );
    }
    const claim = plan.claims.find((c) => c.stateId === active.id);
    if (claim) {
      return (
        <>
          <ul className="facts">{claim.factIds.map((id) => lk.fact(id)).filter((f): f is FactRecord => !!f).map(factItem)}</ul>
          <div className="imgs">{claim.imageIds.map((id) => <ImgWithSource key={id} id={id} work={work} client={client} sessionId={sessionId} onOpen={onOpen} />)}</div>
        </>
      );
    }
    if (plan.compare && plan.compare.stateId === active.id) {
      const c = plan.compare;
      return (
        <table className="compare">
          <thead>
            <tr><th scope="col"><span className="sr-only">项目</span></th>{c.productIds.map((id) => <th key={id} scope="col">{rv.materialPack.products.find((p) => p.productId === id)?.model ?? id}</th>)}</tr>
          </thead>
          <tbody>
            {c.rows.map((r) => (
              <tr key={r.rowId}>
                <th scope="row">{r.label}</th>
                {r.cells.map((cell) =>
                  cell.factIds.length === 0 ? (
                    <td key={cell.productId} className="unknown">资料未提供，不视为满足</td>
                  ) : (
                    <td key={cell.productId}>
                      {cell.factIds.map((id) => lk.fact(id)).filter((f): f is FactRecord => !!f).map((f) => (
                        <div key={f.factId}>
                          {f.value}
                          {f.qualifiers.length > 0 && <small className="q">{f.qualifiers.join("；")}</small>}
                          <button type="button" className="link small" onClick={() => onOpen({ type: "fact", id: f.factId })}>依据</button>
                        </div>
                      ))}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    return null;
  };

  return (
    <div className="interactive" role="tabpanel">
      <div className="alert alert-info">
        <strong>互动网页体验</strong>：{plan.deliverableBasis}。这不是平台可直接发布的图文；页面内每个状态都来自当前版本已核验的资料。
      </div>
      <h3>{plan.title}</h3>
      <p>{plan.intro}</p>
      {chk.blocked.length > 0 && (
        <div className="alert alert-warn" role="status">
          有 {chk.blocked.length} 个互动状态因未核验或引用缺失未显示：{chk.blocked.map((b) => `${b.stateId}（${b.reason}）`).join("；")}
        </div>
      )}
      <div className="itabs" role="tablist" aria-label="互动内容">
        {entries.map((e) => (
          <button key={e.id} type="button" role="tab" aria-selected={active?.id === e.id} className={active?.id === e.id ? "on" : ""} onClick={() => setCur(e.id)}>
            <small>{e.kind}</small> {e.label}
          </button>
        ))}
      </div>
      <div className="ipanel" role="tabpanel">{body()}</div>

      <div className="change-req">
        {asking ? (
          <div>
            <label htmlFor="chg">想改变什么？（如换成只看 Air 16）</label>
            <textarea id="chg" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="row">
              <button type="button" className="btn primary" disabled={busy || !note.trim()} onClick={() => (onChangeRequirement(note.trim()), setAsking(false), setNote(""))}>回到需求沟通</button>
              <button type="button" className="btn" onClick={() => setAsking(false)}>取消</button>
            </div>
            <p className="muted small">网页里不会悄悄改动已确认的需求。这会回到对话，生成新的摘要等你确认。</p>
          </div>
        ) : (
          <button type="button" className="btn" onClick={() => setAsking(true)}>我想改选购目标或产品范围</button>
        )}
      </div>
    </div>
  );
}

function ImgWithSource({ id, work, client, sessionId, onOpen }: { id: string; work: WorkView; client: AdvisorClient; sessionId: string; onOpen: (f: { type: "fact" | "image" | "block"; id: string }) => void }) {
  const im = lookupFor(work.result).image(id);
  return (
    <figure>
      <VImg client={client} sessionId={sessionId} work={work} image={im} />
      <figcaption>
        {im?.description}
        <button type="button" className="link small" onClick={() => onOpen({ type: "image", id })}>图片来源</button>
      </figcaption>
    </figure>
  );
}

/* ---------------- 依据与核验 ---------------- */

function EvidenceView({ work, snap, client, sessionId, focus, onFocus }: { work: WorkView; snap: AdvisorSnapshot; client: AdvisorClient; sessionId: string; focus: { type: "fact" | "image" | "block"; id: string } | null; onFocus: (f: { type: "fact" | "image" | "block"; id: string } | null) => void }) {
  const rv = work.result;
  const ver = rv.verification;
  const lk = lookupFor(rv);
  const used = new Set(rv.article.blocks.flatMap((b) => (b.type === "paragraph" ? b.factIds : [])));
  const usedImgs = rv.article.blocks.flatMap((b) => (b.type === "image" ? [b.imageId] : []));
  const isCurrent = work.meta.currentRequirement;
  const group = (res: (typeof ver.findings)[number]["resolution"][]) => ver.findings.filter((f) => res.includes(f.resolution));
  const buckets: [string, string, ReturnType<typeof group>][] = [
    ["blocked", "阻止交付", ver.findings.filter((f) => f.severity === "blocker" && f.resolution !== "passed")],
    ["pending", "待确认", ver.findings.filter((f) => f.resolution === "pending_user" && f.severity !== "blocker")],
    ["fixed", "已修复（删除或改写）", group(["removed", "rewritten"])],
    ["flagged", "已保留并标注限制", group(["flagged"])],
    ["passed", "已通过", group(["passed"])],
  ];
  const locate = (f: (typeof ver.findings)[number]) => {
    if (f.blockIndex !== undefined) {
      document.querySelector(`[data-block="${f.blockIndex}"]`)?.scrollIntoView?.({ block: "center" });
    }
    if (f.factIds[0]) onFocus({ type: "fact", id: f.factIds[0] });
    else if (f.imageIds[0]) onFocus({ type: "image", id: f.imageIds[0] });
  };
  const fFact = focus?.type === "fact" ? lk.fact(focus.id) : undefined;
  const fImg = focus?.type === "image" ? lk.image(focus.id) : undefined;

  return (
    <div className="evidence" role="tabpanel">
      <div className="ev-source">
        <p className="muted small">
          资料来源：{rv.materialPack.origins.map((o) => ORIGIN_LABEL[o]).join("、")}；模型：{snap.backend.modelSimulated ? "模拟（未调用真实模型）" : "真实模型"}。
        </p>
      </div>

      {focus && (fFact || fImg) && (
        <aside className="focus-card" aria-label="依据详情">
          <button type="button" className="link small" onClick={() => onFocus(null)}>关闭</button>
          {fFact && (
            <>
              <h3>原文依据</h3>
              <p><strong>{fFact.field}</strong>：{fFact.value}</p>
              <p>适用：{scopeText(rv, fFact.productId, fFact.configurationIds)}</p>
              {fFact.qualifiers.length > 0 ? <p className="q-block">限制条件：{fFact.qualifiers.join("；")}</p> : <p className="muted small">资料未标注限制条件。</p>}
              <p>来源：《{fFact.source.title}》 <span className="tag tag-mock">{ORIGIN_LABEL[fFact.source.origin]}</span></p>
              <p className="muted small">定位：{fFact.source.locator}{fFact.source.capturedAt ? `；资料日期：${fFact.source.capturedAt}` : ""}</p>
              <p className="muted small">状态：{fFact.reviewStatus === "verified" ? "资料已核验" : "资料待复核"}</p>
            </>
          )}
          {fImg && (
            <>
              <h3>图片来源</h3>
              <VImg client={client} sessionId={sessionId} work={work} image={fImg} className="thumb" />
              <p>{fImg.description}</p>
              <p>适用：{scopeText(rv, fImg.productId, fImg.configurationIds)}</p>
              <p>来源：《{fImg.source.title}》 <span className="tag tag-mock">{ORIGIN_LABEL[fImg.source.origin]}</span></p>
              <p className="muted small">定位：{fImg.source.locator}；访问方式：{fImg.access.kind === "mock_placeholder" ? "模拟占位图（无真实图像）" : fImg.access.kind}</p>
            </>
          )}
        </aside>
      )}

      <h3>核验结果 {!isCurrent && <span className="tag tag-stale">仅历史记录，不适用于当前需求</span>}</h3>
      {buckets.map(([key, title, list]) =>
        list.length ? (
          <div key={key} className={`bucket bucket-${key}`}>
            <h4>{title}（{list.length}）</h4>
            <ul>
              {list.map((f) => (
                <li key={f.findingId}>
                  <button type="button" className="link" onClick={() => locate(f)}>{f.message}</button>
                  <small className="muted">　{f.kind} · {RESOLUTION_LABEL[f.resolution]}{f.resolutionNote ? `：${f.resolutionNote}` : ""}</small>
                  {f.excerpt && <small className="muted">　原文：“{f.excerpt}”</small>}
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
      {ver.pendingConfirmations.length > 0 && (
        <div className="bucket bucket-pending">
          <h4>待人工确认</h4>
          <ul>{ver.pendingConfirmations.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      <h3>使用的事实（{used.size}）</h3>
      <ul className="used">
        {[...used].map((id) => {
          const f = lk.fact(id);
          return f ? (
            <li key={id}>
              <button type="button" className="link" onClick={() => onFocus({ type: "fact", id })}>{factLine(f)}</button>
            </li>
          ) : null;
        })}
      </ul>
      <h3>使用的图片（{usedImgs.length}）</h3>
      <ul className="used">
        {usedImgs.map((id) => (
          <li key={id}><button type="button" className="link" onClick={() => onFocus({ type: "image", id })}>{lk.image(id)?.description ?? id}</button></li>
        ))}
      </ul>
      {rv.materialPack.gaps.length > 0 && (
        <>
          <h3>资料缺口</h3>
          <ul>{rv.materialPack.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
        </>
      )}
      {rv.materialPack.conflicts.length > 0 && (
        <>
          <h3>资料冲突</h3>
          <ul>{rv.materialPack.conflicts.map((c) => <li key={c.conflictId}>{c.description}（{c.status === "unresolved" ? "未解决" : "用户已确认"}）</li>)}</ul>
        </>
      )}
    </div>
  );
}

/* ---------------- 修改 ---------------- */

function ReviseBox({ busy, onRevise, onChangeRequirement }: { busy: boolean; onRevise: (s: string) => void; onChangeRequirement: (s: string) => void }) {
  const [text, setText] = useState("");
  return (
    <form
      className="revise"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onRevise(text.trim());
        setText("");
      }}
    >
      <label htmlFor="rev">继续提出修改</label>
      <textarea id="rev" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="例如：语气更轻松；删掉某一段。内容层面的修改会生成新版本并重新核验" />
      <div className="row">
        <button type="submit" className="btn primary" disabled={busy || !text.trim()}>提交修改（生成新版本）</button>
        <button type="button" className="btn" disabled={busy || !text.trim()} onClick={() => (onChangeRequirement(text.trim()), setText(""))}>
          这会改变需求（人群/产品范围/渠道等）
        </button>
      </div>
      <p className="muted small">改变需求的修改会先回到对话，更新摘要并等你重新确认；现有作品保留为历史版本。</p>
    </form>
  );
}
