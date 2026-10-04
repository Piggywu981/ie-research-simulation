import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEnterpriseStore, createFreshState } from '../src/store/enterpriseStore';
import { auditFrame, auditFrames, auditSummary, CAUSE_TEXT, firstDivergingFrame } from '../src/utils/audit';
import { SAVE_FORMAT_VERSION, type SaveFile } from '../src/types/enterprise';

const store = () => useEnterpriseStore.getState();

beforeEach(() => {
  useEnterpriseStore.setState({ state: createFreshState(), validationError: null });
});

const frame = (id = 's1', mutate?: (s: ReturnType<typeof createFreshState>) => void): SaveFile => {
  const state = createFreshState();
  mutate?.(state);
  return { id, name: `帧${id}`, enterpriseName: '企业1', timestamp: 1, resetCount: 0, version: SAVE_FORMAT_VERSION, state, createdAt: 'x' };
};

describe('账实重演算（双重建）', () => {
  it('合法帧通过：两种重建都等于现金', () => {
    const r = auditFrame(frame());
    expect(r.status).toBe('ok');
    expect(r.flowRebuilt).toBe(20);
    expect(r.restatedRebuilt).toBe(20);
    expect(r.actualCash).toBe(20);
  });

  it('只改帧末现金：两种重建都不平，cause = both', () => {
    const r = auditFrame(frame('s1', (s) => { s.finance.cash += 30; }));
    expect(r.status).toBe('mismatch');
    expect(r.cause).toBe('both');
    expect(r.flowRebuilt).toBe(20);
    expect(r.actualCash).toBe(50);
  });

  it('只改一条 summary 重述串：A 成 B 败，cause = restated-log', () => {
    const r = auditFrame(frame('s1', (s) => {
      s.operation.financialLogs.push({
        id: 'sum1', year: 1, quarter: 1, timestamp: 2, description: '第1年第1季度结束现金变动: 结余20M',
        cashChange: -8, newCash: 12, operator: '系统自动', stepId: undefined, kind: 'summary',
      });
    }));
    expect(r.status).toBe('mismatch');
    expect(r.cause).toBe('restated-log');           // Σflow 仍等于现金，只有重述线被拉歪
  });

  it('缺初始现金种子时报 no-anchor 而非 mismatch', () => {
    const r = auditFrame(frame('s1', (s) => { s.operation.financialLogs = []; }));
    expect(r.status).toBe('no-anchor');
    expect(r.cause).toBeNull();
  });

  it('真跑 5 季：未篡改必须 ok，篡改一季流水后 cause = flow-log', () => {
    store().registerOtherCashFlow('测试注资', 180);   // 注入必须入账，否则 A/B 双双不平（规格 §2 勘误）
    for (let i = 0; i < 5; i++) store().nextQuarter();
    const state = store().state;

    const untouched = auditFrame({ ...frame('real'), state });
    expect(untouched.status).toBe('ok');             // 真实运行结果天然平账，这是本任务最重要的断言
    expect(untouched.flowRebuilt).toBe(untouched.actualCash);
    expect(untouched.restatedRebuilt).toBe(untouched.actualCash);

    const tampered = JSON.parse(JSON.stringify(state)) as typeof state;
    const target = tampered.operation.financialLogs.find(l => l.year === 1 && l.quarter === 3 && l.kind === 'flow');
    target!.cashChange += 7;
    const r = auditFrame({ ...frame('tampered'), state: tampered });
    expect(r.status).toBe('mismatch');
    expect(r.cause).toBe('flow-log');                // 重述线仍与现金吻合，只有流水被改
  });

  // B 式的尾随项按 timestamp 判「晚于最新一条重述串」，而 Date.now() 只有毫秒精度：
  // 引擎推进与玩家手操落在同一毫秒里就会被判成「不晚于」而漏计（实测 A/B/现金 = 67/17/67，假报 restated-log）。
  // 真实手操隔着的是秒，故用假时钟把两者隔开，同时也把这条精度前提钉在测试里。
  it('季中手动存档（最后一条重述串之后还有流水）：B 的尾随项补得上，仍为 ok', () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 2; i++) store().nextQuarter();   // 走到第 3 季初：短贷只在 1/3 季初放贷
      vi.advanceTimersByTime(5);                            // 推进之后再过 5ms 才手操
      store().registerOtherCashFlow('季中收入', 30);         // 晚于最新 summary 的玩家流水
      store().applyShortTermLoan();                         // 同上，且金额不为 0
      const state = store().state;
      expect(store().validationError).toBeNull();           // 两笔操作都真的落账了

      const latestSummaryTs = state.operation.financialLogs
        .filter(l => l.kind === 'summary')
        .reduce((t, l) => Math.max(t, l.timestamp), 0);
      // 尾随流水确实存在且恰为这两笔（30 + 20）——否则本例根本没有检验尾随项
      expect(state.operation.financialLogs
        .filter(l => l.kind === 'flow' && l.timestamp > latestSummaryTs)
        .reduce((t, l) => t + l.cashChange, 0)).toBe(50);

      const untouched = auditFrame({ ...frame('midq'), state });
      expect(untouched.status).toBe('ok');
      expect(untouched.restatedRebuilt).toBe(untouched.actualCash);

      // 同帧篡改那条 summary：A 仍平、B 破，cause 指向重述串
      const tampered = JSON.parse(JSON.stringify(state)) as typeof state;
      const summary = tampered.operation.financialLogs.find(l => l.kind === 'summary')!;
      summary.cashChange += 11;
      const r = auditFrame({ ...frame('midq-tampered'), state: tampered });
      expect(r.status).toBe('mismatch');
      expect(r.cause).toBe('restated-log');
    } finally {
      vi.useRealTimers();
    }
  });

  // 已知边界（规格 §4.4 第四次更正的推论）：v3 存档里的重述串是旧口径（只累加引擎自动项、漏掉玩家主动交易），
  // 迁移不会重写这些值，于是 Σ summary 不再望远镜收敛到「期末现金 − 种子」，B 侧必然不平。
  // 这条断言把「旧档只报状态、不作金额结论」钉住：S-T7/S-T8 需按 SaveFile.version < 4 分述，
  // 不能把这种帧当成作弊证据。做法是把首条重述串还原成旧口径（减掉那笔同季注资），
  // 复现规格 §4.4 记录的实测对：A 202 = 现金 202、B 只有 22。
  it('v3 旧口径的重述串混进链里：B 少算玩家项、cause = restated-log（消费方须按 version 分述）', () => {
    store().registerOtherCashFlow('测试注资', 180);
    for (let i = 0; i < 5; i++) store().nextQuarter();
    const state = store().state;
    const current = auditFrame({ ...frame('v4'), state });
    expect(current.status).toBe('ok');

    // financialLogs 是「新的在前」（所有产生点都 prepend），故末条 summary 就是首次推进那条
    const legacy = JSON.parse(JSON.stringify(state)) as typeof state;
    const summaries = legacy.operation.financialLogs.filter(l => l.kind === 'summary');
    expect(summaries).toHaveLength(5);
    summaries[summaries.length - 1].cashChange -= 180;   // 旧口径：该季只记引擎自动项

    const r = auditFrame({ ...frame('v3-migrated'), state: legacy });
    expect(r.status).toBe('mismatch');
    expect(r.cause).toBe('restated-log');                // A 侧完好：只有重述链的口径是旧的
    expect(r.flowRebuilt).toBe(r.actualCash);
    expect(r.restatedRebuilt).toBe(r.actualCash - 180);
  });
});

describe('包内定位', () => {
  const stamped = (id: string, ts: number, cash: number): SaveFile =>
    ({ ...frame(id, (s) => { s.finance.cash = cash; }), timestamp: ts });

  it('最早不平的那一帧给出"自第X年第Y季起"的坐标', () => {
    const results = auditFrames([stamped('f3', 3, 99), frame('f1', (s) => { s.operation.currentQuarter = 1; }), stamped('f2', 2, 20)]);
    expect(results.map(r => r.saveId)).toEqual(['f1', 'f2', 'f3']);  // 输入乱序也要按时间升序返回
    expect(firstDivergingFrame(results)?.saveId).toBe('f3');
    expect(firstDivergingFrame(results)?.quarter).toBe(1);
    expect(auditSummary(results)).toEqual({ total: 3, ok: 2, mismatch: 1, noAnchor: 0 });
  });

  it('全部通过时 firstDivergingFrame 返回 null', () => {
    expect(firstDivergingFrame(auditFrames([frame('a'), frame('b')]))).toBeNull();
  });

  it('入参数组不被就地改序；no-anchor 帧也算「有问题的最早一帧」，重建值为 null 不是 NaN', () => {
    const frames: SaveFile[] = [
      { ...frame('later'), timestamp: 2 },
      { ...frame('earlier', (s) => { s.operation.financialLogs = []; }), timestamp: 1 },
    ];
    const ids = frames.map(f => f.id);
    const results = auditFrames(frames);
    expect(frames.map(f => f.id)).toEqual(ids);                       // 原数组顺序未被 sort 污染
    expect(results.map(r => r.saveId)).toEqual(['earlier', 'later']);  // 按 timestamp 升序
    expect(firstDivergingFrame(results)?.saveId).toBe('earlier');      // no-anchor 也计入「不平」
    expect(results[0].flowRebuilt).toBeNull();                         // NaN 会让下游求和/比较静默失真
    expect(results[0].restatedRebuilt).toBeNull();
    expect(auditSummary(results)).toEqual({ total: 2, ok: 1, mismatch: 0, noAnchor: 1 });
  });
});

// S-T7 预览与 S-T8 报告共用这份措辞：cause 的三种取值必须都有对应文案，否则报告会出现 undefined
describe('cause 文案', () => {
  it('CAUSE_TEXT 覆盖三种 cause', () => {
    expect(Object.keys(CAUSE_TEXT).sort()).toEqual(['both', 'flow-log', 'restated-log']);
    expect(Object.values(CAUSE_TEXT).every(t => typeof t === 'string' && t.length > 0)).toBe(true);
  });
});
