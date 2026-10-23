import { useState } from "react";
import type { InstanceView } from "@hwpc/contracts";

/**
 * 走完之后在本地再来一遍：按冻结定义里的状态机推进，不提交服务端、不改变已完成的体验记录。
 * 用于没有“断开 / 重来”动作的场景，让用户换个选择再试。
 */
export function useReplay(view: InstanceView, onAction: (actionId: string) => void) {
  const def = view.definition;
  const [state, setState] = useState<string | null>(null);
  const finished = def.states.find((s) => s.stateId === view.experience.currentStateId)?.terminal ?? false;
  return {
    /** 当前用来渲染的状态：重玩时是本地状态，否则是服务端状态。 */
    current: state ?? view.experience.currentStateId,
    replaying: state !== null,
    canReplay: finished,
    act: (actionId: string) => {
      if (state === null) return onAction(actionId);
      const a = def.actions.find((x) => x.actionId === actionId && x.from.includes(state));
      if (a) setState(a.to);
    },
    start: () => setState(def.states.find((s) => s.initial)!.stateId),
    stop: () => setState(null),
  };
}

/** 舞台下方的重玩按钮：走完后出现；重玩时提示不会提交。 */
export function ReplayTools({ replay, disabled, onReset, label = "再过一遍" }: { replay: ReturnType<typeof useReplay>; disabled: boolean; onReset: () => void; label?: string }) {
  if (!replay.canReplay) return null;
  const restart = () => { replay.start(); onReset(); };
  return (
    <span className="row">
      {replay.replaying && <span className="muted small">本地重玩：不提交，也不改变已完成的记录。</span>}
      <button type="button" className="btn btn-sm" disabled={disabled} onClick={restart}>{label}</button>
      {replay.replaying && <button type="button" className="btn btn-sm btn-ghost" onClick={() => { replay.stop(); onReset(); }}>结束重玩</button>}
    </span>
  );
}
