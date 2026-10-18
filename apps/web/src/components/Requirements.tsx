import { useState } from "react";
import type { SummaryEdit } from "../advisor/client";
import type { AdvisorSnapshot, CandidateProduct, MaterialGap, Provenance, RequirementKey, RequirementSummary } from "../advisor/types";
import { ORIGIN_LABEL } from "../advisor/resolve";

export const PROVENANCE: Record<Provenance, { label: string; cls: string }> = {
  user_said: { label: "你已表达", cls: "prov-user" },
  system_suggested: { label: "系统建议", cls: "prov-sys" },
  assumed_default: { label: "采用的默认假设", cls: "prov-default" },
  pending: { label: "待确认", cls: "prov-pending" },
};

export function ProvTag({ p }: { p: Provenance }) {
  const v = PROVENANCE[p];
  return <span className={`tag ${v.cls}`}>{v.label}</span>;
}

export function RequirementPanel({ snap }: { snap: AdvisorSnapshot }) {
  const reqs = snap.requirements;
  const groups: [Provenance, string][] = [
    ["user_said", "你已表达"],
    ["system_suggested", "系统建议"],
    ["assumed_default", "采用的默认假设"],
    ["pending", "待确认"],
  ];
  return (
    <section className="card" aria-label="需求记录">
      <h2>需求记录</h2>
      {groups.map(([p, title]) => {
        const items = reqs.filter((r) => r.provenance === p);
        if (!items.length) return null;
        return (
          <div key={p} className="req-group">
            <h3><ProvTag p={p} /> <span className="sr-only">{title}</span></h3>
            <dl>
              {items.map((r) => (
                <div key={r.key} className="req-row">
                  <dt>{r.label}</dt>
                  <dd>
                    {r.value ?? <span className="muted">还没确定</span>}
                    {r.basis && <small className="muted"> · {r.basis}</small>}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </section>
  );
}

const HANDLING: Record<MaterialGap["handling"], string> = {
  default_applied: "已按默认处理",
  needs_decision: "需要你决定",
  blocking: "阻塞，需先解决",
};

export function EvidencePanel({ snap }: { snap: AdvisorSnapshot }) {
  if (!snap.candidates.length && !snap.gaps.length) return null;
  return (
    <section className="card" aria-label="候选与资料摘要">
      <h2>候选产品与资料</h2>
      <div className="cands">
        {snap.candidates.map((c) => (
          <Candidate key={c.candidateId} c={c} />
        ))}
      </div>
      {snap.gaps.length > 0 && (
        <div className="gaps">
          <h3>资料缺口</h3>
          <p className="muted small">这些是资料本身的情况，不需要你填写产品参数。</p>
          <ul>
            {snap.gaps.map((g) => (
              <li key={g.gapId} className={`gap gap-${g.handling}`}>
                <strong>{g.text}</strong>
                <span className={`tag ${g.handling === "default_applied" ? "tag-ok" : "tag-warn"}`}>{HANDLING[g.handling]}</span>
                <div className="muted small">影响：{g.impact}{g.note ? `；${g.note}` : ""}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Candidate({ c }: { c: CandidateProduct }) {
  return (
    <article className="cand">
      <header>
        <h3>{c.model}</h3>
        <span className="tag tag-mock">{ORIGIN_LABEL[c.origin]}</span>
      </header>
      <p>{c.fit}</p>
      <ul className="ev">
        {c.evidence.map((e, i) => (
          <li key={i} className={`ev-${e.status}`}>
            <span className="ev-mark" aria-hidden>{e.status === "supported" ? "✓" : e.status === "conflict" ? "≠" : "?"}</span>
            <span>
              <span className="sr-only">{e.status === "supported" ? "有依据：" : e.status === "conflict" ? "来源冲突：" : "资料未提供："}</span>
              {e.claim}
              {e.qualifiers.length > 0 && <small className="muted">　{e.qualifiers.join("；")}</small>}
              {e.sourceTitle && <small className="muted">　来源：{e.sourceTitle}</small>}
            </span>
          </li>
        ))}
      </ul>
      {c.unknowns.length > 0 && <p className="unknowns"><strong>未知项（不视为满足）：</strong>{c.unknowns.join("、")}</p>}
    </article>
  );
}

/* ---------------- 摘要确认 ---------------- */

interface SummaryProps {
  summary: RequirementSummary;
  busy: boolean;
  onConfirm: () => void;
  onRevise: (edits: SummaryEdit[]) => void;
  onContinue: () => void;
}

export function SummaryCard({ summary, busy, onConfirm, onRevise, onContinue }: SummaryProps) {
  const [editing, setEditing] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const blocked = summary.blockers.length > 0;
  const startEdit = () => {
    setVals(Object.fromEntries(summary.fields.map((f) => [f.key, f.value])));
    setEditing(true);
  };
  const save = () => {
    const edits: SummaryEdit[] = summary.fields
      .filter((f) => (vals[f.key] ?? f.value).trim() && vals[f.key] !== f.value)
      .map((f) => ({ key: f.key as RequirementKey, value: vals[f.key]!.trim() }));
    if (!edits.length) return setEditing(false);
    onRevise(edits);
    setEditing(false);
  };
  return (
    <section className="card summary" aria-label={`待确认的需求摘要，第 ${summary.requirementVersion} 版`}>
      <header className="summary-head">
        <h2>请确认这版需求</h2>
        <span className="tag tag-ver">需求第 {summary.requirementVersion} 版</span>
      </header>
      <p className="muted small">确认前不会制作任何内容。确认的是这一版：如果期间需求有新版本，旧的确认会被拒绝。</p>
      {summary.affected && summary.affected.length > 0 && (
        <p className="notice-inline" role="status">相对上一版有变化：{summary.affected.join("、")}</p>
      )}
      <dl className="summary-list">
        {summary.fields.map((f) => (
          <div key={f.key} className={`req-row ${f.changed ? "changed" : ""}`}>
            <dt>{f.label}</dt>
            <dd>
              {editing ? (
                <input aria-label={f.label} value={vals[f.key] ?? f.value} onChange={(e) => setVals((p) => ({ ...p, [f.key]: e.target.value }))} />
              ) : (
                <span>{f.value}</span>
              )}
              <ProvTag p={f.provenance} />
              {f.changed && <span className="tag tag-warn">已变化</span>}
            </dd>
          </div>
        ))}
      </dl>
      {summary.defaults.length > 0 && (
        <div className="sub">
          <h3>采用的默认假设</h3>
          <ul>{summary.defaults.map((d) => <li key={d}>{d}</li>)}</ul>
        </div>
      )}
      <div className="sub">
        <h3>限制</h3>
        <ul>{summary.limitations.map((d) => <li key={d}>{d}</li>)}</ul>
      </div>
      {blocked && (
        <div className="alert alert-error" role="alert">
          <strong>暂时不能开始制作：</strong>
          <ul>{summary.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          <p>请修改需求或继续讨论，解决后会出现新的摘要。</p>
        </div>
      )}
      <div className="row actions">
        {editing ? (
          <>
            <button type="button" className="btn primary" onClick={save} disabled={busy}>保存修改并生成新摘要</button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>取消</button>
          </>
        ) : (
          <>
            <button type="button" className="btn primary" onClick={onConfirm} disabled={busy || blocked}>确认这版需求并开始制作</button>
            <button type="button" className="btn" onClick={startEdit} disabled={busy}>修改需求</button>
            <button type="button" className="btn" onClick={onContinue} disabled={busy}>继续讨论</button>
          </>
        )}
      </div>
    </section>
  );
}
