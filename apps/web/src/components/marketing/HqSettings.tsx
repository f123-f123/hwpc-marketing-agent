import { useEffect, useState } from "react";
import type { SystemSettingsInput } from "@hwpc/contracts";
import { marketingApi } from "../../api/marketing";
import { useAction, useLoad } from "../../lib/useLoad";
import type { Auth } from "../../state/useAuth";
import { Alert, Badge } from "../ui";
import { PasswordCard } from "./StoreSettings";

function Stores({ auth }: { auth: Auth }) {
  const list = useLoad(() => marketingApi.stores(), [], auth.handleError);
  const [form, setForm] = useState({ storeId: "", name: "", password: "" });
  const [reset, setReset] = useState<{ storeId: string; password: string } | null>(null);
  const act = useAction(auth.handleError);
  return (
    <section className="card form-card" aria-labelledby="stores-title">
      <h2 id="stores-title" className="card-title">门店账号</h2>
      <p className="muted small">门店编号即登录账号。门店登录后自行填写门店资料、绑定公众号和小红书。</p>
      {list.data && (
        <ul className="store-list">
          {list.data.map((s) => (
            <li key={s.storeId}>
              <span><strong>{s.name}</strong> <span className="muted small">{s.storeId}{s.city ? ` · ${s.city}` : ""}</span></span>
              <span className="row">
                {!s.contactLine && <Badge tone="warning">资料未完善</Badge>}
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setReset({ storeId: s.storeId, password: "" })}>重置口令</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {reset && (
        <form className="row" onSubmit={async (e) => { e.preventDefault(); if (await act.run(() => marketingApi.resetStorePassword(reset.storeId, reset.password))) setReset(null); }}>
          <span className="small">为 {reset.storeId} 设置新口令：</span>
          <input className="input input-inline" type="password" minLength={8} required value={reset.password} onChange={(e) => setReset({ ...reset, password: e.target.value })} autoComplete="new-password" />
          <button type="submit" className="btn btn-sm btn-primary" disabled={act.busy}>确定</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setReset(null)}>取消</button>
        </form>
      )}
      <form
        className="form-grid form-grid-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await act.run(() => marketingApi.createStore(form))) {
            setForm({ storeId: "", name: "", password: "" });
            void list.reload();
          }
        }}
      >
        <label className="field"><span>门店编号</span><input className="input" value={form.storeId} onChange={(e) => setForm({ ...form, storeId: e.target.value })} pattern="[A-Za-z0-9_\-]{2,40}" required placeholder="如：hz-hubin" /></label>
        <label className="field"><span>门店名称</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
        <label className="field"><span>初始口令（至少 8 位）</span><input className="input" type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete="new-password" /></label>
        <button type="submit" className="btn btn-primary" disabled={act.busy}>添加门店</button>
      </form>
      {act.error && <Alert tone="danger">{act.error}</Alert>}
    </section>
  );
}

function System({ auth }: { auth: Auth }) {
  const view = useLoad(() => marketingApi.settings(), [], auth.handleError);
  const [form, setForm] = useState<SystemSettingsInput>({ model: { baseUrl: "", name: "", temperature: 0.85 }, wechat: { apiBase: "" }, xiaohongshu: { publishUrl: "" } });
  const [modelKey, setModelKey] = useState("");
  const [xhsKey, setXhsKey] = useState("");
  const [saved, setSaved] = useState(false);
  const act = useAction(auth.handleError);
  useEffect(() => {
    const v = view.data;
    if (v) setForm({ model: { baseUrl: v.model.baseUrl, name: v.model.name, temperature: v.model.temperature }, wechat: { apiBase: v.wechat.apiBase }, xiaohongshu: { publishUrl: v.xiaohongshu.publishUrl } });
  }, [view.data]);
  const v = view.data;
  const SOURCE = { settings: "使用本页设置", env: "使用服务端环境变量", none: "未配置，生成模板稿" } as const;

  return (
    <form
      className="card form-card"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(false);
        const next = await act.run(() =>
          marketingApi.saveSettings({
            model: { ...form.model, ...(modelKey ? { apiKey: modelKey } : {}) },
            wechat: form.wechat,
            xiaohongshu: { ...form.xiaohongshu, ...(xhsKey ? { apiKey: xhsKey } : {}) },
          }),
        );
        if (next) {
          view.setData(next);
          setModelKey("");
          setXhsKey("");
          setSaved(true);
        }
      }}
    >
      <div className="card-head">
        <h2 className="card-title">系统设置</h2>
        {v && <Badge tone={v.model.source === "none" ? "warning" : "success"}>写作模型：{SOURCE[v.model.source]}</Badge>}
      </div>

      <h3 className="subhead">写作模型（OpenAI 兼容接口）</h3>
      <p className="muted small">填好后门店生成推文时调用该模型。参数类事实由程序按知识库原文填入，模型只负责写法；温度越高写法越多样。</p>
      <div className="form-grid">
        <label className="field"><span>接口地址</span><input className="input" value={form.model.baseUrl} onChange={(e) => setForm({ ...form, model: { ...form.model, baseUrl: e.target.value } })} placeholder="https://api.example.com/v1" /></label>
        <label className="field"><span>模型名称</span><input className="input" value={form.model.name} onChange={(e) => setForm({ ...form, model: { ...form.model, name: e.target.value } })} placeholder="如：qwen-plus" /></label>
        <label className="field"><span>API Key{v?.model.apiKeySet ? "（已保存，留空不修改）" : ""}</span><input className="input" type="password" value={modelKey} onChange={(e) => setModelKey(e.target.value)} autoComplete="new-password" /></label>
        <label className="field"><span>写作温度：{form.model.temperature.toFixed(2)}</span><input type="range" min={0} max={1.3} step={0.05} value={form.model.temperature} onChange={(e) => setForm({ ...form, model: { ...form.model, temperature: Number(e.target.value) } })} /></label>
      </div>

      <h3 className="subhead">微信公众号接口</h3>
      <label className="field"><span>接口根地址（留空使用 https://api.weixin.qq.com；自建代理时填写）</span><input className="input" value={form.wechat.apiBase} onChange={(e) => setForm({ ...form, wechat: { apiBase: e.target.value } })} /></label>

      <h3 className="subhead">小红书发布接口</h3>
      <p className="muted small">留空时门店只能“辅助发布”。接口协议见 apps/server/README.md「小红书发布接口约定」。</p>
      <div className="form-grid">
        <label className="field"><span>发布接口地址</span><input className="input" value={form.xiaohongshu.publishUrl} onChange={(e) => setForm({ ...form, xiaohongshu: { ...form.xiaohongshu, publishUrl: e.target.value } })} placeholder="https://your-gateway/xhs/publish" /></label>
        <label className="field"><span>系统密钥{v?.xiaohongshu.apiKeySet ? "（已保存，留空不修改）" : ""}</span><input className="input" type="password" value={xhsKey} onChange={(e) => setXhsKey(e.target.value)} autoComplete="new-password" /></label>
      </div>

      {view.error && <Alert tone="danger">{view.error}</Alert>}
      {act.error && <Alert tone="danger">{act.error}</Alert>}
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={act.busy || !v}>保存设置</button>
        {saved && <span className="small muted">已保存，立即生效</span>}
      </div>
    </form>
  );
}

export function HqSettings({ auth }: { auth: Auth }) {
  return (
    <main className="page page-narrow">
      <header className="page-head"><h1 className="page-title">总部设置</h1></header>
      <System auth={auth} />
      <Stores auth={auth} />
      <PasswordCard auth={auth} />
    </main>
  );
}
