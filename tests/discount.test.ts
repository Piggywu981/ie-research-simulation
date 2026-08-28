import { beforeEach, describe, it, expect } from 'vitest';
import { useEnterpriseStore, createFreshState } from '../src/store/enterpriseStore';

const store = () => useEnterpriseStore.getState();

beforeEach(() => {
  // 初始状态自带应收15M（4Q账期），用于贴现测试
  useEnterpriseStore.setState({ state: createFreshState(), validationError: null });
});

describe('资金贴现', () => {
  it('非7的倍数被拒绝', () => {
    store().discountReceivable(8);
    expect(store().validationError).toContain('7的倍数');
    expect(store().state.finance.cash).toBe(20);
  });

  it('超过应收余额被拒绝', () => {
    store().discountReceivable(21);
    expect(store().validationError).toContain('应收账款余额');
  });

  it('贴现7M到账6M，从最早账期扣减', () => {
    // 初始 AR = [0,0,0,15]
    store().discountReceivable(7);
    expect(store().validationError).toBeNull();
    expect(store().state.finance.cash).toBe(26); // 20 + 6
    expect(store().state.finance.accountsReceivable).toEqual([0, 0, 0, 8]);
    const log = store().state.operation.financialLogs.find(l => l.stepId === 'q-11' && l.description.includes('贴现'));
    expect(log?.description).toContain('贴息-1M');
  });

  it('跨账期扣减：贴现14M 分别扣4Q与3Q', () => {
    store().discountReceivable(14);
    expect(store().state.finance.cash).toBe(32); // 20 + 12
    expect(store().state.finance.accountsReceivable).toEqual([0, 0, 0, 1]);
  });
});
