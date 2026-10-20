import { useState } from "react";
import { PLATFORM_NAME, type CampaignInput, type Platform } from "@hwpc/contracts";
import { marketingApi } from "../../api/marketing";
import { href, navigate } from "../../lib/router";
import { useAction, useLoad } from "../../lib/useLoad";
import type { Auth } from "../../state/useAuth";
import { Alert, Badge, EmptyState, Icon } from "../ui";
import { POST_STATUS } from "./labels";

const PLATFORMS: Platform[] = ["wechat_article", "xiaohongshu", "store_moments", "store_poster"];

function NewCampaign({ auth, onCreated }: { auth: Auth; onCreated: () => void }) {
  const products = useLoad(() => marketingApi.products(), [], auth.handleError);
  const [form, setForm] = useState<CampaignInput>({ title: "", products: [], theme: "", audience: "", platforms: [...PLATFORMS], mustAvoid: "不提价格；不与其他品牌比较", dueAt: "", notes: "" });
  const act = useAction(auth.handleError);
  const toggleProduct = (productId: string) =>
    setForm((f) => ({ ...f, products: f.products.some((p) => p.productId === productId) ? f.products.filter((p) => p.productId !== productId) : [...f.products, { productId }].slice(0, 3) }));
  const togglePlatform = (p: Platform) => setForm((f) => ({ ...f, platforms: f.platforms.includes(p) ? f.platforms.filter((x) => x !== p) : [...f.platforms, p] }));

  return (
    <form
      className="card form-card"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await act.run(() => marketingApi.createCampaign(form))) onCreated();
      }}
    >
      <h2 className="card-title">下发新任务</h2>
      <p className="muted small">任务就是门店推文的“已确认需求”：推什么、给谁看、发到哪、不能写什么。门店不必再回答这些问题。</p>
      <label className="field"><span>任务名称 *</span><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={60} placeholder="如：开学季轻薄本" /></label>
      <label className="field"><span>推广主题 *（想让顾客记住的一件事）</span><textarea className="textarea" rows={2} value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })} required maxLength={200} placeholder="如：宿舍到图书馆，一台电脑背着走" /></label>
      <label className="field"><span>目标人群 *</span><input className="input" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} required maxLength={120} placeholder="如：大一新生及家长" /></label>
      <fieldset className="check-grid">
        <legend>推广型号 *（1–3 个，事实只从这些型号的资料中取）</legend>
        {products.loading && <span className="muted small">正在读取资料库…</span>}
        {products.error && <Alert tone="danger">{products.error}</Alert>}
        {products.data?.map((p) => (
          <label key={p.productId} className="check">
            <input type="checkbox" checked={form.products.some((x) => x.productId === p.productId)} onChange={() => toggleProduct(p.productId)} disabled={!form.products.some((x) => x.productId === p.productId) && form.products.length >= 3} />
            {p.model}
          </label>
        ))}
      </fieldset>
      <fieldset className="check-grid">
        <legend>发布平台 *</legend>
        {PLATFORMS.map((p) => (
          <label key={p} className="check"><input type="checkbox" checked={form.platforms.includes(p)} onChange={() => togglePlatform(p)} />{PLATFORM_NAME[p]}</label>
        ))}
      </fieldset>
      <div className="form-grid">
        <label className="field"><span>不要出现</span><input className="input" value={form.mustAvoid} onChange={(e) => setForm({ ...form, mustAvoid: e.target.value })} maxLength={200} /></label>
        <label className="field"><span>截止日期</span><input className="input" type="date" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} /></label>
      </div>
      <label className="field"><span>给门店的备注</span><textarea className="textarea" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={500} /></label>
      {act.error && <Alert tone="danger">{act.error}</Alert>}
      <button type="submit" className="btn btn-primary" disabled={act.busy || form.products.length === 0 || form.platforms.length === 0}>下发任务</button>
    </form>
  );
}

export function HqCampaigns({ auth }: { auth: Auth }) {
  const list = useLoad(() => marketingApi.campaigns(), [], auth.handleError);
  const [creating, setCreating] = useState(false);
  const act = useAction(auth.handleError);

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">推广任务</h1>
          <p className="muted">下发给所有门店。门店按平台生成、挑选、发布，进度在这里汇总。</p>
        </div>
        {!creating && <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" />新任务</button>}
      </header>
      {creating && <NewCampaign auth={auth} onCreated={() => { setCreating(false); void list.reload(); }} />}
      {list.error && <Alert tone="danger">{list.error}</Alert>}
      {act.error && <Alert tone="danger">{act.error}</Alert>}
      {list.data && list.data.length === 0 && !creating && <EmptyState title="还没有任务" action={<button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>下发第一个任务</button>} />}
      <ul className="task-cards">
        {list.data?.map((c) => (
          <li key={c.campaignId}>
            <div className="task-card">
              <div className="task-card-head">
                <h2>{c.title}</h2>
                <Badge tone={c.status === "active" ? "success" : "neutral"}>{c.status === "active" ? "进行中" : "已结束"}</Badge>
              </div>
              <p className="task-card-theme">{c.theme}</p>
              <p className="muted small">{c.productNames.join("、")} · 面向 {c.audience} · {c.platforms.map((p) => PLATFORM_NAME[p]).join("、")}</p>
              <div className="row">
                <a className="btn btn-sm btn-primary" href={href("hq", "campaigns", c.campaignId)}>查看门店进度</a>
                <button type="button" className="btn btn-sm" disabled={act.busy} onClick={async () => { await act.run(() => marketingApi.setCampaignStatus(c.campaignId, c.status === "active" ? "archived" : "active")); void list.reload(); }}>
                  {c.status === "active" ? "结束任务" : "重新开启"}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

export function HqProgress({ auth, campaignId }: { auth: Auth; campaignId: string }) {
  const data = useLoad(() => marketingApi.progress(campaignId), [campaignId], auth.handleError);
  const p = data.data;
  const total = p ? p.stores.length * p.campaign.platforms.length : 0;
  const done = p ? p.stores.reduce((n, s) => n + s.platforms.filter((x) => x.status === "published").length, 0) : 0;
  return (
    <main className="page">
      <a className="back-link" href={href("hq")}><Icon name="back" />全部任务</a>
      {data.error && <Alert tone="danger">{data.error}</Alert>}
      {p && (
        <>
          <header className="page-head">
            <div>
              <h1 className="page-title">{p.campaign.title}</h1>
              <p className="muted">已发布 {done}/{total}（门店 × 平台）。“已发布”以接口返回或导购回填为准。</p>
            </div>
            <button type="button" className="btn btn-sm" onClick={() => void data.reload()}>刷新</button>
          </header>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">门店</th>
                  {p.campaign.platforms.map((pl) => <th key={pl} scope="col">{PLATFORM_NAME[pl]}</th>)}
                </tr>
              </thead>
              <tbody>
                {p.stores.map((s) => (
                  <tr key={s.storeId}>
                    <th scope="row">{s.storeName}<span className="muted small"> · {s.storeId}</span></th>
                    {s.platforms.map((x) => (
                      <td key={x.platform}>
                        <Badge tone={x.status === "published" ? "success" : x.status === "not_started" ? "neutral" : "primary"}>{POST_STATUS[x.status]}</Badge>
                        {x.url && <> <a href={x.url} target="_blank" rel="noopener" className="small">链接</a></>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {!p && !data.error && <div className="skeleton skeleton-block" />}
      {p && p.stores.length === 0 && <EmptyState title="还没有门店" action={<button type="button" className="btn" onClick={() => navigate("hq", "stores")}>去添加门店</button>} />}
    </main>
  );
}
