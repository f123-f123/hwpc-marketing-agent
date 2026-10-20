import { useEffect, useMemo, useRef, useState } from "react";
import type { Hotspot } from "@hwpc/scenes";
import { Icon } from "../components/ui";
import { DEFAULT_VIEW, clampView, type PanoramaProps } from "./Panorama";
import { createRoomEngine, type RoomEngine } from "./room/engine";

/**
 * 三维体验空间：站在房间中间环顾四周。
 * - 拖动 / 触摸 / 方向键 / 按钮转动视角；点房间里的陈设或热点按钮进入局部任务。
 * - 热点是真正的按钮（可键盘聚焦），跟随三维位置移动，只在视野内出现。
 * - 这是程序绘制的示意空间，不是真实门店或实机画面；界面上始终标明。
 */
export default function Room3D({ space, view, onView, onEnter, doneSceneIds = [], recommendedSceneIds = [] }: PanoramaProps) {
  const host = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<RoomEngine | null>(null);
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let e: RoomEngine;
    try {
      e = createRoomEngine();
    } catch {
      setFailed(true);
      return;
    }
    e.canvas.className = "pano-canvas";
    e.canvas.setAttribute("aria-hidden", "true");
    el.prepend(e.canvas);
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      e.resize(entry.contentRect.width, entry.contentRect.height);
      setSize((s) => s + 1);
    });
    ro.observe(el);
    setEngine(e);
    return () => {
      ro.disconnect();
      e.canvas.remove();
      e.dispose();
      setEngine(null);
    };
  }, []);

  // 视角变化：先更新相机，再按新相机计算热点位置。
  const placements = useMemo(() => {
    if (!engine) return {};
    engine.setView(view.yaw, view.pitch);
    return Object.fromEntries(space.hotspots.map((h) => [h.hotspotId, engine.place(h.hotspotId, h)]));
  }, [engine, view.yaw, view.pitch, size, space.hotspots]);

  const byId = (id: string | null) => space.hotspots.find((h) => h.hotspotId === id);
  const set = (yaw: number, pitch: number) => onView(clampView(yaw, pitch));

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    host.current?.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = host.current;
    if (!el || !engine) return;
    if (!d) {
      if (e.pointerType === "mouse") setHover(engine.pick(e.clientX, e.clientY));
      return;
    }
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true;
    const k = engine.hfov() / (el.clientWidth || 1);
    set(d.yaw - (e.clientX - d.x) * k, d.pitch + (e.clientY - d.y) * k);
  };
  const end = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    host.current?.releasePointerCapture?.(e.pointerId);
    drag.current = null;
    if (!d.moved && engine && e.type === "pointerup") {
      const h = byId(engine.pick(e.clientX, e.clientY));
      if (h) onEnter(h);
    }
  };
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 30 : 12;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [view.yaw - step, view.pitch],
      ArrowRight: [view.yaw + step, view.pitch],
      ArrowUp: [view.yaw, view.pitch + 4],
      ArrowDown: [view.yaw, view.pitch - 4],
      Home: [DEFAULT_VIEW.yaw, DEFAULT_VIEW.pitch],
    };
    const next = moves[e.key];
    if (!next) return;
    e.preventDefault();
    set(next[0], next[1]);
  };

  const hotspotButton = (h: Hotspot, style?: React.CSSProperties) => {
    const done = h.target.type === "scene" && doneSceneIds.includes(h.target.sceneId);
    const rec = h.target.type === "scene" && recommendedSceneIds.includes(h.target.sceneId);
    return (
      <button
        key={h.hotspotId}
        type="button"
        className={`hot${rec ? " is-recommended" : ""}${done ? " is-done" : ""}${hover === h.hotspotId ? " is-hover" : ""}`}
        style={style}
        onClick={() => onEnter(h)}
        aria-label={`${h.label}：${h.hint}${done ? "（已体验）" : ""}${rec ? "（方案任务）" : ""}`}
      >
        <Icon name={h.icon} />
        <span>{h.label}</span>
        {done && <span className="hot-tag">已体验</span>}
        {rec && !done && <span className="hot-tag">方案任务</span>}
      </button>
    );
  };

  if (failed) {
    return (
      <div className="pano-wrap">
        <div className="pano pano-failed">
          <p>当前浏览器无法显示三维空间。可以直接进入下面的任务：</p>
          <div className="row">{space.hotspots.map((h) => hotspotButton(h))}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="pano-wrap">
      <div
        ref={host}
        className={`pano${hover ? " is-pointing" : ""}`}
        tabIndex={0}
        role="application"
        aria-label={`${space.title}。方向键转动视角，Home 回到初始朝向。`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
      >
        {space.hotspots.map((h) => {
          const p = placements[h.hotspotId];
          return p ? hotspotButton(h, { left: `${p.left}%`, top: `${Math.max(10, Math.min(86, p.top))}%` }) : null;
        })}
        <span className="pano-tag">示意空间 · 程序绘制</span>
      </div>
      <div className="pano-ctl">
        <div className="row">
          <button type="button" className="btn btn-sm" onClick={() => set(view.yaw - 40, view.pitch)} aria-label="向左转"><Icon name="left" />向左</button>
          <button type="button" className="btn btn-sm" onClick={() => set(DEFAULT_VIEW.yaw, DEFAULT_VIEW.pitch)}>回到初始朝向</button>
          <button type="button" className="btn btn-sm" onClick={() => set(view.yaw + 40, view.pitch)} aria-label="向右转">向右<Icon name="right" /></button>
        </div>
        <span className="muted small">拖动环顾四周，点桌上的设备进入任务</span>
      </div>
      <p className="muted small">{space.notice}</p>
    </div>
  );
}
