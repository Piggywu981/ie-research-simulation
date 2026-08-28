import { describe, it, expect } from 'vitest';
import {
  absQuarter, fromAbsQuarter, unitCost, depreciationFor,
  isValidDiscount, discountSplit,
  settleLongLoansAtYearEnd, settleDueShortLoans,
  incomeStatement, emptyLedger,
} from '../src/utils/rules';

describe('季度索引', () => {
  it('跨年换算', () => {
    expect(absQuarter(1, 1)).toBe(1);
    expect(absQuarter(1, 4)).toBe(4);
    expect(absQuarter(2, 1)).toBe(5);
    expect(absQuarter(4, 4)).toBe(16);
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
    expect(depreciationFor(13, 0, 1)).toBe(4); // floor(13/3)，与课程初始利润表一致
    expect(depreciationFor(13, 1, 1)).toBe(0); // 当年建成不提
    expect(depreciationFor(2, 0, 5)).toBe(1);  // 净值<3M 每年提1M
    expect(depreciationFor(3, 0, 5)).toBe(1);
    expect(depreciationFor(4, 0, 5)).toBe(1);
  });
});

describe('贴现', () => {
  it('7 的倍数校验', () => {
    expect(isValidDiscount(7, 15)).toBe(true);
    expect(isValidDiscount(8, 15)).toBe(false);
    expect(isValidDiscount(14, 10)).toBe(false);
    expect(isValidDiscount(0, 15)).toBe(false);
  });
  it('7M 贴 1M 到 6M', () => expect(discountSplit(7)).toEqual({ fee: 1, cash: 6 }));
  it('21M 贴 3M 到 18M', () => expect(discountSplit(21)).toEqual({ fee: 3, cash: 18 }));
});

describe('贷款结算', () => {
  it('长贷 3 年：3 次付息后还本', () => {
    const loan = { kind: 'long' as const, principal: 20, rate: 0.1, drawnAbs: 4, termQuarters: 12 };
    const y1 = settleLongLoansAtYearEnd([loan]);
    expect(y1.interest).toBeCloseTo(2);
    expect(y1.principalRepaid).toBe(0);
    const y2 = settleLongLoansAtYearEnd(y1.survivors);
    expect(y2.principalRepaid).toBe(0);
    const y3 = settleLongLoansAtYearEnd(y2.survivors);
    expect(y3.interest).toBeCloseTo(2);
    expect(y3.principalRepaid).toBe(20);
    expect(y3.survivors).toHaveLength(0);
  });
  it('短贷到期一次还本付息', () => {
    const loan = { kind: 'short' as const, principal: 20, rate: 0.05, drawnAbs: 1, termQuarters: 4 };
    expect(settleDueShortLoans([loan], 4).due).toBe(0);
    expect(settleDueShortLoans([loan], 5).due).toBeCloseTo(21);
    expect(settleDueShortLoans([loan], 5).survivors).toHaveLength(0);
  });
});

describe('利润表', () => {
  it('课程初始示例：收入35 成本12 综合费用11 折旧4 财务4 → 税前4 税1 净3', () => {
    const l = { ...emptyLedger(), salesRevenue: 35, directCosts: 12, adminFee: 11, depreciation: 4, interestExpense: 4 };
    const r = incomeStatement(l);
    expect(r.grossProfit).toBe(23);
    expect(r.beforeDepreciation).toBe(12);
    expect(r.pretax).toBe(4);
    expect(r.tax).toBe(1);
    expect(r.net).toBe(3);
  });
  it('亏损年税为 0', () => {
    const r = incomeStatement({ ...emptyLedger(), salesRevenue: 5, directCosts: 8 });
    expect(r.tax).toBe(0);
    expect(r.net).toBe(-3);
  });
});
