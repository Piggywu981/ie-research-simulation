// 存档包的构建与序列化（规格 §4.2 包结构、§4.4 指纹口径）。
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

// 导出文件名：企业1存档-第Y年第Q季-YYYYMMDDHHmm.json（规格 §4.2）。
// 月/日/时/分补零，保证按文件名字典序排即按时间排；不含秒——同一分钟内多次导出本就该是同一次进度。
export function packageFileName(year: number, quarter: number, at: Date = new Date()): string {
  return `企业1存档-第${year}年第${quarter}季-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}${pad(at.getHours())}${pad(at.getMinutes())}.json`;
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
    throw new Error(`存档列表里有重复的存档 id：${dupes.join('、')}。同一 id 的多帧无法在指纹表里分别记录，请先删除多余存档再导出。`);
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
