import { useMemo, useState } from "react";
import {
  applyEntry,
  buildView,
  replay,
  type HistoryEntry,
  type SceneConfig,
  type SceneDefinition,
  type SceneRun,
  type SceneView,
} from "@hwpc/scenes";

/**
 * 局部任务渲染器：工作台与导出的个人 HTML 共用同一个组件和同一套引擎。
 * 组件自己不判断业务：可用动作、条件与结果全部来自引擎的 SceneView。
 * 没有任何计时器：画面只因用户操作而变化。
 */

export interface RunnerProps {
  def: SceneDefinition;
  config: SceneConfig;
  /** 受控：由外层保存历史（用于返回、刷新、重开后恢复）。 */
  history: HistoryEntry[];
  onHistory: (h: HistoryEntry[]) => void;
  /** 外层提供的"回到方案 / 回到空间"入口。 */
  onExit?: { label: string; run: () => void };
  /** 反馈入口由外层决定是否提供（离线页面没有后端）。 */
  renderFeedback?: (view: SceneView) => React.ReactNode;
  restoreNote?: string;
}

const TONE_LABEL: Record<string, string> = { info: "提示", success: "结果", warn: "注意", error: "未完成" };
const COND_MARK = { met: "✓", unmet: "✗", unknown: "?", pending: "…" } as const;
const COND_TEXT = { met: "满足", unmet: "不满足", unknown: "资料未证实", pending: "待选择设备" } as const;

export function useRun(def: SceneDefinition, config: SceneConfig, history: HistoryEntry[]): { run: SceneRun; view: SceneView; error?: string } {
  return useMemo(() => {
    const r = replay(def, config, history);
    return { run: r.run, view: buildView(def, config, r.run), error: r.error };
  }, [def, config, history]);
}

export function SceneRunner({ def, config, history, onHistory, onExit, renderFeedback, restoreNote }: RunnerProps) {
  const { run, view, error } = useRun(def, config, history);
  const [refused, setRefused] = useState<string | null>(null);

  const push = (e: HistoryEntry) => {
    const r = applyEntry(def, config, run, e);
    if (!r.ok) {
      setRefused(r.reason ?? "这一步现在不能执行");
      return;
    }
    setRefused(null);
    onHistory(r.run.history);
  };
  const reset = () => {
    setRefused(null);
    onHistory([]);
  };

  return (
    <section className="scene" aria-label={`局部任务：${view.title}`}>
      <header className="scene-head">
        <div>
          <h3>{view.title}</h3>
          <p className="muted small">任务：{view.task}　·　场景版本 v{view.version}</p>
        </div>
        <div className="row">
          {onExit && <button type="button" className="btn" onClick={onExit.run}>{onExit.label}</button>}
          <button type="button" className="btn" onClick={reset} disabled={history.length === 0}>重新开始</button>
        </div>
      </header>

      <div className={`demo-badge demo-${view.demo.type}`} role="note">
        <strong>{view.demo.label}</strong>
        <span>{view.demo.boundary}</span>
        <span className="muted small">{view.demo.scopeNote}</span>
      </div>
      {restoreNote && <p className="notice-inline" role="status">{restoreNote}</p>}
      {error && <p className="alert alert-error" role="alert">保存的进度与当前场景不兼容，已回到可重放的最后一步：{error}</p>}

      <div className="scene-grid">
        <div className="scene-left">
          <h4>1. 选择设备</h4>
          {view.roles.map((r) => (
            <fieldset key={r.roleId} className="role">
              <legend>{r.label}</legend>
              <div className="options">
                {r.options.map((o) => (
                  <button
                    key={o.bindingId}
                    type="button"
                    role="radio"
                    aria-checked={r.chosen === o.bindingId}
                    className={`chip ${r.chosen === o.bindingId ? "on" : ""}`}
                    onClick={() => push({ type: "bind", roleId: r.roleId, bindingId: o.bindingId })}
                  >
                    {o.label}
                    <small>{o.sourceLabel}</small>
                  </button>
                ))}
              </div>
            </fieldset>
          ))}

          <h4>2. 前提条件</h4>
          <ul className="conds">
            {view.conditions.map((c) => (
              <li key={c.condId} className={`cond cond-${c.status}`}>
                <span className="cond-mark" aria-hidden>{COND_MARK[c.status]}</span>
                <span>
                  <strong>{c.label}</strong>：{COND_TEXT[c.status]}
                  {c.missing && <small className="q">{c.missing}</small>}
                  {c.nextStep && <small className="muted">下一步：{c.nextStep}</small>}
                  {c.evidenceTitles && c.evidenceTitles.length > 0 && <small className="muted">依据：{c.evidenceTitles.join("；")}</small>}
                </span>
              </li>
            ))}
          </ul>

          <h4>3. 操作</h4>
          <ol className="steps" aria-label="步骤进度">
            {view.steps.map((s) => <li key={s.stepId} className={s.done ? "done" : ""}>{s.done ? "✓ " : ""}{s.label}</li>)}
          </ol>
          <div className="acts">
            {view.actions.map((a) => (
              <div key={a.actionId} className="act">
                {a.options ? (
                  <div className="row">
                    <span className="act-label">{a.label}</span>
                    {a.options.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        className="btn"
                        disabled={!a.enabled}
                        aria-describedby={!a.enabled ? `why-${a.actionId}` : undefined}
                        onClick={() => push({ type: "act", actionId: a.actionId, param: o.value })}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <button type="button" className="btn primary" disabled={!a.enabled} aria-describedby={!a.enabled ? `why-${a.actionId}` : undefined} onClick={() => push({ type: "act", actionId: a.actionId })}>
                    {a.label}
                  </button>
                )}
                {a.hint && a.enabled && <small className="muted">{a.hint}</small>}
                {!a.enabled && a.blocked && (
                  <small id={`why-${a.actionId}`} className="q">
                    不可用：{a.blocked.reason}
                    {a.blocked.nextStep ? `　→ ${a.blocked.nextStep}` : ""}
                  </small>
                )}
              </div>
            ))}
          </div>
          {refused && <p className="alert alert-warn" role="alert">{refused}</p>}
        </div>

        <div className="scene-right">
          <h4>虚拟设备状态</h4>
          <p className="muted small">下面的状态是虚拟的，与你的真实设备无关。</p>
          <div className="stage" aria-live="polite">
            {view.stage.screens.map((s) => (
              <div key={s.screenId} className={`screen screen-${s.screenId}`}>
                <div className="screen-title">{s.label}</div>
                <ul>
                  {s.items.map((i) => <li key={i.itemId} className={`it it-${i.tone}`}>{i.label}</li>)}
                </ul>
                {s.notes.map((n) => <p key={n} className="screen-note">{n}</p>)}
              </div>
            ))}
          </div>
          {view.env.length > 0 && <p className="muted small">虚拟条件：{view.env.map((e) => `${e.label}=${e.value === "ample" ? "充足" : e.value === "low" ? "不足" : e.value}`).join("；")}</p>}

          {view.feedback.length > 0 && (
            <div className="fb" role="status">
              {view.feedback.map((f, i) => <p key={i} className={`fb-${f.tone}`}><strong>{TONE_LABEL[f.tone] ?? "提示"}：</strong>{f.text}</p>)}
            </div>
          )}

          <div className={`outcome outcome-${view.outcome.kind}`} role="status">
            <h4>{view.outcome.title}</h4>
            <p>{view.outcome.text}</p>
            {view.outcome.nextSteps.length > 0 && (
              <>
                <p className="small"><strong>可行的下一步</strong></p>
                <ul>{view.outcome.nextSteps.map((n) => <li key={n}>{n}</li>)}</ul>
              </>
            )}
            {view.outcome.checklist.length > 0 && (
              <>
                <p className="small"><strong>真实使用时请自行核验</strong></p>
                <ul>{view.outcome.checklist.map((n) => <li key={n}>{n}</li>)}</ul>
              </>
            )}
          </div>
          {renderFeedback?.(view)}
        </div>
      </div>

      <details className="scene-sources">
        <summary>设计依据、证据与素材来源</summary>
        <h5>流程设计依据（用于流程结构与失败分支，不是产品功能结论）</h5>
        <ul>
          {view.sources.designBasis.map((d) => (
            <li key={d.basisId}>
              《{d.title}》<span className="tag tag-mock">{d.origin === "local" ? "本地资料" : "ima"}</span>
              <small className="muted">　{d.supports}{d.note ? `；${d.note}` : ""}</small>
            </li>
          ))}
        </ul>
        <h5>当前所选设备的能力证据</h5>
        {view.sources.evidence.length === 0 ? <p className="muted small">尚未选择设备。</p> : (
          <ul>{view.sources.evidence.map((e) => <li key={e.evidenceId}>{e.title}<small className="muted">　层级：{e.level}；来源：{e.origin}</small></li>)}</ul>
        )}
        <h5>素材</h5>
        <ul>{view.sources.assets.map((a) => <li key={a.assetId}>{a.usage}（{a.origin}；{a.isProductImage ? "产品图片" : "示意素材，不是产品图片，也不是真实门店或实机画面"}）</li>)}</ul>
      </details>
    </section>
  );
}
