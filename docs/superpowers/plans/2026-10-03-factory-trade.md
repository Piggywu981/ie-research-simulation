# 厂房交易（q-12 / e-3）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让运行控制表的「出售厂房」（季度 12）与「支付租金/购买厂房」（年末 3）成为可真实操作、可结算、可导出的厂房交易功能，并把季度 9、13 两行的禁用理由写进表格。

**Architecture:** 给 `Factory` 增加持有方式 `holding` 与年度租赁快照 `leasedThisYear`；交易规则拆成 `rules.ts` 里的纯函数（`landAndBuildings` / `annualRent` / `RENT_BY_TYPE`）便于独立测试，store 只负责校验与状态迁移；出售款复用现有应收账款四档数组，因此自动兼容季初收现与 7:1 贴现。利润表与年度台账不新增科目——厂房交易是等值资产置换。

**Tech Stack:** Next.js 16 / React 18 / TypeScript / Zustand 5 / Vitest 4（无新依赖）。

**Spec:** `docs/superpowers/specs/2026-10-03-factory-trade-design.md`（本计划逐节实现它，第 9 节 7 条假设已与用户确认）

## Global Constraints

- 不新增任何 npm 依赖（规格 §4.5）。
- 所有规则校验失败一律 `return { validationError: '…' }`，不抛异常、不静默降级（规格 §6；沿用 `enterpriseStore.ts` 既有写法）。
- 每个变更类 action 开头必须有暂停拦截：`if (state.state.isPaused) return { validationError: '运营已暂停（教学讲解模式），请先继续运营' };`
- 金额单位为 M，整数。
- 不引入 P3/P4 相关入口。
- 提交信息：中文 Conventional Commits，与仓库现有风格一致（如 `feat(store): …`）。
- 每个任务收尾门槛：`npx vitest run` 全绿；涉及 UI/构建的任务再加 `npm run build` 通过。
- 权威课程约束：单企业设定下**永远不存在"其他企业"**（`directions/创新创业实践（2）/《创新实践及科研训练》沙盘模拟仿真开发提示词.md:89`），任何任务都不得为此新增交易对手。

---

## 文件结构

| 文件 | 职责 | 本计划动作 |
|---|---|---|
| `src/types/enterprise.ts` | 类型契约 | 新增 `FactoryHolding`、`Factory.holding`、`Factory.leasedThisYear`；存档版本注释 |
| `src/utils/rules.ts` | 无状态规则纯函数 | 新增 `RENT_BY_TYPE`、`landAndBuildings`、`annualRent` |
| `src/store/enterpriseStore.ts` | 状态与业务规则 | `initialState` 补字段、`migrateStateV1`→`migrateState`、新增 3 个 action、e-3 租金改快照、跨年刷新、存档版本 3 |
| `src/utils/controlTable.ts` | 控制表行定义 | q-9/q-12/q-13 行名 |
| `src/components/OperationCenter.tsx` | 运营流程页 | 删除本地硬编码步骤表，改由 `CONTROL_STEPS` 派生 |
| `src/components/ProductionCenter.tsx` | 生产中心 UI | 权属徽标、交易按钮与门控、土地和建筑展示 |
| `src/components/RulesModal.tsx` | 规则弹窗 | 「厂房与生产线」节补交易规则文案 |
| `README.md` | 对外文档 | 关键规则补厂房交易、测试用例数校正 |
| `tests/factory.test.ts` | 新建测试 | 权属/交易/租金快照 |
| `tests/rules.test.ts` | 追加 | 纯函数单测 |
| `tests/controlTable.test.ts` | 修改断言 | 行名变化后的禁用行计数 |

---

## Task 1: 权属状态、派生资产与存档迁移

**Files:**
- Modify: `src/types/enterprise.ts`（`Factory` 接口，约 :100-107；`SaveFile.version` 注释 :291）
- Modify: `src/utils/rules.ts`（文件末尾追加）
- Modify: `src/store/enterpriseStore.ts:59-95`（两个厂房的 `initialState`）
- Modify: `src/store/enterpriseStore.ts:211`（函数改名）、`:242-247`（迁移体）、`:362`、`:392`（`version: 2`→`3`）、`:412`、`:418-420`（`loadGame`）
- Test: `tests/rules.test.ts`（追加）、`tests/factory.test.ts`（新建）

**Interfaces:**
- Consumes: 无（本任务是地基）
- Produces: `FactoryHolding`、`RENT_BY_TYPE: { large: 5, small: 3 }`、`landAndBuildings(factories)`、`annualRent(factories)`、`Factory.holding`、`Factory.leasedThisYear`、`migrateState(s: EnterpriseState): EnterpriseState`

- [ ] **Step 1: 写失败测试**

新建 `tests/factory.test.ts`：

```ts
import { beforeEach, describe, it, expect } from 'vitest';
import { useEnterpriseStore, createFreshState } from '../src/store/enterpriseStore';
import { landAndBuildings, annualRent, RENT_BY_TYPE } from '../src/utils/rules';

const store = () => useEnterpriseStore.getState();
const resetStore = () => {
  useEnterpriseStore.setState({ state: createFreshState(), validationError: null });
};

beforeEach(() => resetStore());

describe('厂房权属与派生资产', () => {
  it('初始状态：大厂房自有、小厂房租赁；土地和建筑=40M、当年租金=3M', () => {
    const factories = store().state.production.factories;
    expect(factories[0].holding).toBe('owned');
    expect(factories[1].holding).toBe('leased');
    expect(landAndBuildings(factories)).toBe(40);
    expect(annualRent(factories)).toBe(3);
    expect(RENT_BY_TYPE.large).toBe(5);
  });

  it('annualRent 只认 leasedThisYear 快照，不认实时 holding', () => {
    const factories = [
      { type: 'small' as const, purchasePrice: 30, leasedThisYear: true },
      { type: 'large' as const, purchasePrice: 40, leasedThisYear: false },
    ];
    expect(annualRent(factories)).toBe(3);
  });

  it('v2 存档缺失权属字段时按槽位补齐', () => {
    const legacy = JSON.parse(JSON.stringify(createFreshState()));
    delete legacy.production.factories[0].holding;
    delete legacy.production.factories[0].leasedThisYear;
    delete legacy.production.factories[1].holding;
    delete legacy.production.factories[1].leasedThisYear;
    useEnterpriseStore.getState().loadGame({
      id: 's1', name: '旧档', enterpriseName: '企业1', timestamp: Date.now(),
      resetCount: 0, version: 2, state: legacy, createdAt: new Date().toISOString(),
    });
    const fs = store().state.production.factories;
    expect(fs[0].holding).toBe('owned');
    expect(fs[0].leasedThisYear).toBe(false);
    expect(fs[1].holding).toBe('leased');
    expect(fs[1].leasedThisYear).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/factory.test.ts`
Expected: FAIL，报 `landAndBuildings is not a function`（或 TS 层 `No matching export`），以及 `holding` 断言 `undefined`。

- [ ] **Step 3: 加类型**

`src/types/enterprise.ts` 的 `Factory` 接口内、`productionLines` 字段之后插入：

```ts
// 持有方式：自有 / 租赁 / 未持有（槽位保留但不可放置生产线）
holding: 'owned' | 'leased' | 'none';
// 本年度（年初时点）是否租赁中；租金结算只认此快照，不认实时 holding
leasedThisYear: boolean;
```

同文件 `SaveFile.version` 注释改为：

```ts
  version: number; // 存档格式版本：1=旧版，2=贷款台账/年度台账/绝对季度索引，3=厂房权属与租赁快照
```

- [ ] **Step 4: 加纯函数**

`src/utils/rules.ts` 末尾追加：

```ts
// 厂房交易（非现金资产置换）：规格 §4.1/§4.3
export const RENT_BY_TYPE = { large: 5, small: 3 } as const;

export const landAndBuildings = (
  factories: { holding: string; purchasePrice: number }[],
) => factories.filter((f) => f.holding === 'owned').reduce((sum, f) => sum + f.purchasePrice, 0);

// 年末租金只向「年初即在租赁中」的槽位收取，避免年末买断漏收、年末新租多收
export const annualRent = (
  factories: { type: 'large' | 'small'; leasedThisYear: boolean }[],
) => factories.filter((f) => f.leasedThisYear).reduce((sum, f) => sum + RENT_BY_TYPE[f.type], 0);
```

- [ ] **Step 5: 补初始状态**

`src/store/enterpriseStore.ts:62` 附近，大厂房对象 `purchasePrice: 40,` 之后加两行；小厂房 `purchasePrice: 30,` 之后加两行：

```ts
        holding: 'owned',
        leasedThisYear: false,
```

```ts
        holding: 'leased',
        leasedThisYear: true,
```

同时把 `:62` 与 `:91` 行尾注释里的"（自有，不提折旧）""（初始为租赁，年末付租金3M/年）"删掉——字段已自证，注释属重复。

- [ ] **Step 6: 迁移与版本号**

`enterpriseStore.ts:211` 函数改名并扩展。签名行改为 `const migrateState = (s: EnterpriseState): EnterpriseState => {`，在 `:242-247` 的生产线迁移之后插入：

```ts
  state.production?.factories?.forEach(f => {
    if (!f.holding) f.holding = f.id === 'factory-2' ? 'leased' : 'owned';
    if (typeof f.leasedThisYear !== 'boolean') f.leasedThisYear = f.holding === 'leased';
  });
```

`:362` 与 `:392` 的 `version: 2,` 均改为 `version: 3,`；`:412` 调用点改为 `const migrated = migrateState(raw);`；`:418-420` 的提示改为：

```ts
    get().addOperationLog('加载存档', saveFile.version === 3
      ? `加载存档：${saveFile.name}`
      : `加载存档：${saveFile.name}（旧版存档已迁移至v3，建议重置开新局）`);
```

- [ ] **Step 7: 跑测试确认通过**

Run: `npx vitest run`
Expected: PASS，含新增 3 例；原有 86 例不回归。若 `tests/controlTable.test.ts` 或别处因 `version` 常量变化而失败，按新值修断言（不应有，存档版本仅出现在 store 内部）。

- [ ] **Step 8: 提交**

```bash
git add src/types/enterprise.ts src/utils/rules.ts src/store/enterpriseStore.ts tests/factory.test.ts
git commit -m "feat(production): 厂房权属状态与租赁快照字段，土地建筑改派生计算"
```

---

## Task 2: 购买与租赁（年末 e-3）

**Files:**
- Modify: `src/store/enterpriseStore.ts:295`（action 类型声明区）、`:941` 附近（实现区，放在 `removeProductionLine` 之前）
- Test: `tests/factory.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 的 `Factory.holding`、`RENT_BY_TYPE`
- Produces: `buyFactory(factoryId: string): void`、`leaseFactory(factoryId: string): void`（均在 Zustand store 上，日志 `stepId: 'e-3'`）

- [ ] **Step 1: 写失败测试**

追加到 `tests/factory.test.ts`：

```ts
const advance = (n: number) => { for (let i = 0; i < n; i++) store().nextQuarter(); };

describe('购买与租赁厂房', () => {
  it('非第4季度购买被拒绝且状态零变化', () => {
    store().buyFactory('factory-2');
    expect(store().validationError).toContain('年末');
    expect(store().state.finance.cash).toBe(20);
    expect(store().state.production.factories[1].holding).toBe('leased');
  });

  it('第4季度买断小厂房：现金-30、权属转 owned、生产线保留、写 e-3 日志', () => {
    useEnterpriseStore.setState({ state: { ...store().state, finance: { ...store().state.finance, cash: 60 } } });
    advance(3);
    expect(store().state.operation.currentQuarter).toBe(4);
    expect(store().state.production.factories[1].productionLines).toHaveLength(1);
    const cashBefore = store().state.finance.cash; // 推进到 Q4 会产行政费等变动，必须用差值断言
    store().buyFactory('factory-2');
    expect(store().validationError).toBeNull();
    expect(store().state.finance.cash).toBe(cashBefore - 30);
    expect(store().state.production.factories[1].holding).toBe('owned');
    // 规格 §9 假设 3：买断是权属变更，不要求腾空、不影响在产线
    expect(store().state.production.factories[1].productionLines).toHaveLength(1);
    const log = store().state.operation.financialLogs.find(l => l.stepId === 'e-3' && l.description.includes('购买厂房'));
    expect(log?.description).toContain('-30M');
  });

  it('现金不足拒绝且状态零变化', () => {
    advance(3);
    store().buyFactory('factory-2');
    expect(store().validationError).toContain('现金不足');
    expect(store().state.production.factories[1].holding).toBe('leased');
  });

  it('已自有的厂房重复购买被拒绝', () => {
    advance(3);
    store().buyFactory('factory-1');
    expect(store().validationError).toContain('无需重复购买');
  });

  it('未持有的槽位可新租，当年与次年租金由快照决定', () => {
    advance(3);
    useEnterpriseStore.setState({ state: { ...store().state, production: { ...store().state.production, factories: store().state.production.factories.map(f => f.id === 'factory-1' ? { ...f, holding: 'none' as const } : f) } } });
    store().leaseFactory('factory-1');
    expect(store().validationError).toBeNull();
    expect(store().state.production.factories[0].holding).toBe('leased');
    expect(store().state.production.factories[0].leasedThisYear).toBe(false);
    const log = store().state.operation.financialLogs.find(l => l.stepId === 'e-3' && l.description.includes('新租厂房'));
    expect(log?.description).toContain('5M/年');
  });

  it('已租赁或已自有的槽位不能再新租', () => {
    advance(3);
    store().leaseFactory('factory-2');
    expect(store().validationError).toContain('已被持有');
  });

  it('暂停状态下两笔交易都拒绝', () => {
    advance(3);
    store().togglePaused();
    store().buyFactory('factory-2');
    expect(store().validationError).toContain('暂停');
    store().leaseFactory('factory-1');
    expect(store().validationError).toContain('暂停');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/factory.test.ts`
Expected: FAIL，`store().buyFactory is not a function`。

- [ ] **Step 3: 声明 action 类型**

`enterpriseStore.ts:295` 的 `removeProductionLine: …` 之前插入两行签名：

```ts
  buyFactory: (factoryId: string) => void;
  leaseFactory: (factoryId: string) => void;
```

- [ ] **Step 4: 实现 buyFactory**

在 `cancelProduction` 实现之前（约 `:941`）插入。注意 `RENT_BY_TYPE` 需加入文件顶部 `from '../utils/rules'` 的导入列表：

```ts
  buyFactory: (factoryId) =>
    set((state) => {
      if (state.state.isPaused) {
        return { validationError: '运营已暂停（教学讲解模式），请先继续运营' };
      }
      const { finance, production, operation } = state.state;
      if (operation.currentQuarter !== 4) {
        return { validationError: '厂房购买与租赁仅在年末（第4季度）办理' };
      }
      const factory = production.factories.find(f => f.id === factoryId);
      if (!factory) {
        return { validationError: '未找到该厂房' };
      }
      if (factory.holding === 'owned') {
        return { validationError: `${factory.name}已是自有厂房，无需重复购买` };
      }
      if (finance.cash < factory.purchasePrice) {
        return { validationError: `现金不足：购买${factory.name}需 ${factory.purchasePrice}M，当前现金 ${finance.cash}M` };
      }
      const newCash = finance.cash - factory.purchasePrice;
      const log: FinancialLogRecord = {
        id: `finlog-${Date.now()}-buy-factory`,
        year: operation.currentYear,
        quarter: operation.currentQuarter,
        timestamp: Date.now(),
        description: `购买厂房：${factory.name} -${factory.purchasePrice}M`,
        cashChange: -factory.purchasePrice,
        newCash,
        operator: '企业1管理者',
        stepId: 'e-3',
      };
      return {
        validationError: null,
        state: {
          ...state.state,
          production: {
            ...production,
            factories: production.factories.map(f =>
              f.id === factoryId ? { ...f, holding: 'owned' as const } : f
            ),
          },
          finance: { ...finance, cash: newCash },
          operation: { ...operation, financialLogs: [log, ...operation.financialLogs] },
        },
      };
    }),

  leaseFactory: (factoryId) =>
    set((state) => {
      if (state.state.isPaused) {
        return { validationError: '运营已暂停（教学讲解模式），请先继续运营' };
      }
      const { production, operation } = state.state;
      if (operation.currentQuarter !== 4) {
        return { validationError: '厂房购买与租赁仅在年末（第4季度）办理' };
      }
      const factory = production.factories.find(f => f.id === factoryId);
      if (!factory) {
        return { validationError: '未找到该厂房' };
      }
      if (factory.holding !== 'none') {
        return { validationError: `${factory.name}已被持有（${factory.holding === 'owned' ? '自有' : '租赁中'}），无需再租` };
      }
      const log: FinancialLogRecord = {
        id: `finlog-${Date.now()}-lease-factory`,
        year: operation.currentYear,
        quarter: operation.currentQuarter,
        timestamp: Date.now(),
        description: `新租厂房：${factory.name}（租金${RENT_BY_TYPE[factory.type]}M/年，次年起计）`,
        cashChange: 0,
        newCash: state.state.finance.cash,
        operator: '企业1管理者',
        stepId: 'e-3',
      };
      return {
        validationError: null,
        state: {
          ...state.state,
          production: {
            ...production,
            factories: production.factories.map(f =>
              f.id === factoryId ? { ...f, holding: 'leased' as const } : f
            ),
          },
          operation: { ...operation, financialLogs: [log, ...operation.financialLogs] },
        },
      };
    }),
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/factory.test.ts`
Expected: PASS。`leaseFactory` 的 `已被持有` 提示需匹配测试里的 `toContain('已被持有')`。

- [ ] **Step 6: 提交**

```bash
git add src/store/enterpriseStore.ts tests/factory.test.ts
git commit -m "feat(production): 年末厂房购买与租赁操作"
```

---

## Task 3: 出售厂房（任意季度 q-12）与未持有槽位禁排产

**Files:**
- Modify: `src/store/enterpriseStore.ts`（action 声明区 + 实现区 + `addProductionLine` 校验 `:795-799`）
- Test: `tests/factory.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 的 `Factory.holding`、现有 `FinanceData.accountsReceivable`（索引 = 账期 - 1，见 `:42` 与 `deliverOrder:1796`）
- Produces: `sellFactory(factoryId: string): void`（日志 `stepId: 'q-12'`，`cashChange: 0`）

- [ ] **Step 1: 写失败测试**

```ts
describe('出售厂房', () => {
  const emptyLargeFactory = () => {
    useEnterpriseStore.setState({
      state: {
        ...store().state,
        production: {
          ...store().state.production,
          factories: store().state.production.factories.map(f =>
            f.id === 'factory-1' ? { ...f, productionLines: [] } : f
          ),
        },
      },
    });
  };

  it('厂房内有生产线时拒绝出售', () => {
    store().sellFactory('factory-1');
    expect(store().validationError).toContain('腾空');
    expect(store().state.production.factories[0].holding).toBe('owned');
  });

  it('季中可出售：不进现金、售价入应收4Q档、写 q-12 非现金日志', () => {
    emptyLargeFactory();
    const cashBefore = store().state.finance.cash;
    store().sellFactory('factory-1');
    expect(store().validationError).toBeNull();
    expect(store().state.finance.cash).toBe(cashBefore);
    expect(store().state.production.factories[0].holding).toBe('none');
    expect(store().state.finance.accountsReceivable[3]).toBe(15 + 40);
    const log = store().state.operation.financialLogs.find(l => l.stepId === 'q-12');
    expect(log?.cashChange).toBe(0);
    expect(log?.description).toContain('+40M（计入4Q应收款）');
  });

  it('租赁中的厂房不可出售，提示先买断', () => {
    store().sellFactory('factory-2');
    expect(store().validationError).toContain('买断');
  });

  it('出售后第4个季度初收到该笔应收', () => {
    emptyLargeFactory();
    store().sellFactory('factory-1');
    const before = store().state.finance.cash;
    for (let i = 0; i < 4; i++) store().nextQuarter();
    expect(store().state.finance.cash).toBeGreaterThan(before + 39);
  });

  it('出售所得可被 7:1 贴现（与既有应收混池，从最早账期起扣）', () => {
    emptyLargeFactory();
    store().sellFactory('factory-1');
    store().discountReceivable(14);
    expect(store().validationError).toBeNull();
    expect(store().state.finance.cash).toBe(20 + 12);
    expect(store().state.finance.accountsReceivable[3]).toBe(55 - 14);
  });

  it('未持有的槽位不能放置生产线', () => {
    emptyLargeFactory();
    store().sellFactory('factory-1');
    store().addProductionLine('factory-1', 'automatic', 'P1');
    expect(store().validationError).toContain('未被持有');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/factory.test.ts`
Expected: FAIL，`store().sellFactory is not a function`。

- [ ] **Step 3: 实现 sellFactory**

签名区加 `sellFactory: (factoryId: string) => void;`，实现放在 `buyFactory` 之后：

```ts
  sellFactory: (factoryId) =>
    set((state) => {
      if (state.state.isPaused) {
        return { validationError: '运营已暂停（教学讲解模式），请先继续运营' };
      }
      const { finance, production, operation } = state.state;
      const factory = production.factories.find(f => f.id === factoryId);
      if (!factory) {
        return { validationError: '未找到该厂房' };
      }
      if (factory.holding === 'leased') {
        return { validationError: `${factory.name}为租赁厂房，请先买断后再出售` };
      }
      if (factory.holding === 'none') {
        return { validationError: `${factory.name}未被持有，无法出售` };
      }
      if (factory.productionLines.length > 0) {
        return { validationError: `${factory.name}仍有 ${factory.productionLines.length} 条生产线，需先腾空后才能出售` };
      }
      const newAR = [...finance.accountsReceivable] as [number, number, number, number];
      newAR[3] += factory.purchasePrice;
      const log: FinancialLogRecord = {
        id: `finlog-${Date.now()}-sell-factory`,
        year: operation.currentYear,
        quarter: operation.currentQuarter,
        timestamp: Date.now(),
        description: `出售厂房：${factory.name} +${factory.purchasePrice}M（计入4Q应收款）`,
        cashChange: 0,
        newCash: finance.cash,
        operator: '企业1管理者',
        stepId: 'q-12',
      };
      return {
        validationError: null,
        state: {
          ...state.state,
          production: {
            ...production,
            factories: production.factories.map(f =>
              f.id === factoryId ? { ...f, holding: 'none' as const } : f
            ),
          },
          finance: { ...finance, accountsReceivable: newAR },
          operation: { ...operation, financialLogs: [log, ...operation.financialLogs] },
        },
      };
    }),
```

- [ ] **Step 4: 未持有槽位禁止排产**

`addProductionLine`（`:795` 取到 `factory` 之后、容量检查之前）插入：

```ts
      if (factory.holding === 'none') {
        return { validationError: `${factory.name}未被持有，无法放置生产线` };
      }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/factory.test.ts`
Expected: PASS。若"出售后第4个季度初收到该笔应收"因年末费用（维护/租金/长贷息 6M+）而失败，把该例的现金注入改为 `cash: 80`（参照 `tests/loans.test.ts:76-81` 的既有做法），断言逻辑不变。

- [ ] **Step 6: 提交**

```bash
git add src/store/enterpriseStore.ts tests/factory.test.ts
git commit -m "feat(production): 出售厂房入应收账款，未持有槽位禁止排产"
```

---

## Task 4: 租金改为年度快照结算

**Files:**
- Modify: `src/store/enterpriseStore.ts:2359-2378`（e-3 段）、`:2426` 之前（跨年刷新）
- Test: `tests/factory.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 的 `annualRent`
- Produces: `nextQuarter` 内年末租金 = `annualRent(state.state.production.factories)`；Q4→次年 Q1 过渡时把每个槽位的 `leasedThisYear` 刷新为 `holding === 'leased'`

- [ ] **Step 1: 写失败测试**

```ts
describe('租金快照口径', () => {
  // 必须用 startsWith 精确锁定系统自动租金日志：玩家的新租日志同样含"租金"二字
  const rentLogs = () => store().state.operation.financialLogs
    .filter(l => l.stepId === 'e-3' && l.description.startsWith('支付厂房租金'));

  it('年末买断小厂房，收尾年度仍收当年 3M 租金', () => {
    useEnterpriseStore.setState({ state: { ...store().state, finance: { ...store().state.finance, cash: 60 } } });
    advance(3);
    store().buyFactory('factory-2');
    store().nextQuarter(); // 第1年Q4 → 第2年Q1，此处结算第1年租金
    expect(rentLogs().some(l => l.year === 2 && l.description.includes('3M'))).toBe(true);
  });

  it('年末新租大厂房，收尾年度不计其租金，次年计 5M', () => {
    useEnterpriseStore.setState({
      state: {
        ...store().state,
        production: { ...store().state.production, factories: store().state.production.factories.map(f => f.id === 'factory-1' ? { ...f, holding: 'none' as const, productionLines: [] } : f) },
        finance: { ...store().state.finance, cash: 60 },
      },
    });
    advance(3);
    store().leaseFactory('factory-1');
    store().nextQuarter();
    const year1 = rentLogs().find(l => l.year === 2);
    expect(year1?.description).toBe('支付厂房租金：-厂房租金3M'); // 新租的大厂房本年不计
    useEnterpriseStore.setState({ state: { ...store().state, finance: { ...store().state.finance, cash: 60 } } });
    advance(4);
    const year2 = rentLogs().find(l => l.year === 3);
    expect(year2?.description).toBe('支付厂房租金：-厂房租金8M'); // 大 5M + 小 3M
  });

  it('买断的厂房卖掉后，次年不再收其租金（快照由跨年刷新清零，不由 sellFactory 清零）', () => {
    // 真实路径：第1年Q4买断小厂房 → 结算收当年3M → 跨年刷新把快照转 false
    // → 第2年Q4出售 → 第2年结算租金为 0。
    // 不变量：只有跨年刷新写 leasedThisYear；sellFactory 不得清零，否则"年末买断后同年卖出"
    // 会把当年租金一起免掉（§9-7 要防的漏收）。
    // 小厂房需先清空生产线，否则 sellFactory 会以"需先腾空"拒绝。
    useEnterpriseStore.setState({
      state: {
        ...store().state,
        finance: { ...store().state.finance, cash: 60 },
        production: {
          ...store().state.production,
          factories: store().state.production.factories.map(f =>
            f.id === 'factory-2' ? { ...f, productionLines: [] } : f
          ),
        },
      },
    });
    advance(3);
    store().buyFactory('factory-2');
    store().nextQuarter(); // 第1年Q4 → 第2年Q1：结算第1年租金
    expect(rentLogs().find(l => l.year === 2)?.description).toBe('支付厂房租金：-厂房租金3M');
    advance(3); // 第2年Q4
    expect(store().state.production.factories[1].leasedThisYear).toBe(false);
    store().sellFactory('factory-2');
    store().nextQuarter(); // 第2年Q4 → 第3年Q1：该槽位已出售，租金归零
    expect(rentLogs().find(l => l.year === 3)?.description).toBe('支付厂房租金：-厂房租金0M');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/factory.test.ts`
Expected: FAIL——现实现按 `factory.type === 'small'` 硬编码，买断/新租用例的金额与年度对不上，第三条用例必然失败。

- [ ] **Step 3: 接线 annualRent**

把 `:2359-2378` 整块换成下面这段（`annualRent` 需加入顶部 rules 导入）。关键差异：求和改用快照纯函数，且**零租金的年末也产出一条日志**，好让控制表 `e-3` 格子显式呈现"已结算 0M"而不是空白：

```ts
      // e-3 支付租金/购买厂房：按年初租赁快照收取（年末买断仍欠当年租金，年末新租次年起计）
      let rentCost = 0;
      if (isYearEnd) {
        rentCost = annualRent(state.state.production.factories);
        yearEndLogs.push({
          id: `finlog-${Date.now()}-rent`,
          year: newYear,
          quarter: newQuarter,
          timestamp: Date.now(),
          description: `支付厂房租金：-厂房租金${rentCost}M`,
          cashChange: -rentCost,
          newCash: 0,
          operator: '系统自动',
          stepId: 'e-3',
        });
      }
```

- [ ] **Step 4: 跨年刷新快照**

在 e-4 折旧块之后、`// 年度台账：` 注释（`:2426`）之前插入：

```ts
      // 年末结算已读取旧快照，此后方可刷新各槽位的该年度租赁标记
      if (isYearEnd) {
        for (let i = 0; i < newFactories.length; i++) {
          newFactories[i] = { ...newFactories[i], leasedThisYear: newFactories[i].holding === 'leased' };
        }
      }
```

顺序不可调换：若先刷新再结算，年末买断会漏收当年租金、年末新租会多收一年。

- [ ] **Step 5: 跑全量测试确认通过**

Run: `npx vitest run`
Expected: PASS。若 `tests/loans.test.ts`、`tests/tax.test.ts` 等因"零租金年份新增了一条 e-3 日志"而断言失败，按新语义修断言（这些测试原本假设无租金年份不产日志，现改为产出 `-厂房租金0M`）。

- [ ] **Step 6: 提交**

```bash
git add src/store/enterpriseStore.ts tests/factory.test.ts
git commit -m "fix(production): 厂房租金改按年初租赁快照结算，堵住年末买断漏收"
```

---

## Task 5: 控制表行名与步骤表单一来源

**Files:**
- Modify: `src/utils/controlTable.ts:24,27,28`
- Modify: `src/components/OperationCenter.tsx:443-473`
- Test: `tests/controlTable.test.ts:114-122`（断言更新）、`tests/factory.test.ts`（追加导出断言）

**Interfaces:**
- Consumes: Task 3 的 `sellFactory` 日志（`stepId: 'q-12'`）、Task 2 的 `e-3` 日志
- Produces: `CONTROL_STEPS` 中 `q-12` 名为「出售厂房」；`OperationCenter` 的 `OPERATION_STEPS` 由 `CONTROL_STEPS` 派生

- [ ] **Step 1: 写失败测试**

`tests/factory.test.ts` 追加（导入 `import { buildYearControlTable } from '../src/utils/controlTable';`）：

```ts
describe('控制表导出', () => {
  it('出售厂房落在 q-12 列、购买落在 e-3 列', () => {
    useEnterpriseStore.setState({
      state: {
        ...store().state,
        finance: { ...store().state.finance, cash: 60 },
        production: { ...store().state.production, factories: store().state.production.factories.map(f => f.id === 'factory-1' ? { ...f, productionLines: [] } : f) },
      },
    });
    store().sellFactory('factory-1');
    advance(3);
    store().buyFactory('factory-2');
    const { logs, saves } = { logs: store().state.operation.financialLogs, saves: store().getSaveFiles() };
    const table = buildYearControlTable(1, logs, saves);
    expect(table.find(r => r[1] === '出售厂房')![2]).toContain('+40M（计入4Q应收款）');
    expect(table.find(r => r[1] === '支付租金/购买厂房')![2]).toContain('购买厂房');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/factory.test.ts -t "控制表导出"`
Expected: FAIL，`find(...)` 返回 undefined（`q-12` 行名仍是「（本项目未启用：厂房不可交易）」）。

- [ ] **Step 3: 改行名**

`src/utils/controlTable.ts`：

```ts
  { id: 'q-9', name: '（单企业无交易对手：向其他企业购买/出售原材料，不启用）', phase: '季度' },
```

```ts
  { id: 'q-12', name: '出售厂房', phase: '季度' },
```

```ts
  { id: 'q-13', name: '（单企业无交易对手：向其他企业购买/出售成品，不启用）', phase: '季度' },
```

- [ ] **Step 4: 步骤表改为派生**

`OperationCenter.tsx` 删除 `:443-473` 整个 `OPERATION_STEPS` 字面量，替换为（顶部加 `import { CONTROL_STEPS } from '../utils/controlTable';`）：

```tsx
// 操作步骤数据：与导出器共用 CONTROL_STEPS，避免两份行名各改一处
const OPERATION_STEPS: OperationStep[] = CONTROL_STEPS.map(s => ({
  phase: s.phase,
  step: s.phase === '季度' ? s.id.slice(2) : '',
  description: s.name,
}));
```

- [ ] **Step 5: 修既有断言**

`tests/controlTable.test.ts:114-122` 的禁用行计数由 3 改 2，并补断言 `出售厂房` 行存在：

```ts
  it('季度行：无事件的四个季度格全部填 —', () => {
    const table = rows(1, [], []);
    const disabledRows = table.filter(r => r[1].startsWith('（单企业无交易对手'));
    expect(disabledRows).toHaveLength(2);
    disabledRows.forEach(r => {
      expect(r.slice(2)).toEqual(['—', '—', '—', '—']);
    });
    expect(table.find(r => r[1] === '出售厂房')!.slice(2)).toEqual(['—', '—', '—', '—']);
    expect(table.find(r => r[1].includes('更新应付账款'))!.slice(2)).toEqual(['—', '—', '—', '—']);
  });
```

- [ ] **Step 6: 跑全量测试 + 构建**

Run: `npx vitest run && npm run build`
Expected: 测试全绿、构建成功（`OperationCenter` 渲染未变，仅数据源换了）。

- [ ] **Step 7: 提交**

```bash
git add src/utils/controlTable.ts src/components/OperationCenter.tsx tests/controlTable.test.ts tests/factory.test.ts
git commit -m "feat(controlTable): 启用出售厂房行，步骤表改由 CONTROL_STEPS 单一来源派生"
```

---

## Task 6: 生产中心 UI（权属、交易按钮、土地和建筑）

**Files:**
- Modify: `src/components/ProductionCenter.tsx:7`（解构 action）、`:129-136`（厂房卡片头）、`:102-124`（概览区）
- 无自动化 UI 测试（规格 §7：以 `npm run build` + 手工冒烟验证）

**Interfaces:**
- Consumes: Task 1 `landAndBuildings`；Task 2/3 的 `buyFactory` / `leaseFactory` / `sellFactory`
- Produces: 厂房卡片上的权属徽标与三个门控按钮

- [ ] **Step 1: 接线 store 与派生值**

`:7` 的解构补上三个 action：

```tsx
  const { state, investProductR_D, addProductionLine, removeProductionLine, cancelProduction, startProduction, convertProductionLine, buyFactory, leaseFactory, sellFactory } = useEnterpriseStore();
```

顶部加 `import { landAndBuildings } from '../utils/rules';`，组件内取当前季度：`const { production, finance, productionLineLimits, operation } = state;`（把 `operation` 加进 `:8` 的解构）。

- [ ] **Step 2: 概览区加"土地和建筑"**

`:104` 的 `grid grid-cols-1 md:grid-cols-3` 改为 `md:grid-cols-4`，在"厂房数量"格子之后插入：

```tsx
          <div className="bg-purple-50 p-4 rounded-lg">
            <div className="text-sm text-purple-600 mb-1">土地和建筑</div>
            <div className="text-2xl font-bold text-purple-800">{landAndBuildings(production.factories)}M</div>
          </div>
```

- [ ] **Step 3: 厂房卡片头加权属与按钮**

`:131-136` 的 `flex justify-between items-center mb-4` 块替换为：

```tsx
              <div className="mb-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-semibold">{factory.name}</h3>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    factory.holding === 'owned' ? 'bg-blue-100 text-blue-700'
                    : factory.holding === 'leased' ? 'bg-amber-100 text-amber-700'
                    : 'bg-gray-200 text-gray-600'
                  }`}>
                    {factory.holding === 'owned' ? '自有' : factory.holding === 'leased' ? `租赁中（${RENT_BY_TYPE[factory.type]}M/年）` : '未持有'}
                  </span>
                </div>
                <div className="text-sm text-gray-500 mt-1">
                  容量: {factory.productionLines.length}/{factory.capacity} 条生产线 · 买价 {factory.purchasePrice}M
                </div>
                <div className="flex gap-2 mt-3">
                  {factory.holding !== 'owned' && (
                    <button onClick={() => buyFactory(factory.id)} disabled={operation.currentQuarter !== 4}
                      className="text-xs px-3 py-1 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
                      title={operation.currentQuarter !== 4 ? '厂房购买仅在年末（第4季度）办理' : `以 ${factory.purchasePrice}M 买断`}>
                      购买 {factory.purchasePrice}M
                    </button>
                  )}
                  {factory.holding === 'none' && (
                    <button onClick={() => leaseFactory(factory.id)} disabled={operation.currentQuarter !== 4}
                      className="text-xs px-3 py-1 rounded bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
                      title={operation.currentQuarter !== 4 ? '厂房租赁仅在年末（第4季度）办理' : `次年起按 ${RENT_BY_TYPE[factory.type]}M/年计租`}>
                      租赁
                    </button>
                  )}
                  {factory.holding === 'owned' && (
                    <button onClick={() => sellFactory(factory.id)} disabled={factory.productionLines.length > 0}
                      className="text-xs px-3 py-1 rounded bg-gray-600 text-white hover:bg-gray-700 disabled:opacity-50"
                      title={factory.productionLines.length > 0 ? '需先腾空该厂房内的生产线' : `售价 ${factory.purchasePrice}M，计入4Q应收款`}>
                      出售 +{factory.purchasePrice}M（4Q到账）
                    </button>
                  )}
                </div>
              </div>
```

顶部补 `import { landAndBuildings, RENT_BY_TYPE } from '../utils/rules';`（与 Step 1 的导入合并成一行）。

- [ ] **Step 4: 未持有厂房不渲染空生产位**

`:309` 生成空位的表达式改为持有才渲染：

```tsx
                {factory.holding !== 'none' && Array.from({ length: factory.capacity - factory.productionLines.length }).map((_, index) => (
```

- [ ] **Step 5: 构建 + 手工冒烟**

Run: `npm run build`，然后 `npm run dev` 按下列剧本走一遍并逐条确认：
1. 概览出现「土地和建筑 40M」，大厂房卡片标"自有"、小厂房标"租赁中（3M/年）"。
2. Q1 时"购买/租赁"按钮为禁用态且 title 提示年末。
3. 推进到 Q4（点三次下一季度），买断小厂房 → 现金 20→…→买断后权属转"自有"，页头现金即时下降 30M。
4. 再推进一个季度进入第2年 Q1，查看财务中心现金变化：第1年年末租金仍收 3M（买断没漏付）。
5. 大厂房"出售"按钮在有生产线时禁用；先变卖该线，再出售 → 权属"未持有"，应收账款 4Q 档 +40M。
6. 运营流程页导出第1年控制表 CSV，确认 `q-12` 单元格含「出售厂房…+40M（计入4Q应收款）」、`e-3` 含「购买厂房」。
7. 顶部"暂停运营"后上述按钮点击均报"请先继续运营"。

Expected: 7 条全过；任一条不符回到对应步骤修。

- [ ] **Step 6: 提交**

```bash
git add src/components/ProductionCenter.tsx
git commit -m "feat(ui): 厂房权属徽标与购买/租赁/出售操作，展示土地和建筑"
```

---

## Task 7: 规则弹窗与 README 文案

**Files:**
- Modify: `src/components/RulesModal.tsx:34-45`（「厂房与生产线」节）
- Modify: `README.md`（关键规则节、核心功能节、开发说明的测试数、版本历史）
- Test: 无（纯文案）

**Interfaces:**
- Consumes: 已实现的全部行为（文案必须与代码一致，不得描述未实现的能力）
- Produces: 面向学生的规则说明与文档

- [ ] **Step 1: 弹窗补交易规则**

`RulesModal.tsx` 的「厂房与生产线」`items` 数组末尾追加：

```ts
      '厂房交易：年末（第4季度）可购买或新租厂房；出售自有厂房四个季度皆可，但需先腾空该厂房内的生产线。',
      '大厂房 买价40M/租金5M·年/容量6条线；小厂房 买价30M/租金3M·年/容量4条线。厂房不提折旧。',
      '出售厂房收入计入4Q应收款，不当季到账，可按 7:1 规则贴现。年末买断仍需支付当年租金。',
      '本系统为单企业设定，不存在其他企业，故"向其他企业购买/出售原材料与成品"两项操作未启用。',
```

- [ ] **Step 2: README 三处校正**

关键规则节（`:77` 之后）补一条：

```md
- **厂房交易**：年末购买/新租（大40M/5M年、小30M/3M年），任意季度可出售已腾空的自有厂房（收入计入4Q应收款）；厂房不提折旧、交易不影响利润表
```

核心功能节的生产中心那一行（`:14`）里"（购买分期付款、转产、出售残值规则）"之后补"、厂房购买/租赁/出售"。开发说明节（`:106`）把"74 用例"改为"86+ 用例（`npx vitest run` 实测为准）"。

- [ ] **Step 3: 校验文案与代码一致**

Run: `npx vitest run` 与 `npm run build`
Expected: 全绿。逐条比对 Step 1 的四行文案与实际校验行为、错误提示用词是否一致（尤其"年末""4Q应收款""当年租金"三处）。

- [ ] **Step 4: 提交**

```bash
git add src/components/RulesModal.tsx README.md
git commit -m "docs: 规则弹窗与README补厂房交易说明"
```

---

## 完成标准

- `npx vitest run` 全绿，`tests/factory.test.ts` 覆盖：初始派生、买断/新租门控、现金不足、腾空校验、出售入应收、跨季到账、贴现兼容、快照租金双向（买断仍收/新租次年收）、卖后停租、控制表单元格、v2 存档迁移。
- `npm run build` 通过，Task 6 的 7 条手工冒烟全部实测过（不接受"应该没问题"）。
- 控制表 30 行里只剩 q-9、q-13 两行为禁用说明，且行名写明理由。
- `directions/` 未被改动；未新增依赖。
