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
| 汇总/盘点条目 | 9 条，`Σ cashChange = -16M` | 直接对全部日志求和会**重复计 16M** |
| `newCash === 0` 的日志 | 4 条 | 年末结算日志带占位值，`newCash` 不可用于精确定位 |
| 单帧快照体积 | 初始 4.1KB / 攒满 4 年 34.3KB | — |
| 16 份季度存档合计 | **0.54MB** | 距 localStorage 配额很远 → **IndexedDB 迁移不属于本项目需求**（`docs/roadmap.md` §3 P0 的这条判断据此作废） |

> 探针脚本为一次性文件（`tests/scratch-*.test.ts`），量完即删，未入库。复现方式在实现计划里以回归测试的形式固化，见 §7。

## 3. 规格来源与约束

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

分类依据是**日志的产生位置**，不是描述文本——文本匹配是本仓库已知的脆弱来源（终审批评过 `OperationCenter` 的 `matchOperation` 关键词匹配，同一类问题）。store 内约 36 处 `stepId:` 出现（即日志产生点，实现时以 `grep -n "stepId:" src/store/enterpriseStore.ts` 重新点数为准）需逐条标注，已知必须归为 `summary` 的三族：

- 季初现金盘点日志（`stepId: 'q-1'`，其 `cashChange` 是**期初存量**而非变动）；
- 「第X年第Y季度结束现金变动」叙述串（`enterpriseStore.ts:2661` 起）；
- 年末过渡中的重述型条目（凡 `cashChange` 与其组成项重复者）。

同时修掉 4 条 `newCash: 0` 占位：在该 `set()` 计算末尾统一回填真实期末现金。

**不变量（必须由测试长期守着）**：对任意操作序列，`Σ(flow.cashChange) === 期末cash - 期初cash`。期初锚点 = `createFreshState().finance.cash` 起算的 20M，或任一存档帧自带的前值。

**版本**：字段新增属破坏性变更，`SaveFile.version` 3 → 4。迁移函数（现为 `migrateState`）对缺失 `kind` 的旧帧按"有 `stepId` 且描述不是上述三族 → `flow`，否则 `summary`"推断，并在日志里提示"旧存档已迁移至 v4"。`loadGame` 的版本判断由 `=== 3` 改为 `>= 4`（修掉 `docs/roadmap.md` §5.7 记的那颗雷）。

`src/utils/controlTable.ts` 的导出器同步改：凡按现金汇总取数的格子（`q-18`/`q-19`/`q-20` 及默认分支）一律先 `filter(kind === 'flow')`，废除按描述文本的判断。

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
4. **渲染预览面板**（此时尚未改动任何状态）：包内帧数与时间跨度（最早/最新存档的 `createdAt`）、当前帧的 `第Y年第Q季`、现金、应收账款四档合计、长短期贷款本金合计、重置次数、完整性结论摘要（通过 / 断在第X年第Q季 / 哈希指纹是否匹配 / 锚点不可确认）。

预览面板给两个动作，且**默认不覆盖**：

- **仅加入存档列表**（默认）：把 `saves` 并入 localStorage 存档列表；同 `id` 冲突时不替换，改为 `${id}-imported-${n}` 追加。当前屏不变。
- **设为当前进度**：先写入当前屏，**不自动**并入列表，由玩家自行决定是否再手动存档。

取消或关闭面板 = 什么都不做。

### 4.4 可核对性：重演算为主，哈希为辅

**账实重演算（主）**：判定只用**一个**公式，避免两套结论——

```
预测现金 = 20 + Σ(该帧 financialLogs 中 kind === 'flow' 的 cashChange)
断言：预测现金 === 该帧 finance.cash
```

依据是 §2 实测：每帧内嵌的日志是从开局到该帧的**全量累积**，起点恒为课程标准初始现金 20M；`resetGame()` 同时清空日志并重置现金，因此锚点在重置后依然成立（`resetCount` 只作展示，不参与公式）。定位到季度：把上式按 `log.year / log.quarter` 分季求和，与相邻存档快照的现金差逐季对照，第一个不等的季度即报 `第X年第Q季账实不符：流水推算 NM，快照记录 KM（差 ΔM）`。该方法**不依赖密码学，也不依赖 `newCash` 字段**。若某帧的起点不是标准初始态（例如从更早版本迁移而来导致锚点不可确认），报「锚点不可确认」而非「不符」，避免误伤。

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

1. **不变量回归**（取代本次探针）：脚本化"短贷 + 贴现 + 连续 8 季推进"，断言 `Σ(flow.cashChange) === cash - 期初`；并断言 `summary` 条目确实存在且被排除在外（用本规格 §2 的实测数字 -16M 作为固定期望）。
2. `newCash` 不再出现 0 占位：走满一年（含年末结算）后断言所有 `flow` 日志 `newCash !== 0 || cashChange 为 0`。
3. 导出器：`q-18`/`q-19`/`q-20` 单元格与 `Σ flow` 一致，构造一条 `summary` 日志断言其**不**进入合计。
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
