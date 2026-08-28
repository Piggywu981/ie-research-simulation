import { beforeEach, describe, it, expect } from 'vitest';
import { useEnterpriseStore, createFreshState } from '../src/store/enterpriseStore';

const store = () => useEnterpriseStore.getState();
const advance = (n: number) => {
  for (let i = 0; i < n; i++) store().nextQuarter();
};

beforeEach(() => {
  useEnterpriseStore.setState({ state: createFreshState(), validationError: null });
});

/** 录入并选择一张订单：3个P1、总额21M、账期1季（受初始成品库存3个约束） */
const seedDeliveredOrder = () => {
  store().addAvailableOrder({
    productType: 'P1',
    quantity: 3,
    unitPrice: 7,
    totalAmount: 21,
    paymentPeriod: 1,
    market: '本地市场',
  });
  const order = store().state.marketing.availableOrders[0];
  store().moveOrderToSelected(order.id);
  store().deliverOrder(order.id);
};

describe('年度台账与利润表', () => {
  it('交货累计销售收入与直接成本', () => {
    seedDeliveredOrder();
    expect(store().state.operation.annualLedger.salesRevenue).toBe(21);
    expect(store().state.operation.annualLedger.directCosts).toBe(6); // 3 × 2M
  });

  it('年末结账：利润表、税金计入应付、留存结转、报表归档', () => {
    seedDeliveredOrder();
    advance(4); // 进入第2年，第1年已结账
    const s = store().state;
    expect(s.operation.yearlyIncomeStatements[1]).toMatchObject({
      grossProfit: 15, // 21 - 6
      pretax: 1, // 15 - 综合费用6 - 折旧4 - 初始长贷利息4
      tax: 0,
      net: 1,
    });
    expect(s.operation.yearlyLedgers[1].depreciation).toBe(4);
    expect(s.finance.taxesPayable).toBe(1); // 仅初始1M（本年税前利润1M，税0）
    expect(s.finance.retainedProfit).toBe(12); // 11 + 1
    expect(s.finance.annualNetProfit).toBe(1);
    // 新年度台账已清零
    expect(s.operation.annualLedger.salesRevenue).toBe(0);
  });

  it('折旧计提：两条初始线各提2M，净值扣减', () => {
    advance(4);
    const lines = store().state.production.factories.flatMap(f => f.productionLines);
    expect(lines.map(l => l.netValue)).toEqual([5, 4]); // 7-2、6-2
  });

  it('下年初交纳应付税', () => {
    seedDeliveredOrder();
    advance(4);
    const cashBefore = store().state.finance.cash;
    store().payTaxes();
    expect(store().validationError).toBeNull();
    expect(store().state.finance.cash).toBe(cashBefore - 1);
    expect(store().state.finance.taxesPayable).toBe(0);
    const log = store().state.operation.financialLogs.find(l => l.stepId === 'b-4');
    expect(log?.description).toContain('1M');
  });

  it('非年初交税被拒绝', () => {
    advance(1); // Q2
    store().payTaxes();
    expect(store().validationError).toContain('第1季度');
  });

  it('亏损年税为0', () => {
    advance(4); // 全年无收入
    expect(store().state.operation.yearlyIncomeStatements[1].tax).toBe(0);
    expect(store().state.operation.yearlyIncomeStatements[1].net).toBeLessThan(0);
  });
});
