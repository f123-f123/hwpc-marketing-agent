import { useEffect, useState } from "react";
import type { ChannelBindingView, StoreProfile } from "@hwpc/contracts";
import { marketingApi } from "../../api/marketing";
import { useAction, useLoad } from "../../lib/useLoad";
import type { Auth } from "../../state/useAuth";
import { Alert, Badge } from "../ui";

type ProfileInput = Omit<StoreProfile, "storeId" | "updatedAt">;

function ProfileForm({ auth, profile, onSaved }: { auth: Auth; profile: StoreProfile; onSaved: (p: StoreProfile) => void }) {
  const [form, setForm] = useState<ProfileInput>(profile);
  const [saved, setSaved] = useState(false);
  const act = useAction(auth.handleError);
  const set = (k: keyof ProfileInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setSaved(false);
    setForm({ ...form, [k]: e.target.value });
  };
  return (
    <form
      className="card form-card"
      onSubmit={async (e) => {
        e.preventDefault();
        const p = await act.run(() => marketingApi.saveProfile(form));
        if (p) {
          onSaved(p);
          setSaved(true);
        }
      }}
    >
      <h2 className="card-title">门店资料</h2>
      <p className="muted small">这些信息会让推文更像“本店写的”，而不是几千家店同一篇。到店引导和活动会原样附在文末，请如实填写。</p>
      <div className="form-grid">
        <label className="field"><span>门店名称 *</span><input className="input" value={form.name} onChange={set("name")} required maxLength={60} /></label>
        <label className="field"><span>城市</span><input className="input" value={form.city} onChange={set("city")} maxLength={30} placeholder="如：杭州" /></label>
        <label className="field"><span>商圈 / 地段</span><input className="input" value={form.area} onChange={set("area")} maxLength={60} placeholder="如：湖滨银泰 B1" /></label>
        <label className="field"><span>导购自称</span><input className="input" value={form.staffName} onChange={set("staffName")} maxLength={20} placeholder="如：小林（可不填）" /></label>
      </div>
      <label className="field"><span>主要客群</span><input className="input" value={form.audience} onChange={set("audience")} maxLength={200} placeholder="如：周边写字楼白领、附近高校学生" /></label>
      <label className="field"><span>到店 / 咨询引导 *</span><textarea className="textarea" rows={2} value={form.contactLine} onChange={set("contactLine")} required maxLength={200} placeholder="如：地址：湖滨路 18 号 1 楼，营业 10:00–22:00，电话 0571-xxxx" /></label>
      <label className="field"><span>本店真实活动</span><textarea className="textarea" rows={2} value={form.activity} onChange={set("activity")} maxLength={200} placeholder="没有就留空。留空时推文不会出现任何优惠。" /></label>
      {act.error && <Alert tone="danger">{act.error}</Alert>}
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={act.busy}>保存</button>
        {saved && <span className="small muted">已保存</span>}
      </div>
    </form>
  );
}

function WechatCard({ auth, view, onChange }: { auth: Auth; view: ChannelBindingView; onChange: (v: ChannelBindingView) => void }) {
  const [form, setForm] = useState({ displayName: view.displayName, appId: view.settings.appId ?? "", appSecret: "", publishMode: (view.settings.publishMode as "draft" | "publish") ?? "draft", author: view.settings.author ?? "" });
  const act = useAction(auth.handleError);
  useEffect(() => setForm((f) => ({ ...f, displayName: view.displayName, appId: view.settings.appId ?? f.appId })), [view]);
  return (
    <form
      className="card form-card"
      onSubmit={async (e) => {
        e.preventDefault();
        const v = await act.run(() => marketingApi.bindChannel({ channel: "wechat_mp", ...form, ...(form.appSecret ? {} : { appSecret: undefined }) }));
        if (v) {
          onChange(v);
          setForm((f) => ({ ...f, appSecret: "" }));
        }
      }}
    >
      <div className="card-head">
        <h2 className="card-title">微信公众号</h2>
        <Badge tone={view.bound ? "success" : "neutral"}>{view.bound ? "已绑定" : "未绑定"}</Badge>
      </div>
      <p className="muted small">填写公众号后台“设置与开发 → 基本配置”中的 AppID / AppSecret，并把服务器出口 IP 加入白名单。未绑定时只能复制图文手动发布。</p>
      <div className="form-grid">
        <label className="field"><span>公众号名称</span><input className="input" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></label>
        <label className="field"><span>作者署名</span><input className="input" value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} maxLength={16} /></label>
        <label className="field"><span>AppID</span><input className="input" value={form.appId} onChange={(e) => setForm({ ...form, appId: e.target.value })} autoComplete="off" /></label>
        <label className="field">
          <span>AppSecret{view.secretsSet.includes("appSecret") ? "（已保存，留空不修改）" : ""}</span>
          <input className="input" type="password" value={form.appSecret} onChange={(e) => setForm({ ...form, appSecret: e.target.value })} autoComplete="new-password" />
        </label>
      </div>
      <fieldset className="radio-row">
        <legend>发布方式</legend>
        <label><input type="radio" name="wx-mode" checked={form.publishMode === "draft"} onChange={() => setForm({ ...form, publishMode: "draft" })} /> 只存草稿箱，店长在后台确认后发布（推荐）</label>
        <label><input type="radio" name="wx-mode" checked={form.publishMode === "publish"} onChange={() => setForm({ ...form, publishMode: "publish" })} /> 存草稿后直接提交发布</label>
      </fieldset>
      {view.lastCheck && <Alert tone={view.lastCheck.ok ? "success" : "danger"}>连接测试：{view.lastCheck.message}（{new Date(view.lastCheck.at).toLocaleString()}）</Alert>}
      {act.error && <Alert tone="danger">{act.error}</Alert>}
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={act.busy}>保存</button>
        {view.bound && <button type="button" className="btn" disabled={act.busy} onClick={async () => { const v = await act.run(() => marketingApi.testChannel("wechat_mp")); if (v) onChange(v); }}>测试连接</button>}
        {view.updatedAt && <button type="button" className="btn btn-ghost" disabled={act.busy} onClick={async () => { const v = await act.run(() => marketingApi.unbindChannel("wechat_mp")); if (v) onChange(v); }}>解除绑定</button>}
      </div>
    </form>
  );
}

function XhsCard({ auth, view, onChange }: { auth: Auth; view: ChannelBindingView; onChange: (v: ChannelBindingView) => void }) {
  const [form, setForm] = useState({ displayName: view.displayName, mode: (view.settings.mode as "assist" | "api") ?? "assist", accountId: view.settings.accountId ?? "", accessToken: "" });
  const act = useAction(auth.handleError);
  return (
    <form
      className="card form-card"
      onSubmit={async (e) => {
        e.preventDefault();
        const v = await act.run(() => marketingApi.bindChannel({ channel: "xiaohongshu", ...form, ...(form.accessToken ? {} : { accessToken: undefined }) }));
        if (v) {
          onChange(v);
          setForm((f) => ({ ...f, accessToken: "" }));
        }
      }}
    >
      <div className="card-head">
        <h2 className="card-title">小红书</h2>
        <Badge tone={view.updatedAt ? "success" : "neutral"}>{view.updatedAt ? (view.settings.mode === "api" ? "接口发布" : "辅助发布") : "未设置"}</Badge>
      </div>
      <p className="muted small">辅助发布：系统复制好标题正文、保存图片并打开小红书，你粘贴发布后回填链接。接口发布：调用总部在“系统设置”里配置的发布接口。</p>
      <label className="field"><span>小红书账号（昵称或号码，用于核对）</span><input className="input" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></label>
      <fieldset className="radio-row">
        <legend>发布方式</legend>
        <label><input type="radio" name="xhs-mode" checked={form.mode === "assist"} onChange={() => setForm({ ...form, mode: "assist" })} /> 辅助发布（无需接口）</label>
        <label><input type="radio" name="xhs-mode" checked={form.mode === "api"} onChange={() => setForm({ ...form, mode: "api" })} /> 接口发布</label>
      </fieldset>
      {form.mode === "api" && (
        <div className="form-grid">
          <label className="field"><span>账号标识（发布接口侧）</span><input className="input" value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })} autoComplete="off" /></label>
          <label className="field">
            <span>访问令牌{view.secretsSet.includes("accessToken") ? "（已保存，留空不修改）" : "（如接口需要）"}</span>
            <input className="input" type="password" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} autoComplete="new-password" />
          </label>
        </div>
      )}
      {view.lastCheck && <Alert tone={view.lastCheck.ok ? "success" : "danger"}>检查：{view.lastCheck.message}</Alert>}
      {act.error && <Alert tone="danger">{act.error}</Alert>}
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={act.busy}>保存</button>
        {view.updatedAt && <button type="button" className="btn" disabled={act.busy} onClick={async () => { const v = await act.run(() => marketingApi.testChannel("xiaohongshu")); if (v) onChange(v); }}>检查</button>}
      </div>
    </form>
  );
}

export function PasswordCard({ auth }: { auth: Auth }) {
  const [oldPassword, setOld] = useState("");
  const [newPassword, setNew] = useState("");
  const act = useAction(auth.handleError);
  return (
    <form
      className="card form-card"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await act.run(() => marketingApi.changePassword(oldPassword, newPassword))) await auth.logout();
      }}
    >
      <h2 className="card-title">修改口令</h2>
      <p className="muted small">修改后需要重新登录，其他设备上的登录也会失效。</p>
      <div className="form-grid">
        <label className="field"><span>原口令</span><input className="input" type="password" autoComplete="current-password" value={oldPassword} onChange={(e) => setOld(e.target.value)} required /></label>
        <label className="field"><span>新口令（至少 8 位）</span><input className="input" type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(e) => setNew(e.target.value)} required /></label>
      </div>
      {act.error && <Alert tone="danger">{act.error}</Alert>}
      <button type="submit" className="btn" disabled={act.busy}>修改口令</button>
    </form>
  );
}

export function StoreSettings({ auth }: { auth: Auth }) {
  const profile = useLoad(() => marketingApi.myProfile(), [], auth.handleError);
  const channels = useLoad(() => marketingApi.channels(), [], auth.handleError);
  const setChannel = (v: ChannelBindingView) => channels.setData((list) => list?.map((c) => (c.channel === v.channel ? v : c)));
  const wx = channels.data?.find((c) => c.channel === "wechat_mp");
  const xhs = channels.data?.find((c) => c.channel === "xiaohongshu");

  return (
    <main className="page page-narrow">
      <header className="page-head"><h1 className="page-title">设置</h1></header>
      {(profile.error || channels.error) && <Alert tone="danger">{profile.error || channels.error}</Alert>}
      {profile.data && <ProfileForm auth={auth} profile={profile.data} onSaved={(p) => profile.setData(p)} />}
      <h2 className="subhead">平台账号</h2>
      {wx && <WechatCard auth={auth} view={wx} onChange={setChannel} />}
      {xhs && <XhsCard auth={auth} view={xhs} onChange={setChannel} />}
      <p className="muted small">朋友圈没有开放发布接口，发布时会帮你复制文案、保存图片；海报直接下载 PNG。</p>
      <PasswordCard auth={auth} />
    </main>
  );
}
