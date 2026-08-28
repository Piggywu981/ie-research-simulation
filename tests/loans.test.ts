import { beforeEach, describe, it, expect } from 'vitest';
import { useEnterpriseStore, createFreshState } from '../src/store/enterpriseStore';
import { absQuarter } from '../src/utils/rules';

const store = () => useEnterpriseStore.getState();

const resetStore = () => {
  useEnterpriseStore.setState({ state: createFreshState(), validationError: null });
};

// 推进 n 个季度
const advance = (n: number) => {
  for (let i = 0; i < n; i++) {
    store().nextQuarter();
  }
};

beforeEach(() => {
  resetStore();
});

describe('长期贷款', () => {
  it('非第4季度申请被拒绝', () => {
    // 初始为第1年第1季度
    store().applyLongTermLoan();
    expect(store().validationError).toContain('第4季度');
    expect(store().state.finance.cash).toBe(20);
  });

  it('第4季度申请：现金+20、台账新增一笔、聚合金额联动', () => {
    // 清偿初始40M长贷后测试新借（初始40M已占满40M上限）
    useEnterpriseStore.setState({
      state: {
        ...store().state,
        finance: {
          ...store().state.finance,
          loans: store().state.finance.loans.filter(l => l.kind !== 'long'),
          longTermLoan: { ...store().state.finance.longTermLoan, amount: 0 },
        },
      },
    });
    advance(3);
    expect(store().state.operation.currentQuarter).toBe(4);
    const cashBefore = store().state.finance.cash;
    store().applyLongTermLoan();
    expect(store().validationError).toBeNull();
    expect(store().state.finance.cash).toBe(cashBefore + 20);
    const longs = store().state.finance.loans.filter(l => l.kind === 'long');
    expect(longs).toHaveLength(1);
    expect(longs[0].principal).toBe(20);
    expect(store().state.finance.longTermLoan.amount).toBe(20);
  });

  it('未还本余额达上限40M后拒绝再借', () => {
    advance(3);
    store().applyLongTermLoan(); // 40+20=60 超上限？
    // 初始已有40M，再借20M将达60M > 40M 上限，应拒绝
    expect(store().validationError).toContain('上限');
    expect(store().state.finance.cash).toBe(store().state.finance.cash);
  });

  it('初始长贷40M：连续3个年末付息，第3个年末还本', () => {
    // 第1年年末（推进4次进入第2年Q1，年末结算发生在推进出Q4时）
    advance(4);
    expect(store().state.operation.currentYear).toBe(2);
    const logs1 = store().state.operation.financialLogs.filter(l => l.stepId === 'e-1');
    expect(logs1.length).toBeGreaterThan(0);
    expect(logs1[0].description).toContain('利息4M'); // 40M × 10%

    // 第2年年末
    advance(4);
    const logs2 = store().state.operation.financialLogs.filter(l => l.stepId === 'e-1' && l.year === 3);
    expect(logs2[0].description).toContain('利息4M');

    // 第3年年末：付息 + 还本40M（注入足够现金避免负现金守卫拦截）
    useEnterpriseStore.setState({
      state: {
        ...store().state,
        finance: { ...store().state.finance, cash: 80 },
      },
    });
    advance(4);
    const logs3 = store().state.operation.financialLogs.filter(l => l.stepId === 'e-1' && l.year === 4);
    expect(logs3[0].description).toContain('利息4M');
    expect(logs3[0].description).toContain('还本40M');
    expect(store().state.finance.loans.filter(l => l.kind === 'long')).toHaveLength(0);
    expect(store().state.finance.longTermLoan.amount).toBe(0);
  });
});

describe('短期贷款', () => {
  it('非第1/3季度申请被拒绝', () => {
    advance(1); // Q2
    store().applyShortTermLoan();
    expect(store().validationError).toContain('第1季度');
  });

  it('第1季度申请成功，4个季度后季初还本付息21M', () => {
    const cashBefore = store().state.finance.cash;
    store().applyShortTermLoan();
    expect(store().validationError).toBeNull();
    expect(store().state.finance.cash).toBe(cashBefore + 20);
    expect(store().state.finance.loans.filter(l => l.kind === 'short')).toHaveLength(1);

    // 推进4次到第2年Q1：到期结算发生在进入第2年Q1的季初
    advance(4);
    expect(store().state.operation.currentYear).toBe(2);
    const settleLogs = store().state.operation.financialLogs.filter(l => l.stepId === 'q-2' && l.description.includes('本息'));
    expect(settleLogs.length).toBe(1);
    expect(settleLogs[0].description).toContain('21M');
    expect(store().state.finance.loans.filter(l => l.kind === 'short')).toHaveLength(0);
    expect(store().state.finance.shortTermLoan.amount).toBe(0);
  });

  it('现金不足以还本付息时拒绝推进季度', () => {
    store().applyShortTermLoan();
    // 现金20：年末费用6M后剩14M，不足以偿还21M短贷本息
    useEnterpriseStore.setState({
      state: {
        ...store().state,
        finance: { ...store().state.finance, cash: 20 },
      },
    });
    advance(3); // 到第1年Q4
    expect(store().state.operation.currentQuarter).toBe(4);
    store().nextQuarter(); // 进入第2年Q1，需还21M 但现金不足
    expect(store().validationError).toContain('贴现');
    expect(store().state.operation.currentYear).toBe(1);
  });
});
