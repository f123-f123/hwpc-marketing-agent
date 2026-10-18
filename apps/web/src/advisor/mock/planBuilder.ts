/**
 * 界面模拟：个人方案。
 * 真实后端里，推荐的体验、顺序和理由由 B 给出，设备能力由 A 的证据绑定。
 * 这里全部是模拟：设备是虚拟示意设备，理由带 [模拟顾问理由] 标记，不含任何真实产品参数。
 */
import { getScene, simulatedConfig, type PersonalPlan, type PlanCandidate } from "@hwpc/scenes";
import type { Knowns } from "./knowns";
import { candidatesFor } from "./knowns";

export function buildMockPlan(sessionId: string, planVersion: number, requirementVersion: number, k: Knowns, confirmed: boolean): PersonalPlan {
  const ms = getScene("multi-screen-extend", 1)!;
  const ft = getScene("phone-pc-file-transfer", 1)!;
  const cands: PlanCandidate[] = candidatesFor(k).map((c) => ({
    candidateId: c.candidateId,
    model: c.model,
    origin: c.origin,
    fitReasons: [c.fit],
    shortfalls: c.differences.filter((d) => /更重|更大/.test(d)),
    unknowns: c.unknowns,
    evidence: c.evidence.map((e) => ({ claim: e.claim, status: e.status, qualifiers: e.qualifiers, sourceTitle: e.sourceTitle, origin: e.origin })),
  }));
  return {
    planId: `plan-${sessionId}`,
    planVersion,
    createdAt: new Date().toISOString(),
    requirementVersion,
    requirementConfirmed: confirmed,
    conditions: [
      { label: "面向人群", value: k.audience ?? "（未确定）", provenance: k.audience ? "user_said" : "pending" },
      { label: "产品范围", value: k.scope === "compare" ? "示例本 Air 14 与 16" : k.scope === "air16" ? "示例本 Air 16" : "示例本 Air 14", provenance: "user_said" },
      { label: "限制", value: "不写价格与优惠", provenance: "assumed_default" },
    ],
    candidates: cands,
    experiences: [
      {
        experienceId: "exp-1",
        order: 1,
        sceneId: ms.sceneId,
        sceneVersion: ms.version,
        reason: "[模拟顾问理由] 先看大屏协同：它决定你日常在宿舍与自习室里怎么摆放窗口。真实推荐由顾问基于你的需求给出。",
        reasonSimulated: true,
        forCandidateIds: cands.map((c) => c.candidateId),
        config: simulatedConfig(ms),
      },
      {
        experienceId: "exp-2",
        order: 2,
        sceneId: ft.sceneId,
        sceneVersion: ft.version,
        reason: "[模拟顾问理由] 再看手机与电脑传文件：课程资料常在手机里，传输失败时你需要知道先查什么。",
        reasonSimulated: true,
        forCandidateIds: cands.map((c) => c.candidateId),
        config: simulatedConfig(ft),
      },
    ],
    openIssues: ["续航资料存在两个来源且数值不同，方案里没有写续航数值", "没有价格资料，方案不包含任何价格或优惠", "候选产品在这两项协同功能上的支持范围尚无资料证据，体验使用的是虚拟示意设备"],
    isMock: true,
    dataOrigin: "mock",
    notices: [
      "体验里的设备是虚拟示意设备，不是任何候选产品，也不是你的真实设备。",
      "全景空间是程序绘制的示意环境，不是真实门店或实机画面；其中没有 ima 产品图片。",
      "候选产品能否在真实设备上完成这些功能，需要资料证据（官方页面或实测）支持后才能判断。",
    ],
  };
}
