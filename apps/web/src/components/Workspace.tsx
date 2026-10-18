import { useEffect, useRef, useState } from "react";
import type { SessionSnapshot } from "@hwpc/contracts";
import { nextStep, tabMeta, type TabId } from "../lib/stage";
import { KEYS, readJson, remove, writeJson } from "../lib/storage";
import type { SessionActions } from "../state/useSession";
import { CandidatesPanel } from "./CandidatesPanel";
import { ChatPanel } from "./ChatPanel";
import { ExperiencePanel } from "./ExperiencePanel";
import { NeedsPanel } from "./NeedsPanel";
import { PlanPanel } from "./PlanPanel";

/** 与 app.css 的断点保持一致。 */
const NARROW = "(max-width: 960px)";

interface SavedActive { sessionId: string; instanceId: string }
const isSavedActive = (v: unknown): v is SavedActive =>
  typeof v === "object" && v !== null && typeof (v as SavedActive).sessionId === "string" && typeof (v as SavedActive).instanceId === "string";

/** 第一次进入时停在哪一页：有方案看方案；否则宽屏看需求摘要，窄屏先看对话。 */
function initialTab(s: SessionSnapshot): TabId {
  if (s.plan.current) return "plan";
  return window.matchMedia(NARROW).matches ? "talk" : "needs";
}

export function Workspace({ snap, busy, actions }: { snap: SessionSnapshot; busy: boolean; actions: SessionActions }) {
  const [tab, setTab] = useState<TabId>(() => initialTab(snap));
  const [activeId, setActiveId] = useState<string | null>(() => {
    const saved = readJson(KEYS.activeInstance, isSavedActive);
    return saved?.sessionId === snap.sessionId ? saved.instanceId : null;
  });
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeId) writeJson(KEYS.activeInstance, { sessionId: snap.sessionId, instanceId: activeId });
    else remove(KEYS.activeInstance);
  }, [activeId, snap.sessionId]);

  // 从窄屏拉宽时，“对话”页不再单独存在，切回需求页。
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const onChange = () => { if (!mq.matches) setTab((t) => (t === "talk" ? "needs" : t)); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const go = (next: TabId) => {
    // 宽屏下对话常驻左侧，“去对话”就是把光标放进输入框；窄屏下对话是单独一页。
    if (next === "talk" && !window.matchMedia(NARROW).matches) {
      document.getElementById("chat-input")?.focus();
      return;
    }
    setTab(next);
    content.current?.scrollTo({ top: 0 });
  };

  const instances = snap.scenes.instances;
  const active = instances.find((v) => v.instance.instanceId === activeId);
  const currentPlanVersion = snap.plan.current?.version;

  /** 打开场景：优先当前方案里的个人任务，其次已有的说明性实例，都没有才新建说明性实例。 */
  const enter = async (sceneId: string) => {
    go("experience");
    const live = instances.filter((v) => v.instance.sceneId === sceneId && v.instance.status === "active");
    const existing = live.find((v) => v.instance.mode === "personal" && v.instance.planVersion === currentPlanVersion) ?? live.find((v) => v.instance.mode === "exploratory");
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

  const step = nextStep(snap);
  const runStep = () => {
    switch (step.action) {
      case "resume": return void actions.resume();
      case "confirm": return void actions.confirm();
      case "compose": return void actions.compose().then((s) => { if (s?.plan.current) go("plan"); });
      case "experience": setActiveId(null); return go("experience");
      case "answer":
      case "talk": return go("talk");
    }
  };

  const meta = tabMeta(snap);

  return (
    <div className={`workspace tab-${tab}`}>
      <aside className="workspace-chat">
        <ChatPanel snap={snap} busy={busy} actions={actions} onOpenScene={(id) => void enter(id)} />
      </aside>

      <div className="workspace-main">
        <nav className="stage-tabs" aria-label="咨询进度">
          {meta.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`stage-tab${m.id === "talk" ? " stage-tab-talk" : ""}${tab === m.id ? " is-active" : ""}`}
              aria-current={tab === m.id ? "page" : undefined}
              onClick={() => go(m.id)}
            >
              <span className="stage-tab-label">{m.label}{m.attention && <span className="stage-dot" aria-label="需要处理" />}</span>
              <span className="stage-tab-hint">{m.hint}</span>
            </button>
          ))}
        </nav>

        <div className="workspace-content" ref={content}>
          <div className={`next-step next-step-${step.tone}`} role="status">
            <div>
              <p className="next-step-title">{step.title}</p>
              <p className="next-step-detail">{step.detail}</p>
            </div>
            <button type="button" className={step.tone === "neutral" ? "btn" : "btn btn-primary"} disabled={busy || !step.enabled} onClick={runStep}>
              {step.cta}
            </button>
          </div>

          {tab === "needs" && <NeedsPanel snap={snap} busy={busy} onCompose={() => void actions.compose().then((s) => { if (s?.plan.current) go("plan"); })} />}
          {tab === "candidates" && <CandidatesPanel snap={snap} onTalk={() => go("talk")} />}
          {tab === "experience" && (
            <ExperiencePanel
              snap={snap}
              busy={busy}
              active={active}
              onEnter={(id) => void enter(id)}
              onClose={() => setActiveId(null)}
              onActivity={(a) => go(a === "compare" ? "candidates" : "plan")}
              onAction={(instanceId, actionId) => void actions.action(instanceId, actionId)}
              onFeedback={actions.feedback}
            />
          )}
          {tab === "plan" && (
            <PlanPanel
              snap={snap}
              busy={busy}
              onCompose={() => void actions.compose()}
              onConfirmTab={() => go("needs")}
              onOpenInstance={(id) => { setActiveId(id); go("experience"); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
