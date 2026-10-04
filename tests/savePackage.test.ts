// 存档包的构建与序列化（规格 §4.2 包结构、§4.4 指纹口径）。
// 这里守的是"导出的字节"与"包内声明的指纹"必须一直对得上：S-T7 导入侧按前缀分派
// （`sha256:` 比值、`unavailable:*` 说「哈希未计算」），S-T8 把两者印进核对报告——
// 一旦包里的指纹与它自己声明覆盖的内容对不上，老师看到的就是「指纹不符」这条假篡改警报。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFreshState } from '../src/store/enterpriseStore';
import { buildSavePackage, packageFileName, serializePackage } from '../src/utils/savePackage';
import { canonicalStringify, digestFrame, digestText } from '../src/utils/saveDigest';
import { SAVE_FORMAT_VERSION, type SaveFile, type SavePackage } from '../src/types/enterprise';

// 真形状的帧：state 用 createFreshState()（与 store 同源），理由与 saveDigest.test.ts 相同——
// 手搓 {finance:{cash:20}} 会让"某类字段被指纹漏掉"看不出来。
const frame = (over: Partial<SaveFile> = {}): SaveFile => ({
  id: 's1',
  name: '帧1',
  enterpriseName: '企业1',
  timestamp: 1,
  resetCount: 0,
  version: SAVE_FORMAT_VERSION,
  state: createFreshState(),
  createdAt: '2026-10-04 10:00:00',
  ...over,
});

// 从序列化字节里按 §4.2 的字段名重建"包壳"（去掉 digests 自身）——整包指纹覆盖的就是这一份。
// 刻意逐字段取而不是 `delete parsed.digests`：字段名换了这里就取不到，等于把结构也钉住。
const shellFromBytes = (parsed: Record<string, unknown>) => ({
  format: parsed.format,
  packageVersion: parsed.packageVersion,
  exportedAt: parsed.exportedAt,
  app: parsed.app,
  current: parsed.current,
  saves: parsed.saves,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.doUnmock('../src/types/enterprise');
  vi.resetModules();
});

describe('存档包结构', () => {
  it('包含 current/saves 与两条指纹，序列化不带 BOM', async () => {
    const state = createFreshState();
    const pkg = await buildSavePackage(state, [frame()]);
    expect(pkg.format).toBe('ie-sandbox-save');
    expect(pkg.packageVersion).toBe(1);
    expect(pkg.saves).toHaveLength(1);
    expect(pkg.current).toEqual(state);
    // 指纹值本身不钉死：非安全上下文下 digestFrame/digestText 给的是 `unavailable:*`（规格 §4.4），
    // 消费方靠前缀分派，所以这里只钉"形状必须是这两类之一"，比值一致性另有一例。
    expect(pkg.digests.frames['s1']).toMatch(/^(sha256:[0-9a-f]{16}|unavailable:.+)$/);
    expect(pkg.digests.package).toMatch(/^(sha256:[0-9a-f]{16}|unavailable:.+)$/);
    expect(serializePackage(pkg).charCodeAt(0)).not.toBe(0xfeff);
    // app 三元组：saveVersion 引用常量（见下方专门一例）、year/quarter 跟随传入状态
    expect(pkg.app.saveVersion).toBe(SAVE_FORMAT_VERSION);
    expect(pkg.app.year).toBe(state.operation.currentYear);
    expect(pkg.app.quarter).toBe(state.operation.currentQuarter);
    // exportedAt 是 ISO 8601（规格 §4.2 注释定死的口径；locale 串会在导入侧没法排序/比对）
    expect(pkg.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(pkg.exportedAt).toISOString()).toBe(pkg.exportedAt);
    // 包顶层字段就这七个（S-T6 的结构校验与 S-T7 的预览都按这张表读）
    expect(Object.keys(pkg).sort()).toEqual(
      ['app', 'current', 'digests', 'exportedAt', 'format', 'packageVersion', 'saves'],
    );
  });

  it('空 saves 也构建成功，指纹表是空对象而不是 undefined', async () => {
    // 新局一帧没存过时导出走这条路；`{}` 与 undefined 在导入侧是两回事（"没有帧" vs "格式坏了"）
    const pkg = await buildSavePackage(createFreshState(), []);
    expect(pkg.saves).toEqual([]);
    expect(pkg.digests.frames).toEqual({});
    expect(pkg.digests.package).toMatch(/^(sha256:[0-9a-f]{16}|unavailable:.+)$/);
  });

  it('序列化是 2 空格缩进的 JSON，且 digests 真在字节里', async () => {
    const pkg = await buildSavePackage(createFreshState(), [frame()]);
    const text = serializePackage(pkg);
    expect(text).toBe(JSON.stringify(pkg, null, 2));   // 缩进 + 不加 BOM + 不加尾随换行，一次钉全
    expect(text).toMatch(/^ {2}"format": "ie-sandbox-save",$/m);
    const parsed = JSON.parse(text) as SavePackage;
    expect(parsed.digests.package).toBe(pkg.digests.package);
    expect(parsed.digests.frames).toEqual(pkg.digests.frames);
  });

  it('逐帧指纹与 digestFrame 一致，JSON 往返后仍一致', async () => {
    // 这一条是 S-T7 的地基：它拿导入文件的字节重算 digestFrame 再比包内声明，
    // 只要"写下的"与"重算的"差一点（漏字段、键序、往返漂移），正常存档就会被报成篡改。
    const pkg = await buildSavePackage(createFreshState(), [frame()]);
    expect(pkg.digests.frames['s1']).toBe(await digestFrame(pkg.saves[0]));
    const reparsed = JSON.parse(serializePackage(pkg)) as SavePackage;
    expect(await digestFrame(reparsed.saves[0])).toBe(pkg.digests.frames['s1']);
  });

  it('整包指纹不含 digests 自身：从字节里去掉 digests 重算必须等于包内声明', async () => {
    // §4.4「整包一份（不含 digests 自身）」——含进去就自指，声明值永远对不上重算值。
    // 只在真算出 sha256 时比（unavailable:* 分支另有一例），否则本机环境一换这条就假绿。
    const pkg = await buildSavePackage(createFreshState(), [frame({ id: 's1' }), frame({ id: 's2', timestamp: 2 })]);
    expect(pkg.digests.package).toMatch(/^sha256:[0-9a-f]{16}$/);
    const parsed = JSON.parse(serializePackage(pkg)) as unknown as Record<string, unknown>;
    expect(await digestText(canonicalStringify(shellFromBytes(parsed)))).toBe(pkg.digests.package);
    // 反证要说清是哪一侧：把 digests **连同**改过的字节整体去哈希，得到的必须不是声明值——
    // 这才证明声明算的是"去掉 digests 的壳"，而不是一条碰巧相等的断言（评审 Task 5 finding 3：
    // 原来这行先把 digests 剔掉再哈希，于是它与上面那行是同一个断言，零独立覆盖）。
    const tampered = JSON.parse(serializePackage(pkg)) as Record<string, unknown>;
    (tampered.digests as SavePackage['digests']).package = 'sha256:0000000000000000';
    expect(await digestText(canonicalStringify(tampered))).not.toBe(pkg.digests.package);
  });

  it('包指纹覆盖帧的展示字段，逐帧指纹不覆盖（改名会呈现"包指纹不符 + 逐帧通过"）', async () => {
    // 两帧只差 name/enterpriseName/createdAt：内容字段完全相同 → 逐帧同指纹，整包不同指纹。
    // 这是 S-T8 报告"指纹口径行"要如实说的那一幕，也是"包壳漏掉 saves"这类改动的死地处。
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-04T10:00:00.000Z'));   // 两次构建同一时刻，排除 exportedAt 干扰
    const renamed = frame({ name: '改了名', enterpriseName: '企业1', createdAt: '2026-10-04 11:00:00' });
    const pkgA = await buildSavePackage(createFreshState(), [frame()]);
    const pkgB = await buildSavePackage(createFreshState(), [renamed]);
    expect(pkgA.exportedAt).toBe('2026-10-04T10:00:00.000Z');
    expect(pkgB.digests.frames['s1']).toBe(pkgA.digests.frames['s1']);
    expect(pkgB.digests.package).not.toBe(pkgA.digests.package);
    expect(pkgB.digests.package).toMatch(/^sha256:[0-9a-f]{16}$/);
  });

  it('指纹表逐 id 一条：帧数与指纹数必须相等', async () => {
    // digests.frames 以 id 为键——"少一条"（塌了）与"多一条"（凭空冒出来）都在这里现形。
    const otherState = createFreshState();
    otherState.finance.cash += 1;
    const saves = [
      frame({ id: 'a' }),
      frame({ id: 'b', timestamp: 2 }),
      frame({ id: 'c', version: SAVE_FORMAT_VERSION + 1 }),
      frame({ id: 'd', resetCount: 1 }),
      frame({ id: 'e', state: otherState }),
    ];
    const pkg = await buildSavePackage(createFreshState(), saves);
    expect(Object.keys(pkg.digests.frames)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(Object.keys(pkg.digests.frames)).toHaveLength(pkg.saves.length);
  });

  it('逐帧指纹覆盖五个内容字段：只改其中一个，指纹必须变', async () => {
    // 每个变体与基准帧只差一个字段（id 那例反过来——其余全同、只差 id）。
    // digestFrame 的壳里少算任一个，那一例就与基准帧撞成同一指纹；而"改了就该变"正是 S-T7 比值的前提。
    const cashPlusOne = createFreshState();
    cashPlusOne.finance.cash += 1;
    // 只验 finance.cash 不够：把壳窄化成 `state: { finance }`（丢掉 operation）时，本文件仍全绿，
    // 而 `operation.financialLogs` 正是 §4.4 账实重演算要读的那份数据——指纹不再覆盖流水，
    // 改流水就只会呈现"逐帧指纹匹配"。（评审 Task 5 finding 2 的变异 M16/M17）
    const withExtraLog = createFreshState();
    withExtraLog.operation.financialLogs.push({} as never);
    const logTextEdited = createFreshState();
    logTextEdited.operation.financialLogs[0] = { ...logTextEdited.operation.financialLogs[0], description: '改了描述' };
    const digestOf = async (over: Partial<SaveFile>): Promise<string> => {
      const one = frame(over);
      const built = await buildSavePackage(createFreshState(), [one]);
      return built.digests.frames[one.id];
    };
    const base = await digestOf({});
    expect(base).toMatch(/^sha256:[0-9a-f]{16}$/);
    const changed = await Promise.all([
      digestOf({ timestamp: 2 }),
      digestOf({ version: SAVE_FORMAT_VERSION + 1 }),
      digestOf({ resetCount: 1 }),
      digestOf({ state: cashPlusOne }),
      digestOf({ state: withExtraLog }),
      digestOf({ state: logTextEdited }),
      digestOf({ id: 's1-other-id' }),
    ]);
    changed.forEach((digest) => expect(digest).not.toBe(base));
    // 反面同样成立：只改展示字段必须**不**变（规格 §4.4，改名不该读起来像篡改）
    expect(await digestOf({ name: '改了名', createdAt: '2026-10-04 12:00:00' })).toBe(base);
  });

  it('包里的 current/saves 是深拷贝：建完再改 store 不动已导出的字节', async () => {
    // 整包指纹是按建包那一刻的内容算的。若按引用留活对象，构建之后（await 期间或按钮点到下载之间）
    // 任何一次 store 变更都会让"写进文件的字节"与包内声明的指纹脱节 → 导入侧报假篡改。
    const state = createFreshState();
    const cashBefore = state.finance.cash;
    const saves = [frame()];
    const cashBeforeFrame = saves[0].state.finance.cash;
    const pkg = await buildSavePackage(state, saves);

    state.finance.cash = 999;
    saves[0].state.finance.cash = 888;
    saves.push(frame({ id: 's2' }));

    expect(pkg.current.finance.cash).toBe(cashBefore);
    expect(pkg.saves).toHaveLength(1);
    expect(pkg.saves[0].state.finance.cash).toBe(cashBeforeFrame);
    const parsed = JSON.parse(serializePackage(pkg)) as unknown as Record<string, unknown>;
    expect(await digestText(canonicalStringify(shellFromBytes(parsed)))).toBe(pkg.digests.package);
  });

  it('重复 id 明确拒绝，而不是在指纹表里静默塌成一条', async () => {
    // digests.frames 以 id 为键：两份同 id 的帧只会留下一条声明，包内"帧数"与指纹数就对不上了。
    // S-T6 在导入侧也拒重复 id，但那救不了已经导出的文件，所以导出侧先挡住并说清是哪几个 id。
    await expect(buildSavePackage(createFreshState(), [frame({ id: 'dup' }), frame({ id: 'dup' })]))
      .rejects.toThrow(/dup/);
    await expect(buildSavePackage(createFreshState(), [frame({ id: 'dup' }), frame({ id: 'dup' })]))
      .rejects.toThrow(/重复/);
    // 三帧里两个重复：只报那一个 id，健康列表不受牵连
    await expect(buildSavePackage(createFreshState(), [frame({ id: 'x' }), frame({ id: 'dup' }), frame({ id: 'dup' })]))
      .rejects.toThrow(/dup/);
  });

  it('app.saveVersion 取的是 SAVE_FORMAT_VERSION 常量，不是写死的 4', async () => {
    // 常量当前值就是 4，"引用常量"与"写死字面量"在真实存档上给得出同一个字节——只有把常量本身
    // 换掉才分得开。§5.7 那类漂移（store 写一个值、包读另一个值）正是这样溜过去的，计划前言 #3 点名要防。
    vi.resetModules();
    vi.doMock('../src/types/enterprise', async () => {
      const actual = await vi.importActual<Record<string, unknown>>('../src/types/enterprise');
      return { ...actual, SAVE_FORMAT_VERSION: 7 };
    });
    const mod = await import('../src/utils/savePackage');
    const pkg = await mod.buildSavePackage(createFreshState(), []);
    expect(pkg.app.saveVersion).toBe(7);
  });

  it('非安全上下文：两条指纹都降级成 unavailable:*，构建照常成功', async () => {
    // 规格 §4.4 表定「无 crypto.subtle → 照常执行，绝不因此判失败」：http 打开本地构建时导出
    // 必须照样产出文件，只是指纹是"未计算"，由导入侧说人话。
    vi.stubGlobal('crypto', {});
    const pkg = await buildSavePackage(createFreshState(), [frame()]);
    expect(pkg.digests.package).toBe('unavailable:insecure-context');
    expect(pkg.digests.frames['s1']).toBe('unavailable:insecure-context');
    expect(() => serializePackage(pkg)).not.toThrow();
    expect((JSON.parse(serializePackage(pkg)) as SavePackage).digests.frames['s1']).toBe('unavailable:insecure-context');
  });
});

describe('存档包文件名', () => {
  it('含企业名、年月季与 YYYYMMDDHHmm', () => {
    expect(packageFileName(2, 4, new Date('2026-10-04T18:30:00'))).toBe('企业1存档-第2年第4季-202610041830.json');
  });

  it('月/日/时/分补零到两位', () => {
    expect(packageFileName(1, 1, new Date('2026-01-02T03:04:00'))).toBe('企业1存档-第1年第1季-202601020304.json');
    // 年份四位、月份一位与两位混排时的边界（12 月、31 日、23 时）
    expect(packageFileName(5, 4, new Date('2026-12-31T23:59:00'))).toBe('企业1存档-第5年第4季-202612312359.json');
  });

  it('缺省 at 用当前时刻（按钮就是这么调的）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T08:05:00'));
    expect(packageFileName(3, 2)).toBe('企业1存档-第3年第2季-202607090805.json');
  });
});
