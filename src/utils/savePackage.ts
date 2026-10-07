// 存档包的构建、序列化与导入解析（规格 §4.2 包结构、§4.3 导入校验、§4.4 指纹口径）。
// 与 audit.ts 一样，这条链只看"字节"不看"账目"：包指纹覆盖整份字节（含 name/createdAt 等展示字段），
// 逐帧指纹只覆盖内容字段——两条都是 S-T7 导入侧的比对依据，所以这里的产物必须**自证一致**：
// 写进文件的内容与包内声明的指纹，任何时候重算都得对上，否则正常存档会被报成篡改。
// 本模块不 import audit.ts：账实结论与指纹证据各自独立失效，一路坏了另一路还能说话（见 saveDigest.ts 头注）。
import type { EnterpriseState, SaveFile, SavePackage } from '../types/enterprise';
// SAVE_FORMAT_VERSION 是值不是类型，必须普通 import；且 app.saveVersion 只引用它、绝不写死字面量——
// 常量当前正好是 4，写死 4 在今天的存档上给得出同一个字节，等下一次 bump 就变成 §5.7 那类漂移。
import { SAVE_FORMAT_VERSION } from '../types/enterprise';
import { canonicalStringify, digestFrame, digestText } from './saveDigest';

const pad = (n: number): string => String(n).padStart(2, '0');

// 单一企业（规格 §3.2 课程约束）：文件名的企业前缀只写这一次，存档包与核对报告共用
const ENTERPRISE_LABEL = '企业1';

// 到分钟的时间戳后缀：月/日/时/分补零，保证按文件名字典序排即按时间排。
// 不含秒——同一分钟内多次导出本就该是同一次进度。
const stampSuffix = (at: Date): string =>
  `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}${pad(at.getHours())}${pad(at.getMinutes())}`;

// 导出文件名：企业1存档-第Y年第Q季-YYYYMMDDHHmm.json（规格 §4.2）。
export function packageFileName(year: number, quarter: number, at: Date = new Date()): string {
  return `${ENTERPRISE_LABEL}存档-第${year}年第${quarter}季-${stampSuffix(at)}.json`;
}

// 核对报告的文件名（规格 §4.5 报告内容第一项就是「文件名」）：与存档包同一条命名规则
// （年季 + 到分钟的时间戳、同样的补零），只把用途换成「核对报告」，所以一份报告与它所依据的那份包
// 在文件管理器里排在一起、认得出对应关系。txt 给人快速读，json 给教师留存批注（§4.5）。
export function auditReportFileName(
  year: number,
  quarter: number,
  ext: 'txt' | 'json',
  at: Date = new Date(),
): string {
  return `${ENTERPRISE_LABEL}核对报告-第${year}年第${quarter}季-${stampSuffix(at)}.${ext}`;
}

// 与 saveGame 同一套快照写法（enterpriseStore.ts:398）：包里的字节一旦算过就固定下来，
// 不受之后任何一次 store 变更影响（深拷贝的理由见 buildSavePackage 里的注释）。
const snapshot = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// 重复 id 先于指纹暴露出来：digests.frames 以 id 为键，两份同 id 的帧会静默塌成一条，
// 于是"包里有 N 帧"与"指纹表里有 N 条"对不上——而这份文件是要拿给别人当证据的。
// S-T6 在导入侧也拒重复 id，但那救不了已经导出的文件，所以导出侧先挡住。
function findDuplicateIds(saves: SaveFile[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (let i = 0; i < saves.length; i++) {
    const id = saves[i].id;
    if (seen.has(id)) dupes.add(id);
    else seen.add(id);
  }
  return Array.from(dupes);
}

export async function buildSavePackage(state: EnterpriseState, saves: SaveFile[]): Promise<SavePackage> {
  const dupes = findDuplicateIds(saves);
  if (dupes.length > 0) {
    // 提示语必须说清"删除"这个动作的代价（评审 Task 5 finding 1）：面板的删除按 id 过滤，
    // 同 id 的帧会被一并移除，所以"先删掉多余的那份"这种说法是把用户往丢历史的方向推。
    throw new Error(`存档列表里有重复的存档 id：${dupes.join('、')}。同一 id 的多帧无法在指纹表里分别记录，导出已中止。`
      + `面板的「删除存档」按 id 删除，会把同 id 的帧一并删掉；若这些帧都要保留，请先在浏览器本地存储里把 id 改成互不相同，再重新导出。`);
  }

  // 深拷贝 current 与 saves 后再算指纹：本函数是异步的（逐帧哈希要 await），期间按钮禁用但 store 仍在跑，
  // 若按引用留着活对象，"建完才被改"的状态会让包内声明的指纹与文件字节脱节。
  // 代价是一次 JSON 往返（规格 §4.2 体积预期 ~0.6MB），换来的是导出结果可复算。
  const current = snapshot(state);
  const clonedSaves = saves.map((save) => snapshot(save));

  const date = new Date();
  const frames: Record<string, string> = {};
  for (let i = 0; i < clonedSaves.length; i++) {
    frames[clonedSaves[i].id] = await digestFrame(clonedSaves[i]);
  }

  const shell: Omit<SavePackage, 'digests'> = {
    format: 'ie-sandbox-save',
    packageVersion: 1,
    exportedAt: date.toISOString(),
    app: { saveVersion: SAVE_FORMAT_VERSION, year: current.operation.currentYear, quarter: current.operation.currentQuarter },
    current,
    saves: clonedSaves,
  };
  // 整包指纹不含 digests 自身，否则自指（规格 §4.4）；覆盖的是上面那份壳，含帧的展示字段
  const packageDigest = await digestText(canonicalStringify(shell));
  return { ...shell, digests: { package: packageDigest, frames } };
}

// 2 空格缩进、不加 BOM（规格 §4.2：BOM 会让 JSON.parse 与 python json.loads 直接报错，
// 而教师侧脚本处理这些文件很常见——与 CSV 相反，CSV 加 BOM 只为 Windows Excel）。
export const serializePackage = (pkg: SavePackage): string => JSON.stringify(pkg, null, 2);

// ══ 导入解析与结构校验（规格 §4.3 第 1–2 步）══════════════════════════════════
// 这条链的定位是"能不能安全地当成状态用"，不是"账目对不对"：Task 7 的调用点只有 try…finally、
// 没有 catch，而它下游的 migrateState 直接解引用 `state.finance` / `state.operation`
// （enterpriseStore.ts:223/233/298-300）、auditFrame 直接解引用 `save.state.finance`（audit.ts:72），
// 所以**本函数是畸形文件与整页崩之间唯一的闸门**。反面同样写死：校验只看结构不看账目，
// 绝不回填 kind、绝不夹紧现金、绝不重算任何审计要判的东西（规格 §4.4 的分工），否则就是把假绿印进报告。

// 上限 8MB 是**文件体积**（规格 §4.3）。体积按 UTF-8 字节算，不按 UTF-16 码元：包体以中文为主，
// 一个汉字 1 个码元却是 3 个字节，只比 text.length 会少挡三倍、把 12MB 的中文文件放过。
// 先比码元数是廉价的早退（字节数 ≥ 码元数，这一支的拒绝必然成立），再过一次真字节。
const MAX_PACKAGE_BYTES = 8 * 1024 * 1024;

const overSizeLimit = (text: string): boolean =>
  text.length > MAX_PACKAGE_BYTES || new TextEncoder().encode(text).length > MAX_PACKAGE_BYTES;

// migrateState 无条件解引用这几域（缺整域即从 loadGame 抛错，见 progress.md S-T1 遗留条）
const STATE_DOMAINS = ['finance', 'production', 'logistics', 'marketing', 'operation'] as const;

export type PackageParseResult = { ok: true; pkg: SavePackage } | { ok: false; reason: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

// isRecord 认数组（typeof [] === 'object'），但"该是对象"的每个位置都反对数组：
// 让数组走进对象分支，报出来的会是某个下层字段缺失，说不清"这里本该是个对象"（规格 §4.3 要点名）。
const isPlainObject = (v: unknown): v is Record<string, unknown> => isRecord(v) && !Array.isArray(v);

const isNonNegativeInteger = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isFiniteNumber = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);

// 拒绝原因会进 UI 红字（Task 7 的 validationError），而输入是不可信的外部文件：
// 打印实际值时截断，免得一条 5MB 的字符串把提示区撑爆；类型词给中文，读的人是教师。
const briefly = (v: unknown): string => {
  const text = typeof v === 'string' ? `"${v}"` : String(v);
  return text.length > 60 ? `${text.slice(0, 60)}…（共 ${text.length} 字符）` : text;
};

const typeWord = (v: unknown): string =>
  v === null ? 'null'
    : v === undefined ? '缺失'
      : Array.isArray(v) ? '数组'
        : typeof v === 'string' ? '字符串'
          : typeof v === 'number' ? '数字'
            : typeof v === 'boolean' ? '布尔值'
              : typeof v === 'object' ? '对象'
                : typeof v;

// 表字段（数组）的口径：**缺失/null 放行**——旧档本就没有这些表，补齐正是 migrateState 的活
// （enterpriseStore.ts:223 的 loans、:298-300 的台账三件），在校验里替它拒掉就等于堵死迁移路径。
// 在场时必须是数组，且条目是对象：migrateState 对条目就地读写字段
// （`f.productionLines.forEach` :251、`m.investedThisYear = false` :288-295），null/数字条目当场抛。
const tableProblem = (
  value: unknown,
  path: string,
  rowCheck?: (row: Record<string, unknown>, rowPath: string) => string | null,
): string | null => {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return `${path} 必须是数组，实际为 ${typeWord(value)}`;
  for (let i = 0; i < value.length; i++) {
    const rowPath = `${path}[${i}]`;
    const row = value[i];
    if (!isRecord(row)) return `${rowPath} 必须是对象，实际为 ${briefly(row)}`;
    if (rowCheck) {
      const problem = rowCheck(row, rowPath);
      if (problem) return problem;
    }
  }
  return null;
};

// 与 tableProblem 同一条口径的"对象版"：**缺失/null 放行**（旧档没有该字段是 migrateState 的活），
// 在场但不是对象就拒——migrateState 对它就地读写字段，真值非对象会当场抛（见下面的调用处行号）。
const optionalObjectProblem = (value: unknown, path: string): string | null =>
  value === undefined || value === null || isRecord(value)
    ? null
    : `${path} 必须是对象，实际为 ${typeWord(value)}`;

// 流水行的判据。四条各对应下游一处真实的崩点或错判，缺任何一条都会把格式问题印成账实不符：
//   条目非对象 → kindOfLog 读 `l.kind` 当场抛（restatement.ts:29，auditFrame 第一行就会调用它）；
//   显式但非法的 kind → **必须拒**（评审 Task 3 round-3 的观察）：kindOfLog 只在 kind **缺失**时兜底推断，
//     'Flow' / '' / null 这类值既不被认成 summary 也不被认成 flow，那条于是同时退出 A 与 B 两侧求和，
//     审计读出来是「账实不符（流水条目与现金不符）」——格式问题被印成了篡改结论；
//   id/timestamp/cashChange → 审计的排序比较器与两侧求和直接读它们（restatement.ts:45 与 audit.ts:124 的
//     localeCompare、audit.ts:87/:99-100 的求和），非数值会 NaN 传染求和、null id 会在同时间戳排序时抛，
//     两者都不是"账不平"而是"算不了"。
// 刻意**不**要求 newCash：restatement.ts 明确把"缺 newCash 的行原样跳过"当设计（v1/v2 旧档经 migrateState
// 只补 kind、从不回填 newCash），在这里要它就是在拒游戏真产得出的旧包。
const logRowProblem = (row: Record<string, unknown>, path: string): string | null => {
  const kind = row.kind;
  if (kind !== undefined && kind !== 'flow' && kind !== 'summary') {
    return `${path} 存在非法 kind：${briefly(kind)}（只认 'flow' 与 'summary'；缺失时由 restatement.ts 的 kindOfLog 兜底推断，此处不替它推断）`;
  }
  if (typeof row.id !== 'string') return `${path}.id 必须是字符串，实际为 ${briefly(row.id)}`;
  // description 只在"带类型"时判：kindOfLog 的兜底谓词写的是 `(l.description || '').includes(...)`
  // （restatement.ts:29），于是**数字/布尔**这类真值非字符串会当场 `.includes is not a function` 抛，
  // 而缺失/null 走 `|| ''` 是安全的（v1/v2 旧档确有缺字段的行）——所以这里"缺失放行、类型错才拒"。
  if (row.description !== undefined && row.description !== null && typeof row.description !== 'string') {
    return `${path}.description 必须是字符串，实际为 ${briefly(row.description)}`;
  }
  if (!isFiniteNumber(row.timestamp)) return `${path}.timestamp 必须是有限数字，实际为 ${briefly(row.timestamp)}`;
  if (!isFiniteNumber(row.cashChange)) return `${path}.cashChange 必须是有限数字，实际为 ${briefly(row.cashChange)}`;
  return null;
};

// 厂房表条目：migrateState 无条件 `f.productionLines.forEach(...)`（enterpriseStore.ts:250-255），
// 所以这张表**不适用**"缺失放行"的口径——缺了它，载入旧档当场抛，而旧档恰恰是本功能要能导入的东西。
// （对照 tableProblem：那里缺的是旧档本就没有的字段，补齐正是 migrateState 的活。）
const factoryProblem = (row: Record<string, unknown>, path: string): string | null => {
  const lines = row.productionLines;
  if (!Array.isArray(lines)) {
    return `${path}.productionLines 必须是数组（migrateState 逐条补净值与建成年份），实际为 ${typeWord(lines)}`;
  }
  return tableProblem(lines, `${path}.productionLines`);
};

// 库存行的判据：数量必须真是有限数字——控制表逐行拼 `${quantity}${type}`（controlTable.ts:105-106）、
// 物流中心用 reduce 累加（LogisticsCenter.tsx:59/65），非数字不会抛但会印出 NaN 金额。
const quantityRowProblem = (row: Record<string, unknown>, path: string): string | null =>
  isFiniteNumber(row.quantity)
    ? null
    : `${path}.quantity 必须是有限数字（控制表与库存合计逐行读它），实际为 ${briefly(row.quantity)}`;

// current 与**每一帧**共用的字段判据（评审 round-3 new finding #2：只查 current 会让
// `saves[i].finance.cash = 1e999` 绕过校验，而审计对 Infinity 现金会平法判 ok，是假阴性）。
// 前缀用传入的 label，于是同一条规则在两处给得出各自的路径名，不复制第二份判据。
// 每域都过一次 isRecord：调用方已在前面查过类型，这里再兜一层只为"本函数自己绝不抛"。
const stateShapeProblem = (label: string, state: Record<string, unknown>): string | null => {
  const fin = isRecord(state.finance) ? state.finance : {};
  if (!isNonNegativeInteger(fin.cash)) {
    return `${label}.finance.cash 必须是非负整数（金额单位为 M 的整数，1e999 会变成 Infinity 而审计拿它判不出不平），实际为 ${briefly(fin.cash)}`;
  }
  const ar = fin.accountsReceivable;
  if (!Array.isArray(ar) || ar.length !== 4 || !ar.every((v: unknown) => isNonNegativeInteger(v))) {
    return `${label}.finance.accountsReceivable 必须是 4 个非负整数，实际为 ${briefly(ar)}`;
  }
  const loansProblem = tableProblem(fin.loans, `${label}.finance.loans`);
  if (loansProblem) return loansProblem;

  const op = isRecord(state.operation) ? state.operation : {};
  // currentYear 的上界是 5：游戏结束后状态停在「第5年第1季」（nextQuarter 加年不加季），勿收紧成 1..4
  // Number.isInteger 一条顶三条：非数字、NaN/Infinity、带小数的都在这儿挡掉（整数现金/年季是规则本身）
  if (!Number.isInteger(op.currentYear) || (op.currentYear as number) < 1 || (op.currentYear as number) > 5) {
    return `${label}.operation.currentYear 必须是 1..5 的整数（游戏结束态是第5年第1季），实际为 ${briefly(op.currentYear)}`;
  }
  if (!Number.isInteger(op.currentQuarter) || (op.currentQuarter as number) < 1 || (op.currentQuarter as number) > 4) {
    return `${label}.operation.currentQuarter 必须是 1..4 的整数，实际为 ${briefly(op.currentQuarter)}`;
  }
  const logsProblem = tableProblem(op.financialLogs, `${label}.operation.financialLogs`, logRowProblem);
  if (logsProblem) return logsProblem;

  const prod = isRecord(state.production) ? state.production : {};
  const factoriesProblem = tableProblem(prod.factories, `${label}.production.factories`, factoryProblem);
  if (factoriesProblem) return factoriesProblem;
  // P2 分期字段（enterpriseStore.ts:282-285）：`productRD?.P2 && !P2.status` 之后就地写
  // `P2.status = …` / `P2.paidQuarters = …`，所以 P2 只要是**真值非对象**（数字/布尔/字符串）就当场抛；
  // 缺失仍放行——那正是 migrateState 要补的形态。
  const rdProblem = optionalObjectProblem(prod.productRD, `${label}.production.productRD`);
  if (rdProblem) return rdProblem;
  if (isRecord(prod.productRD)) {
    const p2Problem = optionalObjectProblem(prod.productRD.P2, `${label}.production.productRD.P2`);
    if (p2Problem) return p2Problem;
  }

  const mkt = isRecord(state.marketing) ? state.marketing : {};
  const marketsProblem = tableProblem(mkt.markets, `${label}.marketing.markets`);
  if (marketsProblem) return marketsProblem;
  const isoProblem = tableProblem(mkt.isoCertifications, `${label}.marketing.isoCertifications`);
  if (isoProblem) return isoProblem;

  // 库存/订单/日志这几张表此前**不在口径内**（"下游不抛"当时只算了审计、指纹、迁移三条链）。
  // 控制者的对抗探针实测：`logistics.rawMaterials = [null]` 一类畸形被放行后，导入的第一屏就抛——
  //   controlTable.ts:105-106 逐行读 `${m.quantity}${m.type}`；LogisticsCenter.tsx:59/65 用 reduce 累加 quantity；
  //   OperationCenter.tsx:370 在**推进季度**时 filter 订单字段（不只是展示）；MarketingCenter.tsx:338/457/511 逐行渲染。
  // 于是把口径补成"导入后要落到的每条链都不抛"，而不只是"算得出的那几条"。
  const logistics = isRecord(state.logistics) ? state.logistics : {};
  const matProblem = tableProblem(logistics.rawMaterials, `${label}.logistics.rawMaterials`, quantityRowProblem);
  if (matProblem) return matProblem;
  const finProblem = tableProblem(logistics.finishedProducts, `${label}.logistics.finishedProducts`, quantityRowProblem);
  if (finProblem) return finProblem;
  const matOrdersProblem = tableProblem(logistics.rawMaterialOrders, `${label}.logistics.rawMaterialOrders`);
  if (matOrdersProblem) return matOrdersProblem;

  const adsProblem = tableProblem(mkt.advertisements, `${label}.marketing.advertisements`);
  if (adsProblem) return adsProblem;
  const availProblem = tableProblem(mkt.availableOrders, `${label}.marketing.availableOrders`);
  if (availProblem) return availProblem;
  const selProblem = tableProblem(mkt.selectedOrders, `${label}.marketing.selectedOrders`);
  if (selProblem) return selProblem;

  const opLogsProblem = tableProblem(op.operationLogs, `${label}.operation.operationLogs`);
  if (opLogsProblem) return opLogsProblem;
  return tableProblem(op.cashFlowHistory, `${label}.operation.cashFlowHistory`);
};

// 整包/逐帧指纹的形状闸（规格 §4.2）。简报没列这一条，但它是真缺口：Task 7 直接
// `pkg.digests.frames[save.id]` 再 `.startsWith('sha256:')`（计划 Task 7 handleFilePicked），
// 手改过的文件里 digests 缺失或 frames 不是表，那一行当场抛——预览面板连"结论"都给不出。
// 裁定：**逐帧声明缺哪一条不拒**（Task 7 按「哈希未计算（包内无记录）」说人话，且它给空 saves 造的
// 合成帧 id='current' 本就永远不在表里）；空串同样按"字符串声明"放行，值比值语义由 Task 7 判。
const digestsProblem = (value: unknown): string | null => {
  if (value === undefined || value === null) {
    return 'digests 缺失：包里没有指纹声明（规格 §4.2 的必备字段，导入侧要按它比对逐帧指纹）';
  }
  if (!isPlainObject(value)) return `digests 必须是对象，实际为 ${typeWord(value)}`;
  if (typeof value.package !== 'string') {
    return `digests.package 必须是字符串（'sha256:' 或 'unavailable:' 前缀），实际为 ${briefly(value.package)}`;
  }
  const frames = value.frames;
  if (frames === undefined || frames === null) return 'digests.frames 缺失：没有「存档 id → 该帧指纹」这张表';
  if (!isPlainObject(frames)) return `digests.frames 必须是对象，实际为 ${typeWord(frames)}`;
  const ids = Object.keys(frames);
  for (let i = 0; i < ids.length; i++) {
    const declared = frames[ids[i]];
    if (typeof declared !== 'string') {
      return `digests.frames.${ids[i]} 必须是字符串指纹，实际为 ${briefly(declared)}`;
    }
  }
  return null;
};

// 只读白名单字段、绝不把解析出来的键集合并/拷贝到别的对象上（Object.assign / {...parsed} 会给 __proto__
// 这个键走 setter，把目标的原型改掉）。JSON.parse 把 __proto__ 落成**自有**数据属性、不触发 setter，
// 于是载荷里的 "__proto__" 在本函数里既进不了任何对象的原型链，也伪造不出继承字段（继承值读不到）。
export async function parseSavePackage(text: string): Promise<PackageParseResult> {
  try {
    // 入参类型不在这里"宽容"：Task 7 传的是 file.text()，但 JS 调用方给错东西也不许抛
    if (typeof text !== 'string') return { ok: false, reason: '文件内容不是文本，无法解析' };
    if (overSizeLimit(text)) return { ok: false, reason: '文件过大（超过 8MB），不是合法存档包' };

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // 解析器抛的一切都在这里塌成同一句（实测这一路给的都是 SyntaxError：残缺/尾逗号/注释/未闭合）。
      // 深嵌套**不**在这一路里：V8 的 JSON.parse 是迭代实现，实测 100 万层的平衡数组照样解析成功，
      // 所以"深度"不是解析闸能挡的事——递归哈希（canonicalStringify）那一侧的阈值由 S-T7 的
      // digestFrame try/catch 兜，本函数不负责（也兜不住：放行与否只看字段形状）。
      return { ok: false, reason: '文件不是有效 JSON' };
    }
    if (!isPlainObject(parsed)) return { ok: false, reason: '顶层结构不是对象，无法当成存档包读取' };
    if (parsed.format !== 'ie-sandbox-save' || parsed.packageVersion !== 1) {
      return { ok: false, reason: '不是本系统的存档包（format/packageVersion 不匹配）' };
    }

    // app 是 Task 7 调 migrateState 的 fromVersion 来源（applyImportedState(pkg.current, pkg.app.saveVersion)）
    if (!isPlainObject(parsed.app)) return { ok: false, reason: `app 缺失或不是对象，实际为 ${typeWord(parsed.app)}` };
    const app = parsed.app;
    // 版本判"非负整数"，**不**判"必须等于 SAVE_FORMAT_VERSION"：旧包（v3 及更早）正是要放行才谈得上迁移
    if (!isNonNegativeInteger(app.saveVersion)) {
      return { ok: false, reason: `app.saveVersion 必须是非负整数，实际为 ${briefly(app.saveVersion)}` };
    }
    if (!isFiniteNumber(app.year)) return { ok: false, reason: `app.year 必须是数字，实际为 ${briefly(app.year)}` };
    if (!isFiniteNumber(app.quarter)) return { ok: false, reason: `app.quarter 必须是数字，实际为 ${briefly(app.quarter)}` };
    if (typeof parsed.exportedAt !== 'string') {
      return { ok: false, reason: `exportedAt 必须是 ISO 8601 字符串，实际为 ${briefly(parsed.exportedAt)}` };
    }

    if (!Array.isArray(parsed.saves)) return { ok: false, reason: `saves 必须是数组，实际为 ${typeWord(parsed.saves)}` };
    if (!isPlainObject(parsed.current)) return { ok: false, reason: 'current 缺失或不是对象' };

    const current = parsed.current;
    for (const domain of STATE_DOMAINS) {
      if (!isRecord(current[domain])) return { ok: false, reason: `current.${domain} 缺失或类型错误（实际为 ${typeWord(current[domain])}）` };
    }
    const shapeProblem = stateShapeProblem('current', current);
    if (shapeProblem) return { ok: false, reason: shapeProblem };

    // **同一套校验也必须逐帧跑在 saves 上**（评审 round-3 new finding #2）：Task 5 从 localStorage 导出的就是这些原始帧、
    // Task 7 审计与 Task 8 报告印的也是它们。只查 current 会让 `saves[i].finance.cash = 1e999`（`JSON.parse` 得到 Infinity）
    // 或越界年季直接进面板与报告，而审计对 Infinity 现金会平法判 `ok`（报告 H8.2）。
    const seenFrameIds = new Set<string>();
    for (let i = 0; i < parsed.saves.length; i++) {
      const frame = parsed.saves[i];
      if (!isRecord(frame)) return { ok: false, reason: `saves[${i}] 不是对象，无法读出帧内容（实际为 ${typeWord(frame)}）` };
      if (typeof frame.id !== 'string' || !frame.id) return { ok: false, reason: `saves[${i}].id 必须是非空字符串（帧与指纹表都按 id 对应）` };
      if (typeof frame.name !== 'string') return { ok: false, reason: `saves[${i}].name 必须是字符串（面板与报告直接印它）` };
      // 展示字段：saveGame/autoSaveGame 自初始提交起每次都写这两个（enterpriseStore.ts:399/429），
      // 而 Task 7 的"时间跨度"与合成帧 createdAt 要读它们，缺一个就是印面 undefined 或抛错。
      if (typeof frame.enterpriseName !== 'string') return { ok: false, reason: `saves[${i}].enterpriseName 必须是字符串，实际为 ${briefly(frame.enterpriseName)}` };
      if (typeof frame.createdAt !== 'string') return { ok: false, reason: `saves[${i}].createdAt 必须是字符串，实际为 ${briefly(frame.createdAt)}` };
      // 重复 id 必须拒：`digests.frames` 以 id 为键（Task 5），两份同 id 的帧在指纹表里会静默塌成一条，
      // 于是其中一份永远"无指纹可比"（评审 Task 4 out-of-scope #3 → 归本任务负责）。
      // 用 Set 而不是"以 id 为键的对象"：后者会被 '__proto__' / 'constructor' 这类 id 撞出假重复。
      if (seenFrameIds.has(frame.id)) return { ok: false, reason: `saves[${i}].id 与前面的帧重复：${frame.id}（指纹表以 id 为键，重复帧会塌成一条、另一条永远无指纹可比）` };
      seenFrameIds.add(frame.id);
      if (typeof frame.timestamp !== 'number' || !Number.isFinite(frame.timestamp)) {
        return { ok: false, reason: `saves[${i}].timestamp 必须是有限数字（帧序与"分歧起点"按它排）` };
      }
      if (typeof frame.version !== 'number' || !Number.isInteger(frame.version) || frame.version < 0) {
        // version 是审计口径判定的唯一依据（restatementCaliber / migrateState 的 fromVersion 都读它），缺失或非整数即拒
        return { ok: false, reason: `saves[${i}].version 必须是非负整数，实际为 ${briefly(frame.version)}` };
      }
      if (!isPlainObject(frame.state)) return { ok: false, reason: `saves[${i}].state 缺失或不是对象` };
      const state = frame.state;
      for (const domain of STATE_DOMAINS) {
        if (!isRecord(state[domain])) {
          return { ok: false, reason: `saves[${i}].${domain} 缺失或类型错误（实际为 ${typeWord(state[domain])}）` };
        }
      }
      const frameProblem = stateShapeProblem(`saves[${i}]`, state);
      if (frameProblem) return { ok: false, reason: frameProblem };
    }

    const digestsIssue = digestsProblem(parsed.digests);
    if (digestsIssue) return { ok: false, reason: digestsIssue };

    // 原样交出解析出来的对象：不合并、不改字段、不补默认值（放行后字节回来必须与输入相同，见测试）
    return { ok: true, pkg: parsed as unknown as SavePackage };
  } catch (error) {
    // 兜住任何未预期（含取值抛错的奇异对象）：Task 7 的调用点没有 catch，这里必须给原因而不是抛。
    // 措辞取 name + message（S-T5 的教训：只印 error.name 会把人话吞成 'Error'），并过一次截断。
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : '未知错误';
    return { ok: false, reason: `存档包无法完成校验：${detail.length > 80 ? `${detail.slice(0, 80)}…` : detail}` };
  }
}
