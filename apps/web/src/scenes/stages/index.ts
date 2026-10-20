import type { ComponentType } from "react";
import type { SceneDefinition } from "@hwpc/contracts";
import { FT_ACTIONS, FT_SCENE_ID, FT_STATES } from "../flows/fileTransfer";
import { MS_ACTIONS, MS_SCENE_ID, MS_STATES } from "../flows/multiScreen";
import type { StageProps } from "./devices";
import { FileTransferStage } from "./FileTransferStage";
import { GenericStage } from "./GenericStage";
import { MultiScreenStage } from "./MultiScreenStage";

const DEDICATED: { sceneId: string; states: readonly string[]; actions: readonly string[]; Stage: ComponentType<StageProps> }[] = [
  { sceneId: FT_SCENE_ID, states: FT_STATES, actions: FT_ACTIONS, Stage: FileTransferStage },
  { sceneId: MS_SCENE_ID, states: MS_STATES, actions: MS_ACTIONS, Stage: MultiScreenStage },
];

/**
 * 选渲染器：专属渲染器只接与它对得上的冻结定义（状态、动作完全一致）；
 * 场景升级后结构变了，自动退回通用渲染器，不会拿旧的操作流程套新版本。
 */
export function stageFor(def: SceneDefinition): ComponentType<StageProps> {
  const same = (a: readonly string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const hit = DEDICATED.find((d) => d.sceneId === def.sceneId && same(d.states, def.states.map((s) => s.stateId)) && same(d.actions, def.actions.map((a) => a.actionId)));
  return hit?.Stage ?? GenericStage;
}
