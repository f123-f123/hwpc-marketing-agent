import { useState } from "react";
import { Icon, type IconName } from "../../components/ui";
import {
  CB_STEPS, PC_FILE, PHONE_DOCS, PHONE_PHOTOS, appFor, cbCoach, cbHint, cbInitial, cbReduce, cbView,
  type CbApp, type CbContent, type CbEvent, type CbFile, type CbHint, type CbState,
} from "../flows/collab";
import { Laptop, Phone, PhotoArtView, StageCoach, Taskbar, type StageProps } from "./devices";
import { ReplayTools, useReplay } from "./replay";
import { useDrag } from "./useDrag";

type Drag = { kind: "phone" } | { kind: "file"; file: CbFile };

const KIND_ICON: Record<CbFile["kind"], IconName> = { photo: "image", doc: "doc", sheet: "plan", pdf: "note" };

const APPS: { id: CbApp | null; label: string; icon: IconName; tone: string }[] = [
  { id: "gallery", label: "图库", icon: "image", tone: "app-a" },
  { id: "files", label: "文件", icon: "folder", tone: "app-c" },
  { id: null, label: "相机", icon: "camera", tone: "app-b" },
  { id: null, label: "设置", icon: "settings", tone: "app-d" },
  { id: null, label: "日历", icon: "calendar", tone: "app-e" },
  { id: null, label: "备忘录", icon: "note", tone: "app-f" },
  { id: null, label: "音乐", icon: "music", tone: "app-g" },
  { id: null, label: "邮件", icon: "mail", tone: "app-h" },
];

function FileThumb({ f, className }: { f: CbFile; className: string }) {
  return f.art ? <PhotoArtView art={f.art} className={className} /> : <span className={`${className} cb-docthumb cb-kind-${f.kind}`}><Icon name={KIND_ICON[f.kind]} size={16} /></span>;
}

/**
 * 手机里的界面：真机和电脑上的手机窗口画的是同一份，状态同步。
 * 只有电脑上的手机窗口里的文件可以拖出来（用鼠标在电脑上操作手机）。
 */
function PhoneApp({ app, onApp, toPhone, disabled, mirror, nx, source, draggingId }: {
  app: CbApp;
  onApp: (app: CbApp) => void;
  toPhone: CbFile[];
  disabled: boolean;
  mirror: boolean;
  nx: (h: CbHint) => string;
  source?: (f: CbFile) => object;
  draggingId?: string;
}) {
  const appHint = (id: CbApp | null) => (mirror && id ? nx("app") : "");
  if (app === "home") {
    return (
      <div className="ph-home">
        <div className="ph-clock" aria-hidden="true"><strong>17:24</strong><span>10月19日 星期日</span></div>
        <div className="ph-apps">
          {APPS.map((a) => (
            <button key={a.label} type="button" className={`ph-app${appHint(a.id)}`} disabled={disabled || !a.id} title={a.id ? undefined : "演示中只开放图库和文件"} onClick={() => a.id && onApp(a.id)}>
              <span className={`ph-app-icon ${a.tone}`}><Icon name={a.icon} size={18} /></span>
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }
  const drag = (f: CbFile) => (mirror && source ? source(f) : {});
  const lifted = (f: CbFile) => (draggingId === f.id ? " is-lifted" : "");
  return (
    <div className="ph-gallery">
      <header className="ph-bar">
        <button type="button" className="ph-back" disabled={disabled} onClick={() => onApp("home")} aria-label="返回桌面"><Icon name="back" size={14} /></button>
        <strong>{app === "gallery" ? "图库" : "文件"}</strong>
        <span className="ph-muted">{app === "gallery" ? "最近项目" : "最近"}</span>
      </header>
      {app === "gallery" ? (
        <div className={`ph-grid${mirror ? nx("file") : ""}`}>
          {PHONE_PHOTOS.map((p) => (
            <span key={p.id} className={`ph-thumb${mirror ? " drag-src" : ""}${lifted(p)}`} {...drag(p)} aria-label={mirror ? `照片 ${p.name}：拖到电脑桌面` : undefined}>
              <PhotoArtView art={p.art!} />
            </span>
          ))}
        </div>
      ) : (
        <ul className={`cb-files${mirror ? nx("file") : ""}`}>
          {toPhone.map((f) => (
            <li key={f.id} className="cb-file is-new"><FileThumb f={f} className="cb-file-icon" /><span className="cb-file-name">{f.name}<span className="ph-muted">来自电脑 · {f.size}</span></span></li>
          ))}
          {PHONE_DOCS.map((f) => (
            <li key={f.id} className={`cb-file${mirror ? " drag-src" : ""}${lifted(f)}`} {...drag(f)}>
              <FileThumb f={f} className="cb-file-icon" /><span className="cb-file-name">{f.name}<span className="ph-muted">{f.size}</span></span>
            </li>
          ))}
        </ul>
      )}
      <footer className="ph-actions"><span className="ph-muted">{mirror ? "按住拖到电脑桌面" : "在电脑上也能操作"}</span></footer>
    </div>
  );
}

/**
 * 【MOCK】手机与电脑协同：拖手机靠近电脑、在手机上确认；电脑上出现手机窗口，
 * 把照片或文档从窗口拖到电脑桌面，再把电脑上的文件拖回手机。只有关键节点提交服务端动作（见 flows/collab.ts）。
 */
export function CollabStage({ view, disabled, onAction }: StageProps) {
  const replay = useReplay(view, onAction);
  const server = replay.current as CbState;
  const content: CbContent = view.instance.params.content === "doc" ? "doc" : "photo";
  const [local, setLocal] = useState(cbInitial);
  const v = cbView(server, local, content);
  const coach = cbCoach(server, local, content);
  const hint = cbHint(server, local, content);
  const nx = (h: CbHint) => (!disabled && hint === h ? " is-next" : "");
  const dispatch = (e: CbEvent) => {
    if (disabled) return;
    const r = cbReduce(server, local, e);
    setLocal(r.local);
    if (r.action) replay.act(r.action);
  };
  const dnd = useDrag<Drag>((d, zone) => {
    if (d.kind === "phone" && zone === "laptop") dispatch({ type: "near" });
    if (d.kind === "file" && d.file.id !== PC_FILE.id && zone === "desktop") dispatch({ type: "drop_pc", fileId: d.file.id });
    if (d.kind === "file" && d.file.id === PC_FILE.id && (zone === "phonewin" || zone === "phone")) dispatch({ type: "drop_phone", fileId: d.file.id });
  });
  const over = (z: string) => (dnd.drag?.over === z ? " is-over" : "");
  const fileSource = (f: CbFile) => dnd.source({ kind: "file", file: f }, !disabled && server !== "idle");
  const draggingId = dnd.drag?.item.kind === "file" ? dnd.drag.item.file.id : undefined;
  const phoneApp = (mirror: boolean) => (
    <PhoneApp app={v.app} onApp={(app) => dispatch({ type: "app", app })} toPhone={v.toPhone} disabled={disabled || server === "idle"} mirror={mirror} nx={nx} source={fileSource} draggingId={draggingId} />
  );
  const f = v.dropped;
  const pcFileDraggable = server === "done" && !v.toPhone.length;

  return (
    <div className="stage-wrap">
      <StageCoach steps={CB_STEPS} {...coach} />
      <div ref={dnd.host} {...dnd.hostProps} className={`sim sim-cb${disabled ? " is-disabled" : ""}`}>
        <div className="sim-room" aria-hidden="true" />
        <div className="sim-desk" aria-hidden="true" />
        <div className="sim-devices">
          <div className={`cb-laptop-zone${over("laptop")}`} ref={dnd.zone("laptop")}>
            <Laptop label="示意电脑">
              <div className={`os-desktop os-wall-cool${over("desktop")}`} ref={server !== "idle" ? dnd.zone("desktop") : undefined}>
                <div className="os-icons">
                  <span className="os-icon" aria-hidden="true"><Icon name="laptop" size={22} /><span>此电脑</span></span>
                  <span className={`os-icon drag-src${pcFileDraggable ? nx("pcfile") : ""}${draggingId === PC_FILE.id ? " is-lifted" : ""}`} {...dnd.source({ kind: "file", file: PC_FILE }, !disabled && server === "done")} aria-label={`${PC_FILE.name}${server === "done" ? "：拖进手机窗口" : ""}`}>
                    <Icon name="doc" size={22} /><span>会议纪要</span>
                  </span>
                  {f && (
                    <button type="button" className="os-icon is-new" disabled={disabled} onClick={() => dispatch({ type: "open", open: true })} aria-label={`打开 ${f.name}`}>
                      <FileThumb f={f} className="cb-desk-thumb" /><span>{f.name.replace(/\.[^.]+$/, "").slice(0, 8)}</span>
                    </button>
                  )}
                </div>

                {v.mirror && (
                  <section className={`os-window cb-mirror${over("phonewin")}`} ref={dnd.zone("phonewin")} aria-label="手机窗口">
                    <header className="os-title"><Icon name="phone" size={12} />示意手机<span className="os-title-actions" aria-hidden="true"><i /><i /><i /></span></header>
                    <div className="cb-mirror-screen ph ph-light">{phoneApp(true)}</div>
                  </section>
                )}

                {v.viewer && f && (
                  <section className="os-window cb-viewer" aria-label={f.name}>
                    <header className="os-title"><Icon name={KIND_ICON[f.kind]} size={12} />{f.name}
                      <button type="button" className="os-title-btn" onClick={() => dispatch({ type: "open", open: false })} aria-label="关闭"><Icon name="close" size={11} /></button>
                    </header>
                    {f.art ? <PhotoArtView art={f.art} className="os-viewer-img" /> : <div className="os-doc-body" aria-hidden="true"><b /><i /><i /><i className="short" /><b /><i /><i /><i className="short" /></div>}
                    <footer className="os-viewer-info"><span>{f.size}</span><span className="os-ok"><Icon name="check" size={12} />已从手机拖到电脑</span></footer>
                  </section>
                )}

                {v.ask && (
                  <section className="os-toast" role="status">
                    <p className="os-toast-head"><Icon name="phone" size={12} />附近设备</p>
                    <p className="os-toast-title">发现「示意手机」</p>
                    <p className="os-muted">请在手机上确认连接</p>
                  </section>
                )}
                <Taskbar />
              </div>
            </Laptop>
          </div>

          <div
            className={`cb-phone${v.near ? " is-near" : ""}${server === "idle" && !v.near ? ` drag-src${nx("phone")}` : ""}${dnd.drag?.item.kind === "phone" ? " is-lifted" : ""}${over("phone")}`}
            ref={server === "done" ? dnd.zone("phone") : undefined}
            {...dnd.source({ kind: "phone" }, !disabled && server === "idle" && !v.near)}
          >
            <Phone label="示意手机">
              <div className={`ph ${v.app === "home" && !v.ask ? "ph-wall" : "ph-light"}`}>
                <div className="ph-status" aria-hidden="true">
                  <span>17:24</span>
                  <span className="ph-status-icons"><Icon name="wifi" size={11} /><Icon name="bluetooth" size={11} /><span className="ph-battery" /></span>
                </div>
                {v.mirror && <p className="cb-banner"><Icon name="laptop" size={11} />已连接到「示意电脑」</p>}
                {phoneApp(false)}
                {v.toPhone.length > 0 && <p className="ph-toast ph-toast-ok" role="status"><Icon name="check" size={12} />收到来自电脑的 {v.toPhone[0]!.name}</p>}
                {v.ask && (
                  <div className="ph-sheet" role="alertdialog" aria-label="连接确认">
                    <div className="ph-sheet-head">
                      <span className="ph-peer-icon"><Icon name="laptop" size={18} /></span>
                      <span><strong>连接到「示意电脑」？</strong><span className="ph-muted">连接后可以在电脑上操作手机、互传文件</span></span>
                    </div>
                    <div className="cb-ask-actions">
                      <button type="button" className="os-btn" disabled={disabled} onClick={() => dispatch({ type: "cancel" })}>取消</button>
                      <button type="button" className={`os-btn os-btn-primary${nx("confirm")}`} disabled={disabled} onClick={() => dispatch({ type: "confirm" })}>连接</button>
                    </div>
                  </div>
                )}
              </div>
            </Phone>
          </div>
        </div>

        {dnd.drag && (
          <div className="drag-ghost" style={{ left: dnd.drag.x, top: dnd.drag.y }} aria-hidden="true">
            {dnd.drag.item.kind === "phone" ? <Icon name="phone" size={28} /> : <FileThumb f={dnd.drag.item.file} className="cb-ghost-thumb" />}
          </div>
        )}
      </div>
      <div className="stage-tools">
        <span className="muted small">屏幕里的界面是通用示意，不是官方界面；该场景超出 PC 知识库范围，真实的连接方式与限制以官方说明为准。</span>
        {server === "idle" && !v.near && (
          <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => dispatch({ type: "near" })}>不方便拖动？直接把手机靠近电脑</button>
        )}
        {server === "connected" && v.app === appFor(content) && (
          <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => dispatch({ type: "drop_pc", fileId: (content === "photo" ? PHONE_PHOTOS : PHONE_DOCS)[0]!.id })}>不方便拖动？直接传第一个文件</button>
        )}
        {pcFileDraggable && (
          <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => dispatch({ type: "drop_phone", fileId: PC_FILE.id })}>不方便拖动？直接把会议纪要发到手机</button>
        )}
        <ReplayTools replay={replay} disabled={disabled} onReset={() => setLocal(cbInitial)} />
      </div>
    </div>
  );
}
