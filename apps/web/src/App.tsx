/**
 * apps/web —— 华为 PC 门店助手。两个模块：
 * - 选购顾问（#/advisor，默认）：面向到店顾客，无需登录。先在“需求沟通”里聊清楚并确认，
 *   再进入全屏体验页（候选、三维空间与场景、方案），页面里可以侧边提问。
 * - 推文（#/posts、#/hq）：门店导购按总部任务生成、挑选、发布推文；总部下发任务、看进度、做系统设置。需要登录。
 * 界面状态全部以后端返回为准，前端不推演业务状态。
 */
import { useEffect, useState, type ReactNode } from "react";
import type { SessionSnapshot, User } from "@hwpc/contracts";
import { Home } from "./components/Home";
import { Consult } from "./components/Consult";
import { ImmersivePage } from "./components/page/ImmersivePage";
import { CampaignWorkbench } from "./components/marketing/CampaignWorkbench";
import { HqCampaigns, HqProgress } from "./components/marketing/HqCampaigns";
import { HqSettings } from "./components/marketing/HqSettings";
import { LoginPage } from "./components/marketing/LoginPage";
import { StoreHome } from "./components/marketing/StoreHome";
import { StoreSettings } from "./components/marketing/StoreSettings";
import { Badge, EmptyState, Icon } from "./components/ui";
import { ORIGIN_LABEL } from "./lib/labels";
import { href, useRoute } from "./lib/router";
import { useAuth, type Auth } from "./state/useAuth";
import { useBackendStatus, useSession } from "./state/useSession";

function Topbar({ section, user, onLogout, children }: { section: "advisor" | "posts" | "settings"; user: User | null; onLogout: () => void; children?: ReactNode }) {
  const postsHref = user?.role === "hq" ? href("hq") : href("posts");
  return (
    <header className="topbar">
      <span className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span>华为 PC</span>
        <span className="brand-sub">门店助手</span>
      </span>
      <nav className="topnav" aria-label="模块">
        <a href={href("advisor")} aria-current={section === "advisor" ? "page" : undefined}>选购顾问</a>
        <a href={postsHref} aria-current={section === "posts" ? "page" : undefined}>{user?.role === "hq" ? "推广任务" : "推文发布"}</a>
        {user && <a href={href("settings")} aria-current={section === "settings" ? "page" : undefined}>设置</a>}
      </nav>
      <span className="spacer" />
      {children}
      {user && (
        <span className="topbar-user">
          <span className="topbar-source">{user.displayName}</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onLogout}>退出</button>
        </span>
      )}
    </header>
  );
}

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

/** 选购顾问：需求沟通 → 全屏体验页。有体验页时默认进入体验页，可以随时回到需求沟通。 */
function Advisor({ auth }: { auth: Auth }) {
  const { snap, loading, busy, notice, actions } = useSession();
  const backend = useBackendStatus();
  const [mode, setMode] = useState<"consult" | "page">("page");
  useEffect(() => {
    if (!snap) setMode("page");
  }, [snap]);
  const goto = (next: "consult" | "page") => {
    setMode(next);
    window.scrollTo({ top: 0 });
  };

  if (snap?.page && mode === "page") {
    return <ImmersivePage key={snap.page.pageId} snap={snap} page={snap.page} busy={busy} notice={notice} actions={actions} onConsult={() => goto("consult")} />;
  }
  return (
    <>
      <Topbar section="advisor" user={auth.user} onLogout={() => void auth.logout()}>
        {snap && <SourceLine snap={snap} />}
        {snap && (
          <button type="button" className="btn btn-sm" onClick={actions.reset} aria-label="新咨询">
            <Icon name="plus" /><span className="btn-label">新咨询</span>
          </button>
        )}
      </Topbar>
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
        <Consult key={snap.sessionId} snap={snap} busy={busy} actions={actions} onPage={() => goto("page")} />
      ) : (
        <Home busy={busy} status={backend.status} statusError={backend.error} onRetryStatus={() => void backend.reload()} onCreate={actions.create} />
      )}
    </>
  );
}

/** 推文模块：先登录，再按角色进入门店或总部页面。 */
function Marketing({ auth, route }: { auth: Auth; route: string[] }) {
  const section = route[0] === "settings" ? "settings" : "posts";
  const top = <Topbar section={section} user={auth.user} onLogout={() => void auth.logout()} />;
  if (auth.checking) return <>{top}<div className="loading"><div className="skeleton skeleton-block" /></div></>;
  if (!auth.user) return <>{top}<LoginPage auth={auth} /></>;

  const user = auth.user;
  let page: ReactNode;
  if (route[0] === "settings") page = user.role === "hq" ? <HqSettings auth={auth} /> : <StoreSettings auth={auth} />;
  else if (user.role === "hq") {
    if (route[0] === "hq" && route[1] === "campaigns" && route[2]) page = <HqProgress auth={auth} campaignId={route[2]} />;
    else if (route[0] === "hq" && route[1] === "stores") page = <HqSettings auth={auth} />;
    else page = <HqCampaigns auth={auth} />;
  } else if (route[0] === "posts" && route[1]) page = <CampaignWorkbench auth={auth} campaignId={route[1]} />;
  else if (route[0] === "hq") page = <main className="page"><EmptyState title="这是总部页面" action={<a className="btn" href={href("posts")}>回到推文发布</a>}>当前登录的是门店账号。</EmptyState></main>;
  else page = <StoreHome auth={auth} />;
  return <>{top}{page}</>;
}

export function App() {
  const route = useRoute();
  const auth = useAuth();
  const isMarketing = route[0] === "posts" || route[0] === "hq" || route[0] === "settings";
  return <div className="app">{isMarketing ? <Marketing auth={auth} route={route} /> : <Advisor auth={auth} />}</div>;
}
