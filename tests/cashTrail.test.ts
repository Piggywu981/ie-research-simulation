import { beforeEach, describe, expect, it } from 'vitest';
import { useEnterpriseStore, createFreshState } from '../src/store/enterpriseStore';
import { calculateQuarterTotal } from '../src/components/OperationCenter';
import type { FinancialLogRecord } from '../src/types/enterprise';

const store = () => useEnterpriseStore.getState();
const flowSum = (logs: FinancialLogRecord[]) =>
  logs.filter(l => l.kind === 'flow').reduce((t, l) => t + l.cashChange, 0);
const mkLog = (over: Partial<FinancialLogRecord>): FinancialLogRecord => ({
  id: `log-${Math.random()}`,
  year: 1,
  quarter: 1,
  timestamp: Math.random(),
  description: '',
  cashChange: 0,
  newCash: 0,
  operator: '测试',
  kind: 'flow',
  ...over,
});

beforeEach(() => {
  useEnterpriseStore.setState({ state: createFreshState(), validationError: null });
});

describe('现金流水账不变量', () => {
  it('初始帧：Σflow 直接等于现金，且无需外部锚点常数', () => {
    const s = store().state;
    expect(flowSum(s.operation.financialLogs)).toBe(s.finance.cash);
    expect(s.operation.financialLogs.filter(l => l.kind === 'summary')).toHaveLength(0);
  });

  // 规格 §2 的探针是把现金「静默」改成 200M（这笔变动故意不记日志），那种帧上
  // Σflow(=10) 必然比 cash(=190) 少 180，无从满足 §4.4 的「无锚点常数」重演算。
  // 此处把同一笔注资改走 registerOtherCashFlow 落账，其余脚本（短贷+贴现+8 季）不变，
  // 于是断言能与 §4.4 的字面公式严格一致：Σflow === 该帧 cash，且不需要任何外部锚点。
  it('脚本化 8 个季度：Σflow === 期末现金，且恰好产出 8 条 summary', () => {
    store().registerOtherCashFlow('探针注资（使 8 季推进不透支）', 180);
    store().applyShortTermLoan();
    store().discountReceivable(7);
    for (let i = 0; i < 8; i++) store().nextQuarter();

    const logs = store().state.operation.financialLogs;
    const summaries = logs.filter(l => l.kind === 'summary');
    expect(summaries).toHaveLength(8);
    // S-T3 口径更正（规格 §4.4 第四次更正）：summary 改为「自上一条重述串以来的全部净变动」，
    // 于是 Σ summary 望远镜式收敛到 期末现金 − 期初种子 = 190 − 20 = 170。
    // 旧口径（只累加引擎自动项）在同一脚本下实测 -36；两者差的 206M 正是本脚本里全部玩家主动入账项
    // （注资 180M + 短贷放款 + 贴现收现）——旧口径把它们全漏了，B 式重建因此必然少算。
    expect(summaries.reduce((t, l) => t + l.cashChange, 0)).toBe(170);
    // 关键：把 summary 加回 flow 合计就会得到 360，与期末现金 190 不符（重复计 170M；
    // 规格 §2 记的 -36M/154 是同一结论在旧口径下的实测值）
    expect(logs.reduce((t, l) => t + l.cashChange, 0)).toBe(360);
    expect(flowSum(logs)).toBe(store().state.finance.cash);
  });

  it('每条 flow 日志的 newCash 都不为 0 占位', () => {
    // 注资同样走账（与上一例同法）：直接 setState 改 cash 会让这帧的账实对不上
    store().registerOtherCashFlow('测试注资', 180);
    // 必须买一条真有安装期的线：semi-automatic 安装 2 季，之后两季各付 4M 分期；
    // manual 的安装期是 0，买来即 running，安装分期日志压根不产生（评审 S-T1 Important 1）
    store().addProductionLine('factory-1', 'semi-automatic', 'P1');
    for (let i = 0; i < 8; i++) store().nextQuarter();

    const logs = store().state.operation.financialLogs;
    // 三处曾逃逸回填的站点，逐个用「本次跑法真的产出了这类日志、且它的余额不是占位 0」来钉：
    // 安装分期看分期日志本身（首期款日志总带真实余额，不能替它作证）、自动开工看 q-10、警告看描述
    expect(logs.some(l => l.description.includes('安装投资分期') && l.newCash !== 0)).toBe(true);
    expect(logs.filter(l => l.stepId === 'q-10')).not.toHaveLength(0);
    expect(logs.filter(l => l.description.includes('市场维护警告'))).not.toHaveLength(0);

    const bad = logs
      .filter(l => l.kind === 'flow' && l.cashChange !== 0 && l.newCash === 0);
    expect(bad).toEqual([]);

    // 市场放弃警告的 cashChange 为 0，按上面那条豁免规则查不出它的占位值，故单独钉它的回填结果：
    // 它现在在统一回填之前就入列，是年末序列里最后被回填的一条，回填后应等于期末现金
    const warn = logs.find(l => l.description.includes('市场维护警告'))!;
    expect(warn.newCash).toBe(store().state.finance.cash);
  });

  it('summary 的 cashChange 覆盖整季全部净变动（含玩家主动交易）', () => {
    store().registerOtherCashFlow('测试注资', 180);   // 玩家主动、引擎自动项之外的现金变动
    store().nextQuarter();
    const state = store().state;
    const summaries = state.operation.financialLogs.filter(l => l.kind === 'summary');
    expect(summaries).toHaveLength(1);
    // 重述串自「上一条重述串的期末现金」起算，首条回退到 初始现金 种子 20M；
    // 这 180M 注资与首次推进同季，故必须被计进这一条 —— 真实净变动 = 期末现金 − 20。
    expect(summaries[0].cashChange).toBe(state.finance.cash - 20);
    // 旧口径（finalCashChange，只累加引擎自动项）恰好漏掉这笔注资：差额必须正好是 180M，
    // 否则说明它要么少计了玩家操作、要么多计了引擎项。
    expect(summaries[0].cashChange - (state.finance.cash - 200)).toBe(180);
  });

  // 评审 I2：重述链的链头读的是上一条 summary 的 newCash，但 migrateState 只补 kind、不回填 newCash，
  // 所以接着 v1/v2 档案推进时 previousRestatedCash = undefined，
  // restatedDelta = finalCash - undefined = NaN 会被原样写进 quarterEndLog.cashChange 并随存档落盘
  // （brief 明令审计侧不得引入 NaN，这条把同一个隐患从写入端堵住）。
  it('链头 summary 缺 newCash（v1/v2 旧档）：重述串退回种子链头，绝不写出 NaN', () => {
    store().registerOtherCashFlow('测试注资', 180);
    store().nextQuarter();

    const legacy = JSON.parse(JSON.stringify(store().state)) as ReturnType<typeof createFreshState>;
    legacy.operation.financialLogs.forEach(l => {
      if (l.kind === 'summary') delete (l as Partial<FinancialLogRecord>).newCash;   // 模拟 migrateState 不补的这个字段
    });
    expect(legacy.operation.financialLogs.some(l => l.kind === 'summary' && l.newCash === undefined)).toBe(true);
    useEnterpriseStore.setState({ state: legacy, validationError: null });

    store().nextQuarter();
    const summaries = store().state.operation.financialLogs.filter(l => l.kind === 'summary');
    expect(summaries).toHaveLength(2);
    // 本例的结论：新串必须是有限数，且取的是种子链头 20（旧档余额已不可信，只能退回可核实的最早锚点）
    expect(Number.isFinite(summaries[0].cashChange)).toBe(true);
    expect(summaries[0].cashChange).toBe(store().state.finance.cash - 20);
  });

  // 真实跑法（不注资、不改数）才是不变量的主场：S-T3 的「未篡改必须审计为 ok」直接依赖这条
  it('真实 5 季推进（无任何注入）：Σflow === 现金，每季恰好一条 summary', () => {
    for (let i = 0; i < 5; i++) store().nextQuarter();
    const s = store().state;
    const logs = s.operation.financialLogs;
    expect(store().validationError).toBeNull();
    expect(flowSum(logs)).toBe(s.finance.cash);
    expect(logs.filter(l => l.kind === 'summary')).toHaveLength(5);
    expect(logs.filter(l => l.kind === 'flow' && l.cashChange !== 0 && l.newCash === 0)).toEqual([]);
  });
});

// 页面侧消费方（运行控制中心「入库（收入）数量合计」/「出库（现金支出）合计」两格）此前对整季
// 全部日志求和，等于把 summary 重述的整季净额再加一遍；判据与 CSV 导出器同源：只加 flow（规格 §4.1、§7 验收 3）。
describe('页面季度合计只加 flow', () => {
  it('合成日志：summary 重述整季净额，也不改变页面的收入/支出合计', () => {
    const flows = [
      mkLog({ stepId: 'q-11', description: '收现', cashChange: 5, newCash: 45 }),
      mkLog({ stepId: 'q-16', description: '行政', cashChange: -1, newCash: 44 }),
    ];
    const summary = mkLog({
      description: '第1年第1季度结束现金变动: 应收账款收现 5M - 行政管理费 1M',
      cashChange: 4,
      newCash: 44,
      operator: '系统自动',
      kind: 'summary',
    });

    expect(calculateQuarterTotal(flows, 1, 1, true)).toBe(5);
    expect(calculateQuarterTotal(flows, 1, 1, false)).toBe(-1);
    expect(calculateQuarterTotal([...flows, summary], 1, 1, true)).toBe(5);
    expect(calculateQuarterTotal([...flows, summary], 1, 1, false)).toBe(-1);
  });

  it('真实 4 季推进：逐季去掉 summary 后页面合计不变', () => {
    for (let i = 0; i < 4; i++) store().nextQuarter();
    const logs = store().state.operation.financialLogs;
    const summaries = logs.filter(l => l.kind === 'summary');
    expect(summaries).toHaveLength(4);
    const flowOnly = logs.filter(l => l.kind === 'flow');

    for (const s of summaries) {
      // 有非零净额的季度（进入第4季度扣行政费）才会真正区分两种算法，故逐季比对
      expect(calculateQuarterTotal(logs, s.year, s.quarter, true))
        .toBe(calculateQuarterTotal(flowOnly, s.year, s.quarter, true));
      expect(calculateQuarterTotal(logs, s.year, s.quarter, false))
        .toBe(calculateQuarterTotal(flowOnly, s.year, s.quarter, false));
    }
  });
});
