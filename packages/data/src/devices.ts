import type { DataService, DeviceCapability, DeviceKnowledgeService, DeviceRelation, EvidenceRef, FactRecord, ProductIdentity } from "@hwpc/contracts";
import { stableId } from "./local.js";

const rules = [
  { feature: "multi_screen", label: "多屏协同", match: /多屏协同/, positive: /(?:支持|可使用|可实现)多屏协同|多屏协同(?:功能|能力)?(?:可用|支持)/, negative: /(?:不支持|无法使用)多屏协同/ },
  { feature: "file_transfer", label: "跨设备文件传输", match: /文件互传|跨设备传输|一碰传/, positive: /(?:支持|可使用|可实现)(?:文件互传|跨设备传输|一碰传)/, negative: /(?:不支持|无法使用)(?:文件互传|跨设备传输|一碰传)/ },
  { feature: "nearlink", label: "星闪", match: /星闪|NearLink/, positive: /(?:支持|可使用|可实现)(?:星闪|NearLink)/i, negative: /(?:不支持|无法使用)(?:星闪|NearLink)/i },
  { feature: "super_device", label: "超级终端", match: /超级终端/, positive: /(?:支持|可使用|可实现)超级终端|超级终端功能/, negative: /(?:不支持|无法使用)超级终端/ },
] as const;

const evidenceFor = (f: FactRecord): EvidenceRef => ({ factId: f.factId, source: f.source, excerpt: f.value.slice(0, 500) });

export function createKnowledgeService(data: DataService): DeviceKnowledgeService {
  return {
    async getKnowledge(refs, signal) {
      const products: ProductIdentity[] = [];
      const capabilities: DeviceCapability[] = [];
      for (const ref of refs) {
        let pack;
        try { pack = await data.getMaterialPack({ taskId: stableId("knowledge", ref.productId), product: ref, maxImages: 0, signal }); }
        catch { continue; }
        const product = pack.products.find(p => p.productId === ref.productId) ?? pack.products[0];
        if (!product) continue;
        products.push(product);
        for (const rule of rules) {
          const relevant = pack.facts.filter(f => f.productId === product.productId && rule.match.test(f.value));
          const yes = relevant.filter(f => !rule.negative.test(f.value) && rule.positive.test(f.value));
          const no = relevant.filter(f => rule.negative.test(f.value));
          const conflict = yes.length > 0 && no.length > 0;
          const scopedYes = ref.configurationId ? yes.filter(f => f.configurationIds.includes(ref.configurationId!)) : yes;
          const scopedNo = ref.configurationId ? no.filter(f => f.configurationIds.includes(ref.configurationId!)) : no;
          const support = conflict ? "unknown" : scopedYes.length ? "supported" : scopedNo.length ? "unsupported" : "unknown";
          const matched = support === "supported" ? scopedYes : support === "unsupported" ? scopedNo : relevant;
          capabilities.push({
            capabilityId: stableId("cap", `${product.productId}:${rule.feature}`), product: ref,
            configurationIds: ref.configurationId && support !== "unknown" ? [ref.configurationId] : [], feature: rule.feature, label: rule.label, support,
            conditions: [], evidence: matched.map(evidenceFor),
            note: conflict ? "资料有相反表述，需人工核验" : support === "unknown" ? "未找到该型号与配置的明确支持证据" : "设备组合、系统/软件版本与账号条件仍需单独核验",
          });
        }
      }
      const relations: DeviceRelation[] = [];
      const pc = products.filter(p => p.category === "pc");
      const phone = products.filter(p => p.category === "phone");
      const display = products.filter(p => p.category === "display");
      if (pc.length && phone.length) relations.push({ relationId: stableId("relation", "file_transfer:" + products.map(p => p.productId).join(",")), feature: "file_transfer", label: "手机与电脑文件互传",
        participants: [{ roleId: "computer", category: "pc", productIds: pc.map(p => p.productId) }, { roleId: "phone", category: "phone", productIds: phone.map(p => p.productId) }],
        support: "unknown", conditions: [], evidence: [] });
      if (pc.length && display.length) relations.push({ relationId: stableId("relation", "multi_screen:" + products.map(p => p.productId).join(",")), feature: "multi_screen", label: "电脑与显示设备多屏协同",
        participants: [{ roleId: "computer", category: "pc", productIds: pc.map(p => p.productId) }, { roleId: "display", category: "display", productIds: display.map(p => p.productId) }],
        support: "unknown", conditions: [], evidence: [] });
      return { takenAt: new Date().toISOString(), products, capabilities, relations, isMock: products.some(p => p.origin === "mock") };
    },
  };
}
