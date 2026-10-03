# 企业1专属版重启开发 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 按规格 `docs/superpowers/specs/2026-08-28-erp-sandbox-restart-design.md` 补全企业1专属版规则（贷款生命周期/贴现/折旧/税金/加工费/年度化开拓与ISO/研发分期/订单池）、修复跨年 bug、重做运行控制表按年导出、补 UI（规则弹窗/暂停/贴现）。

**架构：** 规则计算抽为纯函数 `src/utils/rules.ts`（可测），订单池配置 `src/config/marketDemand.ts`，控制表导出纯函数 `src/utils/controlTable.ts`。`enterpriseStore.ts` 保持唯一 Zustand store，调用上述纯函数；财务日志加 `stepId` 标签供控制表推导。

**技术栈：** Next.js 14 / React 18 / TypeScript / Zustand / vitest（新增 devDependency）。

**验证命令：** `npm test`（vitest run）、`npm run build`。

---

## 文件结构

| 文件 | 职责 | 动作 |
|------|------|------|
| `src/utils/rules.ts` | 纯规则函数：绝对季度、BOM/成本、折旧、贴现、贷款结算、税金 | 创建 |
| `src/config/marketDemand.ts` | 年×市场×产品订单池配置与确定性生成 | 创建 |
| `src/utils/controlTable.ts` | 控制表步骤常量 + 行/单元格推导 + CSV | 创建 |
| `src/types/enterprise.ts` | LoanRecord/AnnualLedger/stepId/版本等类型扩展 | 修改 |
| `src/store/enterpriseStore.ts` | 全部 action 与 nextQuarter 改造 | 修改 |
| `src/components/OperationCenter.tsx` | 步骤表文案、按年导出按钮 | 修改 |
| `src/components/MarketingCenter.tsx` | P1/P2 收窄、Q4 投资窗口、订单选择校验 | 修改 |
| `src/components/ProductionCenter.tsx` | P3/P4 研发入口删除 | 修改 |
| `src/components/RulesModal.tsx` | 规则说明弹窗 | 创建 |
| `src/components/DiscountPanel.tsx` | 贴现面板 | 创建 |
| `src/app/page.tsx` | 弹窗/暂停入口、贴现面板挂载、应付税真实数据 | 修改 |
| `tests/*.test.ts` | vitest 测试 | 创建 |
| `package.json` | vitest + test script；移除 redux 残留 | 修改 |
| `README.md` | 移除暂停横幅、技术栈事实校正 | 修改 |

---

### 任务 1：规则纯函数 + vitest 就绪

**文件：** 创建 `src/utils/rules.ts`、`tests/rules.test.ts`；修改 `package.json`。

- [ ] 步骤 1：安装 vitest 并加 script：`npm i -D vitest`；`package.json` scripts 加 `"test": "vitest run"`。

- [ ] 步骤 2：编写 `src/utils/rules.ts`：

```ts
export type ProductId = 'P1' | 'P2' | 'P3' | 'P4';
export type MaterialId = 'R1' | 'R2' | 'R3' | 'R4';

export const absQuarter = (year: number, quarter: number) => (year - 1) * 4 + quarter;
export const fromAbsQuarter = (abs: number) => ({
  year: Math.floor((abs - 1) / 4) + 1,
  quarter: ((abs - 1) % 4) + 1,
});

export const PRODUCT_BOM: Record<ProductId, Partial<Record<MaterialId, number>>> = {
  P1: { R1: 1 }, P2: { R1: 1, R2: 1 },
  P3: { R2: 2, R3: 1 }, P4: { R2: 1, R3: 1, R4: 2 },
};
export const PROCESS_FEE = 1;
export const unitCost = (p: ProductId) =>
  Object.entries(PRODUCT_BOM[p]).reduce((s, [, q]) => s + (q as number), 0) + PROCESS_FEE; // P1=2, P2=3

// 折旧：当年建成不提；净值>=3M 提 floor(净值/3)；否则 1M
export const depreciationFor = (netValue: number, builtInYear: number, currentYear: number) => {
  if (builtInYear >= currentYear) return 0;
  return netValue >= 3 ? Math.floor(netValue / 3) : 1;
};

// 贴现：金额为7的倍数，7M 付 1M 贴息
export const DISCOUNT_UNIT = 7;
export const isValidDiscount = (amount: number, receivable: number) =>
  amount > 0 && amount % DISCOUNT_UNIT === 0 && amount <= receivable;
export const discountSplit = (amount: number) => ({ fee: amount / 7, cash: amount - amount / 7 });

export interface LoanLike { kind: 'long' | 'short'; principal: number; rate: number; drawnAbs: number; termQuarters: number; }
// 年末长贷结算：付息、期限递减、到期还本
export const settleLongLoansAtYearEnd = (loans: LoanLike[]) => {
  let interest = 0, principalRepaid = 0;
  const survivors = loans.map(l => {
    interest += l.principal * l.rate;
    const remaining = l.termQuarters - 4;
    if (remaining <= 0) { principalRepaid += l.principal; return null; }
    return { ...l, termQuarters: remaining };
  }).filter((l): l is LoanLike => l !== null);
  return { interest, principalRepaid, survivors };
};
// 季初短贷到期结算
export const settleDueShortLoans = (loans: LoanLike[], absNow: number) => {
  let due = 0;
  const survivors = loans.filter(l => {
    if (l.kind === 'short' && absNow === l.drawnAbs + l.termQuarters) { due += l.principal * (1 + l.rate); return false; }
    return true;
  });
  return { due, survivors };
};
// 利润表与税金
export interface Ledger { salesRevenue: number; directCosts: number; adminFee: number; adFee: number; marketDevFee: number; rdFee: number; isoFee: number; conversionFee: number; maintenanceFee: number; rentFee: number; otherFee: number; depreciation: number; interestExpense: number; discountFee: number; extraExpense: number; }
export const emptyLedger = (): Ledger => ({ salesRevenue: 0, directCosts: 0, adminFee: 0, adFee: 0, marketDevFee: 0, rdFee: 0, isoFee: 0, conversionFee: 0, maintenanceFee: 0, rentFee: 0, otherFee: 0, depreciation: 0, interestExpense: 0, discountFee: 0, extraExpense: 0 });
export const totalExpense = (l: Ledger) => l.adminFee + l.adFee + l.marketDevFee + l.rdFee + l.isoFee + l.conversionFee + l.maintenanceFee + l.rentFee + l.otherFee;
export const incomeStatement = (l: Ledger) => {
  const grossProfit = l.salesRevenue - l.directCosts;
  const beforeDepreciation = grossProfit - totalExpense(l);
  const beforeInterest = beforeDepreciation - l.depreciation;
  const pretax = beforeInterest - l.interestExpense - l.discountFee - l.extraExpense;
  const tax = Math.floor(Math.max(0, pretax) * 0.25);
  return { grossProfit, beforeDepreciation, beforeInterest, pretax, tax, net: pretax - tax };
};
export const TAX_RATE = 0.25;
```

- [ ] 步骤 3：编写 `tests/rules.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { absQuarter, fromAbsQuarter, unitCost, depreciationFor, isValidDiscount, discountSplit, settleLongLoansAtYearEnd, settleDueShortLoans, incomeStatement, emptyLedger } from '../src/utils/rules';

describe('季度索引', () => {
  it('跨年换算', () => {
    expect(absQuarter(1, 1)).toBe(1);
    expect(absQuarter(1, 4)).toBe(4);
    expect(absQuarter(2, 1)).toBe(5);
    expect(fromAbsQuarter(5)).toEqual({ year: 2, quarter: 1 });
    expect(fromAbsQuarter(7)).toEqual({ year: 2, quarter: 3 });
  });
});
describe('成本与折旧', () => {
  it('单位成本 P1=2 P2=3', () => {
    expect(unitCost('P1')).toBe(2);
    expect(unitCost('P2')).toBe(3);
  });
  it('折旧规则', () => {
    expect(depreciationFor(13, 0, 1)).toBe(4);   // floor(13/3)
    expect(depreciationFor(13, 1, 1)).toBe(0);   // 当年建成
    expect(depreciationFor(2, 0, 5)).toBe(1);    // 净值<3M
    expect(depreciationFor(3, 0, 5)).toBe(1);
  });
});
describe('贴现', () => {
  it('7 的倍数校验', () => {
    expect(isValidDiscount(7, 15)).toBe(true);
    expect(isValidDiscount(8, 15)).toBe(false);
    expect(isValidDiscount(14, 10)).toBe(false);
  });
  it('7M 贴 1M 到 6M', () => expect(discountSplit(7)).toEqual({ fee: 1, cash: 6 }));
});
describe('贷款结算', () => {
  it('长贷 3 年：3 次付息后还本', () => {
    const loan = { kind: 'long' as const, principal: 20, rate: 0.1, drawnAbs: 4, termQuarters: 12 };
    const y1 = settleLongLoansAtYearEnd([loan]);
    expect(y1).toMatchObject({ interest: 2, principalRepaid: 0 });
    const y2 = settleLongLoansAtYearEnd(y1.survivors);
    expect(y2.principalRepaid).toBe(0);
    const y3 = settleLongLoansAtYearEnd(y2.survivors);
    expect(y3).toMatchObject({ interest: 2, principalRepaid: 20 });
    expect(y3.survivors).toHaveLength(0);
  });
  it('短贷到期一次还本付息', () => {
    const loan = { kind: 'short' as const, principal: 20, rate: 0.05, drawnAbs: 1, termQuarters: 4 };
    expect(settleDueShortLoans([loan], 4).due).toBe(0);
    expect(settleDueShortLoans([loan], 5).due).toBe(21);
  });
});
describe('利润表', () => {
  it('课程初始示例：收入35 成本12 综合费用11 折旧4 财务4 → 税前4 税1 净3', () => {
    const l = { ...emptyLedger(), salesRevenue: 35, directCosts: 12, adminFee: 11, depreciation: 4, interestExpense: 4 };
    const r = incomeStatement(l);
    expect(r.pretax).toBe(4);
    expect(r.tax).toBe(1);
    expect(r.net).toBe(3);
  });
  it('亏损年税为 0', () => {
    const r = incomeStatement({ ...emptyLedger(), salesRevenue: 5, directCosts: 8 });
    expect(r.tax).toBe(0);
  });
});
```

- [ ] 步骤 4：`npm test` 全绿。

- [ ] 步骤 5：Commit：`git add -A && git commit -m "feat(rules): 规则纯函数与vitest基座"`

---

### 任务 2：订单池配置

**文件：** 创建 `src/config/marketDemand.ts`、`tests/marketDemand.test.ts`。

- [ ] 步骤 1：配置与生成器（确定性，种子=年×10+市场序号；每 1M 广告解锁 2 张订单）：

```ts
import { absQuarter } from '../utils/rules';

export interface DemandEntry {
  market: 'local' | 'regional' | 'domestic' | 'asian' | 'international';
  product: 'P1' | 'P2';
  // 第1~4年可生成订单数（拟定量，教师可按课程数据修改）
  ordersByYear: [number, number, number, number];
  unitPrice: [number, number]; // 单价区间（M）
  quantityRange: [number, number];
}

export const MARKET_DEMAND: DemandEntry[] = [
  { market: 'local', product: 'P1', ordersByYear: [4, 5, 5, 4], unitPrice: [4, 6], quantityRange: [2, 5] },
  { market: 'local', product: 'P2', ordersByYear: [0, 3, 4, 4], unitPrice: [6, 8], quantityRange: [1, 4] },
  { market: 'regional', product: 'P1', ordersByYear: [2, 3, 3, 3], unitPrice: [4, 6], quantityRange: [1, 4] },
  { market: 'regional', product: 'P2', ordersByYear: [0, 2, 3, 3], unitPrice: [6, 8], quantityRange: [1, 3] },
  { market: 'domestic', product: 'P1', ordersByYear: [0, 1, 2, 2], unitPrice: [5, 7], quantityRange: [2, 4] },
  { market: 'domestic', product: 'P2', ordersByYear: [0, 1, 2, 2], unitPrice: [7, 9], quantityRange: [1, 3] },
];

const lcg = (seed: number) => () => (seed = (seed * 48271) % 2147483647) / 2147483647;

export interface GeneratedOrder {
  productType: 'P1' | 'P2';
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  paymentPeriod: number; // 1~4 季账期
  market: string;
}

export function generateYearOrders(year: 1 | 2 | 3 | 4, availableMarkets: string[], qualifiedProducts: string[], adAmount: number): GeneratedOrder[] {
  const rand = lcg(year * 97 + 13);
  const pool: GeneratedOrder[] = [];
  for (const entry of MARKET_DEMAND) {
    if (!availableMarkets.includes(entry.market) || !qualifiedProducts.includes(entry.product)) continue;
    const count = entry.ordersByYear[year - 1];
    for (let i = 0; i < count; i++) {
      const quantity = entry.quantityRange[0] + Math.floor(rand() * (entry.quantityRange[1] - entry.quantityRange[0] + 1));
      const unitPrice = entry.unitPrice[0] + Math.floor(rand() * (entry.unitPrice[1] - entry.unitPrice[0] + 1));
      const paymentPeriod = 1 + Math.floor(rand() * 4);
      pool.push({ productType: entry.product, quantity, unitPrice, totalAmount: quantity * unitPrice, paymentPeriod, market: entry.market });
    }
  }
  // 订单按总额降序，广告解锁：每 1M 解锁 2 张
  pool.sort((a, b) => b.totalAmount - a.totalAmount);
  return pool.slice(0, Math.min(pool.length, adAmount * 2));
}
```

- [ ] 步骤 2：测试 `tests/marketDemand.test.ts`：同参数两次生成结果 deep-equal（确定性）；`adAmount=0` 返回空；第 1 年只有本地 P1（`qualifiedProducts=['P1']`、`availableMarkets=['local']`）。

- [ ] 步骤 3：`npm test` 全绿 → Commit `feat(market): 可配置订单池生成器`。

---

### 任务 3：类型扩展 + 存档 v2

**文件：** 修改 `src/types/enterprise.ts`、`src/store/enterpriseStore.ts`（initialState 与 loadGame 迁移部分）。

- [ ] 步骤 1：types 增加（不动现有字段，贷款聚合字段暂时并存）：

```ts
import { LoanLike, Ledger } from '../utils/rules'; // 概念示意：实际把接口定义放 types 内

export interface LoanRecord { id: string; kind: 'long' | 'short'; principal: number; rate: number; drawnAbs: number; termQuarters: number; }
export interface AnnualLedger { /* 与 rules.Ledger 同构 */ }
// FinancialLogRecord 增加:
stepId?: string; // 'b-1'..'b-4' | 'q-1'..'q-20' | 'e-1'..'e-6'
// FinanceData 增加:
loans: LoanRecord[];
// OperationData 增加:
annualLedger: AnnualLedger;
yearlyLedgers: Record<number, AnnualLedger>;
yearlyIncomeStatements: Record<number, ReturnType<typeof incomeStatement>>; // 结构见任务5
isPaused: boolean; // 放 EnterpriseState 顶层（不入存档亦可，放顶层 state 外——见步骤2）
// Market 增加: yearsInvested: number; investedThisYear: boolean;
// ISOCertification 增加: yearsInvested: number; investedThisYear: boolean;
// productRD.P2 增加: status: 'idle'|'active'|'completed'; paidQuarters: number;
// ProductionLine 增加: netValue: number; builtInYear: number; soldThisYear?: boolean;
// RawMaterialOrder.orderPeriod/arrivalPeriod 注释改为绝对季度索引
// SaveFile 增加: version: number;
```

- [ ] 步骤 2：`EnterpriseState` 增加 `isPaused: boolean`；store 顶层（set 状态外）存运行时暂停标志亦可——采用入 state（随存档保存，简单一致）。

- [ ] 步骤 3：`initialState` 补新字段默认值：`loans: []`、长贷 40M 迁移为一笔 `{ kind:'long', principal:40, rate:0.1, drawnAbs: absQuarter(0,4) /*上上年年末*/, termQuarters: 12 }`（注：初始长期负债 40M 视为已存续贷款，第 1 年年末开始付息）；`annualLedger: emptyLedger()`、`yearlyLedgers: {}`；生产线初始 `netValue`：自动线 16-折旧…初始设备总值 13M（两条自动线：大厂房线净值 13M 总计——按单线 `netValue=6.5`？**取整原则：netValue 以整数 M 记账，两线各 7 与 6**，builtInYear=0）；R1 原料 3 个、在制品 4 个等保持现有值。`isPaused: false`。

- [ ] 步骤 4：`loadGame` 迁移：`saveFile.state` 无 `finance.loans` 时构造（legacy longTermLoan.amount→一笔 long 贷款，drawnAbs=当前绝对季度，term=12）；`rawMaterialOrders[].arrivalPeriod` 若 ≤4 且 orderPeriod ≤4（旧格式），换算 `absQuarter(state 当前年, arrivalPeriod)` 近似 + 提示；`SaveFile.version ?? 1` 判断。加载后 `addOperationLog('存档迁移', '旧版存档已迁移至v2，建议重置开新局')`。

- [ ] 步骤 5：`npm run build` 通过（类型不破坏现有引用）→ Commit `feat(types): 贷款台账/年度台账/stepId类型与存档v2迁移`。

---

### 任务 4：贷款重做（长贷年末、短贷季初窗口与到期）

**文件：** 修改 `enterpriseStore.ts`（applyLongTermLoan、applyShortTermLoan、nextQuarter）、创建 `tests/loans.test.ts`。

- [ ] 步骤 1：失败测试（store 级，helper `createStore()` 导出 fresh store）：

```ts
// tests/loans.test.ts 要点
// 长贷：非 Q4 申请 → 状态不变；Q4 申请 → cash+20, loans 增一笔, 聚合 amount=60
// 年末推进三次 → 每次付息 6M（40M×10% + 20M×10%），第三次还本 20M 到期贷款消失
// 短贷：Q2/Q4 申请被拒；Q1 申请 → cash+20；推进 4 个季度后在 q-2 结算 cash-21
```

- [ ] 步骤 2：`applyLongTermLoan()` 改造：Q4 校验；`loans.filter(long).reduce(principal) + 20 <= 40` 校验；push `{ id, kind:'long', principal:20, rate:0.1, drawnAbs: absQuarter(year,4), termQuarters:12 }`；cash+20；日志 `stepId:'e-1'`。

- [ ] 步骤 3：`applyShortTermLoan()` 改造：签名加 `() => void`（金额固定 20）；仅 Q1/Q3；上限 40M 同理；`termQuarters: 4`；日志 `stepId:'q-3'`（申请短货行）。

- [ ] 步骤 4：`nextQuarter` 开头（进入新季度后、盘点前）加短贷到期结算：`settleDueShortLoans(state.finance.loans, absQuarter(newYear,newQuarter))`，到期即扣现金、移出台账，日志 `stepId:'q-2'` 文案 `+0,-21M(短贷还本付息)`；现金不足时仍结算（现金可为负？——**规则校验：拒绝进入下一季度并提示"现金不足以偿还到期短贷，请先贴现"**，`validationError` 返回不推进）。

- [ ] 步骤 5：年末（`currentQuarter===4` 分支）加长贷结算：`settleLongLoansAtYearEnd`，付息+还本扣现金，日志 `stepId:'e-1'`；删除旧"Q1 计长贷利息/每季短贷利息"逻辑（2010-2019 行区域）。

- [ ] 步骤 6：利息计入 `annualLedger.interestExpense`。测试通过 → Commit `feat(finance): 长短贷台账化与还本付息生命周期`。

---

### 任务 5：贴现 + 应付款简化

**文件：** `enterpriseStore.ts`、`tests/discount.test.ts`。

- [ ] 步骤 1：失败测试：应收 [7,0,0,0] 时 `discountReceivable(7)` → cash+6、AR[0]=0、`annualLedger.discountFee=1`、日志 `stepId:'q-11'`；`discountReceivable(8)` 拒绝。

- [ ] 步骤 2：实现 action `discountReceivable(amount: number)`：`isValidDiscount(amount, AR[0]+AR[1]+AR[2]+AR[3])`（允许贴现未到期部分——贴现对象为应收款总额，从最早账期开始扣减）；按 `discountSplit` 更新现金与 AR 数组；写日志。

- [ ] 步骤 3：通过 → Commit `feat(finance): 应收账款贴现7:1`。

---

### 任务 6：折旧 + 年度台账 + 税金 + 年初交税

**文件：** `enterpriseStore.ts`（nextQuarter 年末序列、deliverOrder、各费用 action 累计台账）、`tests/tax.test.ts`。

- [ ] 步骤 1：失败测试要点：一年运营（交货 P1×3=收入、年末）后 `yearlyIncomeStatements[1].tax` 正确；第 2 年 Q1 `payTaxes()` 后 cash 减、`taxesPayable=0`、日志 `stepId:'b-4'`；折旧：安装完成次年计提 floor(净值/3)，`netValue` 扣减，`ledger.depreciation` 累计。

- [ ] 步骤 2：累计台账：`deliverOrder` → `salesRevenue += totalAmount`、出库时 `directCosts += unitCost×数量`；广告 → `adFee`；市场/ISO 投资 → `marketDevFee/isoFee`；研发 → `rdFee`；转产费 → `conversionFee`；行政费 → `adminFee`；维护费 → `maintenanceFee`；租金 → `rentFee`；贴现 → `discountFee`；利息 → `interestExpense`。

- [ ] 步骤 3：年末序列（`currentQuarter===4`，在长贷结算后）依序：
  1. 维护费（对 `builtInYear < currentYear && !soldThisYear` 的线各 1M，`stepId:'e-2'`）；
  2. 租金：小厂房 3M（`stepId:'e-3'`）；
  3. 折旧：`depreciationFor(line.netValue, line.builtInYear, currentYear)`，`netValue -= 折旧`，`ledger.depreciation += 折旧`（非现金，`stepId:'e-4'` 日志 cashChange=0）；
  4. `incomeStatement(ledger)` → `taxesPayable += tax`、`retainedProfit += net`、`annualNetProfit = net`；`yearlyIncomeStatements[year]` 与 `yearlyLedgers[year]` 归档；
  5. 已准入市场 `investedThisYear===false` → 丧失准入（`stepId:'e-5'` 警告日志）；
  6. 结账日志（`stepId:'e-6'`）。
- [ ] 步骤 4：新 Q1 不再自动扣税；新 action `payTaxes()`（仅 Q1、`taxesPayable>0`）：现金支付、清零、日志 `stepId:'b-4'`。删除现行 Q4 自动扣税块（2031-2041 行区域）与 `annualNetProfit` 简单清零逻辑（改为台账归档后清零）。

- [ ] 步骤 5：通过 → Commit `feat(finance): 折旧/年度利润表/所得税下年初交纳`。

---

### 任务 7：加工费 + 研发分期（P2 专用）+ P1/P2 收窄

**文件：** `enterpriseStore.ts`（startProduction、investProductR_D、nextQuarter 研发段、placeRawMaterialOrder）、`ProductionCenter.tsx`、`tests/production.test.ts`。

- [ ] 步骤 1：失败测试要点：`startProduction` 后 cash-1、原料 R1-1（P2 再-1 R2）、在制品 1、日志 `stepId:'q-10'` `-1M(P1,全自动)`；缺原料拒绝；研发 P2 启动扣 1M，之后每季度自动扣 1M、第 6 季完成 `completed=true`；现金不足 1M 时该季跳过（中断），现金恢复后续季自动续。

- [ ] 步骤 2：`startProduction(lineId)`：BOM 校验（`PRODUCT_BOM`）+ 现金 ≥1；扣原料/现金；`inProgressProducts=1`；日志。`nextQuarter` 内"开始下一批生产"分支同样扣 1M 加工费与原料（现有代码只扣原料），现金不足则不启动。

- [ ] 步骤 3：`investProductR_D('P2')`：toggle active/idle，启动付 1M；`nextQuarter` 研发段改为：P2 active 且现金 ≥1 → 付 1M、`paidQuarters+1`、`totalInvestment+1`；`paidQuarters>=6` → completed、获资格；现金不足 → 保持 active 但跳过（operationLog 提示"研发资金中断"）。P3/P4 段删除（nextQuarter 循环仅 'P2'）。

- [ ] 步骤 4：`ProductionCenter.tsx` 研发区只渲染 P2；`convertProductionLine`、订单表单产品选项收窄 P1/P2（任务 9 一并处理 UI）。完工入库日志（`stepId:'q-7'`）追加 `-2M(P1,全自动)` 式成本注记（非现金）。

- [ ] 步骤 5：通过 → Commit `feat(production): 加工费扣现与P2研发分期`。

---

### 任务 8：市场开拓/ISO 年度模型 + Q4 窗口 + 维持

**文件：** `enterpriseStore.ts`（investMarketDevelopment、investISOCertification、nextQuarter 进度段删除）、`tests/markets.test.ts`。

- [ ] 步骤 1：失败测试要点：非 Q4 投资被拒；Q4 投区域 1M → `yearsInvested=1 ≥ 1` → 立即 available；国内需投两年；ISO9000 两年、14000 三年；已准入市场当年未投 → 年末转 unavailable + 警告日志；投 1M 维持则保留。

- [ ] 步骤 2：`investMarketDevelopment(type)`：仅 Q4；`investedThisYear` 防重复；扣 1M；`yearsInvested+1`；developing 且 `yearsInvested>=requiredYears(区域1/国内2/亚洲3/国际4)` → available；已 available 则仅标记维持。requiredYears 常量 `MARKET_DEVELOP_YEARS = { local:0, regional:1, domestic:2, asian:3, international:4 }`。日志 `stepId:'e-5'` `-1M(区域市场)`。
- [ ] 步骤 3：`investISOCertification`：仅 Q4、每年 1M、`ISO_REQUIRED_YEARS = { ISO9000:2, ISO14000:3 }`，完成即 certified。日志 `stepId:'e-5'` `-1M(ISO9000)`。
- [ ] 步骤 4：删除 `nextQuarter` 中市场/ISO 季度自动推进段（2105-2137 行区域）；本地市场初始 available 且每年也需维持（初始年豁免：第 1 年不检查）。

- [ ] 步骤 5：通过 → Commit `feat(marketing): 市场/ISO年度投资模型与维持规则`。

---

### 任务 9：原料到货绝对索引 + 到货付款 + selectOrder 修复

**文件：** `enterpriseStore.ts`（placeRawMaterialOrder、nextQuarter 到货段 1648-1675）、`tests/logistics.test.ts`。

- [ ] 步骤 1：失败测试要点：第 1 年 Q3 下单 R1（leadTime 1）→ 绝对索引 7，第 2 年 Q1（abs 5）不到货、Q3（abs 7）到货；到货时按 `quantity×price` 扣现金（不足则计入 `accountsPayable`，日志说明）、`stepId:'q-5'`。

- [ ] 步骤 2：`placeRawMaterialOrder`：`arrivalAbs = absQuarter(year, quarter) + leadTime` 存储；`orderPeriod` 同为绝对索引。
- [ ] 步骤 3：`nextQuarter` 到货过滤改 `order.arrivalAbs === absQuarter(newYear,newQuarter)`；付款：现金够则扣（日志 `stepId:'q-5'` `-3M(R1入库)`），不足则 `accountsPayable += 金额`。
- [ ] 步骤 4：`selectOrder` 与 `moveOrderToSelected` 合并：`selectOrder` 从 available 移除后加入 selected（保留两个方法名，内部同一实现，`moveOrderToSelected` 调 `selectOrder` 逻辑）；已交付订单不可再选。

- [ ] 步骤 5：通过 → Commit `fix(logistics): 原料到货跨年索引与入库付款`。

---

### 任务 10：订单池接入 + 广告窗口

**文件：** `enterpriseStore.ts`（generateOrders action、placeAdvertisement 校验、selectOrder 校验）、`MarketingCenter.tsx`、`tests/orders.test.ts`。

- [ ] 步骤 1：失败测试要点：第 2 年 Q1、已投广告 2M → 生成订单 ≤4 张且只含已准入市场×有资格产品；未投广告时 `selectOrder` 拒绝并提示"请先投放广告"；非 Q1 投广告拒绝。

- [ ] 步骤 2：`enterOrderMeeting()`（Q1 手动触发，按钮"参加订货会"，`stepId:'b-2'` 日志）：调用 `generateYearOrders(year, availableMarkets, ['P1', ...P2 资格?], 年度广告额)` 填充 `availableOrders`（清旧）。广告额取当年 `advertisements` 中 `period===year && quarter===1` 合计；未投广告可先生成 0 张，投广告后可再次点击刷新订单。
- [ ] 步骤 3：`placeAdvertisement`：仅 Q1；日志 `stepId:'q-17'` `-XM(广告费)`；台账 `adFee += X`。
- [ ] 步骤 4：`MarketingCenter.tsx`：广告区标注"年初（第1季度）投放"；订货会按钮；订单列表只显示 P1/P2。

- [ ] 步骤 5：通过 → Commit `feat(marketing): 年度订单池与广告投放窗口`。

---

### 任务 11：stepId 全面打标 + 控制表按年导出

**文件：** 创建 `src/utils/controlTable.ts`、`tests/controlTable.test.ts`；修改 `enterpriseStore.ts`（存量日志补 stepId）、`OperationCenter.tsx`。

- [ ] 步骤 1：`src/utils/controlTable.ts`：

```ts
import { FinancialLogRecord, SaveFile } from '@/types/enterprise';

export const CONTROL_STEPS: { id: string; name: string; phase: '年初' | '季度' | '年末' }[] = [
  { id: 'b-1', name: '新年度规划会议', phase: '年初' },
  { id: 'b-2', name: '参加订货会/登记销售订单', phase: '年初' },
  { id: 'b-3', name: '制定新年度计划', phase: '年初' },
  { id: 'b-4', name: '支付应付税', phase: '年初' },
  { id: 'q-1', name: '季初现金盘点（请填写库存数量）', phase: '季度' },
  { id: 'q-2', name: '更新短贷/还本付息', phase: '季度' },
  { id: 'q-3', name: '申请短期贷款', phase: '季度' },
  { id: 'q-4', name: '更新应付账款/归还应付账款', phase: '季度' },
  { id: 'q-5', name: '原材料入库/更新原材料单', phase: '季度' },
  { id: 'q-6', name: '下原料订单', phase: '季度' },
  { id: 'q-7', name: '更新生产/完工入库', phase: '季度' },
  { id: 'q-8', name: '投资新生产线/变卖生产线/生产线转产', phase: '季度' },
  { id: 'q-9', name: '（本项目未启用）', phase: '季度' },
  { id: 'q-10', name: '开始下一批生产', phase: '季度' },
  { id: 'q-11', name: '更新应收账款/应收账款收现', phase: '季度' },
  { id: 'q-12', name: '出售厂房', phase: '季度' },
  { id: 'q-13', name: '（本项目未启用）', phase: '季度' },
  { id: 'q-14', name: '按订单交货', phase: '季度' },
  { id: 'q-15', name: '产品研发投资', phase: '季度' },
  { id: 'q-16', name: '支付行政管理费', phase: '季度' },
  { id: 'q-17', name: '其他现金收支情况登记', phase: '季度' },
  { id: 'q-18', name: '入库（收入）数量合计', phase: '季度' },
  { id: 'q-19', name: '出库（现金支出）合计', phase: '季度' },
  { id: 'q-20', name: '本季库存（现金）结余数量', phase: '季度' },
  { id: 'e-1', name: '支付利息/更新长期贷款/申请长期贷款', phase: '年末' },
  { id: 'e-2', name: '支付设备维护费', phase: '年末' },
  { id: 'e-3', name: '支付租金/购买厂房', phase: '年末' },
  { id: 'e-4', name: '计提折旧', phase: '年末' },
  { id: 'e-5', name: '新市场开拓/ISO资格认证投资', phase: '年末' },
  { id: 'e-6', name: '结账', phase: '年末' },
];

export function buildYearControlTable(
  year: number,
  logs: FinancialLogRecord[],
  saves: SaveFile[],
): string[][] {
  // 行 = [序号, 操作名称, Q1, Q2, Q3, Q4]
  // 单元格：该年该季该 stepId 的日志按 timestamp 排序，cashChange !== 0 取 `description`（写日志时 description 即数据串），cashChange===0 且有事件取 '✓'
  // q-1 盘点：从 saves 中 state.operation 年季 == (year, q) 的最新存档取现金/原料/成品 → `(${cash},${原料合计},${成品合计})`
  // q-20 结余：saves 中 (year, q+1)（或次年 Q1）快照现金
  // q-18/q-19：该季日志 cashChange 正/负求和
  // 年初/年末行：数据填 Q1 列
}
export function toCSV(rows: string[][], year: number): string { /* 表头两行 + 数据行，逗号拼接 */ }
```

- [ ] 步骤 2：失败测试：构造假日志/快照，断言第 1 年表格：q-1 单元格 `(20,3,3)`、q-17 有 `-2M(广告费)`、e-2 有数据、空步骤为空串、CSV 首行为 `第1年运行控制表,,,,,`。

- [ ] 步骤 3：所有写 `FinancialLogRecord` 处补 `stepId`（对照 CONTROL_STEPS 映射：广告 q-17、研发 q-15、原料下单 q-6、行政费 q-16、应收 q-11、交货 q-14、盘点 q-1、短贷 q-2/q-3、到货 q-5、生产 q-7/q-10、规划会议 b-1 自动勾选、结账 e-6 等）。`addFinancialLog` 签名加可选 `stepId` 参数。

- [ ] 步骤 4：`OperationCenter.tsx`：`ExportReportButton` 改为按年（1..4）按钮组，调用 `toCSV(buildYearControlTable(...))` 下载 `第X年运行控制表.csv`；现有年度总表保留但文案与 CONTROL_STEPS 对齐（删除"申请短期贷款（高利贷）"括注、企业间买卖两行改"（本项目未启用）"）。

- [ ] 步骤 5：`npm test` + `npm run build` → Commit `feat(report): 运行控制表按年导出与stepId打标`。

---

### 任务 12：UI 补齐（规则弹窗/暂停/贴现/时机门控）+ 清理 + README

**文件：** 创建 `src/components/RulesModal.tsx`、`src/components/DiscountPanel.tsx`；修改 `src/app/page.tsx`、`MarketingCenter.tsx`、`package.json`、`README.md`。

- [ ] 步骤 1：`RulesModal.tsx`：props `{ open, onClose }`，纯 React modal（fixed 遮罩 + 白底卡片 + 滚动），分节渲染规则（广告修改项置顶高亮）。内容源：`.agents/documents/企业运营模拟规则说明文件.md` 按规格校正后内联为 JSX 常量数组。
- [ ] 步骤 2：暂停：store action `togglePaused()`；`page.tsx` 页头加"暂停/继续"按钮 + `isPaused &&` 红色横幅"运营已暂停（教学讲解模式）"；各变更 action 首行 `if (get().state.isPaused) return;`（至少：贷款、贴现、广告、订单、生产、采购、投资、nextQuarter、payTaxes）。
- [ ] 步骤 3：`DiscountPanel.tsx`：输入金额（步进 7）+ 可贴现余额展示 + 确认按钮；挂载在 `page.tsx` 财务中心 tab。
- [ ] 步骤 4：时机门控提示：`MarketingCenter` 市场/ISO 投资按钮非 Q4 禁用并注明"年末操作"；`applyLongTermLoan` 按钮 Q4 才可点；`page.tsx` 财务中心加"支付应付税"按钮（Q1、taxesPayable>0 时可用，显示金额）——替换页头硬编码徽标为真实 `taxesPayable`。
- [ ] 步骤 5：清理：`npm uninstall @reduxjs/toolkit reselect`；删除 store 中确认无引用的 `updateCash/updateTaxesPayable` 等（先 grep 组件引用）。
- [ ] 步骤 6：README：移除顶部暂停横幅（恢复正文为正式 README），技术栈表改为实际（React 18/TS/Next 14/Zustand/recharts/Tailwind/localStorage），补"修改后广告规则"与"运行控制表导出"说明。
- [ ] 步骤 7：`npm test && npm run build` 全绿 → Commit `feat(ui): 规则弹窗/暂停/贴现面板与时机门控`。

---

## 自检记录

- 规格覆盖：4.1→任务9；4.2→任务3/4；4.3→任务5；4.4→任务6；4.5→任务6；4.6→任务7；4.7→任务7；4.8→任务8；4.9→任务2/10；4.10→任务7/11；4.11→任务4/6/9；4.12→任务11；4.13→任务12；4.14→任务3。无遗漏。
- 占位符：无"待定/TODO"。
- 类型一致性：`LoanRecord`（types）与 `LoanLike`（rules）结构一致；`stepId` 命名统一 `b-/q-/e-` 前缀；`incomeStatement` 返回结构在任务 6 测试与 yearlyIncomeStatements 使用一致。
