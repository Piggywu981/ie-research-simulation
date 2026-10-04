// 季度重述串（kind === 'summary'）的口径与换算，规格 §4.4 第四次更正。
//
// v4 起 summary.cashChange 是「自上一条重述串以来的全部净变动」（含玩家主动交易）；
// v3 及更早存的是引擎自动项净额，缺掉玩家手操，于是 Σ 串不再望远镜收敛到期末现金，
// §4.4 的 B 式重建对这种串必然少算。旧档本身由审计按版本降级处理（version < 4 时 B 不参与判定），
// 但「载入旧档 → 继续玩 → 存档」出来的那一帧标着 v4（saveGame/autoSaveGame 无条件写
// SAVE_FORMAT_VERSION），降级对它不适用：不在载入时换算，就会在最常态的路径上假报 restated-log。
//
// 所以这条推导只留一个来源：migrateState 用它把旧档的串重建成新口径，
// audit.ts 用它给审计结论贴上「这帧的 B 侧是什么口径」的标签。两处各写一遍就是 §5.7 那类漂移。
import type { FinancialLogRecord } from '../types/enterprise';

// summary.cashChange 从这一刻起才是新口径。这是**口径变更发生的版本**，不是当前的 SAVE_FORMAT_VERSION：
// 版本号再往上加也不能把 v4 帧重新打成旧档，故刻意不引用那个常量。
export const RESTATED_FULL_NET_FROM_VERSION = 4;

// 起算链头：开局那笔「初始现金」种子流水（其 cashChange 即期初 20M）
export const SEED_DESCRIPTION = '初始现金';
export const isSeedLog = (l: FinancialLogRecord) => l.description === SEED_DESCRIPTION;

/** 串起 newCash 链，算出每条重述串「按新口径应当是多少」。
 *  返回 null 表示无从起算（没有「初始现金」种子，或种子值非有限），调用方据此放弃换算。
 *  - 数组顺序不可信：quarterEndLog 在 allLogs 里排在年末结算日志之前，存档里更是新的在前，
 *    故一律按 timestamp 升序推；同毫秒时用 id 兜底成全序（与 audit.ts 的 auditFrames 同一条规则）。
 *  - newCash 残缺的行原样跳过，既不据它推链头也不写值：v1/v2 旧档经 migrateState 只补 kind、
 *    从不回填 newCash（字段缺省即 undefined），直接相减会写出 NaN 并随存档落盘（评审 I2 同一条守卫）。 */
function deriveRestatedChain(logs: FinancialLogRecord[]): { id: string; cashChange: number }[] | null {
  const seeds = logs.filter((l) => l.kind === 'flow' && isSeedLog(l));
  if (seeds.length === 0) return null;
  const seedCash = seeds.reduce((t, l) => t + l.cashChange, 0);
  if (!Number.isFinite(seedCash)) return null;

  const summaries = logs
    .filter((l) => l.kind === 'summary')
    .sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));

  let chainHead = seedCash;
  const rows: { id: string; cashChange: number }[] = [];
  for (const row of summaries) {
    if (!Number.isFinite(row.newCash)) continue;
    rows.push({ id: row.id, cashChange: row.newCash - chainHead });
    chainHead = row.newCash;
  }
  return rows;
}

/** 把旧档的重述串**原地**重建成新口径（调用方须传深拷贝；本函数不复制、也不改 flow 条目）。
 *  返回是否真的动过行——没动过说明这一串要么已与新口径一致，要么残缺到无法换算。 */
export function rebuildRestatedChain(logs: FinancialLogRecord[]): boolean {
  const rows = deriveRestatedChain(logs);
  if (!rows || rows.length === 0) return false;
  const byId = new Map<string, FinancialLogRecord>();
  for (const l of logs) byId.set(l.id, l);
  let written = false;
  for (const r of rows) {
    const target = byId.get(r.id);
    if (target && target.cashChange !== r.cashChange) {
      target.cashChange = r.cashChange;
      written = true;
    }
  }
  return written;
}

/** 这一串是否「整链可换算、且每一条都已经是新口径」。
 *  审计用它区分两种旧档：整串已与 newCash 链吻合（载入时换算过，或那些季度本就没有玩家手操）报 true，
 *  仍是旧口径或残缺到换不出报 false。
 *  认不出任何重述串时保守报 false——v3 原始帧连 kind 都还没有，说它「已是新口径」是瞎话。 */
export function restatedChainIsNewCaliber(logs: FinancialLogRecord[]): boolean {
  const rows = deriveRestatedChain(logs);
  if (!rows) return false;
  const summaries = logs.filter((l) => l.kind === 'summary');
  if (summaries.length === 0 || rows.length !== summaries.length) return false;
  const byId = new Map<string, FinancialLogRecord>();
  for (const l of summaries) byId.set(l.id, l);
  return rows.every((r) => byId.get(r.id)?.cashChange === r.cashChange);
}
