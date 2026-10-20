import { useState } from "react";
import { validateSceneConfig, type FeedbackKind, type InstanceView } from "@hwpc/contracts";
import type { FeedbackInput } from "../api/client";
import { APPLICABILITY_LABEL, COMPLETION_LABEL } from "../lib/labels";
import { stageFor } from "../scenes/stages";
import { Alert, Badge, Icon } from "./ui";

const FEEDBACK_BUTTONS: [FeedbackKind, string][] = [
  ["concern", "提出顾虑"],
  ["new_need", "新增需求"],
  ["reject_scene", "不想体验这个场景"],
  ["note", "仅记录"],
];

export function SceneTask({ view, busy, onAction, onFeedback, onClose }: {
  view: InstanceView;
  busy: boolean;
  onAction: (actionId: string) => void;
  onFeedback: (input: Omit<FeedbackInput, "instanceId">) => Promise<unknown>;
  onClose: () => void;
}) {
  const { instance, definition: def, experience } = view;
  const [feedback, setFeedback] = useState("");
  const config = validateSceneConfig(def, instance.params);
  const active = instance.status === "active" && !view.invalidation && !view.registryDrift && config.ok;
  const openConditions = instance.applicability.openConditions.filter((c) => !instance.confirmedConditionKeys.includes(c.conditionKey));
  const reached = def.outcomes.filter((o) => experience.reachedOutcomeIds.includes(o.outcomeId));
  const configText = Object.entries(config.values).map(([k, v]) => `${def.configSchema.find((f) => f.key === k)?.label ?? k}：${String(v)}`);
  const Stage = stageFor(def);

  const submitFeedback = async (kind: FeedbackKind) => {
    const text = feedback.trim();
    if (!text) return;
    if (await onFeedback({ kind, text })) setFeedback("");
  };

  return (
    <article className="scene" aria-labelledby="scene-title">
      <header className="scene-head">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><Icon name="back" />返回空间</button>
        <div className="row">
          <Badge tone={instance.mode === "personal" ? "primary" : "neutral"}>{instance.mode === "personal" ? `个人方案 v${instance.planVersion}` : "通用说明"}</Badge>
          <Badge tone={experience.completion === "walkthrough_completed" ? "success" : "neutral"}>{COMPLETION_LABEL[experience.completion]}</Badge>
        </div>
      </header>

      <div>
        <h2 id="scene-title" className="scene-title">{view.title}</h2>
        <p className="scene-summary">{view.summary}</p>
      </div>

      <p className="scene-boundary"><Icon name="alert" /><span><strong>功能流程演示</strong>：{def.demoBoundary.statement}</span></p>

      {view.invalidation && <Alert tone="danger">场景版本已失效：{view.invalidation.reason}</Alert>}
      {view.registryDrift && <Alert tone="danger">场景内容与注册表不一致，操作已停用。</Alert>}
      {!config.ok && <Alert tone="danger">保存的场景配置不合法：{config.errors.join("；")}</Alert>}
      {instance.status !== "active" && !view.invalidation && <Alert>该任务已不是当前方案的一部分{instance.invalidReason ? `：${instance.invalidReason}` : ""}。</Alert>}
      {view.knowledgeScope === "outside_pc_knowledge_base" && <Alert tone="warning">此任务超出 PC 知识库范围，相关设备事实未经该库核实。</Alert>}
      {instance.applicability.isMock && <Alert tone="warning">此场景包含模拟资料或设备，虚拟成功不能作为实机证据。</Alert>}

      <Stage key={instance.instanceId} view={view} disabled={busy || !active} onAction={onAction} />

      {reached.map((o) => (
        <Alert key={o.outcomeId} tone="success"><strong>{o.label}：</strong>{o.statement}</Alert>
      ))}

      <section className="scene-applicability" aria-label="适用性">
        <p><strong>{APPLICABILITY_LABEL[instance.applicability.result]}</strong>{instance.applicability.reasons.length > 0 && <span className="muted">　{instance.applicability.reasons.map((r) => r.text).join("；")}</span>}</p>
        {openConditions.length > 0 && (
          <div className="stack">
            <p className="small">以下条件需要你确认（你的自述，不是设备检测）：</p>
            <div className="row">
              {openConditions.map((c) => (
                <button key={c.conditionKey} type="button" className="btn btn-sm" disabled={busy}
                  onClick={() => void onFeedback({ kind: "confirm_condition", text: `我已满足：${c.text}`, conditionKey: c.conditionKey })}>
                  <Icon name="check" />我已满足：{c.text}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <details className="scene-more">
        <summary>依据与说明</summary>
        {def.evidence.length > 0 && (
          <ul className="small">
            {def.evidence.map((e, i) => <li key={i}>流程依据：{e.source.title}</li>)}
          </ul>
        )}
        {configText.length > 0 && <p className="small">配置：{configText.join("；")}</p>}
        {view.caveats.length > 0 && <ul className="small muted">{view.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>}
      </details>

      <section className="scene-feedback" aria-labelledby="scene-feedback-title">
        <h3 id="scene-feedback-title">有想法？明确告诉顾问</h3>
        <p className="muted small">点击和完成任务不会改变你的需求，只有在这里提交的反馈才会进入方案评估。</p>
        <label className="sr-only" htmlFor="scene-feedback-input">反馈内容</label>
        <textarea id="scene-feedback-input" className="textarea" rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="例如：我更在意扩展屏的稳定性" />
        <div className="row">
          {FEEDBACK_BUTTONS.map(([kind, label]) => (
            <button key={kind} type="button" className="btn btn-sm" disabled={busy || !feedback.trim()} onClick={() => void submitFeedback(kind)}>{label}</button>
          ))}
        </div>
      </section>
    </article>
  );
}
