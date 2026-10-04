import { beforeEach, describe, it, expect } from 'vitest';
import { useEnterpriseStore, createFreshState } from '../src/store/enterpriseStore';
import { landAndBuildings, annualRent, RENT_BY_TYPE } from '../src/utils/rules';
import { buildYearControlTable } from '../src/utils/controlTable';

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
    // 本例只查权属与现金；"出售不得清零 leasedThisYear"由下一条用例单独守卫
    // （此处 factory-1 的快照初值就是 false，该断言无法区分"没写"与"写成 false"）。
  });

  it('出售只改权属，不清零租赁快照（该槽位当年租金义务仍保留）', () => {
    // 规格 §4.3：leasedThisYear 由 nextQuarter 的跨年刷新独占写入，交易 action 一律不覆写。
    // 把大厂房快照置为 true 是可达状态（租赁→快照 true→买断→出售），
    // 若 sellFactory 连带写 leasedThisYear: false，年末就少收这一槽位的 5M（§9-7 漏收）。
    useEnterpriseStore.setState({
      state: {
        ...store().state,
        production: {
          ...store().state.production,
          factories: store().state.production.factories.map(f =>
            f.id === 'factory-1' ? { ...f, holding: 'owned' as const, productionLines: [], leasedThisYear: true } : f
          ),
        },
      },
    });
    store().sellFactory('factory-1');
    expect(store().validationError).toBeNull();
    expect(store().state.production.factories[0].holding).toBe('none');
    expect(store().state.production.factories[0].leasedThisYear).toBe(true);
    // 快照未被抹掉 → 年末租金仍把它计入：大 5M + 小厂房（初始 leasedThisYear 即为 true）3M = 8M
    expect(annualRent(store().state.production.factories)).toBe(8);
  });

  it('租赁中的厂房不可出售，提示先买断', () => {
    store().sellFactory('factory-2');
    expect(store().validationError).toContain('买断');
  });

  it('暂停（教学讲解模式）下出售被拒且状态零变化', () => {
    // isPaused 守卫在业务校验之前：即便厂房已腾空、售价可入应收，也不得留下任何痕迹
    // （权属不转 none、应收 4Q 档不加价、不写 q-12 日志）。
    emptyLargeFactory();
    store().togglePaused();
    const snapshot = JSON.stringify(store().state);
    store().sellFactory('factory-1');
    expect(store().validationError).toContain('暂停');
    expect(JSON.stringify(store().state)).toBe(snapshot);
    expect(store().state.production.factories[0].holding).toBe('owned');
    expect(store().state.finance.accountsReceivable).toEqual([0, 0, 0, 15]);
    expect(store().state.operation.financialLogs.some(l => l.stepId === 'q-12')).toBe(false);
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

  it('厂房款排在最后动用：更早账期先被扣光（规格 §9-4 前提）', () => {
    // 上一条只让 [3] 档非零，扣减方向换成 3→0 也一样通过；本例给 [0] 档放 7M，
    // 于是"厂房款最后被动用"才真正被断言：若遍历方向反了会得到 [7,0,0,41]。
    emptyLargeFactory();
    const s = store().state;
    useEnterpriseStore.setState({
      state: { ...s, finance: { ...s.finance, accountsReceivable: [7, 0, 0, 15] as [number, number, number, number] } },
    });
    store().sellFactory('factory-1');
    expect(store().validationError).toBeNull();
    expect(store().state.finance.accountsReceivable).toEqual([7, 0, 0, 55]);
    store().discountReceivable(14);
    expect(store().validationError).toBeNull();
    expect(store().state.finance.accountsReceivable).toEqual([0, 0, 0, 48]);
    expect(store().state.finance.cash).toBe(20 + 12);
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

  it('年末买断小厂房，收尾年度仍收当年 3M 租金，次年起不再计租', () => {
    useEnterpriseStore.setState({ state: { ...store().state, finance: { ...store().state.finance, cash: 60 } } });
    advance(3);
    store().buyFactory('factory-2');
    // 买断确实生效（权属转 owned）：否则下面的 3M 只是"从未买断"的平凡结果
    expect(store().state.production.factories[1].holding).toBe('owned');
    store().nextQuarter(); // 第1年Q4 → 第2年Q1，此处结算第1年租金
    // 精确锁定：第 1 年只有一条租金日志，金额恰为 3M（some()+includes('3M') 会放过 13M 与重复日志）
    const year1 = rentLogs().filter(l => l.year === 1);
    expect(year1).toHaveLength(1);
    expect(year1[0].description).toBe('支付厂房租金：-厂房租金3M');
    // 跨年刷新把快照转 false（权属已是 owned），故第 2 年不该再收这笔租金——旧的按 type 硬编码会多收 3M
    advance(3); // 第2年Q4
    expect(store().state.production.factories[1].leasedThisYear).toBe(false);
    store().nextQuarter(); // 第2年Q4 → 第3年Q1：结算第2年租金
    const year2 = rentLogs().filter(l => l.year === 2);
    expect(year2).toHaveLength(1);
    expect(year2[0].description).toBe('支付厂房租金：-厂房租金0M');
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

  it('买断的厂房隔年卖掉后，次年不再收其租金（快照由跨年刷新清零）', () => {
    // 本例走的是跨年路径：第1年Q4买断 → 结算收当年3M → 跨年刷新把快照转 false
    // → 第2年Q4出售 → 第2年结算租金为 0M，即"出售不再收租"由刷新负责。
    // 注意：本例证不了 sellFactory 自己不清快照——出售时快照早已被刷新成 false，
    // 0M 归因于刷新。同年Q4"买断后立刻卖出"的漏收由下一条用例守卫（§9-7）。
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

  it('同季买断后立即出售，年末仍按快照收当年 3M 租金（sellFactory 不清快照）', () => {
    // §9-7 的漏收路径：第1年Q4 买断小厂房 → 同年Q4 就把已自有的槽位卖掉（生产线已腾空）
    // → nextQuarter 结算。不变量：只有跨年刷新写 leasedThisYear；sellFactory 若顺手清零，
    // "年末买断后同年卖出"就变成价值中立的翻转，把当年 3M 一起免掉。
    // 断言分两层：快照本身仍为 true（直接绑住 sellFactory 的写入），结算金额仍为 3M（绑住资金后果）。
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
    advance(3); // 第1年Q4
    store().buyFactory('factory-2');
    expect(store().validationError).toBeNull();
    expect(store().state.production.factories[1].holding).toBe('owned');
    store().sellFactory('factory-2');
    expect(store().validationError).toBeNull();
    expect(store().state.production.factories[1].holding).toBe('none');
    // 出售只改权属：年初租赁快照必须原样保留
    expect(store().state.production.factories[1].leasedThisYear).toBe(true);
    store().nextQuarter(); // 第1年Q4 → 第2年Q1：按快照结算第1年租金
    expect(rentLogs().find(l => l.year === 1)?.description).toBe('支付厂房租金：-厂房租金3M');
  });
});

describe('控制表导出', () => {
  it('出售厂房落在 q-12 列、购买落在 e-3 列', () => {
    useEnterpriseStore.setState({
      state: {
        ...store().state,
        finance: { ...store().state.finance, cash: 60 },
        production: { ...store().state.production, factories: store().state.production.factories.map(f => f.id === 'factory-1' ? { ...f, productionLines: [] } : f) },
      },
    });
    store().sellFactory('factory-1');
    advance(3);
    store().buyFactory('factory-2');
    const { logs, saves } = { logs: store().state.operation.financialLogs, saves: store().getSaveFiles() };
    const table = buildYearControlTable(1, logs, saves);
    // 逐字锁定导出 CSV 里真正落格的文本：q-12 售价不进现金（cashChange 0），
    // 靠季度默认分支的统一规则（有事件即填描述串）取到整串，而非 ✓ 也不是截断片段。
    expect(table.find(r => r[1] === '出售厂房')![2]).toBe('出售厂房：企业1大厂房 +40M（计入4Q应收款）');
    expect(table.find(r => r[1] === '支付租金/购买厂房')![2]).toContain('购买厂房');
  });

  // 年末行（phase !== '季度'）不受现金过滤影响，结算为 0 的租金必须显式入格——
  // 否则"本年零租金"与"数据丢了"在导出的 CSV 上无法区分。
  it('年末零租金：e-3 单元格显式显示「支付厂房租金：-厂房租金0M」', () => {
    // 第1年Q4 买断小厂房 → 跨年刷新把 leasedThisYear 转 false → 第2年租金结算为 0M
    useEnterpriseStore.setState({ state: { ...store().state, finance: { ...store().state.finance, cash: 60 } } });
    advance(3);
    store().buyFactory('factory-2');
    expect(store().validationError).toBeNull();
    store().nextQuarter(); // 第1年Q4 → 第2年Q1：结算第1年租金 3M
    advance(3); // 第2年Q4
    store().nextQuarter(); // 第2年Q4 → 第3年Q1：结算第2年租金 0M
    const table = buildYearControlTable(2, store().state.operation.financialLogs, store().getSaveFiles());
    expect(table.find(r => r[1] === '支付租金/购买厂房')![2]).toBe('支付厂房租金：-厂房租金0M');
  });

  it('年末零租金与玩家同年同季的「购买厂房」日志同格并存', () => {
    // 第1年Q4 买断小厂房并卖掉大厂房 → 第2年Q4 再买回大厂房 → 第2年租金结算为 0M：
    // 同一个 e-3 单元格里既有玩家的购买厂房（有现金变动）也有系统的零租金（cashChange 0），
    // 两条都得留（年末行走 joinLogs，不按 cashChange 过滤）。
    useEnterpriseStore.setState({
      state: {
        ...store().state,
        finance: { ...store().state.finance, cash: 200 },
        production: {
          ...store().state.production,
          factories: store().state.production.factories.map(f => f.id === 'factory-1' ? { ...f, productionLines: [] } : f),
        },
      },
    });
    advance(3); // 第1年Q4
    store().buyFactory('factory-2');
    store().sellFactory('factory-1');
    expect(store().validationError).toBeNull();
    store().nextQuarter(); // 第1年Q4 → 第2年Q1
    advance(3); // 第2年Q4
    store().buyFactory('factory-1');
    expect(store().validationError).toBeNull();
    store().nextQuarter(); // 第2年Q4 → 第3年Q1：结算第2年租金
    const e3Logs = store().state.operation.financialLogs.filter(l => l.stepId === 'e-3' && l.year === 2);
    // 零租金日志（cashChange 为 -0）确实在日志层：这正是被取消的 cashChange≠0 过滤会抹掉的那类事件
    expect(e3Logs).toHaveLength(2);
    expect(e3Logs.map(l => l.description)).toEqual(
      expect.arrayContaining(['购买厂房：企业1大厂房 -40M', '支付厂房租金：-厂房租金0M']),
    );
    const table = buildYearControlTable(2, store().state.operation.financialLogs, store().getSaveFiles());
    // 同一毫秒内落的两条日志 timestamp 相同，joinLogs 的稳定排序退回日志数组顺序（新日志在前），
    // 先后次序不具约束力：按集合锁定「两条都在、且只有这两条」；顺序本身由
    // tests/controlTable.test.ts 的年末行用例用显式 timestamp 钉死。
    const cell = table.find(r => r[1] === '支付租金/购买厂房')![2];
    expect(cell.split('；').sort()).toEqual([
      '购买厂房：企业1大厂房 -40M',
      '支付厂房租金：-厂房租金0M',
    ].sort());
  });
});
