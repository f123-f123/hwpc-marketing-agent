import { NEED_KEY_LABEL, type SessionSnapshot } from "@hwpc/contracts";
import { ENTRY_STATUS_LABEL, NEEDS_STATUS_LABEL } from "../lib/labels";
import { nextStep } from "../lib/stage";
import type { SessionActions } from "../state/useSession";
import { useSceneEntry } from "../state/useSceneEntry";
import { ChatPanel } from "./ChatPanel";
import { SceneOverlay } from "./SceneOverlay";
import { Alert, Badge } from "./ui";

/**
 * 需求沟通：先把需求聊清楚、确认，再生成全屏体验页。
 * 右侧只放需求要点和唯一的下一步；候选、场景、方案都在体验页里讲。
 */
export function Consult({ snap, busy, actions, onPage }: { snap: SessionSnapshot; busy: boolean; actions: SessionActions; onPage: () => void }) {
  const scene = useSceneEntry(snap, actions);
  const { needs } = snap;
  const filled = needs.summary.groups.filter((g) => g.entries.length > 0);
  const missing = needs.summary.groups.filter((g) => g.entries.length === 0);
  const step = nextStep(snap);
  const hasPage = Boolean(snap.page);

  const run = () => {
    switch (step.action) {
      case "resume": return void actions.resume();
      case "confirm": return void actions.confirm();
      case "compose": return void actions.compose().then((s) => { if (s?.page) onPage(); });
      case "experience": return onPage();
      case "answer":
      case "talk": return document.getElementById("chat-input")?.focus();
    }
  };

  return (
    <div className="consult atmo">
      <section className="consult-chat">
        <ChatPanel snap={snap} busy={busy} actions={actions} onOpenScene={(id) => void scene.enter(id)} />
      </section>

      <aside className="consult-side" aria-labelledby="consult-needs-title">
        {snap.isMock && <p className="consult-mock">本次咨询含模拟内容，不能作为真实资料或实机的依据。</p>}
        <div className={`consult-step consult-step-${step.tone}`}>
          <p className="consult-step-title">{step.title}</p>
          <p className="consult-step-detail">{step.detail}</p>
          <button type="button" className={step.tone === "neutral" ? "btn" : "btn btn-primary"} disabled={busy || !step.enabled} onClick={run}>{step.cta}</button>
          {hasPage && step.action !== "experience" && <button type="button" className="link" onClick={onPage}>先看上一版体验页</button>}
        </div>

        <header className="consult-needs-head">
          <h2 id="consult-needs-title">需求要点</h2>
          <Badge tone={needs.status === "confirmed" ? "success" : needs.status === "collecting" ? "neutral" : "warning"}>v{needs.version} · {NEEDS_STATUS_LABEL[needs.status]}</Badge>
        </header>
        {filled.length === 0 ? (
          <p className="muted small">还没有整理出需求。在左边说说主要任务、预算和已有设备。</p>
        ) : (
          <dl className="consult-needs">
            {filled.map((g) => (
              <div key={g.key}>
                <dt>{NEED_KEY_LABEL[g.key]}</dt>
                {g.entries.map((e) => (
                  <dd key={e.entryId}>
                    {e.value}
                    {e.hard && <Badge tone="primary">硬条件</Badge>}
                    {e.status !== "known" && <Badge tone={e.status === "pending" ? "warning" : "neutral"}>{ENTRY_STATUS_LABEL[e.status]}</Badge>}
                  </dd>
                ))}
              </div>
            ))}
          </dl>
        )}
        {missing.length > 0 && filled.length > 0 && <p className="muted small">还可以补充：{missing.map((g) => NEED_KEY_LABEL[g.key]).join("、")}。不说也没关系。</p>}
        {needs.summary.assumptions.length > 0 && (
          <Alert tone="warning"><strong>请核对这些推断：</strong><ul>{needs.summary.assumptions.map((a) => <li key={a.entryId}>{a.text}</li>)}</ul></Alert>
        )}
        <p className="muted small">确认的是你看到的这一版（v{needs.version}），只能用上方的按钮；在聊天里说“确认”不算数。</p>
      </aside>

      {scene.active && (
        <SceneOverlay view={scene.active} busy={busy} onClose={scene.close} onAction={(id, a) => void actions.action(id, a)} onFeedback={actions.feedback} />
      )}
    </div>
  );
}
