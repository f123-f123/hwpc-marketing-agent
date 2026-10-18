import { useCallback, useEffect, useRef } from "react";
import type { Hotspot, SpaceDefinition } from "@hwpc/scenes";

/**
 * 全景空间（圆柱投影）。
 * - 一条 360° 的程序绘制环境，视口只显示约 110° 的范围；拖动 / 触摸 / 方向键 / 按钮都可以转动视角。
 * - 热点是真正的按钮（可键盘聚焦），会随视角移动，并且只在视野内出现。
 * - 视角（yaw/pitch）由外层持有，所以进入局部任务再返回时保持原视角。
 * 这是示意空间，不是真实门店或实机画面；界面上始终标明。
 */

export interface View {
  yaw: number;
  pitch: number;
}

const FOV_H = 110;
const FOV_V = 60;
const PITCH_LIMIT = 14;
const WORLD_W = 3600; // 每度 10 单位
const WORLD_H = 800;

export const wrapYaw = (y: number) => ((((y + 180) % 360) + 360) % 360) - 180;
const angDiff = (a: number, b: number) => wrapYaw(a - b);
const xOf = (yaw: number) => (yaw + 180) * (WORLD_W / 360);

/** 热点相对当前视角的位置；不在视野内时返回 null。 */
export function hotspotPlacement(h: Hotspot, v: View): { left: number; top: number } | null {
  const dx = angDiff(h.yaw, v.yaw);
  if (Math.abs(dx) > FOV_H / 2 + 4) return null;
  return { left: 50 + (dx / FOV_H) * 100, top: 50 - ((h.pitch - v.pitch) / FOV_V) * 100 };
}

function World() {
  // 同一个环境画三份（-360° / 0 / +360°），在边界处无缝转动。
  const objs = (dx: number) => (
    <g transform={`translate(${dx} 0)`}>
      <rect x="0" y="0" width={WORLD_W} height="470" fill="url(#wall)" />
      <rect x="0" y="470" width={WORLD_W} height="330" fill="url(#floor)" />
      {Array.from({ length: 36 }, (_, i) => <line key={i} x1={i * 100} y1="470" x2={i * 100 - 40} y2="800" stroke="#c9cfdc" strokeWidth="1" opacity="0.5" />)}
      {Array.from({ length: 8 }, (_, i) => <line key={`h${i}`} x1="0" y1={490 + i * i * 6 + i * 14} x2={WORLD_W} y2={490 + i * i * 6 + i * 14} stroke="#c9cfdc" strokeWidth="1" opacity="0.4" />)}
      {/* 窗 */}
      {[-120, 20, 110].map((y) => <rect key={y} x={xOf(y) - 90} y="90" width="180" height="230" rx="6" fill="#dfeafc" stroke="#aebbd6" strokeWidth="3" />)}
      {/* 大屏与桌面（-62°） */}
      <g transform={`translate(${xOf(-62)} 0)`}>
        <rect x="-190" y="170" width="380" height="220" rx="10" fill="#222a3b" />
        <rect x="-178" y="182" width="356" height="196" rx="4" fill="#3b5ea8" />
        <rect x="-150" y="205" width="140" height="90" rx="4" fill="#e9eef9" opacity="0.9" />
        <rect x="-90" y="395" width="180" height="14" fill="#8b93a6" />
        <rect x="-230" y="430" width="460" height="22" rx="4" fill="#a98f6a" />
        <rect x="-60" y="396" width="120" height="34" rx="3" fill="#2b3447" />
      </g>
      {/* 手机与电脑（58°） */}
      <g transform={`translate(${xOf(58)} 0)`}>
        <rect x="-240" y="440" width="480" height="22" rx="4" fill="#a98f6a" />
        <rect x="-170" y="330" width="210" height="112" rx="6" fill="#2b3447" />
        <rect x="-160" y="338" width="190" height="96" rx="3" fill="#7da2e6" />
        <rect x="-190" y="442" width="250" height="8" rx="3" fill="#8b93a6" />
        <rect x="90" y="372" width="50" height="86" rx="8" fill="#222a3b" />
        <rect x="95" y="380" width="40" height="66" rx="4" fill="#9ad0a8" />
      </g>
      {/* 比较台（160°，跨越边界，画在 ±180 两侧） */}
      {[160].map((y) => (
        <g key={y} transform={`translate(${xOf(y)} 0)`}>
          <rect x="-260" y="430" width="520" height="26" rx="4" fill="#9c8660" />
          {[-170, -20, 130].map((x) => <g key={x}><rect x={x} y="352" width="110" height="74" rx="4" fill="#2b3447" /><rect x={x + 8} y="360" width="94" height="58" rx="2" fill="#8fb0e8" /></g>)}
          <rect x="-250" y="150" width="500" height="80" rx="6" fill="#f2f4fa" stroke="#aebbd6" strokeWidth="3" />
          <text x="0" y="200" textAnchor="middle" fontSize="38" fill="#3a4560">候选比较台</text>
        </g>
      ))}
      {/* 方案板（-150°） */}
      <g transform={`translate(${xOf(-150)} 0)`}>
        <rect x="-150" y="200" width="300" height="230" rx="8" fill="#fbfbfe" stroke="#aebbd6" strokeWidth="4" />
        {[0, 1, 2, 3].map((i) => <rect key={i} x="-120" y={235 + i * 44} width={200 - i * 20} height="14" rx="3" fill="#b9c5de" />)}
        <circle cx="105" cy="250" r="22" fill="#cfe4d6" />
      </g>
    </g>
  );
  return (
    <>
      <defs>
        <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#eef2fb" /><stop offset="1" stopColor="#dde4f2" /></linearGradient>
        <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d7dbe6" /><stop offset="1" stopColor="#bfc5d4" /></linearGradient>
      </defs>
      {objs(-WORLD_W)}
      {objs(0)}
      {objs(WORLD_W)}
    </>
  );
}

const ICON: Record<Hotspot["icon"], string> = { display: "▭", phone: "▯", compare: "⇄", plan: "☰" };

interface Props {
  space: SpaceDefinition;
  view: View;
  onView: (v: View) => void;
  onEnter: (h: Hotspot) => void;
  /** 做过的任务，用于在热点上标注。 */
  doneSceneIds?: string[];
  /** 方案推荐的任务，用于在热点上标注。 */
  recommendedSceneIds?: string[];
}

export function Panorama({ space, view, onView, onEnter, doneSceneIds = [], recommendedSceneIds = [] }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number; id: number } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const set = useCallback((yaw: number, pitch: number) => onView({ yaw: wrapYaw(yaw), pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch)) }), [onView]);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    ref.current?.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch, id: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el) return;
    const w = el.clientWidth || 1;
    set(d.yaw - ((e.clientX - d.x) / w) * FOV_H, d.pitch + ((e.clientY - d.y) / w) * FOV_H * 0.4);
  };
  const end = (e: React.PointerEvent) => {
    if (drag.current) ref.current?.releasePointerCapture?.(e.pointerId);
    drag.current = null;
  };
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 30 : 12;
    if (e.key === "ArrowLeft") (e.preventDefault(), set(view.yaw - step, view.pitch));
    else if (e.key === "ArrowRight") (e.preventDefault(), set(view.yaw + step, view.pitch));
    else if (e.key === "ArrowUp") (e.preventDefault(), set(view.yaw, view.pitch + 4));
    else if (e.key === "ArrowDown") (e.preventDefault(), set(view.yaw, view.pitch - 4));
    else if (e.key === "Home") (e.preventDefault(), set(0, 0));
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (e: Event) => e.preventDefault();
    el.addEventListener("gesturestart", stop);
    return () => el.removeEventListener("gesturestart", stop);
  }, []);

  const half = (FOV_H / 2) * (WORLD_W / 360);
  const cx = xOf(view.yaw);
  const vh = FOV_V * (WORLD_W / 360) * 1.35; // 可视高度（圆柱投影下的近似）
  const cy = 470 - view.pitch * 12;

  return (
    <div className="pano-wrap">
      <div
        ref={ref}
        className="pano"
        tabIndex={0}
        role="application"
        aria-label={`${space.title}。方向键转动视角，Home 回到初始朝向。当前朝向 ${Math.round(view.yaw)} 度`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={onKey}
      >
        <svg viewBox={`${cx - half} ${cy - vh / 2} ${half * 2} ${vh}`} preserveAspectRatio="xMidYMid slice" aria-hidden focusable="false">
          <World />
        </svg>
        {space.hotspots.map((h) => {
          const p = hotspotPlacement(h, view);
          if (!p) return null;
          const done = h.target.type === "scene" && doneSceneIds.includes(h.target.sceneId);
          const rec = h.target.type === "scene" && recommendedSceneIds.includes(h.target.sceneId);
          return (
            <button
              key={h.hotspotId}
              type="button"
              className={`hot ${rec ? "hot-rec" : ""}`}
              style={{ left: `${p.left}%`, top: `${Math.max(8, Math.min(88, p.top))}%` }}
              onClick={() => onEnter(h)}
              aria-label={`${h.label}：${h.hint}${done ? "（已体验）" : ""}${rec ? "（方案推荐）" : ""}`}
            >
              <span aria-hidden>{ICON[h.icon]}</span>
              <span className="hot-label">{h.label}</span>
              {done && <span className="hot-tag">已体验</span>}
              {rec && !done && <span className="hot-tag">推荐</span>}
            </button>
          );
        })}
        <div className="pano-hud" aria-hidden>{Math.round(wrapYaw(view.yaw))}°</div>
      </div>
      <div className="pano-ctl row">
        <button type="button" className="btn" onClick={() => set(view.yaw - 40, view.pitch)} aria-label="向左转">◀ 向左</button>
        <button type="button" className="btn" onClick={() => set(0, 0)}>回到初始朝向</button>
        <button type="button" className="btn" onClick={() => set(view.yaw + 40, view.pitch)} aria-label="向右转">向右 ▶</button>
        <span className="muted small">拖动、触摸滑动或方向键都可以转动视角</span>
      </div>
      <p className="muted small">{space.notice}</p>
    </div>
  );
}
