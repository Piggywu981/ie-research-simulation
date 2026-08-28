import { beforeEach, describe, it, expect } from 'vitest';
import { useEnterpriseStore, createFreshState } from '../src/store/enterpriseStore';

const store = () => useEnterpriseStore.getState();
const advance = (n: number) => {
  for (let i = 0; i < n; i++) store().nextQuarter();
};

beforeEach(() => {
  useEnterpriseStore.setState({ state: createFreshState(), validationError: null });
});

describe('原料订单与到货', () => {
  it('下单不付款，到货入库时付款（R1提前1季）', () => {
    const cashBefore = store().state.finance.cash;
    store().placeRawMaterialOrder('R1', 5);
    expect(store().validationError).toBeNull();
    // 下单不扣现金
    expect(store().state.finance.cash).toBe(cashBefore);
    const order = store().state.logistics.rawMaterialOrders[0];
    expect(order.arrivalPeriod).toBe(2); // 第1年Q1下单 → 绝对季度2到货
    // 推进1季到Q2：到货付款5M
    advance(1);
    expect(store().state.logistics.rawMaterials.find(m => m.type === 'R1')!.quantity).toBeGreaterThanOrEqual(5);
    expect(store().state.logistics.rawMaterialOrders).toHaveLength(0);
    const log = store().state.operation.financialLogs.find(l => l.stepId === 'q-5' && l.description.includes('5*R1'));
    expect(log).toBeDefined();
    expect(log!.description).toContain('(5M)');
  });

  it('跨年到货：第1年Q4下单R1，第2年Q1到货（旧bug场景：旧版arrivalPeriod=1永不跨年）', () => {
    advance(3); // Q4
    store().placeRawMaterialOrder('R1', 4);
    const order = store().state.logistics.rawMaterialOrders[0];
    expect(order.arrivalPeriod).toBe(5); // 绝对季度5 = 第2年Q1（leadTime 1）
    advance(1); // Y2Q1：到货4个，随即被停产线复工投料消耗
    expect(store().state.logistics.rawMaterialOrders).toHaveLength(0);
    expect(store().state.logistics.rawMaterials.find(m => m.type === 'R1')!.quantity).toBe(0); // 期初0 + 到货4 - 复工投料2 - 开工投料2
  });

  it('R2提前1季、R3提前2季', () => {
    store().placeRawMaterialOrder('R2', 1);
    store().placeRawMaterialOrder('R3', 1);
    expect(store().state.logistics.rawMaterialOrders.find(o => o.materialType === 'R2')!.arrivalPeriod).toBe(2);
    expect(store().state.logistics.rawMaterialOrders.find(o => o.materialType === 'R3')!.arrivalPeriod).toBe(3); // 提前2季
  });

  it('现金不足时到货计入应付款', () => {
    store().placeRawMaterialOrder('R1', 10);
    // 清空现金
    useEnterpriseStore.setState({
      state: { ...store().state, finance: { ...store().state.finance, cash: 0 } },
    });
    advance(1);
    expect(store().state.finance.accountsPayable).toBe(10);
    expect(store().state.logistics.rawMaterials.find(m => m.type === 'R1')!.quantity).toBe(13); // 期初3 + 到货10
  });
});

describe('订单选择', () => {
  it('selectOrder 从可用列表移入已选，不重复', () => {
    store().addAvailableOrder({
      productType: 'P1', quantity: 2, unitPrice: 5, totalAmount: 10, paymentPeriod: 1, market: '本地市场',
    });
    const orderId = store().state.marketing.availableOrders[0].id;
    store().selectOrder(orderId);
    expect(store().state.marketing.availableOrders).toHaveLength(0);
    expect(store().state.marketing.selectedOrders).toHaveLength(1);
    // 再次选择同一订单被拒
    store().selectOrder(orderId);
    expect(store().validationError).toContain('不在可选列表');
    expect(store().state.marketing.selectedOrders).toHaveLength(1);
  });
});
