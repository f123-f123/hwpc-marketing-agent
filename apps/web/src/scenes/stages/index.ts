import type { ComponentType } from "react";
import type { SceneDefinition } from "@hwpc/contracts";
import type { IconName } from "../../components/ui";
import { CB_ACTIONS, CB_SCENE_ID, CB_STATES } from "../flows/collab";
import { CM_ACTIONS_V1, CM_ACTIONS_V2, CM_SCENE_ID, CM_STATES_V1, CM_STATES_V2 } from "../flows/commute";
import { FT_ACTIONS, FT_SCENE_ID, FT_STATES } from "../flows/fileTransfer";
import { MS_ACTIONS, MS_SCENE_ID, MS_STATES } from "../flows/multiScreen";
import { CollabStage } from "./CollabStage";
import { CommuteStage } from "./CommuteStage";
import type { StageProps } from "./devices";
import { FileTransferStage } from "./FileTransferStage";
import { GenericStage } from "./GenericStage";
import { MultiScreenStage } from "./MultiScreenStage";

const DEDICATED: { sceneId: string; states: readonly string[]; actions: readonly string[]; Stage: ComponentType<StageProps> }[] = [
  { sceneId: FT_SCENE_ID, states: FT_STATES, actions: FT_ACTIONS, Stage: FileTransferStage },
  { sceneId: MS_SCENE_ID, states: MS_STATES, actions: MS_ACTIONS, Stage: MultiScreenStage },
  { sceneId: CM_SCENE_ID, states: CM_STATES_V1, actions: CM_ACTIONS_V1, Stage: CommuteStage },
  { sceneId: CM_SCENE_ID, states: CM_STATES_V2, actions: CM_ACTIONS_V2, Stage: CommuteStage },
  { sceneId: CB_SCENE_ID, states: CB_STATES, actions: CB_ACTIONS, Stage: CollabStage },
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

/** 体验页的场景卡片：上手要做的事，一句话说清。没有专属渲染器的场景不在这里。 */
export const STAGE_TEASER: Record<string, { icon: IconName; doing: string }> = {
  [MS_SCENE_ID]: { icon: "display", doing: "打开投屏面板连上显示器，把窗口拖到第二块屏上" },
  [FT_SCENE_ID]: { icon: "image", doing: "在手机上选照片分享给电脑，在电脑上接收并打开核对" },
  [CM_SCENE_ID]: { icon: "bag", doing: "收拾背包、通勤、开会、找插座，看一天下来电量还剩多少" },
  [CB_SCENE_ID]: { icon: "phone", doing: "把手机拖到电脑旁连上，从手机窗口把文件拖到电脑桌面" },
};
