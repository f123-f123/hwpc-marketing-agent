import { useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

export interface DragState<T> {
  item: T;
  /** 影子相对舞台左上角的位置（px）。 */
  x: number;
  y: number;
  /** 当前指针下的落点区域。 */
  over: string | null;
}

/**
 * 舞台里的拖放：按住拖出影子，松手时按落点命中的区域回调。
 * 移动不到 5px 当作点击，不触发拖放；拖放之后紧跟的那次 click 会被吞掉，避免一个手势触发两次操作。
 */
export function useDrag<T>(onDrop: (item: T, zone: string) => void) {
  const host = useRef<HTMLDivElement>(null);
  const zones = useRef(new Map<string, HTMLElement>());
  const press = useRef<{ item: T; x0: number; y0: number; active: boolean } | null>(null);
  const swallowClick = useRef(false);
  const [drag, setDrag] = useState<DragState<T> | null>(null);

  /** 区域可以嵌套（例如桌面里的窗口）：命中多个时取面积最小、也就是最里层的那个。 */
  const zoneAt = (cx: number, cy: number) => {
    let hit: { id: string; area: number } | null = null;
    for (const [id, el] of zones.current) {
      const r = el.getBoundingClientRect();
      if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) continue;
      if (!hit || r.width * r.height < hit.area) hit = { id, area: r.width * r.height };
    }
    return hit?.id ?? null;
  };
  const end = () => {
    press.current = null;
    setDrag(null);
  };

  return {
    host,
    drag,
    /** 给落点区域挂 ref。 */
    zone: (id: string) => (el: HTMLElement | null) => {
      if (el) zones.current.set(id, el);
      else zones.current.delete(id);
    },
    /** 给可拖动的元素展开这些属性。 */
    source: (item: T, enabled = true) =>
      enabled
        ? {
            onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
              if (e.button !== 0) return;
              press.current = { item, x0: e.clientX, y0: e.clientY, active: false };
              e.currentTarget.setPointerCapture(e.pointerId);
            },
            onClickCapture: (e: ReactMouseEvent) => {
              if (!swallowClick.current) return;
              swallowClick.current = false;
              e.preventDefault();
              e.stopPropagation();
            },
          }
        : {},
    hostProps: {
      onPointerMove: (e: ReactPointerEvent) => {
        const p = press.current;
        if (!p || !host.current) return;
        if (!p.active && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 5) return;
        p.active = true;
        const r = host.current.getBoundingClientRect();
        setDrag({ item: p.item, x: e.clientX - r.left, y: e.clientY - r.top, over: zoneAt(e.clientX, e.clientY) });
      },
      onPointerUp: (e: ReactPointerEvent) => {
        const p = press.current;
        if (p?.active) {
          swallowClick.current = true;
          setTimeout(() => { swallowClick.current = false; }, 0);
          const z = zoneAt(e.clientX, e.clientY);
          if (z) onDrop(p.item, z);
        }
        end();
      },
      onPointerCancel: end,
    },
  };
}
