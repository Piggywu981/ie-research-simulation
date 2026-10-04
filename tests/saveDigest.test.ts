// 规范化序列化与哈希指纹（规格 §4.4「包哈希」段）：哈希只是**指纹**，不是防作弊结论——
// 它只把随手改数的成本从"编辑一个数字"提高到"得懂格式并重算"。
// 这里把两条分支都钉住：真实 crypto.subtle（本仓库测试环境是 Node，确有 subtle，所以 sha256 分支
// 是真跑而不是碰巧走降级）与人为摘掉 subtle 的非安全上下文。导入侧（S-T7）要靠 `unavailable:*`
// 前缀说「哈希未计算」、靠 `sha256:` 值比指纹，因此返回 null / 空串 / 抛错任一种形态都会把
// "没算哈希"误报成"哈希不符"（规格表格「无 crypto.subtle → 重演算照常执行，不得因此判失败」）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFreshState } from '../src/store/enterpriseStore';
import { canonicalStringify, digestFrame, digestText } from '../src/utils/saveDigest';
import { SAVE_FORMAT_VERSION, type SaveFile } from '../src/types/enterprise';

// 真形状的一帧：state 用 createFreshState()（与 store 同源的初始态），比手搓 {finance:{cash:20}}
// 更能暴露"某类字段被指纹漏掉"或"JSON 往返后指纹漂移"的问题
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

afterEach(() => {
  vi.unstubAllGlobals();
  //  spies 也在这里统一收：下面「不碰 localStorage」一例中途断言失败时，内联的 mockRestore 走不到，
  // 活的 spy 会留给同文件后续用例。
  vi.restoreAllMocks();
});

describe('规范化序列化 canonicalStringify', () => {
  it('键的插入顺序不影响结果串（不止顶层，每一层都成立）', () => {
    expect(canonicalStringify({ a: 1, b: { x: 1, y: 2 } }))
      .toBe(canonicalStringify({ b: { y: 2, x: 1 }, a: 1 }));
    // 三层嵌套 + 数组里的对象：只在顶层排序的实现会在这一例漏掉
    const p = { l1: { l2: { z: [1, { b: 2, a: 1 }], m: '甲' }, a: 1 }, k: 0 };
    const q = { k: 0, l1: { a: 1, l2: { m: '甲', z: [1, { a: 1, b: 2 }] } } };
    expect(canonicalStringify(p)).toBe(canonicalStringify(q));
    // 改一个数字，串必须变（否则"指纹"根本不含内容）
    expect(canonicalStringify({ finance: { cash: 20 } })).not.toBe(canonicalStringify({ finance: { cash: 21 } }));
  });

  it('结果串里键按字典序出现、值原样保留', () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalStringify({})).toBe('{}');
    expect(canonicalStringify([])).toBe('[]');
    expect(canonicalStringify(0)).toBe('0');
    expect(canonicalStringify('')).toBe('""');
  });

  it('undefined 字段被剔除；null 保留，且与"没有这个键"可区分', () => {
    expect(canonicalStringify({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalStringify({ b: undefined, a: 1 })).toBe('{"a":1}');
    expect(canonicalStringify({ a: 1, b: null })).toBe('{"a":1,"b":null}');
    // null ≠ 缺键：audit.ts 特意用 null 表达"无从起算"，指纹侧也不能把它和缺键混成一帧
    expect(canonicalStringify({ a: null })).not.toBe(canonicalStringify({}));
    expect(canonicalStringify({ a: { b: null } })).toBe('{"a":{"b":null}}');
  });

  it('数组保序：[1,2] ≠ [2,1]；兄弟键换序不影响嵌套数组', () => {
    expect(canonicalStringify({ a: [1, 2] })).toBe('{"a":[1,2]}');
    expect(canonicalStringify([1, 2])).not.toBe(canonicalStringify([2, 1]));
    // 顺序有意义 → 把数组也当集合排序的实现会在这一例死掉
    expect(canonicalStringify({ z: 1, list: ['a', 'b'] })).toBe(canonicalStringify({ list: ['a', 'b'], z: 1 }));
    expect(canonicalStringify({ list: ['a', 'b'], z: 1 })).not.toBe(canonicalStringify({ list: ['b', 'a'], z: 1 }));
  });

  it('非 JSON 标量与奇异对象：钉住实现的选择（undefined/函数/symbol/bigint/Date/循环引用）', () => {
    // 规则：undefined 与"不是存档里会出现的标量"（函数、symbol、bigint）一律折成 null，
    // 从而 canonicalStringify 对任何输入都不抛、且永远是非空串；symbol 键走 Object.keys 天然被剔除。
    // 存档数据来自 JSON.parse，这些形态本不出现；钉住它们是为了"实现悄悄改动 → 指纹漂移"必须在这里被抓到。
    expect(canonicalStringify(undefined)).toBe('null');
    expect(canonicalStringify(() => 1)).toBe('null');                 // JSON.stringify(函数) 返回 undefined，会被传染成非串
    expect(canonicalStringify({ f: () => 1 })).toBe('{"f":null}');    // 剔除只针对 undefined，函数留成 null（规格 §4.4「剔除 undefined」）
    expect(canonicalStringify(Symbol('s') as never)).toBe('null');
    expect(canonicalStringify({ s: Symbol('s') as never })).toBe('{"s":null}');
    expect(canonicalStringify({ [Symbol('s') as never]: 1, b: 2 })).toBe('{"b":2}');
    expect(canonicalStringify(BigInt(10))).toBe('null');             // JSON.stringify(10n) 会抛 TypeError；不用 10n 字面量：tsconfig target 是 es5
    expect(canonicalStringify({ n: BigInt(10) })).toBe('{"n":null}');
    // Date 走 JSON.stringify 的 toJSON 语义（与写进包里的字节一致），而不是塌成 '{}'：
    // 塌成 '{}' 会让两个不同日期的帧同指纹，也与 S-T5 的 JSON.stringify 输出对不上。
    expect(canonicalStringify(new Date('2026-01-01T00:00:00.000Z'))).toBe('"2026-01-01T00:00:00.000Z"');
    expect(canonicalStringify({ d: new Date(0) })).toBe('{"d":"1970-01-01T00:00:00.000Z"}');
    expect(canonicalStringify({ d: new Date(NaN) })).toBe('{"d":null}');
    // 循环引用：JSON.stringify 直接抛，指纹侧折成 null 而不是让 S-T7 的导入流程整个炸掉
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => canonicalStringify(cyclic)).not.toThrow();
    expect(canonicalStringify(cyclic)).toBe('{"a":1,"self":null}');
    // 共享但不成环（DAG）：同一对象实例出现在两处，两处都必须是完整内容而不是 null
    const shared = { v: 1 };
    expect(canonicalStringify({ x: shared, y: shared })).toBe('{"x":{"v":1},"y":{"v":1}}');
  });

  it('稀疏数组的空洞折成 null：拼出来的仍是合法 JSON，且与 JSON.stringify 同串', () => {
    // value.map 会保留空洞，join 出来是 "[,1]"（parse 不回去）；Array.from 读成 undefined → 'null'
    const sparse = [, 1] as unknown[];
    expect(canonicalStringify(sparse)).toBe('[null,1]');
    expect(canonicalStringify(sparse)).toBe(JSON.stringify(sparse));
    expect(() => JSON.parse(canonicalStringify(sparse))).not.toThrow();
  });

  it('NaN / Infinity 经 JSON.stringify 变 null：{cash:NaN} 与 {cash:null} 同串（已知取舍）', () => {
    // 这是 JSON.stringify 的既有语义，不为此另造格式：非有限现金本就由审计侧按「读数非有限 → null」处理，
    // 而哈希按 §4.4 只是指纹、不是结论——记在这里，别让它读起来像个保证。
    expect(canonicalStringify({ cash: NaN })).toBe('{"cash":null}');
    expect(canonicalStringify({ cash: Infinity })).toBe('{"cash":null}');
    expect(canonicalStringify({ cash: NaN })).toBe(canonicalStringify({ cash: null }));
  });

  it('需要 JSON 转义的键（中文、引号）逐字保留，且结果串本身仍是合法 JSON', () => {
    // 'b'(U+0062) < '中'(U+4E2D)，字典序按 UTF-16 码元
    expect(canonicalStringify({ 中文描述: 1, b: 2 })).toBe('{"b":2,"中文描述":1}');
    expect(canonicalStringify({ 'b"c': 2, a: 1 })).toBe('{"a":1,"b\\"c":2}');
    // 键尾是 b，故转义后的键是 "a\":1,\"b" —— 逐字钉住：不转义键名的实现在这里给出的是另一种串
    expect(canonicalStringify({ 'a":1,"b': 2 })).toBe('{"a\\":1,\\"b":2}');
    // 真正的碰撞形态：键里带 : 和 , 时，不转义的实现把 { 'a:1,b': 2 } 与 { a: 1, b: 2 } 都拼成 {a:1,b:2}
    // （键名的引号/冒号逃逸进结构，两帧就此撞成同一指纹）；转义后是 {"a:1,b":2} 与 {"a":1,"b":2}，分得开。
    expect(canonicalStringify({ 'a:1,b': 2 })).toBe('{"a:1,b":2}');
    expect(canonicalStringify({ 'a:1,b': 2 })).not.toBe(canonicalStringify({ a: 1, b: 2 }));
    // 键必须过一次 JSON.stringify：不转义的实现拼出来的**不是合法 JSON**，
    // 而 S-T5 要把规范化结果当包内容写、S-T8 要把指纹印进报告，一条 parse 不回去的"指纹"没有意义。
    const nasty = { 'a":1,"b': 2, 'c,d': [1, { 'e\\f': 'g' }], 描述: '季度结束现金变动' };
    expect(() => JSON.parse(canonicalStringify(nasty))).not.toThrow();
    expect(JSON.parse(canonicalStringify(nasty))).toEqual(JSON.parse(JSON.stringify(nasty)));
    // 中文值原样往返（存档文案全是中文）
    expect(canonicalStringify({ 描述: '季度结束现金变动' })).toBe('{"描述":"季度结束现金变动"}');
  });

  it('纯函数：同一输入两次结果相同，且不改入参', () => {
    const value = { b: 1, a: [2, { d: 4, c: 3 }], e: undefined };
    const before = JSON.parse(JSON.stringify(value));
    expect(canonicalStringify(value)).toBe(canonicalStringify(value));
    expect(JSON.parse(JSON.stringify(value))).toEqual(before);
  });
});

describe('哈希指纹 digestText', () => {
  it('本仓库测试环境确有 crypto.subtle：sha256 分支是真实执行', () => {
    expect(typeof globalThis.crypto?.subtle?.digest).toBe('function');
  });

  it('已知串的 SHA-256 前 16 位被钉死（不是只验形状）', async () => {
    // 用 `echo -n hello | sha256sum` 独立算出，防实现把摘要截错段/编码搞错（如按 UTF-16 编码）
    // 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(await digestText('hello')).toBe('sha256:2cf24dba5fb0a30e');
    // e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(await digestText('')).toBe('sha256:e3b0c44298fc1c14');
    // 中文：TextEncoder 走 UTF-8，若按 UTF-16 编码这个值会变（409d0719010a46eecde9d1fdcccb856bc334c584cbdd263e5f66b20747e8234f）
    expect(await digestText('企业')).toBe('sha256:409d0719010a46ee');
  });

  it('返回 sha256:<16 位小写 hex>；两次一致，改一个字符即不同', async () => {
    const d = await digestText('hello');
    expect(typeof d).toBe('string');
    expect(d).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(/^(sha256:[0-9a-f]{16}|unavailable:.+)$/.test(d)).toBe(true);
    expect(d).toBe(await digestText('hello'));
    expect(d).not.toBe(await digestText('hellp'));
  });

  it('crypto.subtle 缺失（http 打开本地构建）时精确返回 unavailable:insecure-context', async () => {
    // 三种"没有 subtle"的形态都得走同一条明确降级，绝不静默跳过、绝不返回空串或 null（规格 §4.4）
    for (const stub of [undefined, {}, { subtle: undefined }]) {
      vi.stubGlobal('crypto', stub);
      expect(await digestText('hello')).toBe('unavailable:insecure-context');
      vi.unstubAllGlobals();
    }
  });

  it('digest 本身抛错时折成 unavailable:<原因>，绝不 reject', async () => {
    vi.stubGlobal('crypto', { subtle: { digest: () => Promise.reject(new Error('boom')) } });
    const d = await digestText('hello');
    expect(d).toBe('unavailable:error');          // Error.prototype.name='Error' → 小写
    expect(/^(sha256:[0-9a-f]{16}|unavailable:.+)$/.test(d)).toBe(true);
  });

  it('digest 给出的字节数不对（空/短/undefined）时算 unavailable:bad-digest，不得带 sha256: 前缀出门', async () => {
    // S-T7 按前缀分派：带 `sha256:` 的残缺值会被当成"已算出的指纹"去比对，
    // 印出来就是「指纹与包内记录不一致」这条假证（评审 Task 4 new finding #2）。
    for (const bad of [undefined, new Uint8Array(0), new Uint8Array([1, 2, 3])]) {
      vi.stubGlobal('crypto', { subtle: { digest: () => Promise.resolve(bad) } });
      expect(await digestText('hello')).toBe('unavailable:bad-digest');
    }
  });
});

describe('逐帧指纹 digestFrame', () => {
  it('返回非空指纹串；同一帧两次计算完全一致', async () => {
    const a = await digestFrame(frame());
    const b = await digestFrame(frame());
    expect(typeof a).toBe('string');
    expect(a).not.toBe('');
    expect(a).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(a).toBe(b);
    // 连算两次同一对象也一致（纯函数，无隐藏状态）
    const one = frame();
    expect(await digestFrame(one)).toBe(await digestFrame(one));
  });

  it('展示字段不参与指纹：createdAt / name / enterpriseName 改了不算篡改', async () => {
    const base = await digestFrame(frame());
    expect(await digestFrame(frame({ createdAt: '2027-01-01 00:00:00' }))).toBe(base);   // 改名/改时间即"篡改"是误报
    expect(await digestFrame(frame({ name: '改了名字' }))).toBe(base);
    expect(await digestFrame(frame({ enterpriseName: '企业2' }))).toBe(base);
  });

  it('内容字段逐一参与指纹：cash / 流水日志 / version / timestamp / resetCount / id', async () => {
    const f = frame();
    const base = await digestFrame(f);
    const bumpCash = frame();
    bumpCash.state.finance.cash += 1;
    const bumpLogs = frame();
    // 单验 cash 不够：若指纹哪天被窄化成只覆盖 state.finance，改流水日志（审计链读的就是它）
    // 就悄悄不再改变指纹，而全套用例仍是绿的。
    bumpLogs.state.operation.financialLogs.push({} as never);
    const changed = [
      frame({ version: SAVE_FORMAT_VERSION + 1 }),
      frame({ timestamp: 2 }),
      frame({ resetCount: 1 }),
      frame({ id: 's2' }),
      bumpCash,
      bumpLogs,
    ];
    for (const g of changed) {
      expect(await digestFrame(g)).not.toBe(base);
    }
  });

  it('JSON 往返（导出字节 → 导入解析）不改指纹：S-T5 与 S-T7 必须算出同一个值', async () => {
    const f = frame();
    const viaBytes = JSON.parse(JSON.stringify(f)) as SaveFile;
    expect(await digestFrame(viaBytes)).toBe(await digestFrame(f));
    // 反例守门：把 state 里的一条日志挪个位置/换个键序，往返后仍应与原帧一致（规范化生效的意义）
    const reordered = JSON.parse(JSON.stringify({
      enterpriseName: f.enterpriseName, resetCount: f.resetCount, state: f.state,
      version: f.version, name: f.name, id: f.id, timestamp: f.timestamp, createdAt: f.createdAt,
    })) as SaveFile;
    expect(await digestFrame(reordered)).toBe(await digestFrame(f));
  });

  it('不改入参、不碰 localStorage（指纹计算是纯读）', async () => {
    const f = frame();
    const before = JSON.parse(JSON.stringify(f));
    const getItem = vi.spyOn(localStorage, 'getItem');
    const setItem = vi.spyOn(localStorage, 'setItem');
    const digest = await digestFrame(f);
    expect(JSON.parse(JSON.stringify(f))).toEqual(before);
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(digest).toMatch(/^sha256:/);
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it('无 crypto.subtle 时逐帧指纹同样降级，不返回 null / 空串', async () => {
    vi.stubGlobal('crypto', undefined);
    expect(await digestFrame(frame())).toBe('unavailable:insecure-context');
  });
});
