import { create } from 'zustand';
import { EnterpriseState, SaveFile, ProductionLine, FinancialLogRecord, Order, LoanRecord, AnnualLedger, SAVE_FORMAT_VERSION } from '../types/enterprise';
import { absQuarter, fromAbsQuarter, emptyLedger, settleDueShortLoans, settleLongLoansAtYearEnd, isValidDiscount, discountSplit, unitCost, depreciationFor, incomeStatement, PRODUCT_BOM, PROCESS_FEE, RENT_BY_TYPE, annualRent } from '../utils/rules';
import { MARKET_DEVELOP_YEARS, ISO_REQUIRED_YEARS, generateYearOrders } from '../config/marketDemand';
import { RESTATED_FULL_NET_FROM_VERSION, kindOfLog, rebuildRestatedChain } from '../utils/restatement';

// 全局状态，用于跟踪重置次数
let resetCount = 0;

// 企业初始状态（严格遵循课程标准，见设计规格第2/3节）：
// 现金20M + 应收15M + 在制品8M + 成品6M + 原料3M = 流动资产52M；
// 土地建筑40M + 机器设备13M = 固定资产53M；总资产105M = 负债41M + 权益64M
const initialState: EnterpriseState = {
  isPaused: false,
  finance: {
    cash: 20, // 现金20M
    loans: [
      // 初始长期贷款40M：3年期、年息10%，第1年年末起付息、第3年年末到期还本
      {
        id: 'loan-init-long',
        kind: 'long',
        principal: 40,
        rate: 0.1,
        drawnAbs: absQuarter(1, 1) - 4, // 开局前放贷
        termQuarters: 12,
      },
    ],
    longTermLoan: {
      amount: 40, // 初始长期贷款40M（聚合展示，与台账联动）
      term: 12, // 3年 = 12季度
      interestRate: 0.1, // 10%
      maxAmount: 40, // 最多40M
      minAmount: 20, // 每次20M
    },
    shortTermLoan: {
      amount: 0, // 初始短期贷款为0
      term: 4, // 1年 = 4季度
      interestRate: 0.05, // 5%
      maxAmount: 40, // 最多40M
      minAmount: 20, // 每次20M
      lendingPeriods: [1, 6], // 1月和6月放贷（对应季度1和季度3）
    },
    accountsReceivable: [0, 0, 0, 15], // 应收账款15M（4Q账期）
    accountsPayable: 0,
    taxesPayable: 1, // 应交税1M（上一年所得税，下年初交纳）
    equity: 50, // 股东资本50M
    retainedProfit: 11, // 利润留存11M
    annualNetProfit: 3, // 上年度净利3M（权益64 = 50 + 11 + 3）
  },
  // 生产线类型余量设置
  productionLineLimits: {
    automatic: 2, // 全自动生产线初始余量
    'semi-automatic': 2, // 半自动生产线初始余量
    manual: 2, // 手工线初始余量
    flexible: 2, // 柔性线初始余量
  },
  production: {
    factories: [
      {
        id: 'factory-1',
        name: '企业1大厂房',
        type: 'large',
        purchasePrice: 40, // 大厂房价值40M
        holding: 'owned',
        leasedThisYear: false,
        capacity: 6, // 大厂房6个生产位
        productionLines: [
          {
            id: 'line-1',
            name: '全自动生产线1',
            type: 'automatic',
            status: 'running',
            product: 'P1',
            purchasePrice: 16, // 全自动生产线原值16M
            installationPeriod: 0, // 已完成安装
            productionPeriod: 1, // 1Q生产周期
            conversionPeriod: 2, // 2Q转产周期
            conversionCost: 4, // 4M转产费用
            maintenanceCost: 1, // 1M/年维护费
            salvageValue: 4, // 出售残值4M
            remainingLife: 15, // 剩余使用年限
            netValue: 7, // 设备净值（与line-2合计13M，与资产负债表一致）
            builtInYear: 0, // 开局既有设备
            inProgressProducts: 2, // P1在制品2个（合计4个/8M）
            installationProgress: 0, // 已完成安装
            conversionProgress: 0, // 未在转产
          },
        ],
      },
      {
        id: 'factory-2',
        name: '企业1小厂房',
        type: 'small',
        purchasePrice: 30, // 小厂房价值30M
        holding: 'leased',
        leasedThisYear: true,
        capacity: 4, // 小厂房4个生产位
        productionLines: [
          {
            id: 'line-2',
            name: '全自动生产线2',
            type: 'automatic',
            status: 'running',
            product: 'P1',
            purchasePrice: 16, // 全自动生产线原值16M
            installationPeriod: 0, // 已完成安装
            productionPeriod: 1, // 1Q生产周期
            conversionPeriod: 2, // 2Q转产周期
            conversionCost: 4, // 4M转产费用
            maintenanceCost: 1, // 1M/年维护费
            salvageValue: 4, // 出售残值4M
            remainingLife: 15, // 剩余使用年限
            netValue: 6, // 设备净值（与line-1合计13M）
            builtInYear: 0, // 开局既有设备
            inProgressProducts: 2, // P1在制品2个（合计4个/8M）
            installationProgress: 0, // 已完成安装
            conversionProgress: 0, // 未在转产
          },
        ],
      },
    ],
    productRD: {
      P1: true, // 已完成研发（已取得P1生产资格）
      P2: {
        completed: false,
        progress: 0, // 0/6
        totalInvestment: 0,
        status: 'idle', // 待启动（6Q分期研发，1M/季）
        paidQuarters: 0,
      },
      P3: {
        completed: false,
        progress: 0,
        totalInvestment: 0,
      },
      P4: {
        completed: false,
        progress: 0,
        totalInvestment: 0,
      },
    },
  },
  logistics: {
    rawMaterials: [
      { type: 'R1', name: '原材料1', quantity: 3, price: 1, leadTime: 1 }, // 3个R1，共3M
      { type: 'R2', name: '原材料2', quantity: 0, price: 1, leadTime: 1 },
      { type: 'R3', name: '原材料3', quantity: 0, price: 1, leadTime: 2 },
      { type: 'R4', name: '原材料4', quantity: 0, price: 1, leadTime: 2 },
    ],
    finishedProducts: [
      { type: 'P1', name: '产品1', quantity: 3, price: 2 }, // 3个P1成品，按成本计6M
      { type: 'P2', name: '产品2', quantity: 0, price: 3 }, // P2成本=R1+R2+1M=3M
      { type: 'P3', name: '产品3', quantity: 0, price: 4 },
      { type: 'P4', name: '产品4', quantity: 0, price: 5 },
    ],
    rawMaterialOrders: [], // 初始无在途原料订单
  },
  marketing: {
    markets: [
      // 年度投资模型：developmentProgress/yearsInvested 以年计
      { type: 'local', name: '本地市场', status: 'available', developmentProgress: 0, yearsInvested: 0, investedThisYear: false, annualMaintenanceCost: 1 }, // 已准入
      { type: 'regional', name: '区域市场', status: 'unavailable', developmentProgress: 0, yearsInvested: 0, investedThisYear: false, annualMaintenanceCost: 1 },
      { type: 'domestic', name: '国内市场', status: 'unavailable', developmentProgress: 0, yearsInvested: 0, investedThisYear: false, annualMaintenanceCost: 1 },
      { type: 'asian', name: '亚洲市场', status: 'unavailable', developmentProgress: 0, yearsInvested: 0, investedThisYear: false, annualMaintenanceCost: 1 },
      { type: 'international', name: '国际市场', status: 'unavailable', developmentProgress: 0, yearsInvested: 0, investedThisYear: false, annualMaintenanceCost: 1 },
    ],
    isoCertifications: [
      { type: 'ISO9000', name: 'ISO9000认证', status: 'uncertified', certificationProgress: 0, yearsInvested: 0, investedThisYear: false, totalCost: 0 },
      { type: 'ISO14000', name: 'ISO14000认证', status: 'uncertified', certificationProgress: 0, yearsInvested: 0, investedThisYear: false, totalCost: 0 },
    ],
    advertisements: [],
    availableOrders: [],
    selectedOrders: [],
  },
  operation: {
    currentYear: 1,
    currentQuarter: 1,
    isGameOver: false,
    operationLogs: [],
    financialLogs: [
      // 初始财务日志
      {
        id: `log-${Date.now()}`,
        year: 1,
        quarter: 1,
        timestamp: Date.now(),
        description: '初始现金',
        cashChange: 20,
        newCash: 20,
        operator: '系统初始化',
        kind: 'flow',
      },
    ],
    annualPlan: {
      marketDevelopment: [],
      productRD: [],
      productionPlan: '',
      marketingPlan: '',
    },
    cashFlowHistory: [
      // 初始现金流量记录
      {
        year: 1,
        quarter: 1,
        cash: 20,
        description: '初始现金',
      },
    ],
    annualLedger: emptyLedger(),
    yearlyLedgers: {},
    yearlyIncomeStatements: {},
  },
};

// 旧版（v1/v2）存档迁移：补齐贷款台账、年度台账、年度化市场/ISO、生产线净值、厂房权属与租赁快照等新字段。
// v1 的原料到货季度为 1~4 循环值（跨年即错），在途订单直接作废并提示。
// fromVersion 是那一帧存档自己声明的格式版本：必填，且缺省/非法一律按最旧的 0 处理——
// 宁可多做一次旧口径换算（换算本身对已与新口径一致的串是幂等的），也不能漏掉需要重建的旧档。
// 导出给 importSaveFiles / applyImportedState 复用（Task 7 决定 #2）：导入侧的迁移与 loadGame 必须走
// 同一条链、同一个 fromVersion 口径，另写一份"导入用的迁移"就是版本漂移的起点。
export const migrateState = (s: EnterpriseState, fromVersion: number | undefined): EnterpriseState => {
  const state: EnterpriseState = JSON.parse(JSON.stringify(s));
  state.isPaused = false;

  if (!state.finance.loans) {
    state.finance.loans = [];
  }
  // 旧版长贷聚合值转为一笔台账（自当前时点起算 3 年期限）
  if (state.finance.longTermLoan?.amount > 0 && !state.finance.loans.some(l => l.kind === 'long')) {
    state.finance.loans.push({
      id: `loan-migrated-long-${Date.now()}`,
      kind: 'long',
      principal: state.finance.longTermLoan.amount,
      rate: state.finance.longTermLoan.interestRate ?? 0.1,
      drawnAbs: absQuarter(state.operation.currentYear, state.operation.currentQuarter),
      termQuarters: 12,
    });
  }
  // 旧版短贷聚合值转为一笔台账（1 年期限）
  if (state.finance.shortTermLoan?.amount > 0 && !state.finance.loans.some(l => l.kind === 'short')) {
    state.finance.loans.push({
      id: `loan-migrated-short-${Date.now()}`,
      kind: 'short',
      principal: state.finance.shortTermLoan.amount,
      rate: state.finance.shortTermLoan.interestRate ?? 0.05,
      drawnAbs: absQuarter(state.operation.currentYear, state.operation.currentQuarter),
      termQuarters: 4,
    });
  }

  // 生产线：净值/建成年份缺省按原值、开局既有处理
  state.production?.factories?.forEach(f => {
    f.productionLines.forEach(line => {
      if (typeof line.netValue !== 'number') line.netValue = line.purchasePrice;
      if (typeof line.builtInYear !== 'number') line.builtInYear = 0;
    });
  });

  // 财务日志 flow/summary（v4）：旧档无 kind，按产生位置特征兜底推断并回填（字段得真的落进存档）。
  // 谓词单点在 utils/restatement.ts 的 kindOfLog——审计器分类、这里回填，两边必须同一条规则：
  // 各写一份的话，任何未经 loadGame 的原始帧（导出包里的 v3 帧）在审计里就与迁移后不是同一个身份。
  state.operation?.financialLogs?.forEach(l => {
    l.kind = kindOfLog(l);
  });

  // v3→v4 的语义变更：v4 起 summary.cashChange 是「自上一条重述串以来的全部净变动」（含玩家主动交易），
  // 而 v3 存档里的旧值只是引擎自动项净额。这里**就地按 newCash 链重建**旧档的每一串，而不是留着不重建：
  // saveGame 与 autoSaveGame 都无条件写 `version: SAVE_FORMAT_VERSION`，若只做文档说明，那么「载入 v3 档 →
  // 继续玩 → 存档」的那一帧就是 v4 标签 + 旧口径串，审计里 §4.4 为 version < 4 准备的降级对它不适用，
  // 于是又要在最常态的路径上假报一次 restated-log。串自带的 newCash 就是各季期末现金，链头取
  // 「初始现金」种子的 cashChange，换算不需要任何额外信息（推导与审计共用 utils/restatement.ts）。
  // 残缺到无法换算的串（如 v1/v2 那种没有 newCash 的）保持原样，由审计的 version < 4 分支兜住。
  if ((fromVersion ?? 0) < RESTATED_FULL_NET_FROM_VERSION && state.operation?.financialLogs) {
    rebuildRestatedChain(state.operation.financialLogs);
  }

  // 厂房权属（v3）：旧档按槽位补齐——大厂房自有、小厂房租赁，租赁快照与权属一致
  state.production?.factories?.forEach(f => {
    if (!f.holding) f.holding = f.id === 'factory-2' ? 'leased' : 'owned';
    if (typeof f.leasedThisYear !== 'boolean') f.leasedThisYear = f.holding === 'leased';
  });

  // 研发 P2 分期字段
  if (state.production?.productRD?.P2 && !state.production.productRD.P2.status) {
    state.production.productRD.P2.status = state.production.productRD.P2.completed ? 'completed' : 'idle';
    state.production.productRD.P2.paidQuarters = state.production.productRD.P2.progress ?? 0;
  }

  // 市场/ISO 年度模型字段
  state.marketing?.markets?.forEach(m => {
    if (typeof m.yearsInvested !== 'number') m.yearsInvested = m.status === 'available' ? 1 : 0;
    m.investedThisYear = false;
  });
  state.marketing?.isoCertifications?.forEach(iso => {
    if (typeof iso.yearsInvested !== 'number') iso.yearsInvested = 0;
    iso.investedThisYear = false;
  });

  // 年度台账
  if (!state.operation.annualLedger) state.operation.annualLedger = emptyLedger();
  if (!state.operation.yearlyLedgers) state.operation.yearlyLedgers = {};
  if (!state.operation.yearlyIncomeStatements) state.operation.yearlyIncomeStatements = {};

  // v1 原料订单的到货季度为 1~4 循环值，无法可靠换算，直接作废
  const hadOrders = (state.logistics?.rawMaterialOrders?.length ?? 0) > 0;
  if (hadOrders) {
    state.logistics.rawMaterialOrders = [];
  }

  return state;
};

// 创建Zustand store
export const useEnterpriseStore = create<{
  state: EnterpriseState;
  saveFiles: SaveFile[];
  resetCount: number;
  // 规则校验错误提示（UI toast 展示，用户可关闭）
  validationError: string | null;
  setValidationError: (message: string | null) => void;
  // 财务操作
  applyLongTermLoan: () => void;
  applyShortTermLoan: () => void;
  discountReceivable: (amount: number) => void;
  payTaxes: () => void;
  // 生产操作
  investProductR_D: (product: 'P2', amount?: number) => void;
  addProductionLine: (factoryId: string, lineType: 'automatic' | 'semi-automatic' | 'manual' | 'flexible', product: 'P1' | 'P2') => void;
  buyFactory: (factoryId: string) => void;
  leaseFactory: (factoryId: string) => void;
  sellFactory: (factoryId: string) => void;
  removeProductionLine: (factoryId: string, lineId: string) => void;
  cancelProduction: (lineId: string) => void;
  startProduction: (lineId: string) => void;
  convertProductionLine: (lineId: string, newProduct: 'P1' | 'P2') => void;
  getProductionLineRemaining: (lineType: 'automatic' | 'semi-automatic' | 'manual' | 'flexible') => number;
  // 物流操作
  placeRawMaterialOrder: (materialType: 'R1' | 'R2' | 'R3' | 'R4', quantity: number) => void;
  cancelRawMaterialOrder: (orderId: string) => void;
  // 营销操作
  placeAdvertisement: (amount: number) => void;
  enterOrderMeeting: () => void;
  togglePaused: () => void;
  selectOrder: (orderId: string) => void;
  deliverOrder: (orderId: string) => void;
  registerOtherCashFlow: (description: string, amount: number) => void;
  addAvailableOrder: (order: Omit<Order, 'id' | 'isSelected' | 'isDelivered'>) => void;
  removeAvailableOrder: (orderId: string) => void;
  moveOrderToSelected: (orderId: string) => void;
  investMarketDevelopment: (marketType: 'local' | 'regional' | 'domestic' | 'asian' | 'international') => void;
  investISOCertification: (isoType: 'ISO9000' | 'ISO14000') => void;
  // 运营操作
  nextQuarter: () => void;
  addOperationLog: (action: string, dataChange: string) => void;
  // 存档系统
  saveGame: () => void;
  autoSaveGame: () => void;
  loadGame: (saveFile: SaveFile) => void;
  resetGame: () => void;
  getSaveFiles: () => SaveFile[];
  // 导入存档包（规格 §4.3）：两个动作各自的落点不同，且**默认不覆盖**——
  // importSaveFiles 只并入存档列表（同 id 冲突改名追加），applyImportedState 只换当前屏（不自动入列表）。
  // 返回 added/renamed 让 UI 说得出"到底动了哪几帧"，而不是含糊的一句"导入成功"。
  importSaveFiles: (saves: SaveFile[]) => { added: number; renamed: number };
  // fromVersion 由调用方给出（整包当前屏用 pkg.app.saveVersion，逐帧用各自的 save.version）：
  // 旧档重述串的口径换算必须知道原版本才决定要不要重建，见 migrateState
  applyImportedState: (state: EnterpriseState, fromVersion: number) => void;
}>((set, get) => ({
  state: initialState,
  saveFiles: [],
  resetCount: resetCount,
  validationError: null,

  setValidationError: (message) => set({ validationError: message }),

  // 暂停/继续运营（教学讲解模式）：暂停期间所有变更类操作被拒绝
  togglePaused: () =>
    set((state) => ({
      state: { ...state.state, isPaused: !state.state.isPaused },
    })),

  // 加载本地存储的存档
  getSaveFiles: () => {
    try {
      const savedFiles = localStorage.getItem('enterpriseSaveFiles');
      return savedFiles ? JSON.parse(savedFiles) : [];
    } catch (error) {
      console.error('Failed to load save files:', error);
      return [];
    }
  },

  // 保存游戏（手动存档）
  saveGame: () => {
    const { state, resetCount } = get();
    const timestamp = Date.now();
    const date = new Date();
    const formattedDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
    
    const saveFile: SaveFile = {
      id: `save-${timestamp}`,
      name: `企业1-${formattedDate}-重置${resetCount}`,
      enterpriseName: '企业1',
      timestamp,
      resetCount,
      version: SAVE_FORMAT_VERSION,
      state: JSON.parse(JSON.stringify(state)),
      createdAt: formattedDate,
    };

    // 加载现有存档
    const saveFiles = get().getSaveFiles();
    // 添加新存档
    const updatedSaveFiles = [saveFile, ...saveFiles];
    // 保存到localStorage
    localStorage.setItem('enterpriseSaveFiles', JSON.stringify(updatedSaveFiles));
    // 更新状态
    set({ saveFiles: updatedSaveFiles });
    // 添加操作日志
    get().addOperationLog('手动存档', `保存当前状态，存档名称：${saveFile.name}`);
  },

  // 自动保存游戏（每季度调用）
  autoSaveGame: () => {
    const { state, resetCount } = get();
    const timestamp = Date.now();
    const date = new Date();
    const formattedDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
    
    const saveFile: SaveFile = {
      id: `save-auto-${timestamp}`,
      name: `企业1-${formattedDate}-重置${resetCount}`,
      enterpriseName: '企业1',
      timestamp,
      resetCount,
      version: SAVE_FORMAT_VERSION,
      state: JSON.parse(JSON.stringify(state)),
      createdAt: formattedDate,
    };
    
    // 加载现有存档
    const saveFiles = get().getSaveFiles();
    // 添加新存档
    const updatedSaveFiles = [saveFile, ...saveFiles];
    // 保存到localStorage
    localStorage.setItem('enterpriseSaveFiles', JSON.stringify(updatedSaveFiles));
    // 更新状态
    set({ saveFiles: updatedSaveFiles });
    // 添加操作日志
    get().addOperationLog('自动存档', `季度结束自动保存，存档名称：${saveFile.name}`);
  },

  // 加载游戏
  loadGame: (saveFile: SaveFile) => {
    const raw = JSON.parse(JSON.stringify(saveFile.state)) as EnterpriseState;
    const migrated = migrateState(raw, saveFile.version);
    set({
      state: migrated,
      resetCount: saveFile.resetCount
    });
    // 添加操作日志
    get().addOperationLog('加载存档', saveFile.version >= SAVE_FORMAT_VERSION
      ? `加载存档：${saveFile.name}`
      : `加载存档：${saveFile.name}（旧版存档已迁移至v4，建议重置开新局）`);
  },

  // 导入：把包里的历史帧并入存档列表（规格 §4.3「仅加入存档列表」，当前屏不变）。
  // 只读动作（文件选择、预览）在暂停态照常可用，唯独这一处落库要过暂停门（§7.10 定死的取舍）。
  importSaveFiles: (saves) => {
    if (get().state.isPaused) {
      set({ validationError: '运营已暂停，请先继续运营再导入' });
      return { added: 0, renamed: 0 };
    }
    const existing = get().getSaveFiles();
    // 冲突判定按**合并后**的 id 集合走，而不是逐个 vs 原列表：一批里也可能带进两份同 id 的帧，
    // 只在 taken 里放原列表会让第二条覆盖第一条——"默认不覆盖"就在这一步破功。
    // 包内帧 id 不会重复（parseSavePackage 的 seenFrameIds 会先拒掉，规格 §4.3），这里兜的是
    // 调用方绕过解析器直接传数组的情形，不是把那条校验再实现一遍。
    const taken = new Set(existing.map((f) => f.id));
    let renamed = 0;
    const toAdd = saves.map((save) => {
      // 每帧按**自己**的 version 迁移：整包只有一个 app.saveVersion，而包里混装的旧帧各自不同
      // （Task 7 决定 #1）。深拷贝在 migrateState 内部（JSON 往返），落库的字节与内存对象同源。
      if (!taken.has(save.id)) {
        taken.add(save.id);
        return { ...save, state: migrateState(save.state, save.version) };
      }
      // 同 id 不替换、改名追加（规格 §4.3）：取首个空闲的 -imported-N，原有那一帧一个字节都不动
      let n = 1;
      while (taken.has(`${save.id}-imported-${n}`)) n++;
      const id = `${save.id}-imported-${n}`;
      taken.add(id);
      renamed++;
      return { ...save, id, state: migrateState(save.state, save.version) };
    });
    const merged = [...toAdd, ...existing];
    localStorage.setItem('enterpriseSaveFiles', JSON.stringify(merged));
    set({ saveFiles: merged });
    get().addOperationLog('导入存档', `新增 ${toAdd.length} 份（其中改名追加 ${renamed} 份），未覆盖任何原有存档`);
    return { added: toAdd.length, renamed };
  },

  // 导入：只把包内 current 换成当前屏，**不**自动并入列表（玩家自己决定要不要再手动存档，规格 §4.3）
  applyImportedState: (imported, fromVersion) => {
    if (get().state.isPaused) {
      set({ validationError: '运营已暂停，请先继续运营再导入' });
      return;
    }
    set({ state: migrateState(imported, fromVersion) });
    get().addOperationLog('导入存档', `设为当前进度：第${imported.operation.currentYear}年第${imported.operation.currentQuarter}季`
      + (fromVersion >= SAVE_FORMAT_VERSION ? '' : '（旧版存档已迁移至v4，建议重置开新局）'));
  },

  // 重置游戏
  resetGame: () => {
    // 增加重置次数
    resetCount++;
    // 重置状态
    set({ 
      state: JSON.parse(JSON.stringify(initialState)),
      resetCount: resetCount
    });
    // 添加操作日志
    get().addOperationLog('重置游戏', `游戏重置，当前重置次数：${resetCount}`);
  },

  // 财务操作

  // 申请长期贷款（年末第4季度，每次20M，未还本余额上限40M，3年期年息10%）
  applyLongTermLoan: () =>
    set((state) => {
      if (state.state.isPaused) {
        return { validationError: '运营已暂停（教学讲解模式），请先继续运营' };
      }
      const { finance, operation } = state.state;
      if (operation.currentQuarter !== 4) {
        return { validationError: '长期贷款只能在年末（第4季度）申请' };
      }
      const longOutstanding = finance.loans.filter(l => l.kind === 'long').reduce((s, l) => s + l.principal, 0);
      if (longOutstanding + 20 > finance.longTermLoan.maxAmount) {
        return { validationError: '长期贷款未还本余额已达上限40M' };
      }

      const loanAmount = 20;
      const newLoan: LoanRecord = {
        id: `loan-long-${Date.now()}`,
        kind: 'long',
        principal: loanAmount,
        rate: 0.1,
        drawnAbs: absQuarter(operation.currentYear, operation.currentQuarter),
        termQuarters: 12, // 3年
      };
      const newCash = finance.cash + loanAmount;

      // 记录财务日志（运行控制表：年末-1）
      const financialLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}`,
        year: operation.currentYear,
        quarter: operation.currentQuarter,
        timestamp: Date.now(),
        description: `+20M(申请长期贷款，3年期年息10%)`,
        cashChange: loanAmount,
        newCash,
        operator: '企业1管理者',
        stepId: 'e-1',
        kind: 'flow',
      };

      return {
        validationError: null,
        state: {
          ...state.state,
          finance: {
            ...finance,
            loans: [...finance.loans, newLoan],
            longTermLoan: {
              ...finance.longTermLoan,
              amount: longOutstanding + loanAmount,
            },
            cash: newCash,
          },
          operation: {
            ...operation,
            financialLogs: [financialLog, ...operation.financialLogs],
          },
        },
      };
    }),

  // 申请短期贷款（每季度初第1/3季度，每次20M，未还本余额上限40M，1年期年息5%）
  applyShortTermLoan: () =>
    set((state) => {
      if (state.state.isPaused) {
        return { validationError: '运营已暂停（教学讲解模式），请先继续运营' };
      }
      const { finance, operation } = state.state;
      if (![1, 3].includes(operation.currentQuarter)) {
        return { validationError: '短期贷款只在第1季度初（1月）和第3季度初（6月）放贷' };
      }
      const shortOutstanding = finance.loans.filter(l => l.kind === 'short').reduce((s, l) => s + l.principal, 0);
      if (shortOutstanding + 20 > finance.shortTermLoan.maxAmount) {
        return { validationError: '短期贷款未还本余额已达上限40M' };
      }

      const loanAmount = 20;
      const newLoan: LoanRecord = {
        id: `loan-short-${Date.now()}`,
        kind: 'short',
        principal: loanAmount,
        rate: 0.05,
        drawnAbs: absQuarter(operation.currentYear, operation.currentQuarter),
        termQuarters: 4, // 1年
      };
      const newCash = finance.cash + loanAmount;

      // 记录财务日志（运行控制表：季度-3 申请短期贷款）
      const financialLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}`,
        year: operation.currentYear,
        quarter: operation.currentQuarter,
        timestamp: Date.now(),
        description: `+20M(申请短期贷款，1年期年息5%)`,
        cashChange: loanAmount,
        newCash,
        operator: '企业1管理者',
        stepId: 'q-3',
        kind: 'flow',
      };

      return {
        validationError: null,
        state: {
          ...state.state,
          finance: {
            ...finance,
            loans: [...finance.loans, newLoan],
            shortTermLoan: {
              ...finance.shortTermLoan,
              amount: shortOutstanding + loanAmount,
            },
            cash: newCash,
          },
          operation: {
            ...operation,
            financialLogs: [financialLog, ...operation.financialLogs],
          },
        },
      };
    }),

  // 资金贴现：应收账款随时可贴现，金额为7的倍数，每7M付1M贴息（到账6M）
  discountReceivable: (amount) =>
    set((state) => {
      if (state.state.isPaused) {
        return { validationError: '运营已暂停（教学讲解模式），请先继续运营' };
      }
      const { finance, operation } = state.state;
      const totalReceivable = finance.accountsReceivable.reduce((s, v) => s + v, 0);
      if (!isValidDiscount(amount, totalReceivable)) {
        return { validationError: `贴现金额须为7的倍数且不超过应收账款余额（当前${totalReceivable}M）` };
      }
      const { fee, cash: gain } = discountSplit(amount);
      // 从最早账期开始扣减应收款
      let remaining = amount;
      const newAR = [...finance.accountsReceivable] as [number, number, number, number];
      for (let i = 0; i < 4 && remaining > 0; i++) {
        const deduct = Math.min(newAR[i], remaining);
        newAR[i] -= deduct;
        remaining -= deduct;
      }
      const newCash = finance.cash + gain;

      // 记录财务日志（运行控制表：季度-11 更新应收账款/应收账款收现）
      const financialLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-discount`,
        year: operation.currentYear,
        quarter: operation.currentQuarter,
        timestamp: Date.now(),
        description: `贴现应收账款${amount}M：+${gain}M(贴息-${fee}M)`,
        cashChange: gain,
        newCash,
        operator: '企业1管理者',
        stepId: 'q-11',
        kind: 'flow',
      };

      return {
        validationError: null,
        state: {
          ...state.state,
          finance: {
            ...finance,
            accountsReceivable: newAR,
            cash: newCash,
          },
          operation: {
            ...operation,
            financialLogs: [financialLog, ...operation.financialLogs],
          },
        },
      };
    }),

  // 支付应付税（年初第1季度，交纳上年度所得税）
  payTaxes: () =>
    set((state) => {
      if (state.state.isPaused) {
        return { validationError: '运营已暂停（教学讲解模式），请先继续运营' };
      }
      const { finance, operation } = state.state;
      if (operation.currentQuarter !== 1) {
        return { validationError: '应付税金在年初（第1季度）交纳' };
      }
      if (finance.taxesPayable <= 0) {
        return { validationError: '当前无应付税金' };
      }
      if (finance.cash < finance.taxesPayable) {
        return { validationError: `现金不足以支付应付税金${finance.taxesPayable}M，请先贴现或贷款` };
      }
      const amount = finance.taxesPayable;
      const newCash = finance.cash - amount;

      // 记录财务日志（运行控制表：年初-4 支付应付税）
      const financialLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-tax`,
        year: operation.currentYear,
        quarter: operation.currentQuarter,
        timestamp: Date.now(),
        description: `支付应付税：-所得税${amount}M`,
        cashChange: -amount,
        newCash,
        operator: '企业1管理者',
        stepId: 'b-4',
        kind: 'flow',
      };

      return {
        validationError: null,
        state: {
          ...state.state,
          finance: {
            ...finance,
            cash: newCash,
            taxesPayable: 0,
          },
          operation: {
            ...operation,
            financialLogs: [financialLog, ...operation.financialLogs],
          },
        },
      };
    }),
  
  // 生产操作
  // 启动 P2 产品研发（6Q 分期：启动付首期1M，此后每季度自动续投1M，现金不足自动中断）
  investProductR_D: (product, amount) =>
    set((state) => {
      if (state.state.isPaused) {
        return { validationError: '运营已暂停（教学讲解模式），请先继续运营' };
      }
      if (product !== 'P2') {
        return { validationError: '本期运营仅开放 P2 产品研发' };
      }
      const p2 = state.state.production.productRD.P2;
      if (p2.status === 'active') {
        return { validationError: 'P2 研发已在进行中' };
      }
      if (p2.completed) {
        return { validationError: 'P2 研发已完成，已取得生产资格' };
      }
      const installment = amount && amount > 0 ? Math.min(amount, 6 - p2.paidQuarters) : 1;
      if (state.state.finance.cash < installment) {
        return { validationError: `现金不足：研发启动需支付 ${installment}M` };
      }
      const newCash = state.state.finance.cash - installment;
      const newPaid = p2.paidQuarters + installment;
      const completed = newPaid >= 6;

      const operationLog = {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleString(),
        operator: '企业1管理者',
        action: '产品研发投资',
        dataChange: `P2研发${p2.status === 'idle' ? '启动' : '续投'}：支付${installment}M（累计${newPaid}/6季）`,
      };

      return {
        validationError: null,
        state: {
          ...state.state,
          production: {
            ...state.state.production,
            productRD: {
              ...state.state.production.productRD,
              P2: {
                ...p2,
                status: completed ? 'completed' : 'active',
                completed: p2.completed || completed,
                progress: Math.min(newPaid, 6),
                paidQuarters: newPaid,
                totalInvestment: p2.totalInvestment + installment,
              },
            },
          },
          finance: {
            ...state.state.finance,
            cash: newCash,
          },
          operation: {
            ...state.state.operation,
            annualLedger: {
              ...state.state.operation.annualLedger,
              rdFee: state.state.operation.annualLedger.rdFee + installment,
            },
            operationLogs: [operationLog, ...state.state.operation.operationLogs],
            financialLogs: [
              {
                id: `finlog-${Date.now()}`,
                year: state.state.operation.currentYear,
                quarter: state.state.operation.currentQuarter,
                timestamp: Date.now(),
                description: `产品研发投资：-${installment}M(P2，累计${newPaid}/6季)`,
                cashChange: -installment,
                newCash,
                operator: '企业1管理者',
                stepId: 'q-15',
                kind: 'flow',
              },
              ...state.state.operation.financialLogs
            ],
          },
        },
      };
    }),


  // 获取生产线剩余数量
  getProductionLineRemaining: (lineType) => {
    // 直接使用get函数获取当前状态，避免循环引用
    const state = get().state;
    // 计算已使用的生产线数量
    const usedCount = state.production.factories.reduce((total, factory) => {
      return total + factory.productionLines.filter(line => line.type === lineType).length;
    }, 0);
    // 返回剩余数量
    return state.productionLineLimits[lineType] - usedCount;
  },

  // 添加生产线
  addProductionLine: (factoryId, lineType, product) =>
    set((state) => {
      if (state.state.isPaused) {
        return { validationError: '运营已暂停（教学讲解模式），请先继续运营' };
      }
      // 找到指定厂房
      const factoryIndex = state.state.production.factories.findIndex(f => f.id === factoryId);
      if (factoryIndex === -1) {
        return state;
      }

      const factory = state.state.production.factories[factoryIndex];
      // 未持有的槽位（出售后保留空位）不可排产
      if (factory.holding === 'none') {
        return { validationError: `${factory.name}未被持有，无法放置生产线` };
      }
      // 检查厂房是否还有容量
      if (factory.productionLines.length >= factory.capacity) {
        return state;
      }

      // 计算已使用的生产线数量
      const usedCount = state.state.production.factories.reduce((total, f) => {
        return total + f.productionLines.filter(line => line.type === lineType).length;
      }, 0);
      
      // 检查生产线余量是否足够
      if (usedCount >= state.state.productionLineLimits[lineType]) {
        return state;
      }

      // 生产线类型配置
      const lineConfig = {
        automatic: {
          name: '全自动生产线',
          purchasePrice: 16,
          installationPeriod: 4,
          productionPeriod: 1,
          conversionPeriod: 2,
          conversionCost: 4,
          salvageValue: 4,
          remainingLife: 15,
        },
        'semi-automatic': {
          name: '半自动生产线',
          purchasePrice: 8,
          installationPeriod: 2,
          productionPeriod: 2,
          conversionPeriod: 1,
          conversionCost: 1,
          salvageValue: 2,
          remainingLife: 12,
        },
        manual: {
          name: '手工生产线',
          purchasePrice: 5,
          installationPeriod: 0,
          productionPeriod: 3,
          conversionPeriod: 0,
          conversionCost: 0,
          salvageValue: 1,
          remainingLife: 10,
        },
        flexible: {
          name: '柔性生产线',
          purchasePrice: 24,
          installationPeriod: 4,
          productionPeriod: 1,
          conversionPeriod: 0,
          conversionCost: 0,
          salvageValue: 6,
          remainingLife: 15,
        },
      };

      const config = lineConfig[lineType];
      
      // 创建新生产线
      const newLine: ProductionLine = {
        id: `line-${Date.now()}`,
        name: `${factory.name}${config.name}${factory.productionLines.length + 1}`,
        type: lineType,
        status: config.installationPeriod > 0 ? 'installing' : 'running',
        product: product,
        purchasePrice: config.purchasePrice,
        installationPeriod: config.installationPeriod,
        productionPeriod: config.productionPeriod,
        conversionPeriod: config.conversionPeriod,
        conversionCost: config.conversionCost,
        maintenanceCost: 1, // 所有生产线维护费都是1M/年
        salvageValue: config.salvageValue,
        remainingLife: config.remainingLife,
        netValue: config.purchasePrice, // 新购设备净值=原值
        builtInYear: state.state.operation.currentYear, // 当年建成（当年不提折旧、免维护费）
        inProgressProducts: config.installationPeriod > 0 ? 0 : 1, // 安装中的生产线没有在制品
        installationProgress: 0,
        conversionProgress: 0,
      };

      // 更新厂房生产线列表
      const newFactories = [...state.state.production.factories];
      newFactories[factoryIndex] = {
        ...factory,
        productionLines: [...factory.productionLines, newLine],
      };

      // 购买生产线：按安装周期平均支付投资（无安装期的整额即付），首期随购买支付
      const installmentCount = Math.max(newLine.installationPeriod, 1);
      const firstPayment = newLine.purchasePrice / installmentCount;
      if (state.state.finance.cash < firstPayment) {
        return { validationError: `现金不足：需支付${config.name}首期投资${firstPayment}M` };
      }
      const purchaseCost = -firstPayment;
      const newCash = state.state.finance.cash + purchaseCost;

      const financialLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}`,
        year: state.state.operation.currentYear,
        quarter: state.state.operation.currentQuarter,
        timestamp: Date.now(),
        description: `-${firstPayment}M(${config.name}投资首期${newLine.installationPeriod > 0 ? `，共${installmentCount}期` : '，一次性付清'})`,
        cashChange: purchaseCost,
        newCash,
        operator: '企业1管理者',
        stepId: 'q-8',
        kind: 'flow',
      };

      const updatedState = {
        ...state.state,
        production: {
          ...state.state.production,
          factories: newFactories,
        },
        finance: {
          ...state.state.finance,
          cash: newCash,
        },
        operation: {
          ...state.state.operation,
          financialLogs: [financialLog, ...state.state.operation.financialLogs],
        },
      };

      // 添加操作日志
      const newLog = {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleString(),
        operator: '企业1管理者',
        action: '添加生产线',
        dataChange: `在${factory.name}添加了${product}产品的${config.name}，总投资${config.purchasePrice}M${newLine.installationPeriod > 0 ? `，按${newLine.installationPeriod}个季度平均支付` : '，一次性付清'}`,
      };

      updatedState.operation.operationLogs = [newLog, ...updatedState.operation.operationLogs];

      return {
        state: updatedState,
      };
    }),

  // 年末（第4季度）买断厂房：权属 leased/none → owned，按原值支付现金，不影响在产线
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
        kind: 'flow',
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

  // 年末（第4季度）新租未持有的厂房槽位：当年不计租，次年租金由年度快照决定
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
        kind: 'flow',
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

  // 出售厂房（任意季度）：腾空后权属转 none，售价计入 4Q 应收账款档，本季度不进现金
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
      // 售价计入 4Q（索引 3）应收款档，随既有应收款一并滚动收现/贴现
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
        kind: 'flow',
      };
      return {
        validationError: null,
        state: {
          ...state.state,
          production: {
            ...production,
            factories: production.factories.map(f =>
              // 只改权属：leasedThisYear 由跨年刷新独占写入，交易 action 一律不覆写（规格 §4.3）
              f.id === factoryId ? { ...f, holding: 'none' as const } : f
            ),
          },
          finance: { ...finance, accountsReceivable: newAR },
          operation: { ...operation, financialLogs: [log, ...operation.financialLogs] },
        },
      };
    }),

  // 取消生产
  cancelProduction: (lineId) =>
    set((state) => {
      if (state.state.isPaused) {
        return { validationError: '运营已暂停（教学讲解模式），请先继续运营' };
      }
      // 找到包含该生产线的厂房
      let updatedFactories = [...state.state.production.factories];
      let lineName = '';
      let productName = '';

      updatedFactories = updatedFactories.map(factory => {
        const updatedLines = factory.productionLines.map(line => {
          if (line.id === lineId) {
            lineName = line.name;
            productName = line.product || '无产品';
            return {
              ...line,
              status: 'idle' as const, // 明确类型化为生产线状态联合类型
              inProgressProducts: 0,
            };
          }
          return line;
        });
        return {
          ...factory,
          productionLines: updatedLines,
        };
      });

      const updatedState = {
        ...state.state,
        production: {
          ...state.state.production,
          factories: updatedFactories,
        },
      };

      // 添加操作日志
      const newLog = {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleString(),
        operator: '企业1管理者',
        action: '取消生产',
        dataChange: `取消了${lineName}的生产，产品：${productName}`,
      };

      updatedState.operation.operationLogs = [newLog, ...updatedState.operation.operationLogs];

      return {
        state: updatedState,
      };
    }),

  // 开始生产：按产品结构投料并支付加工费1M（运行控制表：季度-10）
  startProduction: (lineId) =>
    set((state) => {
      if (state.state.isPaused) {
        return { validationError: '运营已暂停（教学讲解模式），请先继续运营' };
      }
      const target = state.state.production.factories
        .flatMap(f => f.productionLines)
        .find(line => line.id === lineId);
      if (!target) {
        return { validationError: '未找到该生产线' };
      }
      if (!target.product) {
        return { validationError: '该生产线未设置生产产品' };
      }
      if (target.inProgressProducts > 0) {
        return { validationError: `${target.name}已在生产中` };
      }
      const bom = PRODUCT_BOM[target.product];
      const newRawMaterials = [...state.state.logistics.rawMaterials];
      for (const [materialType, requiredQuantity] of Object.entries(bom)) {
        const material = newRawMaterials.find(m => m.type === materialType);
        if (!material || material.quantity < (requiredQuantity ?? 0)) {
          return { validationError: `原材料不足：需要${requiredQuantity}个${materialType}` };
        }
      }
      if (state.state.finance.cash < PROCESS_FEE) {
        return { validationError: `现金不足：开始生产需支付加工费${PROCESS_FEE}M` };
      }

      // 投料：扣减原材料
      for (const [materialType, requiredQuantity] of Object.entries(bom)) {
        const idx = newRawMaterials.findIndex(m => m.type === materialType);
        newRawMaterials[idx] = { ...newRawMaterials[idx], quantity: newRawMaterials[idx].quantity - (requiredQuantity ?? 0) };
      }
      const newCash = state.state.finance.cash - PROCESS_FEE;

      const updatedFactories = state.state.production.factories.map(factory => ({
        ...factory,
        productionLines: factory.productionLines.map(line =>
          line.id === lineId
            ? { ...line, status: 'running' as const, inProgressProducts: 1 }
            : line
        ),
      }));

      // 记录财务日志（运行控制表：季度-10）
      const financialLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-start`,
        year: state.state.operation.currentYear,
        quarter: state.state.operation.currentQuarter,
        timestamp: Date.now(),
        description: `开始下一批生产：-加工费${PROCESS_FEE}M(${target.product},${target.name})`,
        cashChange: -PROCESS_FEE,
        newCash,
        operator: '企业1管理者',
        stepId: 'q-10',
        kind: 'flow',
      };

      const operationLog = {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleString(),
        operator: '企业1管理者',
        action: '开始生产',
        dataChange: `${target.name}开始生产${target.product}，投料${Object.entries(bom).map(([type, qty]) => `${qty}${type}`).join('+')}，支付加工费${PROCESS_FEE}M`,
      };

      return {
        validationError: null,
        state: {
          ...state.state,
          finance: { ...state.state.finance, cash: newCash },
          production: { ...state.state.production, factories: updatedFactories },
          logistics: { ...state.state.logistics, rawMaterials: newRawMaterials },
          operation: {
            ...state.state.operation,
            operationLogs: [operationLog, ...state.state.operation.operationLogs],
            financialLogs: [financialLog, ...state.state.operation.financialLogs],
          },
        },
      };
    }),

  // 生产线转产
  convertProductionLine: (lineId, newProduct: 'P1' | 'P2') =>
    set((state) => {
      if (state.state.isPaused) {
        return { validationError: '运营已暂停（教学讲解模式），请先继续运营' };
      }
      // 找到包含该生产线的厂房
      let updatedFactories = [...state.state.production.factories];
      let lineName = '';
      let oldProduct = '';
      let conversionCost = 0;

      updatedFactories = updatedFactories.map(factory => {
        const updatedLines = factory.productionLines.map(line => {
          if (line.id === lineId && line.status === 'idle') {
            lineName = line.name;
            oldProduct = line.product || '无产品';
            conversionCost = line.conversionCost;
            
            if (line.conversionPeriod > 0) {
              // 需要转产周期，状态变为转产中
              return {
                ...line,
                status: 'converting' as const,
                product: newProduct,
                conversionProgress: 0,
              };
            } else {
              // 不需要转产周期，直接转产完成
              return {
                ...line,
                product: newProduct,
              };
            }
          }
          return line;
        });
        return {
          ...factory,
          productionLines: updatedLines,
        };
      });

      // 扣除转产费用
      const updatedState = {
        ...state.state,
        production: {
          ...state.state.production,
          factories: updatedFactories,
        },
        finance: {
          ...state.state.finance,
          cash: state.state.finance.cash - conversionCost,
        },
      };

      // 添加财务日志（运行控制表：季度-8）
      const financialLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-conversion`,
        year: state.state.operation.currentYear,
        quarter: state.state.operation.currentQuarter,
        timestamp: Date.now(),
        description: `-${conversionCost}M(转产费，${lineName}从${oldProduct}转产到${newProduct})`,
        cashChange: -conversionCost,
        newCash: updatedState.finance.cash,
        operator: '企业1管理者',
        stepId: 'q-8',
        kind: 'flow',
      };

      updatedState.operation.financialLogs = [financialLog, ...updatedState.operation.financialLogs];
      updatedState.operation.annualLedger = {
        ...updatedState.operation.annualLedger,
        conversionFee: updatedState.operation.annualLedger.conversionFee + conversionCost,
      };

      // 添加操作日志
      const newLog = {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleString(),
        operator: '企业1管理者',
        action: '生产线转产',
        dataChange: `将${lineName}从${oldProduct}转产到${newProduct}，花费${conversionCost}M，预计${updatedFactories.flatMap(f => f.productionLines).find(l => l.id === lineId)?.conversionPeriod}季度完成`,
      };

      updatedState.operation.operationLogs = [newLog, ...updatedState.operation.operationLogs];

      return {
        state: updatedState,
      };
    }),

  // 移除生产线
  removeProductionLine: (factoryId, lineId) =>
    set((state) => {
      if (state.state.isPaused) {
        return { validationError: '运营已暂停（教学讲解模式），请先继续运营' };
      }
      // 找到对应的厂房
      const factoryIndex = state.state.production.factories.findIndex(f => f.id === factoryId);
      if (factoryIndex === -1) {
        return state;
      }

      const factory = state.state.production.factories[factoryIndex];
      const lineIndex = factory.productionLines.findIndex(l => l.id === lineId);
      if (lineIndex === -1) {
        return state;
      }

      const line = factory.productionLines[lineIndex];
      const salvageValue = line.salvageValue;

      // 更新生产线列表
      const updatedLines = factory.productionLines.filter(l => l.id !== lineId);
      const updatedFactory = {
        ...factory,
        productionLines: updatedLines,
      };

      // 更新厂房列表
      const updatedFactories = [...state.state.production.factories];
      updatedFactories[factoryIndex] = updatedFactory;

      // 出售规则：净值<残值→净值转现金；净值>残值→残值转现金，差额计入综合费用（其他）
      const netValue = typeof line.netValue === 'number' ? line.netValue : line.purchasePrice;
      const salvageIncome = Math.min(netValue, salvageValue);
      const saleLoss = Math.max(0, netValue - salvageValue);
      const newCash = state.state.finance.cash + salvageIncome;

      const financialLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}`,
        year: state.state.operation.currentYear,
        quarter: state.state.operation.currentQuarter,
        timestamp: Date.now(),
        description: `+${salvageIncome}M(出售${line.name}${saleLoss > 0 ? `，净值差额-${saleLoss}M计入综合费用` : ''})`,
        cashChange: salvageIncome,
        newCash,
        operator: '企业1管理者',
        stepId: 'q-8',
        kind: 'flow',
      };

      const updatedState = {
        ...state.state,
        production: {
          ...state.state.production,
          factories: updatedFactories,
        },
        finance: {
          ...state.state.finance,
          cash: newCash,
        },
        operation: {
          ...state.state.operation,
          financialLogs: [financialLog, ...state.state.operation.financialLogs],
          annualLedger: {
            ...state.state.operation.annualLedger,
            extraExpense: state.state.operation.annualLedger.extraExpense + saleLoss,
          },
        },
      };

      // 添加操作日志
      const newLog = {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleString(),
        operator: '企业1管理者',
        action: '出售生产线',
        dataChange: `从${factory.name}出售了${line.name}，转现金${salvageIncome}M${saleLoss > 0 ? `，净值损失${saleLoss}M计入综合费用` : ''}`,
      };

      updatedState.operation.operationLogs = [newLog, ...updatedState.operation.operationLogs];

      return {
        state: updatedState,
      };
    }),

  // 物流操作
  // 下原料订单（R1/R2提前1季、R3/R4提前2季；到货入库时付款，绝对季度索引跨年不失序）
  placeRawMaterialOrder: (materialType, quantity) =>
    set((state) => {
      if (state.state.isPaused) {
        return { validationError: '运营已暂停（教学讲解模式），请先继续运营' };
      }
      const material = state.state.logistics.rawMaterials.find((m) => m.type === materialType);
      if (!material) return state;
      if (quantity <= 0) {
        return { validationError: '下单数量须大于0' };
      }

      const { year, quarter } = { year: state.state.operation.currentYear, quarter: state.state.operation.currentQuarter };
      const orderAbs = absQuarter(year, quarter);
      const arrivalAbs = orderAbs + material.leadTime;
      const arrival = fromAbsQuarter(arrivalAbs);
      const newOrder = {
        id: `order-${Date.now()}`,
        materialType,
        quantity,
        price: material.price,
        orderPeriod: orderAbs,
        arrivalPeriod: arrivalAbs,
      };

      // 订单总金额（到货入库时付款，此处不计现金变动）
      const totalCost = quantity * material.price;

      // 添加操作日志
      const operationLog = {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleString(),
        operator: '企业1管理者',
        action: '下原材料订单',
        dataChange: `下${materialType}原料订单${quantity}个，预计第${arrival.year}年第${arrival.quarter}季度到货，到货时付款${totalCost}M`,
      };

      // 添加财务日志（运行控制表：季度-6，下单不产生现金变动）
      const financialLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-material-order`,
        year,
        quarter,
        timestamp: Date.now(),
        description: `下原料订单：${quantity}*${materialType}(${totalCost}M，第${arrival.year}年第${arrival.quarter}季到货)`,
        cashChange: 0,
        newCash: state.state.finance.cash,
        operator: '企业1管理者',
        stepId: 'q-6',
        kind: 'flow',
      };

      return {
        validationError: null,
        state: {
          ...state.state,
          logistics: {
            ...state.state.logistics,
            rawMaterialOrders: [...state.state.logistics.rawMaterialOrders, newOrder],
          },
          operation: {
            ...state.state.operation,
            operationLogs: [operationLog, ...state.state.operation.operationLogs],
            financialLogs: [financialLog, ...state.state.operation.financialLogs],
          },
        },
      };
    }),

  // 取消原材料订单（下单未付款，取消无资金变动）
  cancelRawMaterialOrder: (orderId) =>
    set((state) => {
      if (state.state.isPaused) {
        return { validationError: '运营已暂停（教学讲解模式），请先继续运营' };
      }
      // 找到要取消的订单
      const orderToCancel = state.state.logistics.rawMaterialOrders.find(order => order.id === orderId);
      if (!orderToCancel) return state;

      // 过滤掉要取消的订单
      const remainingOrders = state.state.logistics.rawMaterialOrders.filter(order => order.id !== orderId);

      // 添加操作日志
      const operationLog = {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleString(),
        operator: '企业1管理者',
        action: '取消原材料订单',
        dataChange: `取消${orderToCancel.materialType}原料订单${orderToCancel.quantity}个（下单未付款，无资金变动）`,
      };

      // 添加财务日志
      const financialLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-material-cancel`,
        year: state.state.operation.currentYear,
        quarter: state.state.operation.currentQuarter,
        timestamp: Date.now(),
        description: `取消${orderToCancel.materialType}原料订单${orderToCancel.quantity}个`,
        cashChange: 0,
        newCash: state.state.finance.cash,
        operator: '企业1管理者',
        stepId: 'q-6',
        kind: 'flow',
      };

      return {
        state: {
          ...state.state,
          logistics: {
            ...state.state.logistics,
            rawMaterialOrders: remainingOrders,
          },
          operation: {
            ...state.state.operation,
            operationLogs: [operationLog, ...state.state.operation.operationLogs],
            financialLogs: [financialLog, ...state.state.operation.financialLogs],
          },
        },
      };
    }),



  // 营销操作
  // 投放广告（年初第1季度订货会前；修改后规则：一次投放覆盖本地+区域市场、P1+P2产品）
  placeAdvertisement: (amount) =>
    set((state) => {
      if (state.state.isPaused) {
        return { validationError: '运营已暂停（教学讲解模式），请先继续运营' };
      }
      const { finance, operation, marketing } = state.state;
      if (operation.currentQuarter !== 1) {
        return { validationError: '广告投放是年初（第1季度）订货会操作' };
      }
      if (amount <= 0) {
        return { validationError: '广告投放金额须大于0' };
      }
      if (finance.cash < amount) {
        return { validationError: `现金不足：需投放${amount}M` };
      }
      const adId = `ad-${Date.now()}`;
      const newAd = {
        id: adId,
        amount,
        period: operation.currentQuarter,
        markets: ['本地市场', '区域市场'], // 一次性投放覆盖本地和区域市场
        products: ['P1', 'P2'], // 覆盖P1和P2产品
      };

      const newCash = finance.cash - amount;

      // 添加财务日志（运行控制表：季度-17 其他现金收支）
      const financialLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-ad`,
        year: operation.currentYear,
        quarter: operation.currentQuarter,
        timestamp: Date.now(),
        description: `-${amount}M(广告费)`,
        cashChange: -amount,
        newCash,
        operator: '企业1管理者',
        stepId: 'q-17',
        kind: 'flow',
      };

      // 添加操作日志
      const operationLog = {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleString(),
        operator: '企业1管理者',
        action: '投放广告',
        dataChange: `投放广告${amount}M，覆盖本地和区域市场，产品P1和P2（每1M解锁2张可选订单）`,
      };

      return {
        validationError: null,
        state: {
          ...state.state,
          finance: {
            ...finance,
            cash: newCash,
          },
          marketing: {
            ...marketing,
            advertisements: [...marketing.advertisements, newAd],
          },
          operation: {
            ...operation,
            annualLedger: { ...operation.annualLedger, adFee: operation.annualLedger.adFee + amount },
            operationLogs: [operationLog, ...operation.operationLogs],
            financialLogs: [financialLog, ...operation.financialLogs],
          },
        },
      };
    }),

  // 参加订货会（年初第1季度）：按广告投入生成当年可选订单池
  enterOrderMeeting: () =>
    set((state) => {
      if (state.state.isPaused) {
        return { validationError: '运营已暂停（教学讲解模式），请先继续运营' };
      }
      const { operation, marketing } = state.state;
      if (operation.currentQuarter !== 1) {
        return { validationError: '订货会在年初（第1季度）召开' };
      }
      const availableMarkets = marketing.markets
        .filter(m => m.status === 'available')
        .map(m => m.type);
      const qualifiedProducts = ['P1'];
      if (state.state.production.productRD.P2.completed) qualifiedProducts.push('P2');
      const adAmount = marketing.advertisements
        .filter(ad => ad.period === 1)
        .reduce((s, ad) => s + ad.amount, 0);

      const generated = generateYearOrders(
        Math.min(operation.currentYear, 4) as 1 | 2 | 3 | 4,
        availableMarkets,
        qualifiedProducts,
        adAmount,
      );

      const newOrders: Order[] = generated.map((o, i) => ({
        id: `order-${Date.now()}-${i}`,
        productType: o.productType,
        quantity: o.quantity,
        unitPrice: o.unitPrice,
        totalAmount: o.totalAmount,
        paymentPeriod: o.paymentPeriod,
        market: o.market,
        isSelected: false,
        isDelivered: false,
      }));

      const operationLog = {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleString(),
        operator: '企业1管理者',
        action: '参加订货会',
        dataChange: adAmount > 0
          ? `生成${newOrders.length}张可选订单（本年度广告${adAmount}M）`
          : '尚未投放广告，未解锁可选订单（每1M广告解锁2张）',
      };

      // 订货会结果记入财务日志（运行控制表：年初-2，非现金事件）
      const meetingLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-order-meeting`,
        year: operation.currentYear,
        quarter: operation.currentQuarter,
        timestamp: Date.now(),
        description: adAmount > 0
          ? `订货会：生成${newOrders.length}张可选订单（广告${adAmount}M解锁）`
          : '订货会：未投放广告，未解锁可选订单',
        cashChange: 0,
        newCash: state.state.finance.cash,
        operator: '企业1管理者',
        stepId: 'b-2',
        kind: 'flow',
      };

      return {
        validationError: null,
        state: {
          ...state.state,
          marketing: {
            ...marketing,
            availableOrders: newOrders,
          },
          operation: {
            ...operation,
            financialLogs: [meetingLog, ...operation.financialLogs],
            operationLogs: [operationLog, ...operation.operationLogs],
          },
        },
      };
    }),

  // 投资开拓市场
  // 投资市场开拓/维护（年末第4季度，每市场每年1M，可中断；已准入市场每年需投1M维持）
  investMarketDevelopment: (marketType) =>
    set((state) => {
      if (state.state.isPaused) {
        return { validationError: '运营已暂停（教学讲解模式），请先继续运营' };
      }
      const { finance, operation, marketing } = state.state;
      if (operation.currentQuarter !== 4) {
        return { validationError: '市场开拓/维护投资是年末（第4季度）操作' };
      }
      const market = marketing.markets.find(m => m.type === marketType);
      if (!market) {
        return { validationError: '未找到该市场' };
      }
      if (market.investedThisYear) {
        return { validationError: `${market.name}本年度已投资` };
      }
      if (finance.cash < 1) {
        return { validationError: '现金不足：市场投资需1M' };
      }
      const requiredYears = MARKET_DEVELOP_YEARS[marketType];

      const newMarkets = marketing.markets.map((m) => {
        if (m.type !== marketType) return m;
        const yearsInvested = m.yearsInvested + 1;
        const gainedAccess = yearsInvested >= requiredYears;
        return {
          ...m,
          yearsInvested,
          investedThisYear: true,
          developmentProgress: yearsInvested,
          status: m.status === 'available' ? 'available' : gainedAccess ? 'available' as const : 'developing' as const,
        };
      });
      const newCash = finance.cash - 1;
      const marketName = market.name;

      const financialLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-market-invest`,
        year: operation.currentYear,
        quarter: operation.currentQuarter,
        timestamp: Date.now(),
        description: market.status === 'available'
          ? `-1M(${marketName}维护)`
          : `-1M(${marketName}开拓，累计${market.yearsInvested + 1}/${requiredYears}年)`,
        cashChange: -1,
        newCash,
        operator: '企业1管理者',
        stepId: 'e-5',
        kind: 'flow',
      };
      const operationLog = {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleString(),
        operator: '企业1管理者',
        action: '投资市场开发',
        dataChange: market.status === 'available'
          ? `投入1M维持${marketName}市场准入`
          : `投资开拓${marketName}市场1M（累计${market.yearsInvested + 1}/${requiredYears}年）${market.yearsInvested + 1 >= requiredYears ? '，已获得准入' : ''}`,
      };

      return {
        validationError: null,
        state: {
          ...state.state,
          finance: { ...finance, cash: newCash },
          marketing: { ...marketing, markets: newMarkets },
          operation: {
            ...operation,
            annualLedger: { ...operation.annualLedger, marketDevFee: operation.annualLedger.marketDevFee + 1 },
            financialLogs: [financialLog, ...operation.financialLogs],
            operationLogs: [operationLog, ...operation.operationLogs],
          },
        },
      };
    }),

  // 投资ISO认证（年末第4季度，每年各1M：ISO9000≥2年、ISO14000≥3年，可中断）
  investISOCertification: (isoType) =>
    set((state) => {
      if (state.state.isPaused) {
        return { validationError: '运营已暂停（教学讲解模式），请先继续运营' };
      }
      const { finance, operation, marketing } = state.state;
      if (operation.currentQuarter !== 4) {
        return { validationError: 'ISO认证投资是年末（第4季度）操作' };
      }
      const iso = marketing.isoCertifications.find(i => i.type === isoType);
      if (!iso) {
        return { validationError: '未找到该认证' };
      }
      if (iso.status === 'certified') {
        return { validationError: `${isoType}已认证完成` };
      }
      if (iso.investedThisYear) {
        return { validationError: `${isoType}本年度已投资` };
      }
      if (finance.cash < 1) {
        return { validationError: '现金不足：ISO认证投资需1M' };
      }
      const requiredYears = ISO_REQUIRED_YEARS[isoType];

      const newISOCertifications = marketing.isoCertifications.map((i) => {
        if (i.type !== isoType) return i;
        const yearsInvested = i.yearsInvested + 1;
        const certified = yearsInvested >= requiredYears;
        return {
          ...i,
          yearsInvested,
          investedThisYear: true,
          certificationProgress: yearsInvested,
          status: certified ? 'certified' as const : 'certifying' as const,
          totalCost: i.totalCost + 1,
        };
      });
      const newCash = finance.cash - 1;

      const financialLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-iso-invest`,
        year: operation.currentYear,
        quarter: operation.currentQuarter,
        timestamp: Date.now(),
        description: `-1M(${isoType}认证，累计${iso.yearsInvested + 1}/${requiredYears}年)`,
        cashChange: -1,
        newCash,
        operator: '企业1管理者',
        stepId: 'e-5',
        kind: 'flow',
      };
      const operationLog = {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleString(),
        operator: '企业1管理者',
        action: '投资ISO认证',
        dataChange: `投资${isoType}认证1M（累计${iso.yearsInvested + 1}/${requiredYears}年）${iso.yearsInvested + 1 >= requiredYears ? '，已获得资格证' : ''}`,
      };

      return {
        validationError: null,
        state: {
          ...state.state,
          finance: { ...finance, cash: newCash },
          marketing: { ...marketing, isoCertifications: newISOCertifications },
          operation: {
            ...operation,
            annualLedger: { ...operation.annualLedger, isoFee: operation.annualLedger.isoFee + 1 },
            financialLogs: [financialLog, ...operation.financialLogs],
            operationLogs: [operationLog, ...operation.operationLogs],
          },
        },
      };
    }),

  // 新增可选订单
  addAvailableOrder: (order) =>
    set((state) => {
      if (state.state.isPaused) {
        return { validationError: '运营已暂停（教学讲解模式），请先继续运营' };
      }
      // 创建新订单，添加id和默认状态
      const newOrder = {
        id: `order-${Date.now()}`,
        ...order,
        totalAmount: order.quantity * order.unitPrice,
        isSelected: false,
        isDelivered: false,
      };
      
      return {
        state: {
          ...state.state,
          marketing: {
            ...state.state.marketing,
            availableOrders: [...state.state.marketing.availableOrders, newOrder],
          },
        },
      };
    }),

  // 删除可选订单
  removeAvailableOrder: (orderId) =>
    set((state) => {
      return {
        state: {
          ...state.state,
          marketing: {
            ...state.state.marketing,
            availableOrders: state.state.marketing.availableOrders.filter(order => order.id !== orderId),
          },
        },
      };
    }),

  // 移动订单到已选择订单
  moveOrderToSelected: (orderId) =>
    set((state) => {
      if (state.state.isPaused) {
        return { validationError: '运营已暂停（教学讲解模式），请先继续运营' };
      }
      const newAvailableOrders = state.state.marketing.availableOrders.filter(order => order.id !== orderId);
      const orderToMove = state.state.marketing.availableOrders.find((order) => order.id === orderId);
      
      if (orderToMove) {
        const newSelectedOrder = { ...orderToMove, isSelected: true };
        return {
          state: {
            ...state.state,
            marketing: {
              ...state.state.marketing,
              availableOrders: newAvailableOrders,
              selectedOrders: [...state.state.marketing.selectedOrders, newSelectedOrder],
            },
          },
        };
      }
      
      return state;
    }),

  // 选择订单（从可用列表移入已选列表，不重复）
  selectOrder: (orderId) =>
    set((state) => {
      if (state.state.isPaused) {
        return { validationError: '运营已暂停（教学讲解模式），请先继续运营' };
      }
      const order = state.state.marketing.availableOrders.find((o) => o.id === orderId);
      if (!order) {
        return { validationError: '该订单不在可选列表中' };
      }
      return {
        validationError: null,
        state: {
          ...state.state,
          marketing: {
            ...state.state.marketing,
            availableOrders: state.state.marketing.availableOrders.filter((o) => o.id !== orderId),
            selectedOrders: [...state.state.marketing.selectedOrders, { ...order, isSelected: true }],
          },
        },
      };
    }),

  deliverOrder: (orderId) =>
    set((state) => {
      if (state.state.isPaused) {
        return { validationError: '运营已暂停（教学讲解模式），请先继续运营' };
      }
      const targetOrder = state.state.marketing.selectedOrders.find((order) => order.id === orderId);
      if (!targetOrder || targetOrder.isDelivered) {
        return state;
      }
      const stock = state.state.logistics.finishedProducts.find(p => p.type === targetOrder.productType);
      if (!stock || stock.quantity < targetOrder.quantity) {
        return { validationError: `成品库存不足：${targetOrder.productType} 需 ${targetOrder.quantity} 个` };
      }

      const newSelectedOrders = state.state.marketing.selectedOrders.map((order) =>
        order.id === orderId ? { ...order, isDelivered: true } : order
      );

      // 更新成品库存
      const newFinishedProducts = state.state.logistics.finishedProducts.map((product) =>
        product.type === targetOrder.productType
          ? { ...product, quantity: product.quantity - targetOrder.quantity }
          : product
      );

      // 更新应收账款
      const newAR = [...state.state.finance.accountsReceivable] as [number, number, number, number];
      newAR[targetOrder.paymentPeriod - 1] += targetOrder.totalAmount;

      // 年度台账：销售收入 + 直接成本（按成本结转）
      const cost = unitCost(targetOrder.productType) * targetOrder.quantity;
      const newLedger: AnnualLedger = {
        ...state.state.operation.annualLedger,
        salesRevenue: state.state.operation.annualLedger.salesRevenue + targetOrder.totalAmount,
        directCosts: state.state.operation.annualLedger.directCosts + cost,
      };

      // 记录交货日志（运行控制表：季度-14，非现金）
      const deliveryLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-deliver`,
        year: state.state.operation.currentYear,
        quarter: state.state.operation.currentQuarter,
        timestamp: Date.now(),
        description: `按订单交货：${targetOrder.quantity}*${targetOrder.productType}(订单总额${targetOrder.totalAmount}M，账期${targetOrder.paymentPeriod}Q)`,
        cashChange: 0,
        newCash: state.state.finance.cash,
        operator: '企业1管理者',
        stepId: 'q-14',
        kind: 'flow',
      };

      return {
        validationError: null,
        state: {
          ...state.state,
          marketing: {
            ...state.state.marketing,
            selectedOrders: newSelectedOrders,
          },
          logistics: {
            ...state.state.logistics,
            finishedProducts: newFinishedProducts,
          },
          finance: {
            ...state.state.finance,
            accountsReceivable: newAR,
          },
          operation: {
            ...state.state.operation,
            annualLedger: newLedger,
            financialLogs: [deliveryLog, ...state.state.operation.financialLogs],
          },
        },
      };
    }),

  // 其他现金收支情况登记（运行控制表：季度-17）：支出计入综合费用-其他，收入冲减额外收支
  registerOtherCashFlow: (description, amount) =>
    set((state) => {
      if (state.state.isPaused) {
        return { validationError: '运营已暂停（教学讲解模式），请先继续运营' };
      }
      const trimmed = description.trim();
      if (!trimmed) {
        return { validationError: '请填写收支说明' };
      }
      if (!Number.isFinite(amount) || amount === 0) {
        return { validationError: '收支金额不能为0（支出填负数，收入填正数）' };
      }
      const newCash = state.state.finance.cash + amount;
      if (newCash < 0) {
        return { validationError: `现金不足：登记支出${-amount}M后现金将为${newCash}M` };
      }
      const financialLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-other`,
        year: state.state.operation.currentYear,
        quarter: state.state.operation.currentQuarter,
        timestamp: Date.now(),
        description: `${amount > 0 ? '+' : '-'}${Math.abs(amount)}M(${trimmed})`,
        cashChange: amount,
        newCash,
        operator: '企业1管理者',
        stepId: 'q-17',
        kind: 'flow',
      };
      const annualLedger: AnnualLedger = amount < 0
        ? { ...state.state.operation.annualLedger, otherFee: state.state.operation.annualLedger.otherFee + (-amount) }
        : { ...state.state.operation.annualLedger, extraExpense: state.state.operation.annualLedger.extraExpense - amount };
      return {
        validationError: null,
        state: {
          ...state.state,
          finance: {
            ...state.state.finance,
            cash: newCash,
          },
          operation: {
            ...state.state.operation,
            annualLedger,
            financialLogs: [financialLog, ...state.state.operation.financialLogs],
          },
        },
      };
    }),

  // 运营操作
  nextQuarter: () =>
    set((state) => {
      if (state.state.isPaused) {
        return { validationError: '运营已暂停（教学讲解模式），请先继续运营' };
      }
      const newQuarter = state.state.operation.currentQuarter === 4 ? 1 : state.state.operation.currentQuarter + 1;
      const newYear = state.state.operation.currentQuarter === 4 ? state.state.operation.currentYear + 1 : state.state.operation.currentYear;
      const newAbsQuarter = absQuarter(newYear, newQuarter);

      // 季度初日志记录 - 季初现金盘点的初始数据
      const initialCash = state.state.finance.cash;

      // 上一条重述串的期末现金：时间序上最近的一条 summary 的 newCash；
      // 若整串还没有 summary（首次推进），回退到「初始现金」种子那条 flow 的 cashChange（开局 20M）；
      // 连种子都被截断时只能退回本季期初现金（这种帧在 §4.4 里本来就只能报 no-anchor）。
      // 仅作局部变量供下方 quarterEndLog 的重述口径使用：不新增状态字段、不进存档格式。
      const priorLogs = state.state.operation.financialLogs;
      const latestRestated = priorLogs
        .filter(l => l.kind === 'summary')
        .reduce((t, l) => (!t || l.timestamp > t.timestamp ? l : t), undefined as FinancialLogRecord | undefined);
      const seedCash = priorLogs
        .filter(l => l.kind === 'flow' && l.description === '初始现金')
        .reduce((t, l) => t + l.cashChange, 0);
      // 链头必须真是数字才敢用：v1/v2 旧档经 migrateState 只补 kind、不回填 newCash（字段缺省即 undefined），
      // 直接相减会得到 finalCash - undefined = NaN，并把 NaN 写进 quarterEndLog.cashChange 落进存档。
      // 非有限值一律退回上面那条种子链头（与整串还没有 summary 时同一条回退路径）。
      const previousRestatedCash = latestRestated && Number.isFinite(latestRestated.newCash)
        ? latestRestated.newCash
        : (seedCash || initialCash);

      // 2. 更新短贷/还本付息：到期短贷一次还本付息（运行控制表：季度-2）
      const shortSettlement = settleDueShortLoans(state.state.finance.loans, newAbsQuarter);
      if (shortSettlement.due > initialCash) {
        return { validationError: `现金不足以偿还到期短贷本息 ${shortSettlement.due}M，请先贴现应收账款` };
      }
      const shortSettlementLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-short-settle`,
        year: newYear,
        quarter: newQuarter,
        timestamp: Date.now(),
        description: shortSettlement.due > 0
          ? `更新短贷/还本付息：-本息${shortSettlement.due}M`
          : '更新短贷：无到期短贷',
        cashChange: -shortSettlement.due,
        newCash: initialCash - shortSettlement.due,
        operator: '系统自动',
        stepId: 'q-2',
        kind: 'flow',
      };

      // 应收账款滚动
      const newAR = [
        state.state.finance.accountsReceivable[1],
        state.state.finance.accountsReceivable[2],
        state.state.finance.accountsReceivable[3],
        0,
      ] as [number, number, number, number];

      // 增加现金（到期的应收账款）
      const cashIncrease = state.state.finance.accountsReceivable[0];

      // 3. 更新应付账款/归还应付账款：原料入库时挂账的应付款于下季初全额归还（账期1季，运行控制表：季度-4）
      const apPayment = state.state.finance.accountsPayable;
      if (apPayment > initialCash - shortSettlement.due + cashIncrease) {
        return { validationError: `现金不足以归还到期应付账款 ${apPayment}M，请先贴现应收账款或申请短期贷款` };
      }
      const apLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-ap`,
        year: newYear,
        quarter: newQuarter,
        timestamp: Date.now(),
        description: apPayment > 0
          ? `归还应付账款：-应付款${apPayment}M`
          : '更新应付账款：无到期应付款',
        cashChange: apPayment > 0 ? -apPayment : 0,
        newCash: initialCash - shortSettlement.due - apPayment,
        operator: '系统自动',
        stepId: 'q-4',
        kind: 'flow',
      };
      // 本季度研发投资额（研发处理位于生产段之后，此处提前声明）
      let rdInvestment = 0;

      // 4. 更新应收账款/应收款收现日志
      const arLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-ar`,
        year: newYear,
        quarter: newQuarter,
        timestamp: Date.now(),
        description: `更新应收账款/应收款收现，收现金额：${cashIncrease}M`,
        cashChange: cashIncrease,
        newCash: initialCash - shortSettlement.due - apPayment + cashIncrease,
        operator: '系统自动',
        stepId: 'q-11',
        kind: 'flow',
      };

      // 6. 处理原材料订单到货（绝对季度索引匹配；入库时付款，现金不足计入应付款）
      let newRawMaterials = [...state.state.logistics.rawMaterials];
      let materialPayment = 0;
      let payableIncrease = 0;
      const arrivedDescriptions: string[] = [];
      const remainingOrders = state.state.logistics.rawMaterialOrders.filter(order => {
        if (order.arrivalPeriod === newAbsQuarter) {
          // 订单到货，更新原材料库存
          const materialIndex = newRawMaterials.findIndex(m => m.type === order.materialType);
          if (materialIndex !== -1) {
            newRawMaterials[materialIndex] = {
              ...newRawMaterials[materialIndex],
              quantity: newRawMaterials[materialIndex].quantity + order.quantity,
            };
          }
          const cost = order.quantity * order.price;
          const cashBeforeMaterial = initialCash - shortSettlement.due - apPayment + cashIncrease - materialPayment;
          const fromCash = Math.min(cost, Math.max(0, cashBeforeMaterial));
          materialPayment += fromCash;
          const toPayable = cost - fromCash;
          payableIncrease += toPayable;
          arrivedDescriptions.push(`${order.quantity}*${order.materialType}(${cost}M${toPayable > 0 ? `，其中${toPayable}M计入应付款` : ''})`);
          return false; // 订单已完成，从列表中移除
        }
        return true; // 订单未完成，保留在列表中
      });

      // 原材料入库日志（运行控制表：季度-5）
      const materialArrivalLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-material`,
        year: newYear,
        quarter: newQuarter,
        timestamp: Date.now(),
        description: arrivedDescriptions.length > 0
          ? `原材料入库：${arrivedDescriptions.join('，')}`
          : '原材料入库/更新原料订单：无到货',
        cashChange: -materialPayment,
        newCash: initialCash - shortSettlement.due - apPayment + cashIncrease - materialPayment,
        operator: '系统自动',
        stepId: 'q-5',
        kind: 'flow',
      };
      
      // 生成季初现金盘点日志（原料取到货后库存，成品用季初库存）
      const quarterStartCash = initialCash + cashIncrease - rdInvestment;
      const quarterStartLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-start`,
        year: newYear,
        quarter: newQuarter,
        timestamp: Date.now(),
        description: `(${quarterStartCash}M，${newRawMaterials.map(m => `${m.quantity}${m.type}`).join('+') || '0'}，${state.state.logistics.finishedProducts.map(p => `${p.quantity}${p.type}`).join('+') || '0'})`,
        cashChange: 0,
        newCash: quarterStartCash,
        operator: '系统自动',
        stepId: 'q-1',
        kind: 'flow',
      };
      
      // 7. 处理生产线状态变化（安装、转产、生产）
      const newFactories = [...state.state.production.factories];
      const newFinishedProducts = [...state.state.logistics.finishedProducts];
      const newOperationLogs = [...state.state.operation.operationLogs];
      
      let totalProduced = 0;
      // 自动开工的加工费合计（现金支出，运行控制表：季度-10）
      let autoProcessFees = 0;
      // 本季度安装投资分期付款合计（运行控制表：季度-8）
      let totalInstallPayments = 0;
      const installPaymentLogs: FinancialLogRecord[] = [];
      let installPaymentFailed: string | null = null;
      const startProductionLogs: FinancialLogRecord[] = [];
      // 用于记录因原材料不足而停产的生产线
      const stoppedLines: {lineName: string, product: string, requiredMaterials: string[]}[] = [];

      // 投料辅助：检查 BOM 原料是否充足 / 扣减原料（开工时投料并付加工费1M）
      const bomSufficient = (product: Exclude<ProductionLine['product'], null>) => {
        const bom = PRODUCT_BOM[product];
        return Object.entries(bom).every(([materialType, requiredQuantity]) => {
          const material = newRawMaterials.find(m => m.type === materialType);
          return material && material.quantity >= (requiredQuantity ?? 0);
        });
      };
      const deductBom = (product: Exclude<ProductionLine['product'], null>) => {
        const bom = PRODUCT_BOM[product];
        for (const [materialType, requiredQuantity] of Object.entries(bom)) {
          const idx = newRawMaterials.findIndex(m => m.type === materialType);
          newRawMaterials[idx] = { ...newRawMaterials[idx], quantity: newRawMaterials[idx].quantity - (requiredQuantity ?? 0) };
        }
      };
      const startLineProduction = (line: ProductionLine, source: 'auto' | 'resume') => {
        if (!line.product || !bomSufficient(line.product)) return false;
        if (state.state.finance.cash - shortSettlement.due - apPayment + cashIncrease - rdInvestment - autoProcessFees - PROCESS_FEE < 0) return false;
        deductBom(line.product);
        autoProcessFees += PROCESS_FEE;
        startProductionLogs.push({
          id: `finlog-${Date.now()}-start-${Math.random().toString(36).slice(2, 7)}`,
          year: newYear,
          quarter: newQuarter,
          timestamp: Date.now(),
          description: `开始下一批生产：-加工费${PROCESS_FEE}M(${line.product},${line.name})`,
          cashChange: -PROCESS_FEE,
          newCash: 0,
          operator: source === 'auto' ? '系统自动' : '系统自动',
          stepId: 'q-10',
          kind: 'flow',
        });
        return true;
      };

      // 8. 原材料到货后，恢复停产的生产线（重新投料并支付加工费）
      newFactories.forEach((factory, factoryIndex) => {
        factory.productionLines.forEach((line, lineIndex) => {
          if (line.status === 'stopped' && line.product && startLineProduction(line, 'resume')) {
            newFactories[factoryIndex].productionLines[lineIndex] = {
              ...line,
              status: 'running',
              inProgressProducts: 1,
            };
            const resumeLog = {
              id: `log-${Date.now()}-resume-${Math.random().toString(36).substr(2, 9)}`,
              time: new Date().toLocaleString(),
              operator: '系统自动',
              action: '生产线恢复生产',
              dataChange: `生产线${line.name}原料与资金充足，重新投料恢复生产${line.product}`,
            };
            newOperationLogs.unshift(resumeLog);
          }
        });
      });

      newFactories.forEach((factory, factoryIndex) => {
        factory.productionLines.forEach((line, lineIndex) => {
          // 处理安装中的生产线（按安装周期平均支付投资；安装完成的下一季度才开工）
          if (line.status === 'installing') {
            const installment = line.purchasePrice / Math.max(line.installationPeriod, 1);
            const cashBeforeInstall = initialCash - shortSettlement.due - apPayment + cashIncrease - materialPayment - totalInstallPayments;
            if (cashBeforeInstall < installment) {
              installPaymentFailed = `现金不足以支付${line.name}安装投资分期${installment}M，请先贴现或贷款`;
              return;
            }
            totalInstallPayments += installment;
            installPaymentLogs.push({
              id: `finlog-${Date.now()}-install-${Math.random().toString(36).slice(2, 7)}`,
              year: newYear,
              quarter: newQuarter,
              timestamp: Date.now(),
              description: `-${installment}M(${line.name}安装投资分期)`,
              cashChange: -installment,
              newCash: 0,
              operator: '系统自动',
              stepId: 'q-8',
              kind: 'flow',
            });
            const newInstallationProgress = line.installationProgress + 1;
            if (newInstallationProgress >= line.installationPeriod) {
              newFactories[factoryIndex].productionLines[lineIndex] = {
                ...line,
                status: 'running',
                installationProgress: newInstallationProgress,
                builtInYear: newYear, // 安装完成当年建成（当年不提折旧、免维护费）
                inProgressProducts: 0, // 待下一季度投料开工
              };
            } else {
              newFactories[factoryIndex].productionLines[lineIndex] = {
                ...line,
                installationProgress: newInstallationProgress,
              };
            }
          }
          // 处理转产中的生产线（转产完成后的下一季度才能生产新产品）
          else if (line.status === 'converting') {
            const newConversionProgress = line.conversionProgress + 1;
            if (newConversionProgress >= line.conversionPeriod) {
              newFactories[factoryIndex].productionLines[lineIndex] = {
                ...line,
                status: 'running',
                conversionProgress: newConversionProgress,
                inProgressProducts: 0, // 待下一季度投料开工
              };
            } else {
              newFactories[factoryIndex].productionLines[lineIndex] = {
                ...line,
                conversionProgress: newConversionProgress,
              };
            }
          }
          // 处理运行中的生产线：先完工入库（原料与加工费已在开工时支付），随后投料开始下一批
          else if (line.status === 'running') {
            // 计算是否完成生产：根据生产线类型和生产周期
            let shouldComplete = false;
            if (line.type === 'automatic' || line.type === 'flexible') {
              // 全自动/柔性线每季度完成1个产品
              shouldComplete = true;
            } else if (line.type === 'semi-automatic') {
              // 半自动线2个季度完成1个产品
              shouldComplete = newQuarter % 2 === 0;
            } else if (line.type === 'manual') {
              // 手工线3个季度完成1个产品
              shouldComplete = newQuarter % 3 === 0;
            }

            let productionQuantity = line.inProgressProducts;
            if (shouldComplete && line.inProgressProducts > 0 && line.product) {
              // 生产完成，将在制品转换为成品（开工时已投料付加工费）
              const productIndex = newFinishedProducts.findIndex(p => p.type === line.product!);
              if (productIndex !== -1) {
                newFinishedProducts[productIndex] = {
                  ...newFinishedProducts[productIndex],
                  quantity: newFinishedProducts[productIndex].quantity + line.inProgressProducts,
                };
                totalProduced += line.inProgressProducts;
              }
              productionQuantity = 0;
            }

            // 开始下一批生产：投料并支付加工费
            if (line.product && productionQuantity === 0 && startLineProduction(line, 'auto')) {
              productionQuantity = 1;
            }

            newFactories[factoryIndex].productionLines[lineIndex] = {
              ...newFactories[factoryIndex].productionLines[lineIndex],
              inProgressProducts: productionQuantity,
            };
          }
        });
      });

      if (installPaymentFailed) {
        return { validationError: installPaymentFailed };
      }

      // 8. 检查原材料是否耗尽，自动将生产线状态从"运行"更新为"停产"
      newFactories.forEach((factory, factoryIndex) => {
        factory.productionLines.forEach((line, lineIndex) => {
          if (line.status === 'running' && line.product) {
            const bom = PRODUCT_BOM[line.product];
            // 检查所需原材料是否全部耗尽（数量为0）
            const allMaterialsExhausted = Object.keys(bom).every(materialType => {
              const material = newRawMaterials.find(m => m.type === materialType);
              return !material || material.quantity === 0;
            });

            if (allMaterialsExhausted) {
              newFactories[factoryIndex].productionLines[lineIndex] = {
                ...line,
                status: 'stopped',
                inProgressProducts: 0, // 清空在制品
              };
              stoppedLines.push({
                lineName: line.name,
                product: line.product,
                requiredMaterials: Object.keys(bom)
              });
            }
          }
        });
      });

      // 更新生产/完工入库日志（运行控制表：季度-7，含生产成本注记）
      const productionLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-production`,
        year: newYear,
        quarter: newQuarter,
        timestamp: Date.now(),
        description: `更新生产/完工入库：完工${totalProduced}个产品，成品库存 ${newFinishedProducts.map(p => `${p.type}:${p.quantity}`).join(', ')}`,
        cashChange: 0,
        newCash: initialCash - shortSettlement.due - apPayment + cashIncrease - rdInvestment - autoProcessFees,
        operator: '系统自动',
        stepId: 'q-7',
        kind: 'flow',
      };

      // 5. 产品研发进度（仅 P2：6Q 分期、每季 1M、资金短缺自动中断，置于生产之后以核算可用资金）
      const updatedProductRD = { ...state.state.production.productRD };
      const completedProducts: string[] = [];
      {
        const p2 = updatedProductRD.P2;
        if (p2.status === 'active' && !p2.completed) {
          const availableForRD = initialCash - shortSettlement.due - apPayment + cashIncrease - autoProcessFees;
          if (availableForRD >= 1) {
            const newProgress = Math.min(p2.progress + 1, 6);
            const newPaid = p2.paidQuarters + 1;
            const completed = newPaid >= 6;
            updatedProductRD.P2 = {
              ...p2,
              progress: newProgress,
              paidQuarters: newPaid,
              totalInvestment: p2.totalInvestment + 1,
              status: completed ? 'completed' : 'active',
              completed: p2.completed || completed,
            };
            rdInvestment += 1;
            if (completed) {
              completedProducts.push('P2');
            }
          } else {
            // 资金不足：本季度研发中断（保持 active，后续季度资金充足自动续投）
            const interruptLog = {
              id: `log-${Date.now()}-rd-interrupt`,
              time: new Date().toLocaleString(),
              operator: '系统自动',
              action: '产品研发中断',
              dataChange: 'P2研发因现金不足本季度中断，资金充足后自动续投',
            };
            newOperationLogs.unshift(interruptLog);
          }
        }
      }

      // 产品研发投资日志 - 只有当有研发投资时才记录
      const rdLog: FinancialLogRecord | null = rdInvestment > 0 ? {
        id: `finlog-${Date.now()}-rd`,
        year: newYear,
        quarter: newQuarter,
        timestamp: Date.now(),
        description: `产品研发投资：-${rdInvestment}M(P2)`,
        cashChange: -rdInvestment,
        newCash: initialCash - shortSettlement.due - apPayment + cashIncrease - rdInvestment,
        operator: '系统自动',
        stepId: 'q-15',
        kind: 'flow',
      } : null;
      
      // 9. 生成原材料耗尽导致停产的事件记录
      // 如果有生产线因原材料耗尽而停产，生成事件记录
      if (stoppedLines.length > 0) {
        stoppedLines.forEach(stoppedLine => {
          const stopLog = {
            id: `log-${Date.now()}-stop-${Math.random().toString(36).substr(2, 9)}`,
            time: new Date().toLocaleString(),
            operator: '系统自动',
            action: '生产线停产',
            dataChange: `生产线${stoppedLine.lineName}因生产${stoppedLine.product}所需原材料(${stoppedLine.requiredMaterials.join('、')})耗尽，自动停产`,
          };
          newOperationLogs.unshift(stopLog);
        });
      }
      
      // ===== 年末结账序列（推进出第4季度时执行）=====
      const isYearEnd = state.state.operation.currentQuarter === 4;
      const closingYear = state.state.operation.currentYear;
      const yearEndLogs: FinancialLogRecord[] = [];

      // e-1 支付利息/更新长期贷款：对每笔存续长贷付息、期限递减、到期还本
      let longInterest = 0;
      let longPrincipal = 0;
      // 非年末季度：保留短贷结算后的全部存续贷款（含长贷）
      let survivingLoans = shortSettlement.survivors;
      if (isYearEnd) {
        const longSettlement = settleLongLoansAtYearEnd(state.state.finance.loans);
        longInterest = longSettlement.interest;
        longPrincipal = longSettlement.principalRepaid;
        // 年末：短贷保留未到期的，长贷替换为期限递减后的存续贷款
        survivingLoans = [
          ...shortSettlement.survivors.filter(l => l.kind === 'short'),
          ...longSettlement.survivors,
        ];
        if (longInterest > 0 || longPrincipal > 0) {
          yearEndLogs.push({
            id: `finlog-${Date.now()}-long-settle`,
            year: newYear,
            quarter: newQuarter,
            timestamp: Date.now(),
            description: `年末长贷结算：-利息${longInterest}M${longPrincipal > 0 ? `，-还本${longPrincipal}M` : ''}`,
            cashChange: -(longInterest + longPrincipal),
            newCash: 0, // 稍后统一回填
            operator: '系统自动',
            stepId: 'e-1',
            kind: 'flow',
          });
        }
      }

      // e-2 支付设备维护费：当年在建/建成与当年出售的生产线免维护（出售即已移除）
      let maintenanceCost = 0;
      if (isYearEnd) {
        state.state.production.factories.forEach(factory => {
          factory.productionLines.forEach(line => {
            if (line.builtInYear < closingYear) maintenanceCost += line.maintenanceCost;
          });
        });
        if (maintenanceCost > 0) {
          yearEndLogs.push({
            id: `finlog-${Date.now()}-maintenance`,
            year: newYear,
            quarter: newQuarter,
            timestamp: Date.now(),
            description: `支付设备维护费：-设备维护费${maintenanceCost}M`,
            cashChange: -maintenanceCost,
            newCash: 0,
            operator: '系统自动',
            stepId: 'e-2',
            kind: 'flow',
          });
        }
      }

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
          kind: 'flow',
        });
      }

      // 10. 支付行政管理费（进入第4季度时扣除1M，运行控制表：季度-16）
      const adminCost = newQuarter === 4 ? 1 : 0;
      if (adminCost > 0) {
        yearEndLogs.push({
          id: `finlog-${Date.now()}-admin`,
          year: newYear,
          quarter: newQuarter,
          timestamp: Date.now(),
          description: `支付行政管理费：-行政管理费${adminCost}M`,
          cashChange: -adminCost,
          newCash: 0,
          operator: '系统自动',
          stepId: 'q-16',
          kind: 'flow',
        });
      }

      // e-4 计提折旧：净值1/3取整、当年建成不提、净值<3M提1M（非现金费用）
      let depreciationTotal = 0;
      if (isYearEnd) {
        newFactories.forEach((factory, factoryIndex) => {
          factory.productionLines.forEach((line, lineIndex) => {
            const dep = depreciationFor(line.netValue, line.builtInYear, closingYear);
            if (dep > 0) {
              depreciationTotal += dep;
              newFactories[factoryIndex].productionLines[lineIndex] = {
                ...line,
                netValue: line.netValue - dep,
              };
            }
          });
        });
        if (depreciationTotal > 0) {
          yearEndLogs.push({
            id: `finlog-${Date.now()}-depreciation`,
            year: newYear,
            quarter: newQuarter,
            timestamp: Date.now(),
            description: `计提折旧：-折旧${depreciationTotal}M（非现金）`,
            cashChange: 0,
            newCash: 0,
            operator: '系统自动',
            stepId: 'e-4',
            kind: 'flow',
          });
        }
      }

      // 年末结算已读取旧快照，此后方可刷新各槽位的该年度租赁标记
      if (isYearEnd) {
        for (let i = 0; i < newFactories.length; i++) {
          newFactories[i] = { ...newFactories[i], leasedThisYear: newFactories[i].holding === 'leased' };
        }
      }

      // 年度台账：
      // 年末过渡时，本季自动项目（短贷息/研发/开工加工费）归属新年度，
      // 年末结算项目（维护/租金/长贷息/折旧）归属收尾年度
      let ledger: AnnualLedger;
      let closingLedger: AnnualLedger | null = null;
      let closingStatement: ReturnType<typeof incomeStatement> | null = null;
      if (isYearEnd) {
        closingLedger = {
          ...state.state.operation.annualLedger,
          maintenanceFee: state.state.operation.annualLedger.maintenanceFee + maintenanceCost,
          rentFee: state.state.operation.annualLedger.rentFee + rentCost,
          interestExpense: state.state.operation.annualLedger.interestExpense + longInterest,
          depreciation: state.state.operation.annualLedger.depreciation + depreciationTotal,
        };
        closingStatement = incomeStatement(closingLedger);
        ledger = {
          ...emptyLedger(),
          rdFee: rdInvestment,
          interestExpense: shortSettlement.interest,
        };
        yearEndLogs.push({
          id: `finlog-${Date.now()}-closing`,
          year: newYear,
          quarter: newQuarter,
          timestamp: Date.now(),
          description: `年度结账：税前利润${closingStatement.pretax}M，所得税${closingStatement.tax}M（下年初交纳），净利润${closingStatement.net}M`,
          cashChange: 0,
          newCash: 0,
          operator: '系统自动',
          stepId: 'e-6',
          kind: 'flow',
        });
      } else {
        ledger = {
          ...state.state.operation.annualLedger,
          interestExpense: state.state.operation.annualLedger.interestExpense + shortSettlement.interest,
          rdFee: state.state.operation.annualLedger.rdFee + rdInvestment,
          adminFee: state.state.operation.annualLedger.adminFee + adminCost,
        };
      }

      // 总现金支出（所得税不在结账时扣：计入应付税金、下年初交纳）
      const totalCashOut = materialPayment + totalInstallPayments + maintenanceCost + rentCost + longInterest + longPrincipal + adminCost + rdInvestment + autoProcessFees;

      // 计算新的现金余额
      const newCash = initialCash - shortSettlement.due - apPayment + cashIncrease - totalCashOut;
      if (newCash < 0) {
        return { validationError: `本季度现金收支后将透支（缺口 ${-newCash}M），请先贴现应收账款或申请贷款` };
      }
      const finalCash = newCash;
      // 此处曾有 `finalCashChange = -shortSettlement.due - apPayment + cashIncrease - totalCashOut`
      // （= finalCash − initialCash，只含引擎自动项）直接充当季度末重述串的 cashChange；
      // S-T3 把口径改为「自上一条重述串起的整季全部净变动」后它已无消费方，故删去，见下方 quarterEndLog。

      // 年末市场/ISO 年度结算：未维持的已准入市场丧失资格（第1年豁免），并复位本年度投资标记
      // 警告日志必须在此构造并入列，才能与其余 e-5 日志一起被下方统一回填补上 newCash
      let abandonedMarkets: string[] = [];
      const updatedMarkets = state.state.marketing.markets.map(market => {
        if (isYearEnd) {
          if (market.status === 'available' && !market.investedThisYear && closingYear >= 2) {
            abandonedMarkets.push(market.name);
            return { ...market, status: 'unavailable' as const, investedThisYear: false };
          }
          return { ...market, investedThisYear: false };
        }
        return market;
      });
      if (abandonedMarkets.length > 0) {
        newOperationLogs.unshift({
          id: `log-${Date.now()}-abandon`,
          time: new Date().toLocaleString(),
          operator: '系统自动',
          action: '市场丧失准入',
          dataChange: `${abandonedMarkets.join('、')}因本年度未投入1M维护，丧失市场准入`,
        });
        yearEndLogs.push({
          id: `finlog-${Date.now()}-abandon`,
          year: newYear,
          quarter: newQuarter,
          timestamp: Date.now(),
          description: `市场维护警告：${abandonedMarkets.join('、')}未维持，丧失准入`,
          cashChange: 0,
          newCash: 0,
          operator: '系统自动',
          stepId: 'e-5',
          kind: 'flow',
        });
      }

      // 统一回填：先走季中日志（安装分期、自动开工），再走年末结算日志。
      // install/start 的 cashChange 合计恰为 -totalInstallPayments - autoProcessFees，
      // 故累计到它们之后再减 rdInvestment，与原初值等价。
      let runningCash = initialCash - shortSettlement.due - apPayment + cashIncrease - materialPayment;
      for (const log of [...installPaymentLogs, ...startProductionLogs]) {
        runningCash += log.cashChange;
        log.newCash = runningCash;
      }
      runningCash -= rdInvestment;
      for (const log of yearEndLogs) {
        runningCash += log.cashChange;
        log.newCash = runningCash;
      }

      // 添加现金流量历史记录
      const newCashFlowHistory = [
        ...state.state.operation.cashFlowHistory,
        {
          year: newYear,
          quarter: newQuarter,
          cash: finalCash,
          description: `第${newYear}年第${newQuarter}季度现金余额`,
        },
      ];

      // 创建详细的财务日志描述
      let detailedDescription = `第${newYear}年第${newQuarter}季度结束现金变动:`;
      if (cashIncrease > 0) {
        detailedDescription += ` 应收账款收现 ${cashIncrease}M`;
      }
      if (shortSettlement.due > 0) {
        detailedDescription += ` - 短贷还本付息 ${shortSettlement.due}M`;
      }
      if (apPayment > 0) {
        detailedDescription += ` - 归还应付账款 ${apPayment}M`;
      }
      if (maintenanceCost > 0) {
        detailedDescription += ` - 设备维护费 ${maintenanceCost}M`;
      }
      if (rentCost > 0) {
        detailedDescription += ` - 厂房租金 ${rentCost}M`;
      }
      if (longInterest > 0) {
        detailedDescription += ` - 长期贷款利息 ${longInterest}M`;
      }
      if (longPrincipal > 0) {
        detailedDescription += ` - 长期贷款还本 ${longPrincipal}M`;
      }
      if (adminCost > 0) {
        detailedDescription += ` - 行政管理费 ${adminCost}M`;
      }
      if (rdInvestment > 0) {
        detailedDescription += ` - 研发投资 ${rdInvestment}M`;
      }

      // 季度末日志记录 - 季度结束
      // 重述串 = 自上一条重述串以来的全部净变动（含玩家主动交易），
      // 不能沿用 finalCashChange（只累加引擎自动项），否则 §4.4 的 B 式重建必然少算。
      const restatedDelta = finalCash - previousRestatedCash;
      const quarterEndLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-end`,
        year: newYear,
        quarter: newQuarter,
        timestamp: Date.now(),
        description: detailedDescription,
        cashChange: restatedDelta,
        newCash: finalCash,
        operator: '系统自动',
        kind: 'summary',
      };

      // 年度结束日志记录（结账日志已在上方年末序列生成）
      let yearEndLog: FinancialLogRecord | null = null;
      
      // ISO 认证：年度投资模型下无自动推进，仅复位本年度投资标记
      const updatedISOCertifications = state.state.marketing.isoCertifications.map(iso =>
        isYearEnd ? { ...iso, investedThisYear: false } : iso
      );
      
      // 构建所有日志记录（年末结算日志归属收尾年度第4季度，便于控制表按年推导）
      const remappedYearEndLogs = yearEndLogs.map(l => ({ ...l, year: closingYear, quarter: 4 }));
      const allLogs = [shortSettlementLog, apLog, quarterStartLog, arLog, materialArrivalLog, ...installPaymentLogs, ...startProductionLogs, productionLog, quarterEndLog, ...remappedYearEndLogs];
      // 只有当有研发投资时才添加研发投资日志
      if (rdLog) {
        allLogs.splice(6, 0, rdLog); // 下标6＝5条固定日志（短贷/应付/季初/应收/到货）+ 首条安装分期日志之后；无安装日志时即首条开工日志之后
      }
      if (yearEndLog) {
        allLogs.push(yearEndLog);
      }

      // 贷款台账与聚合展示字段联动
      const longOutstanding = survivingLoans.filter(l => l.kind === 'long').reduce((s, l) => s + l.principal, 0);
      const shortOutstanding = survivingLoans.filter(l => l.kind === 'short').reduce((s, l) => s + l.principal, 0);

      const updatedState = {
        ...state.state,
        operation: {
          ...state.state.operation,
          currentYear: newYear,
          currentQuarter: newQuarter,
          isGameOver: newYear > 4,
          cashFlowHistory: newCashFlowHistory,
          financialLogs: [...allLogs, ...state.state.operation.financialLogs],
          operationLogs: newOperationLogs,
          // 年末归档本年度台账与利润表，新年度清零
          annualLedger: ledger,
          yearlyLedgers: closingLedger
            ? { ...state.state.operation.yearlyLedgers, [closingYear]: closingLedger }
            : state.state.operation.yearlyLedgers,
          yearlyIncomeStatements: closingStatement
            ? { ...state.state.operation.yearlyIncomeStatements, [closingYear]: closingStatement }
            : state.state.operation.yearlyIncomeStatements,
        },
        finance: {
          ...state.state.finance,
          cash: finalCash,
          accountsReceivable: newAR,
          accountsPayable: payableIncrease,
          loans: survivingLoans,
          longTermLoan: {
            ...state.state.finance.longTermLoan,
            amount: longOutstanding,
          },
          shortTermLoan: {
            ...state.state.finance.shortTermLoan,
            amount: shortOutstanding,
          },
          // 所得税计入应付税金，下年初交纳；净利润年末结转利润留存
          taxesPayable: closingStatement
            ? state.state.finance.taxesPayable + closingStatement.tax
            : state.state.finance.taxesPayable,
          retainedProfit: closingStatement
            ? state.state.finance.retainedProfit + closingStatement.net
            : state.state.finance.retainedProfit,
          annualNetProfit: closingStatement ? closingStatement.net : state.state.finance.annualNetProfit,
        },
        production: {
          ...state.state.production,
          productRD: updatedProductRD,
          factories: newFactories,
        },
        logistics: {
          ...state.state.logistics,
          rawMaterials: newRawMaterials,
          finishedProducts: newFinishedProducts,
          rawMaterialOrders: remainingOrders,
        },
        marketing: {
          ...state.state.marketing,
          markets: updatedMarkets,
          isoCertifications: updatedISOCertifications,
        },
      };
      
      // 记录研发完成日志
      if (completedProducts.length > 0) {
        for (const product of completedProducts) {
          const operationLog = {
            id: `log-${Date.now()}-${product}`,
            time: new Date().toLocaleString(),
            operator: '系统自动',
            action: '产品研发完成',
            dataChange: `${product}产品研发完成，总投资${updatedProductRD[product as 'P2' | 'P3' | 'P4'].totalInvestment}M，耗时6个季度`,
          };
          updatedState.operation.operationLogs = [operationLog, ...updatedState.operation.operationLogs];
        }
      }
      
      // 自动保存游戏
      setTimeout(() => {
        get().autoSaveGame();
      }, 0);
      
      return {
        state: updatedState,
        validationError: null,
      };
    }),

  addOperationLog: (action, dataChange) =>
    set((state) => {
      const newLog = {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleString(),
        operator: '企业1管理者',
        action,
        dataChange,
      };
      return {
        state: {
          ...state.state,
          operation: {
            ...state.state.operation,
            operationLogs: [newLog, ...state.state.operation.operationLogs],
          },
        },
      };
    }),
}));

// 导出全新初始状态深拷贝（测试用）
export const createFreshState = (): EnterpriseState => JSON.parse(JSON.stringify(initialState));
