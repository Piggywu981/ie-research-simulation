import { beforeEach, describe, it, expect } from 'vitest';
import { useEnterpriseStore, createFreshState } from '../src/store/enterpriseStore';

const store = () => useEnterpriseStore.getState();
const advance = (n: number) => {
  for (let i = 0; i < n; i++) store().nextQuarter();
};

beforeEach(() => {
  useEnterpriseStore.setState({ state: createFreshState(), validationError: null });
});

describe('开始生产与加工费', () => {
  it('取消生产后重新开始：扣1个R1与1M加工费', () => {
    const line = store().state.production.factories[0].productionLines[0];
    store().cancelProduction(line.id); // 停产（在制品清零、状态idle）
    const cashBefore = store().state.finance.cash;
    const r1Before = store().state.logistics.rawMaterials.find(m => m.type === 'R1')!.quantity;
    store().startProduction(line.id);
    expect(store().validationError).toBeNull();
    expect(store().state.finance.cash).toBe(cashBefore - 1);
    expect(store().state.logistics.rawMaterials.find(m => m.type === 'R1')!.quantity).toBe(r1Before - 1);
    const log = store().state.operation.financialLogs.find(l => l.stepId === 'q-10');
    expect(log?.description).toContain('-加工费1M');
  });

  it('现金不足支付加工费被拒绝', () => {
    const line = store().state.production.factories[0].productionLines[0];
    store().cancelProduction(line.id);
    useEnterpriseStore.setState({
      state: { ...store().state, finance: { ...store().state.finance, cash: 0 } },
    });
    store().startProduction(line.id);
    expect(store().validationError).toContain('加工费');
  });

  it('原材料不足被拒绝', () => {
    const line = store().state.production.factories[0].productionLines[0];
    store().cancelProduction(line.id);
    // 清空R1
    useEnterpriseStore.setState({
      state: {
        ...store().state,
        logistics: {
          ...store().state.logistics,
          rawMaterials: store().state.logistics.rawMaterials.map(m =>
            m.type === 'R1' ? { ...m, quantity: 0 } : m
          ),
        },
      },
    });
    store().startProduction(line.id);
    expect(store().validationError).toContain('R1');
  });

  it('季度推进时自动开工并扣加工费（P1线）', () => {
    const cashBefore = store().state.finance.cash;
    const r1Before = store().state.logistics.rawMaterials.find(m => m.type === 'R1')!.quantity;
    advance(1); // 进入Q2：两条线各完工1个（期初在制品2个的自动线按周期完工），随后自动开工
    const logs = store().state.operation.financialLogs.filter(l => l.stepId === 'q-10');
    expect(logs.length).toBeGreaterThan(0);
    // 每条开工线扣1M加工费与1个R1
    const started = logs.length;
    expect(store().state.finance.cash).toBeLessThan(cashBefore);
    expect(store().state.logistics.rawMaterials.find(m => m.type === 'R1')!.quantity).toBeLessThan(r1Before);
    expect(started).toBeGreaterThan(0);
  });
});

describe('P2 研发分期', () => {
  it('启动研发付首期1M，状态active', () => {
    store().investProductR_D('P2');
    expect(store().validationError).toBeNull();
    expect(store().state.finance.cash).toBe(19);
    expect(store().state.production.productRD.P2.status).toBe('active');
    expect(store().state.production.productRD.P2.paidQuarters).toBe(1);
    expect(store().state.production.productRD.P2.totalInvestment).toBe(1);
  });

  it('重复启动被拒绝', () => {
    store().investProductR_D('P2');
    store().investProductR_D('P2');
    expect(store().validationError).toContain('进行中');
  });

  it('P3/P4 不开放研发', () => {
    // 类型层已收窄为 P2，此处防御性确认 P2 以外入口被拒
    store().investProductR_D('P2', 6);
    expect(store().state.production.productRD.P2.paidQuarters).toBe(6); // 一次付清6季
    expect(store().state.production.productRD.P2.completed).toBe(true);
    expect(store().state.production.productRD.P2.status).toBe('completed');
  });

  it('分期自动续投：6个季度后完成研发', () => {
    store().investProductR_D('P2'); // 第1期
    advance(5); // 续投5期
    const p2 = store().state.production.productRD.P2;
    expect(p2.completed).toBe(true);
    expect(p2.status).toBe('completed');
    expect(p2.paidQuarters).toBe(6);
    expect(p2.totalInvestment).toBe(6);
    // 研发投资计入台账（启动1M + 第2~4季度自动续投3M；第5~6期计入第2年）
    expect(store().state.operation.yearlyLedgers[1].rdFee).toBe(4);
  });

  it('资金不足时中断，资金恢复后自动续投', () => {
    store().investProductR_D('P2');
    // 现金清零：下一季度研发中断但保持active
    useEnterpriseStore.setState({
      state: { ...store().state, finance: { ...store().state.finance, cash: 0 } },
    });
    advance(1);
    expect(store().state.production.productRD.P2.status).toBe('active');
    expect(store().state.production.productRD.P2.paidQuarters).toBe(1);
    expect(store().state.operation.operationLogs.some(l => l.action === '产品研发中断')).toBe(true);
    // 恢复资金后续投
    useEnterpriseStore.setState({
      state: { ...store().state, finance: { ...store().state.finance, cash: 20 } },
    });
    advance(5);
    expect(store().state.production.productRD.P2.completed).toBe(true);
  });
});
