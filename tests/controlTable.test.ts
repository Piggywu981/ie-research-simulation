import { describe, it, expect } from 'vitest';
import { buildYearControlTable, toCSV, CONTROL_STEPS } from '../src/utils/controlTable';
import type { FinancialLogRecord, SaveFile, EnterpriseState } from '../src/types/enterprise';

const mkLog = (over: Partial<FinancialLogRecord>): FinancialLogRecord => ({
  id: `log-${Math.random()}`,
  year: 1,
  quarter: 1,
  timestamp: Math.random(),
  description: '',
  cashChange: 0,
  newCash: 0,
  operator: '测试',
  // 默认按流水记账，测试可用 { kind: 'summary' } 覆盖（Task 2 的过滤用例依赖此覆盖）
  kind: 'flow',
  ...over,
});

const mkSave = (year: number, quarter: number, cash: number, r1: number, p1: number): SaveFile => ({
  id: `save-${year}-${quarter}`,
  name: '测试存档',
  enterpriseName: '企业1',
  timestamp: year * 100 + quarter,
  resetCount: 0,
  version: 2,
  createdAt: '',
  state: {
    operation: { currentYear: year, currentQuarter: quarter },
    finance: { cash },
    logistics: { rawMaterials: [{ type: 'R1', quantity: r1 }], finishedProducts: [{ type: 'P1', quantity: p1 }] },
  } as unknown as EnterpriseState,
});

const rows = (year: number, logs: FinancialLogRecord[], saves: SaveFile[]) =>
  buildYearControlTable(year, logs, saves);

describe('运行控制表结构', () => {
  it('步骤表共30行：年初4 + 季度20 + 年末6', () => {
    expect(CONTROL_STEPS).toHaveLength(30);
    expect(CONTROL_STEPS.filter(s => s.phase === '年初')).toHaveLength(4);
    expect(CONTROL_STEPS.filter(s => s.phase === '季度')).toHaveLength(20);
    expect(CONTROL_STEPS.filter(s => s.phase === '年末')).toHaveLength(6);
  });

  it('生成6列表格且序号连续', () => {
    const table = rows(1, [], []);
    expect(table).toHaveLength(30);
    table.forEach((r, i) => {
      expect(r).toHaveLength(6);
      expect(r[0]).toBe(String(i + 1));
    });
  });
});

describe('单元格填充', () => {
  it('q-1 盘点：优先用存档快照格式 (现金,原料,成品)', () => {
    const saves = [mkSave(1, 1, 20, 3, 3)];
    const table = rows(1, [], saves);
    const q1Row = table.find(r => r[1].includes('季初现金盘点'))!;
    expect(q1Row[2]).toBe('(20M，3R1，3P1)');
  });

  it('无快照时回退盘点日志', () => {
    const logs = [mkLog({ year: 1, quarter: 2, stepId: 'q-1', description: '(15M，1R1，2P1)' })];
    const table = rows(1, logs, []);
    const q1Row = table.find(r => r[1].includes('季初现金盘点'))!;
    expect(q1Row[3]).toBe('(15M，1R1，2P1)');
  });

  it('季度单元格统一填事件描述串：现金与非现金事件同一条规则（规格 §4.12）', () => {
    const logs = [
      mkLog({ year: 1, quarter: 1, stepId: 'q-17', description: '-2M(广告费)', cashChange: -2 }),
      mkLog({ year: 1, quarter: 1, stepId: 'q-7', description: '完工入库', cashChange: 0 }),
      mkLog({ year: 1, quarter: 2, stepId: 'q-14', description: '按订单交货：3*P1(订单总额15M，账期2Q)', cashChange: 0 }),
      mkLog({ year: 1, quarter: 3, stepId: 'q-12', description: '出售厂房：企业1大厂房 +40M（计入4Q应收款）', cashChange: 0 }),
    ];
    const table = rows(1, logs, []);
    expect(table.find(r => r[1].includes('其他现金收支'))![2]).toBe('-2M(广告费)');
    // 非现金事件（完工入库/交货/出售厂房）与现金事件走同一取数：填描述串，不再是 ✓
    expect(table.find(r => r[1].includes('完工入库'))![2]).toBe('完工入库');
    expect(table.find(r => r[1] === '按订单交货')![3]).toBe('按订单交货：3*P1(订单总额15M，账期2Q)');
    expect(table.find(r => r[1] === '出售厂房')![4]).toBe('出售厂房：企业1大厂房 +40M（计入4Q应收款）');
  });

  it('年末行同格并存：玩家购买厂房与结算为 0 的租金都入格', () => {
    const logs = [
      mkLog({ quarter: 4, stepId: 'e-3', description: '购买厂房：企业1大厂房 -40M', cashChange: -40, timestamp: 100 }),
      mkLog({ quarter: 4, stepId: 'e-3', description: '支付厂房租金：-厂房租金0M', cashChange: 0, timestamp: 200 }),
    ];
    const table = rows(1, logs, []);
    // joinLogs 按 timestamp 升序；年末行不过滤 cashChange，零租金行不会被并成 ✓ 或丢掉
    expect(table.find(r => r[1] === '支付租金/购买厂房')![2])
      .toBe('购买厂房：企业1大厂房 -40M；支付厂房租金：-厂房租金0M');
  });

  it('q-18/q-19 汇总本季现金收支', () => {
    const logs = [
      mkLog({ year: 1, quarter: 1, stepId: 'q-11', description: '收现', cashChange: 15 }),
      mkLog({ year: 1, quarter: 1, stepId: 'q-17', description: '广告', cashChange: -2 }),
      mkLog({ year: 1, quarter: 1, stepId: 'q-16', description: '行政', cashChange: -1 }),
    ];
    const table = rows(1, logs, []);
    expect(table.find(r => r[1].includes('入库（收入）'))![2]).toBe('15M');
    expect(table.find(r => r[1].includes('出库（现金支出）'))![2]).toBe('-3M');
  });

  it('q-20 结余取下一季度快照现金', () => {
    const saves = [mkSave(1, 2, 33, 0, 0)];
    const table = rows(1, [], saves);
    expect(table.find(r => r[1].includes('本季库存（现金）结余'))![2]).toBe('33M');
  });

  it('年初/年末行数据填在季度1列', () => {
    const logs = [
      mkLog({ year: 1, quarter: 1, stepId: 'b-4', description: '支付应付税：-所得税1M', cashChange: -1 }),
      mkLog({ year: 1, quarter: 4, stepId: 'e-2', description: '支付设备维护费：-设备维护费2M', cashChange: -2 }),
    ];
    const table = rows(1, logs, []);
    expect(table.find(r => r[1] === '支付应付税')![2]).toBe('支付应付税：-所得税1M');
    expect(table.find(r => r[1] === '支付设备维护费')![2]).toBe('支付设备维护费：-设备维护费2M');
  });
});

describe('空白行/空白格填充', () => {
  it('任何行都不完全空白（无数据格填 —）', () => {
    const table = rows(1, [], []);
    table.forEach((r) => {
      expect(r.slice(2).some(cell => cell !== '')).toBe(true);
    });
  });

  it('季度行：无事件的四个季度格全部填 —', () => {
    const table = rows(1, [], []);
    const disabledRows = table.filter(r => r[1].startsWith('（单企业无交易对手'));
    expect(disabledRows).toHaveLength(2);
    disabledRows.forEach(r => {
      expect(r.slice(2)).toEqual(['—', '—', '—', '—']);
    });
    expect(table.find(r => r[1] === '出售厂房')!.slice(2)).toEqual(['—', '—', '—', '—']);
    expect(table.find(r => r[1].includes('更新应付账款'))!.slice(2)).toEqual(['—', '—', '—', '—']);
  });

  it('已运营年份：年初规划/计划行固定勾选；未运营年份填 —', () => {
    const empty = rows(1, [], []);
    expect(empty.find(r => r[1] === '新年度规划会议')![2]).toBe('—');
    expect(empty.find(r => r[1] === '制定新年度计划')![2]).toBe('—');

    const logs = [mkLog({ year: 1, quarter: 1, stepId: 'q-16', description: '行政', cashChange: -1 })];
    const played = rows(1, logs, []);
    expect(played.find(r => r[1] === '新年度规划会议')![2]).toBe('✓');
    expect(played.find(r => r[1] === '制定新年度计划')![2]).toBe('✓');
  });

  it('有日志的步骤行仍显示真实数据，不被 — 覆盖', () => {
    const logs = [
      mkLog({ year: 1, quarter: 1, stepId: 'b-4', description: '支付应付税：-所得税1M', cashChange: -1 }),
      mkLog({ year: 1, quarter: 3, stepId: 'q-3', description: '-20M(短期贷款)', cashChange: -20 }),
    ];
    const table = rows(1, logs, []);
    expect(table.find(r => r[1] === '支付应付税')![2]).toBe('支付应付税：-所得税1M');
    expect(table.find(r => r[1].includes('申请短期贷款'))![4]).toBe('-20M(短期贷款)');
    expect(table.find(r => r[1].includes('申请短期贷款'))![2]).toBe('—');
  });
});

describe('CSV 导出', () => {
  it('首行为标题跨列占位，第二行为表头', () => {
    const csv = toCSV(rows(1, [], []), 1);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('第1年运行控制表,,,,,');
    expect(lines[1]).toBe('序号,操作名称,季度1,季度2,季度3,季度4');
    expect(lines).toHaveLength(32);
  });

  it('含逗号的单元格加引号转义', () => {
    const logs = [mkLog({ year: 1, quarter: 1, stepId: 'q-17', description: '-1M(其他,测试)', cashChange: -1 })];
    const csv = toCSV(rows(1, logs, []), 1);
    expect(csv).toContain('"-1M(其他,测试)"');
  });
});

describe('store 端到端：第1年控制表', () => {
  it('运营一年后导出的控制表包含关键数据', async () => {
    const { useEnterpriseStore, createFreshState } = await import('../src/store/enterpriseStore');
    useEnterpriseStore.setState({ state: createFreshState(), validationError: null });
    const store = () => useEnterpriseStore.getState();
    store().placeAdvertisement(2);
    store().enterOrderMeeting();
    advance3(store().nextQuarter);
    const logs = store().state.operation.financialLogs;
    const saves = store().saveFiles;
    const table = buildYearControlTable(1, logs, saves);
    const adRow = table.find(r => r[1].includes('其他现金收支'))!;
    expect(adRow[2]).toContain('广告费');
    const b2Row = table.find(r => r[1].includes('参加订货会'))!;
    expect(b2Row[2]).toContain('订货会');
    const q19 = table.find(r => r[1].includes('出库（现金支出）'))!;
    expect(q19[2]).toContain('M');
    const csv = toCSV(table, 1);
    expect(csv).toContain('第1年运行控制表');
    // 导出表中不允许出现完全空白的行
    csv.split('\n').slice(2).forEach(line => {
      expect(line.replace(/,/g, '')).not.toBe('');
    });
  });
});

function advance3(next: () => void) {
  for (let i = 0; i < 3; i++) next();
}
