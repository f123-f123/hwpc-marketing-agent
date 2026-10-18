import { useCallback, useEffect, useState } from "react";
import { API_PATHS, ConnectionStatusSchema, NEED_KEY_LABEL, validateSceneConfig, type ConnectionStatus, type FeedbackKind, type InstanceView, type SessionSnapshot } from "@hwpc/contracts";
import { showroomSpace } from "@hwpc/scenes";
import { Panorama, type View } from "../scenes/Panorama";
import { SessionHttpError, sessionClient } from "./client";
import "../scenes/scene.css";
import "../styles/showroom.css";

const SESSION_KEY = "hwpc.active-session-id";
const VIEW_KEY = "hwpc.showroom-view";
const POSITION_KEY = "hwpc.showroom-position";
const outcomeLabel = { fits: "满足", fits_with_compromise: "有取舍", not_fit: "不满足", insufficient_evidence: "证据不足" };
const statusLabel = { known: "用户明说", inferred: "系统推断", default: "系统默认", pending: "待确认" };
const applicabilityLabel = { applicable: "有证据支持适用", conditional: "尚有条件待确认", not_applicable: "不适用", unknown: "支持性未知", illustrative: "仅说明性体验" };
const ORIGIN_LABEL: Record<string, string> = { local: "本地知识库", ima: "ima 知识库", mock: "模拟数据（MOCK）" };
const MEDIA_CREDIT = "华为商城电脑专区素材 · 仅作场景展示，具体功能以型号资料为准";
const CAPABILITY_LABEL: Record<string, string> = { offline_experience: "离线体验", local_recovery: "进度保存", online_ai: "在线顾问", live_updates: "资料更新", cross_device_continuation: "跨设备使用", sharing: "方案分享" };
const NEEDS_STATUS_LABEL: Record<string, string> = {
  collecting: "仍在沟通",
  awaiting_confirmation: "等待确认",
  confirmed: "已确认",
  changed_since_confirmation: "需求有变化，需重新确认",
};
const SECTIONS = [
  { id: "needs", label: "需求" },
  { id: "talk", label: "沟通" },
  { id: "candidates", label: "候选" },
  { id: "experience", label: "体验" },
  { id: "plan", label: "方案" },
] as const;

function SectionHead({ id, title, aside, description }: { id: string; title: string; aside?: string; description?: string }) {
  return (
    <header className="section-head">
      <div><h2 id={id} className="section-title">{title}</h2>{description && <p className="section-description">{description}</p>}</div>
      {aside && <span className="section-aside">{aside}</span>}
    </header>
  );
}

function SceneTask({ view, busy, onAction, onFeedback, onClose }: {
  view: InstanceView; busy: boolean; onAction: (id: string) => void;
  onFeedback: (kind: FeedbackKind, text: string, extra?: { conditionKey?: string }) => void; onClose: () => void;
}) {
  const { instance, definition: def, experience } = view;
  const [feedback, setFeedback] = useState("");
  const current = def.states.find(s => s.stateId === experience.currentStateId);
  const config = validateSceneConfig(def, instance.params);
  const active = instance.status === "active" && !view.invalidation && !view.registryDrift && config.ok;
  return <section className="scene"><header className="scene-head"><div><h2>{view.title}</h2><p>{view.summary}</p></div><button type="button" className="btn" onClick={onClose}>回到全景</button></header>
    <div className="demo-badge"><strong>功能流程演示 · {instance.mode === "exploratory" ? "通用说明" : `个人方案 v${instance.planVersion}`}</strong><span>{def.demoBoundary.statement}</span></div>
    <p><strong>适用性：</strong>{applicabilityLabel[instance.applicability.result]}。{instance.applicability.reasons.map(r => r.text).join("；")}</p>
    {instance.applicability.openConditions.filter(c => !instance.confirmedConditionKeys.includes(c.conditionKey)).length > 0 && (
      <div className="row"><strong>需要你确认的使用条件：</strong>
        {instance.applicability.openConditions.filter(c => !instance.confirmedConditionKeys.includes(c.conditionKey)).map(c => (
          <button key={c.conditionKey} type="button" className="btn" disabled={busy}
            onClick={() => onFeedback("confirm_condition", `我已满足：${c.text}`, { conditionKey: c.conditionKey })}>
            我已满足：{c.text}
          </button>
        ))}
      </div>
    )}
    {view.knowledgeScope === "outside_pc_knowledge_base" && <p className="alert alert-warn">此任务超出 PC 知识库范围，相关设备事实未获该库验证。</p>}
    {instance.applicability.isMock && <p className="alert alert-warn">此场景包含模拟资料或设备；虚拟成功不能作为实机证据。</p>}
    {view.caveats.map((c, i) => <p key={i} className="small muted">{c}</p>)}
    {view.invalidation && <p className="alert alert-error">场景版本已失效：{view.invalidation.reason}</p>}
    {view.registryDrift && <p className="alert alert-error">场景版本内容与注册表不一致，动作已停用。</p>}
    {!config.ok && <p className="alert alert-error">保存的场景配置不合法：{config.errors.join("；")}</p>}
    <p><strong>当前状态：</strong>{current?.label ?? experience.currentStateId}；{experience.completion === "walkthrough_completed" ? "已走完流程（非硬件实测）" : experience.completion === "in_progress" ? "体验中" : "尚未开始"}</p>
    {Object.entries(config.values).length > 0 && <p className="small">配置：{Object.entries(config.values).map(([k, v]) => `${def.configSchema.find(f => f.key === k)?.label ?? k}=${String(v)}`).join("；")}</p>}
    <ol className="steps">{def.states.map(s => <li key={s.stateId} className={experience.visitedStateIds.includes(s.stateId) ? "done" : ""}>{s.label}</li>)}</ol>
    <div className="acts">{def.actions.map(a => <div className="act" key={a.actionId}><button type="button" className="btn" disabled={busy || !active || !a.from.includes(experience.currentStateId)} onClick={() => onAction(a.actionId)}>{a.label}</button>{!a.from.includes(experience.currentStateId) && <small className="muted">前置状态未满足</small>}</div>)}</div>
    {def.outcomes.filter(o => experience.reachedOutcomeIds.includes(o.outcomeId)).map(o => <p className="outcome outcome-completed" key={o.outcomeId}><strong>{o.label}：</strong>{o.statement}</p>)}
    <div className="feedback"><h3>明确告诉顾问</h3><p className="muted small">点击和任务完成不会改变你的偏好。只有提交反馈才会进入方案评估。</p>
      <textarea value={feedback} onChange={e => setFeedback(e.target.value)} placeholder="例如：我更在意扩展屏的稳定性" rows={2}/>
      <div className="row">{([["concern", "提出顾虑"], ["new_need", "新增需求"], ["reject_scene", "不想体验此场景"], ["note", "仅记录"]] as const).map(([kind, label]) => <button type="button" key={kind} className="btn" disabled={busy || !feedback.trim()} onClick={() => { onFeedback(kind, feedback.trim()); setFeedback(""); }}>{label}</button>)}</div>
    </div>
  </section>;
}

const EXAMPLES = [
  {
    title: "出差办公",
    text: "我常出差办公，主要写文档和开会，预算 6000 元，希望轻一点",
    ask: "会先问：预算范围、是否已有手机或显示器、最不能妥协的条件",
  },
  {
    title: "手机与电脑传文件",
    text: "我有一台华为手机，想把照片和文件传到电脑，需要什么条件？",
    ask: "会先核对：机型和系统版本、账号与网络条件，再看能否体验",
  },
  {
    title: "接显示器办公",
    text: "在家想接显示器扩展屏幕，平时做表格、看资料",
    ask: "会先问：显示器型号与接口、是否需要边用边充电",
  },
] as const;

const HOME_STEPS = [
  { title: "需求沟通", detail: "每轮 1–3 个问题，确认用途、预算和硬条件；不理解的会继续追问。" },
  { title: "候选与取舍", detail: "满足、不满足、需要妥协、尚未确认分开列，并附原文依据。" },
  { title: "场景体验", detail: "从全景进入局部任务，动手操作会改变场景状态，而不是自动播放。" },
  { title: "个人方案", detail: "需求确认后才生成版本化方案，可导出只读副本继续比较。" },
] as const;

function Welcome({ busy, backend, backendError, onRetryBackend, onCreate }: {
  busy: boolean;
  backend: ConnectionStatus | null;
  backendError: string;
  onRetryBackend: () => void;
  onCreate: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const dataLabel = backend
    ? ORIGIN_LABEL[backend.activeDataOrigin] ?? backend.activeDataOrigin
    : backendError ? "未连接" : "检查中…";
  const dataWarn = backend ? backend.activeDataOrigin === "mock" : !!backendError;
  const modelLabel = backend
    ? backend.model.state === "connected" && backend.model.provider !== "mock" ? "在线模型" : "模拟顾问（未配置模型）"
    : "检查中…";
  const modelWarn = backend ? backend.model.provider === "mock" || backend.model.state !== "connected" : false;

  return (
    <main className="home">
      <div className="home-grid">
        <div>
          <p className="home-eyebrow">华为 PC · 选购与场景体验</p>
          <h1 className="home-title">先说清楚，你要用这台电脑做什么</h1>
          <p className="home-lede">
            我会先问用途、预算和已有设备，再给候选、讲清取舍，安排能动手的体验。需求确认之后，才会生成个人方案。
          </p>

          <form
            className="home-composer"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) onCreate(draft.trim());
            }}
          >
            <label className="sr-only" htmlFor="first-need">描述你的使用需求</label>
            <textarea
              id="first-need"
              rows={4}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="例如：常出差，要处理大表格，也想把手机里的文件传到电脑"
            />
            <div className="home-actions">
              <span className="home-hint">不用一次说全，1–3 个问题就能开始</span>
              <button type="submit" className="btn primary" disabled={busy || !draft.trim()}>
                {busy ? "正在开始…" : "开始沟通"}
              </button>
            </div>
          </form>

          <p className="home-note">也可以直接点下面的常见场景，我会按同样的流程先确认条件再推荐。</p>

          <section className="home-section" aria-labelledby="home-examples">
            <h2 id="home-examples">可以试试</h2>
            <div className="home-cards">
              {EXAMPLES.map((ex) => (
                <button key={ex.title} type="button" className="home-card" disabled={busy} onClick={() => onCreate(ex.text)}>
                  <strong>{ex.title}</strong>
                  <span>{ex.ask}</span>
                </button>
              ))}
            </div>
          </section>
        </div>

        <aside className="home-side">
          <figure className="home-visual">
            <img src="/media/home-collab.jpg" alt="多人在窗边围坐使用笔记本电脑的场景示意" width={984} height={588} />
            <figcaption>{MEDIA_CREDIT}</figcaption>
          </figure>
          <section className="home-panel" aria-labelledby="home-steps">
            <h2 id="home-steps">接下来会发生什么</h2>
            <ol className="home-steps">
              {HOME_STEPS.map((s, i) => (
                <li className="home-step" key={s.title}>
                  <span className="home-step-no" aria-hidden="true">{i + 1}</span>
                  <div>
                    <strong>{s.title}</strong>
                    <p>{s.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="home-panel" aria-labelledby="home-status">
            <h2 id="home-status">现在的能力与限制</h2>
            {backendError ? (
              <div role="alert">
                <p className="home-status-note">无法连接本地服务：{backendError}</p>
                <button type="button" className="btn" onClick={onRetryBackend}>重试连接</button>
              </div>
            ) : (
              <ul className="home-status">
                <li><span className="k">资料</span><span className={`v${dataWarn ? " warn" : ""}`}>{dataLabel}</span></li>
                <li><span className="k">顾问</span><span className={`v${modelWarn ? " warn" : ""}`}>{modelLabel}</span></li>
                <li><span className="k">保存</span><span className="v">本机服务端（关闭可恢复）</span></li>
                <li><span className="k">跨设备</span><span className="v">不支持自动续接</span></li>
              </ul>
            )}
            <p className="home-status-note">
              资料来自本地副本而非实时更新；没有配置真实模型时，顾问是关键词模拟，界面会常驻标注。模拟内容不会被说成真机结果。
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}

export function SessionApp() {
  const [snap, setSnap] = useState<SessionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [activeId, setActiveId] = useState<string | null>(() => { try { return (JSON.parse(localStorage.getItem(POSITION_KEY) ?? "null") as { activeId?: string } | null)?.activeId ?? null; } catch { return null; } });
  const [activeSection, setActiveSection] = useState("needs");
  const [view, setView] = useState<View>(() => { try { return JSON.parse(localStorage.getItem(VIEW_KEY) ?? "") as View; } catch { return { yaw: 0, pitch: 0 }; } });
  const [backend, setBackend] = useState<ConnectionStatus | null>(null);
  const [backendError, setBackendError] = useState("");

  const loadBackend = useCallback(async () => {
    setBackendError("");
    try {
      const parsed = ConnectionStatusSchema.safeParse(await (await fetch(API_PATHS.status)).json());
      if (!parsed.success) throw new Error("状态响应与公共契约不一致");
      setBackend(parsed.data);
    } catch (e) {
      setBackend(null);
      setBackendError(e instanceof Error ? e.message : "无法连接本地服务");
    }
  }, []);

  const restore = useCallback(async () => {
    // 支持 ?session=<id> 直接打开某个本地会话，便于演示与排查。
    const queryId = new URLSearchParams(window.location.search).get("session");
    const id = queryId ?? localStorage.getItem(SESSION_KEY);
    if (!id) { setLoading(false); return; }
    if (queryId) localStorage.setItem(SESSION_KEY, queryId);
    setLoading(true);
    setError("");
    try { setSnap(await sessionClient.get(id)); }
    catch (e) { setError(e instanceof Error ? e.message : "恢复会话失败"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void restore(); void loadBackend(); }, [restore, loadBackend]);
  useEffect(() => { localStorage.setItem(POSITION_KEY, JSON.stringify({ activeId })); }, [activeId]);
  useEffect(() => {
    if (!snap) return;
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) setActiveSection(visible.target.id);
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: [0, 0.2, 0.5] },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [snap?.sessionId]);

  const update = (s: SessionSnapshot) => { setSnap(s); localStorage.setItem(SESSION_KEY, s.sessionId); };
  const run = async (call: () => Promise<SessionSnapshot>) => {
    setBusy(true); setError("");
    try { update(await call()); } catch (e) { if (e instanceof SessionHttpError && e.snapshot) update(e.snapshot); setError(e instanceof Error ? e.message : "请求失败"); }
    finally { setBusy(false); }
  };
  const startNew = () => { setSnap(null); setError(""); setActiveId(null); localStorage.removeItem(SESSION_KEY); localStorage.removeItem(POSITION_KEY); window.scrollTo({ top: 0, behavior: "instant" }); };
  const create = (value: string) => { const t = value.trim(); if (!t) return; setActiveId(null); void run(async () => { const next = await sessionClient.create(t); window.scrollTo({ top: 0, behavior: "instant" }); return next; }); };
  const send = () => { if (!snap || !text.trim()) return; void run(() => sessionClient.message(snap, text.trim())); setText(""); };
  const submitAnswers = () => {
    if (!snap) return;
    const selected = snap.conversation.openQuestions.filter((q) => answers[q.questionId]?.trim()).map((q) => ({ questionId: q.questionId, answer: answers[q.questionId]!.trim() }));
    if (!selected.length) return;
    void run(() => sessionClient.answers(snap, selected));
    setAnswers({});
  };
  const confirmNeeds = () => { if (snap) void run(() => sessionClient.confirm(snap)); };
  const composePlan = () => { if (snap) void run(() => sessionClient.compose(snap)); };
  const resumeTask = () => { if (snap) void run(() => sessionClient.resume(snap)); };
  const doAction = (instanceId: string, actionId: string) => { if (snap) void run(() => sessionClient.action(snap, instanceId, actionId)); };
  const doFeedback = (instanceId: string, kind: FeedbackKind, value: string, extra?: { conditionKey?: string }) => {
    if (snap) void run(() => sessionClient.feedback(snap, { kind, text: value, instanceId, ...extra }));
  };

  const scrollToExperience = () => requestAnimationFrame(() => document.getElementById("experience")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  const catalog = snap?.scenes.catalog.filter((c) => c.status === "active") ?? [];
  const assigned = snap?.plan.current?.scenes ?? [];
  const instances = snap?.scenes.instances ?? [];
  const active = instances.find((v) => v.instance.instanceId === activeId);
  const usableHotspots = showroomSpace.hotspots.filter((h) => { if (h.target.type !== "scene") return true; const id = h.target.sceneId; return catalog.some((c) => c.sceneId === id && c.integrity === "ok"); });
  const enter = (sceneId: string) => {
    if (!snap) return;
    const existing = instances.find((v) => v.instance.sceneId === sceneId && v.instance.status === "active" && (snap.plan.current?.status === "current" ? v.instance.mode === "personal" : true));
    if (existing) { setActiveId(existing.instance.instanceId); scrollToExperience(); return; }
    const item = catalog.find((c) => c.sceneId === sceneId);
    if (!item || item.integrity !== "ok") { setError("此场景未注册、未锁定版本或已失效，无法打开。"); return; }
    void run(async () => {
      const next = await sessionClient.explore(snap, item.sceneId, item.version);
      const created = next.scenes.instances.find((v) => v.instance.sceneId === sceneId && v.instance.mode === "exploratory");
      if (created) setActiveId(created.instance.instanceId);
      scrollToExperience();
      return next;
    });
  };

  const entries = snap?.needs.entries ?? [];
  const entryValue = (key: string) => entries.find((e) => e.key === key)?.value;
  const taskValue = entryValue("task")?.replace(/^用于/, "");
  const currentPlan = snap?.plan.current;
  const candidates = currentPlan?.candidates ?? snap?.candidates.assessments ?? [];
  const headline = currentPlan
    ? "属于你的选择，\n也适合你的生活。"
    : taskValue ? `${taskValue}，\n从适合你开始。` : "一台电脑，\n你的万种可能。";
  const lede = currentPlan
    ? "把你的需求、候选与场景体验放在一起。慢慢比较，找到更适合自己的使用方式。"
    : "从日常工作，到设备之间的默契配合。先聊聊你的使用方式，再一起找到合适的电脑。";
  const needChips = [entryValue("task"), entryValue("budget"), entryValue("existingDevices"), entryValue("hardConstraints")]
    .filter((v): v is string => Boolean(v))
    .slice(0, 4)
    .map((v) => v.replace(/^用于/, ""));
  const hasQuestions = Boolean(snap?.conversation.openQuestions.length);
  const primaryAction = (() => {
    if (!snap) return null;
    if (snap.run.state === "failed") return <button type="button" className="btn primary" onClick={resumeTask} disabled={busy}>恢复中断任务</button>;
    if (snap.needs.status === "awaiting_confirmation" && snap.needs.summary.confirmable) return <button type="button" className="btn primary" onClick={confirmNeeds} disabled={busy}>确认这版需求</button>;
    if (snap.needs.status === "changed_since_confirmation" && snap.needs.summary.confirmable) return <button type="button" className="btn primary" onClick={confirmNeeds} disabled={busy}>重新确认需求</button>;
    if (currentPlan) return <a className="btn primary" href="#experience">进入场景体验</a>;
    if (snap.needs.status === "confirmed" && snap.plan.canCompose) return <button type="button" className="btn primary" onClick={composePlan} disabled={busy}>生成个人方案</button>;
    return <a className="btn primary" href="#talk">回答顾问的问题</a>;
  })();

  return (
    <div className="app showroom-app" id="top">
      <header className="topbar">
        <a className="brand" href="#top"><span className="brand-mark" aria-hidden="true" />华为 PC <span className="brand-subtitle">体验顾问</span></a>
        <span className="spacer" />
        <span className="header-note">让选择，更贴近你的生活</span>
        {snap && <button type="button" className="btn" onClick={startNew}>开始新咨询</button>}
      </header>

      <div className={`statusbar ${snap?.isMock ? "is-mock" : ""}`} role="status">
        {snap ? (
          <>
            <strong>{snap.isMock ? "模拟体验" : "服务已连接"}</strong>
            <span>{ORIGIN_LABEL[snap.components.dataOrigin] ?? snap.components.dataOrigin} / {snap.components.engine.isMock ? "规则模拟顾问" : "在线顾问"}</span>
            <span className="status-version">需求 v{snap.needs.version}{snap.plan.current ? ` / 方案 v${snap.plan.current.version}` : ""}</span>
          </>
        ) : backend ? (
          <>
            <strong>本地服务已连接</strong>
            <span>资料：{ORIGIN_LABEL[backend.activeDataOrigin] ?? backend.activeDataOrigin}</span>
            <span>顾问：{backend.model.provider === "mock" || backend.model.state !== "connected" ? "模拟" : "在线模型"}</span>
          </>
        ) : backendError ? <strong>本地服务未连接</strong> : "正在检查本地服务…"}
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          <span>{error}</span>
          <span className="row">
            <button type="button" className="btn" onClick={() => { void restore(); void loadBackend(); }}>重试</button>
            {snap && <button type="button" className="btn" onClick={startNew}>开始新顾客</button>}
          </span>
        </div>
      )}

      {loading ? (
        <div className="home-skeleton" aria-busy="true" aria-label="正在恢复会话">
          <div className="skeleton title" /><div className="skeleton block" /><div className="skeleton" /><div className="skeleton short" />
        </div>
      ) : !snap ? (
        <Welcome busy={busy} backend={backend} backendError={backendError} onRetryBackend={() => void loadBackend()} onCreate={create} />
      ) : (
        <main className="report">
          <section className="report-hero" aria-labelledby="report-headline">
            <div className="report-hero-inner">
              <div className="report-hero-copy">
                <p className="report-kicker">为你的使用方式而选</p>
                <h1 className="report-headline" id="report-headline">{headline}</h1>
                <p className="report-lede">{lede}</p>
                {needChips.length > 0 && <ul className="report-chips">{needChips.map((chip) => <li key={chip}>{chip}</li>)}</ul>}
                <div className="report-hero-actions">
                  {primaryAction}
                  <a className="report-textlink" href="#talk">继续和顾问沟通</a>
                </div>
                <p className="report-fineprint">{NEEDS_STATUS_LABEL[snap.needs.status] ?? snap.needs.status} · 随时补充，逐步找到答案</p>
              </div>
              <figure className="report-hero-visual">
                <img src="/media/home-collab.jpg" alt="明亮空间中使用华为电脑协作的场景，仅作氛围展示" width={984} height={588} fetchPriority="high" />
                <figcaption>{MEDIA_CREDIT}</figcaption>
              </figure>
            </div>
          </section>

          <nav className="report-nav" aria-label="本页导航">
            <div className="report-nav-inner">
              {SECTIONS.map((s) => (
                <a key={s.id} href={`#${s.id}`} className={`report-nav-link${activeSection === s.id ? " on" : ""}`} aria-current={activeSection === s.id ? "true" : undefined}>
                  {s.label}
                </a>
              ))}
            </div>
          </nav>

          <section id="needs" className="report-section" aria-labelledby="needs-title">
            <SectionHead id="needs-title" title="先认识你的日常。" description="把重要的事情记下来，让每一个推荐都有出发点。" aside={`需求 v${snap.needs.version}`} />
            <div className="need-cards">
              {snap.needs.summary.groups.filter((g) => g.entries.length > 0).map((g) => (
                <article className="need-card" key={g.key}>
                  <h3>{NEED_KEY_LABEL[g.key]}</h3>
                  {g.entries.length > 0 ? (
                    <ul>
                      {g.entries.map((e) => (
                        <li key={e.entryId}>
                          <span>{e.value}</span>
                          <span className="need-tags">
                            <span className="tag">{statusLabel[e.status]}</span>
                            {e.hard && <span className="tag tag-warn">硬条件</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="muted small">未明确</p>}
                </article>
              ))}
            </div>
            {snap.needs.summary.groups.some((g) => g.entries.length === 0) && <p className="needs-pending">还可以聊聊：{snap.needs.summary.groups.filter((g) => g.entries.length === 0).map((g) => NEED_KEY_LABEL[g.key]).join("、")}。不用一次说完。</p>}
            {snap.needs.summary.assumptions.length > 0 && <p className="report-note">待你核对：{snap.needs.summary.assumptions.map((a) => a.text).join("；")}</p>}
            {snap.needs.summary.blockers.length > 0 && <p className="alert alert-warn">暂不能确认：{snap.needs.summary.blockers.join("；")}</p>}
            {snap.needs.invalidatedConfirmations.length > 0 && <p className="report-note">之前有 {snap.needs.invalidatedConfirmations.length} 次确认因需求变化失效，需要重新确认。</p>}
            {snap.needs.status !== "confirmed" && (
              <div className="report-cta">
                <button type="button" className="btn" disabled={busy || !snap.needs.summary.confirmable} onClick={confirmNeeds}>确认这版需求</button>
                <p className="muted small">确认后才会生成个人方案；之后的关键变化会要求重新确认。</p>
              </div>
            )}
            {snap.needs.status === "confirmed" && (
              <div className="report-cta">
                <button type="button" className="btn" disabled={busy || !snap.plan.canCompose} title={snap.plan.cannotComposeReason} onClick={composePlan}>生成/更新个人方案</button>
                {!snap.plan.canCompose && snap.plan.cannotComposeReason && <p className="muted small">{snap.plan.cannotComposeReason}</p>}
              </div>
            )}
          </section>

          <section id="talk" className="report-section" aria-labelledby="talk-title">
            <SectionHead id="talk-title" title="好的选择，从聊一聊开始。" description="不用熟悉参数，说说你想完成什么就好。" />
            <div className="talk-grid">
              <div className="chat report-chat">
                <ul className="messages">
                  {snap.conversation.messages.map((m) => (
                    <li className={`msg msg-${m.role}`} key={m.messageId}>
                      <span className="msg-who">{m.role === "user" ? "我" : "顾问"}</span>
                      <div className="msg-body">
                        <p>{m.text}</p>
                        {m.suggestedScenes?.map((s) => {
                          const title = catalog.find((c) => c.sceneId === s.sceneId)?.title ?? s.sceneId;
                          return <button type="button" key={s.sceneId} className="link" onClick={() => enter(s.sceneId)}>看看：{title}（说明性体验）</button>;
                        })}
                      </div>
                    </li>
                  ))}
                </ul>
                {snap.conversation.openQuestions.length > 0 && (
                  <form className="questions-form" onSubmit={(e) => { e.preventDefault(); submitAnswers(); }}>
                    <div className="questions">
                      {snap.conversation.openQuestions.map((q) => (
                        <fieldset className="question" key={q.questionId}>
                          <legend>{q.prompt}</legend>
                          <p className="small muted">{q.reason}</p>
                          {q.options?.map((o) => (
                            <button type="button" key={o.value} className={`chip ${answers[q.questionId] === o.value ? "on" : ""}`} onClick={() => setAnswers((x) => ({ ...x, [q.questionId]: o.value }))}>{o.label}</button>
                          ))}
                          {q.allowFreeText && <input aria-label={`回答：${q.prompt}`} value={answers[q.questionId] ?? ""} onChange={(e) => setAnswers((x) => ({ ...x, [q.questionId]: e.target.value }))} />}
                        </fieldset>
                      ))}
                    </div>
                    <button className="btn primary" disabled={busy || !Object.values(answers).some(Boolean)}>提交回答</button>
                  </form>
                )}
                <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
                  <label className="sr-only" htmlFor="chat-input">补充用途、硬条件或疑问</label>
                  <textarea id="chat-input" value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="补充你的用途、硬条件或疑问" />
                  <button className={hasQuestions ? "btn primary" : "btn"} disabled={busy || !text.trim()}>发送</button>
                </form>
                {snap.run.state === "failed" && <button type="button" className="btn" disabled={busy} onClick={resumeTask}>恢复中断任务</button>}
              </div>
              <aside className="report-aside">
                <figure className="conversation-visual"><img src="/media/huawei-collaboration.png" alt="华为电脑在日常协作中的场景示意" width={393} height={449} loading="lazy" /></figure>
                <h3>从一个具体的场景说起</h3>
                <ul className="tip-list">
                  <li>主要任务：写文档、做表、剪视频、开会</li>
                  <li>硬条件：重量、接口、必须能跑的软件</li>
                  <li>已有设备：手机、显示器、旧电脑的型号</li>
                </ul>
                <p className="muted small">点击、停留和完成场景都不会改变需求；只有你明确提交的反馈才会进入方案评估。</p>
              </aside>
            </div>
          </section>

          <section id="candidates" className="report-section" aria-labelledby="candidates-title">
            <SectionHead id="candidates-title" title="看见差异，再做选择。" description="适合的地方、需要的取舍，以及还没确认的信息，都放在这里。" aside={candidates.length ? `${candidates.length} 个候选` : undefined} />
            {snap.candidates.stale && <p className="alert alert-warn">候选评价基于旧需求，等待重新评估。</p>}
            {candidates.length === 0 ? (
              <div className="empty-state">
                <p>顾问还没有给出有依据的候选。</p>
                <p className="muted small">先补充任务和预算，再回来看比较。</p>
                <a className="btn" href="#talk">继续沟通</a>
              </div>
            ) : (
              <div className="cand-grid">
                {candidates.map((c) => (
                  <article className="cand" key={c.candidateId}>
                    <header><h3>{c.modelName}</h3><span className="tag">{outcomeLabel[c.overall]}</span></header>
                    <p>{c.comparisonReason}</p>
                    {([["满足", c.satisfied], ["不满足", c.unmet], ["取舍", c.compromises], ["未知（不视为满足）", c.unknowns]] as const).map(([label, rows]) => rows.length > 0 && (
                      <div key={label}><strong>{label}</strong><ul>{rows.map((r) => <li key={r.criterionId}>{r.text}{"hard" in r && r.hard ? "（硬条件）" : ""}
                        {r.evidence.length > 0 && <details className="evidence-inline"><summary>查看资料依据</summary>{r.evidence.map((e, i) => <small className="muted" key={i}>{e.source.title}{e.excerpt ? `：${e.excerpt}` : ""}</small>)}</details>}</li>)}</ul></div>
                    ))}
                  </article>
                ))}
              </div>
            )}
          </section>

          <section id="experience" className="report-section" aria-labelledby="experience-title">
            <SectionHead id="experience-title" title="走进场景，亲手试一试。" description="把抽象的功能，放回真实的使用问题。以下为虚拟流程演示。" aside={assigned.length ? `${assigned.length} 个方案任务` : "通用说明性体验"} />
            {active ? (
              <SceneTask
                view={active}
                busy={busy}
                onClose={() => setActiveId(null)}
                onAction={(id) => doAction(active.instance.instanceId, id)}
                onFeedback={(kind, value, extra) => doFeedback(active.instance.instanceId, kind, value, extra)}
              />
            ) : (
              <div className="exp-grid">
                <div className="panorama-wrap">
                  <Panorama
                    space={{ ...showroomSpace, hotspots: usableHotspots }}
                    view={view}
                    onView={(v) => { setView(v); localStorage.setItem(VIEW_KEY, JSON.stringify(v)); }}
                    onEnter={(h) => { if (h.target.type === "scene") enter(h.target.sceneId); else document.getElementById(h.target.activity === "compare" ? "candidates" : "plan")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                    recommendedSceneIds={assigned.map((e) => e.sceneId)}
                    doneSceneIds={instances.filter((v) => v.experience.completion === "walkthrough_completed").map((v) => v.instance.sceneId)}
                  />
                </div>
                <aside className="report-aside">
                  <h3>任务直达</h3>
                  <div className="task-list">
                    {catalog.map((c) => (
                      <button type="button" className="task-item" disabled={c.integrity !== "ok"} title={c.integrity !== "ok" ? "场景版本未锁定或内容校验失败" : undefined} key={`${c.sceneId}@${c.version}`} onClick={() => enter(c.sceneId)}>
                        <strong>{c.title}</strong>
                        <span className="muted small">v{c.version} · {assigned.some((e) => e.sceneId === c.sceneId) ? "方案任务" : "通用体验"}{c.integrity !== "ok" ? " · 版本未锁定" : ""}</span>
                      </button>
                    ))}
                  </div>
                  {catalog.length === 0 && <p className="muted small">当前没有注册场景。</p>}
                  <figure className="scene-visual">
                    <img src="/media/huawei-continuity.png" alt="电脑与手机协同使用的场景示意" width={393} height={288} loading="lazy" />
                    <figcaption>{MEDIA_CREDIT}</figcaption>
                  </figure>
                  <p className="muted small">方案任务优先显示；其他任务只是说明性浏览，不是个性化推荐。</p>
                </aside>
              </div>
            )}
          </section>

          <section id="plan" className="report-section" aria-labelledby="plan-title">
            <SectionHead id="plan-title" title="把想法，留成自己的方案。" description="需求与体验都保留在这里，方便下次继续比较。" aside={currentPlan ? `方案 v${currentPlan.version}` : undefined} />
            {currentPlan ? (
              <>
                <div className="report-card">
                  <p className="report-status">
                    方案 v{currentPlan.version} · 需求 v{currentPlan.needVersion} · 核验{currentPlan.verification.ok ? "通过" : "未通过"}
                    {currentPlan.needsReview ? " · 待复核" : ""}
                  </p>
                  {!currentPlan.verification.ok && (
                    <p className="alert alert-warn">方案核验尚未通过：{currentPlan.verification.checks.filter((c) => !c.ok).map((c) => c.detail).join("；")}</p>
                  )}
                  <p>{currentPlan.recommendation.noRecommendationReason ?? currentPlan.recommendation.byCandidate.map((r) => r.reason).join("；")}</p>
                  {assigned.length > 0 ? (
                    <ol className="plan-scenes">
                      {assigned.map((e) => {
                        const v = instances.find((x) => x.instance.instanceId === e.instanceId);
                        return (
                          <li key={e.instanceId}>
                            <div>
                              <strong>{v?.title ?? e.sceneId}</strong>
                              <p className="muted small">{e.reason}</p>
                              <p className="small">进度：{v ? (v.experience.completion === "walkthrough_completed" ? "已走完流程（非实测）" : v.experience.completion === "in_progress" ? "体验中" : "尚未开始") : "未创建"}</p>
                            </div>
                            <button type="button" className="btn" onClick={() => { setActiveId(e.instanceId); scrollToExperience(); }}>打开任务</button>
                          </li>
                        );
                      })}
                    </ol>
                  ) : <p className="muted small">本次没有可纳入的场景：缺少设备证据时会跳过，原因见下。</p>}
                </div>
                {snap.plan.notes.length > 0 && (
                  <div className="report-card">
                    <h3>没有纳入的场景及原因</h3>
                    <ul className="note-list">{snap.plan.notes.map((n, i) => <li key={i}>{n.text}</li>)}</ul>
                  </div>
                )}
              </>
            ) : (
              <div className="empty-state">
                <p>还没有生成个人方案。</p>
                <p className="muted small">{snap.needs.status === "confirmed" ? "需求已确认，可以生成方案。" : "先确认需求，再生成方案。"}</p>
                {snap.needs.status === "confirmed"
                  ? <button type="button" className="btn" onClick={composePlan} disabled={busy || !snap.plan.canCompose}>生成个人方案</button>
                  : <a className="btn" href="#needs">去确认需求</a>}
              </div>
            )}

            <details className="plan-details"><summary>反馈与方案更新记录<span>{snap.feedback.length + snap.impacts.length} 条</span></summary><div className="report-grid-2">
              <div className="report-card">
                <h3>明确反馈</h3>
                {snap.feedback.length ? <ul>{snap.feedback.map((f) => <li key={f.feedbackId}>{f.text} <small className="muted">({f.kind})</small></li>)}</ul> : <p className="muted small">尚未提交反馈。在场景里提交的明确反馈会出现在这里。</p>}
              </div>
              <div className="report-card">
                <h3>方案更新记录</h3>
                {snap.impacts.length ? <ul>{snap.impacts.map((i) => <li key={i.impactId}>{i.summary}</li>)}</ul> : <p className="muted small">还没有影响分析记录。</p>}
              </div>
            </div></details>

            <div className="report-card plan-save">
              <div><h3>为下一次选择，保留这份思考。</h3>
              <p className="muted">可导出只读方案快照；互动体验仍需要连接当前服务。</p></div>
              {currentPlan ? <a className="btn primary" href={`${API_PATHS.sessionExport(snap.sessionId)}?format=recovery_html`}>导出只读方案</a> : <button type="button" className="btn primary" disabled>生成方案后可导出</button>}
            </div>
            <details className="plan-details"><summary>保存方式与服务说明</summary>
              <p className="small">会话由本地服务端保存；本浏览器只记住会话编号和全景朝向。跨设备自动续接取决于服务端能力声明。</p>
              <ul className="capability-list">
                {snap.capabilities.declarations.map((d) => (
                  <li key={d.id}><strong>{CAPABILITY_LABEL[d.id] ?? d.id}：</strong>{d.statement}{d.status !== "supported" && <small className="muted">（{d.status === "unsupported" ? "不支持" : "有条件"}）</small>}</li>
                ))}
              </ul>
            </details>
          </section>

          <footer className="report-footer">
            <div className="report-footer-inner">
              <p>场景完成只表示走完流程演示，不代表在真实设备上测试通过。</p>
              <p>{MEDIA_CREDIT}</p>
              <p>{snap.isMock ? "本页含模拟内容。" : "资料来自本地知识库，非实时更新。"} · <a href="#top">回到顶部</a></p>
            </div>
          </footer>
        </main>
      )}
    </div>
  );
}
