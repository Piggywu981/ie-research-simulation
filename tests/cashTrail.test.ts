import { beforeEach, describe, expect, it } from 'vitest';
import { useEnterpriseStore, createFreshState } from '../src/store/enterpriseStore';
import type { FinancialLogRecord } from '../src/types/enterprise';

const store = () => useEnterpriseStore.getState();
const flowSum = (logs: FinancialLogRecord[]) =>
  logs.filter(l => l.kind === 'flow').reduce((t, l) => t + l.cashChange, 0);

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
  it('脚本化 8 个季度：Σflow === 期末现金，且恰好产出 8 条 summary 共 -36M', () => {
    store().registerOtherCashFlow('探针注资（使 8 季推进不透支）', 180);
    store().applyShortTermLoan();
    store().discountReceivable(7);
    for (let i = 0; i < 8; i++) store().nextQuarter();

    const logs = store().state.operation.financialLogs;
    const summaries = logs.filter(l => l.kind === 'summary');
    expect(summaries).toHaveLength(8);
    expect(summaries.reduce((t, l) => t + l.cashChange, 0)).toBe(-36);
    // 关键：把 summary 加回去就会得到 154，与期末现金 190 不符（重复计 36M，规格 §2 实测）
    expect(logs.reduce((t, l) => t + l.cashChange, 0)).toBe(154);
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
