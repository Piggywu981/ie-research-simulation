// 存档包导入的落库语义与预览印面（规格 §4.3 导入与预览、§7 第 6/10 条）。
// 这里守两件事：
// 1) **默认不覆盖**——同 id 冲突时改名追加，原有那一帧必须逐字节不变（§7.6 的可执行证明）；
//    逐帧迁移用的是**该帧自己**声明的 version（旧档重述串换算的口径开关，见 migrateState），
//    不是整包的 app.saveVersion，否则一包里混装的 v3 帧会带着旧口径串被当成 v4 判定。
// 2) 预览的**印面**——审计给的是 null（规格 §4.4「null 而非 NaN」），帧的 resetCount 又不在
//    Task 6 的结构校验口径内（残留项），于是"怎么把读数印成人话"本身就是会出错的地方：
//    `${null}M` 会印出 "nullM"，`${NaN}` 会印出 "NaN"，读的人是教师。这几条纯格式化支路
//    从组件里导出来测（本仓库测试环境是 node、无 jsdom，规格 §7「全部为纯函数或 store 级测试」）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFreshState, migrateState, useEnterpriseStore } from '../src/store/enterpriseStore';
import { SAVE_FORMAT_VERSION, type FinancialLogRecord, type SaveFile } from '../src/types/enterprise';
import { auditFrame, CAUSE_TEXT, CALIBER_TEXT, type FrameAudit } from '../src/utils/audit';
import { digestSkipNote, formatFrameAudit, isComparableDigest, money, moneySum, readNumber } from '../src/components/SaveLoadPanel';

const store = () => useEnterpriseStore.getState();

const frame = (id: string, cash: number): SaveFile => ({
  id, name: `帧${id}`, enterpriseName: '企业1', timestamp: 1, resetCount: 0, version: 4, createdAt: 'x',
  state: { ...createFreshState(), finance: { ...createFreshState().finance, cash } },
});

// 真落盘的原始帧字节（store 写的是 JSON.stringify，读回来的键序未必与内存对象一致，逐字节比较只认这个）
const rawStored = (): string => localStorage.getItem('enterpriseSaveFiles') ?? '';

// v3 形态的日志：没有 kind 字段（Task 1 之前根本不写），summary 记的是**旧口径**（引擎自动项净额 -5，
// 而 newCash 链要求它是 25-20=5）。migrateState(raw, 3) 会补 kind 并把那条串换算成 5；
// migrateState(raw, 4) 则绝不碰它——这就是"逐帧按各自 version 迁移"的可观察差异。
const v3Logs = (): FinancialLogRecord[] => ([
  { id: 'l3', year: 1, quarter: 1, timestamp: 3, description: '其他现金流入：+30M', cashChange: 30, newCash: 55, operator: '企业1管理者', stepId: 'q-19' },
  { id: 'l2', year: 1, quarter: 1, timestamp: 2, description: '第1年第1季 季度结束现金变动', cashChange: -5, newCash: 25, operator: '系统' },
  { id: 'l1', year: 1, quarter: 1, timestamp: 1, description: '初始现金', cashChange: 20, newCash: 20, operator: '系统初始化' },
] as unknown as FinancialLogRecord[]);

const legacyFrame = (id: string, version: number): SaveFile => {
  const state = createFreshState();
  state.operation.financialLogs = v3Logs();
  state.finance.cash = 55;
  return { id, name: `旧帧${id}`, enterpriseName: '企业1', timestamp: 1, resetCount: 0, version, createdAt: 'x', state };
};

beforeEach(() => {
  useEnterpriseStore.setState({ state: createFreshState(), saveFiles: [], validationError: null });
  localStorage.removeItem('enterpriseSaveFiles');
});

describe('导入落库语义（默认不覆盖）', () => {
  it('首次导入原样加入', () => {
    const r = store().importSaveFiles([frame('s1', 100)]);
    expect(r).toEqual({ added: 1, renamed: 0 });
    expect(store().getSaveFiles()).toHaveLength(1);
  });

  it('同 id 重复导入改名追加，原条目内容不变', () => {
    store().importSaveFiles([frame('s1', 100)]);
    const r = store().importSaveFiles([frame('s1', 999)]);
    expect(r).toEqual({ added: 1, renamed: 1 });
    const files = store().getSaveFiles();
    expect(files).toHaveLength(2);
    expect(files.some(f => f.id === 's1' && f.state.finance.cash === 100)).toBe(true);
    expect(files.some(f => f.id === 's1-imported-1' && f.state.finance.cash === 999)).toBe(true);
  });

  it('applyImportedState 只换当前屏，不写存档列表', () => {
    store().applyImportedState(frame('s1', 77).state, 4);
    expect(store().state.finance.cash).toBe(77);
    expect(store().getSaveFiles()).toHaveLength(0);
  });

  it('暂停时 importSaveFiles 被拒绝且状态零变化', () => {
    store().togglePaused();
    const before = store().getSaveFiles().length;
    store().importSaveFiles([frame('s1', 100)]);
    expect(store().validationError).toContain('暂停');
    expect(store().getSaveFiles()).toHaveLength(before);
  });

  it('连导三次同一 id 取**首个空闲**后缀：第二次 -imported-1、第三次 -imported-2', () => {
    store().importSaveFiles([frame('s1', 100)]);
    store().importSaveFiles([frame('s1', 200)]);
    const r = store().importSaveFiles([frame('s1', 300)]);
    expect(r).toEqual({ added: 1, renamed: 1 });
    expect(store().getSaveFiles().map(f => f.id).sort()).toEqual(['s1', 's1-imported-1', 's1-imported-2']);
  });

  it('原有帧逐字节不变，新帧排在列表最前', () => {
    store().importSaveFiles([frame('s1', 100)]);
    const bytesBefore = rawStored();
    store().importSaveFiles([frame('s1', 999)]);
    expect(rawStored()).toContain(bytesBefore.slice(1, bytesBefore.length - 1));
    expect(store().getSaveFiles()[0].id).toBe('s1-imported-1');
  });

  it('一批多帧：冲突与不冲突混合时 added/renamed 各自计数正确', () => {
    store().importSaveFiles([frame('s1', 100), frame('s2', 100)]);
    const r = store().importSaveFiles([frame('s1', 1), frame('s3', 2), frame('s2', 3)]);
    expect(r).toEqual({ added: 3, renamed: 2 });
    expect(store().getSaveFiles()).toHaveLength(5);
  });

  it('importSaveFiles 按**每帧自带的 version**迁移：v3 帧换算重述串，v4 帧原样', () => {
    store().importSaveFiles([legacyFrame('old3', 3), legacyFrame('new4', SAVE_FORMAT_VERSION)]);
    const files = store().getSaveFiles();
    const byId = (id: string) => files.find(f => f.id === id)!;
    // v3 那一帧：kind 已回填，旧口径串按 newCash 链换算成 25-20=5
    expect(byId('old3').state.operation.financialLogs.find(l => l.id === 'l2')?.kind).toBe('summary');
    expect(byId('old3').state.operation.financialLogs.find(l => l.id === 'l2')?.cashChange).toBe(5);
    // v4 那一帧：版本标签说这串本就该是新口径，迁移**不**替它改写金额
    expect(byId('new4').state.operation.financialLogs.find(l => l.id === 'l2')?.cashChange).toBe(-5);
    // 与"按 3 迁移"的期望值逐字节一致，证明落库走的就是 migrateState 那一条链、没有第二份逻辑
    expect(JSON.stringify(byId('old3').state)).toBe(JSON.stringify(migrateState(legacyFrame('old3', 3).state, 3)));
  });

  it('暂停时 applyImportedState 被拒绝：当前屏、存档列表与 localStorage 全不变', () => {
    store().togglePaused();
    const beforeState = JSON.stringify(store().state);
    store().applyImportedState(frame('s1', 777).state, 4);
    expect(store().validationError).toContain('暂停');
    expect(JSON.stringify(store().state)).toBe(beforeState);
    expect(rawStored()).toBe('');
  });

  it('落库真的写入 localStorage（不是只改内存里的 saveFiles）', () => {
    store().importSaveFiles([frame('s1', 100)]);
    expect(JSON.parse(rawStored()).some((f: SaveFile) => f.id === 's1')).toBe(true);
  });
});

describe('预览印面守卫（无 jsdom，只测纯格式化支路）', () => {
  const audit = (over: Partial<FrameAudit>): FrameAudit => ({
    saveId: 's1', saveName: '帧1', year: 2, quarter: 3,
    flowRebuilt: 120, restatedRebuilt: 120, actualCash: 120,
    status: 'mismatch', cause: 'flow-log', restatementCaliber: 'v4', ...over,
  });

  it('money：有限数字带 M，null/NaN/Infinity 一律印破折号', () => {
    expect(money(120)).toBe('120M');
    expect(money(-5)).toBe('-5M');
    expect(money(null)).toBe('—');
    expect(money(undefined)).toBe('—');
    expect(money(Number.NaN)).toBe('—');
    expect(money(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('moneySum：条目里出现非有限值就整项作废，不静默当 0 计入合计', () => {
    expect(moneySum([10, 20])).toBe('30M');
    expect(moneySum([])).toBe('0M');
    expect(moneySum([10, undefined])).toBe('—（数据异常）');
    expect(moneySum(['50', 10])).toBe('—（数据异常）');
    expect(moneySum([10, Number.NaN])).toBe('—（数据异常）');
  });

  it('readNumber：重置次数缺校验（Task 6 残留），非有限即印破折号', () => {
    expect(readNumber(3)).toBe('3');
    expect(readNumber(0)).toBe('0');
    expect(readNumber(Number.NaN)).toBe('—');
    expect(readNumber('2')).toBe('—');
    expect(readNumber(undefined)).toBe('—');
    expect(readNumber(null)).toBe('—');
  });

  it('no-anchor 帧：报「起算链不完整」，不附口径文案、不印出 null/NaN', () => {
    const text = formatFrameAudit(audit({ status: 'no-anchor', cause: null, flowRebuilt: null, restatedRebuilt: null }));
    expect(text).toContain('起算链不完整');
    expect(text).not.toContain('null');
    expect(text).not.toContain('NaN');
    // 「本帧按 v4 口径判定…」说的是 B 侧读数的身份，这一帧两侧都没算成，附上去就是自相矛盾的印面
    expect(text).not.toContain(CALIBER_TEXT.v4);
  });

  it('mismatch 帧：重建值为 null 时印「—」而不是 nullM，其余读数照常', () => {
    const text = formatFrameAudit(audit({ flowRebuilt: null, restatedRebuilt: null }));
    expect(text).not.toMatch(/nullM|NaNM|InfinityM/);
    expect(text).toContain('—');
    expect(text).toContain('120M');
    expect(text).toContain(CAUSE_TEXT['flow-log']);
    expect(text).toContain('第2年第3季');
  });

  it('旧档（version<4）帧的不平：措辞来自 CALIBER_TEXT，明说「不符」不等于篡改', () => {
    const tampered = legacyFrame('old3', 3);
    tampered.state.finance.cash = 85; // +30 的手改形态：A 侧 Σflow=50 而帧末现金 85
    const result = auditFrame(tampered);
    expect(result.status).toBe('mismatch');
    expect(result.restatementCaliber).toBe('legacy-unconverted');
    const text = formatFrameAudit(result);
    expect(text).toContain('不等于篡改');
    expect(text).toContain(CALIBER_TEXT[result.restatementCaliber]);
    // 判据仍然说得出：不是一句"无法判定"糊过去
    expect(text).toContain(CAUSE_TEXT[result.cause as 'flow-log' | 'restated-log' | 'both']);
  });

  it('digestSkipNote：按 unavailable: 前缀分派，空/缺字段算「包内无记录」，sha256: 交回比对', () => {
    expect(digestSkipNote('帧1', 'unavailable:insecure-context')).toBe('帧1：哈希未计算（非 HTTPS 环境）');
    expect(digestSkipNote('帧1', 'unavailable:bad-digest')).toContain('帧1：哈希未计算（bad-digest）');
    expect(digestSkipNote('帧1', 'unavailable:typeerror')).toContain('typeerror');
    expect(digestSkipNote('帧1', '')).toContain('包内无记录');
    expect(digestSkipNote('帧1', undefined)).toContain('包内无记录');
    expect(digestSkipNote('帧1', 'sha256:0123456789abcdef')).toBeNull();
  });

  it('isComparableDigest：只有 sha256: 前缀能比值，unavailable: 一律不算（比了就是假证）', () => {
    expect(isComparableDigest('sha256:0123456789abcdef')).toBe(true);
    expect(isComparableDigest('unavailable:insecure-context')).toBe(false);
    expect(isComparableDigest('')).toBe(false);
    expect(isComparableDigest(undefined)).toBe(false);
    // 本侧重算在缺 crypto.subtle 的环境给的就是这一支：拿它去比包里的 sha256 必然不等，
    // 于是"换浏览器/离线打开"的正常导入被印成「指纹不一致」——所以两侧都要过这道闸
    expect(isComparableDigest('unavailable:bad-digest')).toBe(false);
  });
});

describe('导入落库的失败面与改名标注（评审 Task 7 finding 2/3/4）', () => {
  beforeEach(() => {
    useEnterpriseStore.setState({ state: createFreshState(), validationError: null });
    localStorage.removeItem('enterpriseSaveFiles');
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('localStorage 写满时：本次导入不落库、原存档逐字节不变、原因说得出「本地存储」', () => {
    // 解析层允许到 8MB 而源配额约 5MB，所以"合法的大包"会在 setItem 抛 QuotaExceededError。
    // 抛点在写入之前，原列表不会残半截；但必须把原因说出来（规格 §6），且内存列表也不能先换掉——
    // 否则刷新前是一套、刷新后是另一套。
    store().importSaveFiles([frame('s1', 100)]);
    const bytesBefore = rawStored();
    const err = new Error('exceeded');
    err.name = 'QuotaExceededError';
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw err; });
    const r = store().importSaveFiles([frame('s1', 999)]);
    spy.mockRestore();
    expect(r).toEqual({ added: 0, renamed: 0 });
    expect(store().validationError).toContain('本地存储');
    expect(store().validationError).toContain('原有存档未改动');
    expect(store().getSaveFiles()).toHaveLength(1);
    expect(rawStored()).toBe(bytesBefore);
  });

  it('被追加改名的那一帧标得出「（导入N）」，不冲突的那一帧名字原样保留', () => {
    // 控制表按 (年,季) 取最大 timestamp 选帧，两帧同名到秒时在列表里分不出哪份是被追加的（finding 3）
    store().importSaveFiles([frame('s1', 100)]);
    store().importSaveFiles([frame('s1', 999)]);
    store().importSaveFiles([frame('s2', 7)]);
    const files = store().getSaveFiles();
    expect(files.find(f => f.id === 's1')!.name).toBe('帧s1');
    expect(files.find(f => f.id === 's2')!.name).toBe('帧s2');
    expect(files.find(f => f.id === 's1-imported-1')!.name).toBe('帧s1（导入1）');
  });

  it('「设为当前进度」把重置次数与预览对齐；不传或传非有限值就沿用本机计数（finding 4）', () => {
    expect(store().resetCount).toBe(0);
    store().applyImportedState(frame('s1', 77).state, 4, 3);
    expect(store().resetCount).toBe(3);
    expect(store().state.finance.cash).toBe(77);
    store().applyImportedState(frame('s1', 88).state, 4);            // 包内没有历史帧 → 计数不动
    expect(store().resetCount).toBe(3);
    store().applyImportedState(frame('s1', 99).state, 4, NaN);       // 非有限值同样不采信
    expect(store().resetCount).toBe(3);
    expect(store().getSaveFiles()).toHaveLength(0);                   // 这一路始终不碰存档列表
  });
});

describe('指纹声明的原型链读法（评审 Task 7 finding 1）', () => {
  it('digests.frames 读出来的值不是字符串时按「包内无记录」说，绝不拿它去 .replace', () => {
    // id 为 constructor/toString 这类原型链上的名字时，点号读出来是函数或 Object.prototype，
    // 而契约要求这种情形印「哈希未计算（包内无记录）」——早先的实现会在下一行抛 TypeError，
    // 预览于是变成「读取失败：TypeError…」
    expect(digestSkipNote('帧x', undefined)).toBe('帧x：哈希未计算（包内无记录）');
    expect(digestSkipNote('帧x', Object.prototype as unknown as string))
      .toBe('帧x：哈希未计算（包内无记录）');
    expect(digestSkipNote('帧x', (() => 1) as unknown as string))
      .toBe('帧x：哈希未计算（包内无记录）');
    expect(digestSkipNote('帧x', 'unavailable:bad-digest')).toBe('帧x：哈希未计算（bad-digest）');
    expect(digestSkipNote('帧x', 'sha256:0123456789abcdef')).toBeNull();
  });
});
