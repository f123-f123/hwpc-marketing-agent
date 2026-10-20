import { useState } from "react";
import { Icon, type IconName } from "../../components/ui";
import { FT_STEPS, PHOTOS, ftCoach, ftHint, ftInitial, ftReduce, ftView, type FtEvent, type FtHint, type FtState } from "../flows/fileTransfer";
import { Laptop, Phone, PhotoArtView, StageCoach, Taskbar, type StageProps } from "./devices";

const APPS: { id: string; label: string; icon: IconName; tone: string }[] = [
  { id: "gallery", label: "图库", icon: "image", tone: "app-a" },
  { id: "camera", label: "相机", icon: "camera", tone: "app-b" },
  { id: "files", label: "文件", icon: "folder", tone: "app-c" },
  { id: "settings", label: "设置", icon: "settings", tone: "app-d" },
  { id: "calendar", label: "日历", icon: "calendar", tone: "app-e" },
  { id: "notes", label: "备忘录", icon: "note", tone: "app-f" },
  { id: "music", label: "音乐", icon: "music", tone: "app-g" },
  { id: "mail", label: "邮件", icon: "mail", tone: "app-h" },
];

/**
 * 手机 → 电脑 文件互传：在虚拟手机上打开无线、选照片、分享给附近的电脑；在虚拟电脑上接收并打开核对。
 * 只有关键节点提交服务端动作（见 flows/fileTransfer.ts）。
 */
export function FileTransferStage({ view, disabled, onAction }: StageProps) {
  const server = view.experience.currentStateId as FtState;
  const [local, setLocal] = useState(ftInitial);
  const v = ftView(server, local);
  const coach = ftCoach(server, local);
  const hint = ftHint(server, local);
  const nx = (h: FtHint) => (!disabled && hint === h ? " is-next" : "");
  const dispatch = (e: FtEvent) => {
    if (disabled) return;
    const r = ftReduce(server, local, e);
    setLocal(r.local);
    if (r.action) onAction(r.action);
  };
  const photo = v.picked;

  return (
    <div className="stage-wrap">
      <StageCoach steps={FT_STEPS} {...coach} />
      <div className={`sim sim-ft${disabled ? " is-disabled" : ""}`}>
        <div className="sim-room" aria-hidden="true" />
        <div className="sim-desk" aria-hidden="true" />
        <div className="sim-devices">
          <Laptop label="示意电脑" tone="graphite">
            <div className="os-desktop os-wall-cool">
              <div className="os-icons">
                <span className="os-icon" aria-hidden="true"><Icon name="laptop" size={22} /><span>此电脑</span></span>
                <button type="button" className={`os-icon${v.received ? " is-new" : ""}${v.viewer ? "" : nx("open")}`} disabled={!v.received || disabled} onClick={() => dispatch({ type: "open_file" })} aria-label="打开「接收的文件」里的照片">
                  <Icon name="folder" size={22} /><span>接收的文件</span>
                </button>
              </div>

              {v.received && photo && (
                <section className={`os-window os-folder${v.viewer ? " is-behind" : ""}`} aria-label="接收的文件">
                  <header className="os-title"><Icon name="folder" size={12} />接收的文件<span className="os-title-actions" aria-hidden="true"><i /><i /><i /></span></header>
                  <div className="os-toolbar">
                    <button type="button" className="os-btn" disabled={disabled || v.viewer} onClick={() => dispatch({ type: "open_file" })}>打开</button>
                    <span className="os-muted">1 个项目</span>
                  </div>
                  <button type="button" className={`os-file${nx("open")}`} disabled={disabled || v.viewer} onDoubleClick={() => dispatch({ type: "open_file" })} onClick={(e) => e.detail === 0 && dispatch({ type: "open_file" })} aria-label={`${photo.name}，${photo.size}，双击打开`}>
                    <PhotoArtView art={photo.art} className="os-file-thumb" />
                    <span className="os-file-name">{photo.name}</span>
                    <span className="os-muted">{photo.size}</span>
                    <span className="os-muted">刚刚</span>
                  </button>
                </section>
              )}

              {v.viewer && photo && (
                <section className="os-window os-viewer" aria-label="照片查看">
                  <header className="os-title"><Icon name="image" size={12} />{photo.name}<span className="os-title-actions" aria-hidden="true"><i /><i /><i /></span></header>
                  <PhotoArtView art={photo.art} className="os-viewer-img" />
                  <footer className="os-viewer-info"><span>{photo.size}</span><span>{photo.pixels}</span><span className="os-ok"><Icon name="check" size={12} />能打开</span></footer>
                </section>
              )}

              {v.request && photo && (
                <section className="os-toast" aria-label="接收请求" role="alertdialog">
                  <p className="os-toast-head"><Icon name="phone" size={12} />附近设备</p>
                  <p className="os-toast-title">「示意手机」想发送 1 张照片</p>
                  <div className="os-toast-file">
                    <PhotoArtView art={photo.art} className="os-toast-thumb" />
                    <span><span className="os-file-name">{photo.name}</span><span className="os-muted">{photo.size}</span></span>
                  </div>
                  <div className="os-toast-actions">
                    <button type="button" className="os-btn" disabled={disabled} onClick={() => dispatch({ type: "decline" })}>拒绝</button>
                    <button type="button" className={`os-btn os-btn-primary${nx("accept")}`} disabled={disabled} onClick={() => dispatch({ type: "accept" })}>接收</button>
                  </div>
                </section>
              )}
              <Taskbar />
            </div>
          </Laptop>

          <Phone label="示意手机">
            <div className={`ph ${v.phone === "home" ? "ph-wall" : "ph-light"}`}>
              <button type="button" className={`ph-status${nx("status")}`} disabled={disabled || server !== "start"} onClick={() => dispatch({ type: "panel", open: !local.panel })} aria-expanded={v.panel} aria-label="状态栏：点按下拉控制面板">
                <span>17:24</span>
                <span className="ph-status-icons">
                  {v.wlan && <Icon name="wifi" size={11} />}
                  {v.bt && <Icon name="bluetooth" size={11} />}
                  <span className="ph-battery" aria-hidden="true" />
                </span>
              </button>

              {v.phone === "home" && (
                <div className="ph-home">
                  <div className="ph-clock" aria-hidden="true"><strong>17:24</strong><span>10月19日 星期日</span></div>
                  <div className="ph-apps">
                    {APPS.map((a) => (
                      <button key={a.id} type="button" className={`ph-app${a.id === "gallery" ? nx("gallery") : ""}`} disabled={disabled || a.id !== "gallery" || server === "start"} title={a.id === "gallery" ? undefined : "演示中只开放图库"} onClick={() => dispatch({ type: "app", app: "gallery" })}>
                        <span className={`ph-app-icon ${a.tone}`}><Icon name={a.icon} size={18} /></span>
                        <span>{a.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {v.phone !== "home" && (
                <div className="ph-gallery">
                  <header className="ph-bar">
                    <button type="button" className="ph-back" disabled={disabled || v.phone !== "gallery"} onClick={() => dispatch({ type: "app", app: "home" })} aria-label="返回桌面"><Icon name="back" size={14} /></button>
                    <strong>图库</strong>
                    <span className="ph-muted">最近项目</span>
                  </header>
                  <div className={`ph-grid${nx("photo")}`}>
                    {PHOTOS.map((p) => (
                      <button key={p.id} type="button" className={`ph-thumb${photo?.id === p.id ? " is-picked" : ""}`} disabled={disabled || v.phone !== "gallery"} aria-pressed={photo?.id === p.id} aria-label={`照片 ${p.name}`} onClick={() => dispatch({ type: "pick", photoId: p.id })}>
                        <PhotoArtView art={p.art} />
                        {photo?.id === p.id && <span className="ph-check"><Icon name="check" size={10} /></span>}
                      </button>
                    ))}
                  </div>
                  <footer className="ph-actions">
                    <span className="ph-muted">{local.picked ? "已选 1 项" : "点照片选中"}</span>
                    <button type="button" className={`ph-share${nx("share")}`} disabled={disabled || !local.picked || v.phone !== "gallery"} onClick={() => dispatch({ type: "sheet", open: true })}><Icon name="send" size={13} />分享</button>
                  </footer>
                </div>
              )}

              {v.phone === "waiting" && <p className="ph-toast" role="status">正在等待「示意电脑」接收…</p>}
              {v.phone === "declined" && (
                <div className="ph-toast ph-toast-warn" role="status">
                  <span>「示意电脑」拒绝了接收</span>
                  <button type="button" className={`ph-link${nx("resend")}`} disabled={disabled} onClick={() => dispatch({ type: "resend" })}>重新发送</button>
                </div>
              )}
              {v.phone === "sent" && photo && <p className="ph-toast ph-toast-ok" role="status"><Icon name="check" size={12} />已发送 {photo.size}</p>}

              {v.panel && (
                <div className="ph-panel" role="dialog" aria-label="控制面板">
                  <div className="ph-tiles">
                    <button type="button" className={`ph-tile${local.wlan ? " is-on" : ""}${nx("wlan")}`} aria-pressed={local.wlan} disabled={disabled} onClick={() => dispatch({ type: "toggle", radio: "wlan" })}><Icon name="wifi" size={16} /><span>WLAN</span></button>
                    <button type="button" className={`ph-tile${local.bt ? " is-on" : ""}${nx("bt")}`} aria-pressed={local.bt} disabled={disabled} onClick={() => dispatch({ type: "toggle", radio: "bt" })}><Icon name="bluetooth" size={16} /><span>蓝牙</span></button>
                    <span className="ph-tile is-on" aria-hidden="true"><Icon name="signal" size={16} /><span>移动数据</span></span>
                    <span className="ph-tile" aria-hidden="true"><Icon name="moon" size={16} /><span>勿扰</span></span>
                  </div>
                  <span className="ph-slider" aria-hidden="true"><i /></span>
                  <button type="button" className="ph-link" onClick={() => dispatch({ type: "panel", open: false })}>收起</button>
                </div>
              )}

              {v.sheet && photo && (
                <div className="ph-sheet" role="dialog" aria-label="分享">
                  <div className="ph-sheet-head">
                    <PhotoArtView art={photo.art} className="ph-sheet-thumb" />
                    <span><strong>分享 1 张照片</strong><span className="ph-muted">{photo.size}</span></span>
                  </div>
                  <p className="ph-sheet-label">附近设备</p>
                  <div className="ph-sheet-row">
                    <button type="button" className={`ph-peer${nx("peer")}`} disabled={disabled} onClick={() => dispatch({ type: "send_to_pc" })}>
                      <span className="ph-peer-icon"><Icon name="laptop" size={18} /></span>
                      <span>示意电脑</span>
                    </button>
                  </div>
                  <p className="ph-sheet-label">应用</p>
                  <div className="ph-sheet-row" aria-hidden="true">
                    {(["message", "mail", "note"] as const).map((i) => <span key={i} className="ph-peer is-dim"><span className="ph-peer-icon"><Icon name={i} size={16} /></span><span>{i === "message" ? "信息" : i === "mail" ? "邮件" : "备忘录"}</span></span>)}
                  </div>
                  <button type="button" className="ph-link" onClick={() => dispatch({ type: "sheet", open: false })}>取消</button>
                </div>
              )}
            </div>
          </Phone>
        </div>
      </div>
      <div className="stage-tools">
        <span className="muted small">屏幕里的界面是通用示意，不是官方界面；真实菜单名称与位置以官方页面为准。</span>
        {v.canDisconnect && <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => dispatch({ type: "disconnect" })}>断开连接，重来一遍</button>}
      </div>
    </div>
  );
}
