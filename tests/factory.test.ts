import { beforeEach, describe, it, expect } from 'vitest';
import { useEnterpriseStore, createFreshState } from '../src/store/enterpriseStore';
import { landAndBuildings, annualRent, RENT_BY_TYPE } from '../src/utils/rules';

const store = () => useEnterpriseStore.getState();
const resetStore = () => {
  useEnterpriseStore.setState({ state: createFreshState(), validationError: null });
};

beforeEach(() => resetStore());

const advance = (n: number) => { for (let i = 0; i < n; i++) store().nextQuarter(); };

describe('厂房权属与派生资产', () => {
  it('初始状态：大厂房自有、小厂房租赁；土地和建筑=40M、当年租金=3M', () => {
    const factories = store().state.production.factories;
    expect(factories[0].holding).toBe('owned');
    expect(factories[1].holding).toBe('leased');
    expect(landAndBuildings(factories)).toBe(40);
    expect(annualRent(factories)).toBe(3);
    expect(RENT_BY_TYPE.large).toBe(5);
  });

  it('annualRent 只认 leasedThisYear 快照，不认实时 holding', () => {
    const factories = [
      { type: 'small' as const, purchasePrice: 30, leasedThisYear: true },
      { type: 'large' as const, purchasePrice: 40, leasedThisYear: false },
    ];
    expect(annualRent(factories)).toBe(3);
  });

  it('v2 存档缺失权属字段时按槽位补齐', () => {
    const legacy = JSON.parse(JSON.stringify(createFreshState()));
    delete legacy.production.factories[0].holding;
    delete legacy.production.factories[0].leasedThisYear;
    delete legacy.production.factories[1].holding;
    delete legacy.production.factories[1].leasedThisYear;
    useEnterpriseStore.getState().loadGame({
      id: 's1', name: '旧档', enterpriseName: '企业1', timestamp: Date.now(),
      resetCount: 0, version: 2, state: legacy, createdAt: new Date().toISOString(),
    });
    const fs = store().state.production.factories;
    expect(fs[0].holding).toBe('owned');
    expect(fs[0].leasedThisYear).toBe(false);
    expect(fs[1].holding).toBe('leased');
    expect(fs[1].leasedThisYear).toBe(true);
  });
});

describe('购买与租赁厂房', () => {
  it('非第4季度购买被拒绝且状态零变化', () => {
    store().buyFactory('factory-2');
    expect(store().validationError).toContain('年末');
    expect(store().state.finance.cash).toBe(20);
    expect(store().state.production.factories[1].holding).toBe('leased');
  });

  it('第4季度买断小厂房：现金-30、权属转 owned、生产线保留、写 e-3 日志', () => {
    useEnterpriseStore.setState({ state: { ...store().state, finance: { ...store().state.finance, cash: 60 } } });
    advance(3);
    expect(store().state.operation.currentQuarter).toBe(4);
    expect(store().state.production.factories[1].productionLines).toHaveLength(1);
    const cashBefore = store().state.finance.cash; // 推进到 Q4 会产行政费等变动，必须用差值断言
    store().buyFactory('factory-2');
    expect(store().validationError).toBeNull();
    expect(store().state.finance.cash).toBe(cashBefore - 30);
    expect(store().state.production.factories[1].holding).toBe('owned');
    // 规格 §9 假设 3：买断是权属变更，不要求腾空、不影响在产线
    expect(store().state.production.factories[1].productionLines).toHaveLength(1);
    const log = store().state.operation.financialLogs.find(l => l.stepId === 'e-3' && l.description.includes('购买厂房'));
    expect(log?.description).toContain('-30M');
  });

  it('现金不足拒绝且状态零变化', () => {
    advance(3);
    store().buyFactory('factory-2');
    expect(store().validationError).toContain('现金不足');
    expect(store().state.production.factories[1].holding).toBe('leased');
  });

  it('已自有的厂房重复购买被拒绝', () => {
    advance(3);
    store().buyFactory('factory-1');
    expect(store().validationError).toContain('无需重复购买');
  });

  it('未持有的槽位可新租：只改权属，不覆写 leasedThisYear 租赁快照', () => {
    advance(3);
    // leasedThisYear 置为 true，模拟可达状态：租赁→快照为 true→买断→出售后快照仍为 true→次年 Q4 再新租。
    // 规格 §4.2/§9-7：leaseFactory 不得改动租赁快照，否则该槽位次年租金被静默抹掉（资金泄漏）。
    useEnterpriseStore.setState({ state: { ...store().state, production: { ...store().state.production, factories: store().state.production.factories.map(f => f.id === 'factory-1' ? { ...f, holding: 'none' as const, leasedThisYear: true } : f) } } });
    store().leaseFactory('factory-1');
    expect(store().validationError).toBeNull();
    expect(store().state.production.factories[0].holding).toBe('leased');
    // 若实现把 leasedThisYear 覆写为 false（抹掉次年租金），本断言必须失败
    expect(store().state.production.factories[0].leasedThisYear).toBe(true);
    const log = store().state.operation.financialLogs.find(l => l.stepId === 'e-3' && l.description.includes('新租厂房'));
    expect(log?.description).toContain('5M/年');
  });

  it('已租赁或已自有的槽位不能再新租', () => {
    advance(3);
    store().leaseFactory('factory-2');
    expect(store().validationError).toContain('已被持有');
  });

  it('暂停状态下两笔交易都拒绝', () => {
    advance(3);
    store().togglePaused();
    store().buyFactory('factory-2');
    expect(store().validationError).toContain('暂停');
    store().leaseFactory('factory-1');
    expect(store().validationError).toContain('暂停');
  });
});

describe('出售厂房', () => {
  const emptyLargeFactory = () => {
    useEnterpriseStore.setState({
      state: {
        ...store().state,
        production: {
          ...store().state.production,
          factories: store().state.production.factories.map(f =>
            f.id === 'factory-1' ? { ...f, productionLines: [] } : f
          ),
        },
      },
    });
  };

  it('厂房内有生产线时拒绝出售', () => {
    store().sellFactory('factory-1');
    expect(store().validationError).toContain('腾空');
    expect(store().state.production.factories[0].holding).toBe('owned');
  });

  it('季中可出售：不进现金、售价入应收4Q档、写 q-12 非现金日志', () => {
    emptyLargeFactory();
    const cashBefore = store().state.finance.cash;
    store().sellFactory('factory-1');
    expect(store().validationError).toBeNull();
    expect(store().state.finance.cash).toBe(cashBefore);
    expect(store().state.production.factories[0].holding).toBe('none');
    expect(store().state.finance.accountsReceivable[3]).toBe(15 + 40);
    const log = store().state.operation.financialLogs.find(l => l.stepId === 'q-12');
    expect(log?.cashChange).toBe(0);
    expect(log?.description).toContain('+40M（计入4Q应收款）');
    // 派生资产联动：转为 none 的槽位不再计入土地和建筑（40M → 0）
    expect(landAndBuildings(store().state.production.factories)).toBe(0);
  });

  it('租赁中的厂房不可出售，提示先买断', () => {
    store().sellFactory('factory-2');
    expect(store().validationError).toContain('买断');
  });

  it('出售后第4个季度初收到该笔应收', () => {
    emptyLargeFactory();
    store().sellFactory('factory-1');
    const before = store().state.finance.cash;
    for (let i = 0; i < 4; i++) store().nextQuarter();
    expect(store().validationError).toBeNull();
    expect(store().state.finance.cash).toBeGreaterThan(before + 39);
  });

  it('出售所得可被 7:1 贴现（与既有应收混池，从最早账期起扣）', () => {
    emptyLargeFactory();
    store().sellFactory('factory-1');
    store().discountReceivable(14);
    expect(store().validationError).toBeNull();
    expect(store().state.finance.cash).toBe(20 + 12);
    expect(store().state.finance.accountsReceivable[3]).toBe(55 - 14);
  });

  it('未持有的槽位不能放置生产线', () => {
    emptyLargeFactory();
    store().sellFactory('factory-1');
    store().addProductionLine('factory-1', 'automatic', 'P1');
    expect(store().validationError).toContain('未被持有');
  });
});

describe('租金快照口径', () => {
  // 必须用 startsWith 精确锁定系统自动租金日志：玩家的新租日志同样含"租金"二字
  // 年末结算日志统一重映射到「收尾年度的第4季度」（见 nextQuarter 的 remappedYearEndLogs），
  // 因此第 N 年的租金日志 year === N，而不是过渡后的 N+1。
  const rentLogs = () => store().state.operation.financialLogs
    .filter(l => l.stepId === 'e-3' && l.description.startsWith('支付厂房租金'));

  it('年末买断小厂房，收尾年度仍收当年 3M 租金', () => {
    useEnterpriseStore.setState({ state: { ...store().state, finance: { ...store().state.finance, cash: 60 } } });
    advance(3);
    store().buyFactory('factory-2');
    store().nextQuarter(); // 第1年Q4 → 第2年Q1，此处结算第1年租金
    expect(rentLogs().some(l => l.year === 1 && l.description.includes('3M'))).toBe(true);
  });

  it('年末新租大厂房，收尾年度不计其租金，次年计 5M', () => {
    useEnterpriseStore.setState({
      state: {
        ...store().state,
        production: { ...store().state.production, factories: store().state.production.factories.map(f => f.id === 'factory-1' ? { ...f, holding: 'none' as const, productionLines: [] } : f) },
        finance: { ...store().state.finance, cash: 60 },
      },
    });
    advance(3);
    store().leaseFactory('factory-1');
    store().nextQuarter();
    const year1 = rentLogs().find(l => l.year === 1);
    expect(year1?.description).toBe('支付厂房租金：-厂房租金3M'); // 新租的大厂房本年不计
    useEnterpriseStore.setState({ state: { ...store().state, finance: { ...store().state.finance, cash: 60 } } });
    advance(4);
    const year2 = rentLogs().find(l => l.year === 2);
    expect(year2?.description).toBe('支付厂房租金：-厂房租金8M'); // 大 5M + 小 3M
  });

  it('买断的厂房卖掉后，次年不再收其租金（快照由跨年刷新清零，不由 sellFactory 清零）', () => {
    // 真实路径：第1年Q4买断小厂房 → 结算收当年3M → 跨年刷新把快照转 false
    // → 第2年Q4出售 → 第2年结算租金为 0。
    // 不变量：只有跨年刷新写 leasedThisYear；sellFactory 不得清零，否则"年末买断后同年卖出"
    // 会把当年租金一起免掉（§9-7 要防的漏收）。
    // 小厂房需先清空生产线，否则 sellFactory 会以"需先腾空"拒绝。
    useEnterpriseStore.setState({
      state: {
        ...store().state,
        finance: { ...store().state.finance, cash: 60 },
        production: {
          ...store().state.production,
          factories: store().state.production.factories.map(f =>
            f.id === 'factory-2' ? { ...f, productionLines: [] } : f
          ),
        },
      },
    });
    advance(3);
    store().buyFactory('factory-2');
    store().nextQuarter(); // 第1年Q4 → 第2年Q1：结算第1年租金
    expect(rentLogs().find(l => l.year === 1)?.description).toBe('支付厂房租金：-厂房租金3M');
    advance(3); // 第2年Q4
    expect(store().state.production.factories[1].leasedThisYear).toBe(false);
    store().sellFactory('factory-2');
    store().nextQuarter(); // 第2年Q4 → 第3年Q1：该槽位已出售，租金归零
    expect(rentLogs().find(l => l.year === 2)?.description).toBe('支付厂房租金：-厂房租金0M');
  });
});
