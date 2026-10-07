// 账实重演算（规格 §4.4）：只依赖 flow/summary 分类，不用 newCash、不用密码学、不跨帧拼接。
// 帧内不做季度级猜测定位——按 (year,quarter) 分桶会因年末日志被 remap 到 (收尾年,4)、
// 重述串落在 (新年,新季) 而错位；按数组顺序累计也不行，因为 quarterEndLog 在 allLogs 里排在
// 年末结算日志之前。季度坐标改由整包给出（见 auditFrames / firstDivergingFrame）。
import type { FinancialLogRecord, SaveFile, SavePackage } from '../types/enterprise';
import { money, readNumber } from './format';
import { RESTATED_FULL_NET_FROM_VERSION, isSeedLog, kindOfLog, restatedChainIsNewCaliber } from './restatement';

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
  flowRebuilt: number | null;      // A：Σ 全部 flow（含期初种子）；null = 无从起算或读数非有限
  restatedRebuilt: number | null;  // B：期初种子 + Σ 重述串 + 尾随流水；null 同上（version < 4 的旧档只作展示，不参与判定）
  actualCash: number;
  status: AuditStatus;
  cause: AuditCause | null;
  // 审计用哪一侧当证据，是**存档版本 + 迁移换算结果**的函数。S-T5/S-T7/S-T8 直接展示它，
  // 不要各自再去读 SaveFile.version 推一遍：一条规则写三处就是 §5.7 那类漂移的起点
  // （SAVE_FORMAT_VERSION 单点定义的理由同款）。它只描述 B 侧读数的身份，不改变 status/cause 的判定；
  // 逐值的对外措辞就是文件末尾那份 CALIBER_TEXT（同一张表，唯一的一份，消费方直接 import）。
  //   'v4'                 version >= 4：串**应当**按新口径产生（v3 旧档也在载入时被 migrateState 重建过），
  //                        A、B 双侧都参与判定 → restatedRebuilt 可以当证据用。
  //                        注意这一档只跟着存档的版本标签走，它分不清「按新口径产生」与「kind/口径修复落地
  //                        之前就写下、带着 v4 标签却是旧口径串」那一类（旧版 migrateState 不换算、之后又存了档）：
  //                        所以 CALIBER_TEXT['v4'] 说的是**这一帧按 v4 口径判定**这个前提，不是「逐串核实过」。
  //   'legacy-converted'   version < 4 而整串已经是新口径（老档那些季度本就没有玩家手操，或这帧的 state
  //                        已经过换算）：restatedRebuilt 的读数可信，但判定仍只看 A——version 是存档时写死
  //                        的标签，不能靠内容反推去指控旧档（那正是评审 C1 的假阳性形态）。
  //   'legacy-unconverted' version < 4 且串是旧口径、或残缺到换不出（缺种子 / summary 无有限 newCash）：
  //                        restatedRebuilt 只是展示读数（「不作金额结论」那句说的就是它），不能印成篡改证据。
  //                        日志没有 kind 的原始帧也走这条（分类见 restatement.ts 的 kindOfLog），但它照样跑 A 侧
  //                        判定、不会被降级成「无从起算」：于是**天然不平**的老档（v3 时代有过没写进流水的现金变动）
  //                        印出来也是 CAUSE_TEXT['flow-log'] 那句「不符」，与 v4 帧上的篡改判定**逐字相同**。
  //                        这层区分只能由文案给出：CALIBER_TEXT['legacy-unconverted'] 明说「不符」不等于篡改，
  //                        条数由 auditSummary 的 legacyMismatch 单独给。消费方不要自己拼这句、更不要自己读 version。
  restatementCaliber: RestatementCaliber;
}

const sumBy = (logs: FinancialLogRecord[], pick: (l: FinancialLogRecord) => boolean) =>
  logs.filter(pick).reduce((t, l) => t + l.cashChange, 0);

// 非有限读数出门前折成 null（规格 §4.4「null 而非 NaN」的另一半）：`1e999` 过 JSON.parse 就是 Infinity、
// 非数值字段过加法就是 NaN，两者过 JSON.stringify 都会变成 null——内存里留着它们会静默传染任何后续
// 求和/比较，还会让 S-T8 的报告给一帧真有数字的存档打出 null。判定仍比原始值（见下面 aOk/bOk），
// 故这条不改任何状态语义：非有限读数与 finite 的帧末现金本就不相等 → 照旧是 mismatch，
// 只是不把非有限值带出去；帧末现金自己被改成 Infinity 的那种平法不在本条守卫的半径内。
const finiteOr = (n: number): number | null => (Number.isFinite(n) ? n : null);

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
  // 分类一律走 restatement.ts 的 kindOfLog：显式 kind 优先，没有 kind 的原始旧档按产生位置特征兜底
  // （与 migrateState 的回填同源同一条谓词）。就地读 `l.kind` 的写法只对经过 loadGame 的帧成立，
  // 而未迁移的原始 v3 帧（S-T5 导出的 getSaveFiles() 列表、S-T7 审计的 pkg.saves）会连种子都认不出来、
  // 整帧塌成 no-anchor —— 一个健康旧档包就此每帧印「起算链不完整」。
  const seeds = logs.filter((l) => kindOfLog(l) === 'flow' && isSeedLog(l));
  if (seeds.length === 0) {
    // 链条被截断时报「起算链不完整」而不是「账实不符」；用 null 不用 NaN（规格 §4.4）：
    // NaN 过 JSON.stringify 会变成 null，看着一样，但在内存里参与求和/比较会静默传染 NaN
    return { ...base, flowRebuilt: null, restatedRebuilt: null, status: 'no-anchor', cause: null };
  }

  const seedCash = sumBy(seeds, () => true);
  const flowRebuilt = sumBy(logs, (l) => kindOfLog(l) === 'flow');
  // B 式：期初种子 + Σ重述串 + 晚于最新一条重述串的流水（季中手动存档留下的开尾缝隙）。
  // 「晚于」取严格大于，前提是推进与后续手操不落在 Date.now() 的同一毫秒里——真实手操隔着秒，
  // 同毫秒时这笔流水既不在重述串里也不进尾项，B 会少算并假报 restated-log（测试里用假时钟隔开）。
  // 帧里没有重述串时 latestRestatedAt 取 -Infinity，尾项自动吞下全部非种子流水，于是 B ≡ A：
  // 这就是正确的算法——那一帧根本没有重述串可篡改，B 不携带任何独立信息，
  // 不能据「B 与 A 不等」去指控流水或帧末现金被动过（旧写法在此处塌回种子，对第 1 季的手动存档假报 restated-log）。
  // 那个「没有重述串」的哨兵值刻意不是 0：0 会被读成「时间起点」，可时间戳真被手改成 0 或负数的流水
  // 就在严格大于下掉出 B，于是零重述串的帧又假报一次 restated-log（上一轮 C1 的形态从时间戳这里漏回来）。
  // 取 -Infinity 后「任何时间戳都晚于它」，对真实 Date.now() 行为完全不变。
  const summaries = logs.filter((l) => kindOfLog(l) === 'summary');
  const latestRestatedAt = summaries.reduce((t, l) => Math.max(t, l.timestamp), Number.NEGATIVE_INFINITY);
  const restatedSum = summaries.reduce((t, l) => t + l.cashChange, 0);
  const tailFlows = sumBy(logs, (l) => kindOfLog(l) === 'flow' && !isSeedLog(l) && l.timestamp > latestRestatedAt);
  const restatedRebuilt = seedCash + restatedSum + tailFlows;
  // 判据降级（B 不参与判定）的由来见函数开头 legacyRestated 那段；读数的身份见 FrameAudit.restatementCaliber。
  const aOk = flowRebuilt === base.actualCash;
  const bOk = restatedRebuilt === base.actualCash;
  // 两个重建值出门前过一次 finiteOr：见上面那段「null 而非 NaN」
  const readings = { flowRebuilt: finiteOr(flowRebuilt), restatedRebuilt: finiteOr(restatedRebuilt) };

  if (aOk && (bOk || legacyRestated)) return { ...base, ...readings, status: 'ok', cause: null };
  // 降级分支只在 A 已不平（两侧必然都不平）时到达：此时没有可信的第二侧重建可供进一步区分，
  // 只能指认「流水条目与现金不符」；restated-log 要靠 B 作证、both 要靠 B 排除，旧档都给不出这个证据。
  const cause: AuditCause = legacyRestated
    ? 'flow-log'
    : aOk ? 'restated-log' : bOk ? 'flow-log' : 'both';
  return { ...base, ...readings, status: 'mismatch', cause };
}

// 包内定位：按时间升序找最早不平的那一帧（规格 §4.4；帧自带逐季快照，这是唯一可靠的季度坐标）。
// no-anchor 也算"有问题的最早一帧"，但由调用方按 status 分述，不与账实不符混为一谈。
// 先浅拷贝再排序：调用方传入的可能是 store 里的存档列表，不允许被就地改序。
// timestamp 相同（同一毫秒里的手动存档与 nextQuarter 触发的自动存档很常见）时用 id 兜底：
// 比较器必须全序，否则 sort 的稳定性把输入数组的顺序当成结果顺序，firstDivergingFrame 会报错季。
// 这条「时间优先、同毫秒按 id」的定序**只有一份**（本函数、面板的时间跨度、报告的重置次数都调它）：
// 兜底写法若两处不一致（`a.id < b.id` 与 localeCompare 对大小写与 `_` 的排序就不同，实测 56 对 id 里
// 20 对不一致），同毫秒时报告与预览会各自取到不同的一帧（评审 Task 7 finding 5）。
export const byTimeThenId = (a: SaveFile, b: SaveFile): number =>
  (a.timestamp - b.timestamp) || a.id.localeCompare(b.id);

export const auditFrames = (frames: SaveFile[]): FrameAudit[] =>
  [...frames].sort(byTimeThenId).map(auditFrame);

export const firstDivergingFrame = (results: FrameAudit[]): FrameAudit | null =>
  results.find((r) => r.status !== 'ok') ?? null;

export const auditSummary = (results: FrameAudit[]) => ({
  total: results.length,
  ok: results.filter((r) => r.status === 'ok').length,
  mismatch: results.filter((r) => r.status === 'mismatch').length,
  noAnchor: results.filter((r) => r.status === 'no-anchor').length,
  // mismatch 里属于旧档（version < 4，即 restatementCaliber !== 'v4'）的那部分：老档的「不符」与
  // 新档的「不符」是两件事（前者可能只是 v3 时代没落账的现金变动，后者才当篡改看），报告与面板要分开说，
  // 所以这个数由审计给，不由消费方拿 version 现算。恒有 legacyMismatch ≤ mismatch（它是 mismatch 的子集）。
  legacyMismatch: results.filter((r) => r.status === 'mismatch' && r.restatementCaliber !== 'v4').length,
});

// S-T7 预览与 S-T8 报告共用同一份措辞，避免两处各写一遍
export const CAUSE_TEXT: Record<AuditCause, string> = {
  'flow-log': '流水条目与现金不符',
  'restated-log': '季度重述串与现金不符',
  both: '帧末现金或期初条目被改',
};

// restatementCaliber 三值的文案，与 CAUSE_TEXT 并列、同样单点住在这里：S-T7 预览与 S-T8 报告**直接 import**，
// 不得各自再建一份、更不得从 SaveFile.version 反推（口径与文案都只许住一处，理由见 FrameAudit.restatementCaliber）。
// 后两条必须把「旧档的『不符』≠ 篡改」说出来（评审 round-3 new finding #1）：未迁移的 v3 帧照跑 A 侧判定，
// 而 v3 时代本就可能有过没写进流水的现金变动，那种天然不平印出来与 v4 帧上的篡改判定**逐字同一句**
// CAUSE_TEXT['flow-log']。只靠「旧口径链，不作金额结论」挡不住它——那句说的是 B 读数的身份，不是 A 判定的含义。
export const CALIBER_TEXT: Record<RestatementCaliber, string> = {
  'v4': '本帧按 v4 口径判定（依版本标签推定，未逐串核实）',
  'legacy-converted': '旧档（version<4）：重述串已换算，判定只依据流水',
  'legacy-unconverted': '旧档（version<4）：判定只依据流水；该版本可能存在未记账的现金变动，"不符"不等于篡改',
};

// no-anchor 帧不附口径文案（规格 §4.4：那一档说的是「B 侧读数的身份」，而这一帧两侧都没算成，
// 附上「本帧按 v4 口径判定…」会变成自相矛盾的印面）。抑制规则只写这一次，S-T7 预览与 S-T8 报告共用；
// 返回值自带前导分号，调用方只管拼在括号内的最后一个读数之后。
export const frameCaliberNote = (result: FrameAudit): string =>
  result.status === 'no-anchor' ? '' : `；${CALIBER_TEXT[result.restatementCaliber]}`;

/** 一组帧里出现过的口径说明（去重、按首次出现顺序，S-T7 预览的口径清单用）。
 *  no-anchor 帧同样不计入——与 frameCaliberNote 是同一条抑制规则，两处不能一个说、一个不说。 */
export const caliberNotesOf = (results: FrameAudit[]): string[] =>
  Array.from(new Set(
    results.filter((r) => r.status !== 'no-anchor').map((r) => CALIBER_TEXT[r.restatementCaliber]),
  ));

/** 一帧核对结论的一行措辞（S-T7 预览用）。住在 audit.ts 而不是组件里（Task 8 设计问题 2）：
 *  它逐字组装 CAUSE_TEXT / CALIBER_TEXT / frameCaliberNote / money，全是审计侧的词汇表，
 *  而 util（本模块的报告）不能反向 import .tsx；词汇表与判据同源才不会再漂移。
 *  mismatch 必附 CALIBER_TEXT：旧档（version<4）天然不平印出来的那句「流水条目与现金不符」
 *  与 v4 帧上的篡改判定**逐字相同**，只有这条文案能把「不符 ≠ 篡改」说出来（规格 §4.4、评审 round-3）。 */
export const formatFrameAudit = (result: FrameAudit): string =>
  result.status === 'no-anchor'
    ? `${result.saveName}：起算链不完整（缺期初现金种子），本帧现金 ${money(result.actualCash)}`
    : `${result.saveName}（第${result.year}年第${result.quarter}季）：账实不符（${CAUSE_TEXT[result.cause ?? 'both']}），`
      + `流水重演算 ${money(result.flowRebuilt)} / 帧末现金 ${money(result.actualCash)}${frameCaliberNote(result)}`;

// ══ 指纹声明的读法（复审 item 2：从 SaveLoadPanel.tsx 搬进来）═══════════════════
// 为什么搬：这三条措辞不再是「面板独有的指纹读法」——核对报告也要印同一句（包里声明的包指纹是
// `unavailable:*` 时，报告不能把内部 token 原样印给老师，规格 §4.4 要的是「哈希未计算（原因）」）。
// 而报告住在 util `audit.ts`，**util 不能反向 import `.tsx`**（Task 8 设计问题 2 的同一条理由，
// 也正是 money/format.ts 当初搬出去的理由）。搬到这里而不是 format.ts：format.ts 管的是**金额读数**
// （money/moneySum/readNumber，与摘要判据无关），而这几条判的是摘要前缀、说的是篡改线索的可信度，
// 与 CAUSE_TEXT / CALIBER_TEXT 同属审计词汇表；面板本来就 import 本模块，不新增依赖边。
// 面板的用户可见字符串**逐字未改**（tests/saveImport.test.ts 钉着），只是换了住处：
// 组件里 import 后再 `export { digestSkipNote, isComparableDigest }` 原名转出，import 路径与断言都不用动。

/** 「可比对的指纹」只认 sha256: 前缀（Task 4 的返回契约：另一支恒为 `unavailable:<原因>`）。
 *  包内声明与本侧重算出来的都要过一次：换设备 / 非 HTTPS 导入时本机没有 crypto.subtle，
 *  算出来是 `unavailable:*`，拿它去比包里的 `sha256:` 必然不等——印出来就是「指纹不一致」这条**假**篡改证。
 *  那种情形只能说「本机算不出」，归入「未计算」那一档（规格 §4.4「无 crypto.subtle → 重演算照常执行」）。 */
export const isComparableDigest = (value: string | undefined): boolean =>
  typeof value === 'string' && value.indexOf('sha256:') === 0;

/** 声明值无法比对时的那句「哈希未计算（原因）」；返回 null 表示「声明是 sha256:，可以比值」。
 *  按 **前缀** 分派（Task 4 实况）：`unavailable:` 后面除了 insecure-context 还可能是摘要调用自身
 *  失败带出的 bad-digest / 某个 error name，不能只认那一种。空串/缺字段一律算「未计算」，绝不参与比对。
 *  措辞按规格 §4.4 说人话（不把内部 token 原样印给老师），但仍不猜原因。
 *  不带帧名的**裸句**：面板那句要在前面拼 `${saveName}：`（digestSkipNote），
 *  报告的包指纹行只要这句本身——同一份措辞、两种装法，所以拆成两层而不是一句里带死前缀。 */
export const digestUnavailableNote = (declared: string | undefined): string | null => {
  // 非字符串一律按"包内无可用声明"处理：`digests.frames` 是外部文件的对象，原型链上的
  // toString/constructor 之类如果被当值读出来，下一行 declared.replace 会抛 TypeError，
  // 预览就会印成「读取失败」而不是契约里的「哈希未计算（包内无记录）」（评审 Task 7 finding 1）。
  if (typeof declared === 'string' && isComparableDigest(declared)) return null;
  if (declared === 'unavailable:insecure-context') return '哈希未计算（非 HTTPS 环境）';
  const reason = typeof declared === 'string' && declared ? declared.replace('unavailable:', '') : '';
  return `哈希未计算${reason ? `（${reason}）` : '（包内无记录）'}`;
};

/** 面板用的一行：帧名 + 上面那句裸句；返回 null 表示可以比值，由调用方去重算。 */
export const digestSkipNote = (saveName: string, declared: string | undefined): string | null => {
  const note = digestUnavailableNote(declared);
  return note === null ? null : `${saveName}：${note}`;
};

// ══ 对外文案：能力边界（规格 §4.6，报告首行 / 规则弹窗 / README 三处同一句）═══════════
// 定在 Task 9 之前是有原因的：那句话要在三个地方出现，任何一处自己写一遍，三处就会各自漂走。
// 报告的**首行**必须是这句（规格 §4.5），面板把它作为 boundaryLine 传进来，不另写一份。
export const INTEGRITY_BOUNDARY = '完整性校验用于发现误操作与随手改数，不构成防作弊保证；成绩判定以运行控制表与实践报告为准。';

// §4.6 追加的两条余地：都是实测得出、不是假想。少了它们，报告的「不符」二字会被读成一条铁证。
// 措辞必须**上下文无关**（复审 item 4）：这份常量被三个地方逐字印——核对报告、规则弹窗、README。
// 旧写法在句尾挂着「条数见下方帧统计里的…」，那是**报告版面**相对的指代，印进弹窗与 README 就指向 nothing，
// 于是 Task 9 在那两处各补了一句自造的说明文字当补丁——句子就此有了三个版本。
// 现在把事实本身写进句子（「由帧统计单列」，说的是那一行的名字，不是它的位置），补丁随之删掉；
// 不许再出现「下方 / 如上」这类方向词，tests/integrityCopy.test.ts 钉着这条。
export const INTEGRITY_CAVEATS: string[] = [
  '旧档（version<4）的"不符"不等于篡改：那一版可能存在没写进流水的现金变动，天然就可能对不平；'
    + '判据只看流水，这类判定的条数由帧统计单列（「其中旧档 version<4 的判定 N 条」）。',
  '同一毫秒内的手操是精度盲区：季度推进与主动交易若落在 Date.now() 的同一毫秒，那笔交易既不进重述串、'
    + '也不进尾随流水，会报出一条并不存在的"账实不符"；人工点按隔着秒不会触发，脚本式连点或自动化才可能。',
];

/** 包内的时间跨度端点（规格 §4.3 预览那一行「N 帧 / 最早 → 最新」）。
 *  复审 item 6c：这段定序原本住在组件的 for 循环里，与 latestPackageFrame 是同一条全序的两份实现——
 *  同毫秒兜底一旦漂回 `a.id < b.id`，预览的跨度与报告的重置次数会各自取到不同的一帧（评审 Task 7 finding 5）。
 *  收拢到这里：`latest` 就是 latestPackageFrame，面板只消费 text。 */
export const packageSpan = (pkg: SavePackage): { earliest: SaveFile | null; latest: SaveFile | null; text: string } => {
  let earliest: SaveFile | null = null;
  let latest: SaveFile | null = null;
  for (const save of pkg.saves) {
    if (earliest === null || byTimeThenId(save, earliest) < 0) earliest = save;
    if (latest === null || byTimeThenId(save, latest) > 0) latest = save;
  }
  // 空包（重置后立刻导出）：面板这一格说的是「只有当前屏」，不是某个孤零零的时间戳
  return {
    earliest,
    latest,
    text: earliest !== null && latest !== null ? `${earliest.createdAt} → ${latest.createdAt}` : '包内无历史帧（仅当前屏）',
  };
};

// 包内最近的一帧（报告与预览的「重置次数」都取它）。空包给 null——调用方因此**不可能**凭空印出 0。
// 与时间跨度共用同一次扫描、同一条全序（见 packageSpan）。
export const latestPackageFrame = (pkg: SavePackage): SaveFile | null => packageSpan(pkg).latest;

// 重置次数是 **SaveFile** 的字段、不在 current 里，只能取最近那一帧的；
// 与 S-T7 预览同一条规则（同一个 latest、同一道 Number.isFinite 判据），所以住在审计里而不是面板里。
// 判据是 `Number.isFinite` 而**不是真值性**（复审 item 6a）：重置次数 0 是合法读数（重置过一次都没存过档的
// 新局就是这个数），写成 `latest.resetCount ? … : null` 会把它跟「缺数据」混为一谈，报告就此印「—」。
export const packageResetCount = (pkg: SavePackage): number | null => {
  const latest = latestPackageFrame(pkg);
  return latest !== null && typeof latest.resetCount === 'number' && Number.isFinite(latest.resetCount)
    ? latest.resetCount : null;
};
export const packageResetCountText = (pkg: SavePackage): string => {
  const latest = latestPackageFrame(pkg);
  return readNumber(latest ? latest.resetCount : undefined);
};

/** 核对报告的两个产物（规格 §4.5）。
 *  **同步**且**不碰 crypto**：逐帧指纹是 WebCrypto 的异步产物，已经在 S-T7 的导入预览里算完并分成
 *  「不符 / 未计算」两张表（设计问题 1）。报告只转录这两张表，绝不重算——报告若自己算一遍，
 *  就是同一件事的第二套实现（换设备/非 HTTPS 时机根本算不出，两套会给出不同印面），
 *  而只印「包指纹 sha256:…」不说明是谁算的，老师读到的将是这台机器没有核实过的保证。
 *  所以第四个参数 digestNotes 是必须的：它让"判定出自本机、且与面板当场看到的一模一样"这件事可证。 */
export interface AuditDigestNotes {
  mismatch: string[];
  skipped: string[];
}

/** 报告自身的信息（不是包里的数据，面板才知道的）。
 *  复审 item 7：规格 §4.5 的字段清单里有「文件名」，而报告正文此前只在**产物名**里带着它——
 *  教师把 txt 拖进邮件附件、截图或念给学生时，那行「报告生成时间」对不上任何一个名字。
 *  取舍：加一行 `文件名：…`（本项），不去改已批准的规格。未传（旧四参调用、单元测试夹具）时
 *  文本**不印**这一行、JSON 给 null，绝不印一个空名字糊弄过去。 */
export interface AuditReportMeta {
  reportFileName?: string;
}

export function buildAuditReport(
  pkg: SavePackage,
  results: FrameAudit[],
  boundaryLine: string,
  digestNotes: AuditDigestNotes,
  meta?: AuditReportMeta,
): { json: string; text: string } {
  const summary = auditSummary(results);
  const diverging = firstDivergingFrame(results);
  const generatedAt = new Date().toISOString();
  // 包指纹这一行的两个要害（复审 item 1 / 2）：
  // ①它是**声明**，不是本机核实过的结果——导入侧那条异步循环只重算逐帧指纹（digestFrame），
  //   digestPackage 只在导出时跑过一次。少了这半句，一个逐帧指纹被整批重算过、包指纹被动过的包，
  //   会在「指纹不符：无」旁边印一行看起来已经核实的 sha256:…（正是 Task 8 设计问题 1 禁止的假保证）。
  //   所以文本与 JSON 同时带上范围标记，脚本也不许把 packageDigest 读成「本机已验证」。
  // ②声明本身可能是 `unavailable:<原因>`：那种值不能原样印给老师（规格 §4.4），
  //   要说「哈希未计算（非 HTTPS 环境）」，措辞与面板同一份（digestUnavailableNote，复审 item 2）。
  const packageDigestScope = '包内声明值；导入侧只重算逐帧指纹，整包指纹未重算';
  const declaredPackageNote = digestUnavailableNote(pkg.digests.package);
  const packageDigestLine = declaredPackageNote === null
    ? `包指纹：${pkg.digests.package}（${packageDigestScope}）`
    : `包指纹：${declaredPackageNote}——${packageDigestScope}`;
  const reportFileName = meta ? meta.reportFileName : undefined;
  // 每个读数都过一次 money()：审计**刻意**给 null（§4.4「null 而非 NaN」），裸插值会印成 "nullM"/"NaNM"
  const frameLines = results.map((r) => r.status === 'ok'
    ? `[通过] ${r.saveName}（第${r.year}年第${r.quarter}季，现金 ${money(r.actualCash)}${frameCaliberNote(r)}）`
    : `[${r.status === 'no-anchor' ? '起算链不完整' : `账实不符（${CAUSE_TEXT[r.cause ?? 'both']}）`}] `
      + `${r.saveName}（第${r.year}年第${r.quarter}季，按流水重建 ${money(r.flowRebuilt)}，按重述串重建 `
      + `${money(r.restatedRebuilt)}，帧内现金 ${money(r.actualCash)}${frameCaliberNote(r)}）`);
  const digestLines = [
    `指纹判定（由生成这份报告的本机在导入预览那一刻算出：换设备或换浏览器再算一次可能给出不同结果，`
      + `指纹只作线索、不作结论）：不符 ${digestNotes.mismatch.length} 条，未计算或无法比对 ${digestNotes.skipped.length} 条`,
    ...(digestNotes.mismatch.length
      ? digestNotes.mismatch.map((line) => `  指纹不符 · ${line}`)
      : ['  指纹不符：无']),
    ...(digestNotes.skipped.length
      ? digestNotes.skipped.map((line) => `  指纹未计算 · ${line}`)
      : ['  指纹未计算：无']),
  ];
  const lines = [
    boundaryLine,
    '',
    '能力边界的两条余地（实测得出，不是假想）：',
    ...INTEGRITY_CAVEATS.map((c) => `· ${c}`),
    '',
    `报告生成时间：${generatedAt}`,
    ...(reportFileName ? [`文件名：${reportFileName}`] : []),
    `导出时间：${pkg.exportedAt}`,
    `包内进度：第${pkg.app.year}年第${pkg.app.quarter}季（存档格式 v${pkg.app.saveVersion}，历史帧 ${pkg.saves.length} 个）`,
    `重置次数：${packageResetCountText(pkg)}（取包内最近一帧；包内无历史帧时给「—」而不是 0）`,
    packageDigestLine,
    `逐帧指纹：包内声明 ${Object.keys(pkg.digests.frames).length} 条`,
    // 两个指纹覆盖的字段不同，报告里必须说清（评审 Task 4 item 4）：逐帧指纹按规格只包
    // {id,timestamp,version,resetCount,state}，而包壳含整份 SaveFile（name/enterpriseName/createdAt 都在内）——
    // 只改存档名就会呈现"包指纹不符 + 逐帧全通过"，不写这行它读起来像篡改。
    '指纹口径：包指纹覆盖整包字节（digests 自身除外；含存档名/企业名/createdAt）；'
      + '逐帧指纹只覆盖 {id,timestamp,version,resetCount,state}，仅改名会动包指纹而不动逐帧指纹。',
    ...digestLines,
    '',
    `帧统计：共 ${summary.total}，通过 ${summary.ok}，不符 ${summary.mismatch}`
      + `（其中旧档 version<4 的判定 ${summary.legacyMismatch} 条，其"不符"不等于篡改），起算链不完整 ${summary.noAnchor}`,
    `分歧起点：${diverging
      ? `${diverging.restatementCaliber !== 'v4' ? '（该帧 version<4，先排除历史版本缺日志再谈篡改）' : ''}`
        + `${diverging.saveName}（第${diverging.year}年第${diverging.quarter}季）`
      : '未发现账实分歧'}`,
    '',
    ...frameLines,
  ];
  return {
    text: lines.join('\n'),
    // JSON 是**给脚本**的那一份（规格 §4.5：教师侧要能批注、可比对）：分歧起点给的是帧对象本身而不是散文，
    // 免得脚本用正则去啃中文行。指纹两张表也在这里，与 text 同源。
    json: JSON.stringify({
      boundary: boundaryLine,
      caveats: INTEGRITY_CAVEATS,
      generatedAt,
      reportFileName: reportFileName ?? null,
      exportedAt: pkg.exportedAt,
      resetCount: packageResetCount(pkg),
      packageDigest: pkg.digests.package,
      // 与文本同一件事的机读形态：这个值是**声明**，导入侧从未重算整包指纹（见上面 packageDigestScope）
      packageDigestScope: 'declared-not-reverified',
      frameDigests: pkg.digests.frames,
      digestMismatch: digestNotes.mismatch,
      digestSkipped: digestNotes.skipped,
      summary,
      diverging,
      frames: results,
    }, null, 2),
  };
}
