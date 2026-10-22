/**
 * 型号画像：把知识库里的产品事实、官方公开价格、型号检索卡整理成可比较的字段。
 *
 * 每个字段都挂着原始事实（FactRecord / PriceRecord），评价时直接作为证据引用；
 * 只有 reviewStatus=verified 的事实参与“满足”判断，待核事实只能进入“待核实”。
 */
import type { EvidenceRef, FactRecord, PriceRecord, ProductBrief, ProductIdentity } from "@hwpc/contracts";

export interface Figure {
  value: number;
  facts: FactRecord[];
}

export interface PriceView {
  /** 最低公开金额（元）。 */
  from: number;
  record: PriceRecord;
  /** 金额来自官网参考起价、预估到手价等非当前商城页面价时的说明。 */
  note?: string;
  /** 当前商城已下架 / 无公开商城价。 */
  offShelf: boolean;
}

export interface ProductProfile {
  product: ProductIdentity;
  os: Set<"harmony" | "windows" | "linux">;
  osFacts: FactRecord[];
  weightKg?: { min: number; max: number; facts: FactRecord[] };
  screenIn?: Figure;
  foldable?: FactRecord;
  batteryWh?: Figure;
  portsText: string;
  portFacts: FactRecord[];
  hdmi?: FactRecord;
  usbA?: FactRecord;
  usbC: number;
  touch?: FactRecord;
  pen?: FactRecord;
  oled?: FactRecord;
  wideGamut?: FactRecord;
  highRefresh?: FactRecord;
  privacy?: FactRecord;
  gpu?: FactRecord;
  cpu: FactRecord[];
  ramMaxGb?: Figure;
  collab?: FactRecord;
  nearlink?: FactRecord;
  price?: PriceView;
  prices: PriceRecord[];
  brief?: ProductBrief;
  /** 参与判断的已核事实总数（资料越全越可信）。 */
  verifiedCount: number;
}

const ok = (f: FactRecord) => f.reviewStatus === "verified";
const last = (field: string) => field.split("·").at(-1) ?? field;

export const factEvidence = (f: FactRecord): EvidenceRef => ({
  factId: f.factId,
  source: f.source,
  excerpt: `${f.field}：${f.value}`.slice(0, 500),
});

export const priceEvidence = (p: PriceView | { record: PriceRecord }): EvidenceRef => ({
  source: p.record.source,
  excerpt: `${p.record.priceType} ${p.record.amount ?? "未公开"} 元（${p.record.variant || p.record.productName}；核验时间 ${p.record.checkedAt.slice(0, 10)}）`.slice(0, 500),
});

export const briefEvidence = (b: ProductBrief, line: string): EvidenceRef => ({ source: b.source, excerpt: line.slice(0, 500) });

/** “约 1.33 kg”“970 g”“798 g” → 千克。 */
export function kgOf(value: string): number[] {
  const out: number[] = [];
  for (const m of value.matchAll(/(\d+(?:\.\d+)?)\s*(kg|g)\b/gi)) {
    const n = Number(m[1]);
    out.push(m[2]!.toLowerCase() === "kg" ? n : n / 1000);
  }
  return out.filter((n) => n > 0.3 && n < 5);
}

const num = (re: RegExp, v: string) => {
  const m = v.match(re);
  return m ? Number(m[1]) : undefined;
};

export function pickPrice(records: PriceRecord[]): PriceView | undefined {
  const offShelf = records.some((r) => /下架|无当前公开商城价/.test(`${r.priceType}${r.stock}`));
  const withAmount = records.filter((r) => r.amount && !/缺货/.test(r.priceType));
  const store = withAmount.filter((r) => /商城/.test(r.priceType) && !/预估|到手|搭配/.test(r.priceType));
  const pool = store.length ? store : withAmount.filter((r) => !/预估|到手|搭配/.test(r.priceType));
  if (!pool.length) return undefined;
  const record = pool.reduce((a, b) => (b.amount! < a.amount! ? b : a));
  const note = /商城/.test(record.priceType) ? undefined : `${record.priceType}，不是当前商城成交价`;
  return { from: record.amount!, record, ...(note ? { note } : {}), offShelf };
}

export function buildProfile(product: ProductIdentity, facts: FactRecord[], prices: PriceRecord[], brief?: ProductBrief): ProductProfile {
  const mine = facts.filter((f) => f.productId === product.productId);
  const verified = mine.filter(ok);
  const by = (re: RegExp, list = verified) => list.filter((f) => re.test(f.field));
  const find = (fieldRe: RegExp, valueRe: RegExp, list = verified) => list.find((f) => fieldRe.test(f.field) && valueRe.test(f.value));

  const osFacts = by(/^操作系统/);
  const os = new Set<"harmony" | "windows" | "linux">();
  for (const f of osFacts) {
    if (/HarmonyOS|鸿蒙/i.test(f.value)) os.add("harmony");
    if (/Windows/i.test(f.value)) os.add("windows");
    if (/Linux/i.test(f.value)) os.add("linux");
  }

  const weightFacts = verified.filter((f) => last(f.field) === "重量" && kgOf(f.value).length);
  const kgs = weightFacts.flatMap((f) => kgOf(f.value));

  const sizeFacts = verified.filter((f) => /屏幕/.test(f.field) && last(f.field) === "尺寸");
  const sizes = sizeFacts.map((f) => num(/(\d+(?:\.\d+)?)\s*英寸/, f.value)).filter((n): n is number => Boolean(n));
  const batteryFacts = verified.filter((f) => /电池/.test(f.field) && /Wh/i.test(f.value));
  const whs = batteryFacts.flatMap((f) => [...f.value.matchAll(/(\d+(?:\.\d+)?)\s*Wh/gi)].map((m) => Number(m[1])));
  const portFacts = by(/^接口/);
  const portsText = portFacts.map((f) => f.value).join("；");
  const usbC = portFacts.reduce((s, f) => s + [...f.value.matchAll(/(?:USB[\s-]*C|Type-C)[^×；]*×\s*(\d)/gi)].reduce((a, m) => a + Number(m[1]), 0), 0);
  const ramFacts = by(/^内存/);
  const rams = ramFacts.flatMap((f) => [...f.value.matchAll(/(\d+)\s*GB/gi)].map((m) => Number(m[1])));

  return {
    product,
    os,
    osFacts,
    ...(kgs.length ? { weightKg: { min: Math.min(...kgs), max: Math.max(...kgs), facts: weightFacts } } : {}),
    ...(sizes.length ? { screenIn: { value: Math.max(...sizes), facts: sizeFacts } } : {}),
    ...(sizeFacts.some((f) => /展开态|折叠态/.test(f.value)) ? { foldable: sizeFacts.find((f) => /展开态/.test(f.value)) ?? sizeFacts[0] } : {}),
    ...(whs.length ? { batteryWh: { value: Math.max(...whs), facts: batteryFacts } } : {}),
    portsText,
    portFacts,
    hdmi: portFacts.find((f) => /HDMI/i.test(f.value)),
    usbA: portFacts.find((f) => /USB\s*-?\s*A\b/i.test(f.value)),
    usbC,
    touch: find(/触摸屏|触控屏/, /触控|触摸/),
    pen: verified.find((f) => /M-?Pen|手写笔/i.test(f.value) && !/仅/.test(f.value)),
    oled: find(/屏幕/, /OLED/i),
    wideGamut: find(/屏幕·色域/, /P3|100%\s*sRGB/i),
    highRefresh: find(/屏幕·刷新率/, /120\s*Hz/i),
    privacy: verified.find((f) => /防窥|隐私开关/.test(f.value)),
    gpu: by(/^显卡/)[0],
    cpu: by(/^处理器/),
    ...(rams.length ? { ramMaxGb: { value: Math.max(...rams), facts: ramFacts } } : {}),
    collab: verified.find((f) => /特色应用/.test(f.field) && /超级终端|华为分享|碰一碰|应用接续|键鼠共享/.test(f.value)),
    nearlink: find(/星闪/, /支持/),
    ...(pickPrice(prices) ? { price: pickPrice(prices)! } : {}),
    prices,
    ...(brief ? { brief } : {}),
    verifiedCount: verified.length,
  };
}

/** 画像里给人看的一句话“型号速写”。 */
export function sketch(p: ProductProfile): string {
  const parts: string[] = [];
  if (p.os.has("harmony")) parts.push("鸿蒙系统");
  else if (p.os.has("windows")) parts.push("Windows 系统");
  if (p.screenIn) parts.push(`${p.screenIn.value} 英寸`);
  if (p.weightKg) parts.push(p.weightKg.min === p.weightKg.max ? `约 ${fmtKg(p.weightKg.min)}` : `约 ${fmtKg(p.weightKg.min)}–${fmtKg(p.weightKg.max)}`);
  if (p.price) parts.push(`${p.price.record.priceType} ${p.price.from} 元起`);
  return parts.join("，");
}

export const fmtKg = (kg: number) => (kg < 1 ? `${Math.round(kg * 1000)} g` : `${Math.round(kg * 100) / 100} kg`);
