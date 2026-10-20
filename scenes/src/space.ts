import type { SpaceDefinition } from "./types";

/**
 * 全景空间：示意性的"体验空间"——一间带窗的书房兼起居空间。
 * 空间由程序绘制（三维，见 apps/web/src/scenes/room），不是真实门店或实机画面，
 * 也没有使用任何 ima 产品图片。热点只是进入局部任务的入口。
 * yaw/pitch 与房间里对应陈设的位置一致（由 room/build.ts 的锚点换算）。
 */
export const showroomSpace: SpaceDefinition = {
  spaceId: "showroom-illustration",
  version: 2,
  title: "体验空间（示意）",
  kind: "generated_illustration",
  notice: "这是程序绘制的三维示意空间，不是真实门店或实机画面。里面的设备都是不带品牌标识的虚拟示意，与你的真实设备无关。",
  hotspots: [
    { hotspotId: "hs-display", label: "书桌：电脑与显示器", hint: "把电脑画面送到旁边的显示器", yaw: -48.4, pitch: 1.4, icon: "display", target: { type: "scene", sceneId: "multi-screen-extend" } },
    { hotspotId: "hs-phone", label: "窗边：手机与电脑", hint: "把手机里的照片送到电脑", yaw: 31.5, pitch: -2.6, icon: "phone", target: { type: "scene", sceneId: "phone-pc-file-transfer" } },
    { hotspotId: "hs-compare", label: "候选比较台", hint: "对照候选产品的资料与未知项", yaw: 153.4, pitch: -5.7, icon: "compare", target: { type: "activity", activity: "compare" } },
    { hotspotId: "hs-plan", label: "我的方案", hint: "回到个人方案", yaw: -138.4, pitch: 10.4, icon: "plan", target: { type: "activity", activity: "plan" } },
  ],
  assets: [
    { assetId: "space-room", kind: "generated_3d", usage: "三维示意空间（程序生成的几何体与贴图）", origin: "本项目程序生成", isProductImage: false },
  ],
};
