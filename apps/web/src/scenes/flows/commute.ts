/**
 * 【MOCK】通勤一天：带着虚拟电脑过一天（只在渲染层）。
 *
 * 服务端状态机：morning → meeting →（v2：cafe →）evening。
 *   收拾背包、出门通勤到公司 → go_meeting；会议室讲完方案后去咖啡厅 → go_cafe（仅 v2）；收工 → wrap_up。
 * 重量、耗电、充电速度都是虚拟设定，用来体会“在外时长 / 带不带充电器 / 有没有插座”对一天的影响，
 * 不代表任何型号的重量与续航。
 */

export const CM_SCENE_ID = "mock-commute-day";
export const CM_STATES_V1 = ["morning", "meeting", "evening"] as const;
export const CM_ACTIONS_V1 = ["go_meeting", "wrap_up"] as const;
export const CM_STATES_V2 = ["morning", "meeting", "cafe", "evening"] as const;
export const CM_ACTIONS_V2 = ["go_meeting", "go_cafe", "wrap_up"] as const;
export type CmState = (typeof CM_STATES_V2)[number];
export type CmAction = (typeof CM_ACTIONS_V2)[number];
export type CommuteMode = "metro" | "car";

export type CmItem = "laptop" | "charger" | "mouse";
/** 虚拟设定的物品重量（kg）。 */
export const ITEMS: { id: CmItem; label: string; kg: number }[] = [
  { id: "laptop", label: "电脑", kg: 1.3 },
  { id: "charger", label: "充电器", kg: 0.3 },
  { id: "mouse", label: "鼠标", kg: 0.1 },
];

/** 虚拟设定：每小时耗电 / 充电的百分比。 */
export const RATE = { present: 16, office: 10, charge: 30 } as const;
export const SLIDES = 4;
export const SLIDE_MIN = 15;
export const CM_START = 8 * 60 + 10;
const COMMUTE_MIN: Record<CommuteMode, number> = { metro: 40, car: 30 };
const TO_CAFE_MIN = 20;

export type Seat = "window" | "wall";

export interface Segment {
  place: "meeting" | "cafe";
  minutes: number;
  /** 这一段结束时的示意电量。 */
  battery: number;
  plugged: boolean;
}

export interface CmLocal {
  bag: CmItem[];
  /** 已出门、正在路上（动画结束后提交 go_meeting）。 */
  leaving: boolean;
  laptopOut: boolean;
  plugged: boolean;
  slide: number;
  seat: Seat | null;
  /** 咖啡厅打算待几个小时；null = 用默认值。 */
  cafeHours: number | null;
  battery: number;
  clock: number;
  log: Segment[];
}

export const cmInitial: CmLocal = { bag: [], leaving: false, laptopOut: false, plugged: false, slide: 0, seat: null, cafeHours: null, battery: 100, clock: CM_START, log: [] };

export interface CmConfig {
  mode: CommuteMode;
  hoursOutside: number;
  /** 场景版本里有没有咖啡厅（v2）。 */
  hasCafe: boolean;
}

export type CmEvent =
  | { type: "pack"; item: CmItem }
  | { type: "leave" }
  | { type: "arrive" }
  | { type: "take_out" }
  | { type: "plug" }
  | { type: "next_slide" }
  | { type: "seat"; seat: Seat }
  | { type: "hours"; hours: number }
  | { type: "go_cafe" }
  | { type: "wrap_up" };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

/** 刷新后本地记录会丢；电脑总是被带出门的，所以出门之后的背包至少有电脑。 */
export const bagOf = (server: CmState, s: CmLocal): CmItem[] => (server === "morning" || s.bag.includes("laptop") ? s.bag : ["laptop", ...s.bag]);
export const bagKg = (bag: CmItem[]) => round1(bag.reduce((a, i) => a + (ITEMS.find((x) => x.id === i)?.kg ?? 0), 0));
const hasCharger = (server: CmState, s: CmLocal) => bagOf(server, s).includes("charger");

/** 墙边座位和会议室有插座；窗边没有。 */
export const hasSocket = (server: CmState, s: CmLocal) => server === "meeting" || (server === "cafe" && s.seat === "wall");

export const maxCafeHours = (c: CmConfig) => clamp(c.hoursOutside - 1, 1, 11);
export const cafeHoursOf = (s: CmLocal, c: CmConfig) => clamp(s.cafeHours ?? maxCafeHours(c), 1, maxCafeHours(c));

/** 以某个速率工作 minutes 分钟后的电量；插着电时按充电计算。 */
export const drain = (battery: number, minutes: number, rate: number, plugged: boolean) =>
  clamp(battery + ((plugged ? RATE.charge : -rate) * minutes) / 60, 0, 100);

/** 电量从当前值耗尽需要多少小时（插电时为 null）。 */
export const hoursLeft = (battery: number, rate: number, plugged: boolean) => (plugged ? null : battery / rate);

export function cmReduce(server: CmState, s: CmLocal, e: CmEvent, c: CmConfig): { local: CmLocal; action?: CmAction } {
  switch (e.type) {
    case "pack":
      if (server !== "morning" || s.leaving) return { local: s };
      return { local: { ...s, bag: s.bag.includes(e.item) ? s.bag.filter((i) => i !== e.item) : [...s.bag, e.item] } };
    case "leave":
      return server === "morning" && s.bag.includes("laptop") && !s.leaving ? { local: { ...s, leaving: true } } : { local: s };
    case "arrive":
      return server === "morning" && s.leaving ? { local: { ...s, leaving: false, clock: s.clock + COMMUTE_MIN[c.mode] }, action: "go_meeting" } : { local: s };
    case "take_out":
      if (server === "meeting" || (server === "cafe" && s.seat)) return { local: { ...s, laptopOut: true } };
      return { local: s };
    case "plug":
      if (!s.laptopOut || !hasSocket(server, s) || !hasCharger(server, s)) return { local: s };
      return { local: { ...s, plugged: !s.plugged } };
    case "next_slide":
      if (server !== "meeting" || !s.laptopOut || s.slide >= SLIDES) return { local: s };
      return { local: { ...s, slide: s.slide + 1, clock: s.clock + SLIDE_MIN, battery: drain(s.battery, SLIDE_MIN, RATE.present, s.plugged) } };
    case "seat":
      return server === "cafe" && !s.seat ? { local: { ...s, seat: e.seat } } : { local: s };
    case "hours":
      return server === "cafe" ? { local: { ...s, cafeHours: clamp(Math.round(e.hours), 1, maxCafeHours(c)) } } : { local: s };
    case "go_cafe": {
      if (!c.hasCafe || server !== "meeting" || s.slide < SLIDES) return { local: s };
      const log = [...s.log, { place: "meeting" as const, minutes: SLIDES * SLIDE_MIN, battery: s.battery, plugged: s.plugged }];
      return { local: { ...s, log, laptopOut: false, plugged: false, clock: s.clock + TO_CAFE_MIN }, action: "go_cafe" };
    }
    case "wrap_up": {
      if (server === "meeting" && s.slide >= SLIDES) {
        const log = [...s.log, { place: "meeting" as const, minutes: SLIDES * SLIDE_MIN, battery: s.battery, plugged: s.plugged }];
        return { local: { ...s, log, laptopOut: false, plugged: false }, action: "wrap_up" };
      }
      if (server === "cafe" && s.seat && s.laptopOut) {
        const minutes = cafeHoursOf(s, c) * 60;
        const battery = drain(s.battery, minutes, RATE.office, s.plugged);
        const log = [...s.log, { place: "cafe" as const, minutes, battery, plugged: s.plugged }];
        return { local: { ...s, log, battery, clock: s.clock + minutes, laptopOut: false, plugged: false }, action: "wrap_up" };
      }
      return { local: s };
    }
  }
}

export const clockText = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export function cmSteps(c: CmConfig): string[] {
  return ["收拾背包", `${c.mode === "car" ? "开车" : "坐地铁"}去公司`, "会议室讲方案", ...(c.hasCafe ? ["咖啡厅办公"] : []), "收工回家"];
}

export interface Coach {
  step: number;
  text: string;
  detail?: string;
}

export function cmCoach(server: CmState, s: CmLocal, c: CmConfig): Coach {
  const charger = hasCharger(server, s);
  const kg = bagKg(bagOf(server, s));
  const cafeStep = 3;
  switch (server) {
    case "morning":
      if (s.leaving) return { step: 1, text: c.mode === "car" ? "开车去公司…" : "坐地铁去公司…", detail: c.mode === "car" ? "背包放在副驾，重量影响不大。" : `背着 ${kg} kg 站 ${COMMUTE_MIN.metro} 分钟——这就是“轻”和“重”的差别。` };
      if (!s.bag.includes("laptop")) return { step: 0, text: "把电脑拖进背包（也可以直接点物品）。", detail: "带不带充电器、鼠标由你决定：它们会增加背包重量，也决定了后面能不能充电。" };
      return { step: 0, text: `收拾好了就点「出门」，${c.mode === "car" ? "开车" : "坐地铁"}去公司。`, detail: `背包示意重量 ${kg} kg${charger ? "，带了充电器" : "，没带充电器：今天全靠电池"}。` };
    case "meeting":
      if (!s.laptopOut) return { step: 2, text: "到会议室了。点椅子上的背包，把电脑拿到桌上。" };
      if (s.slide < SLIDES) {
        const plugTip = s.plugged ? "已经插上电，边讲边充。" : charger ? "墙上有插座：点插座把充电器接上，就不耗电池。" : "你没带充电器，这一小时全靠电池。";
        return { step: 2, text: `点电脑上的「下一页」，讲完 ${SLIDES} 页方案（每页约 ${SLIDE_MIN} 分钟）。`, detail: `投屏演示耗电更快（虚拟设定每小时 ${RATE.present}%）。${plugTip}` };
      }
      return c.hasCafe
        ? { step: 3, text: "会开完了。点「去咖啡厅」接着干，或者直接收工。", detail: `你设定的在外时长约 ${c.hoursOutside} 小时，剩下的时间在咖啡厅。` }
        : { step: 3, text: "会开完了，点「收工回家」。" };
    case "cafe":
      if (!s.seat) return { step: cafeStep, text: "选个座位：窗边安静但没有插座，墙边有插座。", detail: charger ? "你带了充电器，墙边座位可以一直插着。" : "你没带充电器——坐哪儿都只能靠电池。" };
      if (!s.laptopOut) return { step: cafeStep, text: "点背包，把电脑拿出来。" };
      {
        const h = cafeHoursOf(s, c);
        const end = drain(s.battery, h * 60, RATE.office, s.plugged);
        const left = hoursLeft(s.battery, RATE.office, s.plugged);
        const tip = s.plugged ? "插着电，不担心电量。" : left !== null && left < h ? `按虚拟设定，大约 ${left.toFixed(1)} 小时后电量耗尽——你会在收工前没电。` : `待 ${h} 小时后示意电量约剩 ${Math.round(end)}%。`;
        return { step: cafeStep, text: `拖动滑块定下在这里待多久，再点「收工回家」。`, detail: `${tip}${!s.plugged && s.seat === "wall" && charger ? " 也可以点插座接上充电器。" : ""}` };
      }
    case "evening": {
      const n = cmSteps(c).length;
      if (!s.log.length) return { step: n, text: "一天走完了。", detail: "本地记录在刷新后已清空，下面只显示通用的回顾。" };
      return { step: n, text: `一天走完了：示意电量还剩 ${Math.round(s.battery)}%。`, detail: "这是虚拟设定下的结果，用来想清楚你需要什么样的续航和重量，不是任何型号的实测。" };
    }
  }
}

export type CmHint = "laptop" | "leave" | "bag" | "next" | "socket" | "exit" | "seat" | "hours" | null;

export function cmHint(server: CmState, s: CmLocal, c: CmConfig): CmHint {
  switch (server) {
    case "morning":
      return s.leaving ? null : s.bag.includes("laptop") ? "leave" : "laptop";
    case "meeting":
      return !s.laptopOut ? "bag" : s.slide < SLIDES ? (!s.plugged && hasCharger(server, s) && s.slide === 0 ? "socket" : "next") : "exit";
    case "cafe":
      return !s.seat ? "seat" : !s.laptopOut ? "bag" : "hours";
    case "evening":
      return null;
  }
}

/** 晚上的回顾：根据今天的安排给出“去看资料时该核对什么”。 */
export function cmReview(s: CmLocal, c: CmConfig, server: CmState): string[] {
  const out: string[] = [];
  const bag = bagOf(server, s);
  const charger = bag.includes("charger");
  const ranOut = s.log.some((x) => x.battery <= 0);
  if (ranOut) out.push("今天电量在收工前就耗尽了：看候选机型资料时，重点核对电池容量和续航标称的测试条件（亮度、负载、联网）。");
  else if (s.log.length && s.battery < 25) out.push("今天电量只剩一点：续航是你选机时要优先比较的项。");
  if (!charger && c.hoursOutside >= 6) out.push(`你在外约 ${c.hoursOutside} 小时却没带充电器：问问店员随附充电器的大小、重量，以及能否和手机共用。`);
  if (charger) out.push("带了充电器就多了一份重量：对比候选机型时，把“整机 + 充电器”的重量一起算。");
  if (c.mode === "metro") out.push("坐地铁通勤要背着走：整机重量和厚度比纸面参数更有体感，可以到店里实际拎一拎。");
  out.push("这些重量和耗电都是虚拟设定；真实续航以官方资料和第三方评测为准，并留意测试条件。");
  return out;
}
