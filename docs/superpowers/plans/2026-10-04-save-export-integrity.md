# 存档导出/导入与可核对性 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让存档能导出成一个可携带、可校验、导入时先预览且不覆盖的 JSON 文件，并以"账实重演算 + 包哈希指纹"给出诚实的能力边界。

**Architecture:** 先把财务日志变成可信钱流账（新增 `kind: 'flow' | 'summary'`，唯一 `summary` 是季度末重述串；修掉三处逃逸回填的 `newCash: 0`），审计与所有现金合计消费方一律按字段过滤而非中文文本匹配。在此之上，`src/utils/savePackage.ts` 负责包结构、解析与校验（纯函数），`src/utils/audit.ts` 负责重演算，`src/utils/saveDigest.ts` 负责规范化序列化与 WebCrypto 哈希及其不可用降级，UI 只在 `SaveLoadPanel.tsx` 做编排。

**Tech Stack:** Next.js 16 / React 18 / TypeScript / Zustand 5 / Vitest 4；哈希用浏览器原生 `crypto.subtle`（无新依赖）。

**Spec:** `docs/superpowers/specs/2026-10-04-save-export-integrity-design.md`（本计划逐节实现它；§3.1 的代码穷举结论与 §2 的勘误是计划的前提，执行前先读那两节）

## Global Constraints

- 不新增任何 npm 依赖（规格 §3.2）。
- 校验失败一律 `return { validationError: '…' }`，不抛异常、不静默降级、不 `return state` 吞掉违规。
- **暂停态取舍已定死（规格 §7.10）**：导出、文件读取、校验、预览、报告导出属只读，暂停时照常可用；「仅加入存档列表」与「设为当前进度」属变更，暂停时禁用并给**可见**提示「运营已暂停，请先继续运营再导入」。
- 任何情况下不得静默覆盖玩家已有存档（规格 §6 末行）。
- 金额单位为 M，整数。
- JSON 导出**不加 BOM**（规格 §4.2）；CSV 加 BOM 的现状不改。
- 不引入 P3/P4 入口，不引入任何"其他企业"或联机要素。
- 提交信息：中文 Conventional Commits。
- **测试必须在本计划的工作树目录内运行**。主检出 `E:/Github/ie-research-simulation` 里 `npm test` 报 24 文件 / 228 例是残留 `.worktrees/factory-trade` 副本被重复扫描的假象；真实规模是 12 文件 / 114 例。凡引用测试数量，先确认自己所在的目录。
- 每个任务收尾门槛：`npx vitest run` 全绿；涉及 UI/构建的任务再加 `npx tsc --noEmit` 与 `npm run build`。

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/types/enterprise.ts` | 类型契约 | 新增 `LogKind`、`FinancialLogRecord.kind`、`SavePackage`/`PackageDigests`；`SaveFile.version` 注释 |
| `src/store/enterpriseStore.ts` | 状态与规则 | 39 处日志产生点标注 `kind`；删 `addFinancialLog`；修三处 `newCash` 逃逸；`migrateState` 补 `kind`；版本 4；`loadGame` 门改 `>= 4` |
| `src/utils/controlTable.ts` | 控制表取数 | `q-18`/`q-19` 先过滤 `flow` |
| `src/components/OperationCenter.tsx` | 运营页 | `calculateQuarterTotal` 只加 `flow`；删死掉的 `季初现金盘点` 文本排除 |
| `src/utils/audit.ts` | 账实重演算 | 新建 |
| `src/utils/saveDigest.ts` | 规范化与哈希 | 新建 |
| `src/utils/savePackage.ts` | 包构建/解析/校验 | 新建 |
| `src/components/SaveLoadPanel.tsx` | 存档面板 | 导出按钮（异步态）、导入入口、预览面板、两个非覆盖动作、报告导出 |
| `src/components/RulesModal.tsx`、`README.md`、`docs/roadmap.md` | 文案 | 能力边界三处一致；roadmap 更正 IndexedDB 判断 |
| `tests/cashTrail.test.ts`、`tests/audit.test.ts`、`tests/saveDigest.test.ts`、`tests/savePackage.test.ts` | 新建测试 | 见各任务 |
| `tests/controlTable.test.ts`、`tests/factory.test.ts` | 修改 | `mkLog` 等日志字面量补 `kind` |

---

## Task 1: 财务日志的 flow/summary 分类

**Files:**
- Modify: `src/types/enterprise.ts`（`FinancialLogRecord`，约 `:231-241`）
- Modify: `src/store/enterpriseStore.ts`（39 处产生点、`addFinancialLog`、回填块、`migrateState`、两处 `version`、`loadGame` 提示）
- Modify: `tests/controlTable.test.ts`（`mkLog` 约 `:5-15`）、`tests/factory.test.ts`（构造日志处）
- Test: `tests/cashTrail.test.ts`（新建）

**Interfaces:**
- Consumes: 无（本任务是地基）
- Produces: `LogKind`、`FinancialLogRecord.kind: 'flow' | 'summary'`、`migrateState` 对 `kind` 的兜底、存档 `version = 4`

- [ ] **Step 1: 写失败测试**

新建 `tests/cashTrail.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { useEnterpriseStore, createFreshState } from '../src/store/enterpriseStore';
import type { FinancialLogRecord } from '../src/types/enterprise';

const store = () => useEnterpriseStore.getState();
const flowSum = (logs: FinancialLogRecord[]) =>
  logs.filter(l => l.kind === 'flow').reduce((t, l) => t + l.cashChange, 0);

beforeEach(() => {
  useEnterpriseStore.setState({ state: createFreshState(), validationError: null });
});

describe('现金流水账不变量', () => {
  it('初始帧：Σflow 直接等于现金，且无需外部锚点常数', () => {
    const s = store().state;
    expect(flowSum(s.operation.financialLogs)).toBe(s.finance.cash);
    expect(s.operation.financialLogs.filter(l => l.kind === 'summary')).toHaveLength(0);
  });

  it('脚本化 8 个季度：Σflow === 期末现金，且恰好产出 8 条 summary 共 -36M', () => {
    // 注入必须入账：不变量「Σflow === 现金」的前提是每次现金变动都有日志，
    // 直接 setState 改 cash 会让公式必然差 180（规格 §2 方法学缺陷勘误）
    store().registerOtherCashFlow('测试注资', 180);
    store().applyShortTermLoan();
    store().discountReceivable(7);
    for (let i = 0; i < 8; i++) store().nextQuarter();

    const logs = store().state.operation.financialLogs;
    const summaries = logs.filter(l => l.kind === 'summary');
    expect(summaries).toHaveLength(8);
    expect(summaries.reduce((t, l) => t + l.cashChange, 0)).toBe(-36);
    // 关键：把 summary 加回去会得 -26（Σflow 10 + Σsummary -36），与实际净变动 -10 不符（规格 §2）
    expect(flowSum(logs)).toBe(store().state.finance.cash);
  });

  it('每条 flow 日志的 newCash 都不为 0 占位', () => {
    store().registerOtherCashFlow('测试注资', 180);
    // 必须买一条带安装期的线（semi-automatic 安装 2 季），否则 installPaymentLogs 恒空、
    // 三处逃逸之一的安装分期根本没被跑到（评审 S-T1 Important 1）
    store().addProductionLine('factory-1', 'semi-automatic', 'P1');
    for (let i = 0; i < 8; i++) store().nextQuarter();
    const logs = store().state.operation.financialLogs;
    expect(logs.some(l => l.description.includes('安装投资分期') && l.newCash !== 0)).toBe(true);
    const bad = logs.filter(l => l.kind === 'flow' && l.cashChange !== 0 && l.newCash === 0);
    expect(bad).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/cashTrail.test.ts`
Expected: FAIL —— `l.kind` 为 `undefined`，`flowSum` 得 0，第一例报 `expected 0 to be 20`。

- [ ] **Step 3: 加类型**

`src/types/enterprise.ts` 在 `FinancialLogRecord` 之前加：

```ts
// flow = 记录一次真实现金增减；summary = 整季净额重述，不得参与现金重演算（规格 §4.1）
export type LogKind = 'flow' | 'summary';

// 存档格式版本单点定义：store 的两处写入、迁移判断、包结构都必须引用它，避免再出现 §5.7 那类漂移
export const SAVE_FORMAT_VERSION = 4;
```

在 `FinancialLogRecord` 内 `stepId?: string;` 之后加：

```ts
  kind: LogKind;
```

同文件 `SaveFile.version` 注释改为：

```ts
  version: number; // 存档格式版本：3=厂房权属/租赁快照，4=财务日志 flow/summary 分类
```

- [ ] **Step 4: 让编译器替你找齐 39 个产生点**

Run: `npx tsc --noEmit`
Expected: 一连串 `Property 'kind' is missing` 报错，逐个定位到 `enterpriseStore.ts` 的日志产生点与测试里的日志字面量。

规则（规格 §3.1 穷举结论）：**除 `quarterEndLog` 外全部写 `kind: 'flow'`**；`quarterEndLog`（`// 季度末日志记录 - 季度结束` 之下，模板 `第${newYear}年第${newQuarter}季度结束现金变动:`）写 `kind: 'summary'`。逐个补齐，包括：
- `initialState.operation.financialLogs` 里的 `初始现金` 种子（`flow`，`cashChange: 20` 是真实期初存入）；
- `nextQuarter` 内 `installPaymentLogs` / `startProductionLogs` / `yearEndLogs` 各 push；
- 三个不带 `stepId` 的产生点中，种子与 `quarterEndLog` 按上规则，`addFinancialLog` 走 Step 5 删除。

测试文件同理：`tests/controlTable.test.ts` 的 `mkLog` 默认 `kind: 'flow'`，并把 `kind` 设为可覆盖参数；`tests/factory.test.ts` 若有手写日志字面量同样补字段。

- [ ] **Step 5: 删除死 API**

`addFinancialLog`（约 `:452-474`，带约 `:289` 的类型声明）全仓零调用点（`grep -rn "addFinancialLog" src/` 只命中其定义与声明），整块删除，不为它加 `kind`。

- [ ] **Step 6: 修三处 newCash 逃逸回填**

现状：9 个站点写 `newCash: 0`，仅 `yearEndLogs` 的 6 个被回填块修复；`installPaymentLogs`、`startProductionLogs`、以及**在回填之后才 push** 的市场放弃警告三处逃逸。把回填改成按季内真实时序累计，并把警告前移：

```ts
      // 统一回填：先走季中日志（安装分期、自动开工），再走年末结算日志。
      // install/start 的 cashChange 合计恰为 -totalInstallPayments - autoProcessFees，
      // 故累计到它们之后再减 rdInvestment，与原初值等价。
      let runningCash = initialCash - shortSettlement.due - apPayment + cashIncrease - materialPayment;
      for (const log of [...installPaymentLogs, ...startProductionLogs]) {
        runningCash += log.cashChange;
        log.newCash = runningCash;
      }
      runningCash -= rdInvestment;
      for (const log of yearEndLogs) {
        runningCash += log.cashChange;
        log.newCash = runningCash;
      }
```

同时把市场放弃警告（`// 年末市场/ISO 年度结算` 下的 `yearEndLogs.push`）挪到上述回填**之前**完成构造与 push，使它与其它 `e-5` 日志一样被回填。删除原先只覆盖 `yearEndLogs` 的旧回填循环。

- [ ] **Step 7: 迁移与版本**

`migrateState` 内、生产线迁移之后插入旧档兜底（新代码一律显式写 `kind`，不依赖它）：

```ts
  state.operation.financialLogs.forEach(l => {
    if (!l.kind) {
      l.kind = (!l.stepId && (l.description || '').includes('季度结束现金变动')) ? 'summary' : 'flow';
    }
  });
```

两处 `version: 3,` 改为 `version: SAVE_FORMAT_VERSION,`（从 `../types/enterprise` 导入常量，别再写死数字）；`loadGame` 提示改为：

```ts
    get().addOperationLog('加载存档', saveFile.version >= SAVE_FORMAT_VERSION
      ? `加载存档：${saveFile.name}`
      : `加载存档：${saveFile.name}（旧版存档已迁移至v4，建议重置开新局）`);
```

顺手修正一处注释谎报：`allLogs.splice(6, 0, rdLog)` 上方注释写"插入到开工日志之后"，实际落在 `materialArrivalLog` 之后、开工日志之前，改成对现状的准确描述。

- [ ] **Step 8: 跑测试确认通过**

Run: `npx vitest run`
Expected: 全绿（含 3 例新用例）。若 `tests/controlTable.test.ts` / `tests/factory.test.ts` 因日志字面量缺 `kind` 失败，按 Step 4 的规则补齐——**不得**通过把 `kind` 改成可选字段来"修好"。

- [ ] **Step 9: 提交**

```bash
git add src/types/enterprise.ts src/store/enterpriseStore.ts tests/cashTrail.test.ts tests/controlTable.test.ts tests/factory.test.ts
git commit -m "feat(store): 财务日志增 flow/summary 分类，修复三处 newCash 占位，存档升至 v4"
```

---

## Task 2: 现金合计消费方改用字段过滤

**Files:**
- Modify: `src/utils/controlTable.ts`（`q-18` / `q-19` 分支，约 `:113-127`）
- Modify: `src/components/OperationCenter.tsx`（`calculateQuarterTotal` 约 `:429-443`；其文本排除约 `:402-415`）
- Test: `tests/cashTrail.test.ts`（追加）、`tests/controlTable.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 的 `FinancialLogRecord.kind`
- Produces: 「所有现金合计只加 `flow`」这一约束在两处消费方成立；后续审计任务沿用同一判据

- [ ] **Step 1: 写失败测试**

`tests/controlTable.test.ts` 追加（沿用该文件既有 `mkLog`/`rows` 助手）：

```ts
  it('q-18/q-19 只统计 flow：加入一条 summary 后单元格数值不变', () => {
    const without = rows(1, [
      mkLog({ quarter: 1, stepId: 'q-11', description: '收现', cashChange: 5 }),
      mkLog({ quarter: 1, stepId: 'q-16', description: '行政', cashChange: -1 }),
    ], []);
    const withSummary = rows(1, [
      mkLog({ quarter: 1, stepId: 'q-11', description: '收现', cashChange: 5 }),
      mkLog({ quarter: 1, stepId: 'q-16', description: '行政', cashChange: -1 }),
      mkLog({ quarter: 1, description: '第1年第1季度结束现金变动: 结余4M', cashChange: 4, kind: 'summary' }),
    ], []);
    const cell = (t: string[][], name: string) => t.find(r => r[1] === name)![2];
    expect(cell(withSummary, '入库（收入）数量合计')).toBe(cell(without, '入库（收入）数量合计'));
    expect(cell(withSummary, '出库（现金支出）合计')).toBe(cell(without, '出库（现金支出）合计'));
    expect(cell(without, '入库（收入）数量合计')).toBe('5M');
    expect(cell(without, '出库（现金支出）合计')).toBe('-1M');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/controlTable.test.ts`
Expected: FAIL —— `入库…` 单元格为 `9M`（5+4），证明 summary 被重复计入。

- [ ] **Step 3: 改导出器**

`q-18` 与 `q-19` 的过滤链各加一环，判据写在注释里：

```ts
          // 规格 §4.1：现金合计只取 flow，summary 是整季净额重述，计入即重复
          const income = yearLogs
            .filter((l) => l.quarter === q && l.kind === 'flow' && l.cashChange > 0)
            .reduce((s, l) => s + l.cashChange, 0);
```

```ts
          const expense = yearLogs
            .filter((l) => l.quarter === q && l.kind === 'flow' && l.cashChange < 0)
            .reduce((s, l) => s - l.cashChange, 0);
```

- [ ] **Step 4: 改页面合计并删死代码**

`calculateQuarterTotal` 的过滤同样加 `log.kind === 'flow'`；并删除那段永不命中的文本排除（`description.includes('季初现金盘点')` 等，约 `:402-415`）——`q-1` 的真实描述是 `(...)` 括号串，这个分支从来没起过作用，留着会误导后人。改为注释说明排除依据是 `kind`。

**同一文件的第二处死匹配（评审 S-T1 发现，本任务一并处理）**：`OperationCenter.tsx:203-205` 也有一处按 `季初现金盘点` 文本匹配的死分支。它今天 fall back 到 `cashFlowHistory` 的正确数字；**不要**为了"统一"而把它改成读 `q-1` 日志的 `newCash`——那个值是 `initialCash + cashIncrease`，不扣短贷本息与应付归还，会显示错数。正确做法是删掉死匹配、保留 `cashFlowHistory` 来源，并在注释里写明原因。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run`
Expected: 全绿。若既有断言原本就期望 summary 被计入（说明它编码了缺陷），按新规则更正该期望并在提交信息里说明——本任务允许改这种断言，但**不得**改金额断言的数值来迁就实现。

- [ ] **Step 6: 提交**

```bash
git add src/utils/controlTable.ts src/components/OperationCenter.tsx tests/controlTable.test.ts
git commit -m "fix(controlTable): 现金合计只取 flow 日志，页面季度合计同步修掉重复计与死排除"
```

---

## Task 3: 修重述串口径 + 账实重演算

**Files:**
- Modify: `src/store/enterpriseStore.ts`（`quarterEndLog` 的 `cashChange` 口径、`migrateState`）
- Create: `src/utils/audit.ts`
- Test: `tests/cashTrail.test.ts`（追加口径断言）、`tests/audit.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `kind`、`FinancialLogRecord`、`EnterpriseState`
- Produces: 新口径的 `summary.cashChange` = 自上一条重述串以来的**全部**净变动；类型 `AuditStatus` / `AuditCause` / `RestatementCaliber` / `FrameAudit`；函数 `auditFrame(save: SaveFile): FrameAudit`、`auditFrames(frames: SaveFile[]): FrameAudit[]`（按 `timestamp` 升序、不改动入参）、`firstDivergingFrame(results: FrameAudit[]): FrameAudit | null`、`auditSummary(results): { total; ok; mismatch; noAnchor; legacyMismatch }`（`legacyMismatch` = `mismatch` 里 `restatementCaliber !== 'v4'` 的条数：老档的"不符"与新档的"不符"必须能被分开说）、`CAUSE_TEXT`、`CALIBER_TEXT`（`RestatementCaliber` 三值的文案，后两条须言明"旧档可能存在未记账的现金变动，不符不等于篡改"）。`FrameAudit` 字段名固定为 `flowRebuilt` / `restatedRebuilt` / `actualCash` / `cause` / `restatementCaliber`，其中两个重建值类型为 `number | null`（`no-anchor` 用 `null`，不用 `NaN`——`NaN` 过 `JSON.stringify` 会变 `null`，让报告与面板读数失真）。`restatementCaliber` 三值语义与 UI 显示义务写在 `src/utils/audit.ts` 的字段注释里，S-T5/S-T7/S-T8 直接展示、不要再读 `SaveFile.version` 自行推断。S-T5/S-T7/S-T8 按此消费。

**为什么要多改这一处 store**（规格 §4.4 第四次更正）：原 `quarterEndLog.cashChange = finalCashChange` 只累加引擎自动项，不含玩家该季主动交易。实测一次带 180M 注资的 5 季存档：A 侧 202 = 现金 202 ✓，B 侧仅 22 ✗。B 式重建要成立，重述串必须先变成"整季全部净变动"。原计划以为"该字段没有别的消费方"，评审 I3 证伪——改口径前仍有两处读 `summary.cashChange`：`src/app/page.tsx` 的最近流水列表与 `src/components/OperationCenter.tsx` 的已完成步骤判定，两处均已按 `kind` 过滤/排除（现为 `src/app/page.tsx:335`、`src/components/OperationCenter.tsx:702`）后才允许口径变更落地。

- [ ] **Step 0: 写重述串口径的失败测试**

追加到 `tests/cashTrail.test.ts`：

```ts
  it('summary 的 cashChange 覆盖整季全部净变动（含玩家主动交易）', () => {
    store().registerOtherCashFlow('测试注资', 180);   // 玩家主动、引擎自动项之外的现金变动
    store().nextQuarter();
    const state = store().state;
    const summaries = state.operation.financialLogs.filter(l => l.kind === 'summary');
    expect(summaries).toHaveLength(1);
    // 该季真实净变动 = 期末现金 - 期初现金(20 + 180)
    expect(summaries[0].cashChange).toBe(state.finance.cash - 200);
  });
```

Run: `npx vitest run tests/cashTrail.test.ts`
Expected: FAIL —— 实得 `0`（引擎自动项本季净额）而期望 `180`，证明旧口径漏计玩家操作。

- [ ] **Step 0b: 改口径**

`quarterEndLog` 构造处（`enterpriseStore.ts:2743-2753` 一带）把 `cashChange: finalCashChange` 改为"期末现金 − 上一条重述串的期末现金"，并在同一处注释写明理由：

```ts
      // 重述串 = 自上一条重述串以来的全部净变动（含玩家主动交易），
      // 不能沿用 finalCashChange（只累加引擎自动项），否则 §4.4 的 B 式重建必然少算。
      restatedDelta: finalCash - previousRestatedCash,
```

`previousRestatedCash` 的取法（实现见 `enterpriseStore.ts` 推进季度那段，局部变量 `latestRestated`/`seedCash`/`previousRestatedCash`）：在本次 `nextQuarter` 开始时取 `state.state.operation.financialLogs` 中 `kind === 'summary'` 里**时间序上最近**（`timestamp` 最大）那条的 `newCash`；整串还没有 summary 时回退到 `初始现金` 那条 flow 的 `cashChange`（开局 20M）；连种子都被截断时退回本季期初现金 `initialCash`。实现为局部变量即可，不新增状态字段、不进存档。

`migrateState` 对 v3→v4 的处理不是"补一句注释"而是**就地换算**：旧档的 summary 值是旧口径（只含引擎自动项），载入时按自带的 `newCash` 链重建为新口径（`src/utils/restatement.ts` 的 `rebuildRestatedChain`，残缺到换不出即原样保留）。审计侧则由 `FrameAudit.restatementCaliber` 如实描述 B 侧读数的身份，S-T5/S-T7/S-T8 直接展示、不自行读 `version` 推断（评审 round 1 的 I1：降级判据必须待在审计器里，不能推给"未来的 UI 记得处理"）。不强制玩家重开一局。

Run: `npx vitest run`
Expected: 全绿（含 Step 0 新例）。若控制表或页面某格因此改动而变（`getQuarterEndCash` 读的是 `newCash`，不受影响），报告说明，不得回改口径。

- [ ] **Step 1: 写失败测试**

新建 `tests/audit.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { useEnterpriseStore, createFreshState } from '../src/store/enterpriseStore';
import { auditFrame, auditFrames, auditSummary, firstDivergingFrame } from '../src/utils/audit';
import { SAVE_FORMAT_VERSION, type SaveFile } from '../src/types/enterprise';

const store = () => useEnterpriseStore.getState();

beforeEach(() => {
  useEnterpriseStore.setState({ state: createFreshState(), validationError: null });
});

const frame = (id = 's1', mutate?: (s: ReturnType<typeof createFreshState>) => void): SaveFile => {
  const state = createFreshState();
  mutate?.(state);
  return { id, name: `帧${id}`, enterpriseName: '企业1', timestamp: 1, resetCount: 0, version: SAVE_FORMAT_VERSION, state, createdAt: 'x' };
};

describe('账实重演算（双重建）', () => {
  it('合法帧通过：两种重建都等于现金', () => {
    const r = auditFrame(frame());
    expect(r.status).toBe('ok');
    expect(r.flowRebuilt).toBe(20);
    expect(r.restatedRebuilt).toBe(20);
    expect(r.actualCash).toBe(20);
  });

  it('只改帧末现金：两种重建都不平，cause = both', () => {
    const r = auditFrame(frame('s1', (s) => { s.finance.cash += 30; }));
    expect(r.status).toBe('mismatch');
    expect(r.cause).toBe('both');
    expect(r.flowRebuilt).toBe(20);
    expect(r.actualCash).toBe(50);
  });

  it('只改一条 summary 重述串：A 成 B 败，cause = restated-log', () => {
    const r = auditFrame(frame('s1', (s) => {
      s.operation.financialLogs.push({
        id: 'sum1', year: 1, quarter: 1, timestamp: 2, description: '第1年第1季度结束现金变动: 结余20M',
        cashChange: -8, newCash: 12, operator: '系统自动', stepId: undefined, kind: 'summary',
      });
    }));
    expect(r.status).toBe('mismatch');
    expect(r.cause).toBe('restated-log');           // Σflow 仍等于现金，只有重述线被拉歪
  });

  it('缺初始现金种子时报 no-anchor 而非 mismatch', () => {
    const r = auditFrame(frame('s1', (s) => { s.operation.financialLogs = []; }));
    expect(r.status).toBe('no-anchor');
    expect(r.cause).toBeNull();
  });

  it('真跑 5 季：未篡改必须 ok，篡改一季流水后 cause = flow-log', () => {
    store().registerOtherCashFlow('测试注资', 180);   // 注入必须入账，否则 A/B 双双不平（规格 §2 勘误）
    for (let i = 0; i < 5; i++) store().nextQuarter();
    const state = store().state;

    const untouched = auditFrame({ ...frame('real'), state });
    expect(untouched.status).toBe('ok');             // 真实运行结果天然平账，这是本任务最重要的断言
    expect(untouched.flowRebuilt).toBe(untouched.actualCash);
    expect(untouched.restatedRebuilt).toBe(untouched.actualCash);

    const tampered = JSON.parse(JSON.stringify(state)) as typeof state;
    const target = tampered.operation.financialLogs.find(l => l.year === 1 && l.quarter === 3 && l.kind === 'flow');
    target!.cashChange += 7;
    const r = auditFrame({ ...frame('tampered'), state: tampered });
    expect(r.status).toBe('mismatch');
    expect(r.cause).toBe('flow-log');                // 重述线仍与现金吻合，只有流水被改
  });
});

describe('包内定位', () => {
  const stamped = (id: string, ts: number, cash: number): SaveFile =>
    ({ ...frame(id, (s) => { s.finance.cash = cash; }), timestamp: ts });

  it('最早不平的那一帧给出"自第X年第Y季起"的坐标', () => {
    const results = auditFrames([stamped('f3', 3, 99), frame('f1', (s) => { s.operation.currentQuarter = 1; }), stamped('f2', 2, 20)]);
    expect(results.map(r => r.saveId)).toEqual(['f1', 'f2', 'f3']);  // 输入乱序也要按时间升序返回
    expect(firstDivergingFrame(results)?.saveId).toBe('f3');
    expect(firstDivergingFrame(results)?.quarter).toBe(1);
    expect(auditSummary(results)).toEqual({ total: 3, ok: 2, mismatch: 1, noAnchor: 0 });
  });

  it('全部通过时 firstDivergingFrame 返回 null', () => {
    expect(firstDivergingFrame(auditFrames([frame('a'), frame('b')]))).toBeNull();
  });
});
```

> 上例用真引擎跑，因此会与本文件其它用例共享 store：`beforeEach` 已负责复位，不要再在例内手动 `setState` 初始帧。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/audit.test.ts`
Expected: FAIL —— `Cannot find module '../src/utils/audit'`。

- [ ] **Step 3: 实现**

新建 `src/utils/audit.ts`。**帧内不做季度级猜测定位**（规格 §4.4 已两次更正：按 `(year,quarter)` 分桶会因年末日志被 remap 到 `(收尾年,4)`、重述串落在 `(新年,新季)` 而错位；按数组顺序累计也不行，因为 `quarterEndLog` 在 `allLogs` 里排在年末结算日志**之前**，每条标记都会假不等）。改为两条独立重建 + 包内定位：

- **A：`Σ flow`（含 `初始现金` 种子）应等于该帧 `finance.cash`**
- **B：`初始现金 + Σ summary`（重述串即各次推进的净额）也应等于该帧 `finance.cash`**

A 成 B 败 → 重述串被改；A 败 B 成 → 流水条目被改；两者皆败 → 帧末现金被改；种子缺失 → `no-anchor`。季度定位交给**整包**：`auditFrames` 按 `timestamp` 升序找出**最早不平的那一帧**，报「自第X年第Y季起账实不符」——存档包本来就逐季携带快照（§4.2），这是最可靠也最好解释的定位来源。

```ts
// 账实重演算（规格 §4.4）：只依赖 flow/summary 分类，不用 newCash、不用密码学、不跨帧拼接
import type { EnterpriseState, FinancialLogRecord, SaveFile } from '../types/enterprise';

export type AuditStatus = 'ok' | 'mismatch' | 'no-anchor';
// 两种独立重建都不平时才落到 both；单侧失败可指名道姓
export type AuditCause = 'flow-log' | 'restated-log' | 'both';

export interface FrameAudit {
  saveId: string;
  saveName: string;
  year: number;
  quarter: number;
  flowRebuilt: number | null;      // A：Σ 全部 flow（含期初种子）
  restatedRebuilt: number | null;   // B：期初种子 + Σ 重述串 + 尾随流水
  actualCash: number;
  status: AuditStatus;
  cause: AuditCause | null;
}

const SEED_DESCRIPTION = '初始现金';
const isSeed = (l: FinancialLogRecord) => l.description === SEED_DESCRIPTION;
const sumBy = (logs: FinancialLogRecord[], pick: (l: FinancialLogRecord) => boolean) =>
  logs.filter(pick).reduce((t, l) => t + l.cashChange, 0);

export function auditFrame(save: SaveFile): FrameAudit {
  const logs = save.state.operation?.financialLogs ?? [];
  const base = {
    saveId: save.id,
    saveName: save.name,
    year: save.state.operation?.currentYear ?? 0,
    quarter: save.state.operation?.currentQuarter ?? 0,
    actualCash: save.state.finance.cash,
  };
  const seeds = logs.filter((l) => l.kind === 'flow' && l.description === SEED_DESCRIPTION);
  if (seeds.length === 0) {
    // 链条被截断时报「起算链不完整」而不是「账实不符」；用 null 不用 NaN（规格 §4.4）
    return { ...base, flowRebuilt: null, restatedRebuilt: null, status: 'no-anchor', cause: null };
  }

  const seedCash = sumBy(seeds, () => true);
  const flowRebuilt = sumBy(logs, (l) => l.kind === 'flow');
  // B 式：期初种子 + Σ重述串 + 晚于最新一条重述串的流水（季中手动存档留下的开尾缝隙）
  const summaries = logs.filter((l) => l.kind === 'summary');
  const latestRestatedAt = summaries.reduce((t, l) => Math.max(t, l.timestamp), 0);
  const tailFlows = summaries.length === 0
    ? seedCash
    : sumBy(logs, (l) => l.kind === 'flow' && !isSeed(l) && l.timestamp > latestRestatedAt);
  const restatedRebuilt = summaries.length === 0
    ? seedCash
    : seedCash + sumBy(summaries, () => true) + tailFlows;
  const aOk = flowRebuilt === base.actualCash;
  const bOk = restatedRebuilt === base.actualCash;

  if (aOk && bOk) return { ...base, flowRebuilt, restatedRebuilt, status: 'ok', cause: null };
  const cause: AuditCause = aOk ? 'restated-log' : bOk ? 'flow-log' : 'both';
  return { ...base, flowRebuilt, restatedRebuilt, status: 'mismatch', cause };
}

// 包内定位：按时间升序找最早不平的那一帧（规格 §4.4；帧自带逐季快照，这是唯一可靠的季度坐标）。
// no-anchor 也算"有问题的最早一帧"，但由调用方按 status 分述，不与账实不符混为一谈。
export const auditFrames = (frames: SaveFile[]): FrameAudit[] =>
  [...frames].sort((a, b) => a.timestamp - b.timestamp).map(auditFrame);

export const firstDivergingFrame = (results: FrameAudit[]): FrameAudit | null =>
  results.find((r) => r.status !== 'ok') ?? null;

export const auditSummary = (results: FrameAudit[]) => ({
  total: results.length,
  ok: results.filter((r) => r.status === 'ok').length,
  mismatch: results.filter((r) => r.status === 'mismatch').length,
  noAnchor: results.filter((r) => r.status === 'no-anchor').length,
});

// S-T7 预览与 S-T8 报告共用同一份措辞，避免两处各写一遍
export const CAUSE_TEXT: Record<AuditCause, string> = {
  'flow-log': '流水条目与现金不符',
  'restated-log': '季度重述串与现金不符',
  both: '帧末现金或期初条目被改',
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/audit.test.ts`
Expected: 7 例全过（本任务自己的 describe 5 例 + 包内定位 2 例）。三处需要重点核对：① "真跑 5 季未篡改"一例必须是 `ok`——若它是 `mismatch`，说明 S-T1 的 `kind` 分类或回填有漏，回到 S-T1 修，**不得**在此放过；② 篡改一季流水那例必须 `cause === 'flow-log'`（重述线仍吻合），若报成 `both` 说明 B 侧重建算错了种子；③ 只改 summary 那例必须 `cause === 'restated-log'`。

若报 `EnterpriseState` 未使用（TS 严格模式下的无用导入），删掉该导入即可，不要保留空导入。

- [ ] **Step 5: 提交**

```bash
git add src/utils/audit.ts tests/audit.test.ts
git commit -m "feat(audit): 账实重演算纯函数，手改现金或流水可定位"
```

---

## Task 4: 规范化序列化与哈希指纹

**Files:**
- Create: `src/utils/saveDigest.ts`
- Test: `tests/saveDigest.test.ts`（新建）

**Interfaces:**
- Consumes: `SaveFile`、`EnterpriseState`
- Produces: `canonicalStringify(value: unknown): string`、`digestText(text: string): Promise<string>`（返回 `sha256:<hex16>` 或 `unavailable:<原因>`）、`digestFrame(save: SaveFile): Promise<string>`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { canonicalStringify, digestFrame, digestText } from '../src/utils/saveDigest';

describe('规范化序列化', () => {
  it('键插入顺序不同但内容相同的对象，得到同一串', () => {
    expect(canonicalStringify({ a: 1, b: { x: 1, y: 2 } }))
      .toBe(canonicalStringify({ b: { y: 2, x: 1 }, a: 1 }));
  });

  it('undefined 字段被剔除，改一个数字则串变化', () => {
    expect(canonicalStringify({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalStringify({ finance: { cash: 20 } })).not.toBe(canonicalStringify({ finance: { cash: 21 } }));
  });
});

describe('哈希指纹', () => {
  it('返回 sha256: 前缀或明确的 unavailable 原因，绝不返回 null', async () => {
    const d = await digestText('hello');
    expect(typeof d).toBe('string');
    expect(/^(sha256:[0-9a-f]{16}|unavailable:.+)$/.test(d)).toBe(true);
  });

  it('同一存档两次计算结果一致；改现金后不同', async () => {
    const base = { id: 's', name: 'n', enterpriseName: '企业1', timestamp: 1, resetCount: 0, version: 4, createdAt: 'x',
      state: { finance: { cash: 20 } } } as never;
    const a = await digestFrame(base);
    const b = await digestFrame(base);
    const tampered = { ...base, state: { finance: { cash: 999 } } } as never;
    expect(a).toBe(b);
    if (a.startsWith('sha256:')) expect(await digestFrame(tampered)).not.toBe(a);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/saveDigest.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

```ts
// 规范化与哈希（规格 §4.4）：哈希只是指纹，不是防作弊结论
import type { SaveFile } from '../types/enterprise';

export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`).join(',')}}`;
}

export async function digestText(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return 'unavailable:insecure-context'; // 明确降级，绝不静默跳过（规格 §4.4）
  try {
    const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `sha256:${hex.slice(0, 16)}`;
  } catch (error) {
    return `unavailable:${error instanceof Error ? error.name.toLowerCase() : 'unknown'}`;
  }
}

// 逐帧指纹只覆盖内容字段，createdAt 等展示字段不参与，避免改名即"篡改"
export const digestFrame = (save: SaveFile): Promise<string> =>
  digestText(canonicalStringify({ id: save.id, timestamp: save.timestamp, version: save.version, resetCount: save.resetCount, state: save.state }));
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/saveDigest.test.ts`
Expected: 全过。Vitest 环境若无 `crypto.subtle`，用例会走 `unavailable` 分支——这恰好验证降级，不得为让哈希分支跑起来而伪造全局对象。

- [ ] **Step 5: 提交**

```bash
git add src/utils/saveDigest.ts tests/saveDigest.test.ts
git commit -m "feat(save): 规范化序列化与 SHA-256 指纹，非安全上下文显式降级"
```

---

## Task 5: 存档包结构、构建与导出

**Files:**
- Modify: `src/types/enterprise.ts`（新增 `SavePackage`）
- Create: `src/utils/savePackage.ts`
- Modify: `src/components/SaveLoadPanel.tsx`（导出按钮 + 异步态）
- Test: `tests/savePackage.test.ts`（新建）

**Interfaces:**
- Consumes: Task 3 的 `digestFrame` 所属模块、Task 4 的 `canonicalStringify`/`digestText`、store 的 `get()` 与 `getSaveFiles()`
- Produces: `SavePackage` 类型；`buildSavePackage(state: EnterpriseState, saves: SaveFile[]): Promise<SavePackage>`；`serializePackage(pkg: SavePackage): string`；`packageFileName(year: number, quarter: number, at?: Date): string`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { createFreshState } from '../src/store/enterpriseStore';
import { buildSavePackage, packageFileName, serializePackage } from '../src/utils/savePackage';
import type { SaveFile } from '../src/types/enterprise';

describe('存档包', () => {
  it('包结构含 current 与 saves，且序列化不带 BOM', async () => {
    const state = createFreshState();
    const saves: SaveFile[] = [{ id: 's1', name: 'n', enterpriseName: '企业1', timestamp: 1, resetCount: 0, version: 4, state, createdAt: 'x' }];
    const pkg = await buildSavePackage(state, saves);
    expect(pkg.format).toBe('ie-sandbox-save');
    expect(pkg.packageVersion).toBe(1);
    expect(pkg.saves).toHaveLength(1);
    expect(pkg.current).toBe(state);
    expect(pkg.digests.frames['s1']).toMatch(/^(sha256:[0-9a-f]{16}|unavailable:.+)$/);
    expect(pkg.digests.package).toMatch(/^(sha256:[0-9a-f]{16}|unavailable:.+)$/);
    expect(serializePackage(pkg).charCodeAt(0)).not.toBe(0xFEFF);
  });

  it('文件名含年月季与时间戳', () => {
    expect(packageFileName(2, 4, new Date('2026-10-04T18:30:00'))).toBe('企业1存档-第2年第4季-202610041830.json');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/savePackage.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 类型**

`src/types/enterprise.ts` 末尾追加：

```ts
// 存档包（规格 §4.2）：一帧当前状态 + 全部历史快照 + 指纹
export interface SavePackage {
  format: 'ie-sandbox-save';
  packageVersion: 1;
  exportedAt: string;
  app: { saveVersion: number; year: number; quarter: number };
  current: EnterpriseState;
  saves: SaveFile[];
  digests: { package: string; frames: Record<string, string> };
}
```

- [ ] **Step 4: 实现**

```ts
import type { EnterpriseState, SaveFile, SavePackage } from '../types/enterprise';
import { canonicalStringify, digestFrame, digestText } from './saveDigest';

const pad = (n: number) => String(n).padStart(2, '0');

export function packageFileName(year: number, quarter: number, at: Date = new Date()): string {
  return `企业1存档-第${year}年第${quarter}季-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}${pad(at.getHours())}${pad(at.getMinutes())}.json`;
}

export async function buildSavePackage(state: EnterpriseState, saves: SaveFile[]): Promise<SavePackage> {
  const date = new Date();
  const frames: Record<string, string> = {};
  for (const save of saves) frames[save.id] = await digestFrame(save);

  const shell: Omit<SavePackage, 'digests'> = {
    format: 'ie-sandbox-save',
    packageVersion: 1,
    exportedAt: date.toISOString(),
    app: { saveVersion: SAVE_FORMAT_VERSION, year: state.operation.currentYear, quarter: state.operation.currentQuarter },
    current: state,
    saves,
  };
  // 整包指纹不含 digests 自身，否则自指（规格 §4.4）
  const packageDigest = await digestText(canonicalStringify(shell));
  return { ...shell, digests: { package: packageDigest, frames } };
}

export const serializePackage = (pkg: SavePackage): string => JSON.stringify(pkg, null, 2);
```

- [ ] **Step 5: 导出按钮**

`SaveLoadPanel.tsx` 在「手动存档 / 重置游戏」那一行（约 `:76-89`）之后加第三个按钮，处理器新增本地态 `exporting`：

```tsx
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const pkg = await buildSavePackage(state, getSaveFiles());
      // 复用控制表导出同一套写法；JSON 不加 BOM（规格 §4.2）
      const url = URL.createObjectURL(new Blob([serializePackage(pkg)], { type: 'application/json;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = packageFileName(pkg.app.year, pkg.app.quarter);
      a.click();
      URL.revokeObjectURL(url);
      addOperationLog('导出存档', `存档包：${a.download}`);
    } catch (error) {
      setValidationError(`导出失败：${error instanceof Error ? error.name : '未知错误'}`);
    } finally {
      setExporting(false);
    }
  };
```

按钮 `disabled={exporting}`、文案 `{exporting ? '导出中…' : '导出存档包'}`，并加 `title="下载含全部历史快照与指纹的 JSON 文件，可在其它浏览器导入"`。导出是只读动作，**不加 `isPaused` 拦截**（规格 §7.10）。从 store 多解构 `addOperationLog` 与 `setValidationError`。

- [ ] **Step 6: 跑测试 + 类型 + 构建**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: 全绿；构建仅 3 条既有基线警告。

- [ ] **Step 7: 提交**

```bash
git add src/types/enterprise.ts src/utils/savePackage.ts src/components/SaveLoadPanel.tsx tests/savePackage.test.ts
git commit -m "feat(save): 存档包结构与构建导出，含逐帧与整包指纹"
```

---

## Task 6: 导入解析与结构校验

**Files:**
- Modify: `src/utils/savePackage.ts`（追加 `parseSavePackage`）
- Test: `tests/savePackage.test.ts`（追加）

**Interfaces:**
- Consumes: `SavePackage`、`SaveFile`
- Produces: `type PackageParseResult = { ok: true; pkg: SavePackage } | { ok: false; reason: string }`、`parseSavePackage(text: string): Promise<PackageParseResult>`

- [ ] **Step 1: 写失败测试**

```ts
import { parseSavePackage } from '../src/utils/savePackage';

const validPackage = async () => {
  const state = createFreshState();
  return serializePackage(await buildSavePackage(state, []));
};

describe('存档包解析', () => {
  it('非 JSON 文本被拒绝并说明原因', async () => {
    expect(await parseSavePackage('not json')).toEqual({ ok: false, reason: '文件不是有效 JSON' });
  });

  it('格式标识与包版本必须匹配', async () => {
    const r = await parseSavePackage(JSON.stringify({ format: 'other', packageVersion: 1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('不是本系统的存档包');
  });

  it('缺 current 五域之一时指出字段名而不是静默迁移', async () => {
    const text = await validPackage();
    const broken = JSON.parse(text);
    delete broken.current.logistics;
    const r = await parseSavePackage(JSON.stringify(broken));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('current.logistics');
  });

  it('负现金与越界季度被拒绝', async () => {
    const text = await validPackage();
    const neg = JSON.parse(text); neg.current.finance.cash = -5;
    expect((await parseSavePackage(JSON.stringify(neg))).ok).toBe(false);
    const badQ = JSON.parse(text); badQ.current.operation.currentQuarter = 9;
    expect((await parseSavePackage(JSON.stringify(badQ))).ok).toBe(false);
  });

  it('saves 非数组被拒绝；空数组合法', async () => {
    const text = await validPackage();
    const bad = JSON.parse(text); bad.saves = 'x';
    expect((await parseSavePackage(JSON.stringify(bad))).ok).toBe(false);
    expect((await parseSavePackage(text)).ok).toBe(true);
  });

  it('超 8MB 直接拒绝', async () => {
    const r = await parseSavePackage('{"a":"' + 'x'.repeat(9 * 1024 * 1024) + '"}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('超过 8MB');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/savePackage.test.ts`
Expected: FAIL —— `parseSavePackage` 未导出。

- [ ] **Step 3: 实现**

追加到 `src/utils/savePackage.ts`。校验只做"能不能安全地当成状态用"，不做业务判断：

```ts
const MAX_PACKAGE_BYTES = 8 * 1024 * 1024;
const STATE_DOMAINS = ['finance', 'production', 'logistics', 'marketing', 'operation'] as const;

export type PackageParseResult = { ok: true; pkg: SavePackage } | { ok: false; reason: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export async function parseSavePackage(text: string): Promise<PackageParseResult> {
  if (text.length > MAX_PACKAGE_BYTES) return { ok: false, reason: `文件过大（超过 8MB），不是合法存档包` };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: '文件不是有效 JSON' };
  }
  if (!isRecord(parsed)) return { ok: false, reason: '顶层结构不是对象' };
  if (parsed.format !== 'ie-sandbox-save' || parsed.packageVersion !== 1) {
    return { ok: false, reason: '不是本系统的存档包（format/packageVersion 不匹配）' };
  }
  if (!Array.isArray(parsed.saves)) return { ok: false, reason: 'saves 必须是数组' };
  if (!isRecord(parsed.current)) return { ok: false, reason: 'current 缺失或不是对象' };

  for (const domain of STATE_DOMAINS) {
    if (!isRecord(parsed.current[domain])) return { ok: false, reason: `current.${domain} 缺失或类型错误` };
  }
  const shapeProblem = stateShapeProblem('current', parsed.current);
  if (shapeProblem) return { ok: false, reason: shapeProblem };

  // **同一套校验也必须逐帧跑在 saves 上**（评审 round-3 new finding #2）：Task 5 从 localStorage 导出的就是这些原始帧、
  // Task 7 审计与 Task 8 报告印的也是它们。只查 current 会让 `saves[i].finance.cash = 1e999`（`JSON.parse` 得到 Infinity）
  // 或越界年季直接进面板与报告，而审计对 Infinity 现金会平法判 `ok`（报告 H8.2）。
  for (let i = 0; i < (parsed.saves as unknown[]).length; i++) {
    const frame = (parsed.saves as unknown[])[i];
    if (!isRecord(frame)) return { ok: false, reason: `saves[${i}] 不是对象` };
    if (typeof frame.id !== 'string' || typeof frame.name !== 'string') {
      return { ok: false, reason: `saves[${i}] 缺 id/name 或类型错误` };
    }
    if (typeof frame.timestamp !== 'number' || !Number.isFinite(frame.timestamp)) {
      return { ok: false, reason: `saves[${i}].timestamp 必须是有限数字` };
    }
    if (typeof frame.version !== 'number' || !Number.isInteger(frame.version) || frame.version < 0) {
      // version 是审计口径判定的唯一依据（restatementCaliber / migrateState 的 fromVersion 都读它），缺失或非整数即拒
      return { ok: false, reason: `saves[${i}].version 必须是非负整数，实际为 ${JSON.stringify(frame.version)}` };
    }
    if (!isRecord(frame.state)) return { ok: false, reason: `saves[${i}].state 缺失或不是对象` };
    for (const domain of STATE_DOMAINS) {
      if (!isRecord((frame.state as Record<string, unknown>)[domain])) {
        return { ok: false, reason: `saves[${i}].state.${domain} 缺失或类型错误` };
      }
    }
    const frameProblem = stateShapeProblem(`saves[${i}]`, frame.state as Record<string, unknown>);
    if (frameProblem) return { ok: false, reason: frameProblem };
  }
  return { ok: true, pkg: parsed as unknown as SavePackage };
}
```

`stateShapeProblem(label, state)` 就是把原来针对 `current` 的四条字段校验（`finance.cash` 非负整数、`accountsReceivable` 4 个非负整数、`operation.currentYear ∈ 1..5`、`currentQuarter ∈ 1..4`）抽成一个函数，**消息里的前缀用传入的 `label`**——不复制第二份判据，`current` 与每一帧共用同一条规则：

```ts
const stateShapeProblem = (label: string, state: Record<string, unknown>): string | null => {
  const fin = state.finance as Record<string, unknown>;
  if (typeof fin.cash !== 'number' || !Number.isInteger(fin.cash) || fin.cash < 0) {
    return `${label}.finance.cash 必须是非负整数，实际为 ${JSON.stringify(fin.cash)}`;
  }
  if (!Array.isArray(fin.accountsReceivable) || fin.accountsReceivable.length !== 4
    || !fin.accountsReceivable.every((v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0)) {
    return `${label}.finance.accountsReceivable 必须是 4 个非负整数`;
  }
  const op = state.operation as Record<string, unknown>;
  if (typeof op.currentYear !== 'number' || op.currentYear < 1 || op.currentYear > 5) {
    return `${label}.operation.currentYear 越界：${JSON.stringify(op.currentYear)}`;
  }
  if (typeof op.currentQuarter !== 'number' || op.currentQuarter < 1 || op.currentQuarter > 4) {
    return `${label}.operation.currentQuarter 越界：${JSON.stringify(op.currentQuarter)}`;
  }
  return null;
};
```

Step 1 的测试里再补一条（放在「saves 非数组被拒绝」之后）：

```ts
  it('saves 某一帧现金为 Infinity 或 version 缺失时被拒，原因点名是哪一帧', async () => {
    // validPackage() 的 saves 是空数组，这里自己塞一帧进去（帧的形状照 Task 5 的 SaveFile）
    const frameOf = () => ({
      id: 'f1', name: '帧1', enterpriseName: '企业1', timestamp: 1, resetCount: 0, version: 4,
      createdAt: 'x', state: JSON.parse(JSON.stringify(createFreshState())),
    });
    const pkgWith = async (mutate: (pkg: any) => void) => {
      const pkg = JSON.parse(await validPackage());
      pkg.saves = [frameOf()];
      mutate(pkg);
      return JSON.stringify(pkg);
    };

    const r1 = await parseSavePackage(await pkgWith((pkg) => { pkg.saves[0].state.finance.cash = 1e999; }));
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toContain('saves[0].finance.cash');

    const r2 = await parseSavePackage(await pkgWith((pkg) => { delete pkg.saves[0].version; }));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toContain('saves[0].version');
  });
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/savePackage.test.ts`
Expected: 全过。若"超 8MB"一例慢，说明测试构造本身太大，改为断言 `text.length` 分支而非真实 9MB 字符串——**不得**删掉该用例。

- [ ] **Step 5: 提交**

```bash
git add src/utils/savePackage.ts tests/savePackage.test.ts
git commit -m "feat(save): 存档包解析与结构校验，畸形输入点名拒绝"
```

---

## Task 7: 预览面板与非覆盖落库

**Files:**
- Modify: `src/store/enterpriseStore.ts`（`importSaveFiles`、`applyImportedState` 两个 action）
- Modify: `src/components/SaveLoadPanel.tsx`（文件入口、预览面板、两个动作）
- Test: `tests/saveImport.test.ts`（新建）

**Interfaces:**
- Consumes: Task 3 `auditFrames`/`auditSummary`（含 `legacyMismatch`）/`CAUSE_TEXT`/`CALIBER_TEXT`/`FrameAudit.restatementCaliber`、Task 4 `digestFrame`、Task 5 `SavePackage`、Task 6 `parseSavePackage`
- Produces: store 上 `importSaveFiles(saves: SaveFile[]): { added: number; renamed: number }`、`applyImportedState(state: EnterpriseState, fromVersion: number): void`

- [ ] **Step 1: 写失败测试**

新建 `tests/saveImport.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { useEnterpriseStore, createFreshState } from '../src/store/enterpriseStore';
import type { SaveFile } from '../src/types/enterprise';

const store = () => useEnterpriseStore.getState();
const frame = (id: string, cash: number): SaveFile => ({
  id, name: `帧${id}`, enterpriseName: '企业1', timestamp: 1, resetCount: 0, version: 4, createdAt: 'x',
  state: { ...createFreshState(), finance: { ...createFreshState().finance, cash } },
});

beforeEach(() => {
  useEnterpriseStore.setState({ state: createFreshState(), validationError: null });
  localStorage.removeItem('enterpriseSaveFiles');
});

describe('导入落库语义（默认不覆盖）', () => {
  it('首次导入原样加入', () => {
    const r = store().importSaveFiles([frame('s1', 100)]);
    expect(r).toEqual({ added: 1, renamed: 0 });
    expect(store().getSaveFiles()).toHaveLength(1);
  });

  it('同 id 重复导入改名追加，原条目内容不变', () => {
    store().importSaveFiles([frame('s1', 100)]);
    const r = store().importSaveFiles([frame('s1', 999)]);
    expect(r).toEqual({ added: 1, renamed: 1 });
    const files = store().getSaveFiles();
    expect(files).toHaveLength(2);
    expect(files.some(f => f.id === 's1' && f.state.finance.cash === 100)).toBe(true);
    expect(files.some(f => f.id === 's1-imported-1' && f.state.finance.cash === 999)).toBe(true);
  });

  it('applyImportedState 只换当前屏，不写存档列表', () => {
    store().applyImportedState(frame('s1', 77).state, 4);
    expect(store().state.finance.cash).toBe(77);
    expect(store().getSaveFiles()).toHaveLength(0);
  });

  it('暂停时 importSaveFiles 被拒绝且状态零变化', () => {
    store().togglePaused();
    const before = store().getSaveFiles().length;
    store().importSaveFiles([frame('s1', 100)]);
    expect(store().validationError).toContain('暂停');
    expect(store().getSaveFiles()).toHaveLength(before);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/saveImport.test.ts`
Expected: FAIL —— `store().importSaveFiles is not a function`。

- [ ] **Step 3: store actions**

类型声明区加：

```ts
  importSaveFiles: (saves: SaveFile[]) => { added: number; renamed: number };
  applyImportedState: (state: EnterpriseState, fromVersion: number) => void;
```

实现（放在 `loadGame` 之后）：

```ts
  importSaveFiles: (saves) => {
    if (get().state.isPaused) {
      set({ validationError: '运营已暂停，请先继续运营再导入' });
      return { added: 0, renamed: 0 };
    }
    const existing = get().getSaveFiles();
    const taken = new Set(existing.map((f) => f.id));
    let renamed = 0;
    const toAdd = saves.map((save) => {
      if (!taken.has(save.id)) { taken.add(save.id); return { ...save, state: migrateState(save.state, save.version) }; }
      let n = 1;
      while (taken.has(`${save.id}-imported-${n}`)) n++;
      const id = `${save.id}-imported-${n}`;
      taken.add(id);
      renamed++;
      return { ...save, id, state: migrateState(save.state, save.version) };
    });
    const merged = [...toAdd, ...existing];
    localStorage.setItem('enterpriseSaveFiles', JSON.stringify(merged));
    set({ saveFiles: merged });
    get().addOperationLog('导入存档', `新增 ${toAdd.length} 份（其中改名追加 ${renamed} 份），未覆盖任何原有存档`);
    return { added: toAdd.length, renamed };
  },

  applyImportedState: (imported, fromVersion) => {
    if (get().state.isPaused) {
      set({ validationError: '运营已暂停，请先继续运营再导入' });
      return;
    }
    set({ state: migrateState(imported, fromVersion) });
    get().addOperationLog('导入存档', `设为当前进度：第${imported.operation.currentYear}年第${imported.operation.currentQuarter}季`);
  },
```

`migrateState` 目前是模块私有函数、在这两个 action 内可直接引用；若跨作用域不可见，则把 `const migrateState = ...` 前加 `export`（不新建包装、不复制逻辑）。

它的签名是 Task 3 第二轮评审定下的 `migrateState(state, fromVersion)`（`fromVersion: number | undefined`）——旧档的**重述串口径换算**必须知道原存档版本才能决定要不要重建（见 `src/utils/restatement.ts`），所以本任务不能像原计划那样只传 state：`importSaveFiles` 从每帧自带的 `save.version` 取，`applyImportedState` 由调用方把 `pkg.app.saveVersion` 传进来。签名以 store 里的实际定义为准，不要改回去。

- [ ] **Step 4: UI 编排**

`CALIBER_TEXT` 由 Task 3 与 `CAUSE_TEXT` 并列提供（见本任务 Interfaces 的 Produces），本任务**直接 import、不再新建**：

```ts
// src/utils/audit.ts 已有（Task 3）：与 RestatementCaliber 三值一一对应，后两条须言明
// "旧档可能存在未记账的现金变动，不符不等于篡改"（评审 round-3 new finding #1）。
export const CALIBER_TEXT: Record<RestatementCaliber, string> = {
  'v4': '重述串为新口径，可作金额证据',
  'legacy-converted': '旧档（version<4）：重述串已换算，判定只依据流水',
  'legacy-unconverted': '旧档（version<4）：判定只依据流水；该版本可能存在未记账的现金变动，"不符"不等于篡改',
};
```

若 Task 3 落地的文案与上面不一致，**以 `src/utils/audit.ts` 为准**并在报告里说明差异——判据与文案都只许住一处。

`SaveLoadPanel.tsx` 加：

```tsx
// 面板顶部 import：文案表与判据同源（Task 3 的 audit.ts），UI 只照抄，
// 绝不再自行读 SaveFile.version 推断（一条规则写两处就是版本漂移的起点）
import { auditFrames, auditSummary, CAUSE_TEXT, CALIBER_TEXT, firstDivergingFrame } from '../utils/audit';
import type { FrameAudit } from '../utils/audit';
```

组件内加：

```tsx
  const [pending, setPending] = useState<{
    pkg: SavePackage;
    summary: ReturnType<typeof auditSummary>;
    mismatches: string[];
    digestMismatch: string[];
    diverging: FrameAudit | null;
    caliberNotes: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFilePicked = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setPending(null);
    try {
      const parsed = await parseSavePackage(await file.text());
      if (!parsed.ok) { setValidationError(parsed.reason); return; }
      const pkg = parsed.pkg;
      const frames = pkg.saves.length > 0 ? pkg.saves : [{ id: 'current', name: '当前进度', enterpriseName: '企业1', timestamp: Date.now(), resetCount: 0, version: pkg.app.saveVersion, state: pkg.current, createdAt: pkg.exportedAt }];
      const results = auditFrames(frames);
      const mismatches = results.filter(r => r.status !== 'ok')
        .map(r => r.status === 'no-anchor'
          // no-anchor 不附口径文案：那一档说的是"B 侧读数的身份"，而这一帧两侧都没算成，
          // 附上「重述串为新口径，可作金额证据」会变成自相矛盾的印面（评审 round-3 new finding #3）
          ? `${r.saveName}：起算链不完整（缺期初现金种子），本帧现金 ${r.actualCash}M`
          : `${r.saveName}（第${r.year}年第${r.quarter}季）：账实不符（${CAUSE_TEXT[r.cause ?? 'both']}），本帧现金 ${r.actualCash}M；${CALIBER_TEXT[r.restatementCaliber]}`);
      // 包内定位：第一处不平的帧才是"分歧起点"，其余帧的不平是它的下游后果（Task 3 定的判据）
      const diverging = firstDivergingFrame(results);
      const digestMismatch: string[] = [];
      for (const save of frames) {
        const declared = pkg.digests.frames[save.id];
        if (!declared || !declared.startsWith('sha256:')) continue;
        if (await digestFrame(save) !== declared) digestMismatch.push(`${save.name} 的指纹与包内记录不一致`);
      }
      const caliberNotes = [...new Set(results.map(r => CALIBER_TEXT[r.restatementCaliber]))];
      setPending({ pkg, summary: auditSummary(results), mismatches, digestMismatch, diverging, caliberNotes });
    } finally {
      setBusy(false);
    }
  };
```

预览面板（`pending` 非空时渲染，此时**未改动任何状态**）显示：帧数与时间跨度、当前帧 `第Y年第Q季 / 现金 / 应收合计 / 长短期贷款本金合计 / 重置次数`、`mismatches`（红字，**不阻断**）、`digestMismatch`、`diverging`（非 null 时一行「分歧始于：X（第Y年第Q季）」，null 时「未发现账实分歧」）、`caliberNotes`（灰字小字，逐条列出包内出现过的 B 侧读数身份）。两个动作按钮：

- 「仅加入存档列表」（默认样式）→ `const r = importSaveFiles(pkg.saves)` → `setValidationError(null)` + 关闭面板；暂停时 `disabled` 并给可见说明。
- 「设为当前进度」→ `applyImportedState(pkg.current, pkg.app.saveVersion)` → 关闭面板；同样受暂停门控。
- 「取消」→ `setPending(null)`，不产生任何写操作。

文件入口用 `<input type="file" accept="application/json" className="hidden" onChange={e => handleFilePicked(e.target.files?.[0])} />` + 一个「导入存档包」按钮触发 `click()`；该入口只读，暂停时可用。

- [ ] **Step 5: 跑测试 + 类型 + 构建**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: 全绿。

- [ ] **Step 6: 手工冒烟（逐条记录实际所见，不接受推断）**

1. 导出一份存档包 → 同一浏览器删掉 localStorage 后用该文件导入 → 列表恢复、进度可用。
2. 连导两次同一文件 → 第二次出现 `s1-imported-1`，第一次的内容逐字不变。
3. 用文本编辑器把某帧 `finance.cash` 改 +30 → 导入预览红字报"账实不符"并指出季度，但仍允许导入。
4. 改一个字段名使 JSON 非法 / 删掉 `current.logistics` → 各自报出明确原因，当前屏与 localStorage 不变。
5. 暂停态下导出与预览可用，两个写动作按钮禁用且有可见说明。
6. 截图存入 `.superpowers/` 或临时目录并在报告里给路径；若无法截图，明确标注 NOT VERIFIED。

- [ ] **Step 7: 提交**

```bash
git add src/store/enterpriseStore.ts src/components/SaveLoadPanel.tsx tests/saveImport.test.ts
git commit -m "feat(save): 存档包导入预览与非覆盖落库，暂停态只读豁免"
```

---

## Task 8: 核对报告导出

**Files:**
- Modify: `src/utils/audit.ts`（新增 `buildAuditReport`，与 `FrameAudit` 同域，不分新文件）
- Modify: `src/components/SaveLoadPanel.tsx`
- Test: `tests/audit.test.ts`（追加报告文本断言）

**Interfaces:**
- Consumes: `FrameAudit`、`CAUSE_TEXT`、`CALIBER_TEXT`、`firstDivergingFrame`、`auditSummary`（含 `legacyMismatch`）、`SavePackage`、既有 Blob 下载写法
- Produces: `buildAuditReport(pkg: SavePackage, results: FrameAudit[], boundaryLine: string): { json: string; text: string }`

- [ ] **Step 1: 写失败测试**

```ts
import { buildAuditReport } from '../src/utils/audit';

  it('报告首行是能力边界声明，且逐帧结论都在文本里', () => {
    const boundary = '完整性校验用于发现误操作与随手改数，不构成防作弊保证；成绩判定以运行控制表与实践报告为准。';
    const pkg = { format: 'ie-sandbox-save', packageVersion: 1 as const, exportedAt: '2026-10-04T00:00:00.000Z',
      app: { saveVersion: 4, year: 1, quarter: 1 }, current: createFreshState(), saves: [],
      digests: { package: 'sha256:deadbeef00001111', frames: {} } };
    const { text, json } = buildAuditReport(pkg, [auditFrame(frame())], boundary);
    expect(text.split('\n')[0]).toBe(boundary);
    expect(text).toContain('帧s1');
    // 新档帧：统计行必须把"旧档判定"单列出来（评审 round-3 new finding #1 的印面验收）
    expect(text).toContain('其中旧档 version<4 的判定 0 条');
    expect(text).toContain('重述串为新口径');
    expect(JSON.parse(json).boundary).toBe(boundary);
    expect(JSON.parse(json).packageDigest).toBe('sha256:deadbeef00001111');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/audit.test.ts`
Expected: FAIL —— `buildAuditReport` 未导出。

- [ ] **Step 3: 实现**

```ts
export function buildAuditReport(
  pkg: SavePackage,
  results: FrameAudit[],
  boundaryLine: string,
): { json: string; text: string } {
  const summary = auditSummary(results);
  const diverging = firstDivergingFrame(results);
  // no-anchor 帧不附口径文案（理由见 Task 7 的 mismatches 映射处）
  const caliberNote = (r: FrameAudit) => (r.status === 'no-anchor' ? '' : `；${CALIBER_TEXT[r.restatementCaliber]}`);
  const lines = [
    boundaryLine,
    '',
    `导出时间：${pkg.exportedAt}`,
    `包指纹：${pkg.digests.package}`,
    `帧统计：共 ${summary.total}，通过 ${summary.ok}，不符 ${summary.mismatch}（其中旧档 version<4 的判定 ${summary.legacyMismatch} 条，其"不符"不等于篡改），起算链不完整 ${summary.noAnchor}`,
    `分歧起点：${diverging
      ? `${diverging.restatementCaliber !== 'v4' ? '（该帧 version<4，先排除历史版本缺日志再谈篡改）' : ''}${diverging.saveName}（第${diverging.year}年第${diverging.quarter}季）`
      : '未发现账实分歧'}`,
    '',
    ...results.map((r) => r.status === 'ok'
      ? `[通过] ${r.saveName}（第${r.year}年第${r.quarter}季，现金 ${r.actualCash}M${caliberNote(r)}）`
      : `[${r.status === 'no-anchor' ? '起算链不完整' : `账实不符（${CAUSE_TEXT[r.cause ?? 'both']}）`}] ${r.saveName}（第${r.year}年第${r.quarter}季，按流水重建 ${r.flowRebuilt}M，按重述串重建 ${r.restatedRebuilt}M，帧内现金 ${r.actualCash}M${caliberNote(r)}）`),
  ];
  return {
    text: lines.join('\n'),
    json: JSON.stringify({ boundary: boundaryLine, exportedAt: pkg.exportedAt, packageDigest: pkg.digests.package, summary, frames: results }, null, 2),
  };
}
```

放 `src/utils/audit.ts`（与 `FrameAudit` 同域），在文件顶部补 `import type { SavePackage } from '../types/enterprise';`。

- [ ] **Step 4: 面板接线**

预览面板加「导出核对报告」按钮，一次点击产 `.txt`，`.json` 通过同一数据源的第二按钮；两者都走既有 Blob 写法（`.txt` 无需 BOM，`.json` 明确不加）。按钮为只读动作，不受暂停影响。

- [ ] **Step 5: 跑测试 + 构建**

Run: `npx vitest run && npm run build`
Expected: 全绿。

- [ ] **Step 6: 提交**

```bash
git add src/utils/audit.ts src/components/SaveLoadPanel.tsx tests/audit.test.ts
git commit -m "feat(save): 核对报告导出（txt/json），与面板共用同一数据源"
```

---

## Task 9: 能力边界文案与文档校正

**Files:**
- Modify: `src/components/RulesModal.tsx`
- Modify: `README.md`
- Modify: `docs/roadmap.md`

**Interfaces:**
- Consumes: 已实现的全部行为（文案不得描述未实现的能力）
- Produces: 三处一致的能力边界句式

- [ ] **Step 1: 规则弹窗**

在 `RULE_SECTIONS` 里新增一节（放在「融资与资金管理」之后）：

```ts
  {
    title: '存档与完整性校验',
    highlight: true,
    items: [
      '存档包：一个 JSON 文件，含当前进度与全部历史快照，可在另一台电脑/浏览器导入继续运营。',
      '导入默认不覆盖：同 id 的存档会改名追加（形如 -imported-1），并先给预览再让你二选一。',
      '账实重演算：用每帧自带的现金流水独立推算现金余额，手改余额或改流水都会报出所在季度。',
      '包指纹：导出时对规范化 JSON 计算 SHA-256（非 HTTPS 环境下会明确标注"未计算"），仅作篡改指纹。',
      '完整性校验用于发现误操作与随手改数，不构成防作弊保证；成绩判定以运行控制表与实践报告为准。',
    ],
  },
```

- [ ] **Step 2: README**

- 核心功能节补一行：`- **存档流转**：存档包导出/导入（默认不覆盖、先预览）、账实重演算核对、核对报告导出`
- 使用说明节把原先那句"跨设备请使用系统内导出的存档/CSV 文件"改为具体路径：`存档管理 → 导出存档包`，并写明 JSON 不带 BOM、可用 `parseSavePackage` 同规则的脚本读取。
- 新增一小节「完整性校验的能力边界」，逐字用 Step 1 第 5 条那句。
- 测试用例数按实测更新（在**工作树内**跑 `npx vitest run` 取真实数字并注明命令）。

- [ ] **Step 3: roadmap 校正（它现在含一条被实测推翻的判断）**

`docs/roadmap.md` §3 P0 中的 IndexedDB 建议改为实测结论：单帧 4.1–34.3KB、16 份存档合计 0.54MB，配额无压力，故该条作废；同时把 §5.7 的 `loadGame` 版本雷标记为"已在 v4 处理为 `>= 4`"。

- [ ] **Step 4: 校验文案与代码一致**

逐条比对 Step 1 的四行与实际行为：改名后缀字符串（`-imported-1`）、非安全上下文的措辞（`unavailable:insecure-context` 对应的用户可见文字）、重演算报错句式（与 `SaveLoadPanel` 里的 `账实不符…流水推算…快照…` 一致）。

Run: `npx vitest run && npm run build`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add src/components/RulesModal.tsx README.md docs/roadmap.md
git commit -m "docs: 补存档与完整性校验说明并写清能力边界，校正 roadmap 实测结论"
```

---

## 完成标准

- `npx vitest run`（在工作树内）全绿，新增覆盖：不变量回归、三处 `newCash` 逃逸、`q-18`/`q-19` 与页面季度合计不受 summary 影响、重演算五种状态、规范化与哈希降级、包结构、解析六种拒绝、导入非覆盖与暂停门控、报告文本首行。
- `npx tsc --noEmit` 与 `npm run build` 通过，无新增警告。
- 一个真实导出的存档包能在另一浏览器导入并恢复进度；改 `cash` 一位数字会被预览报出季度级不符；`crypto.subtle` 缺失时指纹显示"未计算"而非失败。
- 无任何存档被静默覆盖（测试 6.2 是可执行证明）。
- `directions/` 未被改动；未新增依赖；三处能力边界文案逐字一致。
