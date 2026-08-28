import { beforeEach, describe, it, expect } from 'vitest';
import { useEnterpriseStore, createFreshState } from '../src/store/enterpriseStore';

const store = () => useEnterpriseStore.getState();
const advance = (n: number) => {
  for (let i = 0; i < n; i++) store().nextQuarter();
};
const injectCash = (amount: number) => {
  useEnterpriseStore.setState({
    state: { ...store().state, finance: { ...store().state.finance, cash: amount } },
  });
};

beforeEach(() => {
  useEnterpriseStore.setState({ state: createFreshState(), validationError: null });
});

describe('广告投放', () => {
  it('非第1季度投放被拒绝', () => {
    advance(1); // Q2
    const cashBefore = store().state.finance.cash;
    store().placeAdvertisement(2);
    expect(store().validationError).toContain('第1季度');
    expect(store().state.finance.cash).toBe(cashBefore); // 未扣款
  });

  it('第1季度投放：扣现金、计台账、日志带广告费标记', () => {
    store().placeAdvertisement(2);
    expect(store().validationError).toBeNull();
    expect(store().state.finance.cash).toBe(18);
    expect(store().state.operation.annualLedger.adFee).toBe(2);
    const log = store().state.operation.financialLogs.find(l => l.stepId === 'q-17');
    expect(log?.description).toBe('-2M(广告费)');
  });
});

describe('订货会与订单池', () => {
  it('未投放广告时不解锁订单', () => {
    store().enterOrderMeeting();
    expect(store().state.marketing.availableOrders).toHaveLength(0);
  });

  it('广告解锁订单：仅含已准入市场×有资格产品，数量受广告约束', () => {
    store().placeAdvertisement(2);
    store().enterOrderMeeting();
    const orders = store().state.marketing.availableOrders;
    expect(orders.length).toBeGreaterThan(0);
    expect(orders.length).toBeLessThanOrEqual(4); // 2M × 2张/M
    // P2 未完成研发时，订单池只应包含 P1
    expect(orders.every(o => o.productType === 'P1')).toBe(true);
  });

  it('第1年只有本地市场准入', () => {
    store().placeAdvertisement(3);
    store().enterOrderMeeting();
    const orders = store().state.marketing.availableOrders;
    expect(orders.every(o => o.market === 'local')).toBe(true);
  });

  it('选择订单后交付进入应收账款', () => {
    store().placeAdvertisement(3);
    store().enterOrderMeeting();
    const orders = store().state.marketing.availableOrders;
    if (orders.length > 0) {
      const target = orders.find(o => o.productType === 'P1' && o.quantity <= 3) ?? orders[0];
      store().selectOrder(target.id);
      expect(store().validationError).toBeNull();
      expect(store().state.marketing.selectedOrders).toHaveLength(1);
    }
  });
});
