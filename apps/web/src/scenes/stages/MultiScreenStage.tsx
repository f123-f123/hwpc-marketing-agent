import { useRef, useState } from "react";
import { Badge, Icon } from "../../components/ui";
import { MS_STEPS, WIN_H, WIN_W, clampWin, msCoach, msHint, msInitial, msReduce, msView, type Mode, type MsEvent, type MsHint, type MsState, type ScreenId, type WinPos } from "../flows/multiScreen";
import { Laptop, Monitor, StageCoach, Taskbar, type StageProps } from "./devices";

/** 文档窗口（通用示意）。标题栏可拖动；键盘用户可以用方向键或标题栏按钮移动。 */
function DocWindow({ pos, copy, hint, onGrab, onKeyMove, moveLabel, onMoveOther, disabled }: {
  pos: WinPos;
  /** 镜像到显示器上的副本：只显示，不能操作。 */
  copy?: boolean;
  hint?: boolean;
  onGrab?: (e: React.PointerEvent) => void;
  onKeyMove?: (dx: number, dy: number) => void;
  moveLabel?: string;
  onMoveOther?: () => void;
  disabled?: boolean;
}) {
  const keys: Record<string, [number, number]> = { ArrowLeft: [-4, 0], ArrowRight: [4, 0], ArrowUp: [0, -4], ArrowDown: [0, 4] };
  return (
    <section className={`os-window os-doc${copy ? " is-copy" : ""}`} style={{ left: `${pos.x}%`, top: `${pos.y}%`, width: `${WIN_W}%`, height: `${WIN_H}%` }} aria-label="文档窗口" aria-hidden={copy || undefined}>
      <header
        className={`os-title os-drag${hint ? " is-next" : ""}`}
        tabIndex={onGrab && !disabled ? 0 : -1}
        onPointerDown={disabled ? undefined : onGrab}
        onKeyDown={(e) => {
          const k = keys[e.key];
          if (!k || !onKeyMove || disabled) return;
          e.preventDefault();
          onKeyMove(k[0], k[1]);
        }}
        aria-label="文档窗口标题栏：按住拖动，或用方向键移动"
      >
        <Icon name="doc" size={12} />方案草稿 — 文档
        {onMoveOther && moveLabel && (
          <button type="button" className="os-title-btn" disabled={disabled} onPointerDown={(e) => e.stopPropagation()} onClick={onMoveOther}>{moveLabel}</button>
        )}
        <span className="os-title-actions" aria-hidden="true"><i /><i /><i /></span>
      </header>
      <div className="os-doc-body" aria-hidden="true">
        <b /><i /><i /><i className="short" /><b /><i /><i className="short" />
      </div>
    </section>
  );
}

/** 显示器右下角的模式示意：两块屏内容一样 / 连成一张桌面。 */
function ModeGlyph({ mode }: { mode: Mode }) {
  return (
    <svg viewBox="0 0 48 24" width="48" height="24" aria-hidden="true" focusable="false" className="mode-glyph">
      <rect x="1" y="4" width="20" height="14" rx="2" />
      <rect x="27" y="4" width="20" height="14" rx="2" />
      {mode === "mirror" ? (
        <>
          <rect x="5" y="8" width="9" height="6" className="fill" />
          <rect x="31" y="8" width="9" height="6" className="fill" />
        </>
      ) : (
        <rect x="14" y="8" width="20" height="6" className="fill" />
      )}
    </svg>
  );
}

/**
 * 多屏协同：先看显示器型号信息、确认在支持范围；在电脑上打开投屏面板连接显示器、选镜像或扩展；
 * 拖动窗口观察两块屏的关系。只有关键节点提交服务端动作（见 flows/multiScreen.ts）。
 */
export function MultiScreenStage({ view, disabled, onAction }: StageProps) {
  const server = view.experience.currentStateId as MsState;
  const configured: Mode = view.instance.params.mode === "mirror" ? "mirror" : "extend";
  const [local, setLocal] = useState(msInitial);
  const [ghost, setGhost] = useState<WinPos | null>(null);
  const laptopRef = useRef<HTMLDivElement>(null);
  const monitorRef = useRef<HTMLDivElement>(null);
  const grab = useRef<{ dx: number; dy: number } | null>(null);
  const v = msView(server, local, configured);
  const coach = msCoach(server, local, configured);
  const hint = msHint(server, local);
  const nx = (h: MsHint) => (!disabled && hint === h ? " is-next" : "");
  const dispatch = (e: MsEvent) => {
    if (disabled) return;
    const r = msReduce(server, local, e, configured);
    setLocal(r.local);
    if (r.action) onAction(r.action);
  };

  const screens = (): [ScreenId, DOMRect][] => {
    const out: [ScreenId, DOMRect][] = [];
    if (laptopRef.current) out.push(["laptop", laptopRef.current.getBoundingClientRect()]);
    if (monitorRef.current && v.mode === "extend") out.push(["monitor", monitorRef.current.getBoundingClientRect()]);
    return out;
  };
  const posAt = (clientX: number, clientY: number): WinPos | null => {
    const g = grab.current;
    if (!g) return null;
    const hit = screens().find(([, r]) => clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom);
    if (!hit) return null;
    const [screen, r] = hit;
    return clampWin({ screen, x: ((clientX - r.left - g.dx) / r.width) * 100, y: ((clientY - r.top - g.dy) / r.height) * 100 });
  };
  const onGrab = (e: React.PointerEvent) => {
    const win = (e.currentTarget as HTMLElement).closest(".os-window")!.getBoundingClientRect();
    grab.current = { dx: e.clientX - win.left, dy: e.clientY - win.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setGhost(v.win);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!grab.current) return;
    const p = posAt(e.clientX, e.clientY);
    if (p) setGhost(p);
  };
  const onDrop = () => {
    if (!grab.current) return;
    grab.current = null;
    if (ghost) dispatch({ type: "move", to: ghost });
    setGhost(null);
  };

  const win = ghost ?? v.win;
  const canDrag = v.mode !== null;
  const doc = (screen: ScreenId, mirror = false) =>
    win.screen === screen || mirror ? (
      <DocWindow
        pos={win}
        copy={mirror}
        hint={!mirror && !disabled && hint === "window"}
        disabled={disabled || mirror}
        onGrab={canDrag && !mirror ? onGrab : undefined}
        onKeyMove={canDrag && !mirror ? (dx, dy) => dispatch({ type: "move", to: { ...v.win, x: v.win.x + dx, y: v.win.y + dy } }) : undefined}
        moveLabel={v.mode === "extend" && !mirror ? (v.win.screen === "laptop" ? "移到显示器" : "移回电脑") : undefined}
        onMoveOther={v.mode === "extend" && !mirror ? () => dispatch({ type: "move", to: { ...v.win, screen: v.win.screen === "laptop" ? "monitor" : "laptop" } }) : undefined}
      />
    ) : null;

  return (
    <div className="stage-wrap">
      <StageCoach steps={MS_STEPS} {...coach} />
      <div className={`sim sim-ms${disabled ? " is-disabled" : ""}`} onPointerMove={onMove} onPointerUp={onDrop} onPointerCancel={onDrop}>
        <div className="sim-room" aria-hidden="true" />
        <div className="sim-desk" aria-hidden="true" />
        <div className="sim-devices">
          <Laptop label="示意电脑" screenRef={laptopRef}>
            <div className="os-desktop os-wall-cool">
              {doc("laptop")}
              {v.tray && (
                <section className="os-flyout" role="dialog" aria-label="连接到显示设备">
                  <p className="os-flyout-head">连接到显示设备</p>
                  {!v.mode && server !== "linked" && (
                    <button type="button" className={`os-peer${nx("peer")}`} disabled={disabled || !v.canPickDisplay} onClick={() => dispatch({ type: "pick_display" })}>
                      <Icon name="display" size={14} />示意显示器
                      <span className="os-muted">{v.checked ? "可连接" : "先核对型号"}</span>
                    </button>
                  )}
                  {server === "linked" && (
                    <>
                      <p className="os-muted"><Icon name="check" size={11} />已连接：示意显示器</p>
                      <div className="os-modes">
                        {(["mirror", "extend"] as const).map((m) => (
                          <button key={m} type="button" className={`os-mode${nx("mode")}`} disabled={disabled || !v.canPickMode} onClick={() => dispatch({ type: "pick_mode", mode: m })}>
                            <ModeGlyph mode={m} />
                            <strong>{m === "mirror" ? "镜像" : "扩展"}</strong>
                            <span className="os-muted">{m === "mirror" ? "两块屏一样" : "多一块桌面"}</span>
                            {configured === m && <span className="os-chip">方案建议</span>}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {v.mode && (
                    <>
                      <p className="os-muted"><Icon name="check" size={11} />已连接 · {v.mode === "extend" ? "扩展" : "镜像"}</p>
                      <button type="button" className="os-btn" disabled={disabled} onClick={() => dispatch({ type: "disconnect" })}>断开</button>
                    </>
                  )}
                </section>
              )}
              <Taskbar>
                <button type="button" className={`os-tb-cast${v.tray ? " is-open" : ""}${v.canDisconnect ? " is-on" : ""}${nx("cast")}`} disabled={disabled} aria-expanded={v.tray} aria-label="投屏与多屏" onClick={() => dispatch({ type: "tray", open: !v.tray })}>
                  <Icon name="cast" size={13} />
                </button>
              </Taskbar>
            </div>
          </Laptop>

          <Monitor
            label="示意显示器"
            screenRef={monitorRef}
            below={
              <button type="button" className={`dev-sticker${v.checked ? " is-ok" : ""}${nx("sticker")}`} disabled={disabled} onClick={() => dispatch({ type: "info", open: !v.info })} aria-expanded={v.info}>
                <Icon name={v.checked ? "check" : "info"} size={12} />{v.checked ? "已核对" : "型号信息"}
              </button>
            }
          >
            {v.monitor === "standby" && <div className="os-standby"><Icon name="display" size={22} /><span>示意显示器</span><span className="os-muted">等待连接</span></div>}
            {v.monitor === "connected" && <div className="os-standby os-standby-on"><Icon name="laptop" size={22} /><span>已连接到「示意电脑」</span><span className="os-muted">请在电脑上选择镜像或扩展</span></div>}
            {v.monitor === "mirror" && (
              <div className="os-desktop os-wall-cool os-mirror">
                {doc("monitor", true)}
                <Taskbar />
                <span className="os-chip os-corner">镜像</span>
              </div>
            )}
            {v.monitor === "extend" && (
              <div className={`os-desktop os-wall-warm${ghost?.screen === "monitor" ? " is-drop" : ""}`}>
                {doc("monitor")}
                <span className="os-chip os-corner">扩展桌面</span>
              </div>
            )}
          </Monitor>
        </div>

        {v.info && (
          <section className="sim-card" role="dialog" aria-label="显示器型号信息">
            <header><strong>型号信息</strong><button type="button" className="os-title-btn" onClick={() => dispatch({ type: "info", open: false })} aria-label="关闭"><Icon name="close" size={12} /></button></header>
            <dl className="kv">
              <dt>设备</dt><dd>示意显示器（虚拟设备，不对应任何真实型号）</dd>
              <dt>多屏协同</dt><dd>在支持范围内 <Badge>虚拟设定</Badge></dd>
            </dl>
            <p className="small muted">真实设备：仅华为 MateView（无线投屏版）显示器和部分智慧屏支持，请对照官方支持列表核对精确型号。不在范围内时改用普通的有线显示连接。</p>
            {!v.checked && <button type="button" className={`btn btn-primary btn-sm${nx("confirm")}`} disabled={disabled} onClick={() => dispatch({ type: "confirm_support" })}><Icon name="check" />已核对，在支持范围内</button>}
          </section>
        )}
      </div>
      <div className="stage-tools">
        <span className="muted small">屏幕里的界面是通用示意，不是官方界面；真实入口与名称以官方页面为准。</span>
        {v.canDisconnect && <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => dispatch({ type: "disconnect" })}>断开连接，重来一遍</button>}
      </div>
    </div>
  );
}
