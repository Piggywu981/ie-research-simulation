# 发展方向与优先级

更新：2026-10-05 ｜ 状态：待与课程方确认 ｜ 适用版本：`main` @ `826459e`（v0.2.0 + 厂房交易）；**§2/§3 中标注"已落地"的条目来自 `feature/save-integrity`**（存档包导出/导入、账实重演算、核对报告，规格见 `docs/superpowers/specs/2026-10-04-save-export-integrity-design.md`）

这不是一份实现计划，而是一份**方向判断**：把"下一步做什么"的依据、顺序和不做什么写清楚。任何一项立项前都应回到这里改结论，而不是另开新文档。

---

## 1. 判断依据

### 1.1 实证研究怎么说

对经营模拟（business simulation）的实证结论相当一致：收益来自**做了决策并看到后果**，而不是旁观；有报告给出陈述性知识 +11%、程序性知识 +14%、保持率 +9%、自我效能 +20% 的量级。团队结构通过协作提升投入度，而**"竞争"本身并未被单独证明是有效来源**。失败模式被点名为三条：市场计算不透明（学习者看不懂绩效的驱动因素）、情景过度脚本化、评分缺乏对"传答案与 AI 代做"的结构性抵抗。
参考：[Do Business Simulations Improve Learning?](https://proformasim.com/business-simulation-research)、[SAGE 2025](https://journals.sagepub.com/doi/10.1177/07356331241313128)、[MDPI Education Sciences 2025](https://www.mdpi.com/2227-7102/15/2/168)、[ScienceDirect 2025](https://www.sciencedirect.com/science/article/abs/pii/S1472811725000102)

**对本项目的含义**：单企业设定（依课程要求删除多企业竞争）不必然削弱学习效果；真正决定效果的是"因果可见性"。而本项目目前**记账完整、解释缺位**——这是后面排优先级的根据。

### 1.2 课程与竞赛生态在往哪走

2026 年全国高等院校数智化企业经营沙盘大赛已改用**线上电子沙盘**，总分公式形如 `(所有者权益 + 数智化建设得分 − 预算控制使用率扣分) × 商誉 × (1 + 本年碳中和率 + 上年碳中和率)`，四人学生队 + 1–2 名指导教师。
参考：[渤海大学校赛通知](https://cxcygl.bhu.edu.cn/comp/info/MjA5Mi1lMGJkYjI)、[北信科通知](https://bs.bistu.edu.cn/tzgg/bb0591884c1b48c589e38827f8c27ad0.htm)、[国家智慧教育平台课程](https://higher.smartedu.cn/course/6a88c804b44e493c761b373d)、[学科竞赛组织通知（西南林业）](https://jwc.swfu.edu.cn/info/1461/9841.htm)

**含义**：评价维度正从"活到第四年、权益最高"扩展到**数智化投入、预算控制、商誉、碳表现**。本项目目前连完整资产负债表都没有（只有派生的「土地和建筑」一个数），要接住这条线必须先把报表层补起来——好消息是这些全是账面工作，**不需要多企业，不违反课程 5.1 条**。

---

## 2. 现状事实（可核实，2026-10-04 实测）

| 事实 | 证据 |
|---|---|
| 状态与全部业务规则集中在单文件 store，共 2865 行 | `src/store/enterpriseStore.ts` |
| 主循环 `nextQuarter` 约 790 行（`2052` 起，到 `addOperationLog` 前） | 同上 |
| 财务日志带 `stepId`、年度台账与历年利润表已归档 → **原始数据齐全** | `src/types/enterprise.ts`（`FinancialLogRecord` / `annualLedger` / `yearlyIncomeStatements`） |
| 控制表 30 行可按年导出，季度单元格统一按事件描述填充 | `src/utils/controlTable.ts` |
| **存档只在 localStorage，没有文件导出/导入**（此条只对 `main` 成立，现已落地，见 §3 P0） | 当时 `src/components/SaveLoadPanel.tsx`：`Blob`/`createObjectURL`/`FileReader`/`download=` 命中数为 **0**；而 README 已承诺"跨设备请使用系统内导出的存档" |
| P3/P4 类型字段仍残留，且存在绕过订单池的手工录入旁路 | `src/types/enterprise.ts:83,129,153,213`；`addAvailableOrder` 在 `src/` 有 4 处引用 |
| 已知缺陷与取舍已记录在规格，不在别处 | `docs/superpowers/specs/2026-10-03-factory-trade-design.md` §10.1–§10.4 |

测试规模：`npx vitest run`（**在工作树内跑**，见 §5.9）→ **293 通过 / 18 文件**（2026-10-07 实测，`feature/save-integrity`）。此前记录的 284 是 S-T8 复审修复轮之前的规模；更早的 114 通过 / 12 文件是 §2 那次核查时的规模；`npm test` 若在主检出里显示 24 文件/228 例，那是 `.worktrees/` 副本被重复扫描的假数。

---

## 3. 优先级

### P0 — 存档健壮性（止血，不是新功能）

数据只在浏览器 localStorage，而 Pages 是纯静态站。README 承诺的"导出存档跨设备"**在代码里不存在**（对 `main` 成立）。这不是假想风险：本项目在 2026-10-04 的验证过程中就发生过一次真实事故——自动化验证把测试存档写进 localStorage 并清空了该键，覆盖了此前的人工存档。

**状态（2026-10-05）：导出/导入与账实核对已在 `feature/save-integrity` 落地**——存档包导出（含逐帧与整包 SHA-256 指纹）、导入先预览再落库、**默认不覆盖**（同 id 追加 `-imported-N`）、非覆盖写失败接住 `QuotaExceededError`、`SaveFile.version` 校验与损坏提示、核对报告 txt/json。设计见 `docs/superpowers/specs/2026-10-04-save-export-integrity-design.md`，用户侧说明见 README「存档流转与完整性校验」「完整性校验的能力边界」。

**这一条作废：~~迁移到 IndexedDB 摆脱 5MB 配额~~**。2026-10-04 探针实测（规格 §2 表）：单帧快照开局 4.1KB、攒满 4 年 34.3KB，**16 份季度存档合计 0.54MB**；2026-10-05 用工作树内留存的一份真实导出包复测（命令见下方引用块）：一个只带 2 帧的开局包整份 40.9KB，其中帧本体紧凑 JSON 分别 5.0KB / 7.3KB、`current` 9.6KB，余下是 2 空格缩进与 `digests`。localStorage 配额约 5MB，满打满算用掉约 11% —— **配额不是本项目的瓶颈**，IndexedDB 属凭空发明的问题（移入 §4 明确不做）。

> 复测命令（工作树内，产物为 S-T7/S-T8 冒烟时导出的真实包，未入库、可能随时清理）：
> `node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('.superpowers/tmp/smoke-pkg.json','utf8'));const sz=j.saves.map(s=>Buffer.byteLength(JSON.stringify(s),'utf8'));console.log(j.saves.length, sz)"`
> 长期依据仍以规格 §2 的 4.1KB / 34.3KB / 0.54MB 为准；上面这组只作复核，不要把临时文件当证据链。

保留一条**真实**的配额边界，别把它读成"配额问题已不存在"：解析层的入场闸是 8MB（`src/utils/savePackage.ts` 的 `MAX_PACKAGE_BYTES`），大于源配额约 5MB，所以一个**合法**的大包仍会在 `localStorage.setItem` 抛 `QuotaExceededError`。代码的处理是抛点在写入之前（原列表一个字节不动）＋ 说出原因并返回 `{added:0,renamed:0}`（`src/store/enterpriseStore.ts:501-508`）。**可选 PWA 离线**同样按上面的体积结论重估：现在没有非做不可的理由。

### P1 — 决策复盘层（研究依据最强的一项）

学生做完 4 年能拿到一张 CSV，却拿不到"第 3 年 Q2 为什么现金断了、哪笔决策导致的"。把已有的 `financialLogs` + `yearlyLedgers` + `yearlyIncomeStatements` 反向做成**归因**：

- 利润桥：销售收入 → 综合费用分项 → 折旧 → 财务费用 → 税前 → 所得税 → 净利；
- 现金桥：期初 → 应收收现 → 投料与加工费 → 税金/利息/维护/租金 → 期末；
- 在断流的季度上标出触发它的那笔 `stepId` 操作。

全部是纯函数 + Recharts，可单测、不碰 store，因此不依赖任何前置重构。**这是投入产出比最高的一项**。

### P2 — 报表层与竞赛指标对齐

补完整资产负债表（资产端已有 `landAndBuildings` 的先例：派生而非落库），再考虑 `数智化建设投入`、`预算控制使用率`、`商誉`、`碳表现` 这些扩展维度。属"账面 + 报表"工程，不动单企业设定。**需课程方确认这是下一版的教学要求后再动**，否则是凭空发明规则——厂房交易那次已经证明：课程文档之间会互相矛盾，口径必须由人拍板。

### P3 — What-if 试算（价值高，但有硬性前置）

"假如 Q3 借 20M 短贷会怎样"正是资金规划训练的核心，也是把隐性规则显式化的唯一手段（例：第 4 年 Q2 之后出售厂房，30–40M 永远收不到——现在只在按钮下给一行提示，见 §10.4）。

**依赖链，顺序不可换**：修 §10.2 的浅拷贝泄漏 → 把 `nextQuarter` 抽成 `(state) => state` 纯函数（含把 790 行拆成可测试的阶段） → 才谈克隆分叉。跳过前两步做的试算器不可信。

---

## 4. 明确不做

- **多人同局 / 教师端 / 实时同步**：需要后端、鉴权与并发，且与课程提示词"删除所有与其他企业相关的设定"**正面冲突**；研究也没把竞争列为独立有效因素。只有在课程方改要求时才重新评估。
- **P3/P4 产品线**：课程本期只开放 P1/P2。类型里的 P3/P4 字段和 `addAvailableOrder` 旁路属**待清理的死代码**，不是待开发的功能。
- **在导出器里再加一层过滤**：控制表填充规则已在 2026-10-04 统一为"有事件即填描述串"（§4.12 口径），要精简"无到货/无到期短贷"这类空转注记只能改**日志层**，退回导出器过滤会重新制造双规则。
- **IndexedDB 迁移 / PWA 离线包**：依 §3 P0 的实测体积作废（16 帧合计 0.54MB 对约 5MB 配额，用掉一成）。只有真出现"同一浏览器要放全班存档"或"单局帧数远超 16"这类用法时才回到本节改结论，不要先建库再找理由。

---

## 5. 工程清理包（必须在本文件保存，因为它原先只存在于会被删除的 SDD 台账里）

终审留下一批"低危但会咬人"的尾巴，除第 7 条（已在存档分支修掉）外均**未**修进代码：

1. `docs/.../2026-10-03-factory-trade-design.md` §10.2 写"五处"就地写入，**实为八处**——漏了 `enterpriseStore.ts` 中另外三处 `newFactories[i].productionLines[j] = {…}`。**修那个泄漏前必须先更正计数**，否则照单修复会留下三处未改，形成"看似修完"的假象。
2. 同规格 §10.3：页面 `QuarterCell` 与导出 CSV 仍是**两套单元格取数**。本次只做了止血（按年/季限定 + 补关键词），年末 6 行在页面亮于第 4 季列、而 CSV 把数据写在第 1 季列，列位仍不一致。单源重构（页面直接读 `buildYearControlTable`）是唯一根治法。
3. `src/components/OperationCenter.tsx` 的 `EXTRA_STEP_KEYWORDS` 以**显示名**为键，改名即静默失效——真正的键应是 `stepId`。
4. `.agents/documents/企业运营模拟规则说明文件.md` 顶部勘误块自称"行号以本文为准"，实际因插入 14 行而整体偏 +14，且"见文末"应为"见文首"。
5. `ProductionCenter.tsx`：先开「添加生产线」表单再点出售，`addingLine` 残留该厂房 id，买回槽位后半填表单会复现（观感 bug，无数据损坏）；三处按钮类名重复且与文件既有约定不一致，可抽 `TRADE_BUTTON` 或 `FactoryTradeButtons`；`aria-disabled={false}` 属属性噪音。
6. `landAndBuildings` 参数类型写成 `holding: string`，丢掉了 `FactoryHolding` 的穷尽性检查（零调用点改动即可收紧）。
7. ~~`loadGame` 的版本门用 `=== 3` 而规格 §4.6 写 `< 3`~~ **已在存档分支处理（2026-10-05）**：门改成与常量比较而不是与字面量比较——`saveFile.version >= SAVE_FORMAT_VERSION`（`src/store/enterpriseStore.ts:463`，加载提示语；导入侧同一写法 `:528`），版本号单点定义在 `src/types/enterprise.ts:241`（当前 4），写入侧 `:407`/`:437` 也引用它。审计侧的口径判定另有自己的常量 `RESTATED_FULL_NET_FROM_VERSION`（`src/utils/restatement.ts:17`，被 `audit.ts:64` 使用），**两者不是一条门**：前者说"这帧要不要标旧档迁移提示"，后者说"这帧的重述串是不是新口径"；今天同为 4，下次 bump 时要分别决策，别顺手合并。原雷（新存档被误标"已迁移"）已排除。
8. 覆盖缺口：`未找到该厂房` 三个守卫、`none → owned` 新购路径、出售暂停态、4Q 到账的**时点**（现只验金额）。
9. `.worktrees/**` 会被主仓 Vitest 扫入，导致 `npm test` 报 24 文件/228 例的假数。删掉残留工作树即可恢复；若今后再用 worktree，需在 `vitest.config.ts` 的 `test.exclude` 里加 `.worktrees/**`（2026-10-04 决定：暂不改配置）。**写进文档的任何测试数字都必须来自工作树内的一次运行**，README「开发说明」已把这条写成要求。
10. **用户可见的错值**：页面「季初现金盘点」对 `(第1年, 第1季)` 硬编码返回 `cash: '40M'`（`src/components/OperationCenter.tsx:179`，`getQuarterStartInventory` 的开头分支），而真实初始现金是 **20M**（`src/store/enterpriseStore.ts:16`，README「系统初始状态」同此）。40M 疑似从"土地建筑40M"串了来源。导出 CSV 走的是另一条取数（`src/utils/controlTable.ts:100-108` 的 `quarterStartSnapshot`，读快照里的真实现金），所以**同一格页面与 CSV 会给两个数**——这正是第 2 条"两套单元格取数"的一个已发作实例，修第 2 条时把它一起收掉。**分支终审已列为待修**，本轮（Task 9 文档校正）只挂这条可见 TODO、不改成代码。
11. "只取 `kind === 'flow'`"这条谓词现在**散在 7 处**（`src/utils/controlTable.ts:117`、`:126`；`src/components/OperationCenter.tsx:401`、`:427`、`:702`（summary 侧的排除式写法）；`src/app/page.tsx:335`；`src/store/enterpriseStore.ts:2153` 与 `:2156`——后者还额外把 `description === '初始现金'` 又抄了一遍。分支终审原先记成 6 处，漏了 `:2153` 这条 summary 侧孪生，计数已按 `grep kind === 'flow'|kind === 'summary'|kind !== 'summary'` 的实测更正）。而审计侧与迁移侧共用的是 `restatement.ts` 的 `kindOfLog()`（对**没经过 `loadGame`** 的原始 v3 帧有按位置兜底的分支）。当前这些站点读的都是已迁移的内存态，所以**今天没有行为差异**，风险在漂移：新增一处各写一遍，就会出现"页面合计与审计合计不同源"。待办：合并成一个导出的谓词（如 `isFlowLog`，内部走 `kindOfLog`），种子查找改用 `isSeedLog`。**只写进本节、不写进 README**——README 是给学生/教师的使用文档，内部重复谓词既不可操作也不是使用事实；它的可见后果（同一格两个数）已由第 10 条表达。
12. **B 侧判定只认版本标签、不核串（分支终审 F1，第一条该修的）**：`auditFrame` 的 `!legacyRestated ? 'v4' : …` 分支（`src/utils/audit.ts:65-67`）里 `restatedChainIsNewCaliber()` **只在 version<4 那一支被调用**（全仓唯一调用点就是 `:67`），所以"带 v4 标签但串从没被换算过"的一帧仍按 B 定罪。这种帧确实能产生：`restatement.ts:50` 会跳过缺有限 `newCash` 的 summary 行，而 `saveGame`/`autoSaveGame`（`enterpriseStore.ts:407`/`:437`）无条件把版本抬到 `SAVE_FORMAT_VERSION`——于是 `enterpriseStore.ts:272` 注释里"残缺的串由审计的 version<4 分支兜住"这句话落空。后果是一户健康的老档可能印出「账实不符（季度重述串与现金不符）」，而且因为 caliber 是 `'v4'`，`auditSummary.legacyMismatch`（`audit.ts:143`）**不会**把它算进"旧档判定"。可达性窄（需要 v1/v2 时代存档，或本分支修 kind 那段窗口里写下的开发机残留），措辞也留了余地（「依版本标签推定，未逐串核实」），故不作合并阻塞。修法：`'v4'` 只在整串可核实时给出，否则新增一档把 B 逐出 `status/cause`；需同步更正规格 §4.4，并明确接受这条取舍——**部分真指控会变成"未核实"**，而这正是本功能写在前面的优先级。
13. **口径门只有下界**：`audit.ts:64` 判的是 `version < RESTATED_FULL_NET_FROM_VERSION`。若将来口径再变（v5），v4 标签的帧仍会被 B 判定。落地第 12 条时把它写成**版本区间**，与第 7 条"两道门不合并"并列。
14. **`getQuarterEndCash` 无守卫插值**：`src/components/OperationCenter.tsx:276` 与 `:287` 直接 `${quarterEndLog.newCash}M` / `${lastQuarterLog.newCash}M`，缺 `newCash` 的老帧会印 `undefinedM`。属既有问题，但**导入功能第一次让外来老包能走到这一格**（`applyImportedState` 只迁移 `kind`，从不回填 `newCash`，`enterpriseStore.ts:262-275`）。与第 10 条同族。
15. **`nextQuarter` 的链头锚定与审计不同序（行为分叉，比第 11 条重）**：`enterpriseStore.ts:2152-2154` 用严格 `>` 的 reduce 取最大 timestamp（同毫秒时留**数组里先出现**的那条），而 `restatement.ts:45` 与 `audit.ts:126-127` 定的是 `timestamp || id.localeCompare` 全序。两条 summary 同毫秒（脚本式/自动化推进）就会让 store 锚在与审计不同的行上 → 把错口径的 `cashChange` **永久写进存档** → B≠A → 假 `restated-log`。待办：链头取数改走同一个 `latestSummaryOf`（基于 `byTimeThenId`），种子查找改用 `isSeedLog`。**注意别顺手统一的一处**：store 的回退 `seedCash || initialCash` 与审计的 `null`/`no-anchor` 回退**刻意不同**——store 必须写出一个数，审计必须不许编数。
16. **规格 §4.4/§4.5 曾落后于代码（本轮已改）**：§4.4 的公式原写 `kind === 'flow'`，实现是 `kindOfLog`（正是 round-3 finding N1 的修法）；§4.5 的字段清单未列两条余地、`指纹口径` 行、`重置次数`、`packageDigestScope: 'declared-not-reverified'`、`frameDigests`/`reportFileName`，以及 `unavailable:*` 翻成人话。代码是**更诚实的超集**，所以改的是文档。**留给后续的判断**：今后每加一行印面都要回写 §4.5，否则文档又会变成"少说"的版本。
17. **S-T7 冒烟欠的视觉验收**：连接器逐字报 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE: viewport=0x0, visible=false, attached=false`，所以截图/像素观感、真实文件选择器、OS 级落盘、多帧（~0.6MB）与 `unavailable:*`/真篡改包的浏览器路径仍是 NOT VERIFIED（`evaluate_script` 只证明了 DOM 与 `getComputedStyle` 层面）。**测试全绿不等于这三条已验。**
18. **半自动线分期口径疑点（S-T1 登记，至今未查证）**：8M 的线付 12M——首付 4M（`enterpriseStore.ts:888-889`）+ 两期分期各 4M（`:2262`），描述却写"共2期"。与本分支无关，测试注释已如实描述现状，需要独立立项判定"是规则如此还是多收 4M"。
19. **`rdLog`/`q-1`/`q-7` 三处 `newCash` 与统一回填链口径不同**（各自忽略 materialPayment/totalInstallPayments/autoProcessFees/短贷/应付）。今天没有消费方读它当现金链；一旦有人读就错——这是规格 §4.4「`newCash` 不作判据」的反面保险。
20. **`a.click()` 抛错时漏 `removeChild`/`revokeObjectURL`**，以及重复 id 让存档列表两行共用一个 React key：S-T5 裁定"单点改反而制造不一致"（仓库既有两处导出同款），宜与 `SaveLoadPanel.tsx` 的 `downloadFile` 一起收。
21. **展示表的行内字段类型未逐字段校验**（S-T6 遗留）：`rawMaterialOrders`/`advertisements`/`availableOrders`/`selectedOrders` 的条目只要求"是对象"，缺字段会印成 `undefined`（可见的错值，不崩）。是否收紧待定。
22. **`.superpowers/` 曾被 `.gitignore` 漏掉**（本轮已加）：SDD 台账与冒烟产物一度处于"未跟踪但一条 `git add -A` 就入库"的状态。另注意 `.worktrees/factory-trade` 已是**孤儿目录**而非登记中的工作树（`git worktree list` 只两条），`git worktree prune` 不会删它，需手工清理（台账记录它曾被 node PID 58536 占用）。

---

## 6. 怎么知道做对了

- P0：**（已验，2026-10-05）**在一台干净电脑上导入另一台导出的 JSON，运营进度与 4 年利润表完全一致；导入被截断的文件给出明确错误而不是崩溃——两类都跑过（S-T5/S-T6/S-T7 的冒烟：正常包、把帧末现金改成 168 的篡改包、缺 `current` 的畸形包、改动 `current` 却不重算包指纹的包；产物在工作树 `.superpowers/tmp/` 下，未入库、可能随时清理），并有 `npx vitest run` 的 293 例作回归（2026-10-07 于工作树内复跑）；判据"不静默覆盖任何存档"由 `tests/saveImport.test.ts`「导入落库语义（默认不覆盖）」那组用例守住。
- P1：任选一次现金断流，复盘页能指出是哪笔操作、哪个季度造成的，且金额与已导出的控制表逐格对得上。
- P2：资产负债表恒等式在任意年份任意操作后都成立（资产 = 负债 + 权益），亏损年所得税为 0。
- P3：同一状态下推演分叉不改变原状态；`npx vitest run` 在改动前后都绿。
- 通用：`directions/` 永远不被改动；不新增依赖；产品文案与代码字符串一致（上一版靠人工逐条核对，31 条学生可见陈述全部对代码验证过，这个做法应固定下来）——**存档这条已固化成测试**：`tests/integrityCopy.test.ts` 断言能力边界那句在报告首行/规则弹窗/README 三处是**同一个常量对象**，并断言 README 与弹窗写下的界面说法（按钮名、`-imported-N`、`哈希未计算`、三类不符措辞）在源码里真存在。其余文案仍靠人工。
