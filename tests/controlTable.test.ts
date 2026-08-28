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

  it('现金变动步骤填日志描述，非现金步骤填 ✓', () => {
    const logs = [
      mkLog({ year: 1, quarter: 1, stepId: 'q-17', description: '-2M(广告费)', cashChange: -2 }),
      mkLog({ year: 1, quarter: 1, stepId: 'q-7', description: '完工入库', cashChange: 0 }),
    ];
    const table = rows(1, logs, []);
    expect(table.find(r => r[1].includes('其他现金收支'))![2]).toBe('-2M(广告费)');
    expect(table.find(r => r[1].includes('完工入库'))![2]).toBe('✓');
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
    const q19 = table.find(r => r[1].includes('出库（现金支出）'))!;
    expect(q19[2]).toContain('M');
    const csv = toCSV(table, 1);
    expect(csv).toContain('第1年运行控制表');
  });
});

function advance3(next: () => void) {
  for (let i = 0; i < 3; i++) next();
}
