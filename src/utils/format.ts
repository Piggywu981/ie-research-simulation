// 读数→印面（规格 §4.4「null 而非 NaN」的收尾一环：审计刻意给 null，怎么把它印成人话就是会出错的地方）。
// 为什么单独立一个文件，而不是留在 SaveLoadPanel.tsx 里（Task 8 设计问题 2）：
//   audit.ts 是 util，核对报告（buildAuditReport）就住在那里，而 **util 不能 import .tsx**——
//   组件文件带 'use client' 与 React 依赖，让纯函数层反向依赖组件层，既打乱分层也把印面绑在 UI 上。
//   S-T7 的预览与 S-T8 的报告必须印得一模一样，所以这三条只能住在一个两边都够得着的纯 util 里。
// 为什么不并进 audit.ts：它们与账实判据无关（不读 version、不分类日志），任何要印金额的模块
//   （控制表、面板、报告）都该共用同一条「这数能不能印」的判据，不必为此依赖审计模块。
// 踩过的坑（不要退回裸插值 `${n}M`）：`null` 会印成 "nullM"、`Infinity` 印成 "InfinityM"、
//   `undefined` 印成 "undefinedM"——读的人是教师，这些字符串看起来像数据而不是像缺陷。

export const money = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? `${value}M` : '—';

// 合计：条目里出现非有限读数就整项作废并明说「数据异常」——把 undefined 静默当 0 计入，
// 印出来是一个**看起来合理但偏低**的合计，比报错更坏。
export const moneySum = (values: unknown[]): string => {
  let total = 0;
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—（数据异常）';
    total += value;
  }
  return money(total);
};

// 不带单位的整数读数（重置次数）：非有限即「—」，与 money 同一条判据
export const readNumber = (value: unknown): string =>
  typeof value === 'number' && Number.isFinite(value) ? `${value}` : '—';
