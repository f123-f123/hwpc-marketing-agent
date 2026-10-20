import { useEffect, useMemo, useState } from "react";
import type { InstanceView, SessionSnapshot } from "@hwpc/contracts";
import { showroomSpace, type Hotspot } from "@hwpc/scenes";
import type { FeedbackInput } from "../api/client";
import { COMPLETION_LABEL } from "../lib/labels";
import { KEYS, readJson, writeJson } from "../lib/storage";
import { DEFAULT_VIEW, Panorama, isView, type View } from "../scenes/Panorama";
import { SceneTask } from "./SceneTask";
import { Badge, EmptyState, Icon, PanelHead } from "./ui";

export function ExperiencePanel({ snap, busy, active, onEnter, onClose, onActivity, onAction, onFeedback }: {
  snap: SessionSnapshot;
  busy: boolean;
  active: InstanceView | undefined;
  onEnter: (sceneId: string) => void;
  onClose: () => void;
  onActivity: (activity: "compare" | "plan") => void;
  onAction: (instanceId: string, actionId: string) => void;
  onFeedback: (input: FeedbackInput) => Promise<unknown>;
}) {
  // 视角只在本面板内变化：拖动时不会让整页重渲染；停下 300ms 后再写入本地。
  const [view, setView] = useState<View>(() => readJson(KEYS.view, isView) ?? DEFAULT_VIEW);
  useEffect(() => {
    const t = setTimeout(() => writeJson(KEYS.view, view), 300);
    return () => clearTimeout(t);
  }, [view]);

  const catalog = useMemo(() => snap.scenes.catalog.filter((c) => c.status === "active"), [snap.scenes.catalog]);
  const assigned = snap.plan.current?.scenes ?? [];
  const assignedIds = assigned.map((e) => e.sceneId);
  const instances = snap.scenes.instances;
  const space = useMemo(
    () => ({
      ...showroomSpace,
      hotspots: showroomSpace.hotspots.filter((h) => h.target.type !== "scene" || catalog.some((c) => c.sceneId === (h.target as { sceneId: string }).sceneId && c.integrity === "ok")),
    }),
    [catalog],
  );
  const doneIds = instances.filter((v) => v.instance.status === "active" && v.experience.completion === "walkthrough_completed").map((v) => v.instance.sceneId);
  const progressOf = (sceneId: string) =>
    instances.find((v) => v.instance.sceneId === sceneId && v.instance.status === "active" && (v.instance.mode === "exploratory" || v.instance.planVersion === snap.plan.current?.version))?.experience.completion;

  if (active) {
    return (
      <section className="panel" aria-label="场景任务">
        <SceneTask
          view={active}
          busy={busy}
          onClose={onClose}
          onAction={(id) => onAction(active.instance.instanceId, id)}
          onFeedback={(input) => onFeedback({ ...input, instanceId: active.instance.instanceId })}
        />
      </section>
    );
  }

  const ordered = [...catalog].sort((a, b) => Number(assignedIds.includes(b.sceneId)) - Number(assignedIds.includes(a.sceneId)));

  return (
    <section className="panel" aria-labelledby="experience-title">
      <PanelHead
        id="experience-title"
        title="场景体验"
        description="站在房间里环顾四周，点桌上的设备进入任务，亲手操作一遍。都是虚拟流程演示，走完不代表在你的设备上测试通过。"
        aside={assigned.length ? <Badge tone="primary">{assigned.length} 个方案任务</Badge> : <Badge>通用浏览</Badge>}
      />
      <Panorama
        space={space}
        view={view}
        onView={setView}
        onEnter={(h: Hotspot) => (h.target.type === "scene" ? onEnter(h.target.sceneId) : onActivity(h.target.activity))}
        recommendedSceneIds={assignedIds}
        doneSceneIds={doneIds}
      />

      <h3 className="subhead">任务直达</h3>
      {ordered.length === 0 ? (
        <EmptyState title="当前没有已注册的场景" />
      ) : (
        <ul className="tasks">
          {ordered.map((c) => {
            const usable = c.integrity === "ok";
            const inPlan = assignedIds.includes(c.sceneId);
            const progress = progressOf(c.sceneId);
            return (
              <li key={`${c.sceneId}@${c.version}`}>
                <button type="button" className="task" disabled={!usable} onClick={() => onEnter(c.sceneId)} title={usable ? undefined : "场景版本未锁定或内容校验失败"}>
                  <span className="task-main">
                    <strong>{c.title}</strong>
                    <span className="muted small">v{c.version}{!usable ? " · 版本未锁定，不可用" : ""}</span>
                  </span>
                  <span className="row">
                    {inPlan ? <Badge tone="primary">方案任务</Badge> : <Badge>通用说明</Badge>}
                    {progress && progress !== "not_started" && <Badge tone={progress === "walkthrough_completed" ? "success" : "neutral"}>{COMPLETION_LABEL[progress]}</Badge>}
                    <Icon name="right" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!snap.plan.current && <p className="muted small">生成个人方案后，适合你的任务会排在前面；现在的都是通用说明，不是个性化推荐。</p>}
    </section>
  );
}
