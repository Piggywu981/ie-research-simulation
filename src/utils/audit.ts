// 账实重演算（规格 §4.4）：只依赖 flow/summary 分类，不用 newCash、不用密码学、不跨帧拼接。
// 帧内不做季度级猜测定位——按 (year,quarter) 分桶会因年末日志被 remap 到 (收尾年,4)、
// 重述串落在 (新年,新季) 而错位；按数组顺序累计也不行，因为 quarterEndLog 在 allLogs 里排在
// 年末结算日志之前。季度坐标改由整包给出（见 auditFrames / firstDivergingFrame）。
import type { FinancialLogRecord, SaveFile } from '../types/enterprise';
import { RESTATED_FULL_NET_FROM_VERSION, isSeedLog, restatedChainIsNewCaliber } from './restatement';

export type AuditStatus = 'ok' | 'mismatch' | 'no-anchor';
// 两种独立重建都不平时才落到 both；单侧失败可指名道姓
export type AuditCause = 'flow-log' | 'restated-log' | 'both';

// B 侧读数（restatedRebuilt）在这一帧里到底是什么身份，见 FrameAudit.restatementCaliber 的逐值说明。
export type RestatementCaliber = 'v4' | 'legacy-converted' | 'legacy-unconverted';

export interface FrameAudit {
  saveId: string;
  saveName: string;
  year: number;
  quarter: number;
  flowRebuilt: number | null;      // A：Σ 全部 flow（含期初种子）
  restatedRebuilt: number | null;  // B：期初种子 + Σ 重述串 + 尾随流水（version < 4 的旧档只作展示，不参与判定）
  actualCash: number;
  status: AuditStatus;
  cause: AuditCause | null;
  // 审计用哪一侧当证据，是**存档版本 + 迁移换算结果**的函数。S-T5/S-T7/S-T8 直接展示它，
  // 不要各自再去读 SaveFile.version 推一遍：一条规则写三处就是 §5.7 那类漂移的起点
  // （SAVE_FORMAT_VERSION 单点定义的理由同款）。它只描述 B 侧读数的身份，不改变 status/cause 的判定。
  //   'v4'                 version >= 4：串按新口径产生（v3 旧档也在载入时被 migrateState 重建过），
  //                        A、B 双侧都参与判定 → restatedRebuilt 可以当证据用。
  //   'legacy-converted'   version < 4 而整串已经是新口径（老档那些季度本就没有玩家手操，或这帧的 state
  //                        已经过换算）：restatedRebuilt 的读数可信，但判定仍只看 A——version 是存档时写死
  //                        的标签，不能靠内容反推去指控旧档（那正是评审 C1 的假阳性形态）。
  //   'legacy-unconverted' version < 4 且串是旧口径、或残缺到换不出（缺种子 / summary 无有限 newCash /
  //                        连 kind 都还没被认出来的原始帧）：restatedRebuilt 只是展示读数，
  //                        UI 必须附「旧口径链，不作金额结论」，不能把它印成篡改证据。
  restatementCaliber: RestatementCaliber;
}

const sumBy = (logs: FinancialLogRecord[], pick: (l: FinancialLogRecord) => boolean) =>
  logs.filter(pick).reduce((t, l) => t + l.cashChange, 0);

export function auditFrame(save: SaveFile): FrameAudit {
  const logs = save.state.operation?.financialLogs ?? [];
  // 旧档（version < 4）的重述串是旧口径（只累加引擎自动项、漏掉玩家主动交易）。
  // 载入时 migrateState 会把它按 newCash 链重建成新口径，但**存进包里的这一帧字节没被改过**，
  // 所以审计旧档这一帧时 B 仍只作展示读数、绝不参与判定：判据降级为单侧（只看 A），
  // 否则每个健康的老档都会被写成一条「重述串被篡改」的伪证（S-T5/S-T7/S-T8 因此无需各自再补版本分支）。
  const legacyRestated = (save.version ?? 0) < RESTATED_FULL_NET_FROM_VERSION;
  const restatementCaliber: RestatementCaliber = !legacyRestated
    ? 'v4'
    : restatedChainIsNewCaliber(logs) ? 'legacy-converted' : 'legacy-unconverted';
  const base = {
    saveId: save.id,
    saveName: save.name,
    year: save.state.operation?.currentYear ?? 0,
    quarter: save.state.operation?.currentQuarter ?? 0,
    actualCash: save.state.finance.cash,
    restatementCaliber,
  };
  const seeds = logs.filter((l) => l.kind === 'flow' && isSeedLog(l));
  if (seeds.length === 0) {
    // 链条被截断时报「起算链不完整」而不是「账实不符」；用 null 不用 NaN（规格 §4.4）：
    // NaN 过 JSON.stringify 会变成 null，看着一样，但在内存里参与求和/比较会静默传染 NaN
    return { ...base, flowRebuilt: null, restatedRebuilt: null, status: 'no-anchor', cause: null };
  }

  const seedCash = sumBy(seeds, () => true);
  const flowRebuilt = sumBy(logs, (l) => l.kind === 'flow');
  // B 式：期初种子 + Σ重述串 + 晚于最新一条重述串的流水（季中手动存档留下的开尾缝隙）。
  // 「晚于」取严格大于，前提是推进与后续手操不落在 Date.now() 的同一毫秒里——真实手操隔着秒，
  // 同毫秒时这笔流水既不在重述串里也不进尾项，B 会少算并假报 restated-log（测试里用假时钟隔开）。
  // 帧里没有重述串时 latestRestatedAt 取 0，尾项自动吞下全部非种子流水，于是 B ≡ A：
  // 这就是正确的算法——那一帧根本没有重述串可篡改，B 不携带任何独立信息，
  // 不能据「B 与 A 不等」去指控流水或帧末现金被动过（旧写法在此处塌回种子，对第 1 季的手动存档假报 restated-log）。
  const summaries = logs.filter((l) => l.kind === 'summary');
  const latestRestatedAt = summaries.reduce((t, l) => Math.max(t, l.timestamp), 0);
  const restatedSum = summaries.reduce((t, l) => t + l.cashChange, 0);
  const tailFlows = sumBy(logs, (l) => l.kind === 'flow' && !isSeedLog(l) && l.timestamp > latestRestatedAt);
  const restatedRebuilt = seedCash + restatedSum + tailFlows;
  // 判据降级（B 不参与判定）的由来见函数开头 legacyRestated 那段；读数的身份见 FrameAudit.restatementCaliber。
  const aOk = flowRebuilt === base.actualCash;
  const bOk = restatedRebuilt === base.actualCash;

  if (aOk && (bOk || legacyRestated)) return { ...base, flowRebuilt, restatedRebuilt, status: 'ok', cause: null };
  // 降级分支只在 A 已不平（两侧必然都不平）时到达：此时没有可信的第二侧重建可供进一步区分，
  // 只能指认「流水条目与现金不符」；restated-log 要靠 B 作证、both 要靠 B 排除，旧档都给不出这个证据。
  const cause: AuditCause = legacyRestated
    ? 'flow-log'
    : aOk ? 'restated-log' : bOk ? 'flow-log' : 'both';
  return { ...base, flowRebuilt, restatedRebuilt, status: 'mismatch', cause };
}

// 包内定位：按时间升序找最早不平的那一帧（规格 §4.4；帧自带逐季快照，这是唯一可靠的季度坐标）。
// no-anchor 也算"有问题的最早一帧"，但由调用方按 status 分述，不与账实不符混为一谈。
// 先浅拷贝再排序：调用方传入的可能是 store 里的存档列表，不允许被就地改序。
// timestamp 相同（同一毫秒里的手动存档与 nextQuarter 触发的自动存档很常见）时用 id 兜底：
// 比较器必须全序，否则 sort 的稳定性把输入数组的顺序当成结果顺序，firstDivergingFrame 会报错季。
export const auditFrames = (frames: SaveFile[]): FrameAudit[] =>
  [...frames]
    .sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))
    .map(auditFrame);

export const firstDivergingFrame = (results: FrameAudit[]): FrameAudit | null =>
  results.find((r) => r.status !== 'ok') ?? null;

export const auditSummary = (results: FrameAudit[]) => ({
  total: results.length,
  ok: results.filter((r) => r.status === 'ok').length,
  mismatch: results.filter((r) => r.status === 'mismatch').length,
  noAnchor: results.filter((r) => r.status === 'no-anchor').length,
});

// S-T7 预览与 S-T8 报告共用同一份措辞，避免两处各写一遍
export const CAUSE_TEXT: Record<AuditCause, string> = {
  'flow-log': '流水条目与现金不符',
  'restated-log': '季度重述串与现金不符',
  both: '帧末现金或期初条目被改',
};
