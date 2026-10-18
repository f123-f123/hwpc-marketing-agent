import { useState } from "react";
import type { ConnectionStatus } from "@hwpc/contracts";
import { ORIGIN_LABEL } from "../lib/labels";
import { Icon } from "./ui";

const EXAMPLES = [
  { title: "出差办公", text: "我常出差办公，主要写文档和开会，预算 6000 元，希望轻一点", ask: "会先问预算范围、已有设备和最不能妥协的条件" },
  { title: "手机传文件到电脑", text: "我有一台华为手机，想把照片和文件传到电脑，需要什么条件？", ask: "会先核对机型、系统版本和网络条件" },
  { title: "外接显示器办公", text: "在家想接显示器扩展屏幕，平时做表格、看资料", ask: "会先问显示器接口、是否需要边用边充" },
] as const;

const STEPS = [
  { title: "聊清需求", detail: "每轮最多 3 个问题，弄清用途、预算和硬条件。" },
  { title: "比较取舍", detail: "满足、不满足、需要妥协、证据不足分开列，附资料依据。" },
  { title: "动手体验", detail: "在示意空间里操作场景任务，看功能怎么帮到你。" },
  { title: "个人方案", detail: "你确认需求后才生成，可导出只读副本。" },
] as const;

export function Home({ busy, status, statusError, onRetryStatus, onCreate }: {
  busy: boolean;
  status: ConnectionStatus | null;
  statusError: string;
  onRetryStatus: () => void;
  onCreate: (text: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState("");
  const submit = (text: string) => {
    const t = text.trim();
    if (t && !busy) void onCreate(t);
  };

  const modelReal = status ? status.model.state === "connected" && status.model.provider !== "mock" : false;

  return (
    <main className="home">
      <section className="home-main" aria-labelledby="home-title">
        <p className="home-eyebrow">华为 PC · 门店选购顾问</p>
        <h1 id="home-title" className="home-title">先说说，你想用电脑做什么</h1>
        <p className="home-lede">我会先了解用途、预算和已有设备，再给出有依据的候选和取舍，并安排可以动手试的场景。你确认需求之后，才会生成个人方案。</p>

        <form className="home-composer" onSubmit={(e) => { e.preventDefault(); submit(draft); }}>
          <label className="sr-only" htmlFor="first-need">描述你的使用需求</label>
          <textarea
            id="first-need"
            className="home-input"
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(draft); }
            }}
            placeholder="例如：常出差，要处理大表格，也想把手机里的文件传到电脑"
          />
          <div className="home-composer-bar">
            <span className="muted small">不用一次说全 · Enter 发送，Shift+Enter 换行</span>
            <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>
              {busy ? "正在开始…" : "开始咨询"}
              {!busy && <Icon name="send" />}
            </button>
          </div>
        </form>

        <h2 className="home-subhead">或者从常见场景开始</h2>
        <div className="home-examples">
          {EXAMPLES.map((ex) => (
            <button key={ex.title} type="button" className="home-example" disabled={busy} onClick={() => submit(ex.text)}>
              <strong>{ex.title}</strong>
              <span>{ex.text}</span>
              <small>{ex.ask}</small>
            </button>
          ))}
        </div>
      </section>

      <aside className="home-side">
        <figure className="home-visual">
          <img src="/media/home-collab.jpg" alt="多人在窗边使用笔记本电脑协作的场景示意" width={984} height={588} />
          <figcaption>华为商城电脑专区素材，仅作场景氛围展示，具体功能以型号资料为准。</figcaption>
        </figure>

        <section className="card" aria-labelledby="home-steps">
          <h2 id="home-steps" className="card-title">接下来会怎样</h2>
          <ol className="home-steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="home-step-no" aria-hidden="true">{i + 1}</span>
                <div><strong>{s.title}</strong><p>{s.detail}</p></div>
              </li>
            ))}
          </ol>
        </section>

        <section className="card" aria-labelledby="home-status">
          <h2 id="home-status" className="card-title">当前服务</h2>
          {statusError ? (
            <div className="stack">
              <p className="home-status-error" role="alert">{statusError}</p>
              <button type="button" className="btn btn-sm" onClick={onRetryStatus}>重试连接</button>
            </div>
          ) : (
            <dl className="kv">
              <dt>资料来源</dt>
              <dd className={status?.activeDataOrigin === "mock" ? "is-warn" : undefined}>{status ? (ORIGIN_LABEL[status.activeDataOrigin] ?? status.activeDataOrigin) : "检查中…"}</dd>
              <dt>顾问</dt>
              <dd className={status && !modelReal ? "is-warn" : undefined}>{status ? (modelReal ? "在线模型" : "规则模拟（未接入模型）") : "检查中…"}</dd>
              <dt>进度保存</dt>
              <dd>保存在本机服务端，刷新可恢复</dd>
            </dl>
          )}
          <p className="muted small">模拟内容会在界面上始终标注，不会当作真机结果。</p>
        </section>
      </aside>
    </main>
  );
}
