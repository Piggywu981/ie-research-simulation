// 课程运营规则纯函数集：不依赖 store，可独立测试
// 依据：docs/superpowers/specs/2026-08-28-erp-sandbox-restart-design.md

export type ProductId = 'P1' | 'P2' | 'P3' | 'P4';
export type MaterialId = 'R1' | 'R2' | 'R3' | 'R4';

// 绝对季度索引：第1年第1季度 = 1，根治跨年调度 bug
export const absQuarter = (year: number, quarter: number) => (year - 1) * 4 + quarter;
export const fromAbsQuarter = (abs: number) => ({
  year: Math.floor((abs - 1) / 4) + 1,
  quarter: ((abs - 1) % 4) + 1,
});

// 产品结构（BOM）与加工费；P3/P4 仅保留定义，无运营入口
export const PRODUCT_BOM: Record<ProductId, Partial<Record<MaterialId, number>>> = {
  P1: { R1: 1 },
  P2: { R1: 1, R2: 1 },
  P3: { R2: 2, R3: 1 },
  P4: { R2: 1, R3: 1, R4: 2 },
};
export const PROCESS_FEE = 1;
export const unitCost = (p: ProductId) =>
  Object.values(PRODUCT_BOM[p]).reduce((s, q) => s + (q ?? 0), 0) + PROCESS_FEE; // P1=2, P2=3

// 折旧：当年建成不提；净值>=3M 提 floor(净值/3)；否则每年提 1M（课程 _22 页）
export const depreciationFor = (netValue: number, builtInYear: number, currentYear: number) => {
  if (builtInYear >= currentYear) return 0;
  return netValue >= 3 ? Math.floor(netValue / 3) : 1;
};

// 贴现：金额为 7 的倍数，每 7M 应收付 1M 贴息、到账 6M
export const DISCOUNT_UNIT = 7;
export const isValidDiscount = (amount: number, receivable: number) =>
  amount > 0 && amount % DISCOUNT_UNIT === 0 && amount <= receivable;
export const discountSplit = (amount: number) => ({ fee: amount / 7, cash: amount - amount / 7 });

export interface LoanLike {
  kind: 'long' | 'short';
  principal: number;
  rate: number;
  drawnAbs: number; // 放贷绝对季度
  termQuarters: number;
}

// 年末长贷结算：对每笔存续长贷付息、期限递减 4 个季度，到期还本
export const settleLongLoansAtYearEnd = <T extends LoanLike>(loans: T[]) => {
  let interest = 0;
  let principalRepaid = 0;
  const survivors = loans
    .filter((l) => l.kind === 'long')
    .map((l) => {
      interest += l.principal * l.rate;
      const remaining = l.termQuarters - 4;
      if (remaining <= 0) {
        principalRepaid += l.principal;
        return null;
      }
      return { ...l, termQuarters: remaining };
    })
    .filter((l): l is T => l !== null);
  return { interest, principalRepaid, survivors };
};

// 季初短贷到期结算：到期一次还本付息
export const settleDueShortLoans = <T extends LoanLike>(loans: T[], absNow: number) => {
  let due = 0;
  const survivors = loans.filter((l) => {
    if (l.kind === 'short' && absNow === l.drawnAbs + l.termQuarters) {
      due += l.principal * (1 + l.rate);
      return false;
    }
    return true;
  });
  return { due, survivors };
};

export const TAX_RATE = 0.25;

// 年度台账（利润表科目累计）
export interface Ledger {
  salesRevenue: number;
  directCosts: number;
  adminFee: number;
  adFee: number;
  marketDevFee: number;
  rdFee: number;
  isoFee: number;
  conversionFee: number;
  maintenanceFee: number;
  rentFee: number;
  otherFee: number;
  depreciation: number;
  interestExpense: number;
  discountFee: number;
  extraExpense: number;
}

export const emptyLedger = (): Ledger => ({
  salesRevenue: 0,
  directCosts: 0,
  adminFee: 0,
  adFee: 0,
  marketDevFee: 0,
  rdFee: 0,
  isoFee: 0,
  conversionFee: 0,
  maintenanceFee: 0,
  rentFee: 0,
  otherFee: 0,
  depreciation: 0,
  interestExpense: 0,
  discountFee: 0,
  extraExpense: 0,
});

export const totalExpense = (l: Ledger) =>
  l.adminFee + l.adFee + l.marketDevFee + l.rdFee + l.isoFee + l.conversionFee +
  l.maintenanceFee + l.rentFee + l.otherFee;

// 利润表（课程 _16 页结构）
export const incomeStatement = (l: Ledger) => {
  const grossProfit = l.salesRevenue - l.directCosts;
  const beforeDepreciation = grossProfit - totalExpense(l);
  const beforeInterest = beforeDepreciation - l.depreciation;
  const pretax = beforeInterest - l.interestExpense - l.discountFee - l.extraExpense;
  const tax = Math.floor(Math.max(0, pretax) * TAX_RATE);
  return { grossProfit, beforeDepreciation, beforeInterest, pretax, tax, net: pretax - tax };
};
