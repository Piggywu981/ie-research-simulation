// Task 9：能力边界文案的单源约束（规格 §4.6 / 计划 Task 9）。
// 这句话要在三个地方出现——核对报告首行、规则弹窗、README。任何一处自己再打一遍，
// 三处就会各自漂走，所以这里比对的**不是相似措辞**，而是**同一个常量对象的引用结果**：
// README 用 fs 真读文件、弹窗用导出的 RULE_SECTIONS，报告侧的同一性已由 tests/audit.test.ts 覆盖。
// 后两组用例只读源码**文本**，不渲染组件（测试环境是 node、无 jsdom，规格 §7）——
// 它们要挡的是"文档写了个界面里根本没有的说法"，而不是行为回归（行为回归在各自的测试文件里）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { INTEGRITY_BOUNDARY, INTEGRITY_CAVEATS, CAUSE_TEXT } from '../src/utils/audit';
import { SAVE_FORMAT_VERSION } from '../src/types/enterprise';
import { RULE_SECTIONS } from '../src/components/RulesModal';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
// 文档里的操作路径按 markdown 习惯给每段加反引号，比对"路径是否真写了这两级"时先把反引号剥掉，
// 免得断言绑死排版；能力边界那句仍用**原样** readme 比对（那句要求逐字，含标点）。
const readmePlain = readme.replace(/`/g, '');
const panelSrc = readFileSync(new URL('../src/components/SaveLoadPanel.tsx', import.meta.url), 'utf8');
const modalSrc = readFileSync(new URL('../src/components/RulesModal.tsx', import.meta.url), 'utf8');
const storeSrc = readFileSync(new URL('../src/store/enterpriseStore.ts', import.meta.url), 'utf8');
const auditSrc = readFileSync(new URL('../src/utils/audit.ts', import.meta.url), 'utf8');

const SAVE_SECTION = '存档与完整性校验';
const sectionItems = (): string[] => {
  const section = RULE_SECTIONS.find((s) => s.title === SAVE_SECTION);
  expect(section).toBeDefined();
  return section!.items;
};

describe('能力边界文案：三处同一句（Task 9）', () => {
  it('README 逐字含边界句与两条余地', () => {
    expect(readme).toContain(INTEGRITY_BOUNDARY);
    INTEGRITY_CAVEATS.forEach((caveat) => expect(readme).toContain(caveat));
  });

  it('规则弹窗里的是**同一个常量**（引用相等，重打同字面量过不了）', () => {
    const items = sectionItems();
    expect(items.filter((i) => i === INTEGRITY_BOUNDARY)).toHaveLength(1);
    INTEGRITY_CAVEATS.forEach((caveat) => {
      expect(items.filter((i) => i === caveat)).toHaveLength(1);
    });
  });

  it('弹窗这一节紧跟「融资与资金管理」（计划 Task 9 Step 1 的位置）', () => {
    const i = RULE_SECTIONS.findIndex((s) => s.title === '融资与资金管理');
    expect(i >= 0).toBe(true);
    expect(RULE_SECTIONS[i + 1].title).toBe(SAVE_SECTION);
  });
});

describe('文案不得描述未实现的能力 / 不得自造印面词汇（Task 9）', () => {
  it('README 的版本说法经 SAVE_FORMAT_VERSION，并写明 v3→v4 的载入期换算', () => {
    expect(readme).toContain('SAVE_FORMAT_VERSION');
    expect(readme).toContain(`当前 ${SAVE_FORMAT_VERSION}`);
    expect(readme).toContain('restatement.ts');
    expect(readme).toContain('migrateState');
  });

  it('文档写的操作路径与界面按钮同名', () => {
    expect(readmePlain).toContain('存档管理 → 导出存档包');
    expect(panelSrc).toContain('导出存档包');
    expect(panelSrc).toContain('导入存档包');
    // 弹窗/README 承诺的两条落库动作，按钮文案就是这两句
    expect(panelSrc).toContain('仅加入存档列表');
    expect(panelSrc).toContain('设为当前进度');
  });

  it('「哈希未计算」「-imported-N」「（导入N）」在源码里真存在，不是文档虚构', () => {
    // 复审 item 2：这句措辞从组件搬到 audit.ts（报告也要印同一句，而 util 不能 import .tsx），
    // 所以「真存在」的核对地点随之改成常量所在的那一份源码
    expect(auditSrc).toContain('哈希未计算（非 HTTPS 环境）');
    expect(panelSrc).toContain('digestSkipNote');            // 面板仍在用同一份，只是不再自己写一遍
    expect(storeSrc).toContain('-imported-');
    expect(storeSrc).toContain('（导入${n}）');
    // 暂停态只读豁免：文档若写"暂停时也能导出"，源码得真给这条提示
    expect(panelSrc).toContain('运营已暂停，请先继续运营再导入（导出与预览仍可用）');
  });

  it('对外用审计词汇表里的印面词，不另造一套说法', () => {
    const blob = `${sectionItems().join('\n')}\n${readme}`;
    // CAUSE_TEXT 三值与 formatFrameAudit 的读数名（住在 audit.ts，面板与报告共用）
    expect(auditSrc).toContain('流水重演算');
    Object.keys(CAUSE_TEXT).forEach((key) => expect(blob).toContain(CAUSE_TEXT[key as keyof typeof CAUSE_TEXT]));
    expect(blob).toContain('账实不符');
    expect(blob).toContain('起算链不完整');   // no-anchor 的用户可见说法（audit.ts:184）
    expect(blob).toContain('哈希未计算');
  });

  // 复审 item 4：这句常量现在被三个地方印（报告 / 弹窗 / README）。旧写法在句尾挂着「条数见下方帧统计里的…」，
  // 那是**报告版面**相对的指代——印在弹窗与 README 里指向nothing，Task 9 因此在两处各补了一句自造的
  // 说明文字（症状补丁），句子于是有了第四个、第五个版本。修法是句子本身改成上下文无关的说法，
  // 补丁随之删掉；本例钉住"不许再写方向词"，让补丁没法长回来。
  it('两条余地自带完整含义，不靠版面指代；三处之外不许再加自造的说明句', () => {
    INTEGRITY_CAVEATS.forEach((caveat) => {
      expect(caveat).not.toMatch(/下方|如上|上述|见上|见下/);
    });
    expect(modalSrc).not.toMatch(/下方|见核对报告的帧统计行/);
    expect(readme).not.toMatch(/下方帧统计|其中提到的/);
    // 唯一来源：弹窗与 README 都只能引常量，不能重打句子
    expect(modalSrc).toContain('...INTEGRITY_CAVEATS');
    expect(readme).toContain(INTEGRITY_CAVEATS[0]);
  });
});

// ══ 面板与报告共用同一份实现（复审 items 2 / 3 / 6c）════════════════════════════
// 与上面几例同一套办法：node 环境、无 jsdom（规格 §7），渲染不了组件就核对**渲染要用到的源码**。
describe('面板接线：跨度取审计侧的 packageSpan，报告导出有失败面', () => {
  it('时间跨度用 audit.ts 的 packageSpan，组件里不再留第二份定序', () => {
    expect(auditSrc).toContain('export const packageSpan');
    expect(panelSrc).toContain('packageSpan(');
    // 组件里自己再写一遍 byTimeThenId 循环 = 同毫秒兜底又漂成两份（评审 Task 7 finding 5 的形态）
    expect(panelSrc).not.toMatch(/byTimeThenId\s*\(/);
  });

  it('handleExportReport 与存档包导出同级：build 与 download 都在 try 里，原因用 error.message', () => {
    const body = /const handleExportReport[\s\S]*?\n  \};/.exec(panelSrc);
    expect(body).not.toBeNull();
    const src = body![0];
    expect(src).toContain('try {');
    expect(src).toContain('} catch');
    expect(src).toContain('setValidationError(');
    // Task 5 定的规矩：name 会把中文说明吞掉，能说的是 message
    expect(src).toContain('error.message');
    expect(src).not.toContain('error.name');
    expect(src).toContain('downloadFile(');
  });
});
