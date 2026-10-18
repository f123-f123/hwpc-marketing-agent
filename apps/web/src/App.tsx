/**
 * apps/web —— 门店选购顾问。
 * 首页收集第一句需求；进入会话后是工作台：左侧对话常驻，右侧按“需求 → 候选 → 体验 → 方案”分页。
 * 界面状态全部以后端快照为准，前端不推演业务状态。
 */
import type { SessionSnapshot } from "@hwpc/contracts";
import { Home } from "./components/Home";
import { Workspace } from "./components/Workspace";
import { Badge, Icon } from "./components/ui";
import { ORIGIN_LABEL } from "./lib/labels";
import { useBackendStatus, useSession } from "./state/useSession";

function SourceLine({ snap }: { snap: SessionSnapshot }) {
  const origin = ORIGIN_LABEL[snap.components.dataOrigin] ?? snap.components.dataOrigin;
  const engine = snap.components.engine.isMock ? "规则模拟顾问" : "在线顾问";
  return (
    <span className="topbar-meta">
      {snap.isMock && <Badge tone="warning">含模拟内容</Badge>}
      <span className="topbar-source">{origin} · {engine} · 需求 v{snap.needs.version}{snap.plan.current ? ` · 方案 v${snap.plan.current.version}` : ""}</span>
    </span>
  );
}

export function App() {
  const { snap, loading, busy, notice, actions } = useSession();
  const backend = useBackendStatus();

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>华为 PC</span>
          <span className="brand-sub">选购顾问</span>
        </span>
        <span className="spacer" />
        {snap && <SourceLine snap={snap} />}
        {snap && (
          <button type="button" className="btn btn-sm" onClick={actions.reset}>
            <Icon name="plus" />新咨询
          </button>
        )}
      </header>

      {notice && (
        <div className={`banner banner-${notice.tone}`} role={notice.tone === "danger" ? "alert" : "status"}>
          <span>{notice.text}</span>
          <span className="row">
            {!snap && notice.tone === "danger" && <button type="button" className="btn btn-sm" onClick={actions.retry}>重试</button>}
            <button type="button" className="btn btn-sm btn-ghost" onClick={actions.dismiss}>知道了</button>
          </span>
        </div>
      )}

      {loading ? (
        <div className="loading" aria-busy="true" aria-label="正在恢复咨询">
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-block" />
          <div className="skeleton skeleton-line" />
        </div>
      ) : snap ? (
        <Workspace key={snap.sessionId} snap={snap} busy={busy} actions={actions} />
      ) : (
        <Home busy={busy} status={backend.status} statusError={backend.error} onRetryStatus={() => void backend.reload()} onCreate={actions.create} />
      )}
    </div>
  );
}
