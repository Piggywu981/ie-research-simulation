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
    expect(panelSrc).toContain('哈希未计算（非 HTTPS 环境）');
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
});
