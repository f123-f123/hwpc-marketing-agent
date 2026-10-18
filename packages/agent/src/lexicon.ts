/** 词表与映射：渠道、场景、人群、话题、事实类别。规则型抽取的唯一来源，便于测试与调整。 */
import type { FactCategory, Platform, Scenario } from "@hwpc/contracts";
import type { DeliveryFormat } from "./types.js";

export const PLATFORM_LABEL: Record<Platform, string> = {
  wechat_article: "公众号",
  xiaohongshu: "小红书",
  store_moments: "门店朋友圈",
  store_poster: "门店海报",
};
export const PLATFORM_PATTERNS: { id: Platform; re: RegExp }[] = [
  { id: "store_poster", re: /海报|易拉宝|展架|物料/ },
  { id: "store_moments", re: /朋友圈/ },
  { id: "xiaohongshu", re: /小红书|红书|种草笔记/ },
  { id: "wechat_article", re: /公众号|微信文章|推文/ },
];

export const SCENARIO_LABEL: Record<Scenario, string> = {
  back_to_school: "开学季",
  business_office: "职场办公",
  content_creation: "内容创作",
  family_upgrade: "家庭换新",
  enterprise_procurement: "企业采购",
  store_visit: "门店到访",
  new_launch: "新品首发",
  holiday: "节日营销",
  other: "其他",
};
export const SCENARIO_PATTERNS: { id: Scenario; re: RegExp }[] = [
  { id: "back_to_school", re: /开学|返校|校园|宿舍|上课|学期/g },
  { id: "business_office", re: /出差|商务|办公|会议|职场|差旅|移动办公|通勤/g },
  { id: "content_creation", re: /创作|设计师|剪辑|摄影|绘图|渲染|视频制作|修图/g },
  { id: "family_upgrade", re: /家庭|换新|全家|旧机|老人/g },
  { id: "enterprise_procurement", re: /采购|中小企业|企业采购|团队部署|批量/g },
  { id: "store_visit", re: /到店|进店|到访|附近|线下体验/g },
  { id: "new_launch", re: /新品|首发|新款发布/g },
  { id: "holiday", re: /节日|送礼|春节|中秋|国庆|圣诞|情人节|母亲节|父亲节|618|双十一|双11/g },
];

/** 人群 → 可推断的场景（仅作系统推断，status=tentative）。 */
export const AUDIENCE_PATTERNS: { value: string; re: RegExp; impliesScenario?: Scenario }[] = [
  { value: "大学新生", re: /大学新生|新生|大一|准大学生/, impliesScenario: "back_to_school" },
  { value: "学生家长", re: /家长|父母/, impliesScenario: "back_to_school" },
  { value: "大学生", re: /大学生|学生党/, impliesScenario: "back_to_school" },
  { value: "学生", re: /学生/, impliesScenario: "back_to_school" },
  { value: "职场新人", re: /职场新人|应届生/, impliesScenario: "business_office" },
  { value: "职场人士", re: /职场|白领|上班族|商务人士|出差人士|商旅|移动办公者/, impliesScenario: "business_office" },
  { value: "内容创作者", re: /设计师|摄影师|剪辑师|创作者|视频博主|UP主/, impliesScenario: "content_creation" },
  { value: "家庭用户", re: /家庭用户|一家人|全家用/, impliesScenario: "family_upgrade" },
  { value: "中小企业采购者", re: /中小企业|企业采购|采购负责人|IT负责人/, impliesScenario: "enterprise_procurement" },
  { value: "到店潜在顾客", re: /附近.*顾客|到店顾客|潜在顾客|路过/, impliesScenario: "store_visit" },
];

export const SCENARIO_DEFAULTS: Record<Scenario, { problem: string; goal: string }> = {
  back_to_school: { problem: "选机时需兼顾学习、携带与续航", goal: "帮助目标读者判断是否适合作为开学设备并促成咨询" },
  business_office: { problem: "出差与日常办公对携带、续航和多任务协同的要求", goal: "帮助目标读者判断是否适合移动办公并促成咨询" },
  content_creation: { problem: "创作流程对屏幕、性能与素材流转的要求", goal: "帮助目标读者判断是否适合创作并促成咨询" },
  family_upgrade: { problem: "全家使用的易用性与长期使用", goal: "帮助目标读者完成家庭换新的选择并促成咨询" },
  enterprise_procurement: { problem: "采购对部署、管理与稳定性的要求", goal: "帮助采购者了解产品信息并促成咨询" },
  store_visit: { problem: "用一个明确理由让顾客愿意进店体验", goal: "引导到店体验与咨询" },
  new_launch: { problem: "了解新品变化与适合人群", goal: "提升新品认知并引导咨询" },
  holiday: { problem: "节日送礼或家庭购机的选择", goal: "提供选择建议并促成咨询" },
  other: { problem: "按用户描述的场景确定", goal: "提升产品认知并促成咨询" },
};

/** 话题词表：用于“强调/避免”冲突检测与内容选择。 */
export const TOPICS: { id: string; label: string; re: RegExp; categories: FactCategory[] }[] = [
  { id: "price", label: "价格/优惠", re: /价格|售价|多少钱|优惠|补贴|促销|折扣|特价|便宜|立减|赠品|满减|低价/, categories: ["price"] },
  { id: "battery", label: "续航", re: /续航|电池|待机|耐用/, categories: ["battery"] },
  { id: "portability", label: "轻薄便携", re: /轻薄|便携|重量|轻便|携带|轻巧/, categories: ["portability"] },
  { id: "performance", label: "性能", re: /性能|流畅|处理器|芯片|跑分|CPU/i, categories: ["processor", "memory_storage"] },
  { id: "display", label: "屏幕", re: /屏幕|显示|护眼|色彩|分辨率/, categories: ["display"] },
  { id: "ports", label: "接口", re: /接口|扩展|Type-C|HDMI|USB/i, categories: ["ports"] },
  { id: "ecosystem", label: "多设备协同", re: /协同|多屏|互联|生态|跨设备/, categories: ["ecosystem", "os"] },
  { id: "audio_camera", label: "音频与摄像头", re: /音质|扬声器|麦克风|摄像头|视频会议/, categories: ["audio_camera"] },
];
export const topicsIn = (text: string): string[] => TOPICS.filter((t) => t.re.test(text)).map((t) => t.id);
export const topicLabel = (id: string) => TOPICS.find((t) => t.id === id)?.label ?? id;

/** 各场景下事实类别的优先级（靠前优先）。换场景则切入点与卖点顺序随之变化。 */
export const SCENARIO_CATEGORY_PRIORITY: Record<Scenario, FactCategory[]> = {
  back_to_school: ["portability", "battery", "ecosystem", "display", "memory_storage", "ports", "processor", "selling_point"],
  business_office: ["portability", "battery", "ecosystem", "ports", "audio_camera", "memory_storage", "processor", "selling_point"],
  content_creation: ["display", "processor", "memory_storage", "ecosystem", "ports", "battery", "selling_point"],
  family_upgrade: ["os", "ecosystem", "display", "battery", "portability", "selling_point"],
  enterprise_procurement: ["os", "ecosystem", "ports", "memory_storage", "battery", "selling_point"],
  store_visit: ["selling_point", "display", "portability", "battery"],
  new_launch: ["selling_point", "processor", "display", "battery", "portability"],
  holiday: ["selling_point", "display", "portability", "ecosystem", "battery"],
  other: ["selling_point", "portability", "battery", "display", "ecosystem"],
};
export const SCENARIO_ANGLE: Record<Scenario, string> = {
  back_to_school: "以一天的校园行程为线索，先讲携带，再讲续航与协同",
  business_office: "以出差与会议的一天为线索，先讲便携与续航，再讲协同与接口",
  content_creation: "以创作流程为线索，先讲屏幕，再讲性能与素材流转",
  family_upgrade: "以全家共用与长期使用为线索，先讲易用与协同",
  enterprise_procurement: "以部署与管理的关注点为线索，只写资料中出现的信息",
  store_visit: "只突出一个到店可体验的理由，其余留给门店咨询",
  new_launch: "以新品相对前代的变化与适合人群为线索",
  holiday: "以送礼或家庭购机的选择建议为线索，不写资料外的优惠",
  other: "按用户描述的场景组织卖点",
};

export const FORMAT_LABEL: Record<DeliveryFormat, string> = {
  platform_article: "平台图文",
  interactive_html: "互动 HTML（附带平台图文）",
  combo: "平台图文 + 互动 HTML",
};

/** 产品类别词（用户未指定型号时的范围表达）。 */
export const CATEGORY_RE = /轻薄本|游戏本|二合一|笔记本电脑|笔记本|办公本|平板电脑|电脑/;

/** 品牌/型号线索：用于从自由文本里切出疑似型号串，再交给 DataService 搜索。 */
export const MODEL_MENTION_RE = /(?:HUAWEI\s*)?(?:MateBook|MateStation|MatePad|擎云|示例本)(?:\s*[A-Za-z0-9]+)*/gi;

export const CHANGE_CUE_RE = /改成|改为|换成|换到|改到|变成|还是(?:要|用|写|做|面向|给)|不对|更正|其实(?:是|想|要|应该)|算了|调整为|修改为|替换为|不是.{0,10}而是|应该是/;
export const DELEGATE_CUE_RE = /你(?:来)?(?:定|决定|看着办|安排|推荐|选)|都可以|都行|随便|无所谓|按你的建议|你看着来|没有特别/;
export const NO_ACTIVITY_RE = /不涉及活动|没有活动|无活动|不做活动|没有促销活动|不搞活动/;
export const NO_EXTRA_RE = /没有(?:其他|额外|别的)?(?:的)?(?:限制|要求)|无(?:其他|额外)?(?:限制|要求)|没别的(?:要求|了)/;
export const CONFIRM_TEXT_RE = /^[\s，。!！]*(确认|同意|没问题|可以了?|ok|OK|好的?|就这样|开始生成|生成吧|confirmed?)[\s，。!！]*$/i;

/** 产品事实提问：类别 → 问法。 */
export const FACT_QUESTION_TOPICS: { category: FactCategory; label: string; re: RegExp }[] = [
  { category: "portability", label: "重量/便携", re: /多重|重量|几斤|多沉|轻不轻|厚度|多厚/ },
  { category: "battery", label: "续航", re: /续航|电池|能用多久|待机|多久/ },
  { category: "display", label: "屏幕", re: /屏幕|多大|尺寸|分辨率|刷新率/ },
  { category: "memory_storage", label: "内存/存储", re: /内存|存储|硬盘|容量|SSD/i },
  { category: "processor", label: "处理器", re: /处理器|CPU|芯片/i },
  { category: "ports", label: "接口", re: /接口|Type-C|HDMI|USB/i },
  { category: "price", label: "价格", re: /价格|多少钱|售价|优惠|补贴|便宜/ },
  { category: "ecosystem", label: "协同", re: /协同|多屏|互联/ },
];
export const QUESTION_MARK_RE = /[?？]|吗|多少|多重|多久|几个|几斤|怎么样|有没有|是不是|支持|能不能|会不会/;

/** 合规词表（核验使用）。 */
export const ABSOLUTE_RE = /最(?:好|强|佳|轻|薄|快|大|高|低|便宜|值得|适合)|第一|唯一|绝对|100%|百分百|顶级|史上|碾压|完美|无敌|遥遥领先|无与伦比|秒杀|全网|万能|永不|零(?:卡顿|风险)/;
export const FAKE_EXPERIENCE_RE = /我(?:亲测|用了|自己用|体验了|入手了)|亲测|亲身体验|用了(?:一|两|三|\d+)[个周天月年]|实测(?:结果|发现|表明)?|博主实测|好评如潮|用户(?:都说|评价|反馈)|销量(?:第一|领先|过万)|热销|爆款|获奖|荣获/;
export const PRICE_TOKEN_RE = /[¥￥]\s*\d|\d[\d,.]*\s*(?:元|块钱?)|价格|售价|优惠|补贴|立减|折扣|特价|促销|赠品|满减|低价|限时|抢购|秒杀|分期|免息/;
export const COMPETITOR_RE = /苹果|MacBook|iPad|小米|联想|ThinkPad|戴尔|Dell|惠普|HP\b|华硕|ASUS|荣耀|三星|微软Surface|Surface/i;
export const PROMISE_RE = /保证|承诺|一定(?:能|会)|必定|百分之百|终身|无条件|不满意(?:就)?退/;

/* ------------------------------ 选购（shopper）词表 ------------------------------ */

/** 实际任务 → 场景标签与相关事实类别。标签用于选场景，类别用于展示“相关资料”，二者都不构成满足结论。 */
export const TASK_PATTERNS: { id: string; label: string; re: RegExp; tags: string[]; categories: FactCategory[] }[] = [
  { id: "document", label: "写论文/文档处理", re: /论文|文档|写作|Word|写报告|做笔记|记笔记/i, tags: ["document", "study"], categories: ["portability", "battery", "display"] },
  { id: "presentation", label: "做 PPT/汇报", re: /PPT|汇报|演示文稿|路演|投屏讲/i, tags: ["presentation", "multi_device"], categories: ["ports", "ecosystem", "display"] },
  { id: "video_edit", label: "视频剪辑", re: /剪辑|剪视频|视频制作|做视频|Premiere|PR\b|剪映|达芬奇/i, tags: ["video_edit", "creation"], categories: ["processor", "memory_storage", "display"] },
  { id: "coding", label: "编程开发", re: /编程|写代码|开发|程序员|Python|Java|VS ?Code|Visual Studio/i, tags: ["coding"], categories: ["processor", "memory_storage", "os"] },
  { id: "gaming", label: "玩游戏", re: /游戏|打游戏|吃鸡|原神|电竞/, tags: ["gaming"], categories: ["processor", "display"] },
  { id: "video_meeting", label: "视频会议", re: /视频会议|开会|网课|上网课|腾讯会议|Zoom|线上会议/i, tags: ["video_meeting"], categories: ["audio_camera", "battery"] },
  { id: "design", label: "设计/绘图/修图", re: /设计|绘图|画图|修图|Photoshop|PS\b|CAD|建模|渲染/i, tags: ["design", "creation"], categories: ["display", "processor", "memory_storage"] },
  { id: "travel_office", label: "出差/移动办公", re: /出差|差旅|移动办公|高铁上|飞机上|通勤/, tags: ["travel_office", "portability"], categories: ["portability", "battery"] },
  { id: "multi_device", label: "多设备协同", re: /手机.{0,6}(?:电脑|笔记本)|多设备|协同|传文件|文件互传|跨设备|和手机/, tags: ["multi_device"], categories: ["ecosystem"] },
  { id: "entertainment", label: "追剧/日常娱乐", re: /追剧|看剧|看电影|刷视频|日常娱乐/, tags: ["entertainment"], categories: ["display", "audio_camera"] },
  { id: "study", label: "上课/学习", re: /上课|学习|考研|刷题|学生用|学校/, tags: ["study", "portability"], categories: ["portability", "battery"] },
  { id: "data", label: "数据处理/表格", re: /Excel|表格|报表|数据分析|财务/i, tags: ["data", "document"], categories: ["processor", "memory_storage", "display"] },
];

/** 技术点：用户疑问里出现这些词，优先找能解答它的场景。capabilityKeywords 用于在资料里核对设备是否有明确说明。 */
export const TECH_TERMS: { id: string; label: string; re: RegExp; capabilityKeywords: string[]; tags: string[] }[] = [
  { id: "multi_screen", label: "多屏协同", re: /多屏协同|多屏|屏幕共享|跨屏/, capabilityKeywords: ["多屏协同"], tags: ["multi_device"] },
  { id: "screen_mirroring", label: "投屏", re: /投屏|无线投屏|镜像/, capabilityKeywords: ["投屏", "无线投屏"], tags: ["presentation", "multi_device"] },
  { id: "file_transfer", label: "文件互传/碰一碰", re: /碰一碰|NFC|文件互传|传文件|隔空传送/i, capabilityKeywords: ["碰一碰", "NFC", "文件互传"], tags: ["multi_device"] },
  { id: "kbm_share", label: "键鼠共享", re: /键鼠共享|共享键鼠|一套键鼠/, capabilityKeywords: ["键鼠共享"], tags: ["multi_device"] },
  { id: "super_device", label: "超级终端/分布式", re: /超级终端|分布式|设备流转|接力/, capabilityKeywords: ["超级终端", "分布式", "接力"], tags: ["multi_device"] },
  { id: "stylus", label: "手写笔", re: /手写笔|触控笔|M-Pencil|笔记/, capabilityKeywords: ["手写笔", "触控笔", "M-Pencil"], tags: ["design", "study"] },
];
export const TECH_QUESTION_CUE = /是什么|怎么|如何|能不能|可不可以|会不会|不太懂|不明白|不理解|没用过|想了解|想看看|怎样|有什么用|什么意思|怎么用/;

export const SOFTWARE_NAMES = ["Photoshop", "PS", "Premiere", "PR", "AutoCAD", "CAD", "SolidWorks", "MATLAB", "Office", "WPS", "Python", "Visual Studio", "VS Code", "剪映", "达芬奇", "Excel", "Word", "PowerPoint", "Blender", "Unity", "IDEA", "PyCharm", "Xcode", "微信", "腾讯会议", "钉钉"];
export const SOFTWARE_RE = new RegExp(`(?:必须|一定|得|要|需要|离不开|常用|会用|用到)[^，。；]{0,6}(${SOFTWARE_NAMES.join("|")})`, "gi");

export const ENV_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "宿舍", re: /宿舍/ }, { label: "图书馆", re: /图书馆/ }, { label: "教室", re: /教室|课堂/ },
  { label: "咖啡厅", re: /咖啡厅|咖啡馆/ }, { label: "高铁/飞机上", re: /高铁|飞机|火车|路上/ },
  { label: "办公室", re: /办公室|公司/ }, { label: "家里", re: /家里|在家|客厅|书房/ }, { label: "户外", re: /户外|出差/ },
];
export const FREQUENCY_RE = /(每天|天天|每周\s*\d+\s*(?:次|天)|每周|每月|偶尔|经常|很少|一周\s*\d+\s*次|几乎每天|平时)(?:[^，。；]{0,8})/;
export const DEVICE_WORDS = /手机|平板|显示器|打印机|耳机|手表|iPhone|安卓|华为手机|Mate\s*\d+|Pura\s*\d+|MatePad|鼠标|键盘|台式机|旧电脑|旧笔记本/i;
export const EXISTING_CUE = /我(?:有|用|现在用|手上有)|已有|手上有|家里有|现在用的是|还在用|用着/;
export const HARD_CUE = /必须|一定要|一定得|硬性|至少|不低于|不超过|不能超过|不要超过|最多|最少|以内|以上|起码|得有|必须有|需要有/;
export const UNACCEPTABLE_CUE = /不能接受|接受不了|受不了|绝对不要|绝不|不能有|不可以有|无法接受|太重|太厚|风扇.{0,3}(?:响|吵|噪)|噪音|发热严重|烫手/;
export const PREFERENCE_CUE = /最好|希望|更喜欢|偏好|优先|更在意|比较在意|倾向|想要|更想|最看重|看重/;
export const CONCERN_CUE = /担心|怕|顾虑|害怕|不放心|纠结|会不会|万一|不确定/;
export const MARKETING_OUTPUT_RE = /(?:写|生成|做|出|来|要|需要|想要|帮我|给我).{0,8}(?:软文|文案|推文|种草笔记|图文|海报|营销)|(?:软文|营销文案|种草文)/;
export const REPORT_OUTPUT_RE = /选购报告|对比报告|给我.{0,4}报告|整理成报告|导出.{0,4}方案/;

/** 数值硬条件解析：metric → 中文词 + 单位。 */
export const METRIC_DEFS: { metric: "weight_kg" | "battery_h" | "display_in" | "memory_gb" | "storage_gb"; label: string; word: RegExp; unit: RegExp; cats: FactCategory[]; fieldRe: RegExp; unitLabel: string }[] = [
  { metric: "weight_kg", label: "重量", word: /重量|多重|机身重|轻|重/, unit: /(\d+(?:\.\d+)?)\s*(kg|公斤|斤|g|克)/i, cats: ["portability"], fieldRe: /重量/, unitLabel: "kg" },
  { metric: "battery_h", label: "续航", word: /续航|电池|能用|待机|用.{0,2}小时/, unit: /(\d+(?:\.\d+)?)\s*(小时|h|H)/, cats: ["battery"], fieldRe: /续航|电池|视频播放|办公/, unitLabel: "小时" },
  { metric: "display_in", label: "屏幕尺寸", word: /屏幕|尺寸|大小|英寸|寸/, unit: /(\d+(?:\.\d+)?)\s*(英寸|寸)/, cats: ["display"], fieldRe: /屏幕尺寸|尺寸|屏幕/, unitLabel: "英寸" },
  { metric: "memory_gb", label: "内存", word: /内存|运行内存/, unit: /(\d+(?:\.\d+)?)\s*(GB|G|gb|g)\b/i, cats: ["memory_storage"], fieldRe: /内存|RAM/i, unitLabel: "GB" },
  { metric: "storage_gb", label: "存储", word: /存储|硬盘|固态|SSD|容量/i, unit: /(\d+(?:\.\d+)?)\s*(TB|GB|T|G|tb|gb)\b/i, cats: ["memory_storage"], fieldRe: /存储|硬盘|SSD|固态|容量/i, unitLabel: "GB" },
];

/** 场景选择用：用户需求关键词 → 场景标签。 */
export const CONCERN_TAGS: { re: RegExp; tags: string[] }[] = [
  { re: /连接|配对|协同|同步|传输|投屏/, tags: ["multi_device"] },
  { re: /复杂|不会用|上手|学习成本/, tags: ["onboarding"] },
  { re: /会议|摄像头|麦克风|声音/, tags: ["video_meeting"] },
];
