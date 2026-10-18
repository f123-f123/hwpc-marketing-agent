import type { SpaceDefinition } from "./types";

/**
 * 全景空间：示意性的"体验空间"。
 * 空间由程序绘制（见 apps/web/src/scenes/Panorama.tsx），不是真实门店或实机画面，
 * 也没有使用任何 ima 产品图片。热点只是进入局部任务的入口。
 */
export const showroomSpace: SpaceDefinition = {
  spaceId: "showroom-illustration",
  version: 1,
  title: "体验空间（示意）",
  kind: "generated_illustration",
  notice: "这是程序绘制的示意空间，不是真实门店或实机画面。里面的设备都是虚拟示意，与你的真实设备无关。",
  hotspots: [
    { hotspotId: "hs-display", label: "大屏与桌面", hint: "把电脑画面送到更大的屏幕", yaw: -62, pitch: 4, icon: "display", target: { type: "scene", sceneId: "multi-screen-extend" } },
    { hotspotId: "hs-phone", label: "手机与电脑", hint: "把手机里的文件送到电脑", yaw: 58, pitch: -6, icon: "phone", target: { type: "scene", sceneId: "phone-pc-file-transfer" } },
    { hotspotId: "hs-compare", label: "候选比较台", hint: "对照候选产品的资料与未知项", yaw: 160, pitch: -8, icon: "compare", target: { type: "activity", activity: "compare" } },
    { hotspotId: "hs-plan", label: "我的方案", hint: "回到个人方案", yaw: -150, pitch: 8, icon: "plan", target: { type: "activity", activity: "plan" } },
  ],
  assets: [
    { assetId: "space-canvas", kind: "generated_svg", usage: "全景空间的程序绘制背景（示意环境）", origin: "本项目程序生成", isProductImage: false },
  ],
};
