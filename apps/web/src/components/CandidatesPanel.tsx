import type { CandidateAssessment, SessionSnapshot } from "@hwpc/contracts";
import { OUTCOME_LABEL, OUTCOME_TONE } from "../lib/labels";
import { Alert, Badge, EmptyState, PanelHead } from "./ui";

type Row = CandidateAssessment["satisfied"][number] & { hard?: boolean };

const BUCKETS = [
  { key: "satisfied", label: "满足", tone: "success" },
  { key: "unmet", label: "不满足", tone: "danger" },
  { key: "compromises", label: "需要取舍", tone: "warning" },
  { key: "unknowns", label: "资料未确认（不算满足）", tone: "neutral" },
] as const;

function Criteria({ rows, tone }: { rows: Row[]; tone: string }) {
  return (
    <ul className={`criteria criteria-${tone}`}>
      {rows.map((r) => (
        <li key={r.criterionId}>
          <span>{r.text}{r.hard ? <Badge tone="primary">硬条件</Badge> : null}</span>
          {r.evidence.length > 0 && (
            <details className="evidence">
              <summary>资料依据（{r.evidence.length}）</summary>
              {r.evidence.map((e, i) => (
                <blockquote key={i}>
                  <cite>{e.source.title}</cite>
                  {e.excerpt && <p>{e.excerpt}</p>}
                </blockquote>
              ))}
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

export function CandidatesPanel({ snap, onTalk }: { snap: SessionSnapshot; onTalk: () => void }) {
  const plan = snap.plan.current;
  const candidates = plan?.candidates ?? snap.candidates.assessments;
  const roleOf = (id: string) => plan?.recommendation.byCandidate.find((r) => r.candidateId === id)?.role;

  return (
    <section className="panel" aria-labelledby="candidates-title">
      <PanelHead
        id="candidates-title"
        title="候选与取舍"
        description="每一条结论都要有资料依据；没有依据的放进“未确认”，不会当作满足。硬条件不满足，不能靠其他卖点抵消。"
        aside={candidates.length > 0 ? <span className="muted small">{candidates.length} 个候选{plan ? ` · 方案 v${plan.version}` : ""}</span> : undefined}
      />
      {snap.candidates.stale && !plan && <Alert tone="warning">这些评价基于旧版需求，顾问会在下一轮重新评估。</Alert>}

      {candidates.length === 0 ? (
        <EmptyState title="还没有有依据的候选" action={<button type="button" className="btn" onClick={onTalk}>继续沟通</button>}>
          先补充主要任务和预算，顾问会从资料库里找候选并逐条核对。
        </EmptyState>
      ) : (
        <div className="cands">
          {candidates.map((c) => {
            const role = roleOf(c.candidateId);
            return (
              <article key={c.candidateId} className={`cand${role === "recommended" ? " is-recommended" : ""}`}>
                <header className="cand-head">
                  <h3>{c.modelName}</h3>
                  <div className="row">
                    {role === "recommended" && <Badge tone="primary">方案首选</Badge>}
                    {role === "alternative" && <Badge>备选</Badge>}
                    <Badge tone={OUTCOME_TONE[c.overall] ?? "neutral"}>{OUTCOME_LABEL[c.overall]}</Badge>
                    {c.isMock && <Badge tone="warning">模拟资料</Badge>}
                  </div>
                </header>
                <p className="cand-reason">{c.comparisonReason}</p>
                {BUCKETS.map((b) => {
                  const rows = c[b.key] as Row[];
                  if (rows.length === 0) return null;
                  return (
                    <div className="cand-bucket" key={b.key}>
                      <h4>{b.label} <span className="muted">{rows.length}</span></h4>
                      <Criteria rows={rows} tone={b.tone} />
                    </div>
                  );
                })}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
