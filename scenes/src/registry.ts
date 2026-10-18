import { fileTransferScene } from "./definitions/fileTransfer";
import { multiScreenScene } from "./definitions/multiScreen";
import { lintDefinition } from "./engine";
import { showroomSpace } from "./space";
import type { SceneDefinition, SpaceDefinition } from "./types";

/**
 * 场景清单。场景代码在开发时编写并注册；个人方案只引用 sceneId + version。
 * 同一 sceneId 的旧版本继续保留在清单里，已生成的方案按原版本重放，升级不会静默改变历史方案。
 */
const ALL: SceneDefinition[] = [multiScreenScene, fileTransferScene];
const SPACES: SpaceDefinition[] = [showroomSpace];

export function allScenes(): SceneDefinition[] {
  return ALL.slice();
}

export function getScene(sceneId: string, version?: number): SceneDefinition | undefined {
  const list = ALL.filter((s) => s.sceneId === sceneId);
  if (version !== undefined) return list.find((s) => s.version === version);
  return list.sort((a, b) => b.version - a.version)[0];
}

export function getSpace(spaceId: string): SpaceDefinition | undefined {
  return SPACES.find((s) => s.spaceId === spaceId);
}

export function defaultSpace(): SpaceDefinition {
  return SPACES[0]!;
}

/** 多对多检索：一项技术对应多个场景，一个场景涉及多个技术。 */
export function scenesForTech(tag: string): SceneDefinition[] {
  return ALL.filter((s) => s.serves.techTags.includes(tag));
}
export function scenesForProblem(tag: string): SceneDefinition[] {
  return ALL.filter((s) => s.serves.problemTags.includes(tag));
}

export interface CatalogEntry {
  sceneId: string;
  version: number;
  title: string;
  task: string;
  demoType: SceneDefinition["demoType"];
  genericModule: boolean;
  problemTags: string[];
  techTags: string[];
  deviceRoles: { roleId: string; label: string; kind: string }[];
}

/** 给 B 的场景清单（只有声明信息，没有代码）。 */
export function catalog(): CatalogEntry[] {
  return ALL.map((s) => ({
    sceneId: s.sceneId,
    version: s.version,
    title: s.title,
    task: s.task,
    demoType: s.demoType,
    genericModule: s.genericModule,
    problemTags: s.serves.problemTags,
    techTags: s.serves.techTags,
    deviceRoles: s.deviceRoles,
  }));
}

export function lintAll(): { sceneId: string; version: number; errors: string[] }[] {
  return ALL.map((s) => ({ sceneId: s.sceneId, version: s.version, errors: lintDefinition(s) }));
}
