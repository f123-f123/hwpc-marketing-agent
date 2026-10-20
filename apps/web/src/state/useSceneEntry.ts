import { useEffect, useState } from "react";
import type { SessionSnapshot } from "@hwpc/contracts";
import { KEYS, readJson, remove, writeJson } from "../lib/storage";
import type { SessionActions } from "./useSession";

interface SavedActive { sessionId: string; instanceId: string }
const isSavedActive = (v: unknown): v is SavedActive =>
  typeof v === "object" && v !== null && typeof (v as SavedActive).sessionId === "string" && typeof (v as SavedActive).instanceId === "string";

/**
 * 打开场景任务（叠在当前页面之上）。刷新后回到正在做的任务。
 * 打开顺序：当前方案里的个人任务 → 已有的说明性实例 → 新建说明性实例。
 */
export function useSceneEntry(snap: SessionSnapshot, actions: SessionActions) {
  const [activeId, setActiveId] = useState<string | null>(() => {
    const saved = readJson(KEYS.activeInstance, isSavedActive);
    return saved?.sessionId === snap.sessionId ? saved.instanceId : null;
  });

  useEffect(() => {
    if (activeId) writeJson(KEYS.activeInstance, { sessionId: snap.sessionId, instanceId: activeId });
    else remove(KEYS.activeInstance);
  }, [activeId, snap.sessionId]);

  const instances = snap.scenes.instances;
  const active = instances.find((v) => v.instance.instanceId === activeId);
  const planVersion = snap.plan.current?.version;

  const enter = async (sceneId: string) => {
    const live = instances.filter((v) => v.instance.sceneId === sceneId && v.instance.status === "active");
    const existing = live.find((v) => v.instance.mode === "personal" && v.instance.planVersion === planVersion) ?? live.find((v) => v.instance.mode === "exploratory");
    if (existing) {
      setActiveId(existing.instance.instanceId);
      return;
    }
    const item = snap.scenes.catalog.find((c) => c.sceneId === sceneId && c.status === "active");
    if (!item || item.integrity !== "ok") {
      actions.fail("这个场景未注册、未锁定版本或已失效，暂时不能打开。");
      return;
    }
    const next = await actions.explore(item.sceneId, item.version);
    const created = next?.scenes.instances.find((v) => v.instance.sceneId === sceneId && v.instance.mode === "exploratory" && v.instance.status === "active");
    if (created) setActiveId(created.instance.instanceId);
  };

  return { active, enter, open: (instanceId: string) => setActiveId(instanceId), close: () => setActiveId(null) };
}
