// 存档包的构建与序列化（规格 §4.2 包结构、§4.4 指纹口径）。
// 这里守的是"导出的字节"与"包内声明的指纹"必须一直对得上：S-T7 导入侧按前缀分派
// （`sha256:` 比值、`unavailable:*` 说「哈希未计算」），S-T8 把两者印进核对报告——
// 一旦包里的指纹与它自己声明覆盖的内容对不上，老师看到的就是「指纹不符」这条假篡改警报。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFreshState, useEnterpriseStore } from '../src/store/enterpriseStore';
import { auditFrame, auditFrames } from '../src/utils/audit';
import { buildSavePackage, packageFileName, parseSavePackage, serializePackage } from '../src/utils/savePackage';
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

// ══ S-T6 导入解析与结构校验（规格 §4.3 第 1–2 步）═══════════════════════════
// 定位：parseSavePackage 是 Task 7 之前唯一的闸门。migrateState 直接解引用 `state.finance` / `state.operation`
// （enterpriseStore.ts:223/233/298-300），auditFrame 直接解引用 `save.state.finance`（audit.ts:72），
// 而 Task 7 的调用点只有 `try…finally`、没有 catch（计划 Task 7 handleFilePicked）——校验漏一项就是导入当场抛。
// 反面同样要守：校验只看结构不看账目，任何"顺手修平/回填 kind/夹紧现金"都是替审计造假绿（规格 §4.4 的分工）。
// 于是下面三节各守一件事：① 畸形输入一律点名拒绝且绝不抛，② 放行的一定时下游不抛，③ 游戏真产得出的包不许拒。

// 合法包的字节：saves 默认空数组（与简报一致），需要帧的用例自己传或往字节里塞。
// 形参收的是"手改过的普通对象"（frameOf 的返回类型），因为绝大多数用例要在字节层面动刀；
// SaveFile 的类型闸门在这里刻意用 cast 绕过——真正拦畸形的是 parseSavePackage，不是 tsc。
const validBytes = async (saves: Array<Record<string, any>> = []): Promise<string> =>
  serializePackage(await buildSavePackage(createFreshState(), saves as unknown as SaveFile[]));

// 解析回普通对象再动手——这就是导入侧拿到的形态（JSON 数据）；改完再序列化，就是"用户手改过的文件"
const bag = (text: string): Record<string, any> => JSON.parse(text) as Record<string, any>;

// 帧夹具，形状照 SaveFile（Task 5）。version 引用常量而不是写死 4——预检 #3，与本文件上方 frame() 同法。
// 返回普通对象而非 SaveFile：用例要 delete / 塞非法值，类型先放开手改的余地。
const frameOf = (over: Record<string, any> = {}): Record<string, any> => ({
  id: 'f1',
  name: '帧1',
  enterpriseName: '企业1',
  timestamp: 1,
  resetCount: 0,
  version: SAVE_FORMAT_VERSION,
  createdAt: '2026-10-04 10:00:00',
  state: JSON.parse(JSON.stringify(createFreshState())),
  ...over,
});

// 一个断言两用：既证明"被拒"，又证明交出的是结果对象而不是异常（放行时返回 null，toContain 当场红）。
const reasonOf = async (text: string): Promise<string | null> => {
  const r = await parseSavePackage(text);
  return r.ok ? null : r.reason;
};

describe('存档包解析：畸形输入点名拒绝', () => {
  it('非 JSON 文本被拒绝并说明原因', async () => {
    expect(await parseSavePackage('not json')).toEqual({ ok: false, reason: '文件不是有效 JSON' });
  });

  it('顶层不是对象的一律拒绝（不许把数组/标量当包放行）', async () => {
    // 这一例守的是"ok:true 意味着 pkg 真能当包读"：顶层放行成 ok:true，Task 7 拿到 pkg.saves 就是 undefined
    for (const text of ['null', '123', 'true', '"str"', '[]', '[1,2]', '{}', '[]"']) {
      const r = await parseSavePackage(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/[一-龥]/);
    }
  });

  it('格式标识与包版本必须匹配', async () => {
    const r = await parseSavePackage(JSON.stringify({ format: 'other', packageVersion: 1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('不是本系统的存档包');
    // packageVersion 是格式标识的另一半：只有 format 也对不上（别的系统/别的版本一律不认领）
    expect(await reasonOf(JSON.stringify({ format: 'ie-sandbox-save', packageVersion: 2 })))
      .toContain('不是本系统的存档包');
  });

  it('缺 current 五域之一时指出字段名而不是静默迁移', async () => {
    const text = await validBytes();
    const broken = bag(text);
    delete broken.current.logistics;
    const r = await parseSavePackage(JSON.stringify(broken));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('current.logistics');

    // 五域逐个来一遍：migrateState 无条件解引用 finance/operation，其余三域是它 forEach 的对象，
    // 少任何一个都不能靠"静默迁移"补（规格 §4.3 明写拒绝畸形结构并明确指出哪个字段）
    for (const domain of ['finance', 'production', 'logistics', 'marketing', 'operation']) {
      const one = bag(text);
      delete one.current[domain];
      expect(await reasonOf(JSON.stringify(one))).toContain(`current.${domain}`);
      // 类型错（字符串）同样是指名字段的拒绝，而不是"过校验后在下游抛"
      const wrongType = bag(text);
      wrongType.current[domain] = 'x';
      expect(await reasonOf(JSON.stringify(wrongType))).toContain(`current.${domain}`);
    }
  });

  it('负现金与越界季度被拒绝', async () => {
    const text = await validBytes();
    const neg = bag(text); neg.current.finance.cash = -5;
    expect((await parseSavePackage(JSON.stringify(neg))).ok).toBe(false);
    const badQ = bag(text); badQ.current.operation.currentQuarter = 9;
    expect((await parseSavePackage(JSON.stringify(badQ))).ok).toBe(false);
    // 原因要点名到具体字段（规格 §4.3），"格式错误"这种含混说法不算过关
    expect(await reasonOf(JSON.stringify(neg))).toContain('current.finance.cash');
    expect(await reasonOf(JSON.stringify(badQ))).toContain('current.operation.currentQuarter');
    // 非整数与字符串同样拒——现金按规则必为整数（M 为单位），1e999 过 JSON.parse 就是 Infinity
    for (const bad of ['"20"', 2.5, null, Infinity, -Infinity, NaN]) {
      const one = bag(text);
      one.current.finance.cash = bad;
      expect(await reasonOf(JSON.stringify(one))).toContain('current.finance.cash');
    }
    // 年 0/6 与季 0/5 越界；整数年季才放行
    for (const badYear of [0, 6, 2.5]) {
      const one = bag(text);
      one.current.operation.currentYear = badYear;
      expect(await reasonOf(JSON.stringify(one))).toContain('current.operation.currentYear');
    }
    // 应收账款四档（规格 §4.3 逐字点名）：少一档、多一档、非数、负数都拒
    for (const badAR of [[0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, -1], [0, 0, 0, '15'], [0, 0, 0, null], 'x']) {
      const one = bag(text);
      one.current.finance.accountsReceivable = badAR;
      expect(await reasonOf(JSON.stringify(one))).toContain('current.finance.accountsReceivable');
    }
  });

  it('saves 非数组被拒绝；空数组合法', async () => {
    const text = await validBytes();
    const bad = bag(text); bad.saves = 'x';
    expect((await parseSavePackage(JSON.stringify(bad))).ok).toBe(false);
    expect(await reasonOf(JSON.stringify(bad))).toContain('saves');
    expect((await parseSavePackage(text)).ok).toBe(true);
  });

  it('saves 某一帧现金为 Infinity 或 version 缺失时被拒，原因点名是哪一帧', async () => {
    // validBytes() 的 saves 是空数组，这里自己塞一帧进去（帧的形状照 Task 5 的 SaveFile）
    const pkgWith = async (mutate: (pkg: Record<string, any>) => void) => {
      const pkg = bag(await validBytes());
      pkg.saves = [frameOf()];
      mutate(pkg);
      return JSON.stringify(pkg);
    };

    const r1 = await parseSavePackage(await pkgWith((pkg) => { pkg.saves[0].state.finance.cash = 1e999; }));
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toContain('saves[0].finance.cash');

    const r2 = await parseSavePackage(await pkgWith((pkg) => { delete pkg.saves[0].version; }));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toContain('saves[0].version');

    // 重复 id：digests.frames 以 id 为键，两份同 id 会让其中一份永远"无指纹可比"
    const r3 = await parseSavePackage(await pkgWith((pkg) => { pkg.saves.push(JSON.parse(JSON.stringify(pkg.saves[0]))); }));
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.reason).toContain('id 与前面的帧重复');

    // 显式但非法的 kind：那条会同时退出 A 与 B 两侧求和，格式问题不能读成账实不符
    const r4 = await parseSavePackage(await pkgWith((pkg) => {
      pkg.saves[0].state.operation.financialLogs = [{ id: 'l', description: 'x', cashChange: 1, timestamp: 1, year: 1, quarter: 1, operator: '企业1管理者', kind: 'Flow' }];
    }));
    expect(r4.ok).toBe(false);
    if (!r4.ok) expect(r4.reason).toContain('非法 kind');

    // 同一套判据在 current 与每一帧上必须一字不差地共用（评审 round-3 new finding #2 的"只查 current"缺陷）：
    // 下面四例把上面四种畸形分别搬到 current 上，原因前缀换成 current、其余不动。
    const onCurrent = async (mutate: (pkg: Record<string, any>) => void) => {
      const pkg = bag(await validBytes());
      mutate(pkg);
      return JSON.stringify(pkg);
    };
    expect(await reasonOf(await onCurrent((p) => { p.current.finance.cash = 1e999; })))
      .toContain('current.finance.cash');
    expect(await reasonOf(await onCurrent((p) => { p.current.operation.financialLogs = [{ id: 'l', description: 'x', cashChange: 1, timestamp: 1, kind: '' }]; })))
      .toContain('current.operation.financialLogs');
  });

  it('帧的元数据字段逐个点名（id/name/timestamp/version/state 与展示字段）', async () => {
    const cases: Array<[Record<string, any>, string]> = [
      [{ id: 42 }, 'saves[0].id'],
      [{ id: undefined }, 'saves[0].id'],
      [{ name: undefined }, 'saves[0].name'],
      [{ enterpriseName: 1 }, 'saves[0].enterpriseName'],
      [{ createdAt: undefined }, 'saves[0].createdAt'],
      [{ timestamp: 'x' }, 'saves[0].timestamp'],
      [{ timestamp: null }, 'saves[0].timestamp'],          // JSON 里的 NaN/Infinity 落不成字节，null 是它的实际形态
      [{ timestamp: 1e999 }, 'saves[0].timestamp'],
      [{ version: '4' }, 'saves[0].version'],               // 字符串版本号必须拒：它是审计口径的唯一判据
      [{ version: 4.5 }, 'saves[0].version'],
      [{ version: -1 }, 'saves[0].version'],
      [{ state: undefined }, 'saves[0].state'],
      [{ state: 'x' }, 'saves[0].state'],
    ];
    for (const [over, path] of cases) {
      const pkg = bag(await validBytes());
      pkg.saves = [frameOf(over)];
      expect(await reasonOf(JSON.stringify(pkg))).toContain(path);
    }
    // 帧本身不是对象（数组/字符串/null）
    for (const notObject of ['x', 5, null, []]) {
      const pkg = bag(await validBytes());
      pkg.saves = [frameOf(), notObject];
      expect(await reasonOf(JSON.stringify(pkg))).toContain('saves[1]');
    }
    // 第二帧坏也要说是 saves[1]，不能笼统说"saves 里有坏帧"
    const pkg = bag(await validBytes());
    pkg.saves = [frameOf({ id: 'a' }), frameOf({ id: 'b', state: { finance: 5, production: {}, logistics: {}, marketing: {}, operation: {} } })];
    expect(await reasonOf(JSON.stringify(pkg))).toContain('saves[1].finance');
  });

  it('帧里缺任一域、或域里现金/年季坏了，原因带帧号（同一套判据逐帧跑）', async () => {
    for (const domain of ['finance', 'production', 'logistics', 'marketing', 'operation']) {
      const pkg = bag(await validBytes());
      pkg.saves = [frameOf({ id: 'ok' }), frameOf({ id: 'bad' })];
      delete pkg.saves[1].state[domain];
      expect(await reasonOf(JSON.stringify(pkg))).toContain(`saves[1].${domain}`);
    }
    const frameCases: Array<[(pkg: Record<string, any>) => void, string]> = [
      [(p) => { p.saves[0].state.operation.currentYear = 7; }, 'saves[0].operation.currentYear'],
      [(p) => { p.saves[0].state.operation.currentQuarter = 0; }, 'saves[0].operation.currentQuarter'],
      [(p) => { p.saves[0].state.finance.accountsReceivable = [1, 2, 3]; }, 'saves[0].finance.accountsReceivable'],
      // 越界年季与脏 kind 都不许只长在 current 上被查到（帧才是 Task 7 审计与 Task 8 报告的直接输入）
      [(p) => { p.saves[0].state.operation.financialLogs = [{ id: 'l', cashChange: 1, timestamp: 1, kind: 'summary', description: '季度结束现金变动' }, { id: 'm', cashChange: 2, timestamp: 2, kind: 'Flow' }]; }, 'saves[0].operation.financialLogs'],
    ];
    for (const [mutate, path] of frameCases) {
      const pkg = bag(await validBytes());
      pkg.saves = [frameOf({ id: 'x' })];
      mutate(pkg);
      expect(await reasonOf(JSON.stringify(pkg))).toContain(path);
    }
  });

  it('超 8MB 直接拒绝', async () => {
    const r = await parseSavePackage('{"a":"' + 'x'.repeat(9 * 1024 * 1024) + '"}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('超过 8MB');
  });

  it('体积按 UTF-8 字节算，不是 UTF-16 码元数', async () => {
    // 规格 §4.3 的 8MB 是**文件体积**，而我们的包以中文为主：一个汉字 1 个码元、3 个字节。
    // 只比 text.length 会放过 12MB 字节的中文文件（少挡 3 倍），这一例把口径钉成字节；
    // 断言里先自证"码元数没超"，否则这一例与上一例是同一个断言、零独立覆盖。
    const chinese = '{"a":"' + '存'.repeat(4 * 1024 * 1024) + '"}';
    expect(chinese.length).toBeLessThan(8 * 1024 * 1024);
    expect(new TextEncoder().encode(chinese).length).toBeGreaterThan(8 * 1024 * 1024);
    expect(await reasonOf(chinese)).toContain('超过 8MB');
  });

  it('恰好 8MiB 不算超体积（边界是 >，且拒绝原因不许串门）', async () => {
    const exact = 'x'.repeat(8 * 1024 * 1024);
    expect(new TextEncoder().encode(exact).length).toBe(8 * 1024 * 1024);
    // 走到解析那一步才失败——若这里读到"超过 8MB"，说明边界写成了 >=
    expect(await reasonOf(exact)).toBe('文件不是有效 JSON');
  });
});

describe('存档包解析：对任何输入都不抛不 reject', () => {
  // Task 7 的调用点是 `try { … } finally { setBusy(false) }`，没有 catch：解析器一抛就是整页崩，
  // 所以这一节把"永远给结果对象"当成契约来打，而不是当成 Nice-to-have。
  const deep = (n: number): Record<string, unknown> => {
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let i = 0; i < n; i++) {
      const next: Record<string, unknown> = {};
      cursor.child = next;
      cursor = next;
    }
    return root;
  };

  const nasties: Array<[string, unknown]> = [
    ['空串', ''],
    ['空白', '   '],
    ['null', 'null'],
    ['数字', '123'],
    ['字符串', '"str"'],
    ['布尔', 'true'],
    ['残缺的数组起手', '[]"'],
    ['顶层数组', '[]'],
    ['顶层数组带内容', '[1,2]'],
    ['空对象', '{}'],
    ['尾逗号', '{"a":1,}'],
    ['未闭合对象', '{unterminated'],
    ['未闭合字符串', '{"a":"b'],
    ['单引号', "{'a':1}"],
    ['NaN 字面量', '{"a":NaN}'],
    ['undefined 字面量', '{"a":undefined}'],
    ['注释', '{"a":1}//x'],
    ['深嵌套对象（20 层）', JSON.stringify(deep(20))],
    ['深嵌套数组（爆栈那种）', `[${'['.repeat(20000)}`],
    ['该是对象处给了数组', '{"format":"ie-sandbox-save","packageVersion":1,"current":[],"saves":[]}'],
    ['该是数组处给了对象', '{"format":"ie-sandbox-save","packageVersion":1,"saves":{},"current":{}}'],
    ['帧是数组', '{"format":"ie-sandbox-save","packageVersion":1,"saves":[[]],"current":{}}'],
    ['digests 是数组', '{"format":"ie-sandbox-save","packageVersion":1,"saves":[],"current":{},"digests":[]}'],
    ['__proto__ 载荷', '{"__proto__":{"polluted":1}}'],
    ['constructor 载荷', '{"constructor":{"prototype":{"polluted":1}}}'],
    ['非字符串入参（JS 调用方）', undefined],
    ['null 入参', null],
    ['对象入参', {}],
  ];

  for (const [name, input] of nasties) {
    it(`${name}：给得出结果对象，不抛不 reject`, async () => {
      const r = await parseSavePackage(input as never);
      expect(typeof r.ok).toBe('boolean');
      if (!r.ok) {
        expect(typeof r.reason).toBe('string');
        expect(r.reason.length).toBeGreaterThan(0);
        // 原因必须是中文说明（规格 §4.3 的"明确指出哪个字段"面向的是教师，不是日志）
        expect(r.reason).toMatch(/[一-龥]/);
      }
    });
  }

  it('放行的包不许被载荷里的 __proto__ 换掉原型（只读白名单字段，绝不合并键集）', async () => {
    // 这一例针对的是"校验器顺手做整洁拷贝"那种写法：Object.assign(target, parsed) 或深拷贝键集
    // 会给 __proto__ 这个键走 **setter**，于是返回对象的原型被载荷换掉、载荷里的字段变成"继承来的真值"。
    // 本函数的处置是原样交出 JSON.parse 的结果（自有键是惰性的），这里把两条都钉住：
    // 原型仍是 Object.prototype、pkg.polluted 读不到，且字节回来与输入相同（没被复制改写过）。
    const text = await validBytes([frameOf({ id: 'a' })]);
    // 按 §4.2 的 2 空格缩进插进第一个键，产出的就是"教师手改过一行"的真实形态（缩进错了下面那条字节相等会假红）
    const injected = text.replace('{\n  "format"', '{\n  "__proto__": {\n    "polluted": 1\n  },\n  "format"');
    const r = await parseSavePackage(injected);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const pkg = r.pkg as unknown as Record<string, unknown>;
      expect(Object.getPrototypeOf(pkg)).toBe(Object.prototype);
      expect(pkg.polluted).toBeUndefined();
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(serializePackage(r.pkg)).toBe(injected);
      // 下游照旧跑得动：注入的自有 __proto__ 键不影响审计读真实字段
      expect(() => auditFrames(r.pkg.saves)).not.toThrow();
    }
  });

  it('任何输入都不污染 Object.prototype（__proto__ 与 constructor 载荷）', async () => {
    // JSON.parse 把 __proto__ 落成**自有**数据属性、不触发 setter，所以危险不在解析而在后续合并：
    // Object.assign(target, parsed) 或深拷贝键集会走 setter，把原型的形状改掉。本函数只读白名单字段、
    // 绝不把解析出来的键集往别的对象上拷，这里用两类载荷各证一次，并当场验原型干净。
    const payloads = [
      '{"__proto__":{"polluted":1}}',
      '{"__proto__":{"polluted":1},"format":"ie-sandbox-save","packageVersion":1}',
      '{"format":"other","packageVersion":1,"__proto__":{"polluted":1}}',
      '{"constructor":{"prototype":{"polluted":1}},"format":"ie-sandbox-save","packageVersion":1}',
    ];
    for (const text of payloads) {
      const r = await parseSavePackage(text);
      expect(r.ok).toBe(false);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(([] as unknown as Record<string, unknown>).polluted).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
    }

    // 把 __proto__ 塞进 current.finance，指望"继承一个 cash 进来"骗过校验：
    // 自有属性读不到值，必须报 current.finance.cash 缺失（实际为 undefined），而不是放行 999
    const pkg = bag(await validBytes());
    pkg.current.finance = JSON.parse('{"__proto__":{"cash":999}}');
    expect(await reasonOf(JSON.stringify(pkg))).toContain('current.finance.cash');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    // 同一招用在帧上：帧的 cash 不能被继承出来
    const oneFrame = bag(await validBytes());
    oneFrame.saves = [frameOf()];
    oneFrame.saves[0].state.finance = JSON.parse('{"__proto__":{"cash":999,"accountsReceivable":[1,1,1,1]}}');
    expect(await reasonOf(JSON.stringify(oneFrame))).toContain('saves[0].finance.cash');

    // 放行包里的 __proto__ 只能是惰性自有键：返回对象的 prototypes 一个都没被改
    const kept = bag(await validBytes());
    kept.digests = JSON.parse('{"package":"sha256:0000000000000000","frames":{"__proto__":{"x":1}}}');
    const r = await parseSavePackage(JSON.stringify(kept));
    expect(r.ok).toBe(false);   // frames 的值必须是字符串，那个自有 __proto__ 键在这里现形
    if (!r.ok) expect(r.reason).toContain('digests.frames');
    expect(Object.getPrototypeOf({}) === Object.prototype).toBe(true);
  });
});

describe('存档包解析：包级字段与 digests 形状', () => {
  it('缺 app / app 类型错 / saveVersion 非法都点名拒绝（Task 7 拿它当迁移的 fromVersion）', async () => {
    const text = await validBytes();
    const cases: Array<[(pkg: Record<string, any>) => void, string]> = [
      [(p) => { delete p.app; }, 'app'],
      [(p) => { p.app = 'x'; }, 'app'],
      [(p) => { p.app.saveVersion = '4'; }, 'app.saveVersion'],
      [(p) => { delete p.app.saveVersion; }, 'app.saveVersion'],
      [(p) => { p.app.saveVersion = -1; }, 'app.saveVersion'],
      [(p) => { p.app.year = null; }, 'app.year'],
      [(p) => { p.app.quarter = 'x'; }, 'app.quarter'],
    ];
    for (const [mutate, path] of cases) {
      const pkg = bag(text);
      mutate(pkg);
      expect(await reasonOf(JSON.stringify(pkg))).toContain(path);
    }
    // exporteAt 是 Task 7 拿来当帧 createdAt 兜底与时间跨度展示的字符串
    const noAt = bag(text);
    delete noAt.exportedAt;
    expect(await reasonOf(JSON.stringify(noAt))).toContain('exportedAt');
  });

  it('digests 缺失或类型错一律点名（否则 Task 7 的 pkg.digests.frames[id] 当场抛）', async () => {
    const text = await validBytes();
    const cases: Array<[(pkg: Record<string, any>) => void, string]> = [
      [(p) => { delete p.digests; }, 'digests'],
      [(p) => { p.digests = 'x'; }, 'digests'],
      [(p) => { p.digests = []; }, 'digests'],
      [(p) => { delete p.digests.package; }, 'digests.package'],
      [(p) => { p.digests.package = 42; }, 'digests.package'],
      [(p) => { p.digests.package = null; }, 'digests.package'],
      [(p) => { delete p.digests.frames; }, 'digests.frames'],
      [(p) => { p.digests.frames = 'x'; }, 'digests.frames'],
      [(p) => { p.digests.frames = []; }, 'digests.frames'],
      [(p) => { p.digests.frames.s1 = 42; }, 'digests.frames'],
      [(p) => { p.digests.frames.s1 = null; }, 'digests.frames'],
      [(p) => { p.digests.frames.s1 = { v: 'sha256:1' }; }, 'digests.frames'],
    ];
    for (const [mutate, path] of cases) {
      const pkg = bag(text);
      mutate(pkg);
      expect(await reasonOf(JSON.stringify(pkg))).toContain(path);
    }
  });

  it('帧没有声明指纹时放行，由 Task 7 记「包内无记录」（裁定：不拒）', async () => {
    // 裁定理由：① 缺失的是一条**证据**，不是坏结构——账实重演算照跑、指纹比对按规格 §4.4「绝不因此判失败」；
    // ② 计划给 Task 7 的代码已有 `!declared → 哈希未计算（包内无记录）` 这一支，且它给空 saves 造的
    //    合成帧 id='current' 本就永远不在表里，拒了等于把那条路径判死；③ 校验只管"读它会不会抛"。
    const pkg = bag(await validBytes());
    pkg.saves = [frameOf({ id: 'no-digest-yet' })];
    expect(Object.keys(pkg.digests.frames)).toEqual([]);
    const r = await parseSavePackage(JSON.stringify(pkg));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const declared = r.pkg.digests.frames['no-digest-yet'];
      expect(declared).toBeUndefined();
      // Task 7 的分派写法在这一帧上不抛、且落到"未计算"那一支
      expect(!declared || declared.startsWith('sha256:')).toBe(true);
    }
    // 反过来：指纹表多一条（帧被清空了、声明还留着）也只可能是"包指纹不符"，不是结构坏
    const extra = bag(await validBytes([frameOf({ id: 'a' })]));
    extra.saves = [];
    expect((await parseSavePackage(JSON.stringify(extra))).ok).toBe(true);
  });

  it('unavailable:* 与 sha256:* 两种声明都放行（非安全上下文的包必须能导，规格 §4.4）', async () => {
    const pkg = bag(await validBytes([frameOf({ id: 'a' })]));
    pkg.digests.package = 'unavailable:insecure-context';
    pkg.digests.frames.a = 'unavailable:insecure-context';
    expect((await parseSavePackage(JSON.stringify(pkg))).ok).toBe(true);
    // 值本身不比语义：改成一串乱码仍是"合法形状的声明"，比不比对是 Task 7 的事
    pkg.digests.frames.a = 'sha256:deadbeefdeadbeef';
    expect((await parseSavePackage(JSON.stringify(pkg))).ok).toBe(true);
    // 空串同样只是"字符串声明"：Task 7 的 `!declared → 哈希未计算` 那一支兜得住，
    // 在校验里把它判成畸形等于替 Task 7 决定结论（规格 §4.4：指纹绝不因未计算而判失败）
    pkg.digests.package = '';
    pkg.digests.frames.a = '';
    const r = await parseSavePackage(JSON.stringify(pkg));
    expect(r.ok).toBe(true);
    if (r.ok) expect(!r.pkg.digests.frames.a || r.pkg.digests.frames.a.startsWith('sha256:')).toBe(true);
  });
});

describe('存档包解析：放行即下游可读（不经过 store 的等价断言）', () => {
  it('ok:true 的包喂给 auditFrames 与 buildSavePackage 都不抛', async () => {
    const saves = [
      frameOf({ id: 'a', timestamp: 1 }),
      frameOf({ id: 'b', timestamp: 2, version: 3 }),
      frameOf({ id: 'c', timestamp: 3, resetCount: 2 }),
    ];
    const r = await parseSavePackage(await validBytes(saves));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pkg = r.pkg;

    // Task 7 的预览第一步就是这个调用；auditFrame 直接解引用 save.state.finance（audit.ts:72）
    expect(() => auditFrames(pkg.saves)).not.toThrow();
    const results = auditFrames(pkg.saves);
    expect(results.map((x) => x.saveId)).toEqual(['a', 'b', 'c']);
    expect(results.every((x) => x.status === 'ok' || x.status === 'mismatch' || x.status === 'no-anchor')).toBe(true);

    // migrateState 是模块私有的（enterpriseStore.ts:219），要不要 export 由 Task 7 定（预检 #5），
    // 所以这里不去调它，而是把它**无条件解引用**的那几处逐个断言在放行的包上真实存在——
    // 等价于"migrateState(pkg.current, pkg.app.saveVersion) 不抛"，覆盖面见下面每一行对应的源码行号。
    const cur = pkg.current as unknown as Record<string, any>;
    for (const domain of ['finance', 'production', 'logistics', 'marketing', 'operation']) {
      expect(typeof cur[domain]).toBe('object');
    }
    expect(Array.isArray(cur.finance.loans)).toBe(true);                            // :223-247 的 .some/.push
    expect(Array.isArray(cur.finance.accountsReceivable)).toBe(true);               // :112 四档
    expect(typeof cur.operation.currentYear).toBe('number');                        // :233 absQuarter(...)
    expect(Array.isArray(cur.operation.financialLogs)).toBe(true);                  // :260 forEach
    expect(Array.isArray(cur.production.factories)).toBe(true);                     // :250/:276 forEach
    expect(cur.production.factories.every((f: any) => Array.isArray(f.productionLines))).toBe(true);  // :251
    expect(Array.isArray(cur.marketing.markets)).toBe(true);                        // :288 forEach
    expect(Array.isArray(cur.marketing.isoCertifications)).toBe(true);              // :292 forEach
    for (const f of pkg.saves) expect(typeof f.state.finance.cash).toBe('number');

    // 建包侧（Task 5）能原样吃下解析出来的包——Task 7 的"仅加入存档列表/重导"路径依赖这条
    await expect(buildSavePackage(pkg.current, pkg.saves)).resolves.toBeTruthy();
  });

  it('放行的帧不许把 migrateState 的 forEach 打进抛错（表里混 null / 表不是数组）', async () => {
    const text = await validBytes();
    const cases: Array<[(pkg: Record<string, any>) => void, string]> = [
      // 每一条都是 migrateState 里的真实解引用点：非数组→"forEach/is not a function"，null 条目→读写字段抛错
      [(p) => { p.current.finance.loans = 5; }, 'current.finance.loans'],
      [(p) => { p.current.finance.loans = [null]; }, 'current.finance.loans'],
      [(p) => { p.current.production.factories = 'x'; }, 'current.production.factories'],
      [(p) => { p.current.production.factories = [null]; }, 'current.production.factories'],
      [(p) => { p.current.production.factories = [{ id: 'f1' }]; }, 'current.production.factories[0].productionLines'],
      [(p) => { p.current.production.factories = [{ productionLines: null }]; }, 'productionLines'],
      [(p) => { p.current.marketing.markets = [null]; }, 'current.marketing.markets'],
      [(p) => { p.current.marketing.isoCertifications = 5; }, 'current.marketing.isoCertifications'],
      [(p) => { p.current.operation.financialLogs = [null]; }, 'current.operation.financialLogs'],
      // 研发 P2 分期字段：migrateState 判过真假之后就地写 `P2.status = …`（enterpriseStore.ts:282-285），
      // 真值非对象（数字/布尔/字符串）会当场抛，缺失才是它要补的形态
      [(p) => { p.current.production.productRD = 5; }, 'current.production.productRD'],
      [(p) => { p.current.production.productRD.P2 = 5; }, 'current.production.productRD.P2'],
      // 流水行缺 id/timestamp/cashChange：审计求和与排序会 NaN/抛，格式问题不能被印成账实不符
      [(p) => { p.current.operation.financialLogs = [{ description: '初始现金', kind: 'flow' }]; }, 'financialLogs[0]'],
      [(p) => { p.current.operation.financialLogs = [{ description: 5, cashChange: 1, timestamp: 1, id: 'x' }]; }, 'financialLogs[0].description'],
    ];
    for (const [mutate, path] of cases) {
      const pkg = bag(text);
      mutate(pkg);
      expect(await reasonOf(JSON.stringify(pkg))).toContain(path);
    }

    // description 那条守卫防的是**真实崩点**，不是洁癖：kindOfLog 只在 kind 缺失时兜底，
    // 兜底谓词写的是 `(l.description || '').includes('季度结束现金变动')`（restatement.ts:29），
    // 数字描述于是抛 `.includes is not a function`——Task 7 的预览于是整页崩。
    // 先自证这个崩点存在（不经过 parseSavePackage 直接喂 auditFrame），再证明闸门把它拦在门外。
    const crashing = frameOf();
    crashing.state.operation.financialLogs = [{ id: 'x', description: 5, cashChange: 20, newCash: 20, timestamp: 1 }];
    expect(() => auditFrame(crashing as unknown as SaveFile)).toThrow();
    const crashPkg = bag(text);
    crashPkg.saves = [crashing];
    expect(await reasonOf(JSON.stringify(crashPkg))).toContain('financialLogs[0].description');

    // 旧档的"字段缺失"是 migrateState 的活，不是拒绝的理由（v1/v2 本就没有 loans）
    const legacy = bag(text);
    delete legacy.current.finance.loans;
    delete legacy.current.operation.financialLogs;
    delete legacy.current.production.productRD.P2;
    // 描述缺失/null 走 `(l.description || '')` 是安全的，v1/v2 旧档确有缺字段的行
    legacy.current.operation.financialLogs = [{ id: 'a', cashChange: 20, timestamp: 1 }, { id: 'b', cashChange: -2, newCash: 18, timestamp: 2, description: null }];
    expect((await parseSavePackage(JSON.stringify(legacy))).ok).toBe(true);
  });

  it('校验不改任何字节：放行的包序列化回来与输入完全相同', async () => {
    // 契约第五点：不替审计修平任何东西。若解析器回填了 kind、夹紧了现金、或把 AR 补齐成 4 档，
    // 这条"字节回来必须等于输入"当场红——它比任何注释都硬。
    const text = await validBytes([frameOf({ id: 'a' })]);
    const r = await parseSavePackage(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(serializePackage(r.pkg)).toBe(text);
  });

  it('结构合法但账目不平的帧照放行，并由审计说不平（校验不吞判据）', async () => {
    const pkg = bag(await validBytes([frameOf({ id: 'a' })]));
    pkg.saves[0].state.finance.cash = 999;                    // 合法整数、明显不平
    const r = await parseSavePackage(JSON.stringify(pkg));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pkg.saves[0].state.finance.cash).toBe(999);     // 没被"修回"原值
      const audited = auditFrame(r.pkg.saves[0]);
      expect(audited.status).toBe('mismatch');
      expect(audited.actualCash).toBe(999);
    }
    // 缺 kind 的原始帧也不回填：那是 migrateState 在载入时的活（restatement.ts 的 kindOfLog 兜底谓词）
    const noKind = bag(await validBytes([frameOf({ id: 'a' })]));
    delete noKind.saves[0].state.operation.financialLogs[0].kind;
    const r2 = await parseSavePackage(JSON.stringify(noKind));
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.pkg.saves[0].state.operation.financialLogs[0].kind).toBeUndefined();
  });
});

describe('存档包解析：游戏真产得出的包一律放行', () => {
  beforeEach(() => {
    useEnterpriseStore.setState({ state: createFreshState(), validationError: null });
  });

  // 真·v3 旧档：引擎跑两季、把重述串压回旧口径（减掉该季玩家手操）、删掉 v4 才有的 kind 字段。
  // 构造法与 tests/audit.test.ts 的 buildV3LegacyArchive 同源——这里要的是"这种包必须能导入"。
  // 调用方须处于 vi.useFakeTimers() 中：每步之间推进假时钟，Date.now() 才有严格递增的 timestamp。
  const v3LegacyFrame = (id = 'v3'): Record<string, any> => {
    const play = () => {
      useEnterpriseStore.getState().registerOtherCashFlow('旧档注资', 180);
      vi.advanceTimersByTime(10);
      useEnterpriseStore.getState().nextQuarter();
      vi.advanceTimersByTime(10);
      useEnterpriseStore.getState().registerOtherCashFlow('旧档支出', -30);
      vi.advanceTimersByTime(10);
      useEnterpriseStore.getState().nextQuarter();
      vi.advanceTimersByTime(10);
    };
    play();
    const legacy = JSON.parse(JSON.stringify(useEnterpriseStore.getState().state)) as Record<string, any>;
    // 数组是"新的在前"，故按 timestamp 定序再比对，确认这两笔手操真的都在账上且金额没被别处稀释
    const manual = legacy.operation.financialLogs
      .filter((l: any) => l.operator === '企业1管理者')
      .sort((a: any, b: any) => a.timestamp - b.timestamp);
    expect(manual.map((l: any) => l.cashChange)).toEqual([180, -30]);
    for (const flow of manual) {
      // 旧口径：重述串只记引擎自动项，把当季那笔手操从覆盖它的串里减回去
      const covered = legacy.operation.financialLogs
        .filter((l: any) => l.kind === 'summary' && l.timestamp >= flow.timestamp)
        .sort((a: any, b: any) => a.timestamp - b.timestamp);
      expect(covered.length).toBeGreaterThan(0);
      covered[0].cashChange -= flow.cashChange;
    }
    for (const l of legacy.operation.financialLogs) delete l.kind;   // v3 没有 kind 字段
    return {
      id, name: `帧${id}`, enterpriseName: '企业1', timestamp: 1, resetCount: 0,
      version: 3, createdAt: '2026-10-04 10:00:00', state: legacy,
    };
  };

  it('version 3 的旧包（日志没有 kind）照样导入，审计给旧口径而不是错误', async () => {
    vi.useFakeTimers();
    const legacy = v3LegacyFrame('v3-a');
    const pkg = bag(await validBytes());
    pkg.saves = [legacy];
    const r = await parseSavePackage(JSON.stringify(pkg));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pkg.saves[0].version).toBe(3);
      // 旧档不抛、且落进"旧口径"那一档（不是 no-anchor、不是异常）
      const [audit] = auditFrames(r.pkg.saves);
      expect(audit.restatementCaliber).toMatch(/^legacy-/);
      expect(audit.status === 'ok' || audit.status === 'mismatch').toBe(true);
    }
  });

  it('version 大于当前格式（5/99）不因"不等于 SAVE_FORMAT_VERSION"被拒', async () => {
    for (const version of [5, 99, 0, 1, 2]) {
      const pkg = bag(await validBytes());
      pkg.saves = [frameOf({ id: `v${version}`, version })];
      expect((await parseSavePackage(JSON.stringify(pkg))).ok).toBe(true);
    }
  });

  it('第5年第1季（游戏结束态）、resetCount>0、暂停态都不被当畸形', async () => {
    const pkg = bag(await validBytes());
    pkg.current.operation.currentYear = 5;
    pkg.current.operation.currentQuarter = 1;
    pkg.current.operation.isGameOver = true;
    pkg.saves = [frameOf({ id: 'x', resetCount: 7 })];
    pkg.saves[0].state.operation.currentYear = 5;
    pkg.saves[0].state.operation.resetCount = 7;
    expect((await parseSavePackage(JSON.stringify(pkg))).ok).toBe(true);
  });

  it('真实引擎跑满一年（含跨年结算）产出的包必须放行：现金按规则确实是整数', async () => {
    // 这条是"整数现金"判据的经验证据，而不是对规则的信任：`discountSplit` 的 amount/7 由
    // isValidDiscount 保证金额是 7 的倍数、折旧与税走 Math.floor（rules.ts:28/128），
    // 于是每一步的 cash 与四档应收都该是整数。任何一步给出非整数，这一例就先红在 Number.isInteger 上，
    // 而不是让 parseSavePackage 把合法存档判成畸形（评审 Task 5 用的同一套驱动脚本）。
    vi.useFakeTimers();
    const st = () => useEnterpriseStore.getState();
    const frames: Record<string, any>[] = [];
    const snap = (n: number) => {
      const s = st().state;
      expect(useEnterpriseStore.getState().validationError ?? null).toBeNull();
      expect(Number.isInteger(s.finance.cash)).toBe(true);
      expect(s.finance.accountsReceivable.every((v) => Number.isInteger(v))).toBe(true);
      frames.push(frameOf({
        id: `q${n}`,
        timestamp: 1_000 + n,
        name: `帧${n}`,
        state: JSON.parse(JSON.stringify(s)),
      }));
      vi.advanceTimersByTime(10);
    };
    snap(0);
    st().registerOtherCashFlow('测试注资', 180); snap(1);
    st().applyShortTermLoan(); snap(2);
    st().discountReceivable(7); snap(3);
    st().payTaxes(); snap(4);
    st().nextQuarter(); snap(5);
    st().nextQuarter(); snap(6);
    st().applyShortTermLoan(); snap(7);
    st().nextQuarter(); snap(8);
    st().nextQuarter(); snap(9);        // 跨年：第1年第4季 → 第2年第1季（年末结算、长贷付息、短贷到期、租金）
    st().payTaxes(); snap(10);
    st().nextQuarter(); snap(11);
    st().placeRawMaterialOrder('R1', 2); snap(12);

    const pkg = bag(await validBytes());
    pkg.saves = frames;
    const r = await parseSavePackage(JSON.stringify(pkg));
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 同毫秒假时钟下的 restated-log 是审计侧已知的精度限制（audit.ts:88-90），本例用 advanceTimersByTime 隔开；
      // 这里只要求"下游能跑完且不平的帧由审计自己说"，不要求全绿——校验与审计的分工。
      expect(() => auditFrames(r.pkg.saves)).not.toThrow();
      const summary = auditFrames(r.pkg.saves);
      expect(summary.filter((x) => x.status !== 'ok').map((x) => x.saveId)).toEqual([]);
      expect(summary.every((x) => x.restatementCaliber === 'v4')).toBe(true);
    }
  });
});
