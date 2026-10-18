import type { ResultVersion } from "@hwpc/contracts";
import { MOCK_NOTICE, buildMockMaterialPack } from "./data.js";

const NOW = "2026-01-01T00:00:00.000Z";

/** 完整的模拟结果版本：小红书、开学季。内容为模拟，不代表真实产品。 */
export function buildMockResultVersion(taskId = "mock-task-1"): ResultVersion {
  return {
    version: 1,
    createdAt: NOW,
    reason: "initial",
    strategy: {
      audience: "大学新生",
      scenario: "back_to_school",
      purchaseStage: "consideration",
      userProblems: ["每天背着走，怕太重", "课堂和图书馆一整天要够用", "预算有限，怕选错"],
      contentGoal: "帮新生判断是否适合作为开学设备",
      angle: "以“一天的课表”为线索，讲携带与续航",
      platformPlan: {
        platform: "xiaohongshu",
        titleStyle: "口语化、带数字或场景",
        lengthRange: { min: 300, max: 600 },
        structure: ["场景开头", "三个短段落卖点", "限制说明", "话题标签"],
        tone: "亲切、第一人称叙述但不伪造个人体验",
        imageCount: { min: 3, max: 6 },
        ctaStyle: "邀请到店体验或收藏",
      },
      sellingPointFactIds: ["mock-f-002", "mock-f-003", "mock-f-006"],
      rationale: `${MOCK_NOTICE} 新生关心携带与续航，因此先讲重量与续航，再补接口。`,
    },
    article: {
      platform: "xiaohongshu",
      title: "【MOCK】开学背一整天也不累？示例本 Air 14 的课表测试（模拟）",
      lead: "【MOCK】这是一段模拟导语。",
      blocks: [
        { type: "image", imageId: "mock-i-001", caption: "【MOCK】主视觉占位图", placementReason: "头图，先建立产品印象" },
        {
          type: "paragraph",
          heading: "背着走",
          text: "【MOCK】机身约 1.2 kg（虚构数据，实际重量因配置而异）。",
          factIds: ["mock-f-002"],
        },
        { type: "image", imageId: "mock-i-002", caption: "【MOCK】校园场景占位图", placementReason: "紧跟携带段落，呼应场景" },
        {
          type: "paragraph",
          heading: "撑一天",
          text: "【MOCK】视频播放最长约 10 小时（虚构实验室数据，实际因使用场景而异）。",
          factIds: ["mock-f-003"],
        },
        {
          type: "paragraph",
          heading: "接口够用",
          text: "【MOCK】提供 2 个 Type-C 和 1 个 HDMI（虚构）。",
          factIds: ["mock-f-006"],
        },
        { type: "image", imageId: "mock-i-003", caption: "【MOCK】接口细节占位图", placementReason: "接口段落旁，便于对照" },
        {
          type: "paragraph",
          heading: "买前提醒",
          text: "【MOCK】部分第三方软件需确认兼容后再购买（虚构）。",
          factIds: ["mock-f-007"],
        },
      ],
      callToAction: "【MOCK】收藏本篇，到店体验后再决定。",
      tags: ["#开学季", "#大学生数码", "#MOCK示例"],
    },
    verification: {
      findings: [
        {
          findingId: "mock-v-001",
          kind: "fact",
          severity: "minor",
          blockIndex: 1,
          excerpt: "约 1.2 kg",
          message: "重量已带入“实际因配置而异”的限定条件",
          factIds: ["mock-f-002"],
          imageIds: [],
          resolution: "passed",
        },
        {
          findingId: "mock-v-002",
          kind: "image",
          severity: "minor",
          message: "图片型号与正文型号一致（均为 mock-air-14）",
          factIds: [],
          imageIds: ["mock-i-001", "mock-i-002", "mock-i-003"],
          resolution: "passed",
        },
        {
          findingId: "mock-v-003",
          kind: "compliance",
          severity: "minor",
          excerpt: "最长约 10 小时",
          blockIndex: 3,
          message: "避免绝对化续航承诺，已保留“视频播放、实验室数据”条件",
          factIds: ["mock-f-003"],
          imageIds: [],
          resolution: "flagged",
          resolutionNote: "已保留限定条件",
        },
      ],
      pendingConfirmations: [],
      deliveryStatus: "deliverable_with_notes",
      checkedAt: NOW,
    },
    materialPack: buildMockMaterialPack(taskId),
    isMock: true,
  };
}
