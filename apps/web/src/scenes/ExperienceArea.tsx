import { useMemo, useRef, useState } from "react";
import { FEEDBACK_LABEL, getScene, defaultSpace, type FeedbackKind, type Hotspot, type PersonalPlan, type PlanExperience, type SceneView } from "@hwpc/scenes";
import type { AdvisorClient } from "../advisor/client";
import { Panorama, type View } from "./Panorama";
import { SceneRunner } from "./SceneRunner";
import { usePlan } from "./usePlan";
import { PlanView } from "./PlanView";
import { downloadText } from "../advisor/exporters";

type Activity = "scenes" | "compare" | "plan";

interface Props {
  client: AdvisorClient;
  sessionId: string;
  plan: PersonalPlan;
  /** 方案不是当前需求对应的版本时为 false：可看、可体验，但不是当前建议。 */
  planCurrent: boolean;
  staleReason?: string;
  onBackToTalk: () => void;
  renderWork?: () => React.ReactNode;
}

const FB_KINDS = Object.keys(FEEDBACK_LABEL) as FeedbackKind[];

export function ExperienceArea({ client, sessionId, plan, planCurrent, staleReason, onBackToTalk, renderWork }: Props) {
  const p = usePlan(client, sessionId, plan);
  const [activity, setActivity] = useState<Activity>("scenes");
  const [open, setOpen] = useState<string | null>(null); // experienceId
  const [note, setNote] = useState<string | null>(null);
  const [fbNote, setFbNote] = useState("");
  const [fbMsg, setFbMsg] = useState<string | null>(null);
  const [showWork, setShowWork] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const space = useMemo(() => defaultSpace(), []);

  // 恢复上次所在位置（首次就绪时）
  const restored = useRef(false);
  if (p.ready && !restored.current) {
    restored.current = true;
    if (p.position.experienceId && plan.experiences.some((e) => e.experienceId === p.position.experienceId)) {
      queueMicrotask(() => (setOpen(p.position.experienceId ?? null), setActivity("scenes"), setNote("已回到你上次所在的任务，进度已恢复。")));
    } else if (p.position.activity === "plan" || p.position.activity === "compare") queueMicrotask(() => setActivity(p.position.activity as Activity));
  }

  const view: View = { yaw: p.position.yaw, pitch: p.position.pitch };
  const expOf = (id: string | null) => plan.experiences.find((e) => e.experienceId === id);
  const current = expOf(open);
  const recommended = plan.experiences.map((e) => e.sceneId);
  const doneScenes = plan.experiences.filter((e) => p.doneIds.includes(e.experienceId)).map((e) => e.sceneId);

  const enterExp = (e: PlanExperience, from: "space" | "plan" | "recommend") => {
    setOpen(e.experienceId);
    setActivity("scenes");
    setNote(null);
    p.setPos({ ...p.position, activity: "scenes", experienceId: e.experienceId });
    void from;
  };
  const leaveTo = (to: "space" | "plan") => {
    setOpen(null);
    setFbMsg(null);
    if (to === "plan") setActivity("plan");
    p.setPos({ ...p.position, activity: to === "plan" ? "plan" : "scenes", experienceId: undefined });
  };
  const onHotspot = (h: Hotspot) => {
    if (h.target.type === "scene") {
      const sceneId = h.target.sceneId;
      const e = plan.experiences.find((x) => x.sceneId === sceneId);
      if (e) enterExp(e, "space");
      else setNote("这个方案没有安排该任务。可以回到对话，让顾问评估是否需要加入。");
    } else {
      setActivity(h.target.activity);
      p.setPos({ ...p.position, activity: h.target.activity, experienceId: undefined });
    }
  };

  const exportJson = () => {
    const d = p.exportProgress();
    if (!d) return;
    downloadText(`plan-progress-v${plan.planVersion}.json`, JSON.stringify(d, null, 2), "application/json");
    setNote("已导出进度记录（独立副本）。它不会自动同步，也不包含后续修改。");
  };
  const importFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const r = p.importProgress(JSON.parse(await f.text()));
      setNote(r.message);
    } catch {
      setNote("文件无法读取为进度记录。");
    }
  };

  const storageText =
    p.storage === "server" ? "进度已保存在服务端" : p.storage === "browser_local" ? "进度只保存在本浏览器的本地缓存里（不是服务端保存；换设备或清理浏览器数据后会丢失）。可以导出进度文件备份。" : "进度没有被保存（当前后端不支持）。";

  return (
    <section className="exp" aria-label="场景体验与个人方案">
      <nav className="acts-nav" aria-label="工作台活动">
        <button type="button" className="tab" onClick={onBackToTalk}>需求沟通</button>
        <button type="button" role="tab" aria-selected={activity === "scenes"} className={`tab ${activity === "scenes" ? "on" : ""}`} onClick={() => (setActivity("scenes"), p.setPos({ ...p.position, activity: "scenes" }))}>场景体验</button>
        <button type="button" role="tab" aria-selected={activity === "compare"} className={`tab ${activity === "compare" ? "on" : ""}`} onClick={() => (setActivity("compare"), setOpen(null), p.setPos({ ...p.position, activity: "compare", experienceId: undefined }))}>候选比较</button>
        <button type="button" role="tab" aria-selected={activity === "plan"} className={`tab ${activity === "plan" ? "on" : ""}`} onClick={() => (setActivity("plan"), setOpen(null), p.setPos({ ...p.position, activity: "plan", experienceId: undefined }))}>个人方案</button>
        {renderWork && <button type="button" className={`tab tab-opt ${showWork ? "on" : ""}`} onClick={() => setShowWork((v) => !v)}>营销图文（可选成果）</button>}
      </nav>

      {!planCurrent && (
        <div className="alert alert-warn" role="status">
          <strong>这是历史方案。</strong>{staleReason ?? "它不对应当前需求"}。可以查看和体验，但不是当前建议；其中的推荐理由不适用于现在的需求。
        </div>
      )}
      {note && <p className="notice-inline" role="status">{note}</p>}
      {p.skipped.length > 0 && (
        <p className="alert alert-warn" role="status">
          有 {p.skipped.length} 个任务的保存进度与当前场景版本不兼容，没有被套用：{p.skipped.map((s) => s.reason).join("；")}
        </p>
      )}
      <p className="muted small storage-note">{storageText}{p.saveError ? `　保存出错：${p.saveError}` : ""}</p>

      {!p.ready && <p className="loading">正在恢复体验进度…</p>}

      {p.ready && activity === "scenes" && !current && (
        <div className="scene-home">
          <Panorama space={space} view={view} onView={(v) => p.setViewLive(v.yaw, v.pitch)} onEnter={onHotspot} doneSceneIds={doneScenes} recommendedSceneIds={recommended} />
          <h3>按推荐顺序直接进入任务</h3>
          <p className="muted small">不必在空间里寻找：也可以直接从这里进入。顺序与理由来自顾问方案。</p>
          <ol className="exp-list">
            {plan.experiences.map((e) => {
              const def = getScene(e.sceneId, e.sceneVersion);
              const started = (p.histories[e.experienceId]?.length ?? 0) > 0;
              return (
                <li key={e.experienceId}>
                  <div>
                    <strong>{def?.title ?? e.sceneId}</strong>
                    <span className={`tag ${started ? "tag-ok" : "tag-pref"}`}>{started ? "已开始" : "未开始"}</span>
                    <span className="tag tag-mock">{def ? { flow_demo: "功能流程演示", principle_illustration: "原理/参数示意", measured_test: "实机测试" }[def.demoType] : ""}</span>
                    <p className="small">{e.reason}</p>
                  </div>
                  <button type="button" className="btn primary" onClick={() => enterExp(e, "recommend")}>{started ? "继续" : "开始体验"}</button>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {p.ready && activity === "scenes" && current && (() => {
        const def = getScene(current.sceneId, current.sceneVersion);
        if (!def) return <p className="alert alert-error" role="alert">场景 {current.sceneId} v{current.sceneVersion} 不在场景清单中，无法体验。</p>;
        return (
          <>
            <SceneRunner
              def={def}
              config={current.config}
              history={p.histories[current.experienceId] ?? []}
              onHistory={(h) => p.setHistory(current.experienceId, h)}
              onExit={{ label: "回到空间", run: () => leaveTo("space") }}
              renderFeedback={(v: SceneView) => (
                <div className="feedback">
                  <h4>体验之后，告诉顾问</h4>
                  <p className="muted small">你的反馈会交给顾问判断影响。这里不会因为你点了几下或做完了任务，就改变推荐。</p>
                  <div className="options">
                    {FB_KINDS.map((k) => (
                      <button key={k} type="button" className="chip" onClick={async () => {
                        const rec = await p.send(current, k, { outcomeKind: v.outcome.kind, boundDevices: Object.fromEntries(v.roles.filter((r) => r.chosen).map((r) => [r.roleId, r.chosen!])) }, fbNote);
                        setFbMsg(rec ? `${FEEDBACK_LABEL[k]}：${rec.status === "unsupported" ? "当前后端不接收反馈，没有送达。" : rec.ack ?? "已发送。"}` : null);
                        setFbNote("");
                      }}>{FEEDBACK_LABEL[k]}</button>
                    ))}
                  </div>
                  <label className="sr-only" htmlFor="fbnote">补充说明（可选）</label>
                  <input id="fbnote" type="text" className="free" placeholder="补充一句（可选）" value={fbNote} onChange={(e) => setFbNote(e.target.value)} />
                  {fbMsg && <p className="notice-inline" role="status">{fbMsg}</p>}
                </div>
              )}
              restoreNote={(p.histories[current.experienceId]?.length ?? 0) > 0 ? `已恢复这个任务的 ${p.histories[current.experienceId]!.length} 步操作。` : undefined}
            />
            <div className="row after-task">
              <button type="button" className="btn" onClick={() => leaveTo("space")}>回到空间继续看</button>
              <button type="button" className="btn primary" onClick={() => leaveTo("plan")}>回到方案继续判断</button>
            </div>
          </>
        );
      })()}

      {p.ready && (activity === "compare" || activity === "plan") && (
        <PlanView
          plan={plan}
          mode={activity}
          histories={p.histories}
          feedback={p.feedback}
          onEnter={(e) => enterExp(e, "plan")}
          onExport={exportJson}
          onImport={() => fileRef.current?.click()}
          storage={p.storage}
        />
      )}
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => importFile(e.target.files?.[0])} aria-label="导入进度记录" />
      {showWork && renderWork?.()}
    </section>
  );
}
