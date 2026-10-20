# 项目交接：华为 PC 门店助手（选购顾问 + 门店推文）

> 写于 2026-10-19。新对话请先读本文件，再读根目录 `README.md` 与 `apps/server/README.md`。

## 一、背景：企业的三个困境

1. **推文成了形式主义**：公司考核线下专卖店定期在小红书、公众号、朋友圈发华为电脑推广。导购工作忙、不愿花时间，常敷衍或文笔差。**系统必须做到“傻瓜式”操作**，才能真正被业务人员使用。
2. **内容千篇一律、AI 感重**：原系统对业务理解不足，生成的推文吸引不了不同人群，几千家门店拿到同一套内容，根本没法发。
3. **新品参数有幻觉**：新品往往是首要推送任务，但大模型对新品知识不准。资料放进自建知识库和 ima 后，仍然做不到“既吸引人、数据又准、不过度承诺”（温度和知识库依赖都没设计好）。

## 二、需求（用户明确提出，持续有效）

**赛题闭环必须保留**：理解营销任务 → 制定场景与平台策略 → 检索 ima 资料和图片 → 生成图文 → 核验事实、图片和合规 → 修改与导出。
参赛输出四段：**场景判断、知识库依据、图文软文、核验结果**。公众号 / 小红书 / 朋友圈 / 海报必须真正改变结构、表达、配图和行动引导，不能只换标题或字数。

**顾问式沟通（选购侧）**
- 先发现需求缺口再交付；每轮问最影响方向的 1–3 个问题，允许选项和自由表达；动态追问，不重复问已确认内容。
- 区分关键需求（不能擅自决定）与非关键偏好（可授权默认并说明）；区分用户明说 / 系统推断 / 默认假设。
- 提问与检索配合：偏好不清问用户；参数不清查知识库；未定产品先查候选再问；资料缺失或冲突要说明缺口并暂停受影响结论；资料多时按需求筛选，不堆卖点。
- 正式交付前必须确认，且由**程序状态控制**，不能只靠提示词；关键需求修改后重新确认并更新检索、内容、核验。

**选购顾问产品定位**：突破门店展示与导购能力限制，让顾客理解产品是否适合自己，并把服务延续到离店后。
- 推荐要讲清满足 / 不满足 / 需妥协 / 未证实；个性化必须改变候选、讲解重点、场景和理由。
- **场景体验是核心**：可操作（不是动画），偏好全景场馆（家庭、书房、多设备协作），热点进入局部任务、返回保留状态、可直达任务；区分功能演示 / 原理示意 / 实机测试。
- 场景库预先制作、独立维护、按接口复用、带版本；个人 HTML 是离店后的体验载体（个性化、离店可用、可分享），但与平台发布内容是不同交付物。
- 持久化整个选购过程；“完成体验”不等于“表达偏好”。

**可信依据贯穿全部能力**：型号、配置、参数、价格、图片遵守知识库；保留来源与限制条件；不混用相近型号；不虚构价格、体验、评价、测试；核验内容被原文支持（不只查引用编号）；本地 / ima / 模拟数据分别标记。智能家居与全屋协作超出 PC 资料范围。

**用户对推文模块的决定（2026-10-19）**
1. 各门店都有自己的平台账号 → 搭好**登录与账号绑定**框架即可，用户后续自己优化。
2. 导购手机、电脑都会用；**四个平台分开呈现**（此条按此理解实现，用户未再更正）。
3. 目前没有“推广任务卡” → 需要总部端下发任务。
4. 基本功能必须真正实现；发布**最好能关联小红书**。
5. 大模型由用户自己配置 → 只搭框架，用户填 URL 和 API Key。

## 三、当前代码状态

- 仓库：`E:\Claude\黑客松_华为\code`（npm workspaces，Node ≥ 20，TypeScript，React 19 + Vite 7，Hono 服务端，vitest）。
- 分支：`refactor/overhaul`（main 之上）。已提交 `8381efd`（会话一致性修复 + 前端重写）、`cbfccb7`（推文模块，第二阶段），之后是资料解析修复。均未推送。

### 模块地图

```text
packages/contracts   zod 契约。marketing.ts = 推文模块（用户/门店/绑定/任务/稿件/发布记录/路径）
packages/data        资料层（local / ima / mock）。guides.ts 读取 P6 平台写作指南
packages/agent       选购与内容逻辑
  content/           推文引擎：angles（切入角度轮换）、facts（事实占位符、过滤）、prompt、style（套话/查重）、engine
  verify.ts          事实与合规核验（已改为接收 VerifyScope，选购与推文共用）
apps/server
  src/sessions.ts    选购顾问会话（所有写操作已串行 + 提交前 revision 比对）
  src/marketing/     推文模块：security（scrypt/HMAC/AES-GCM）、repo（JSON 文件存储）、auth、settings、service（门控）、publishers、routes
apps/web/src
  App.tsx            hash 路由：#/advisor（默认，免登录）、#/posts、#/hq、#/settings
  components/        选购顾问：Home / Workspace / ChatPanel / NeedsPanel / CandidatesPanel / ExperiencePanel / SceneTask / PlanPanel
  components/marketing/  推文：Login / StoreHome / CampaignWorkbench / PostPanel / Previews（含海报 PNG）/ AssistSheet / VerifyReport / ArticleEditor / StoreSettings / HqCampaigns / HqSettings
  scenes/            场景体验渲染层：Room3D（three.js 三维空间，按需加载）+ room/（布置、贴图、渲染器）
                     flows/（每个场景的操作流程，纯函数，有测试）+ stages/（虚拟设备舞台：FileTransfer / MultiScreen / Generic）
  styles/            tokens.css → base.css → app.css / scenes.css / marketing.css（只用设计变量；设备材质色是 --sim-*）
scenes               声明式场景库（服务端注册的状态机 publicDefinitions.ts；空间热点 space.ts）
fixtures             MOCK 数据与模拟顾问引擎
```

### 推文模块已实现
- 登录：角色 hq / store；HttpOnly Cookie 令牌；改口令使旧令牌失效。首次启动创建 `hq / hq123456`、`store001 / store123456`（`.env` 可改）。
- 总部：下发任务（型号 1–3 个、主题、人群、平台、禁止内容、截止）、门店 × 平台进度看板、门店账号管理、系统设置（写作模型 URL / 名称 / Key / 温度，公众号接口根地址，小红书发布接口地址与密钥）。
- 门店：门店资料（名称与到店引导必填，作为生成门控）、公众号 / 小红书绑定（密钥加密、不回显）、按平台生成 3 个版本 → 选稿 → 可修改并重新核验 → 发布 → 回填链接、四段式 Markdown 导出。
- 引擎：模型只写 `{{F3}}` 占位符，程序按原文填事实并带限制条件；自编数字 / 价格 / 绝对化被核验删除；按门店轮换 9 种角度；套话检测；与其他门店已选稿查重；模型未配置或失败时回退模板稿并标注。
- 发布：公众号走官方接口（stable_token → 上传图片 → draft/add → 可选 freepublish/submit，**未真实联调**）；小红书默认辅助发布（复制 / 存图 / 打开 App 或创作中心），可切换为调用用户自建发布接口（协议见 `apps/server/README.md`「小红书发布接口约定」）；朋友圈辅助发布；海报浏览器生成 1080×1440 PNG。
- 程序门控：生成前检查任务进行中、平台属于任务、门店资料齐全；发布前必须选稿且核验非 blocked；门店只能访问自己的稿件。

### 选购顾问（第一阶段，已提交）
对话工作台、需求确认门、候选取舍、全景 + 场景任务、个人方案、导出只读快照均可运行；顾问引擎仍是 `fixtures` 的**关键词规则模拟**。

**场景体验（2026-10-20 重做，用户反馈“场景太假”）**
- 空间：程序绘制的三维书房（窗、阳光投影、书桌 + 外接显示器、窗边小桌 + 手机、比较台、软木板），拖动环顾、点陈设或热点进入任务，视角保存在本地。热点 yaw/pitch 必须与 `room/build.ts` 的 `ANCHORS` 一致（有测试）。WebGL 不可用时退回按钮列表。
- 任务：在虚拟手机 / 电脑 / 显示器上亲手操作（下拉控制面板开 WLAN 和蓝牙 → 图库选照片 → 分享给附近的电脑 → 电脑上接收 → 打开核对大小；看显示器型号信息 → 投屏面板连接 → 选镜像 / 扩展 → 拖动窗口）。屏幕上有指引条和高亮环。
- **服务端状态机与契约没有改**：手势只在关键节点提交原有动作（check / connect / authorize / send …），已保存的会话、版本锁、完成记录不受影响。专属渲染器只接状态与动作完全对得上的冻结定义，场景升级后结构变化会自动退回通用渲染器。
- 界面是**通用示意**，不复刻官方菜单名称和路径（支持卡 HW-SUPPORT-31 / 41 要求“未列出的路径不猜测”）；设备不带品牌标识，照片是程序画的风景。
- 新增场景：在 `scenes/src/publicDefinitions.ts` 注册状态机 → `apps/web/src/scenes/flows/` 写流程（reduce / view / coach / hint）→ `stages/` 写舞台 → `stages/index.ts` 登记；房间里要有入口就在 `room/build.ts` 加陈设和锚点，再在 `space.ts` 加热点。

## 四、已知问题与待办（按优先级）

1. ~~资料解析 bug~~ 已在 `packages/data/src/local.ts` 的 `parseFacts` 修复（测试 `packages/data/test/parse-facts.test.ts`）：字段名表补全（CPU / 材料 / 刷新率 / 色准 / 色深 / 星闪 / NFC 等），页尾外链弹窗文字截断，版本小标题（“HUAWEI … SE 版”“标准版：”“Windows 版：”）作为“仅 X 版”限定条件，脚注作用于整组取值，尺寸标签与数值错位时整组标 pending_review。
   **知识库原文本身有错**：MateBook D 14 / D 16 / D 16 SE 版 / X 系列 的 `产品事实.md` 与 `00-全库横向索引/尺寸重量矩阵.csv` 中长、宽、厚标签错位（如 D 14 “长度 15.9 mm、厚度 227.79 mm”），解析器只能标待审核，不能替原文改值；需对照官网修正知识库。`content/facts.ts` 的过滤保留为第二道防线。
   副作用：带“仅限 Windows 版本”脚注的整组事实（如 D 14 两款处理器、特色应用）现在都是 pending_review，推文不会引用；是否放宽待定。
2. ~~是否提交推文模块~~ 已提交 `cbfccb7`。
3. 公众号接口需用真实 AppID / AppSecret + IP 白名单联调。
4. 选购顾问接入真实大模型：按 `packages/contracts/src/advisor.ts` 的 `AdvisorEngine`（respond / answer / interpretFeedback / composePlan）实现，在 `apps/server/src/main.ts` 替换 `createMockAdvisorEngine()`；`packages/agent` 的 `Consultant` 与 `types2.ts` 是另一套状态模型，需要收敛。
5. 新品事实卡审核流（总部上传资料 → 抽取进待审核 → 人工确认 → 才可用于推文）尚未实现。
6. 离店个人互动 HTML：目前只有只读快照；旧的离线运行时在第一次重构中作为死代码删除，可从提交 `37d2880` 找回。
7. 企业微信“客户朋友圈发表任务”接口可实现总部一键下发、导购一键发表，尚未接入。
8. 小问题：登出瞬间有在途请求会在控制台出现 401；未使用的图片 `hero-device.png`、`scene-multidevice.png`、`huawei-collaboration.png`、`huawei-continuity.png` 保留未删。

## 五、运行与验证

```powershell
npm install
npm run dev                       # 后端 8787 + 前端 5173；DATA_SOURCE_MODE=auto 读本地知识库，=mock 用模拟数据
npm run typecheck
npx vitest run                    # 全部测试
npm run build
```

- 本地知识库放在 `code/local-data/华为PC全板块深度知识库_v7`（gitignore），P1 产品参数、P6 平台模板已被使用；P2 话术、P8 场景尚未接入。
- 推文模块数据在 `apps/server/.runtime/marketing/`（gitignore），删除该目录即重置（会重新创建初始账号与主密钥；**删除主密钥会使已保存的平台密钥无法解密**）。
- 公网部署前：设置 `AUTH_SECRET`、`COOKIE_SECURE=true`，为选购顾问接口加鉴权，加限流与 HTTPS。

## 六、工作约定

- 改动先在分支上做；提交、推送前征得用户同意。
- 所有视觉值来自 `styles/tokens.css`；中文正文 ≥ 14px、最小 12px，不用负字距，图标用 `components/ui.tsx` 的 SVG。
- 门控写在服务端程序里，不靠提示词；模拟内容必须标注；事实只能来自知识库原文。
- 修 bug 先写能复现的测试，确认修复前失败、修复后通过。
