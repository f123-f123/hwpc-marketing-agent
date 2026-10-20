import { lazy, Suspense } from "react";
import type { Hotspot, SpaceDefinition } from "@hwpc/scenes";

/**
 * 体验空间入口。三维房间（three.js）按需加载，不进首屏包；
 * 视角（yaw/pitch）由外层持有，进入局部任务再返回时保持原视角。
 */

export interface View {
  yaw: number;
  pitch: number;
}

export const isView = (v: unknown): v is View =>
  typeof v === "object" && v !== null && Number.isFinite((v as View).yaw) && Number.isFinite((v as View).pitch);

export const wrapYaw = (y: number) => ((((y + 180) % 360) + 360) % 360) - 180;
export const PITCH_LIMIT = 22;
/** 初始朝向：两张放着设备的桌子之间，左右两处任务都在视野里。 */
export const DEFAULT_VIEW: View = { yaw: -8, pitch: -5 };
export const clampView = (yaw: number, pitch: number): View => ({ yaw: wrapYaw(yaw), pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch)) });

export interface PanoramaProps {
  space: SpaceDefinition;
  view: View;
  onView: (v: View) => void;
  onEnter: (h: Hotspot) => void;
  /** 做过的任务，用于在热点上标注。 */
  doneSceneIds?: string[];
  /** 方案推荐的任务，用于在热点上标注。 */
  recommendedSceneIds?: string[];
}

const Room3D = lazy(() => import("./Room3D"));

export function Panorama(props: PanoramaProps) {
  return (
    <Suspense fallback={<div className="pano pano-loading" role="status">正在布置体验空间…</div>}>
      <Room3D {...props} />
    </Suspense>
  );
}
