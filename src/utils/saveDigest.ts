// 规范化序列化与哈希指纹（规格 §4.4「包哈希」段：指纹而非结论、非安全上下文显式降级）。
// 与 audit.ts 是两条互不依赖的证据链——这里只看字节形状，不看账目平衡，所以不 import 审计侧任何东西：
// S-T7 的预览面板因此能把「账实结论」和「指纹比对结果」分开说，不会因为一侧失效而说不出另一侧。
import type { SaveFile } from '../types/enterprise';

// 规范化串：递归按 key 排序、剔除 `undefined`、数字与字符串原样（规格 §4.4 的三条）。
// 唯一目标：同一份内容无论键怎么排、经不经 JSON 往返，都必须得到**同一串**——否则 S-T5 写下的指纹
// 到 S-T7 手里就"不匹配"，把完全正常的存档报成篡改。
// 奇异输入的处置（存档数据来自 JSON.parse，本来遇不到；定死在此处，免得实现被改出静默的指纹漂移）：
//   undefined / 函数 / symbol / bigint → 'null'（JSON.stringify 对它们要么给 undefined 要么直接抛 TypeError），
//     于是 canonicalStringify 的返回永远是**非空 string**，绝不把 undefined 传染给调用方；
//   Date → 走 JSON.stringify 的 toJSON 语义（非法 Date 同样得 'null'），因为写进包里的字节就是那个 ISO 串，
//     塌成 '{}' 会让两个不同日期同指纹、且与包内字节对不上；
//   循环引用 → 该处折成 'null' 而不是栈溢出（S-T7 拿到的是外部文件，形态不可信，宁可少一层内容也不能整条链路抛错）；
//   NaN / Infinity → 'null'，即 `{cash: NaN}` 与 `{cash: null}` 同串。**这是已知取舍、不是保证**：
//     规格 §4.4 定的是"哈希只作指纹、不作结论"，非有限读数的严重性由审计侧按「null 而非 NaN」另行处理（见 audit.ts）。
// 尚未覆盖的一种形态：取值时抛错的 getter（Object.keys 给得出键、读值即抛）——JSON 数据里不存在，故不为其加壳。
export function canonicalStringify(value: unknown): string {
  return canonicalize(value, new Set<object>());
}

function canonicalize(value: unknown, onPath: Set<object>): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? JSON.stringify(value)
      : 'null';
  }
  // 集合里只放**当前这条路径上的祖先**（进入时 add、离开时 delete），而不是"见过的所有节点"：
  // 于是共享子图（同一对象实例出现在两处）仍逐处展开成完整内容，只有真成环才塌成 null。
  if (onPath.has(value)) return 'null';
  onPath.add(value);
  const text = value instanceof Date
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? `[${value.map((item) => canonicalize(item, onPath)).join(',')}]`
      : canonicalizeRecord(value as Record<string, unknown>, onPath);
  onPath.delete(value);
  return text;
}

function canonicalizeRecord(obj: Record<string, unknown>, onPath: Set<object>): string {
  // undefined 值的键剔除（规格 §4.4），null 值的键保留（两者必须可区分：审计侧用 null 表达"无从起算"）；
  // symbol 键走 Object.keys 天然被剔除。键名必须过一次 JSON.stringify：不转义的实现会把
  // { 'a:1,b': 2 } 与 { a: 1, b: 2 } 都拼成 {a:1,b:2}（键里的 : 和 , 逃逸进结构 → 两帧同指纹），
  // 且拼出来的串不再是合法 JSON（S-T5 要写进包、S-T8 要印进报告）。
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k], onPath)}`).join(',')}}`;
}

// SHA-256 前 16 位（规格 §4.4）。返回值恒为 `sha256:<16 位小写 hex>` 或 `unavailable:<原因>` 两种非空串，
// 绝不返回 null / 空串、绝不 reject：消费方按前缀分派——`sha256:` 比值、`unavailable:*` 显示「哈希未计算」，
// 两者都不构成失败（规格表格「无 crypto.subtle → 重演算照常执行」）。
export async function digestText(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return 'unavailable:insecure-context'; // 明确降级，绝不静默跳过（规格 §4.4）
  try {
    const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    // Array.from 而非 [...new Uint8Array(buf)]：本仓库 tsconfig 是 target es5，展开 typed array 要
    // downlevelIteration（tsc 直接报 TS2802），而字节序拼接的结果完全一致。
    const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    return `sha256:${hex.slice(0, 16)}`;
  } catch (error) {
    // 摘要调用本身失败（策略拒绝、上下文被销毁等）也归入"未计算"这一类：措辞由 S-T7/S-T8 的文案给，
    // 但前缀必须是 unavailable:，否则导入侧会把"算不出来"印成"哈希不符"这条假证。
    return `unavailable:${error instanceof Error ? error.name.toLowerCase() : 'unknown'}`;
  }
}

// 逐帧指纹只覆盖内容字段 {id, timestamp, version, resetCount, state}（规格 §4.4）：
// createdAt / name / enterpriseName 是展示字段，给存档改名或补时间戳不该让它读起来像被篡改。
// 整包指纹不在这里——S-T5 对**去掉 digests 字段自身**的包壳用同一个 canonicalStringify + digestText 另算一份。
export const digestFrame = (save: SaveFile): Promise<string> =>
  digestText(canonicalStringify({
    id: save.id,
    timestamp: save.timestamp,
    version: save.version,
    resetCount: save.resetCount,
    state: save.state,
  }));
