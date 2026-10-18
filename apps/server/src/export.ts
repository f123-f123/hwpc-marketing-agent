import type { ExportFormat, ResultVersion } from "@hwpc/contracts";

const PLATFORM_LABEL = { wechat_article: "公众号", xiaohongshu: "小红书", store_moments: "门店朋友圈", store_poster: "门店海报" } as const;
const MOCK_BANNER = "【MOCK 模拟数据】以下内容含模拟资料，非真实华为产品信息，不得发布。";

/** 渲染统一输出格式（赛题 §四（四））：场景判断 / 知识库依据 / 图文软文 / 核验结果。 */
export function renderExport(v: ResultVersion, format: ExportFormat): { content: string; ext: string } {
  if (format === "json") return { content: JSON.stringify(v, null, 2), ext: "json" };
  const md = format === "markdown";
  const h = (t: string) => (md ? `## ${t}` : `【${t}】`);
  const { strategy: s, article: a, materialPack: pack, verification: ver } = v;
  const facts = new Map(pack.facts.map((f) => [f.factId, f]));
  const images = new Map(pack.images.map((i) => [i.imageId, i]));
  const out: string[] = [];

  if (v.isMock) out.push(md ? `> ${MOCK_BANNER}` : MOCK_BANNER, "");

  out.push(h("一、场景判断"));
  out.push(`- 目标人群：${s.audience}`, `- 使用场景：${s.scenario}${s.scenarioNote ? `（${s.scenarioNote}）` : ""}`);
  out.push(`- 用户问题：${s.userProblems.join("；")}`, `- 内容目标：${s.contentGoal}`, `- 平台：${PLATFORM_LABEL[a.platform]}`, "");

  out.push(h("二、知识库依据"));
  const usedFacts = new Set<string>();
  for (const b of a.blocks) if (b.type === "paragraph") b.factIds.forEach((id) => usedFacts.add(id));
  const modelNames = pack.products.map((p) => p.model).join("、");
  out.push(`- 产品型号：${modelNames}`);
  for (const id of usedFacts) {
    const f = facts.get(id);
    if (!f) continue;
    const q = f.qualifiers.length ? `（${f.qualifiers.join("；")}）` : "";
    out.push(`- ${f.field}：${f.value}${q} ——《${f.source.title}》[${f.source.origin}]`);
  }
  out.push("");

  out.push(h("三、图文软文"));
  out.push(md ? `### ${a.title}` : `标题：${a.title}`);
  if (a.lead) out.push(a.lead);
  out.push("");
  for (const b of a.blocks) {
    if (b.type === "paragraph") {
      if (b.heading) out.push(md ? `#### ${b.heading}` : `${b.heading}`);
      out.push(b.text, "");
    } else {
      const im = images.get(b.imageId);
      out.push(
        `[图片] ${im?.description ?? b.imageId}｜来源：${im?.source.title ?? "未知"} [${im?.source.origin ?? "?"}]｜说明：${b.caption}｜位置理由：${b.placementReason}`,
        "",
      );
    }
  }
  out.push(`行动引导：${a.callToAction}`);
  if (a.tags.length) out.push(`标签：${a.tags.join(" ")}`);
  out.push("");

  out.push(h("四、核验结果"));
  out.push(`- 交付状态：${ver.deliveryStatus}`);
  for (const f of ver.findings) out.push(`- [${f.kind}/${f.severity}] ${f.message}（${f.resolution}${f.resolutionNote ? `：${f.resolutionNote}` : ""}）`);
  for (const p of ver.pendingConfirmations) out.push(`- 待确认：${p}`);
  return { content: out.join("\n"), ext: md ? "md" : "txt" };
}
