import { PLATFORM_NAME, storeProfileGaps } from "@hwpc/contracts";
import { marketingApi } from "../../api/marketing";
import { href } from "../../lib/router";
import { useLoad } from "../../lib/useLoad";
import type { Auth } from "../../state/useAuth";
import { Alert, Badge, EmptyState, Icon } from "../ui";
import { POST_STATUS } from "./labels";

export function StoreHome({ auth }: { auth: Auth }) {
  const tasks = useLoad(() => marketingApi.myCampaigns(), [], auth.handleError);
  const profile = useLoad(() => marketingApi.myProfile(), [], auth.handleError);
  const gaps = profile.data ? storeProfileGaps(profile.data) : [];

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">推广任务</h1>
          <p className="muted">总部下发的任务。选一个任务和平台，系统会按本店情况写好几个版本供你挑。</p>
        </div>
      </header>

      {gaps.length > 0 && (
        <Alert tone="warning" action={<a className="btn btn-sm" href={href("settings")}>去补充</a>}>
          生成推文前，请先在“设置 → 门店资料”里补充：{gaps.join("、")}。
        </Alert>
      )}
      {tasks.error && <Alert tone="danger" action={<button type="button" className="btn btn-sm" onClick={() => void tasks.reload()}>重试</button>}>{tasks.error}</Alert>}

      {tasks.loading && !tasks.data ? (
        <div className="stack"><div className="skeleton skeleton-block" /><div className="skeleton skeleton-block" /></div>
      ) : tasks.data && tasks.data.length === 0 ? (
        <EmptyState title="暂时没有推广任务">总部下发任务后会出现在这里。</EmptyState>
      ) : (
        <ul className="task-cards">
          {tasks.data?.map(({ campaign: c, posts }) => {
            const done = posts.filter((p) => p.status === "published").length;
            return (
              <li key={c.campaignId}>
                <a className="task-card" href={href("posts", c.campaignId)}>
                  <div className="task-card-head">
                    <h2>{c.title}</h2>
                    <Badge tone={done === posts.length ? "success" : "neutral"}>{done}/{posts.length} 已发布</Badge>
                  </div>
                  <p className="task-card-theme">{c.theme}</p>
                  <p className="muted small">{c.productNames.join("、")} · 面向 {c.audience}{c.dueAt ? ` · 截止 ${c.dueAt}` : ""}</p>
                  <div className="row">
                    {posts.map((p) => (
                      <Badge key={p.platform} tone={p.status === "published" ? "success" : p.status === "not_started" ? "neutral" : "primary"}>
                        {PLATFORM_NAME[p.platform]} · {POST_STATUS[p.status]}
                      </Badge>
                    ))}
                  </div>
                  <span className="task-card-go">开始 <Icon name="right" /></span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
