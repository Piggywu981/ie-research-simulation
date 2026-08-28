import { beforeEach, describe, it, expect } from 'vitest';
import { useEnterpriseStore, createFreshState } from '../src/store/enterpriseStore';

const store = () => useEnterpriseStore.getState();

const resetStore = () => {
  useEnterpriseStore.setState({ state: createFreshState(), validationError: null });
};

const advance = (n: number) => {
  for (let i = 0; i < n; i++) {
    store().nextQuarter();
  }
};

const logsOf = (stepId: string) =>
  store().state.operation.financialLogs.filter(l => l.stepId === stepId);

beforeEach(() => {
  resetStore();
});

describe('应付账款归还（控制表 q-4）', () => {
  it('季初全额归还挂账应付款并记日志', () => {
    useEnterpriseStore.setState({
      state: {
        ...store().state,
        finance: { ...store().state.finance, accountsPayable: 5 },
      },
    });
    advance(1);
    const apLogs = logsOf('q-4');
    expect(apLogs).toHaveLength(1);
    expect(apLogs[0].description).toContain('归还应付账款：-应付款5M');
    expect(apLogs[0].cashChange).toBe(-5);
    expect(store().state.finance.accountsPayable).toBe(0);
    // 归还后现金 = 归还前现金 - 5
    expect(apLogs[0].newCash).toBe(20 - 5);
  });

  it('无到期应付款时记非现金日志', () => {
    advance(1);
    const apLogs = logsOf('q-4');
    expect(apLogs).toHaveLength(1);
    expect(apLogs[0].description).toContain('无到期应付款');
    expect(apLogs[0].cashChange).toBe(0);
  });

  it('现金不足以归还应付账款时拒绝推进', () => {
    useEnterpriseStore.setState({
      state: {
        ...store().state,
        finance: { ...store().state.finance, cash: 3, accountsPayable: 5 },
      },
    });
    advance(1);
    expect(store().validationError).toContain('应付账款');
    expect(store().state.finance.cash).toBe(3);
    expect(store().state.operation.currentQuarter).toBe(1);
  });

  it('端到端：到货现金不足挂应付，下季初归还', () => {
    // 停掉生产线（避免自动开工费干扰）；现金压到 2M：第2季度到货 5个R1（5M），只能付 2M，挂账 3M
    const s = store().state;
    const idleFactories = s.production.factories.map(f => ({
      ...f,
      productionLines: f.productionLines.map(l => ({
        ...l,
        product: null,
        inProgressProducts: 0,
        status: 'idle' as const,
      })),
    }));
    // 应收账款第2季度收3M：第3季度季初恰好够归还应付账款
    useEnterpriseStore.setState({
      state: {
        ...s,
        finance: { ...s.finance, cash: 2, accountsReceivable: [0, 3, 0, 0] },
        production: { ...s.production, factories: idleFactories },
      },
    });
    store().placeRawMaterialOrder('R1', 5);
    advance(1); // 推进到第2季度：R1（提前期1季）到货
    const q5 = logsOf('q-5').find(l => l.description.includes('R1'))!;
    expect(q5.description).toContain('计入应付款');
    expect(store().state.finance.accountsPayable).toBe(3);

    advance(1); // 推进到第3季度：季初归还应付账款
    const q4 = logsOf('q-4').find(l => l.cashChange !== 0)!;
    expect(q4.description).toContain('归还应付账款：-应付款3M');
    expect(q4.cashChange).toBe(-3);
    expect(store().state.finance.accountsPayable).toBe(0);
  });
});

describe('其他现金收支登记（控制表 q-17）', () => {
  it('登记支出：现金减少、计入综合费用-其他', () => {
    store().registerOtherCashFlow('  出售废料 ', -2);
    expect(store().validationError).toBeNull();
    expect(store().state.finance.cash).toBe(18);
    const log = logsOf('q-17').find(l => l.cashChange !== 0)!;
    expect(log.description).toBe('-2M(出售废料)');
    expect(log.stepId).toBe('q-17');
    expect(store().state.operation.annualLedger.otherFee).toBe(2);
  });

  it('登记收入：现金增加、冲减额外收支', () => {
    store().registerOtherCashFlow('赔偿收入', 3);
    expect(store().state.finance.cash).toBe(23);
    const log = logsOf('q-17').find(l => l.cashChange !== 0)!;
    expect(log.description).toBe('+3M(赔偿收入)');
    expect(store().state.operation.annualLedger.extraExpense).toBe(-3);
  });

  it('金额为0或说明为空被拒绝', () => {
    store().registerOtherCashFlow('测试', 0);
    expect(store().validationError).toContain('0');
    store().registerOtherCashFlow('   ', 5);
    expect(store().validationError).toContain('说明');
    expect(store().state.finance.cash).toBe(20);
  });

  it('暂停时拒绝登记', () => {
    store().togglePaused();
    store().registerOtherCashFlow('测试', 1);
    expect(store().validationError).toContain('暂停');
    expect(store().state.finance.cash).toBe(20);
  });
});
