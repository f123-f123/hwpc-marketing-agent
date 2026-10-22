/**
 * 模拟顾问引擎（MOCK）。关键词规则，确定性，不调用任何模型。
 * 用途：在 Agent B 的真实引擎接入前，让服务端、前端和测试跑通同一条链路。
 * 它不代表真实判断；会话快照里 components.engine.isMock 为 true，界面必须提示。
 */
import type {
  AdvisorEngine,
  AdvisorProposal,
  AdvisorView,
  CandidateAssessment,
  Criterion,
  EvidenceRef,
  NeedEdit,
  NeedEntry,
  NeedKey,
  PlanProposal,
  QuestionProposal,
} from "@hwpc/contracts";
import { mockFacts } from "./data.js";
import { MOCK_SCENE_IDS } from "./scenes.js";

const factEvidence = (factId: string): EvidenceRef => {
  const f = mockFacts.find((x) => x.factId === factId);
  if (!f) throw new Error(`mock 事实不存在: ${factId}`);
  return { factId, source: f.source, excerpt: `${f.field}：${f.value}` };
};
const crit = (id: string, text: string, factId?: string): Criterion => ({ criterionId: id, text, evidence: factId ? [factEvidence(factId)] : [] });

/* ------------------------------ 抽取 ------------------------------ */

interface Hit {
  key: NeedKey;
  value: string;
  quote: string;
  structured?: Record<string, number | string>;
}

const PATTERNS: { key: NeedKey; re: RegExp; value: (m: RegExpMatchArray) => string }[] = [
  { key: "task", re: /(出差|通勤|办公|写文档|写代码|剪视频|上课|开会|做设计|玩游戏|写论文|做表格|网课|追剧)/, value: (m) => `用于${m[1]}` },
  { key: "hardConstraints", re: /(?:必须|一定要|不接受|不能)([^，。,.；;]{1,20})/, value: (m) => m[1]!.trim() },
  { key: "requiredSoftware", re: /(?:要用|离不开)([^，。,.；;]{1,20})/, value: (m) => m[1]!.trim() },
  { key: "existingDevices", re: /(?:我(?:已经)?有|手上有|在用)([^，。,.；;]{1,20})/, value: (m) => m[1]!.trim() },
  { key: "concerns", re: /(?:担心|怕|顾虑)([^，。,.；;]{1,20})/, value: (m) => m[1]!.trim() },
  { key: "preferences", re: /(?:喜欢|希望|想要)([^，。,.；;]{1,20})/, value: (m) => m[1]!.trim() },
];

export function extractHits(text: string): Hit[] {
  const hits: Hit[] = [];
  for (const p of PATTERNS) {
    const m = text.match(p.re);
    if (m) hits.push({ key: p.key, value: p.value(m), quote: m[0] });
  }
  const b = text.match(/预算[^\d]{0,4}(\d+(?:\.\d+)?)\s*(万|千|k|元|块)?/) ?? text.match(/(\d+(?:\.\d+)?)\s*(万|千|元|块)\s*(?:以内|以下|左右)/);
  if (b) {
    const unit = b[2];
    const n = Number(b[1]) * (unit === "万" ? 10000 : unit === "千" || unit === "k" ? 1000 : 1);
    hits.push({ key: "budget", value: `预算约 ${n} 元`, quote: b[0], structured: { max: n, currency: "CNY" } });
  }
  return hits;
}

const toEdits = (hits: Hit[]): NeedEdit[] =>
  hits.map((h) => ({ op: "set", key: h.key, value: h.value, status: "known", quote: h.quote, structured: h.structured }));

/** 把本轮编辑叠加到当前条目上，得到“编辑后”的视图，用于评价候选。 */
function project(entries: NeedEntry[], edits: NeedEdit[]): { key: NeedKey; value: string; hard: boolean }[] {
  const out = entries.map((e) => ({ key: e.key, value: e.value, hard: e.hard }));
  for (const ed of edits) {
    if (ed.op !== "set") continue;
    if (ed.key === "budget" || ed.key === "environment") {
      const i = out.findIndex((x) => x.key === ed.key);
      if (i >= 0) out.splice(i, 1);
    }
    out.push({ key: ed.key, value: ed.value, hard: ed.key === "hardConstraints" });
  }
  return out;
}

/* ------------------------------ 候选评价 ------------------------------ */

type Proj = ReturnType<typeof project>;
const has = (p: Proj, key: NeedKey, re: RegExp) => p.some((x) => x.key === key && re.test(x.value));

export function assessMockCandidates(p: Proj, needVersion: number, rejected: string[]): CandidateAssessment[] {
  if (!p.some((x) => x.key === "task")) return [];
  const travels = has(p, "task", /出差|通勤/);
  const wantsLight = has(p, "preferences", /轻/) || has(p, "hardConstraints", /轻/) || travels;
  const hardLight = has(p, "hardConstraints", /轻/);
  const needsSoftware = p.some((x) => x.key === "requiredSoftware");
  const ids = ["mock-air-14", "mock-air-16"];
  const names: Record<string, string> = { "mock-air-14": "【MOCK】示例本 Air 14", "mock-air-16": "【MOCK】示例本 Air 16" };

  const result = ids.map((productId): CandidateAssessment => {
    const satisfied: Criterion[] = [];
    const unmet: (Criterion & { hard: boolean })[] = [];
    const compromises: Criterion[] = [];
    const unknowns: Criterion[] = [];
    const is14 = productId === "mock-air-14";

    if (rejected.includes(productId)) {
      unmet.push({ criterionId: "rejected", text: "你已明确表示不考虑这一款", evidence: [], hard: true });
    } else {
      if (wantsLight) {
        if (is14) satisfied.push(crit("light", "机身较轻（约 1.2 kg，虚构数据）", "mock-f-002"));
        else if (hardLight) unmet.push({ ...crit("light", "机身约 1.7 kg，不满足“必须轻便”的硬条件", "mock-f-102"), hard: true });
        else compromises.push(crit("light", "机身约 1.7 kg，偏重", "mock-f-102"));
      }
      if (travels) {
        if (is14) satisfied.push(crit("battery", "视频播放最长 10 小时（虚构实验室数据）", "mock-f-003"));
        else unknowns.push(crit("battery", "资料中没有续航数据，无法判断"));
      }
      if (needsSoftware) {
        if (is14) compromises.push(crit("software", "部分第三方软件需先确认兼容", "mock-f-007"));
        else unknowns.push(crit("software", "资料中没有软件兼容性依据"));
      }
    }

    const overall: CandidateAssessment["overall"] = unmet.some((u) => u.hard)
      ? "not_fit"
      : unknowns.length > 0
        ? "insufficient_evidence"
        : compromises.length > 0
          ? "fits_with_compromise"
          : "fits";
    const other = ids.find((i) => i !== productId)!;
    return {
      candidateId: `cand-${productId}`,
      product: { productId },
      modelName: names[productId]!,
      assessedNeedVersion: needVersion,
      overall,
      satisfied,
      unmet,
      compromises,
      unknowns,
      comparisonReason:
        overall === "not_fit"
          ? "有未满足的硬条件，不作为候选"
          : overall === "insufficient_evidence"
            ? "资料不足以判断全部需求，不能直接推荐"
            : `在已知资料范围内满足度高于${names[other]}`,
      comparedWith: [`cand-${other}`],
      origin: "mock",
      isMock: true,
    };
  });
  return result;
}

/* ------------------------------ 问题 ------------------------------ */

function questionsFor(p: Proj): QuestionProposal[] {
  const q: QuestionProposal[] = [];
  if (!p.some((x) => x.key === "task")) {
    q.push({ kind: "clarify", prompt: "你主要会用它做什么？", reason: "不知道用途就没法判断哪款合适", targetKeys: ["task"], allowFreeText: true });
  } else if (!p.some((x) => x.key === "budget")) {
    q.push({
      kind: "preference",
      prompt: "预算大概在什么范围？",
      reason: "预算会改变可选范围",
      targetKeys: ["budget"],
      options: [
        { value: "预算约 5000 元", label: "5000 元左右" },
        { value: "预算约 8000 元", label: "8000 元左右" },
        { value: "预算不限", label: "不限" },
      ],
      allowFreeText: true,
    });
  }
  return q;
}

const summarizeEdits = (edits: NeedEdit[]) =>
  edits
    .filter((e): e is Extract<NeedEdit, { op: "set" }> => e.op === "set")
    .map((e) => e.value)
    .join("、");

function build(view: AdvisorView, edits: NeedEdit[], lead: string): AdvisorProposal {
  const p = project(view.entries, edits);
  const nextVersion = view.needVersion + 1;
  const candidates = assessMockCandidates(p, edits.length ? nextVersion : view.needVersion, view.rejectedProductIds);
  const questions = questionsFor(p);
  const noted = summarizeEdits(edits);
  const reply = [
    "（模拟顾问，关键词规则，不是真实 AI 判断）",
    lead,
    noted ? `我记下了：${noted}。` : "",
    questions.length ? questions[0]!.prompt : "信息够了，你可以查看需求摘要，确认后我再为你组装个人方案。",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    reply,
    needEdits: edits,
    questions,
    candidates: candidates.length ? candidates : undefined,
    suggestedScenes: p.some((x) => x.key === "task") && !view.excludedSceneIds.includes(MOCK_SCENE_IDS.commute)
      ? [{ sceneId: MOCK_SCENE_IDS.commute, version: 1, reason: "先看看带着电脑出行的一天是什么样（说明性，不是推荐）" }]
      : [],
    references: [],
  };
}

export function createMockAdvisorEngine(): AdvisorEngine {
  return {
    isMock: true,
    async respond(view, userText) {
      return build(view, toEdits(extractHits(userText)), "好的。");
    },
    async answer(view, answers) {
      const edits: NeedEdit[] = [];
      for (const a of answers) {
        const q = view.openQuestions.find((x) => x.questionId === a.questionId);
        const hits = extractHits(a.answer);
        edits.push(...toEdits(hits));
        const key = (q?.targetKeys[0] ?? "preferences") as NeedKey;
        if (!hits.some((h) => h.key === key)) {
          edits.push({ op: "set", key, value: a.answer, status: "known", quote: a.answer });
        }
      }
      return build(view, edits, "收到你的回答。");
    },
    async interpretFeedback(view, fb) {
      const hits = extractHits(fb.text);
      let edits = toEdits(hits);
      if (edits.length === 0 && (fb.kind === "new_need" || fb.kind === "change_need")) {
        edits = [{ op: "set", key: "preferences", value: fb.text.slice(0, 80), status: "known", quote: fb.text.slice(0, 80) }];
      }
      if (edits.length === 0 && fb.kind === "concern") {
        edits = [{ op: "set", key: "concerns", value: fb.text.slice(0, 80), status: "known", quote: fb.text.slice(0, 80) }];
      }
      return build(view, edits, "谢谢你的反馈，我据此调整。");
    },
    async composePlan(view, deps): Promise<PlanProposal> {
      const cands = assessMockCandidates(
        view.entries.map((e) => ({ key: e.key, value: e.value, hard: e.hard })),
        view.needVersion,
        view.rejectedProductIds,
      );
      const rank = ["fits", "fits_with_compromise"];
      const primary = cands.find((c) => c.overall === "fits") ?? cands.find((c) => c.overall === "fits_with_compromise");
      const byCandidate = cands.map((c) => ({
        candidateId: c.candidateId,
        role: (c === primary ? "recommended" : rank.includes(c.overall) ? "alternative" : "not_recommended") as "recommended" | "alternative" | "not_recommended",
        reason: c.comparisonReason,
      }));
      const scenes: PlanProposal["scenes"] = [];
      const taskIds = view.entries.filter((e) => e.key === "task").map((e) => e.entryId);
      const commute = deps.catalog.latest(MOCK_SCENE_IDS.commute);
      if (primary && commute && !view.excludedSceneIds.includes(commute.sceneId)) {
        scenes.push({
          sceneId: commute.sceneId,
          version: commute.version,
          bindings: { laptop: primary.product },
          params: { commuteMode: "metro", hoursOutside: 4 },
          reason: "你的用途涉及携带出行，先走一遍一天的行程",
          relatedNeedEntryIds: taskIds,
        });
      }
      const phoneEntry = view.entries.find((e) => e.key === "existingDevices" && /手机/.test(e.value));
      const collab = deps.catalog.latest(MOCK_SCENE_IDS.collab);
      if (primary && phoneEntry && collab && !view.excludedSceneIds.includes(collab.sceneId)) {
        const phoneId = /B/i.test(phoneEntry.value) ? "mock-phone-b" : "mock-phone-a";
        scenes.push({
          sceneId: collab.sceneId,
          version: collab.version,
          bindings: { laptop: primary.product, phone: { productId: phoneId } },
          params: { content: "photo" },
          reason: "你提到已有手机，看看和电脑怎么配合",
          relatedNeedEntryIds: [phoneEntry.entryId],
        });
      }
      return {
        candidates: cands,
        recommendation: {
          primary: primary?.product,
          byCandidate,
          noRecommendationReason: primary ? undefined : "现有资料不足以给出推荐，需要补充信息或更多资料",
        },
        scenes,
        unresolvedQuestions: view.entries.some((e) => e.key === "budget") ? [] : [{ kind: "preference", prompt: "预算范围还没定", reason: "会影响最终取舍", targetKeys: ["budget"], allowFreeText: true }],
      };
    },
  };
}
