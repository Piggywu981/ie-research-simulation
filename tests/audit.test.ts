import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEnterpriseStore, createFreshState } from '../src/store/enterpriseStore';
import { auditFrame, auditFrames, auditSummary, CALIBER_TEXT, CAUSE_TEXT, firstDivergingFrame, type FrameAudit } from '../src/utils/audit';
import { rebuildRestatedChain } from '../src/utils/restatement';
import { SAVE_FORMAT_VERSION, type FinancialLogRecord, type SaveFile } from '../src/types/enterprise';

const store = () => useEnterpriseStore.getState();

beforeEach(() => {
  useEnterpriseStore.setState({ state: createFreshState(), validationError: null });
});

const frame = (id = 's1', mutate?: (s: ReturnType<typeof createFreshState>) => void): SaveFile => {
  const state = createFreshState();
  mutate?.(state);
  return { id, name: `帧${id}`, enterpriseName: '企业1', timestamp: 1, resetCount: 0, version: SAVE_FORMAT_VERSION, state, createdAt: 'x' };
};

// 一条普通流水（显式 kind: 'flow'）：供「往帧里塞一条脏数据」那几例用，金额由调用方给，
// 不硬编码期初现金之类常数——种子那条本来就在 createFreshState() 里。
const mkFlow = (over: Partial<FinancialLogRecord>): FinancialLogRecord => ({
  id: `flow-${Math.random()}`, year: 1, quarter: 1, timestamp: 5,
  description: '手操', cashChange: 0, newCash: 0, operator: '企业1管理者', kind: 'flow', ...over,
});

// 造一份货真价实的 v3 存档：真引擎跑两季、其间两笔玩家手操，然后把它压回 v3 的形状——
// 重述串只记引擎自动项（把当季那笔手操从覆盖它的串里减掉），并删掉 v4 才有的 kind 字段
// （旧档没有 kind，靠 migrateState 按「不带 stepId 且描述含季度结束现金变动」兜底认出来）。
// 调用方需自行处于 vi.useFakeTimers() 中：每步之间推进假时钟，保证 timestamp 严格递增
// （B 式尾项按「晚于最新一条串」判，同毫秒会漏计，见下方季中存档那例）。
const buildV3LegacyArchive = (): SaveFile => {
  store().registerOtherCashFlow('旧档注资', 180);   // 第1年第1季
  expect(store().validationError).toBeNull();
  vi.advanceTimersByTime(10);
  store().nextQuarter();                            // → 第2季：串#1 的新口径应当含这笔 +180
  expect(store().validationError).toBeNull();
  vi.advanceTimersByTime(10);
  store().registerOtherCashFlow('旧档支出', -30);    // 第2季
  expect(store().validationError).toBeNull();
  vi.advanceTimersByTime(10);
  store().nextQuarter();                            // → 第3季：串#2 的新口径应当含这笔 −30
  expect(store().validationError).toBeNull();

  const legacy = JSON.parse(JSON.stringify(store().state)) as ReturnType<typeof createFreshState>;
  const manual = legacy.operation.financialLogs.filter(l => l.operator === '企业1管理者');
  // 数组是「新的在前」，故按 timestamp 定序后比对，确认这两笔手操真的都在账上且金额没被别处稀释
  expect([...manual].sort((a, b) => a.timestamp - b.timestamp).map(l => l.cashChange)).toEqual([180, -30]);
  for (const flow of manual) {
    const covered = legacy.operation.financialLogs
      .filter(l => l.kind === 'summary' && l.timestamp >= flow.timestamp)
      .sort((a, b) => a.timestamp - b.timestamp);
    expect(covered.length).toBeGreaterThan(0);       // 这笔手操确实落在某条重述串的窗口里
    covered[0].cashChange -= flow.cashChange;        // 旧口径：引擎自动项里没有它
  }
  for (const l of legacy.operation.financialLogs) delete (l as Partial<FinancialLogRecord>).kind;
  vi.advanceTimersByTime(10);                        // 冲掉上面两次推进排下的自动存档定时器

  return {
    id: 'v3-legacy', name: 'v3 旧档', enterpriseName: '企业1', timestamp: 1,
    resetCount: 0, version: 3, state: legacy, createdAt: 'x',
  };
};

// 只推进**一季**的未迁移 v3 帧（评审 round-4 new finding #1 的探针形状）。构造与 buildV3LegacyArchive
// 同源：真引擎跑一季、把覆盖那笔手操的重述串减回旧口径、再删掉 v4 才有的 kind 字段。
// 为什么只要单季：删掉那笔注资后剩下的流水恰好只有「种子 + 引擎自动项」，其净额正是旧口径串记下的那个数，
// 于是 A 与 B 相等（实测都是 18）而帧内现金是 198——B 这一侧不提供任何独立信息，印出来的判据却与 v4 帧上
// 的篡改判定逐字相同（「账实不符（流水条目与现金不符）」）。要说清「旧档的不符 ≠ 篡改」，这个区分必须
// 由 audit.ts 的文案与统计量给出，而不是让消费方各自去读 version。
// 调用方需自行处于 vi.useFakeTimers() 中（同 buildV3LegacyArchive）。
const buildUnmigratedV3Frame = (id = 'v3-coverage-escape'): SaveFile => {
  store().registerOtherCashFlow('旧档注资', 180);   // 第1年第1季，落在串#1 的窗口里
  expect(store().validationError).toBeNull();
  vi.advanceTimersByTime(10);
  store().nextQuarter();                            // → 第2季：串#1 的新口径应当含这笔 +180
  expect(store().validationError).toBeNull();

  const legacy = JSON.parse(JSON.stringify(store().state)) as ReturnType<typeof createFreshState>;
  const manual = legacy.operation.financialLogs.filter(l => l.operator === '企业1管理者');
  expect(manual.map(l => l.cashChange)).toEqual([180]);   // 只有这一笔手操，否则下面删一条就不止少 180
  for (const flow of manual) {
    const covered = legacy.operation.financialLogs
      .filter(l => l.kind === 'summary' && l.timestamp >= flow.timestamp)
      .sort((a, b) => a.timestamp - b.timestamp);
    expect(covered.length).toBeGreaterThan(0);
    covered[0].cashChange -= flow.cashChange;      // 旧口径：引擎自动项里没有它
  }
  for (const l of legacy.operation.financialLogs) delete (l as Partial<FinancialLogRecord>).kind;
  vi.advanceTimersByTime(10);                      // 冲掉推进排下的自动存档定时器

  return {
    id, name: `帧${id}`, enterpriseName: '企业1', timestamp: 1,
    resetCount: 0, version: 3, state: legacy, createdAt: 'x',
  };
};

// 把「一条流水没落账」这件事做进帧里：按描述删掉那笔注资（v3 时代确有现金变动没写进流水的形态）
const dropFlow = (save: SaveFile, description: string): SaveFile => ({
  ...save,
  state: {
    ...save.state,
    operation: {
      ...save.state.operation,
      financialLogs: save.state.operation.financialLogs.filter(l => !l.description.includes(description)),
    },
  },
});

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

  // 评审 C1：旧写法在「本帧还没有重述串」时把 B 塌回种子（20），A 却是真实现金，
  // 于是第 1 年第 1 季做过任何一笔金钱操作（注资/短贷/购线…）后手动存档，
  // 都会被指控「重述串被篡改」——而这一帧根本没有重述串可篡改。
  // latestRestatedAt = 0 时尾项自动吞下全部非种子流水，B ≡ A：没有重述串，B 就不携带独立信息。
  it('首季还没有重述串、但已有一笔手操流水：B 等价于 A，不得假报 restated-log', () => {
    store().registerOtherCashFlow('测试注资', 180);
    expect(store().validationError).toBeNull();
    const state = store().state;
    expect(state.operation.financialLogs.filter(l => l.kind === 'summary')).toHaveLength(0);

    const r = auditFrame({ ...frame('y1q1'), state });
    expect(r.status).toBe('ok');
    expect(r.cause).toBeNull();
    expect(r.actualCash).toBe(200);
    expect(r.flowRebuilt).toBe(r.actualCash);
    expect(r.restatedRebuilt).toBe(r.actualCash);
    expect(r.restatedRebuilt).toBe(r.flowRebuilt);
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
    // 钉住被篡改的那一条（评审：只按 (year,quarter,kind) 找，日志产出一变就可能改到别的行而测试照旧通过）
    const target = tampered.operation.financialLogs.find(
      l => l.year === 1 && l.quarter === 3 && l.kind === 'flow' && l.stepId === 'q-2'
        && l.description === '更新短贷：无到期短贷'
    );
    expect(target).toBeDefined();                     // 找不到目标 = 本例根本没有篡改任何一条流水
    expect(target!.cashChange).toBe(0);               // 篡改一条净额为 0 的行也能被查出来
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
      // 这 5ms 同时也把 nextQuarter 末尾排下的自动存档定时器（setTimeout(() => get().autoSaveGame(), 0)）一并冲掉，
      // 只是无害——tests/setup.ts 把 localStorage 换成了内存实现，落不掉真存档。
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
  // 评审 I1：降级必须由审计器自己落实——auditFrame 手里就握着整个 SaveFile，version < 4 时 B 只算出来供展示，
  // 不参与判定（判据退回单侧 A）。这条降级写在审计里，S-T5/S-T7/S-T8 三个消费方免费继承，
  // 不必各自再补版本分支，也不会把旧口径链当成作弊证据。做法是把首条重述串还原成旧口径
  // （减掉那笔同季注资），复现规格 §4.4 记录的实测对：A 202 = 现金 202、B 只有 22。
  it('v3 旧链（version < 4）：B 只作展示、判据降级为 A-only，健康的旧档不得被指控篡改重述串', () => {
    store().registerOtherCashFlow('测试注资', 180);
    for (let i = 0; i < 5; i++) store().nextQuarter();
    const state = store().state;
    expect(auditFrame({ ...frame('v4'), state }).status).toBe('ok');

    // financialLogs 是「新的在前」（所有产生点都 prepend），故末条 summary 就是首次推进那条
    const legacy = JSON.parse(JSON.stringify(state)) as typeof state;
    const summaries = legacy.operation.financialLogs.filter(l => l.kind === 'summary');
    expect(summaries).toHaveLength(5);
    summaries[summaries.length - 1].cashChange -= 180;   // 旧口径：该季只记引擎自动项

    const r = auditFrame({ ...frame('v3-migrated'), state: legacy, version: 3 });  // 重述口径自 v4 起，v3 及更早都是旧链
    expect(r.status).toBe('ok');                         // A 完好 → 旧档不作篡改指控（此前被钉成 restated-log 的伪证）
    expect(r.cause).toBeNull();
    expect(r.flowRebuilt).toBe(r.actualCash);
    expect(r.restatedRebuilt).toBe(r.actualCash - 180);  // 仍给出读数，供报告注明「旧口径链，不作金额结论」
  });

  // 同一条旧链上真的被动过流水时，降级不能把问题一并抹掉：A 仍不平 → mismatch。
  // 归因只能是 flow-log（CAUSE_TEXT 的「流水条目与现金不符」正是 A 不平这件事本身）；
  // restated-log 要靠 B 作证、both 要靠 B 排除，旧口径的 B 给不出这个证据。
  it('v3 旧链 + 篡改一条流水：仍报 mismatch，cause 降级为 flow-log（不用旧口径的 B 去凑 both）', () => {
    store().registerOtherCashFlow('测试注资', 180);
    for (let i = 0; i < 5; i++) store().nextQuarter();
    const legacy = JSON.parse(JSON.stringify(store().state)) as ReturnType<typeof createFreshState>;
    const summaries = legacy.operation.financialLogs.filter(l => l.kind === 'summary');
    summaries[summaries.length - 1].cashChange -= 180;   // 旧口径
    const flow = legacy.operation.financialLogs.find(l => l.year === 1 && l.quarter === 3 && l.kind === 'flow')!;
    flow.cashChange += 7;                                // 真的改了一条流水

    const r = auditFrame({ ...frame('v3-tampered'), state: legacy, version: 3 });
    expect(r.status).toBe('mismatch');
    expect(r.cause).toBe('flow-log');
    expect(r.flowRebuilt).toBe(r.actualCash + 7);
  });

  // 评审 round-1 顾虑 2（控制器裁为 Item 1）：上一例的保护只在 version < 4 时生效，而
  // saveGame/autoSaveGame 两处都无条件写 `version: SAVE_FORMAT_VERSION`，
  // 于是「载入 v3 旧档 → 继续玩 → 存档」出来的那一帧自认 v4：降级不适用，串却还是旧口径，
  // B 侧必然少算掉历史手操 → 又是一次 restated-log 伪证，而继续老档恰恰是最常态的路径。
  // 修法不在审计里而在 migrateState：旧档载入时就把串按 newCash 链换算成新口径，本例即钉这条路
  // （改动前实测：status mismatch、cause restated-log、flowRebuilt 211 = actualCash 211 而 restatedRebuilt 只有 61）。
  it('载入 v3 旧档后继续运营再存档：那一帧（标着 v4）审计必须 ok，不再假报 restated-log', () => {
    vi.useFakeTimers();
    try {
      // ① 载入旧档：migrateState 认回 kind，并把旧口径串重建成新口径
      store().loadGame(buildV3LegacyArchive());
      const loadedSummaries = store().state.operation.financialLogs.filter(l => l.kind === 'summary');
      expect(loadedSummaries).toHaveLength(2);           // kind 兜底认出来了（否则本例根本没在比重述串）

      // ② 接着玩：一笔短贷 + 一笔手操，推进一季，再手动存档
      store().applyShortTermLoan();                      // 第3季是短贷放贷期（lendingPeriods [1,6]）
      expect(store().validationError).toBeNull();
      store().registerOtherCashFlow('继续运营注资', 25);
      expect(store().validationError).toBeNull();
      vi.advanceTimersByTime(10);
      store().nextQuarter();
      expect(store().validationError).toBeNull();
      vi.advanceTimersByTime(10);
      store().saveGame();

      // ③ 那一帧标着 v4，两侧重建必须都等于现金
      const saved = store().saveFiles.find(s => !s.id.startsWith('save-auto-'));
      expect(saved).toBeDefined();
      expect(saved!.version).toBe(SAVE_FORMAT_VERSION);  // 重存把旧档抬成了 v4——正是绕过降级的地方
      const r = auditFrame(saved!);
      expect(r.status).toBe('ok');
      expect(r.cause).toBeNull();
      expect(r.flowRebuilt).toBe(r.actualCash);
      expect(r.restatedRebuilt).toBe(r.actualCash);
      expect(r.restatementCaliber).toBe('v4');           // 换算过来的串与原生 v4 帧无从区分，也不需要区分

      // ④ 自动存档那一路（nextQuarter 每季都会排下它）同样抬版本，读的是同一份已换算的内存状态
      store().autoSaveGame();
      const auto = store().saveFiles.find(s => s.id.startsWith('save-auto-'));
      expect(auto).toBeDefined();
      expect(auto!.version).toBe(SAVE_FORMAT_VERSION);
      const ra = auditFrame(auto!);
      expect(ra.status).toBe('ok');
      expect(ra.restatedRebuilt).toBe(ra.actualCash);
      expect(ra.restatementCaliber).toBe('v4');

      // ⑤ 换算的现场：落盘每一串都满足新口径的定义式（期末现金 − 上一条串的期末现金）
      const chain = saved!.state.operation.financialLogs
        .filter(l => l.kind === 'summary')
        .sort((a, b) => a.timestamp - b.timestamp);
      expect(chain).toHaveLength(3);                     // 旧档换算来的两条 + 继续玩产生的这一条
      let chainHead = 20;                                // 「初始现金」种子的 cashChange（开局 20M）
      for (const row of chain) {
        expect(row.cashChange).toBe(row.newCash - chainHead);
        chainHead = row.newCash;
      }
    } finally {
      vi.useRealTimers();
    }
  });

  // 评审 round-3 N2：cashChange 被手改成 1e999 时 JSON.parse 直接给出 Infinity，两个重建式加出
  // Infinity（或 NaN）后过 JSON.stringify 又变成 null——内存里的读数却是非有限值，既会静默传染任何
  // 后续求和/比较，也让 S-T8 的报告给一帧真有数字的存档打出 null。规格 §4.4 的「null 而非 NaN」
  // 在这里落地成：读数出门前把非有限值一律折成 null，判定语义不变（非有限帧仍然是不平，不是无从起算）。
  it('读数不为非有限值：1e999 注入后两个重建都是 null，JSON 往返后仍是 null', () => {
    const bogus = (cashChange: unknown) => frame('s1', (s) => {
      // 类型刻意收 unknown：玩家手改存档时想写什么写什么，这里要的就是「非数值也进得来」
      s.operation.financialLogs.push(mkFlow({ id: 'bogus', description: '手改出来的天文数字', cashChange: cashChange as number }));
    });
    for (const [label, r] of [
      ['Infinity', auditFrame(bogus(1e999))],       // JSON.parse('1e999') 就是 Infinity
      ['NaN', auditFrame(bogus(undefined))],        // 被删掉的 cashChange 是 undefined，加法才真出 NaN（null 会被当成 0）
    ] as const) {
      expect(r.status, label).toBe('mismatch');
      expect(r.cause, label).not.toBeNull();
      expect(r.flowRebuilt, label).toBeNull();                // 不是 Infinity、不是 NaN、也不是数字
      expect(r.restatedRebuilt, label).toBeNull();
      // 内存里就该是 null：序列化往返后仍是 null，报告与面板的读数因此同真值
      const roundTrip = JSON.parse(JSON.stringify(r)) as FrameAudit;
      expect(roundTrip.status, label).toBe('mismatch');
      expect(roundTrip.flowRebuilt, label).toBeNull();
      expect(roundTrip.restatedRebuilt, label).toBeNull();
    }
  });

  // 评审 round-3 N3：上一轮 C1 修成「帧里没有重述串时 B ≡ A」，靠的是 latestRestatedAt 取 0 让尾项谓词
  // `timestamp > 0` 吞下全部非种子流水。可这个 0 同时是「没有尾项」的哨兵：时间戳被手改成 0 或负数的那些
  // 流水会掉出 B ⇒ B ≠ A ⇒ 又假报 restated-log——C1 的形态从时间戳这里漏了回来。
  // 种子改成 -Infinity 后对真实 Date.now() 时间戳行为完全不变。
  it('零重述串 + 时间戳为 0 或负数：B 仍等价于 A，不得假报 restated-log', () => {
    store().registerOtherCashFlow('测试注资', 180);
    expect(store().validationError).toBeNull();
    for (const ts of [0, -5]) {
      const state = JSON.parse(JSON.stringify(store().state)) as ReturnType<typeof createFreshState>;
      state.operation.financialLogs.forEach(l => { l.timestamp = ts; });
      expect(state.operation.financialLogs.filter(l => l.kind === 'summary')).toHaveLength(0);

      const r = auditFrame({ ...frame(`ts${ts}`), state });
      expect(r.status).toBe('ok');                            // 这一帧没有重述串可篡改
      expect(r.cause).toBeNull();
      expect(r.actualCash).toBe(200);
      expect(r.flowRebuilt).toBe(200);
      expect(r.restatedRebuilt).toBe(r.flowRebuilt);          // 尾项吞下全部非种子流水，B ≡ A
    }
  });
});

describe('包内定位', () => {
  const stamped = (id: string, ts: number, cash: number): SaveFile =>
    ({ ...frame(id, (s) => { s.finance.cash = cash; }), timestamp: ts });

  it('最早不平的那一帧给出"自第X年第Y季起"的坐标', () => {
    const results = auditFrames([stamped('f3', 3, 99), frame('f1'), stamped('f2', 2, 20)]);
    expect(results.map(r => r.saveId)).toEqual(['f1', 'f2', 'f3']);  // 输入乱序也要按时间升序返回
    expect(firstDivergingFrame(results)?.saveId).toBe('f3');
    expect(firstDivergingFrame(results)?.quarter).toBe(1);
    // 三帧都是 frame() 造的 v4 帧，那一条 mismatch 是「改帧末现金」造出来的 → 不算旧档的不符
    expect(auditSummary(results)).toEqual({ total: 3, ok: 2, mismatch: 1, noAnchor: 0, legacyMismatch: 0 });
  });

  // 同一毫秒里落两帧是常态（手动存档与 nextQuarter 触发的自动存档可撞在同一个 Date.now() 上），
  // 而 sort 对「比较器返回 0」只保证稳定不保证次序——不写全序比较器时，谁在前取决于传入数组的顺序，
  // firstDivergingFrame 于是可能报错那一季的坐标。
  it('timestamp 相同则按 id 定序：同一毫秒的两帧不因传入顺序而改变定位', () => {
    const q2 = { ...frame('f-q2', (s) => { s.finance.cash = 99; s.operation.currentQuarter = 2; }), timestamp: 7 };
    const q1 = { ...frame('f-q1', (s) => { s.finance.cash = 99; }), timestamp: 7 };   // 新开局即第 1 年第 1 季
    for (const input of [[q2, q1], [q1, q2]]) {
      const results = auditFrames(input);
      expect(results.map(r => r.saveId)).toEqual(['f-q1', 'f-q2']);
      expect(firstDivergingFrame(results)?.quarter).toBe(1);
    }
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
    // no-anchor 那条不计进 legacyMismatch：它压根没跑成判定，与「旧档的不符 ≠ 篡改」是两回事
    expect(auditSummary(results)).toEqual({ total: 2, ok: 1, mismatch: 0, noAnchor: 1, legacyMismatch: 0 });
  });
});

// 评审 round-1 顾虑 3（控制器裁为 Item 2）：FrameAudit 里没有版本事实，S-T7 的预览与 S-T8 的报告
// 就得各自去读 SaveFile.version 补那行「旧口径链，不作金额结论」的文案——一条规则写三处，
// 正是本仓为 SAVE_FORMAT_VERSION 单点定义付过一次账的漂移形态。现在口径由审计器一次性给出。
describe('B 侧口径标记（restatementCaliber）', () => {
  it('version >= 4：报 v4，B 侧是参与判定的证据', () => {
    store().registerOtherCashFlow('测试注资', 180);
    store().nextQuarter();
    const r = auditFrame({ ...frame('v4'), state: store().state });
    expect(r.restatementCaliber).toBe('v4');
    expect(r.status).toBe('ok');
    expect(r.restatedRebuilt).toBe(r.actualCash);
  });

  // 包里存着的原始 v3 帧（没有 kind、串是旧口径）与载入后仍换不出来的残缺串，都归 legacy-unconverted：
  // 读数只能展示，不能被印成篡改证据。
  it('version < 4 且串是旧口径（含包里的原始 v3 帧）：报 legacy-unconverted', () => {
    vi.useFakeTimers();
    try {
      const v3 = buildV3LegacyArchive();
      // 未经 migrateState 的原始帧：连 kind 都没有，认不出重述串 → 保守报「未换算」
      expect(v3.state.operation.financialLogs.some(l => l.kind === 'summary')).toBe(false);
      expect(auditFrame(v3).restatementCaliber).toBe('legacy-unconverted');

      // 同一批读数带上 version 3 标签、却仍与 newCash 链矛盾的那一帧（把首条还原成旧口径）
      const legacy = JSON.parse(JSON.stringify(store().state)) as ReturnType<typeof createFreshState>;
      const summaries = legacy.operation.financialLogs.filter(l => l.kind === 'summary');
      summaries[summaries.length - 1].cashChange -= 180;   // 旧口径：引擎自动项里没有那笔注资
      const r = auditFrame({ ...v3, state: legacy });
      expect(r.restatementCaliber).toBe('legacy-unconverted');
      expect(r.status).toBe('ok');                          // 判定仍只看 A（降级没被口径字段动摇）
      expect(r.restatedRebuilt).toBe(r.actualCash - 180);   // 读数是旧口径的，所以才要这个标记
    } finally {
      vi.useRealTimers();
    }
  });

  // migrateState 换算过来、但仍带 version 3 标签的那一帧（S-T6/S-T7 导入旧包时正是这个形状）：
  // 串已经是新口径了，读数可信；判定却仍只看 A——不能靠内容反推去指控旧档（评审 C1 的假阳性形态）。
  it('version < 4 而整串已是新口径（旧档换算后）：报 legacy-converted', () => {
    vi.useFakeTimers();
    try {
      const v3 = buildV3LegacyArchive();
      store().loadGame(v3);                                 // 换算发生在这里
      const r = auditFrame({ ...v3, state: store().state });
      expect(r.restatementCaliber).toBe('legacy-converted');
      expect(r.status).toBe('ok');
      expect(r.restatedRebuilt).toBe(r.actualCash);         // 换算后的串不再少算
      expect(r.flowRebuilt).toBe(r.actualCash);
    } finally {
      vi.useRealTimers();
    }
  });
});

// 评审 round-3 N1：真正的 v3 存档里**根本没有 kind 字段**，它是 migrateState 在 loadGame 时才推断出来的。
// 而 S-T5 导出的是 getSaveFiles() 原样列表（含未迁移的 v3 帧）、S-T7 审计的是 pkg.saves 原样帧，
// 所以「按 kind 分类」这件事必须对没有 kind 的原始帧也成立，否则整个旧档包每一帧都印成「起算链不完整」，
// firstDivergingFrame 还会把最早那一帧指成问题帧。推断规则的单点是 utils/restatement.ts 的 kindOfLog。
describe('原始 v3 帧（日志没有 kind 字段）', () => {
  it('未经迁移的 v3 帧：按同一条规则认出 flow/summary，走 A-only 判定为 ok', () => {
    vi.useFakeTimers();
    try {
      const v3 = buildV3LegacyArchive();
      // 夹具造的确实是「没有 kind」的原始形状（否则本例什么都没测）
      expect(v3.state.operation.financialLogs.some(l => l.kind === undefined)).toBe(true);

      const r = auditFrame(v3);
      expect(r.status).toBe('ok');                  // 此前是 no-anchor：种子那条因没有 kind 而认不出来
      expect(r.cause).toBeNull();
      expect(r.flowRebuilt).toBe(r.actualCash);     // A 判定真的跑了（不是两侧都为 null）
      expect(r.restatedRebuilt).not.toBeNull();     // B 仍是有限读数
      expect(r.restatedRebuilt! > 0).toBe(true);
      // 旧口径链：B 比 A 少掉的恰是夹具减掉的那两笔手操（+180 与 −30，净 150）
      expect(r.restatedRebuilt).toBe(r.actualCash - 150);
      expect(r.restatementCaliber).toBe('legacy-unconverted');
    } finally {
      vi.useRealTimers();
    }
  });

  it('未经迁移的 v3 帧 + 篡改一条流水：仍报 mismatch / flow-log（A 判定没被 no-anchor 吞掉）', () => {
    vi.useFakeTimers();
    try {
      const v3 = buildV3LegacyArchive();
      const flow = v3.state.operation.financialLogs.find(l => l.description.includes('旧档注资'))!;
      expect(flow).toBeDefined();                   // 找不到的话本例根本没篡改任何一条流水
      expect(flow.stepId).toBeTruthy();             // 带 stepId ⇒ 按推断规则它是 flow
      flow.cashChange += 7;

      const r = auditFrame(v3);
      expect(r.status).toBe('mismatch');
      expect(r.cause).toBe('flow-log');             // 降级分支：旧档不用旧口径的 B 去凑证据
      expect(r.flowRebuilt).toBe(r.actualCash + 7);
      expect(r.restatedRebuilt).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('未经迁移的 v3 帧但串已是新口径：换算侧也认得没有 kind 的行', () => {
    vi.useFakeTimers();
    try {
      const v3 = buildV3LegacyArchive();
      // 不经 loadGame，直接对**没有 kind** 的原始日志跑重建：deriveRestatedChain 只认得出有 kind 的行时，
      // 这里一步都换不动（返回 false），口径只能报 legacy-unconverted
      expect(rebuildRestatedChain(v3.state.operation.financialLogs)).toBe(true);

      const r = auditFrame(v3);
      expect(r.restatementCaliber).toBe('legacy-converted');   // ← 与上面那条 legacy-unconverted 的唯一区别
      expect(r.status).toBe('ok');
      expect(r.restatedRebuilt).toBe(r.actualCash);            // 换算后 B 不再少算那 150
      expect(r.restatedRebuilt).toBe(r.flowRebuilt);
    } finally {
      vi.useRealTimers();
    }
  });

  it('推断规则同源：迁移前那一帧与迁移后那一帧的 status 一致，且 kind 仍然落进存档', () => {
    vi.useFakeTimers();
    try {
      const v3 = buildV3LegacyArchive();
      // loadGame 内部会深拷贝再迁移，这里另存一份未迁移的原件（S-T5/S-T7 审计的就是那种形状）
      const preMigration = JSON.parse(JSON.stringify(v3)) as SaveFile;

      store().loadGame(v3);
      const migrated: SaveFile = { ...v3, state: store().state };

      // 兜底回填还在（字段必须落进存档），且回填的就是同一条规则
      expect(migrated.state.operation.financialLogs.every(l => l.kind === 'flow' || l.kind === 'summary')).toBe(true);
      expect(migrated.state.operation.financialLogs.filter(l => l.kind === 'summary')).toHaveLength(2);

      const before = auditFrame(preMigration);
      const after = auditFrame(migrated);
      expect(before.status).toBe('ok');
      expect(after.status).toBe(before.status);     // 同一份账，迁移前后判定不能变
      expect(after.cause).toBe(before.cause);
    } finally {
      vi.useRealTimers();
    }
  });
});

// 评审 round-3 N1 修好后，真正的未迁移 v3 帧也开始跑 A 侧判定（这是对的：不跑就什么都看不见）。
// 副作用是：一份**天然不平**的老档（v3 时代确有现金变动没写进流水）印出来的判据，与 v4 帧上的篡改判定
// 逐字相同。数据里本来就有这个区分（restatementCaliber !== 'v4'），却一个字都没说出来——而旧的那条
// 口径文案「旧口径链，不作金额结论」说的是 **B 读数**的身份，不是 **A 判定**的含义，正好把两者搅在一起。
// 本例把这件事钉死：同一句判据、两种含义，分开说只能靠 CALIBER_TEXT 的文案与 auditSummary.legacyMismatch。
describe('旧档的「不符」与篡改分开说', () => {
  it('未迁移 v3 帧天然不平：caliber 为 legacy-unconverted、文案言明「不等于篡改」、legacyMismatch 计 1', () => {
    vi.useFakeTimers();
    try {
      const v3 = buildUnmigratedV3Frame();
      expect(v3.state.operation.financialLogs.some(l => l.kind === undefined)).toBe(true);  // 确实是未迁移形状
      // 夹具本身平账：不先钉这句，下面那句「不平」可能只是夹具写坏了而不是漏记了一笔
      const intact = auditFrame(v3);
      expect(intact.status).toBe('ok');

      const frame3 = dropFlow(v3, '旧档注资');
      const r = auditFrame(frame3);
      // 评审探针的实测对：A 与 B 都是 18、帧内现金 198（A 少的正是被删掉的那 180，B 本来就停在 18）
      expect(r.status).toBe('mismatch');
      expect(r.cause).toBe('flow-log');
      expect(r.flowRebuilt).toBe(18);
      expect(r.restatedRebuilt).toBe(18);                     // B ≡ A：这一侧给不出任何独立证据
      expect(r.actualCash).toBe(198);
      expect(r.restatementCaliber).toBe('legacy-unconverted');
      expect(CAUSE_TEXT[r.cause ?? 'both']).toBe('流水条目与现金不符');   // 与 v4 帧上的篡改判定同一句话
      expect(CALIBER_TEXT[r.restatementCaliber]).toContain('不等于篡改');  // 而这一句把它说开

      const summary = auditSummary([r]);
      expect(summary).toEqual({ total: 1, ok: 0, mismatch: 1, noAnchor: 0, legacyMismatch: 1 });
      // 平账的那一帧不计进来：legacyMismatch 是 mismatch 的**子集**（status 与 caliber 两个条件都在场），
      // 少了前半句它就退化成「旧档条数」，报告里会被读成「旧档的不符数」
      expect(auditSummary([intact, r])).toEqual({ total: 2, ok: 1, mismatch: 1, noAnchor: 0, legacyMismatch: 1 });

      // 同一份不平的账、同一条日志，只把版本标签换成 4：mismatch 照旧是 1，但它不再算进「旧档的不符」
      const r4 = auditFrame({ ...frame3, version: 4 });
      expect(r4.status).toBe('mismatch');
      expect(r4.restatementCaliber).toBe('v4');
      expect(CALIBER_TEXT[r4.restatementCaliber]).toContain('按 v4 口径判定');
      const summary4 = auditSummary([r4]);
      expect(summary4.mismatch).toBe(1);
      expect(summary4.legacyMismatch).toBe(0);                // ← 这条配对才让该统计量有意义，不是装饰
    } finally {
      vi.useRealTimers();
    }
  });
});

// S-T7 预览与 S-T8 报告共用这份措辞：cause 的三种取值必须都有对应文案，否则报告会出现 undefined
describe('cause 文案', () => {
  it('CAUSE_TEXT 覆盖三种 cause', () => {
    expect(Object.keys(CAUSE_TEXT).sort()).toEqual(['both', 'flow-log', 'restated-log']);
    expect(Object.values(CAUSE_TEXT).every(t => typeof t === 'string' && t.length > 0)).toBe(true);
  });
});
