/**
 * apps/web —— 对话式顾问工作台。
 * 先沟通并确认需求，再制作；确认后才展开作品区。界面状态以后端快照为准。
 */
import { useState } from "react";
import { useAdvisor } from "./advisor/useAdvisor";
import type { MockAdvisorClient } from "./advisor/mock/mockClient";
import type { AdvisorSnapshot } from "./advisor/types";
import { ORIGIN_LABEL } from "./advisor/resolve";
import { Conversation } from "./components/Conversation";
import { EvidencePanel, RequirementPanel, SummaryCard } from "./components/Requirements";
import { WorkArea } from "./components/Work";
import { ExperienceArea } from "./scenes/ExperienceArea";
import "./scenes/scene.css";

const PHASE_LABEL: Record<AdvisorSnapshot["phase"], string> = {
  discussing: "沟通需求",
  retrieving: "查看资料",
  awaiting_confirmation: "等你确认需求",
  producing: "制作中",
  delivered: "已交付",
  blocked: "已阻止",
  failed: "出错",
  interrupted: "任务中断",
};

const EXAMPLES = ["想买轻薄本", "给新生写小红书，要互动网页，重点看便携", "帮我写篇华为电脑的文章"];

function StatusBar({ snap, backendKind }: { snap: AdvisorSnapshot | null; backendKind: string }) {
  const b = snap?.backend;
  return (
    <div className={`statusbar ${b?.mockInUse ? "is-mock" : ""}`} role="status">
      {backendKind === "mock-ui" && <strong>界面模拟（MOCK-UI）：对话、确认和作品均由前端模拟，未调用真实模型与知识库。</strong>}
      {backendKind === "legacy-api" && <strong>已连接现有后端接口（旧版契约），部分顾问功能不可用。</strong>}
      {b && (
        <span className="src">
          资料：{ORIGIN_LABEL[b.dataOrigin]}　模型：{b.modelProvider === "mock" ? "模拟（未实际调用）" : "OpenAI 兼容服务（实际运行）"}
        </span>
      )}
    </div>
  );
}

function Welcome({ onStart, busy }: { onStart: (t: string) => void; busy: boolean }) {
  const [text, setText] = useState("");
  return (
    <section className="welcome">
      <h1>先聊清楚，再动手做</h1>
      <p className="lede">告诉我你想推广什么、给谁看。不用一次说全，我会问最关键的几件事，参考资料库里的内容给你选择，你确认后才开始制作。</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) onStart(text.trim());
        }}
      >
        <label htmlFor="first" className="sr-only">描述你的需求</label>
        <textarea id="first" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="例如：想买轻薄本" />
        <button type="submit" className="btn primary" disabled={busy || !text.trim()}>开始沟通</button>
      </form>
      <div className="examples" aria-label="示例开头">
        {EXAMPLES.map((x) => (
          <button key={x} type="button" className="chip" onClick={() => onStart(x)} disabled={busy}>{x}</button>
        ))}
      </div>
    </section>
  );
}

function DevPanel({ snap, client }: { snap: AdvisorSnapshot; client: MockAdvisorClient }) {
  return (
    <details className="dev">
      <summary>模拟开关（仅 MOCK-UI）</summary>
      <div className="row">
        <button type="button" className="btn" onClick={() => client.setFailNextRetrieval(snap.sessionId, true)}>下次检索失败</button>
        <button type="button" className="btn" onClick={() => client.setFailNextWork(snap.sessionId, true)}>下次制作中断</button>
        <button type="button" className="btn" onClick={() => client.simulateOtherWindowEdit(snap.sessionId)}>模拟另一窗口修改摘要</button>
        <button type="button" className="btn" onClick={() => (client.speed.value = client.speed.value === 1 ? 20 : 1)}>切换进度速度</button>
      </div>
    </details>
  );
}

export function App() {
  const a = useAdvisor();
  const { snap, loading, busy, notice, actions, client } = a;
  const ref = snap?.summary ? { summaryId: snap.summary.summaryId, requirementVersion: snap.summary.requirementVersion } : null;
  const showSummary = !!snap?.summary && snap.summary.status === "pending_confirmation";
  const hasWork = !!snap && snap.versions.length > 0;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">华为PC营销顾问</span>
        {snap && <span className={`phase phase-${snap.phase}`}>{PHASE_LABEL[snap.phase]}</span>}
        <span className="spacer" />
        <label className="backend-pick">
          后端
          <select value={a.backend} onChange={(e) => actions.switchBackend(e.target.value as "mock-ui" | "legacy-api")} aria-label="选择后端">
            <option value="mock-ui">界面模拟（MOCK-UI）</option>
            <option value="legacy-api">现有接口（旧版）</option>
          </select>
        </label>
        {snap && <button type="button" className="btn" onClick={actions.newSession}>新对话</button>}
      </header>
      <StatusBar snap={snap} backendKind={a.backend} />
      {notice && (
        <div className={`toast toast-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          <span>{notice.text}</span>
          <button type="button" className="link" onClick={actions.dismissNotice}>知道了</button>
        </div>
      )}

      {loading && <p className="loading">正在恢复会话…</p>}
      {!loading && !snap && <Welcome onStart={actions.start} busy={busy} />}

      {snap && (
        <main className={`layout ${hasWork ? "with-work" : ""}`}>
          <div className="col-left">
            {(snap.phase === "failed" || snap.phase === "interrupted") && snap.error && (
              <div className="alert alert-error" role="alert">
                <strong>{snap.phase === "interrupted" ? "任务中断" : "出错了"}：</strong>{snap.error.message}
                {snap.error.recoverable && <button type="button" className="btn" onClick={actions.resume} disabled={busy}>继续</button>}
              </div>
            )}
            <Conversation snap={snap} busy={busy} onSend={actions.send} onAnswer={actions.answer} onEdit={actions.edit} />
            {!snap.capabilities.requirementConfirmation && (
              <div className="alert alert-info">当前后端没有需求确认能力：信息齐全时它会直接生成作品，前端无法在此之前提供确认门。</div>
            )}
            {a.backend === "mock-ui" && <DevPanel snap={snap} client={client as MockAdvisorClient} />}
          </div>

          <div className="col-right">
            {showSummary && ref && (
              <SummaryCard
                summary={snap.summary!}
                busy={busy}
                onConfirm={() => actions.confirm(ref)}
                onRevise={(edits) => actions.reviseSummary(ref, edits)}
                onContinue={() => actions.continueDiscussion(ref)}
              />
            )}
            {!hasWork && <RequirementPanel snap={snap} />}
            {!hasWork && <EvidencePanel snap={snap} />}
            {snap.phase === "producing" && !hasWork && (
              <section className="card"><h2>正在制作</h2><p className="muted">需求已确认。作品完成并核验后会在这里展开。</p></section>
            )}
            {a.plan && snap.capabilities.personalPlan && (
        <ExperienceArea
          client={a.client}
          sessionId={snap.sessionId}
          plan={a.plan}
          planCurrent={a.plan.planVersion === snap.planVersions.at(-1)?.planVersion && a.plan.requirementConfirmed}
          staleReason={snap.planVersions.find((v) => v.planVersion === a.plan!.planVersion)?.staleReason}
          onBackToTalk={() => a.actions.switchActivity("talk")}
          renderWork={hasWork && a.work ? () => (
            <WorkArea
              sessionId={snap.sessionId}
              snap={snap}
              work={a.work!}
              client={a.client}
              busy={busy}
              onSelectVersion={a.setSelectedVersion}
              onRevise={(t) => a.actions.reviseWork(t, snap.versions.at(-1)!.version)}
              onChangeRequirement={(t) => a.actions.changeRequirement(t, snap.versions.at(-1)!.version)}
            />
          ) : undefined}
        />
      )}
      {hasWork && a.work && !snap.capabilities.personalPlan && (
              <>
                {snap.summary && snap.summary.status === "pending_confirmation" && (
                  <p className="notice-inline">需求有新版本待确认：下方作品是之前版本，确认前不会被更新。</p>
                )}
                <WorkArea
                  sessionId={snap.sessionId}
                  snap={snap}
                  work={a.work}
                  client={client}
                  busy={busy || snap.phase === "producing"}
                  onSelectVersion={a.setSelectedVersion}
                  onRevise={(t) => actions.reviseWork(t, snap.versions.at(-1)!.version)}
                  onChangeRequirement={(t) => actions.changeRequirement(t, snap.versions.at(-1)!.version)}
                />
              </>
            )}
            {hasWork && !a.work && !a.workError && <p className="loading">正在读取作品…</p>}
            {a.workError && <div className="alert alert-error" role="alert">读取作品失败：{a.workError}</div>}
            {hasWork && <details className="side-ctx"><summary>需求记录与候选资料</summary><RequirementPanel snap={snap} /><EvidencePanel snap={snap} /></details>}
          </div>
        </main>
      )}
    </div>
  );
}
