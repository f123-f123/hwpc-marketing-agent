/**
 * 知识库答疑引擎（体验页侧边提问）。
 *
 * 只回答、不修改：参数类问题直接报知识库原值和限制条件；价格报官方公开价格记录（带价格类型和核验日期）；
 * 其他问题检索型号检索卡、卖点与限制、常见问题、客户场景，引用原文作答。找不到依据就直说，不估计。
 * 配置了大模型时，把这些材料交给模型组织语言，回答里的数字必须都能在材料里找到，否则用规则版。
 */
import {
  LIBRARY_SECTION_LABEL,
  type FactRecord,
  type KnowledgeLibrary,
  type LibraryHit,
  type PageSection,
  type QaAnswerInput,
  type QaCitation,
  type QaEngine,
} from "@hwpc/contracts";
import { rewriteAnswer, type ModelResolver } from "./llm.js";
import { pickPrice } from "./profile.js";

/** 听起来是在改需求。 */
const NEED_CHANGE = /预算(?:改|换|提高|降|加)|改成|换成|不要了|其实我|另外还要|再加|增加一个|降到|提高到|改一下需求|换个需求/;

const TOPICS: { ask: RegExp; field: RegExp; name: string }[] = [
  { ask: /多重|重量|轻不轻|重不重|便携|带着/, field: /重量$/, name: "重量" },
  { ask: /厚|薄/, field: /(厚度|高度)$/, name: "厚度" },
  { ask: /屏|显示|分辨率|尺寸|多大|亮度|色域|刷新/, field: /^屏幕/, name: "屏幕" },
  { ask: /电池|续航|用多久|充电/, field: /电池|续航/, name: "电池" },
  { ask: /处理器|CPU|芯片|性能|卡不卡|显卡|GPU/i, field: /^处理器|^显卡/, name: "处理器与显卡" },
  { ask: /内存|存储|硬盘|容量|SSD/i, field: /^内存|^存储/, name: "内存与存储" },
  { ask: /接口|USB|HDMI|扩展坞|外接|雷电|Type-?C/i, field: /^接口/, name: "接口" },
  { ask: /系统|鸿蒙|Windows|Linux/i, field: /^操作系统/, name: "操作系统" },
  { ask: /摄像头|拍照|视频通话/, field: /^摄像头/, name: "摄像头" },
  { ask: /音箱|扬声器|麦克风|音质/, field: /^音频/, name: "音频" },
  { ask: /键盘|触控板|指纹/, field: /^键盘/, name: "键盘与触控板" },
  { ask: /无线|Wi-?Fi|蓝牙|星闪/i, field: /^无线连接/, name: "无线连接" },
  { ask: /包装|配件|送什么|充电器|适配器/, field: /^包装清单/, name: "包装清单" },
];

type Candidate = Extract<PageSection, { kind: "candidate" }>;
const short = (n: string) => n.replace(/^HUAWEI\s+/i, "");

/** 问题里点名的候选：完整型号，或型号里有辨识度的部分（Pro S、D 14、Fold、GT……）。 */
export function namedIn(question: string, cands: Candidate[]): Candidate[] {
  const q = question.replace(/\s+/g, "").toLowerCase();
  const key = (name: string) =>
    short(name)
      .replace(/（.*?）|\(.*?\)/g, "")
      .replace(/^MateBook/i, "")
      .replace(/\s+/g, "")
      .toLowerCase();
  const hits = cands.filter((c) => q.includes(short(c.name).replace(/\s+/g, "").toLowerCase()) || (key(c.name).length >= 2 && q.includes(key(c.name))));
  // “Pro S”同时命中“Pro”时只保留更长的那个
  return hits.filter((h) => !hits.some((o) => o !== h && key(o.name).includes(key(h.name)) && q.includes(key(o.name))));
}

const factLine = (f: FactRecord) => `${f.field.split("·").at(-1)}：${f.value}${f.reviewStatus !== "verified" ? "（资料待核）" : ""}`;

/** 联网检索（服务端注入，可选）：只在知识库没有依据时使用，结果标为“仅供参考”。 */
export type WebLookup = (query: string, signal?: AbortSignal) => Promise<{ title: string; url: string; snippet: string }[]>;

export function createKbQaEngine(opts: { library: KnowledgeLibrary; model?: ModelResolver; web?: WebLookup }): QaEngine {
  const { library } = opts;
  return {
    isMock: false,
    async answer(view, question, deps): Promise<QaAnswerInput> {
      const q = question.trim();
      if (NEED_CHANGE.test(q)) {
        return {
          reply: "这听起来会改变你的需求。体验页对应的是你确认过的那一版需求，我不会在这里改它；请回到需求沟通里说明，确认后会重新生成体验页。",
          citations: [],
          suggestNeedChange: true,
        };
      }
      const sections = view.page.sections;
      const cands = sections.filter((s): s is Candidate => s.kind === "candidate");
      const named = namedIn(q, cands);
      const scope = named.length ? named : cands;

      const facts = new Map<string, FactRecord[]>();
      await Promise.all(
        scope.map(async (c) => {
          try {
            const pack = await deps.data.getMaterialPack({ taskId: `qa-${view.plan.version}`, product: c.product, maxImages: 0, signal: deps.signal });
            facts.set(c.candidateId, pack.facts.filter((f) => f.productId === c.product.productId));
          } catch {
            facts.set(c.candidateId, []);
          }
        }),
      );

      let reply = "";
      const citations: QaCitation[] = [];
      const material: Record<string, unknown> = { question: q, candidates: scope.map((c) => ({ name: c.name, role: c.role, verdict: c.verdict })) };

      /* ---- 价格 ---- */
      if (/价格|多少钱|贵不贵|便宜|优惠|预算/.test(q)) {
        const lines: string[] = [];
        for (const c of scope) {
          const records = await library.prices(c.product.productId).catch(() => []);
          const p = pickPrice(records);
          if (p) {
            lines.push(`${short(c.name)}：${p.record.priceType} ${p.from} 元起（${p.record.variant || "对应版本"}，核验时间 ${p.record.checkedAt.slice(0, 10)}）${p.offShelf ? "；官方商城当前显示下架或无公开商城价" : ""}`);
            citations.push({ title: p.record.source.title, locator: p.record.source.officialUrl ?? p.record.source.locator, quote: `${p.record.priceType} ${p.from} 元` });
          } else lines.push(`${short(c.name)}：官方价格快照里没有可引用的公开金额`);
        }
        reply = `${lines.join("\n")}\n价格、优惠和库存会变动，以门店和官方商城结算页为准。`;
        material.prices = lines;
      }

      /* ---- 软件能否安装：先看系统，再引用常见问题原文 ---- */
      if (!reply && /能装|安装|兼容|能不能用|能用吗|软件|应用/.test(q)) {
        const osOf = (c: Candidate) => (facts.get(c.candidateId) ?? []).filter((f) => /^操作系统/.test(f.field));
        const wantOs = /鸿蒙|HarmonyOS/i.test(q) ? /HarmonyOS|鸿蒙/i : /Windows/i.test(q) ? /Windows/i : undefined;
        const inScope = wantOs ? scope.filter((c) => osOf(c).some((f) => wantOs.test(f.value))) : scope;
        const osLines = (inScope.length ? inScope : scope).map((c) => `${short(c.name)}：${osOf(c).map((f) => f.value).join(" / ") || "资料未列出系统"}`);
        const faq = await library.search(`${q} 专业软件能否安装 鸿蒙版与Windows版区别`, { sections: ["faq", "lookup"], productIds: (inScope.length ? inScope : scope).map((c) => c.product.productId), limit: 2, signal: deps.signal }).catch(() => []);
        reply = [
          `系统：${osLines.join("；")}。`,
          ...faq.map((h) => `《${h.title}${h.heading ? ` · ${h.heading}` : ""}》：${h.excerpt}`),
          "能否安装、功能是否完整，要以软件厂商的系统要求为准；到店可以带上安装包或账号在真机上试。",
        ].join("\n");
        for (const h of faq) citations.push({ title: `${LIBRARY_SECTION_LABEL[h.section]}：${h.title}`, locator: h.source.locator, quote: h.excerpt.slice(0, 200) });
        material.software = { os: osLines, library: faq.map((h) => h.excerpt) };
      }

      /* ---- 参数 ---- */
      const topics = TOPICS.filter((t) => t.ask.test(q));
      if (!reply && topics.length) {
        const lines: string[] = [];
        for (const c of scope) {
          const list = (facts.get(c.candidateId) ?? []).filter((f) => topics.some((t) => t.field.test(f.field) || t.field.test(f.field.split("·").at(-1) ?? "")));
          if (!list.length) continue;
          const quals = [...new Set(list.flatMap((f) => f.qualifiers))].filter((x) => !/具体参数因销售版本而异/.test(x)).slice(0, 2);
          lines.push(`${short(c.name)}——${list.slice(0, 6).map(factLine).join("；")}${quals.length ? `（${quals.join("；")}）` : ""}`);
          citations.push({ title: list[0]!.source.title, locator: list[0]!.source.locator, quote: factLine(list[0]!) });
        }
        if (lines.length) {
          reply = `${lines.join("\n")}\n以上为知识库原文，具体以实际销售版本为准。`;
          material.facts = lines;
        }
      }

      /* ---- 推荐与比较 ---- */
      if (!reply && /推荐|选哪|哪款|哪个好|区别|对比|为什么|比较/.test(q)) {
        const plan = sections.find((s) => s.kind === "plan");
        if (plan?.kind === "plan" && plan.primaryName) {
          const others = plan.others.map((o) => `${short(o.name)}：${o.reason}`).join("\n");
          reply = `首选 ${short(plan.primaryName)}：${plan.primaryReason ?? ""}${others ? `\n其他候选——\n${others}` : ""}`;
        } else reply = `这次方案没有给出首选：${plan?.kind === "plan" ? (plan.noRecommendationReason ?? "资料不足以判断") : "资料不足以判断"}。`;
        material.plan = reply;
      }

      /* ---- 取舍与顾虑 ---- */
      if (!reply && /缺点|不足|妥协|取舍|担心|风险|不适合/.test(q)) {
        const lines = scope.flatMap((c) => [...c.compromises, ...c.unmet, ...c.unknowns].map((p) => `${short(c.name)}：${p.text}`));
        reply = lines.length ? lines.slice(0, 8).join("\n") : "按现有资料，没有列出需要取舍的地方；资料没覆盖的项目不代表没有问题。";
        material.tradeoffs = lines;
      }

      /* ---- 其他：检索知识库 ---- */
      let hits: LibraryHit[] = [];
      if (!reply || q.length > 12) {
        const names = scope.map((c) => short(c.name)).join(" ");
        hits = await library
          .search(`${q} ${names}`, { productIds: scope.map((c) => c.product.productId), sections: ["lookup", "selling", "faq", "role_script", "scenario"], limit: 3, signal: deps.signal })
          .catch(() => []);
        if (hits.length) {
          material.library = hits.map((h) => ({ title: h.title, excerpt: h.excerpt }));
          for (const h of hits.slice(0, 2)) citations.push({ title: `${LIBRARY_SECTION_LABEL[h.section]}：${h.title}`, locator: h.source.locator, quote: h.excerpt.slice(0, 200) });
          if (!reply) reply = hits.slice(0, 2).map((h) => `《${h.title}${h.heading ? ` · ${h.heading}` : ""}》：${h.excerpt}`).join("\n");
        }
      }
      if (!reply && opts.web) {
        const found = await opts.web(`${q} ${scope.map((c) => short(c.name)).join(" ")}`, deps.signal).catch(() => []);
        if (found.length) {
          const lines = found.slice(0, 2).map((h) => `· ${h.title}：${h.snippet.slice(0, 120)}`);
          reply = ["知识库里没有直接依据。联网检索到这些页面（仅供参考，不作为产品事实）：", ...lines].join("\n");
          for (const h of found.slice(0, 2)) citations.push({ title: `联网参考：${h.title}`, locator: h.url });
          material.web = found.slice(0, 2);
        }
      }
      if (!reply) {
        reply = "知识库里没有找到能直接回答这个问题的依据。可以换个问法，或到店请导购用真机演示。";
      }

      const model = opts.model?.();
      if (model) {
        const r = await rewriteAnswer(model, { ...material, ruleAnswer: reply }, reply, deps.signal);
        reply = r.text;
      }
      const unique = citations.filter((c, i) => citations.findIndex((x) => x.title === c.title) === i);
      return { reply, citations: unique.slice(0, 4) };
    },
  };
}
