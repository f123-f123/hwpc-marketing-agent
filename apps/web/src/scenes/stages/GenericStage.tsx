import { StageCoach, type StageProps } from "./devices";

/** 没有专属渲染器的场景：按声明的状态机列出步骤和当前可做的操作。 */
export function GenericStage({ view, disabled, onAction }: StageProps) {
  const { definition: def, experience } = view;
  const current = def.states.find((s) => s.stateId === experience.currentStateId);
  const available = def.actions.filter((a) => a.from.includes(experience.currentStateId));
  const index = def.states.findIndex((s) => s.stateId === experience.currentStateId);
  const steps = def.states.filter((s) => !s.initial).map((s) => s.label);
  return (
    <div className="stage-wrap">
      <StageCoach steps={steps} step={current?.terminal ? steps.length : Math.max(0, index)} text={current?.label ?? experience.currentStateId} detail={current?.description} />
      <div className="scene-stage">
        {available.length > 0 ? (
          <div className="row">
            {available.map((a, i) => (
              <button key={a.actionId} type="button" className={i === 0 ? "btn btn-primary" : "btn"} disabled={disabled} onClick={() => onAction(a.actionId)}>
                {a.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="muted small">{current?.terminal ? "流程已走完。" : "当前步骤没有可执行的操作。"}</p>
        )}
      </div>
    </div>
  );
}
