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

  it('扣减方向：只让最早账期先动（[5,0,10,40] 贴现14 → [0,0,1,40]）', () => {
    // 上面的用例四档里只有 [3] 非零，无论循环方向如何结果都一样，检测不出反向遍历；
    // 规格 §7-8 的前提"厂房款（[3] 档）最后被动用"依赖 enterpriseStore.ts:616-620 的 0→3 方向，
    // 因此这里刻意让 0/2/3 三档都非零：若实现改成 3→0，结果会是 [5,0,10,26]，本用例必须失败。
    const s = store().state;
    useEnterpriseStore.setState({
      state: { ...s, finance: { ...s.finance, accountsReceivable: [5, 0, 10, 40] as [number, number, number, number] } },
    });
    store().discountReceivable(14);
    expect(store().validationError).toBeNull();
    expect(store().state.finance.accountsReceivable).toEqual([0, 0, 1, 40]);
    expect(store().state.finance.cash).toBe(32); // 20 + 到账12（14M ÷7 = 2M 贴息）
  });
});
