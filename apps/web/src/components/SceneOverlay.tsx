import { useEffect } from "react";
import type { InstanceView } from "@hwpc/contracts";
import type { FeedbackInput } from "../api/client";
import { SceneTask } from "./SceneTask";

/** 场景任务叠在当前页面之上；关掉后回到原来的位置（体验页的滚动位置不变）。 */
export function SceneOverlay({ view, busy, onClose, onAction, onFeedback }: {
  view: InstanceView;
  busy: boolean;
  onClose: () => void;
  onAction: (instanceId: string, actionId: string) => void;
  onFeedback: (input: FeedbackInput) => Promise<unknown>;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.documentElement.classList.add("has-overlay");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("has-overlay");
    };
  }, [onClose]);

  return (
    <div className="scene-overlay" role="dialog" aria-modal="true" aria-label={view.title}>
      <div className="scene-overlay-inner">
        <SceneTask
          view={view}
          busy={busy}
          onClose={onClose}
          onAction={(id) => onAction(view.instance.instanceId, id)}
          onFeedback={(input) => onFeedback({ ...input, instanceId: view.instance.instanceId })}
        />
      </div>
    </div>
  );
}
