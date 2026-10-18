import { useCallback, useEffect, useRef } from "react";
import type { Hotspot, SpaceDefinition } from "@hwpc/scenes";
import { Icon } from "../components/ui";

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

export const isView = (v: unknown): v is View =>
  typeof v === "object" && v !== null && Number.isFinite((v as View).yaw) && Number.isFinite((v as View).pitch);

const FOV_H = 110;
const FOV_V = 60;
const PITCH_LIMIT = 14;
const WORLD_W = 3600; // 每度 10 单位
const WORLD_H = 800;

export const wrapYaw = (y: number) => ((((y + 180) % 360) + 360) % 360) - 180;
const angDiff = (a: number, b: number) => wrapYaw(a - b);
const xOf = (yaw: number) => (yaw + 180) * (WORLD_W / 360);

/** 热点按钮半宽约占的视角（度）。超出这个范围的热点会被视口裁掉一半，干脆不显示。 */
const HOTSPOT_MARGIN = 10;

/** 热点相对当前视角的位置；不在视野内（或会被边缘裁切）时返回 null。 */
export function hotspotPlacement(h: Hotspot, v: View): { left: number; top: number } | null {
  const dx = angDiff(h.yaw, v.yaw);
  if (Math.abs(dx) > FOV_H / 2 - HOTSPOT_MARGIN) return null;
  return { left: 50 + (dx / FOV_H) * 100, top: 50 - ((h.pitch - v.pitch) / FOV_V) * 100 };
}

/** 示意空间的配色：中性暖灰 + 木色桌面，与界面 token 同一色调；屏幕用深色，品牌红只做点缀。 */
const C = {
  wallTop: "#f3f2ef",
  wallBottom: "#e7e5e0",
  floorTop: "#dcd8d1",
  floorBottom: "#cbc6bd",
  line: "#bdb7ad",
  window: "#eef1f3",
  windowFrame: "#c9c5bd",
  wood: "#b59a74",
  woodDark: "#9c8360",
  device: "#26282d",
  screen: "#3d434d",
  screenLit: "#e9ecef",
  board: "#fbfaf8",
  boardLine: "#d6d1c8",
  ink: "#4a4f58",
  accent: "#c7000b",
};

function World() {
  // 同一个环境画三份（-360° / 0 / +360°），在边界处无缝转动。
  const objs = (dx: number) => (
    <g transform={`translate(${dx} 0)`}>
      <rect x="0" y="0" width={WORLD_W} height="470" fill="url(#wall)" />
      <rect x="0" y="470" width={WORLD_W} height={WORLD_H - 470} fill="url(#floor)" />
      {Array.from({ length: 36 }, (_, i) => <line key={i} x1={i * 100} y1="470" x2={i * 100 - 40} y2={WORLD_H} stroke={C.line} strokeWidth="1" opacity="0.35" />)}
      {Array.from({ length: 8 }, (_, i) => <line key={`h${i}`} x1="0" y1={490 + i * i * 6 + i * 14} x2={WORLD_W} y2={490 + i * i * 6 + i * 14} stroke={C.line} strokeWidth="1" opacity="0.3" />)}
      {/* 窗 */}
      {[-120, 20, 110].map((y) => (
        <g key={y}>
          <rect x={xOf(y) - 90} y="90" width="180" height="230" rx="4" fill={C.window} stroke={C.windowFrame} strokeWidth="3" />
          <line x1={xOf(y)} y1="90" x2={xOf(y)} y2="320" stroke={C.windowFrame} strokeWidth="2" />
        </g>
      ))}
      {/* 大屏与桌面（-62°） */}
      <g transform={`translate(${xOf(-62)} 0)`}>
        <rect x="-190" y="170" width="380" height="220" rx="8" fill={C.device} />
        <rect x="-178" y="182" width="356" height="196" rx="3" fill={C.screen} />
        <rect x="-150" y="205" width="140" height="90" rx="3" fill={C.screenLit} opacity="0.9" />
        <rect x="10" y="205" width="140" height="150" rx="3" fill={C.screenLit} opacity="0.55" />
        <rect x="-90" y="395" width="180" height="12" fill={C.woodDark} />
        <rect x="-230" y="430" width="460" height="20" rx="3" fill={C.wood} />
        <rect x="-60" y="396" width="120" height="34" rx="3" fill={C.device} />
      </g>
      {/* 手机与电脑（58°） */}
      <g transform={`translate(${xOf(58)} 0)`}>
        <rect x="-240" y="440" width="480" height="20" rx="3" fill={C.wood} />
        <rect x="-170" y="330" width="210" height="112" rx="6" fill={C.device} />
        <rect x="-160" y="338" width="190" height="96" rx="3" fill={C.screenLit} />
        <rect x="-190" y="442" width="250" height="7" rx="3" fill={C.woodDark} />
        <rect x="90" y="372" width="50" height="86" rx="8" fill={C.device} />
        <rect x="95" y="380" width="40" height="66" rx="4" fill={C.screenLit} />
        <path d="M45 395 q 22 -18 40 0" fill="none" stroke={C.accent} strokeWidth="3" strokeDasharray="5 5" />
      </g>
      {/* 比较台（160°） */}
      <g transform={`translate(${xOf(160)} 0)`}>
        <rect x="-260" y="430" width="520" height="24" rx="3" fill={C.woodDark} />
        {[-170, -20, 130].map((x) => (
          <g key={x}>
            <rect x={x} y="352" width="110" height="74" rx="4" fill={C.device} />
            <rect x={x + 8} y="360" width="94" height="58" rx="2" fill={C.screenLit} />
          </g>
        ))}
        <rect x="-250" y="150" width="500" height="80" rx="6" fill={C.board} stroke={C.boardLine} strokeWidth="3" />
        <text x="0" y="200" textAnchor="middle" fontSize="34" fill={C.ink}>候选比较台</text>
      </g>
      {/* 方案板（-150°） */}
      <g transform={`translate(${xOf(-150)} 0)`}>
        <rect x="-150" y="200" width="300" height="230" rx="6" fill={C.board} stroke={C.boardLine} strokeWidth="3" />
        {[0, 1, 2, 3].map((i) => <rect key={i} x="-120" y={235 + i * 44} width={200 - i * 20} height="12" rx="3" fill={C.boardLine} />)}
        <circle cx="105" cy="250" r="20" fill="none" stroke={C.accent} strokeWidth="4" />
      </g>
    </g>
  );
  return (
    <>
      <defs>
        <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={C.wallTop} /><stop offset="1" stopColor={C.wallBottom} /></linearGradient>
        <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={C.floorTop} /><stop offset="1" stopColor={C.floorBottom} /></linearGradient>
      </defs>
      {objs(-WORLD_W)}
      {objs(0)}
      {objs(WORLD_W)}
    </>
  );
}

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
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);

  const set = useCallback((yaw: number, pitch: number) => onView({ yaw: wrapYaw(yaw), pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch)) }), [onView]);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    ref.current?.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch };
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
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [view.yaw - step, view.pitch],
      ArrowRight: [view.yaw + step, view.pitch],
      ArrowUp: [view.yaw, view.pitch + 4],
      ArrowDown: [view.yaw, view.pitch - 4],
      Home: [0, 0],
    };
    const next = moves[e.key];
    if (!next) return;
    e.preventDefault();
    set(next[0], next[1]);
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
              className={`hot${rec ? " is-recommended" : ""}${done ? " is-done" : ""}`}
              style={{ left: `${p.left}%`, top: `${Math.max(8, Math.min(88, p.top))}%` }}
              onClick={() => onEnter(h)}
              aria-label={`${h.label}：${h.hint}${done ? "（已体验）" : ""}${rec ? "（方案任务）" : ""}`}
            >
              <Icon name={h.icon} />
              <span>{h.label}</span>
              {done && <span className="hot-tag">已体验</span>}
              {rec && !done && <span className="hot-tag">方案任务</span>}
            </button>
          );
        })}
        <div className="pano-hud" aria-hidden>{Math.round(wrapYaw(view.yaw))}°</div>
      </div>
      <div className="pano-ctl">
        <div className="row">
          <button type="button" className="btn btn-sm" onClick={() => set(view.yaw - 40, view.pitch)} aria-label="向左转"><Icon name="left" />向左</button>
          <button type="button" className="btn btn-sm" onClick={() => set(0, 0)}>回到初始朝向</button>
          <button type="button" className="btn btn-sm" onClick={() => set(view.yaw + 40, view.pitch)} aria-label="向右转">向右<Icon name="right" /></button>
        </div>
        <span className="muted small">拖动、滑动或方向键都可以转动视角</span>
      </div>
      <p className="muted small">{space.notice}</p>
    </div>
  );
}
