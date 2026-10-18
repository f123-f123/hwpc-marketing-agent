import { getScene, FEEDBACK_LABEL, type FeedbackRecord, type HistoryEntry, type PersonalPlan, type PlanExperience, type PlanProgress, replay, buildView } from "@hwpc/scenes";
import { ORIGIN_LABEL } from "../advisor/resolve";

interface Props {
  plan: PersonalPlan;
  mode: "compare" | "plan";
  histories: Record<string, HistoryEntry[]>;
  feedback: FeedbackRecord[];
  onEnter: (e: PlanExperience) => void;
  onExport: () => void;
  onImport: () => void;
  storage: PlanProgress["storage"];
}

const PROV = { user_said: "你已表达", system_suggested: "系统建议", assumed_default: "采用的默认假设", pending: "待确认" } as const;
const STATUS = { supported: ["✓", "有依据"], unknown: ["?", "资料未提供"], conflict: ["≠", "来源冲突"] } as const;

export function outcomeOf(e: PlanExperience, h: HistoryEntry[] | undefined) {
  const def = getScene(e.sceneId, e.sceneVersion);
  if (!def || !h?.length) return null;
  const r = replay(def, e.config, h);
  return buildView(def, e.config, r.run).outcome;
}

export function PlanView({ plan, mode, histories, feedback, onEnter, onExport, onImport, storage }: Props) {
  const showCompare = mode === "compare";
  return (
    <div className="plan">
      <header className="plan-head">
        <h2>{showCompare ? "候选比较" : "个人方案"}</h2>
        <span className="tag tag-ver">方案 v{plan.planVersion}</span>
        <span className="tag tag-ver">需求第 {plan.requirementVersion} 版{plan.requirementConfirmed ? "（已确认）" : "（未确认）"}</span>
        {plan.isMock && <span className="tag tag-mock">MOCK 模拟内容</span>}
        <span className="tag tag-mock">资料：{ORIGIN_LABEL[plan.dataOrigin]}</span>
      </header>
      <ul className="plan-notices">{plan.notices.map((n) => <li key={n}>{n}</li>)}</ul>

      {!showCompare && (
        <>
          <section className="card flat" aria-label="需求与确认条件">
            <h3>你的需求与确认条件</h3>
            <dl>{plan.conditions.map((c) => <div key={c.label} className="req-row"><dt>{c.label}</dt><dd>{c.value}<span className={`tag prov-${c.provenance === "user_said" ? "user" : c.provenance === "system_suggested" ? "sys" : c.provenance === "assumed_default" ? "default" : "pending"}`}>{PROV[c.provenance]}</span></dd></div>)}</dl>
          </section>
        </>
      )}

      <section aria-label="候选产品">
        <h3>候选产品</h3>
        <div className="cands">
          {plan.candidates.map((c) => (
            <article key={c.candidateId} className="cand">
              <header><h4>{c.model}</h4><span className="tag tag-mock">{ORIGIN_LABEL[c.origin]}</span></header>
              <p><strong>适合原因：</strong>{c.fitReasons.join("；") || "—"}</p>
              <p><strong>不足：</strong>{c.shortfalls.join("；") || "资料里没有明确的不足"}</p>
              <ul className="ev">
                {c.evidence.map((e, i) => (
                  <li key={i} className={`ev-${e.status}`}>
                    <span className="ev-mark" aria-hidden>{STATUS[e.status][0]}</span>
                    <span><span className="sr-only">{STATUS[e.status][1]}：</span>{e.claim}{e.qualifiers.length > 0 && <small className="muted">　{e.qualifiers.join("；")}</small>}{e.sourceTitle && <small className="muted">　来源：{e.sourceTitle}</small>}</span>
                  </li>
                ))}
              </ul>
              {c.unknowns.length > 0 && <p className="unknowns"><strong>未知项（不视为满足）：</strong>{c.unknowns.join("、")}</p>}
            </article>
          ))}
        </div>
      </section>

      {!showCompare && (
        <>
          <section aria-label="推荐体验顺序">
            <h3>推荐体验顺序</h3>
            <ol className="exp-list">
              {plan.experiences.map((e) => {
                const def = getScene(e.sceneId, e.sceneVersion);
                const out = outcomeOf(e, histories[e.experienceId]);
                const started = (histories[e.experienceId]?.length ?? 0) > 0;
                return (
                  <li key={e.experienceId}>
                    <div>
                      <strong>{e.order}. {def?.title ?? e.sceneId}</strong>
                      <span className="tag tag-ver">场景 v{e.sceneVersion}</span>
                      <p className="small">{e.reason}</p>
                      <p className="small muted">
                        {!started ? "尚未开始" : out ? `当前结果：${out.title}（仅表示在虚拟设备上走到的状态，不代表你的真实设备）` : "已开始"}
                      </p>
                    </div>
                    <button type="button" className="btn primary" onClick={() => onEnter(e)}>{started ? "继续这个任务" : "开始体验"}</button>
                  </li>
                );
              })}
            </ol>
          </section>

          <section aria-label="反馈与待解决问题">
            <h3>你的明确反馈</h3>
            {feedback.length === 0 ? <p className="muted small">还没有。体验结束后可以告诉顾问你的想法。</p> : (
              <ul>{feedback.map((f) => <li key={f.event.feedbackId}>{FEEDBACK_LABEL[f.event.kind]}{f.event.note ? `：${f.event.note}` : ""}　<small className="muted">{f.status === "sent" ? "已送达后端" : f.status === "queued" ? "已记录，等待顾问评估" : "未送达（后端不支持）"}{f.ack ? `　${f.ack}` : ""}</small></li>)}</ul>
            )}
            <h3>待解决的问题</h3>
            <ul>{plan.openIssues.map((i) => <li key={i}>{i}</li>)}</ul>
          </section>

          <section className="card flat" aria-label="进度保存与分享">
            <h3>进度保存</h3>
            <p className="small">
              {storage === "server" ? "进度保存在服务端。" : storage === "browser_local" ? "进度只保存在本浏览器的本地缓存，不是服务端保存。" : "进度没有被保存。"}
              导出的文件是一份独立副本：它记录导出那一刻的进度，不会自动同步之后的修改，也不会同步到别的设备。
            </p>
            <div className="row">
              <button type="button" className="btn" onClick={onExport}>导出进度记录</button>
              <button type="button" className="btn" onClick={onImport}>导入进度记录</button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
