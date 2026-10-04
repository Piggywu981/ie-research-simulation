# 存档导出/导入与可核对性 设计规格

日期：2026-10-04
状态：设计已与用户逐段确认（四段全部认可），待用户复核本文
关联：`docs/roadmap.md`（P0 项）、`docs/superpowers/specs/2026-10-03-factory-trade-design.md`（存档 v3）

## 1. 背景与目标

README 承诺"跨设备请使用系统内导出的存档/CSV 文件"，但代码里**不存在任何存档文件 IO**：`src/components/SaveLoadPanel.tsx` 只有 localStorage 读写，`Blob`/`createObjectURL`/`FileReader`/`download=` 命中数为 0（对照组：控制表与操作日志的下载写法在 `src/components/OperationCenter.tsx:480-494` 与 `:634-642` 已经存在）。本项目在一次验证过程中就真实发生过"测试存档覆盖并清空了浏览器 localStorage"的事故。

目标有三条，按依赖顺序：

1. 让财务日志成为**可信的钱流账**（前置条件，不成立则第 3 条无意义）；
2. 让进度能变成**一个可携带的文件**，并在导入时**先预览、默认不覆盖**；
3. 给存档包加上**可核对性**：以账实重演算为主、包哈希为辅，并把能力边界写进文档。

## 2. 实测依据（2026-10-04 探针，脚本化 8 个季度）

探针做法：`createFreshState()` 起点现金 20M → 一次性注入到 200M（这笔变动**故意不记日志**）→ `applyShortTermLoan()` + `discountReceivable(7)` → 连续 `nextQuarter()` 8 次 → 期末现金 190M。随后按"是否汇总条目"分组求和。

| 测得 | 数值 | 结论 |
|---|---|---|
| 日志总条数 | 75 | — |
| 普通流水条目 | 66 条，`Σ cashChange = -10M` | 与实际净变动 **-10M 完全相等** → 流水账可信，重演算成立 |
| 汇总条目 | **8 条重述串合计 -36M**（另有 `初始现金` 种子 +20M 被探针的"`!stepId`"判据误归进这一桶，凑出 -16M） | 直接对全部日志求和会重复计 -36M；与种子相抵后净畸变 -16M |
| `newCash === 0` 的日志 | 4 条 | 年末结算日志带占位值，`newCash` 不可用于精确定位 |
| 单帧快照体积 | 初始 4.1KB / 攒满 4 年 34.3KB | — |
| 16 份季度存档合计 | **0.54MB** | 距 localStorage 配额很远 → **IndexedDB 迁移不属于本项目需求**（`docs/roadmap.md` §3 P0 的这条判断据此作废） |

> **2026-10-04 勘误（代码穷举 + 实现期独立核算后更正）**：这 9 条"非普通流水"并非"盘点+重述"两类，而是 **8 条季度末重述串（合计 -36M，平均每季 -4.5M）+ 1 条 `初始现金` 种子**。种子 `cashChange = 20` 是真实的期初存入，**不是重复计**，应归为 `flow`；我最初把两者混在一桶里才得出 -16M 这个净畸变数。因此重演算的锚点由"20M + Σ"改为更干净的 **"Σflow 直接等于该帧现金"**（见 §4.4）。
>
> 另需记录一条**方法学缺陷**：本探针当年刻意把 +180M **不入账**地注入，因此在该帧上 `Σflow === cash` 天然不成立（差 180）。不变量真正的前提是"每一次现金变动都有日志"，实现期已改为经 `registerOtherCashFlow` 入账后验证，`§7.1` 同步。`newCash === 0` 的 4 条也定位到了代码源头（3 个逃逸回填的站点，见 §4.1）。

> 探针脚本为一次性文件（`tests/scratch-*.test.ts`），量完即删，未入库。复现方式在实现计划里以回归测试的形式固化，见 §7。

## 3. 规格来源与约束

### 3.1 代码穷举结论（2026-10-04，39 个日志产生点）

为把分类做准，对 `src/store/enterpriseStore.ts` 的全部 `FinancialLogRecord` 产生点做了穷举：**39 处**（36 处带 `stepId`，另 3 处不带：`initialState` 的 `初始现金` 种子、`addFinancialLog`、`nextQuarter` 的季度末重述串）。要点：

- 真正属于 `summary` 的**只有 1 处**：`quarterEndLog`（无 `stepId`，`cashChange = finalCashChange` 是整季净额，重述了同季其它条目）。`季初现金盘点`（`stepId: 'q-1'`）的 `cashChange` 本来就是 `0`，归 `flow` 不影响重演算，只是其 `newCash` 是存量而非增量。
- `addFinancialLog`（约 `:452-474`）**全仓零调用点**，是死 API；本规格直接删除，不为它加 `kind` 参数。
- `newCash: 0` 出现在 9 个站点，其中 6 个由 `:2641-2647` 的回填修复；**3 个逃逸**：`startProductionLogs`（约 `:2227`）、`installPaymentLogs`（约 `:2273`）、年末市场放弃警告（约 `:2732`，因它在回填块**之后**才 push）。回填必须在 `remappedYearEndLogs`（约 `:2744`）与 `allLogs` 组装（约 `:2745`）之前完成，`financialLogs` 只在 `:2766` 一处进状态。
- 顺带发现两处**现存错误**，本次一并修：① `OperationCenter.tsx:429-443` 的 `calculateQuarterTotal` 对整季**全部**日志求和，因此今天就在重复计季度末重述串；其排除逻辑用 `description.includes('季初现金盘点')`，而 q-1 的真实文本是 `(...)` 括号串，**该分支是死代码**。② `enterpriseStore.ts` 约 `:2748` 的行内注释写"插入到开工日志之后"，实际 `rdLog` 落在 `materialArrivalLog` 之后、开工日志之前。

### 3.2 来源与约束

1. 课程权威资料 `directions/创新创业实践（2）/《创新实践及科研训练》沙盘模拟仿真开发提示词.md`：单企业设定、**删除所有与其他企业相关的设定**、仅修改广告投放规则。故本规格不得引入任何交易对手或联机对抗。
2. 经营模拟实证研究的结论：失败模式之一是"市场计算不透明、评分对传答案与 AI 代做缺乏结构性抵抗"（详见 `docs/roadmap.md` §1.1 及其中链接）。本规格第 4.4/4.6 节的取舍直接回应它，但**不假装能解决它**。
3. 全局约束沿用：不新增 npm 依赖；校验失败一律 `return { validationError: '…' }`，不抛异常；变更类操作受 `isPaused` 拦截；金额整数 M；提交信息中文 Conventional Commits。

## 4. 设计

### 4.1 前置：财务日志的流水/汇总分类

`FinancialLogRecord` 增加判别字段：

```ts
// flow = 该条记录一次真实现金增减；summary = 盘点/期末重述，不得参与现金重演算
kind: 'flow' | 'summary';
```

分类依据是**日志的产生位置**，不是描述文本——文本匹配是本仓库已知的脆弱来源（终审批评过 `OperationCenter` 的 `matchOperation` 关键词匹配，同一类问题，§3.1 已列出它今天就在误算）。按穷举结论：

- **唯一必须归 `summary` 的产生点**：`quarterEndLog`（季度末「第X年第Y季度结束现金变动」重述串，无 `stepId`，`cashChange` 是整季净额）。
- 其余 38 处全部归 `flow`，包括 `初始现金` 种子（真实期初存入）与 `季初现金盘点`（`cashChange` 本就是 0，不参与求和）。
- `addFinancialLog` 零调用点，**删除**而非加参数。

同时修掉 3 个逃逸回填的 `newCash: 0` 站点（§3.1）：把 `installPaymentLogs` 与 `startProductionLogs` 纳入 `:2641-2647` 的回填序列，并把年末市场放弃警告移到回填块**之前** push。回填完成后才允许 `remappedYearEndLogs` 拷贝与 `allLogs` 组装。

**消费方同步改用 `kind`**（三处，都是把脆弱的文本判断换成字段判断）：
1. `src/utils/controlTable.ts` 的 `q-18`/`q-19`（跨步骤现金合计）先 `filter(l => l.kind === 'flow')`；
2. `src/components/OperationCenter.tsx:429-443` `calculateQuarterTotal` 同样只加 `flow`，并删掉 `:402-415` 里那条永不命中的 `季初现金盘点` 文本排除；
3. `tests/controlTable.test.ts:5-15` 的 `mkLog` 补 `kind` 字段（否则类型检查失败）。

**不变量（必须由测试长期守着）**：对任意操作序列与任意存档帧，`Σ(flow.cashChange) === 该帧 finance.cash`。

**版本**：字段新增属破坏性变更，`SaveFile.version` 3 → 4。旧存档的一次性兜底规则只有一条（新代码一律显式写 `kind`，不依赖它）：`stepId` 存在 → `flow`；`stepId` 缺失且描述含"季度结束现金变动" → `summary`；`初始现金` → `flow`。`loadGame` 的版本判断由 `=== 3` 改为 `>= 4`（修掉 `docs/roadmap.md` §5.7 记的那颗雷）。

### 4.2 存档包格式与导出

```ts
export interface SavePackage {
  format: 'ie-sandbox-save';
  packageVersion: 1;
  exportedAt: string;          // ISO 8601
  app: { saveVersion: number; year: number; quarter: number };
  current: EnterpriseState;    // 当前屏状态（与最新一帧内容重复，换来"设为当前进度"可一步执行）
  saves: SaveFile[];           // 全部历史快照，含每帧内嵌的 financialLogs
  digests: {
    package: string;           // 整包哈希，形如 'sha256:<hex>' 或 'unavailable:<原因>'
    frames: Record<string, string>;  // saveId -> 该帧哈希
  };
}
```

- 导出文件名：`企业1存档-第Y年第Q季-YYYYMMDDHHmm.json`。
- 下载复用 `OperationCenter.tsx:480-494` 已有的 Blob + `URL.createObjectURL` + `revokeObjectURL` 写法。**JSON 不加 BOM**（与 CSV 不同：CSV 加 BOM 是为 Windows Excel，而 BOM 会让 `JSON.parse` 与 `python json.loads` 直接报错，教师侧脚本处理很常见）；MIME 用 `application/json;charset=utf-8`。
- 导出是**异步**（哈希用 WebCrypto），按钮需 `导出中…` 的禁用态，完成后恢复；失败走 `validationError`，不留半截下载。
- 体积预期 ~0.6MB，不做压缩、不做分卷。

### 4.3 导入与预览

新增文件选择入口与导出按钮都放在**存档面板**（`SaveLoadPanel.tsx`）顶部的按钮行内，与既有「手动存档 / 重置游戏」并列，不新开页面。读文件用 `File.prototype.text()`（原生异步，不引依赖、不用 `FileReader` 回调套壳）。解析流程分四步，前一步失败即终止：

1. **JSON 解析**：失败报「文件不是有效 JSON」。
2. **结构校验**：`format === 'ie-sandbox-save'`、`packageVersion === 1`、`Array.isArray(saves)`、`current` 含 `finance/production/logistics/marketing/operation` 五域；数值字段做类型与非负检查（`cash`、库存数量、`accountsReceivable` 四档、`year ∈ 1..5`、`quarter ∈ 1..4`）。拒绝畸形结构并**明确指出哪个字段**，不静默"迁移"。文件大小上限 8MB，超出直接拒绝。
3. **逐帧规范化 + 哈希重算 + 账实重演算**（见 4.4），得出核对结论。
4. **渲染预览面板**（此时尚未改动任何状态）：包内帧数与时间跨度（最早/最新存档的 `createdAt`）、当前帧的 `第Y年第Q季`、现金、应收账款四档合计、长短期贷款本金合计、重置次数、完整性结论摘要（通过 / 第X年第Q季流水与重述不符 / 帧末现金被改 / 起算链不完整 / 哈希指纹是否匹配）。

预览面板给两个动作，且**默认不覆盖**：

- **仅加入存档列表**（默认）：把 `saves` 并入 localStorage 存档列表；同 `id` 冲突时不替换，改为 `${id}-imported-${n}` 追加。当前屏不变。
- **设为当前进度**：先写入当前屏，**不自动**并入列表，由玩家自行决定是否再手动存档。

取消或关闭面板 = 什么都不做。

### 4.4 可核对性：重演算为主，哈希为辅

**账实重演算（主）**：判定只用**一个**公式，避免两套结论——

```
预测现金 = Σ(该帧 financialLogs 中 kind === 'flow' 的 cashChange)
断言：预测现金 === 该帧 finance.cash
```

依据是 §2 实测与 §3.1 勘误：每帧内嵌的日志是从开局到该帧的**全量累积**，且 `初始现金`（+20M）本身就是一条 `flow`，因此**不需要任何外部锚点常数**。`resetGame()` 同时重置日志与现金，公式在重置后依旧成立（`resetCount` 只作展示，不参与计算）。

**季度定位**只用单帧数据，不跨帧拼接（帧与帧之间可能来自不同重置局）。**但不得按 `(year, quarter)` 分桶比较**（2026-10-04 S-T2 实测发现）：一次 `nextQuarter` 推进产生的季中日志被 stamp 成 `(新年, 新季)`，同一次推进产生的年末结算日志被 `remappedYearEndLogs` 改写成 `(收尾年, 4)`，而那条重述串记的是**整次推进的净额**、落在 `(新年, 新季)` —— 于是"该季 flow 合计 == 该季 summary 合计"在跨年那一季天然不成立（实测 `第2年第1季`：summary +6M vs 同桶 flow +15M），照它判定会在完全正常的存档上报假阳性。

改用**双重建 + 包内定位**（第二次更正：帧内按数组顺序累计也不行，因为 `quarterEndLog` 在 `allLogs` 里排在年末结算日志**之前**，每个跨年标记都会假不等）：

**B 式重建的前提是重述串必须覆盖整季全部现金变动**（2026-10-04 S-T3 上报后追加的第四次更正）：`quarterEndLog.cashChange` 取自 `finalCashChange`（`enterpriseStore.ts:2648-2650`），而它只累加**引擎自动项**（应收收现、短贷、应付、原料、维护、租金、长贷息、行政、研发），**不含玩家在该季主动发起的交易**。实测：一次带 180M 注资、短贷、贴现并推进 5 季的存档，A 侧 202 = 现金 202 成立，B 侧只有 22（差值恰为那笔注资）。因此**必须先修重述串语义**：`cashChange` 改为"自上一条重述串以来的全部净变动"，即 `finalCash - 上一条 summary.newCash`（首条以 `初始现金` 为链头）。该字段今天没有别的消费方（S-T2 的合计已过滤 `kind`，页面读的是它的 `newCash`），改动半径小，但需同步 `migrateState` 与 v4 语义说明。

修好后：
- **A**：`Σ(该帧全部 flow.cashChange)`（含 `初始现金` 种子）应等于该帧 `finance.cash`
- **B**：`初始现金 + Σ summary.cashChange + Σ(时间戳晚于最新一条 summary 的 flow)` 应等于该帧 `finance.cash`（末项处理"季中手动存档"这条开尾缝隙）

A 成 B 败 → 重述串被改；A 败 B 成 → 流水条目被改；两者皆败 → 帧末现金（或期初条目）被改；无种子 → 「起算链不完整」。**判据不依赖 `newCash` 数值正确性，只用其时间序。** 无 `flow` 之外的信息时，`no-anchor` 帧的 `flowRebuilt`/`restatedRebuilt` 用 `null` 而非 `NaN`（`NaN` 经 `JSON.stringify` 会变成 `null`，会让 S-T8 报告与 S-T7 面板的读数失真）；`firstDivergingFrame` 把 `no-anchor` 也算作"第一个有问题的那一帧"，但结论单列，不与"账实不符"混述。

**季度坐标交给整包**：`auditFrames` 按 `timestamp` 升序，`firstDivergingFrame` 取最早不平的那一帧，报「自第X年第Y季起账实不符」——存档包本就逐季携带快照（§4.2），这是唯一可靠且不依赖日志排序的定位来源。该方案**不依赖密码学，也不依赖 `newCash` 字段**（后者经 S-T1 修复后虽已处处为真值，仍不作判据）。

**包哈希（辅，指纹而非结论）**：
- 规范化序列化：递归按 key 排序、剔除 `undefined`、数字与字符串原样；
- `crypto.subtle.digest('SHA-256', ...)`，输出 `sha256:<hex 前 16 位>`；
- 逐帧一份（覆盖 `{id, timestamp, version, resetCount, state}`）+ 整包一份（不含 `digests` 自身）；
- **非安全上下文降级**：`crypto.subtle` 不存在时（http 打开本地构建等），存 `unavailable:insecure-context`，导入侧显示「哈希未计算（非 HTTPS 环境）」，**绝不静默跳过、绝不因此判失败**。

诚实边界（写进代码注释与所有对外文案）：客户端哈希防不住"改数据后自己重算哈希"的人，它只把随手改数的成本从"编辑一个数字"提高到"得懂格式并重算"。真正防作弊靠控制表 + 实践报告 + 课堂答辩。

### 4.5 核对报告

导入预览面板与存档面板都提供「导出核对报告」，与面板共用同一数据源（不分叉实现），产物为 JSON 与纯文本两种（`.json` 供教师留存批注，`.txt` 供快速阅读）。报告含：文件名、导出时间、包哈希、逐帧结论（通过/断在第X年第Q季/差多少）、以及 4.6 的边界声明首行。

### 4.6 能力边界的对外文案

固定句式（报告首行、规则弹窗、README 三处一致）：

> 完整性校验用于发现误操作与随手改数，**不构成防作弊保证**；成绩判定以运行控制表与实践报告为准。

实现落地后，同一段文案还要留出两条余地（都是实测得出、不是假想）：

- **旧档的"不符"不等于篡改**：`version < 4` 的帧里，v3 时代的构建可能存在没写进流水的现金变动，那一版存档天然就可能对不平。判据仍只看流水，但印面必须与 v4 帧的篡改判定分开说（`CALIBER_TEXT` 后两条 + `auditSummary.legacyMismatch` 条数），否则一份健康的老档会被读成作弊证据。
- **同毫秒的手操是精度盲区**：重演算的"季末之后还有尾随流水"靠 `Date.now()` 的毫秒序区分（见 `audit.ts` 的 B 式尾项前提），若同一毫秒内既推进了季度又完成了主动交易，那笔交易既不在重述串里也不进尾项 → 报出一条并不存在的"账实不符"。人工点按隔着秒不会触发，脚本式连点或自动化操作才可能。

## 5. 数据流

导出：UI 按钮 → `useEnterpriseStore` 取 `state` + `getSaveFiles()` → 规范化 + `crypto.subtle` 异步哈希 → Blob 下载。
导入：`<input type="file">` → `file.text()`（浏览器解码自动去 BOM）→ 结构校验 → 逐帧演算 + 哈希重算 → 预览面板（纯读，不落状态）→ 用户选择 → 写 localStorage 列表或 `set({state})` → 操作日志记一次「导入存档」。

## 6. 错误处理

| 情形 | 呈现 |
|---|---|
| 非 JSON / 非本格式 / 超 8MB | `validationError`，指出拒绝原因，状态不变 |
| 必需字段缺失或类型错 | `validationError`，指明字段名与期望类型 |
| 旧版本包（saveVersion < 4） | 允许导入，走 `migrateState` 推断 `kind`，面板标注「已迁移，建议重置开新局」 |
| 账实不符 | **不阻断导入**，预览面板红字列明断在哪一季、差多少，由人决定 |
| 无 `crypto.subtle` | 哈希显示"未计算"，重演算照常执行 |
| 导出中途失败 | 按钮恢复可用，`validationError` 说明，不产生半截文件 |

任何情况下都不得静默覆盖玩家已有存档。

## 7. 测试策略

新增/改动，全部为纯函数或 store 级测试（`npx vitest run`）：

1. **不变量回归**（取代本次探针）：脚本化"短贷 + 贴现 + 连续 8 季推进"，断言 `Σ(flow.cashChange) === 该帧 finance.cash`（**无锚点常数**，前提是每次现金变动都入账，故注入必须走 `registerOtherCashFlow` 而非直接 `setState`）；并断言该跑法恰好产出 8 条 `summary`（每季一条重述串）、其 `cashChange` 合计为 **-36M** 且**不**进入求和。
2. `newCash` 不再有 0 占位：走满一年（含年末结算、自动开工、安装分期、市场放弃警告）后，断言所有 `flow` 日志满足 `newCash !== 0 || cashChange === 0`——这条专防 §3.1 的三个逃逸站点（`startProductionLogs`、`installPaymentLogs`、年末市场放弃警告）。
3. 导出器与页面两处现金合计都只加 `flow`：构造一条 `summary` 日志，断言控制表 `q-18`/`q-19` 单元格与页面 `calculateQuarterTotal` **都**不受它影响（后者今天会重复计，是本次要修的实际缺陷）。
4. 规范化 + 哈希：同一 state 两个不同 key 插入顺序的对象必须得到相同哈希（键排序证明）；改 `cash` 一位数字必须改变哈希；`crypto.subtle` 缺失时返回 `unavailable:*` 而不是抛错。
5. 账实重演算：把一个合法包的某帧 `cash` 手改 +30M，断言审计报出"第X年第Q季账实不符，差 30M"；不改则断言全部通过。
6. 导入冲突：同 `id` 存档两次导入，列表长度 +2 且第二条带 `-imported-1`，原有条目内容逐字节不变（**默认不覆盖的可执行证明**）。
7. 导入结构校验：缺 `current`、`cash` 为字符串、`quarter = 9`、文件超 8MB 四种情况各自拒绝且 `state` 与 localStorage 均无变化。
8. v3→v4 迁移：旧帧无 `kind` 时推断结果正确，且 `loadGame` 提示文案含 "v4"。
9. UI（无自动化）：`npm run build` 通过 + 手工冒烟——导出的文件在同一浏览器重新导入能看到帧数与核对结论；换浏览器（等价换设备）导入能恢复进度；点「取消」后面板关闭且 localStorage 与当前屏逐字节不变。
10. **暂停态取舍（此处定死，不留给实现判断）**：导出与导入的读取/校验/预览属只读，暂停时**照常可用**；「仅加入存档列表」与「设为当前进度」属变更，暂停时按钮禁用并给出可见说明「运营已暂停，请先继续运营再导入」，与仓库既有 `isPaused` 语义一致。

## 8. 范围外

- IndexedDB / PWA / 离线包（§2 实测 0.54MB 已证不需要）。
- 后端上传、教师账号、云端存档、多人同局（与课程单企业约束冲突）。
- 密码学签名、密钥、防重放的强防作弊（客户端做不到，见 4.4 的诚实边界）。
- 压缩、分卷、增量存档。
- 操作日志的"可编辑性"治理：本次只读校验，不改日志的写入语义（除 §4.1 的 `kind` 与 `newCash` 修正）。

## 9. 假设（用户已认可，若复核推翻请指出编号）

1. 存档包 = 当前进度 + 全部历史快照（不做"只导当前帧"，也不内嵌控制表 CSV 全文）。
2. 导入默认**不覆盖**：预览后二选一，冲突改名追加。
3. 可核对性 = 账实重演算为主 + 包哈希为辅；哈希只作指纹，不作结论。
4. 核对结果既在面板显示，也可导出为 `.json` / `.txt` 报告。
5. 「防君子不防改代码」的能力边界**必须写进**报告、规则弹窗与 README。
6. `financialLogs` 每帧全量内嵌的现状保留，重演算**只在帧内**进行，不跨帧拼接（否则会重复计 16 遍）。
7. 引入 `kind` 字段即存档 v4；v3 存档按规则推断迁移而非拒绝导入。
8. `crypto.subtle` 不可用时降级为"未计算"，不算失败。
