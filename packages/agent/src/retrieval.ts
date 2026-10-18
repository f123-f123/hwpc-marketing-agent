/**
 * 检索层：只通过注入的 DataService 取数。把搜索结果落成候选，把资料包落成证据快照。
 * 产品事实未知 → 在这里查询，不会变成对用户的提问。
 */
import {
  DataServiceError,
  type DataService,
  type FactRecord,
  type MaterialPack,
  type ProductIdentity,
  type ProductRef,
} from "@hwpc/contracts";
import { SCENARIO_CATEGORY_PRIORITY } from "./lexicon.js";
import type { Candidate, ConversationState, EvidenceSnapshot } from "./types.js";
import { hash, norm, uniq } from "./util.js";
import { modeOf } from "./mode.js";
import type { Scenario } from "@hwpc/contracts";

export interface RetrievalDeps {
  data: DataService;
  now: () => Date;
  signal?: AbortSignal;
  emit?: (e: { stage: "material_retrieval" | "fact_extraction"; message: string; detail?: Record<string, unknown>; simulated?: boolean }) => void;
  simulated?: boolean;
}

const errInfo = (e: unknown) => ({
  code: e instanceof DataServiceError ? e.code : "unknown",
  message: e instanceof Error ? e.message : String(e),
});

function candidateFrom(p: ProductIdentity, via: Candidate["via"], status: Candidate["status"] = "open"): Candidate {
  return {
    productId: p.productId,
    model: p.model,
    family: p.family,
    configurations: p.configurations.map((c) => ({ configurationId: c.configurationId, label: c.label, attributes: c.attributes })),
    status,
    via,
    highlights: [],
    evidenceLoaded: false,
    configRequired: false,
    facts: [],
    conflicts: [],
    gaps: [],
    origin: p.origin,
  };
}

/** 搜索并把结果合并进候选表。返回搜索是否成功。 */
export async function searchInto(
  s: ConversationState,
  query: string,
  via: Candidate["via"],
  deps: RetrievalDeps,
): Promise<{ ok: boolean; ambiguous: boolean; found: ProductIdentity[]; configOptions: { productId: string; configurationId?: string; label: string }[] }> {
  const at = deps.now().toISOString();
  try {
    deps.emit?.({ stage: "material_retrieval", message: `按「${query}」检索产品`, simulated: deps.simulated });
    const r = await deps.data.searchProducts(query, deps.signal);
    s.searchLog.push({ query, resultProductIds: r.candidates.map((c) => c.productId), ambiguous: r.ambiguous, at });
    for (const p of r.candidates) {
      const ex = s.candidates.find((c) => c.productId === p.productId);
      if (!ex) s.candidates.push(candidateFrom(p, via));
      else if (ex.configurations.length === 0 && p.configurations.length) ex.configurations = candidateFrom(p, via).configurations;
    }
    const configOptions = (r.disambiguation?.options ?? []).filter((o) => o.configurationId);
    return { ok: true, ambiguous: r.ambiguous, found: r.candidates, configOptions };
  } catch (e) {
    s.searchLog.push({ query, resultProductIds: [], ambiguous: false, at, error: errInfo(e).message });
    return { ok: false, ambiguous: false, found: [], configOptions: [] };
  }
}

/** 候选亮点：取每个类别的第一条事实，按场景优先级排序，原值不改写。 */
function highlightsOf(pack: MaterialPack, productId: string, scenario?: Scenario): Candidate["highlights"] {
  const prio = SCENARIO_CATEGORY_PRIORITY[scenario ?? "other"];
  const facts = pack.facts.filter((f) => f.productId === productId && f.reviewStatus === "verified" && f.configurationIds.length === 0 && f.category !== "limitation" && f.category !== "price");
  const byCat = new Map<string, FactRecord>();
  for (const f of facts) if (!byCat.has(f.category)) byCat.set(f.category, f);
  return [...byCat.values()]
    .sort((a, b) => {
      const x = prio.indexOf(a.category);
      const y = prio.indexOf(b.category);
      return (x < 0 ? 99 : x) - (y < 0 ? 99 : y);
    })
    .slice(0, 4)
    .map((f) => ({ factId: f.factId, category: f.category, field: f.field, value: f.value }));
}

/** 为候选加载资料亮点（最多 limit 个），用于区分候选。 */
export async function loadCandidateEvidence(s: ConversationState, deps: RetrievalDeps, limit = 3): Promise<number> {
  let loaded = 0;
  const scenario = s.items["scenario"]?.value as Scenario | undefined;
  for (const c of s.candidates.filter((x) => x.status !== "rejected" && !x.evidenceLoaded).slice(0, limit)) {
    try {
      deps.emit?.({ stage: "material_retrieval", message: `读取候选「${c.model}」资料`, simulated: deps.simulated });
      const pack = await deps.data.getMaterialPack({
        taskId: s.taskId,
        product: { productId: c.productId },
        scenarioHint: scenario,
        platformHint: s.items["platform"]?.value,
        maxImages: 0,
        signal: deps.signal,
      });
      c.highlights = highlightsOf(pack, c.productId, scenario);
      c.facts = pack.facts.filter((f) => f.productId === c.productId);
      c.conflicts = pack.conflicts.filter((x) => x.productId === c.productId);
      c.gaps = pack.gaps;
      c.origin = pack.facts[0]?.source.origin ?? c.origin;
      c.configRequired = pack.facts.some((f) => f.productId === c.productId && f.configurationIds.length > 0) && c.configurations.length > 1;
      c.evidenceLoaded = true;
      loaded += 1;
    } catch (e) {
      c.evidenceLoaded = true;
      c.highlights = [];
      s.searchLog.push({ query: `material:${c.productId}`, resultProductIds: [c.productId], ambiguous: false, at: deps.now().toISOString(), error: errInfo(e).message });
    }
  }
  return loaded;
}

export function mergePacks(taskId: string, packs: MaterialPack[], at: string): MaterialPack {
  if (packs.length === 1) return packs[0]!;
  const byId = <T>(items: T[], key: (t: T) => string) => [...new Map(items.map((i) => [key(i), i])).values()];
  return {
    packId: `merged-${taskId}-${packs.length}`,
    taskId,
    products: byId(packs.flatMap((p) => p.products), (p) => p.productId),
    facts: byId(packs.flatMap((p) => p.facts), (f) => f.factId),
    images: byId(packs.flatMap((p) => p.images), (i) => i.imageId),
    conflicts: byId(packs.flatMap((p) => p.conflicts), (c) => c.conflictId),
    gaps: uniq(packs.flatMap((p) => p.gaps)),
    origins: uniq(packs.flatMap((p) => p.origins)),
    isMock: packs.some((p) => p.isMock),
    createdAt: at,
  };
}

/** 为当前需求版本加载证据快照（所选型号的完整资料包）。 */
export async function loadEvidence(s: ConversationState, purpose: EvidenceSnapshot["purpose"], deps: RetrievalDeps): Promise<EvidenceSnapshot> {
  const refs: ProductRef[] = evidenceRefs(s);
  const at = deps.now().toISOString();
  const base = {
    snapshotId: `ev-${s.evidence.length + 1}`,
    takenAt: at,
    requirementVersion: s.requirementVersion,
    fingerprint: evidenceKey(s),
    productRefs: refs,
    hints: { scenario: s.items["scenario"]?.value, platform: s.items["platform"]?.value },
    purpose,
  };
  let snap: EvidenceSnapshot;
  try {
    const packs: MaterialPack[] = [];
    for (const ref of refs) {
      deps.emit?.({ stage: "material_retrieval", message: `读取资料包：${ref.productId}`, simulated: deps.simulated });
      packs.push(
        await deps.data.getMaterialPack({
          taskId: s.taskId,
          product: ref,
          scenarioHint: s.items["scenario"]?.value,
          platformHint: s.items["platform"]?.value,
          maxImages: 8,
          signal: deps.signal,
        }),
      );
    }
    const pack = packs.length ? mergePacks(s.taskId, packs, at) : null;
    if (pack) {
      // 选购模式：同一次取数同时回填候选的事实/冲突/亮点，避免对同一型号重复查询。
      const scenario = s.items["scenario"]?.value as Scenario | undefined;
      for (const c of s.candidates) {
        if (!refs.some((r) => r.productId === c.productId)) continue;
        c.facts = pack.facts.filter((f) => f.productId === c.productId);
        c.conflicts = pack.conflicts.filter((x) => x.productId === c.productId);
        c.gaps = pack.gaps;
        c.highlights = highlightsOf(pack, c.productId, scenario);
        c.evidenceLoaded = true;
        c.origin = c.facts[0]?.source.origin ?? c.origin;
        c.configRequired = c.facts.some((f) => f.configurationIds.length > 0) && c.configurations.length > 1;
      }
    }
    deps.emit?.({
      stage: "fact_extraction",
      message: pack ? `取得 ${pack.facts.length} 条事实、${pack.images.length} 张图片` : "尚无产品范围，未检索",
      detail: pack ? { facts: pack.facts.length, images: pack.images.length, conflicts: pack.conflicts.length } : undefined,
      simulated: pack?.isMock ?? deps.simulated,
    });
    snap = { ...base, pack };
  } catch (e) {
    snap = { ...base, pack: null, error: errInfo(e) };
  }
  s.evidence.push(snap);
  return snap;
}

/** 证据只取决于：所选型号/配置，以及用于排序的场景与渠道。 */
export const evidenceRefs = (s: ConversationState): ProductRef[] => {
  const chosen = s.items["productScope"]?.refs;
  if (chosen?.length) return chosen;
  if (modeOf(s) === "marketing") return [];
  return s.candidates.filter((c) => c.status !== "rejected").slice(0, MAX_SHOPPING_CANDIDATES).map((c) => ({ productId: c.productId }));
};
export const MAX_SHOPPING_CANDIDATES = 4;

export const evidenceKey = (s: ConversationState): string =>
  hash({ refs: evidenceRefs(s).map((r) => `${r.productId}/${r.configurationId ?? ""}`), sc: modeOf(s) === "marketing" ? s.items["scenario"]?.value : "", pf: modeOf(s) === "marketing" ? s.items["platform"]?.value : "" });

export const latestEvidence = (s: ConversationState): EvidenceSnapshot | undefined => {
  const key = evidenceKey(s);
  return [...s.evidence].reverse().find((e) => e.requirementVersion === s.requirementVersion && e.fingerprint === key);
};

/** 用型号文字匹配已有候选（宽松包含）。 */
export function matchCandidate(s: ConversationState, text: string): Candidate | undefined {
  const t = norm(text);
  if (!t) return undefined;
  const hits = s.candidates.filter((c) => {
    const m = norm(c.model);
    return t.includes(m) || (m.length > 4 && m.includes(t) && t.length >= 4);
  });
  return hits.length === 1 ? hits[0] : undefined;
}

export const productLabel = (s: ConversationState, ref: ProductRef): string => {
  const c = s.candidates.find((x) => x.productId === ref.productId);
  const cfg = c?.configurations.find((x) => x.configurationId === ref.configurationId);
  return `${c?.model ?? ref.productId}${cfg ? `（${cfg.label}）` : ""}`;
};
