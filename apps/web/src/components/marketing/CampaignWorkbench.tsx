import { useState } from "react";
import { PLATFORM_NAME, storeProfileGaps, type Platform, type Post } from "@hwpc/contracts";
import { marketingApi } from "../../api/marketing";
import { href } from "../../lib/router";
import { useLoad } from "../../lib/useLoad";
import type { Auth } from "../../state/useAuth";
import { Alert, Badge, EmptyState, Icon } from "../ui";
import { POST_STATUS } from "./labels";
import { PostPanel } from "./PostPanel";

/** 一个推广任务的工作台：每个平台一个分页，分开生成、挑选、发布。 */
export function CampaignWorkbench({ auth, campaignId }: { auth: Auth; campaignId: string }) {
  const data = useLoad(
    async () => {
      const [views, channels, profile] = await Promise.all([marketingApi.myCampaigns(), marketingApi.channels(), marketingApi.myProfile()]);
      const view = views.find((v) => v.campaign.campaignId === campaignId);
      const posts: Partial<Record<Platform, Post>> = {};
      if (view) {
        const loaded = await Promise.all(view.posts.filter((p) => p.postId).map((p) => marketingApi.post(p.postId!)));
        for (const p of loaded) posts[p.platform] = p;
      }
      return { view, channels, profile, posts };
    },
    [campaignId],
    auth.handleError,
  );
  const [tab, setTab] = useState<Platform | undefined>();

  if (data.loading && !data.data) return <main className="page"><div className="skeleton skeleton-block" /></main>;
  if (data.error) return <main className="page"><Alert tone="danger" action={<button type="button" className="btn btn-sm" onClick={() => void data.reload()}>重试</button>}>{data.error}</Alert></main>;
  const d = data.data;
  if (!d?.view) return <main className="page"><EmptyState title="任务不存在或已结束" action={<a className="btn" href={href("posts")}>返回任务列表</a>} /></main>;

  const { campaign: c, posts: statuses } = d.view;
  const active = tab ?? c.platforms[0]!;
  const gaps = storeProfileGaps(d.profile);

  return (
    <main className="page">
      <a className="back-link" href={href("posts")}><Icon name="back" />全部任务</a>
      <header className="page-head">
        <div>
          <h1 className="page-title">{c.title}</h1>
          <p className="campaign-theme">{c.theme}</p>
          <p className="muted small">{c.productNames.join("、")} · 面向 {c.audience}{c.mustAvoid ? ` · 不要出现：${c.mustAvoid}` : ""}{c.dueAt ? ` · 截止 ${c.dueAt}` : ""}</p>
          {c.notes && <p className="muted small">总部备注：{c.notes}</p>}
        </div>
      </header>

      {gaps.length > 0 && (
        <Alert tone="warning" action={<a className="btn btn-sm" href={href("settings")}>去补充</a>}>
          生成前请先补充门店资料：{gaps.join("、")}。推文里的到店引导只会使用你填写的信息。
        </Alert>
      )}

      <nav className="platform-tabs" aria-label="发布平台">
        {c.platforms.map((p) => {
          const s = statuses.find((x) => x.platform === p)?.status ?? "not_started";
          return (
            <button key={p} type="button" className={`platform-tab${p === active ? " is-active" : ""}`} aria-current={p === active ? "page" : undefined} onClick={() => setTab(p)}>
              <span>{PLATFORM_NAME[p]}</span>
              <Badge tone={s === "published" ? "success" : s === "not_started" ? "neutral" : "primary"}>{POST_STATUS[s]}</Badge>
            </button>
          );
        })}
      </nav>

      {/* key 保证切换平台时各自的状态互不影响 */}
      <PostPanel
        key={active}
        auth={auth}
        campaign={c}
        platform={active}
        initial={d.posts[active]}
        channels={d.channels}
        storeName={d.profile.name}
        onChanged={(post) => {
          data.setData((old) => (old ? { ...old, posts: { ...old.posts, [post.platform]: post } } : old));
          void marketingApi
            .myCampaigns()
            .then((views) => data.setData((old) => (old ? { ...old, view: views.find((v) => v.campaign.campaignId === campaignId) } : old)))
            .catch(auth.handleError);
        }}
      />
    </main>
  );
}
