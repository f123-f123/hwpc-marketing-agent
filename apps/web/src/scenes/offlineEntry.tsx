/**
 * 离线个人页面的运行时入口。构建时由 build/sceneRuntimePlugin 打成一个 IIFE，内嵌进导出的 HTML。
 * 它使用与工作台相同的 SceneRunner 与引擎，所以页面里的行为就是工作台里的行为。
 *
 * 能力边界（页面上也会写明）：
 *  - 不联网：没有顾问、没有模型、没有反馈送达、没有价格或库存。
 *  - 进度保存在本浏览器的 localStorage（key 含方案 id 与版本），可导出/导入文件；不是服务端保存，不跨设备同步。
 *  - 页面是导出时刻的方案快照：不会跟随顾客之后在工作台里的修改。
 */
import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { getScene, restore, toSaved, type HistoryEntry, type PersonalPlan, type ProgressExport, type SavedRun } from "@hwpc/scenes";
import { SceneRunner } from "./SceneRunner";
import { outcomeOf } from "./PlanView";

export interface OfflinePayload {
  plan: PersonalPlan;
  /** 导出时的状态说明（MOCK、历史方案、待确认等），必须显示。 */
  notices: string[];
  exportedAt: string;
}

const storageKey = (p: PersonalPlan) => `hwpc.offline.${p.planId}.v${p.planVersion}`;

function load(plan: PersonalPlan): { histories: Record<string, HistoryEntry[]>; skipped: string[]; storageOk: boolean } {
  const histories: Record<string, HistoryEntry[]> = {};
  const skipped: string[] = [];
  let raw: string | null = null;
  let storageOk = true;
  try {
    raw = localStorage.getItem(storageKey(plan));
  } catch {
    storageOk = false;
  }
  if (!raw) return { histories, skipped, storageOk };
  try {
    const records = JSON.parse(raw) as Record<string, SavedRun>;
    for (const e of plan.experiences) {
      const s = records[e.experienceId];
      const def = getScene(e.sceneId, e.sceneVersion);
      if (!s || !def) continue;
      const r = restore(def, e.config, s);
      if (r.ok) histories[e.experienceId] = r.run.history;
      else skipped.push(r.reason);
    }
  } catch {
    skipped.push("本地保存的进度无法读取");
  }
  return { histories, skipped, storageOk };
}

function Page({ payload }: { payload: OfflinePayload }) {
  const { plan } = payload;
  const init = useRef(load(plan));
  const [histories, setHistories] = useState(init.current.histories);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const records: Record<string, SavedRun> = {};
      for (const e of plan.experiences) {
        const def = getScene(e.sceneId, e.sceneVersion);
        const h = histories[e.experienceId];
        if (def && h?.length) records[e.experienceId] = toSaved(def, { bindings: {}, state: {}, history: h, lastFeedback: [] }, new Date().toISOString());
      }
      localStorage.setItem(storageKey(plan), JSON.stringify(records));
    } catch {
      /* 存储不可用时只在内存里保留 */
    }
  }, [histories, plan]);

  const exp = plan.experiences.find((e) => e.experienceId === open);
  const def = exp && getScene(exp.sceneId, exp.sceneVersion);

  const exportFile = () => {
    const records: ProgressExport["records"] = {};
    for (const e of plan.experiences) {
      const d = getScene(e.sceneId, e.sceneVersion);
      const h = histories[e.experienceId];
      if (d && h?.length) records[e.experienceId] = toSaved(d, { bindings: {}, state: {}, history: h, lastFeedback: [] }, new Date().toISOString());
    }
    const data: ProgressExport = { format: "hwpc-plan-progress", formatVersion: 1, planId: plan.planId, planVersion: plan.planVersion, exportedAt: new Date().toISOString(), from: "offline_html", records, feedback: [] };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = `plan-progress-v${plan.planVersion}.json`;
    a.click();
    setMsg("已导出进度记录。它是独立副本，不会自动同步。");
  };
  const importFile = async (f?: File) => {
    if (!f) return;
    try {
      const d = JSON.parse(await f.text()) as Partial<ProgressExport>;
      if (d.format !== "hwpc-plan-progress" || d.planId !== plan.planId || d.planVersion !== plan.planVersion) return setMsg("这份记录不属于当前方案版本，未导入。");
      const next = { ...histories };
      const skipped: string[] = [];
      for (const e of plan.experiences) {
        const s = d.records?.[e.experienceId];
        const dd = getScene(e.sceneId, e.sceneVersion);
        if (!s || !dd) continue;
        const r = restore(dd, e.config, s);
        if (r.ok) next[e.experienceId] = r.run.history;
        else skipped.push(r.reason);
      }
      setHistories(next);
      setMsg(`已导入。${skipped.length ? `有 ${skipped.length} 项因版本不兼容未导入。` : ""}`);
    } catch {
      setMsg("文件无法读取。");
    }
  };

  return (
    <main className="off">
      <h1>我的体验方案</h1>
      {payload.notices.map((n) => <p key={n} className="banner">{n}</p>)}
      <p className="small">
        这是方案在 {payload.exportedAt.slice(0, 10)} 导出时的一份独立副本，不联网：没有顾问问答、没有反馈送达、没有价格或库存，也不会跟随你在顾问工作台里之后的修改。
        体验进度只保存在这台设备的这个浏览器里（不是服务端保存，不同步到其他设备），可以导出为文件备份或交给家人（家人得到的是各自独立的副本）。
      </p>
      {init.current.skipped.length > 0 && <p className="banner">有进度因场景版本不兼容没有恢复：{init.current.skipped.join("；")}</p>}
      {!init.current.storageOk && <p className="banner">这个浏览器不允许保存本地进度，关闭页面后进度会丢失；请用“导出进度记录”备份。</p>}

      {!exp && (
        <>
          <h2>需求与条件</h2>
          <ul>{plan.conditions.map((c) => <li key={c.label}>{c.label}：{c.value}</li>)}</ul>
          <h2>候选产品</h2>
          {plan.candidates.map((c) => (
            <article key={c.candidateId} className="cand">
              <h3>{c.model}</h3>
              <p>适合原因：{c.fitReasons.join("；") || "—"}　不足：{c.shortfalls.join("；") || "资料里没有明确的不足"}</p>
              <ul>{c.evidence.map((e, i) => <li key={i}>{e.status === "supported" ? "✓ " : e.status === "unknown" ? "? 资料未提供：" : "≠ 来源冲突："}{e.claim}{e.qualifiers.length ? `（${e.qualifiers.join("；")}）` : ""}{e.sourceTitle ? ` ——${e.sourceTitle}` : ""}</li>)}</ul>
              {c.unknowns.length > 0 && <p className="unknowns">未知项（不视为满足）：{c.unknowns.join("、")}</p>}
            </article>
          ))}
          <h2>推荐体验顺序</h2>
          <ol>
            {plan.experiences.map((e) => {
              const d = getScene(e.sceneId, e.sceneVersion);
              const out = outcomeOf(e, histories[e.experienceId]);
              return (
                <li key={e.experienceId}>
                  <strong>{d?.title}</strong>（场景 v{e.sceneVersion}）<br />{e.reason}<br />
                  <small>{(histories[e.experienceId]?.length ?? 0) === 0 ? "尚未开始" : out ? `当前结果：${out.title}（仅表示虚拟设备上的状态）` : "已开始"}</small><br />
                  <button type="button" className="btn primary" onClick={() => setOpen(e.experienceId)}>{(histories[e.experienceId]?.length ?? 0) ? "继续" : "开始体验"}</button>
                </li>
              );
            })}
          </ol>
          <h2>待解决的问题</h2>
          <ul>{plan.openIssues.map((i) => <li key={i}>{i}</li>)}</ul>
          <h2>进度</h2>
          <p><button type="button" className="btn" onClick={exportFile}>导出进度记录</button> <button type="button" className="btn" onClick={() => fileRef.current?.click()}>导入进度记录</button></p>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => importFile(e.target.files?.[0])} aria-label="导入进度记录" />
          {msg && <p className="banner" role="status">{msg}</p>}
          <h2>说明</h2>
          <ul>{plan.notices.map((n) => <li key={n}>{n}</li>)}</ul>
        </>
      )}
      {exp && def && (
        <SceneRunner
          def={def}
          config={exp.config}
          history={histories[exp.experienceId] ?? []}
          onHistory={(h) => setHistories((p) => ({ ...p, [exp.experienceId]: h }))}
          onExit={{ label: "回到方案", run: () => setOpen(null) }}
        />
      )}
    </main>
  );
}

declare global {
  interface Window {
    __HWPC_PLAN__?: OfflinePayload;
  }
}

const el = document.getElementById("root");
const payload = (window as Window).__HWPC_PLAN__;
if (el && payload) createRoot(el).render(<Page payload={payload} />);
