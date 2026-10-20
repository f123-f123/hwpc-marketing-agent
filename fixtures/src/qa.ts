/**
 * 模拟答疑引擎（MOCK）。关键词规则，确定性，不调用任何模型。
 * 只从体验页已有的内容里找答案（候选的事实数字、满足/取舍、方案理由、场景），找不到就如实说没有依据。
 * 问题涉及改变需求时，只提示回到需求沟通，不做任何修改。
 */
import type { PageSection, QaAnswerInput, QaEngine } from "@hwpc/contracts";

const PREFIX = "（模拟答疑，关键词规则，不是真实 AI 判断）\n";

/** 听起来是在改需求。 */
const NEED_CHANGE = /预算|改成|换成|不要了|其实我|另外还|再加|增加一个|降到|提高到|改一下|换个需求/;

/** 参数类问题：问法 → 事实字段。 */
const TOPICS: { ask: RegExp; field: RegExp; name: string }[] = [
  { ask: /重|轻|便携|带着/, field: /重量/, name: "重量" },
  { ask: /屏|显示|分辨率|尺寸|多大/, field: /尺寸|屏幕|分辨率|类型/, name: "屏幕" },
  { ask: /电池|续航|充电|用多久/, field: /电池|容量|续航/, name: "电池" },
  { ask: /处理器|性能|CPU|芯片|卡不卡/, field: /处理器|CPU/, name: "处理器" },
  { ask: /接口|USB|HDMI|扩展坞|外接/, field: /接口/, name: "接口" },
];

type Candidate = Extract<PageSection, { kind: "candidate" }>;

export function createMockQaEngine(): QaEngine {
  return {
    isMock: true,
    async answer(view, question): Promise<QaAnswerInput> {
      const q = question.trim();
      if (NEED_CHANGE.test(q)) {
        return {
          reply: `${PREFIX}这听起来会改变你的需求。体验页对应的是你确认过的那一版需求，我不会在这里改它；请回到需求沟通里说明，确认后会重新生成体验页。`,
          citations: [],
          suggestNeedChange: true,
        };
      }

      const sections = view.page.sections;
      const cands = sections.filter((s): s is Candidate => s.kind === "candidate");
      const named = cands.filter((c) => q.includes(c.name) || c.name.split(/[\s（(]/).some((w) => w.length >= 4 && q.includes(w)));
      const scope = named.length ? named : cands;

      // 参数类：只报资料里的原值和限制条件
      const topic = TOPICS.find((t) => t.ask.test(q));
      if (topic) {
        const lines = scope.flatMap((c) =>
          c.highlights.filter((h) => topic.field.test(h.label)).map((h) => `${c.name}：${h.label} ${h.value}${h.qualifiers.length ? `（${h.qualifiers.join("；")}）` : ""}`),
        );
        if (!lines.length) {
          return { reply: `${PREFIX}当前方案的资料里没有找到“${topic.name}”这一项的数据，我不能替你估计。可以到店请导购用真机核对。`, citations: [] };
        }
        return { reply: `${PREFIX}${lines.join("\n")}`, citations: scope.map((c) => ({ title: `${c.name} 产品资料` })) };
      }

      // 推荐与比较
      if (/推荐|选哪|哪款|哪个好|区别|对比|为什么/.test(q)) {
        const plan = sections.find((s) => s.kind === "plan");
        if (plan?.kind === "plan" && plan.primaryName) {
          const others = plan.others.map((o) => `${o.name}：${o.reason}`).join("\n");
          return { reply: `${PREFIX}首选是 ${plan.primaryName}：${plan.primaryReason ?? ""}${others ? `\n其他候选——\n${others}` : ""}`, citations: [] };
        }
        return { reply: `${PREFIX}这次方案没有给出首选：${plan?.kind === "plan" ? (plan.noRecommendationReason ?? "资料不足以判断") : "资料不足以判断"}。`, citations: [] };
      }

      // 取舍与顾虑
      if (/缺点|不足|妥协|取舍|担心|风险/.test(q)) {
        const lines = scope.flatMap((c) => [...c.compromises, ...c.unmet].map((p) => `${c.name}：${p.text}`));
        return {
          reply: `${PREFIX}${lines.length ? lines.join("\n") : "按现有资料，没有列出需要取舍的地方；资料没覆盖的项目不代表没有问题。"}`,
          citations: scope.flatMap((c) => [...c.compromises, ...c.unmet].flatMap((p) => p.evidence.map((e) => ({ title: e.title, ...(e.quote ? { quote: e.quote } : {}) })))).slice(0, 4),
        };
      }

      // 场景
      if (/怎么用|传文件|投屏|多屏|体验|场景/.test(q)) {
        const exp = sections.find((s) => s.kind === "experience");
        const list = exp?.kind === "experience" && exp.scenes.length ? exp.scenes.map((s) => `${s.title}：${s.reason}`).join("\n") : "方案里没有安排场景，可以在页面的体验空间里看通用演示。";
        return { reply: `${PREFIX}${list}\n这些都是虚拟流程演示，不代表在你的设备上测试通过。`, citations: [] };
      }

      return { reply: `${PREFIX}当前方案的资料里没有找到能直接回答这个问题的依据。可以换个问法，或到店请导购用真机演示。`, citations: [] };
    },
  };
}
