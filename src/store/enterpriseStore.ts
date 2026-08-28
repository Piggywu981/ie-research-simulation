import { create } from 'zustand';
import { EnterpriseState, SaveFile, ProductionLine, FinancialLogRecord, Order, LoanRecord } from '../types/enterprise';
import { absQuarter, emptyLedger, settleDueShortLoans, settleLongLoansAtYearEnd, isValidDiscount, discountSplit, unitCost, depreciationFor, incomeStatement } from '../utils/rules';
import { AnnualLedger } from '../types/enterprise';

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
        purchasePrice: 40, // 大厂房价值40M（自有，不提折旧）
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
        purchasePrice: 30, // 小厂房价值30M（初始为租赁，年末付租金3M/年）
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

// 旧版（v1）存档迁移：补齐贷款台账、年度台账、年度化市场/ISO、生产线净值等新字段。
// v1 的原料到货季度为 1~4 循环值（跨年即错），在途订单直接作废并提示。
const migrateStateV1 = (s: EnterpriseState): EnterpriseState => {
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
  updateCash: (amount: number, description?: string) => void;
  updateLongTermLoan: (amount: number, term: number) => void;
  updateShortTermLoan: (amount: number, term: number) => void;
  updateAccountsReceivable: (period: 0 | 1 | 2 | 3, amount: number) => void;
  updateTaxesPayable: (amount: number) => void;
  applyLongTermLoan: () => void;
  applyShortTermLoan: () => void;
  discountReceivable: (amount: number) => void;
  payTaxes: () => void;
  // 生产操作
  investProductR_D: (product: 'P1' | 'P2' | 'P3' | 'P4', amount: number) => void;
  updateProductionLineStatus: (lineId: string, status: EnterpriseState['production']['factories'][0]['productionLines'][0]['status']) => void;
  addProductionLine: (factoryId: string, lineType: 'automatic' | 'semi-automatic' | 'manual' | 'flexible', product: 'P1' | 'P2' | 'P3' | 'P4') => void;
  removeProductionLine: (factoryId: string, lineId: string) => void;
  cancelProduction: (lineId: string) => void;
  startProduction: (lineId: string) => void;
  convertProductionLine: (lineId: string, newProduct: 'P1' | 'P2' | 'P3' | 'P4') => void;
  getProductionLineRemaining: (lineType: 'automatic' | 'semi-automatic' | 'manual' | 'flexible') => number;
  // 物流操作
  placeRawMaterialOrder: (materialType: 'R1' | 'R2' | 'R3' | 'R4', quantity: number) => void;
  cancelRawMaterialOrder: (orderId: string) => void;
  updateRawMaterialInventory: (materialType: 'R1' | 'R2' | 'R3' | 'R4', quantity: number) => void;
  updateFinishedProductInventory: (productType: 'P1' | 'P2' | 'P3' | 'P4', quantity: number) => void;
  // 营销操作
  placeAdvertisement: (amount: number) => void;
  selectOrder: (orderId: string) => void;
  deliverOrder: (orderId: string) => void;
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
}>((set, get) => ({
  state: initialState,
  saveFiles: [],
  resetCount: resetCount,
  validationError: null,

  setValidationError: (message) => set({ validationError: message }),

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
      version: 2,
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
      version: 2,
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
    const migrated = migrateStateV1(raw);
    set({
      state: migrated,
      resetCount: saveFile.resetCount
    });
    // 添加操作日志
    get().addOperationLog('加载存档', saveFile.version === 2
      ? `加载存档：${saveFile.name}`
      : `加载存档：${saveFile.name}（旧版存档已迁移至v2，建议重置开新局）`);
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
  updateCash: (amount, description = '现金变动') =>
    set((state) => {
      const newCash = state.state.finance.cash + amount;
      const financialLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}`,
        year: state.state.operation.currentYear,
        quarter: state.state.operation.currentQuarter,
        timestamp: Date.now(),
        description,
        cashChange: amount,
        newCash,
        operator: '企业1管理者',
      };
      
      return {
        state: {
          ...state.state,
          finance: {
            ...state.state.finance,
            cash: newCash,
          },
          operation: {
            ...state.state.operation,
            financialLogs: [financialLog, ...state.state.operation.financialLogs],
          },
        },
      };
    }),
  
  // 添加财务日志
  addFinancialLog: (description: string, cashChange: number, newCash: number) =>
    set((state) => {
      const financialLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}`,
        year: state.state.operation.currentYear,
        quarter: state.state.operation.currentQuarter,
        timestamp: Date.now(),
        description,
        cashChange,
        newCash,
        operator: '企业1管理者',
      };
      
      return {
        state: {
          ...state.state,
          operation: {
            ...state.state.operation,
            financialLogs: [financialLog, ...state.state.operation.financialLogs],
          },
        },
      };
    }),


  updateLongTermLoan: (amount, term) =>
    set((state) => ({
      state: {
        ...state.state,
        finance: {
          ...state.state.finance,
          longTermLoan: {
            ...state.state.finance.longTermLoan,
            amount: state.state.finance.longTermLoan.amount + amount,
            term,
          },
        },
      },
    })),

  updateShortTermLoan: (amount, term) =>
    set((state) => ({
      state: {
        ...state.state,
        finance: {
          ...state.state.finance,
          shortTermLoan: {
            ...state.state.finance.shortTermLoan,
            amount: state.state.finance.shortTermLoan.amount + amount,
            term,
          },
        },
      },
    })),

  updateAccountsReceivable: (period, amount) =>
    set((state) => {
      const newAR = [...state.state.finance.accountsReceivable] as [number, number, number, number];
      newAR[period] += amount;
      return {
        state: {
          ...state.state,
          finance: {
            ...state.state.finance,
            accountsReceivable: newAR,
          },
        },
      };
    }),

  updateTaxesPayable: (amount) =>
    set((state) => ({
      state: {
        ...state.state,
        finance: {
          ...state.state.finance,
          taxesPayable: state.state.finance.taxesPayable + amount,
        },
      },
    })),
  
  // 申请长期贷款（年末第4季度，每次20M，未还本余额上限40M，3年期年息10%）
  applyLongTermLoan: () =>
    set((state) => {
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
  investProductR_D: (product, amount) =>
    set((state) => {
      if (product === 'P1') {
        return state;
      }
      
      // 检查是否已经投资
      const currentRD = state.state.production.productRD[product];
      if (currentRD.totalInvestment > 0) {
        return state; // 已投资，不允许重复投资
      }
      
      // 一次性投资6M，设置进度为0，等待6个季度后完成
      const newRD = {
        ...state.state.production.productRD,
        [product]: {
          ...state.state.production.productRD[product],
          progress: 0, // 投资后进度重置为0，等待6个季度自动完成
          totalInvestment: state.state.production.productRD[product].totalInvestment + amount,
          completed: false, // 投资后不立即完成，等待6个季度
        },
      };
      
      // 更新现金并记录财务日志
      const investmentCost = -amount;
      const newCash = state.state.finance.cash + investmentCost;
      
      // 添加操作日志
      const operationLog = {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleString(),
        operator: '企业1管理者',
        action: '产品研发投资',
        dataChange: `投资${product}产品研发6M，预计6个季度后完成`,
      };
      
      return {
        state: {
          ...state.state,
          production: {
            ...state.state.production,
            productRD: newRD,
          },
          finance: {
            ...state.state.finance,
            cash: newCash,
          },
          operation: {
            ...state.state.operation,
            operationLogs: [operationLog, ...state.state.operation.operationLogs],
            financialLogs: [
              {
                id: `finlog-${Date.now()}`,
                year: state.state.operation.currentYear,
                quarter: state.state.operation.currentQuarter,
                timestamp: Date.now(),
                description: `投资${product}产品研发，一次性花费${amount}M，预计6个季度后完成`,
                cashChange: investmentCost,
                newCash,
                operator: '企业1管理者',
              },
              ...state.state.operation.financialLogs
            ],
          },
        },
      };
    }),

  updateProductionLineStatus: (lineId, status) =>
    set((state) => {
      const newFactories = state.state.production.factories.map((factory) => {
        const newProductionLines = factory.productionLines.map((line) =>
          line.id === lineId ? { ...line, status } : line
        );
        return { ...factory, productionLines: newProductionLines };
      });
      return {
        state: {
          ...state.state,
          production: {
            ...state.state.production,
            factories: newFactories,
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
      // 找到指定厂房
      const factoryIndex = state.state.production.factories.findIndex(f => f.id === factoryId);
      if (factoryIndex === -1) {
        return state;
      }

      const factory = state.state.production.factories[factoryIndex];
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

      // 扣除购买生产线的费用
      const purchaseCost = -newLine.purchasePrice;
      const newCash = state.state.finance.cash + purchaseCost;

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
          financialLogs: [
            {
              id: `finlog-${Date.now()}`,
              year: state.state.operation.currentYear,
              quarter: state.state.operation.currentQuarter,
              timestamp: Date.now(),
              description: `购买${config.name}，花费${newLine.purchasePrice}M`,
              cashChange: purchaseCost,
              newCash,
              operator: '企业1管理者',
            },
            ...state.state.operation.financialLogs
          ],
        },
      };

      // 添加操作日志
      const newLog = {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleString(),
        operator: '企业1管理者',
        action: '添加生产线',
        dataChange: `在${factory.name}添加了${product}产品的${config.name}，花费${config.purchasePrice}M`,
      };

      updatedState.operation.operationLogs = [newLog, ...updatedState.operation.operationLogs];

      return {
        state: updatedState,
      };
    }),

  // 取消生产
  cancelProduction: (lineId) =>
    set((state) => {
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

  // 开始生产
  startProduction: (lineId) =>
    set((state) => {
      // 找到包含该生产线的厂房和生产线
      let updatedFactories = [...state.state.production.factories];
      let lineName = '';
      let productName = '';
      let productType: 'P1' | 'P2' | 'P3' | 'P4' | null = null;
      let canProduce = true;
      let requiredMaterials = {} as Record<string, number>;

      // 1. 首先找到生产线，确定需要的原材料
      updatedFactories.forEach(factory => {
        factory.productionLines.forEach(line => {
          if (line.id === lineId && line.product) {
            productType = line.product;
            lineName = line.name;
            productName = line.product;
            
            // 计算该产品需要的原材料
            if (productType === 'P1') {
              requiredMaterials = { R1: 1 };
            } else if (productType === 'P2') {
              requiredMaterials = { R1: 1, R2: 1 };
            } else if (productType === 'P3') {
              requiredMaterials = { R2: 2, R3: 1 };
            } else if (productType === 'P4') {
              requiredMaterials = { R2: 1, R3: 1, R4: 2 };
            }
          }
        });
      });

      // 2. 检查原材料是否足够
      if (productType) {
        const currentRawMaterials = state.state.logistics.rawMaterials;
        for (const [materialType, requiredQuantity] of Object.entries(requiredMaterials)) {
          const material = currentRawMaterials.find(m => m.type === materialType);
          if (!material || material.quantity < requiredQuantity) {
            canProduce = false;
            break;
          }
        }
      }

      // 3. 如果原材料足够，开始生产（设置在制品数量）
      // 注意：原材料消耗在生产完成时（nextQuarter函数）处理，而不是在这里
      if (canProduce && productType) {
        // 更新生产线状态
        updatedFactories = updatedFactories.map(factory => {
          const updatedLines = factory.productionLines.map(line => {
            if (line.id === lineId) {
              // 重新开始生产，在制品数量与生产线类型相关
              const productionQuantity = line.type === 'automatic' ? 1 : line.type === 'flexible' ? 1 : line.type === 'semi-automatic' ? 1 : 1;
              return {
                ...line,
                status: 'running' as const, // 明确类型化为生产线状态联合类型
                inProgressProducts: productionQuantity,
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
          action: '开始生产',
          dataChange: `开始了${lineName}的生产，产品：${productName}，需要原材料：${Object.entries(requiredMaterials).map(([type, qty]) => `${qty}${type}`).join('+')}`,
        };

        updatedState.operation.operationLogs = [newLog, ...updatedState.operation.operationLogs];

        return {
          state: updatedState,
        };
      } else {
        // 原材料不足，添加操作日志但不开始生产
        const newLog = {
          id: `log-${Date.now()}`,
          time: new Date().toLocaleString(),
          operator: '企业1管理者',
          action: '开始生产',
          dataChange: `尝试开始${lineName}的生产，产品：${productName}，但原材料不足，无法生产`,
        };

        const updatedState = {
          ...state.state,
          operation: {
            ...state.state.operation,
            operationLogs: [newLog, ...state.state.operation.operationLogs],
          },
        };

        return {
          state: updatedState,
        };
      }
    }),

  // 生产线转产
  convertProductionLine: (lineId, newProduct: 'P1' | 'P2' | 'P3' | 'P4') =>
    set((state) => {
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

      // 添加财务日志
      const financialLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-conversion`,
        year: state.state.operation.currentYear,
        quarter: state.state.operation.currentQuarter,
        timestamp: Date.now(),
        description: `生产线转产费用，${lineName}从${oldProduct}转产到${newProduct}，花费${conversionCost}M`,
        cashChange: -conversionCost,
        newCash: updatedState.finance.cash,
        operator: '企业1管理者',
      };

      updatedState.operation.financialLogs = [financialLog, ...updatedState.operation.financialLogs];

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

      // 更新现金（加上残值）
      const salvageIncome = salvageValue;
      const newCash = state.state.finance.cash + salvageIncome;

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
          financialLogs: [
            {
              id: `finlog-${Date.now()}`,
              year: state.state.operation.currentYear,
              quarter: state.state.operation.currentQuarter,
              timestamp: Date.now(),
              description: `出售${line.name}，获得残值收入${salvageValue}M`,
              cashChange: salvageIncome,
              newCash,
              operator: '企业1管理者',
            },
            ...state.state.operation.financialLogs
          ],
        },
      };

      // 添加操作日志
      const newLog = {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleString(),
        operator: '企业1管理者',
        action: '移除生产线',
        dataChange: `从${factory.name}移除了${line.name}，获得残值${salvageValue}M`,
      };

      updatedState.operation.operationLogs = [newLog, ...updatedState.operation.operationLogs];

      return {
        state: updatedState,
      };
    }),

  // 物流操作
  placeRawMaterialOrder: (materialType, quantity) =>
    set((state) => {
      const material = state.state.logistics.rawMaterials.find((m) => m.type === materialType);
      if (!material) return state;
      
      const orderId = `order-${Date.now()}`;
      const newOrder = {
        id: orderId,
        materialType,
        quantity,
        price: material.price,
        orderPeriod: state.state.operation.currentQuarter,
        arrivalPeriod: state.state.operation.currentQuarter + material.leadTime,
      };
      
      // 计算订单总金额
      const totalCost = quantity * material.price;
      // 扣除现金
      const newCash = state.state.finance.cash - totalCost;
      
      // 添加操作日志
      const operationLog = {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleString(),
        operator: '企业1管理者',
        action: '下原材料订单',
        dataChange: `下${materialType}原料订单${quantity}个，预计${newOrder.arrivalPeriod}Q到货，总价${totalCost}M`,
      };
      
      // 添加财务日志
      const financialLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-material-order`,
        year: state.state.operation.currentYear,
        quarter: state.state.operation.currentQuarter,
        timestamp: Date.now(),
        description: `下${materialType}原料订单${quantity}个，花费${totalCost}M，预计${newOrder.arrivalPeriod}Q到货`,
        cashChange: -totalCost,
        newCash,
        operator: '企业1管理者',
      };
      
      return {
        state: {
          ...state.state,
          finance: {
            ...state.state.finance,
            cash: newCash,
          },
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

  // 取消原材料订单
  cancelRawMaterialOrder: (orderId) =>
    set((state) => {
      // 找到要取消的订单
      const orderToCancel = state.state.logistics.rawMaterialOrders.find(order => order.id === orderId);
      if (!orderToCancel) return state;
      
      // 计算订单总金额，用于返还资金
      const refundAmount = orderToCancel.quantity * orderToCancel.price;
      // 返还现金
      const newCash = state.state.finance.cash + refundAmount;
      
      // 过滤掉要取消的订单
      const remainingOrders = state.state.logistics.rawMaterialOrders.filter(order => order.id !== orderId);
      
      // 添加操作日志
      const operationLog = {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleString(),
        operator: '企业1管理者',
        action: '取消原材料订单',
        dataChange: `取消${orderToCancel.materialType}原料订单${orderToCancel.quantity}个，预计${orderToCancel.arrivalPeriod}Q到货，返还资金${refundAmount}M`,
      };
      
      // 添加财务日志
      const financialLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-material-cancel`,
        year: state.state.operation.currentYear,
        quarter: state.state.operation.currentQuarter,
        timestamp: Date.now(),
        description: `取消${orderToCancel.materialType}原料订单${orderToCancel.quantity}个，返还资金${refundAmount}M`,
        cashChange: refundAmount,
        newCash,
        operator: '企业1管理者',
      };
      
      return {
        state: {
          ...state.state,
          finance: {
            ...state.state.finance,
            cash: newCash,
          },
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

  updateRawMaterialInventory: (materialType, quantity) =>
    set((state) => {
      const newRawMaterials = state.state.logistics.rawMaterials.map((material) =>
        material.type === materialType
          ? { ...material, quantity: material.quantity + quantity }
          : material
      );
      return {
        state: {
          ...state.state,
          logistics: {
            ...state.state.logistics,
            rawMaterials: newRawMaterials,
          },
        },
      };
    }),

  updateFinishedProductInventory: (productType, quantity) =>
    set((state) => {
      const newFinishedProducts = state.state.logistics.finishedProducts.map((product) =>
        product.type === productType
          ? { ...product, quantity: product.quantity + quantity }
          : product
      );
      return {
        state: {
          ...state.state,
          logistics: {
            ...state.state.logistics,
            finishedProducts: newFinishedProducts,
          },
        },
      };
    }),

  // 营销操作
  placeAdvertisement: (amount) =>
    set((state) => {
      const adId = `ad-${Date.now()}`;
      const newAd = {
        id: adId,
        amount,
        period: state.state.operation.currentQuarter,
        markets: ['本地市场', '区域市场'], // 一次性投放覆盖本地和区域市场
        products: ['P1', 'P2'], // 覆盖P1和P2产品
      };
      
      // 扣除广告费用
      const newCash = state.state.finance.cash - amount;
      
      // 添加财务日志
      const financialLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-ad`,
        year: state.state.operation.currentYear,
        quarter: state.state.operation.currentQuarter,
        timestamp: Date.now(),
        description: `投放广告（其他支出），花费${amount}M，覆盖本地和区域市场，产品P1和P2`,
        cashChange: -amount,
        newCash,
        operator: '企业1管理者',
      };
      
      // 添加操作日志
      const operationLog = {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleString(),
        operator: '企业1管理者',
        action: '投放广告',
        dataChange: `投放广告，花费${amount}M，覆盖本地和区域市场，产品P1和P2`,
      };
      
      return {
        state: {
          ...state.state,
          finance: {
            ...state.state.finance,
            cash: newCash,
          },
          marketing: {
            ...state.state.marketing,
            advertisements: [...state.state.marketing.advertisements, newAd],
          },
          operation: {
            ...state.state.operation,
            operationLogs: [operationLog, ...state.state.operation.operationLogs],
            financialLogs: [financialLog, ...state.state.operation.financialLogs],
          },
        },
      };
    }),

  // 投资开拓市场
  investMarketDevelopment: (marketType: 'local' | 'regional' | 'domestic' | 'asian' | 'international') =>
    set((state) => {
      let investmentCost = 0;
      const newMarkets = state.state.marketing.markets.map((market) => {
        if (market.type === marketType && market.status === 'unavailable') {
          // 计算投资金额（根据市场类型不同）
          investmentCost = market.type === 'local' ? 1 : market.type === 'regional' ? 1 : market.type === 'domestic' ? 2 : market.type === 'asian' ? 3 : 4;
          
          return {
            ...market,
            status: 'developing' as const,
            developmentProgress: 0, // 点击按钮后不立即增加进度，下一回合开始增加
          };
        }
        return market;
      });
      
      // 如果有投资成本，扣除现金并记录日志
      let updatedState = {
        ...state.state,
        marketing: {
          ...state.state.marketing,
          markets: newMarkets,
        },
      };
      
      if (investmentCost > 0) {
        const newCash = state.state.finance.cash - investmentCost;
        
        // 添加财务日志
        const financialLog: FinancialLogRecord = {
          id: `finlog-${Date.now()}-market-invest`,
          year: state.state.operation.currentYear,
          quarter: state.state.operation.currentQuarter,
          timestamp: Date.now(),
          description: `投资开拓${marketType}市场，花费${investmentCost}M`,
          cashChange: -investmentCost,
          newCash,
          operator: '企业1管理者',
        };
        
        updatedState = {
          ...updatedState,
          finance: {
            ...updatedState.finance,
            cash: newCash,
          },
          operation: {
            ...updatedState.operation,
            financialLogs: [financialLog, ...updatedState.operation.financialLogs],
          },
        };
        
        // 添加操作日志
        const operationLog = {
          id: `log-${Date.now()}`,
          time: new Date().toLocaleString(),
          operator: '企业1管理者',
          action: '投资市场开发',
          dataChange: `投资开拓${marketType}市场，花费${investmentCost}M，预计${marketType === 'local' || marketType === 'regional' ? '1' : marketType === 'domestic' ? '2' : marketType === 'asian' ? '3' : '4'}年完成`,
        };
        
        updatedState.operation.operationLogs = [operationLog, ...updatedState.operation.operationLogs];
      }
      
      return {
        state: updatedState,
      };
    }),

  // 投资ISO认证
  investISOCertification: (isoType: 'ISO9000' | 'ISO14000') =>
    set((state) => {
      let investmentCost = 0;
      const newISOCertifications = state.state.marketing.isoCertifications.map((iso) => {
        if (iso.type === isoType && iso.status === 'uncertified') {
          // 计算投资金额（根据认证类型不同）
          investmentCost = iso.type === 'ISO9000' ? 3 : 4;
          
          return {
            ...iso,
            status: 'certifying' as const,
            certificationProgress: 0, // 点击按钮后不立即增加进度，下一回合开始增加
            totalCost: investmentCost,
          };
        }
        return iso;
      });
      
      // 如果有投资成本，扣除现金并记录日志
      let updatedState = {
        ...state.state,
        marketing: {
          ...state.state.marketing,
          isoCertifications: newISOCertifications,
        },
      };
      
      if (investmentCost > 0) {
        const newCash = state.state.finance.cash - investmentCost;
        
        // 添加财务日志
        const financialLog: FinancialLogRecord = {
          id: `finlog-${Date.now()}-iso-invest`,
          year: state.state.operation.currentYear,
          quarter: state.state.operation.currentQuarter,
          timestamp: Date.now(),
          description: `投资${isoType}认证，花费${investmentCost}M`,
          cashChange: -investmentCost,
          newCash,
          operator: '企业1管理者',
        };
        
        updatedState = {
          ...updatedState,
          finance: {
            ...updatedState.finance,
            cash: newCash,
          },
          operation: {
            ...updatedState.operation,
            financialLogs: [financialLog, ...updatedState.operation.financialLogs],
          },
        };
        
        // 添加操作日志
        const operationLog = {
          id: `log-${Date.now()}`,
          time: new Date().toLocaleString(),
          operator: '企业1管理者',
          action: '投资ISO认证',
          dataChange: `投资${isoType}认证，花费${investmentCost}M，预计${isoType === 'ISO9000' ? '3' : '4'}季度完成`,
        };
        
        updatedState.operation.operationLogs = [operationLog, ...updatedState.operation.operationLogs];
      }
      
      return {
        state: updatedState,
      };
    }),

  // 新增可选订单
  addAvailableOrder: (order) =>
    set((state) => {
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

  // 旧的selectOrder函数，保持不变
  selectOrder: (orderId) =>
    set((state) => {
      const newAvailableOrders = state.state.marketing.availableOrders.map((order) =>
        order.id === orderId ? { ...order, isSelected: true } : order
      );
      const selectedOrder = state.state.marketing.availableOrders.find((order) => order.id === orderId);
      const newSelectedOrders = selectedOrder
        ? [...state.state.marketing.selectedOrders, { ...selectedOrder, isSelected: true }]
        : state.state.marketing.selectedOrders;
      
      return {
        state: {
          ...state.state,
          marketing: {
            ...state.state.marketing,
            availableOrders: newAvailableOrders,
            selectedOrders: newSelectedOrders,
          },
        },
      };
    }),

  deliverOrder: (orderId) =>
    set((state) => {
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

  // 运营操作
  nextQuarter: () =>
    set((state) => {
      const newQuarter = state.state.operation.currentQuarter === 4 ? 1 : state.state.operation.currentQuarter + 1;
      const newYear = state.state.operation.currentQuarter === 4 ? state.state.operation.currentYear + 1 : state.state.operation.currentYear;
      const newAbsQuarter = absQuarter(newYear, newQuarter);

      // 季度初日志记录 - 季初现金盘点的初始数据
      const initialCash = state.state.finance.cash;

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

      // 4. 更新应收账款/应收款收现日志
      const arLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-ar`,
        year: newYear,
        quarter: newQuarter,
        timestamp: Date.now(),
        description: `更新应收账款/应收款收现，收现金额：${cashIncrease}M`,
        cashChange: cashIncrease,
        newCash: initialCash - shortSettlement.due + cashIncrease,
        operator: '系统自动',
        stepId: 'q-11',
      };
      
      // 5. 更新生产研发进度（仅 P2 开放研发）
      const updatedProductRD = { ...state.state.production.productRD };
      let rdInvestment = 0;
      // 记录研发完成的产品
      const completedProducts: string[] = [];
      {
        const p2 = updatedProductRD.P2;
        // 只对已经投资但未完成的 P2 更新进度
        if (!p2.completed && p2.totalInvestment > 0) {
          // 每个季度研发进度+1
          const newProgress = p2.progress + 1;
          const requiredProgress = 6;
          updatedProductRD.P2 = {
            ...p2,
            progress: Math.min(newProgress, requiredProgress),
            completed: newProgress >= requiredProgress,
            status: newProgress >= requiredProgress ? 'completed' : p2.status,
            paidQuarters: p2.paidQuarters,
          };
          // 记录研发完成的产品
          if (newProgress >= requiredProgress) {
            completedProducts.push('P2');
          }
        }
      }
      
      // 产品研发投资日志 - 只有当有研发投资时才记录
      const rdLog: FinancialLogRecord | null = rdInvestment > 0 ? {
        id: `finlog-${Date.now()}-rd`,
        year: newYear,
        quarter: newQuarter,
        timestamp: Date.now(),
        description: `产品研发投资，投资金额：${rdInvestment}M`,
        cashChange: -rdInvestment,
        newCash: initialCash + cashIncrease - rdInvestment,
        operator: '系统自动',
      } : null;
      
      // 6. 处理原材料订单到货
      let newRawMaterials = [...state.state.logistics.rawMaterials];
      const remainingOrders = state.state.logistics.rawMaterialOrders.filter(order => {
        if (order.arrivalPeriod === newQuarter) {
          // 订单到货，更新原材料库存
          const materialIndex = newRawMaterials.findIndex(m => m.type === order.materialType);
          if (materialIndex !== -1) {
            newRawMaterials[materialIndex] = {
              ...newRawMaterials[materialIndex],
              quantity: newRawMaterials[materialIndex].quantity + order.quantity,
            };
          }
          return false; // 订单已完成，从列表中移除
        }
        return true; // 订单未完成，保留在列表中
      });
      
      // 原材料入库日志
      const materialArrivalLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-material`,
        year: newYear,
        quarter: newQuarter,
        timestamp: Date.now(),
        description: `原材料入库/更新原料订单，当前原材料库存：${newRawMaterials.map(m => `${m.type}: ${m.quantity}`).join(', ')}`,
        cashChange: 0,
        newCash: initialCash + cashIncrease - rdInvestment,
        operator: '系统自动',
      };
      
      // 生成季初现金盘点日志（在原材料入库后生成，使用更新后的状态）
      const quarterStartCash = initialCash + cashIncrease - rdInvestment;
      // 获取当前产品库存情况
      const currentFinishedProducts = state.state.logistics.finishedProducts.map(p => `${p.type}: ${p.quantity}`).join(', ');
      // 获取当前原料库存情况（使用更新后的原材料库存）
      const currentRawMaterials = newRawMaterials.map(m => `${m.type}: ${m.quantity}`).join(', ');
      
      const quarterStartLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-start`,
        year: newYear,
        quarter: newQuarter,
        timestamp: Date.now(),
        description: `第${newYear}年第${newQuarter}季度初现金盘点，现金余额：${quarterStartCash}M，成品库存：${currentFinishedProducts}，原料库存：${currentRawMaterials}`,
        cashChange: 0,
        newCash: quarterStartCash,
        operator: '系统自动',
      };
      
      // 7. 处理生产线状态变化（安装、转产、生产）
      const newFactories = [...state.state.production.factories];
      const newFinishedProducts = [...state.state.logistics.finishedProducts];
      const newOperationLogs = [...state.state.operation.operationLogs];
      
      let totalProduced = 0;
      // 用于记录因原材料不足而停产的生产线
      const stoppedLines: {lineName: string, product: string, requiredMaterials: string[]}[] = [];
      
      // 8. 原材料到货后，恢复停产的生产线
      // 遍历所有生产线，检查stopped状态的生产线是否可以恢复生产
      newFactories.forEach((factory, factoryIndex) => {
        factory.productionLines.forEach((line, lineIndex) => {
          // 只处理停产状态的生产线
          if (line.status === 'stopped' && line.product) {
            // 计算该产品需要的原材料
            const requiredMaterials: Record<string, number> = {};
            if (line.product === 'P1') {
              requiredMaterials['R1'] = 1;
            } else if (line.product === 'P2') {
              requiredMaterials['R1'] = 1;
              requiredMaterials['R2'] = 1;
            } else if (line.product === 'P3') {
              requiredMaterials['R2'] = 2;
              requiredMaterials['R3'] = 1;
            } else if (line.product === 'P4') {
              requiredMaterials['R2'] = 1;
              requiredMaterials['R3'] = 1;
              requiredMaterials['R4'] = 2;
            }
            
            // 检查所有需要的原材料是否都已充足
            let allMaterialsSufficient = true;
            for (const [materialType, requiredQuantity] of Object.entries(requiredMaterials)) {
              const material = newRawMaterials.find(m => m.type === materialType);
              if (!material || material.quantity < requiredQuantity) {
                allMaterialsSufficient = false;
                break;
              }
            }
            
            // 如果所有所需原材料都已充足，将生产线状态改为running
            if (allMaterialsSufficient) {
              // 更新生产线状态
              newFactories[factoryIndex].productionLines[lineIndex] = {
                ...line,
                status: 'running',
                inProgressProducts: line.type === 'automatic' ? 1 : line.type === 'flexible' ? 1 : line.type === 'semi-automatic' ? 1 : 1,
              };
              
              // 记录恢复生产日志
              const resumeLog = {
                id: `log-${Date.now()}-resume-${Math.random().toString(36).substr(2, 9)}`,
                time: new Date().toLocaleString(),
                operator: '系统自动',
                action: '生产线恢复生产',
                dataChange: `生产线${line.name}因生产${line.product}所需原材料已充足，自动恢复生产`,
              };
              newOperationLogs.unshift(resumeLog);
            }
          }
        });
      });
      
      newFactories.forEach((factory, factoryIndex) => {
        factory.productionLines.forEach((line, lineIndex) => {
          // 处理安装中的生产线
          if (line.status === 'installing') {
            const newInstallationProgress = line.installationProgress + 1;
            if (newInstallationProgress >= line.installationPeriod) {
              // 安装完成，状态变为运行中
              newFactories[factoryIndex].productionLines[lineIndex] = {
                ...line,
                status: 'running',
                installationProgress: newInstallationProgress,
                inProgressProducts: 1, // 开始生产，添加在制品
              };
            } else {
              // 继续安装，更新进度
              newFactories[factoryIndex].productionLines[lineIndex] = {
                ...line,
                installationProgress: newInstallationProgress,
              };
            }
          }
          // 处理转产中的生产线
          else if (line.status === 'converting') {
            const newConversionProgress = line.conversionProgress + 1;
            if (newConversionProgress >= line.conversionPeriod) {
              // 转产完成，状态变为运行中
              newFactories[factoryIndex].productionLines[lineIndex] = {
                ...line,
                status: 'running',
                conversionProgress: newConversionProgress,
                inProgressProducts: 1, // 开始生产，添加在制品
              };
            } else {
              // 继续转产，更新进度
              newFactories[factoryIndex].productionLines[lineIndex] = {
                ...line,
                conversionProgress: newConversionProgress,
              };
            }
          }
          // 处理运行中的生产线
          else if (line.status === 'running') {
            // 计算是否完成生产：根据生产线类型和生产周期
            let shouldProduce = false;
            
            if (line.type === 'automatic' || line.type === 'flexible') {
              // 自动化和柔性生产线每季度完成1个产品
              shouldProduce = true;
            } else if (line.type === 'semi-automatic') {
              // 半自动生产线需要2个季度完成1个产品
              shouldProduce = newQuarter % 2 === 0;
            } else if (line.type === 'manual') {
              // 手工生产线需要3个季度完成1个产品
              shouldProduce = newQuarter % 3 === 0;
            }
            
            if (shouldProduce && line.inProgressProducts > 0) {
              // 计算该产品需要的原材料
              const requiredMaterials: Record<string, number> = {};
              if (line.product === 'P1') {
                requiredMaterials['R1'] = 1;
              } else if (line.product === 'P2') {
                requiredMaterials['R1'] = 1;
                requiredMaterials['R2'] = 1;
              } else if (line.product === 'P3') {
                requiredMaterials['R2'] = 2;
                requiredMaterials['R3'] = 1;
              } else if (line.product === 'P4') {
                requiredMaterials['R2'] = 1;
                requiredMaterials['R3'] = 1;
                requiredMaterials['R4'] = 2;
              }
              
              // 检查原材料是否足够
              let canProduce = true;
              for (const [materialType, requiredQuantity] of Object.entries(requiredMaterials)) {
                const material = newRawMaterials.find(m => m.type === materialType);
                if (!material || material.quantity < requiredQuantity) {
                  canProduce = false;
                  break;
                }
              }
              
              if (canProduce) {
                // 消耗原材料
                for (const [materialType, requiredQuantity] of Object.entries(requiredMaterials)) {
                  newRawMaterials = newRawMaterials.map(material => {
                    if (material.type === materialType) {
                      return {
                        ...material,
                        quantity: material.quantity - requiredQuantity
                      };
                    }
                    return material;
                  });
                }
                
                // 生产完成，将在制品转换为成品
                const productIndex = newFinishedProducts.findIndex(p => p.type === line.product!);
                if (productIndex !== -1) {
                  newFinishedProducts[productIndex] = {
                    ...newFinishedProducts[productIndex],
                    quantity: newFinishedProducts[productIndex].quantity + line.inProgressProducts,
                  };
                  totalProduced += line.inProgressProducts;
                }
              }
              
              // 重置在制品数量，准备开始下一批生产
              line.inProgressProducts = 0;
            }
            
            // 开始下一批生产前检查原材料是否足够
            let productionQuantity = line.inProgressProducts;
            if (line.status === 'running' && line.product && line.inProgressProducts === 0) {
              // 计算该产品需要的原材料
              const requiredMaterials: Record<string, number> = {};
              if (line.product === 'P1') {
                requiredMaterials['R1'] = 1;
              } else if (line.product === 'P2') {
                requiredMaterials['R1'] = 1;
                requiredMaterials['R2'] = 1;
              } else if (line.product === 'P3') {
                requiredMaterials['R2'] = 2;
                requiredMaterials['R3'] = 1;
              } else if (line.product === 'P4') {
                requiredMaterials['R2'] = 1;
                requiredMaterials['R3'] = 1;
                requiredMaterials['R4'] = 2;
              }
              
              // 检查原材料是否足够
              let canProduce = true;
              for (const [materialType, requiredQuantity] of Object.entries(requiredMaterials)) {
                const material = newRawMaterials.find(m => m.type === materialType);
                if (!material || material.quantity < requiredQuantity) {
                  canProduce = false;
                  break;
                }
              }
              
              // 如果原材料足够，开始生产（不消耗原材料，原材料消耗在生产完成时处理）
              if (canProduce) {
                // 设置在制品数量为1，开始生产
                productionQuantity = 1;
              } else {
                // 原材料不足，不生产，保持在制品数量为0
                productionQuantity = 0;
              }
            }
            
            newFactories[factoryIndex].productionLines[lineIndex] = {
              ...newFactories[factoryIndex].productionLines[lineIndex],
              inProgressProducts: productionQuantity,
            };
          }
        });
      });
      
      // 8. 检查原材料是否耗尽，自动将生产线状态从"运行"更新为"停产"
      // 遍历所有生产线，检查其生产所需的原材料是否耗尽
      newFactories.forEach((factory, factoryIndex) => {
        factory.productionLines.forEach((line, lineIndex) => {
          // 只处理运行中的生产线
          if (line.status === 'running' && line.product) {
            // 计算该产品需要的原材料
            const requiredMaterials: Record<string, number> = {};
            if (line.product === 'P1') {
              requiredMaterials['R1'] = 1;
            } else if (line.product === 'P2') {
              requiredMaterials['R1'] = 1;
              requiredMaterials['R2'] = 1;
            } else if (line.product === 'P3') {
              requiredMaterials['R2'] = 2;
              requiredMaterials['R3'] = 1;
            } else if (line.product === 'P4') {
              requiredMaterials['R2'] = 1;
              requiredMaterials['R3'] = 1;
              requiredMaterials['R4'] = 2;
            }
            
            // 检查所有需要的原材料是否都已经耗尽（数量为0）
            let allMaterialsExhausted = true;
            for (const [materialType, _] of Object.entries(requiredMaterials)) {
              const material = newRawMaterials.find(m => m.type === materialType);
              if (material && material.quantity > 0) {
                allMaterialsExhausted = false;
                break;
              }
            }
            
            // 如果所有所需原材料都已耗尽，将生产线状态改为"stopped"（停产）
            if (allMaterialsExhausted) {
              // 更新生产线状态
              newFactories[factoryIndex].productionLines[lineIndex] = {
                ...line,
                status: 'stopped',
                inProgressProducts: 0, // 清空在制品
              };
              
              // 记录停产的生产线信息
              stoppedLines.push({
                lineName: line.name,
                product: line.product,
                requiredMaterials: Object.keys(requiredMaterials)
              });
            }
          }
        });
      });
      
      // 更新生产/完工入库日志
      const productionLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-production`,
        year: newYear,
        quarter: newQuarter,
        timestamp: Date.now(),
        description: `更新生产/完工入库，本季度生产完成：${totalProduced}个产品，当前成品库存：${newFinishedProducts.map(p => `${p.type}: ${p.quantity}`).join(', ')}`,
        cashChange: 0,
        newCash: initialCash + cashIncrease - rdInvestment,
        operator: '系统自动',
      };
      
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

      // 年度台账：累计本季度自动发生的费用
      let ledger: AnnualLedger = {
        ...state.state.operation.annualLedger,
        interestExpense: state.state.operation.annualLedger.interestExpense + shortSettlement.interest,
      };

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
          });
        }
      }

      // e-3 支付租金/购买厂房：小厂房租赁，年末付租金3M/年（大厂房自有）
      let rentCost = 0;
      if (isYearEnd) {
        state.state.production.factories.forEach(factory => {
          if (factory.type === 'small') rentCost += 3;
        });
        if (rentCost > 0) {
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
      }

      // 10. 支付行政管理费（第四季度扣除1M，运行控制表：季度-16）
      const adminCost = newQuarter === 4 ? 1 : 0;
      if (adminCost > 0) {
        ledger = { ...ledger, adminFee: ledger.adminFee + adminCost };
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
        });
      }

      // 台账累计年末费用（维护/租金/利息）
      if (isYearEnd) {
        ledger = {
          ...ledger,
          maintenanceFee: ledger.maintenanceFee + maintenanceCost,
          rentFee: ledger.rentFee + rentCost,
          interestExpense: ledger.interestExpense + longInterest,
        };
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
          ledger = { ...ledger, depreciation: ledger.depreciation + depreciationTotal };
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
          });
        }
      }

      // 年末结账：利润表、所得税（计入应付税金下年初交纳）、权益结转、报表归档
      let closingStatement: ReturnType<typeof incomeStatement> | null = null;
      if (isYearEnd) {
        closingStatement = incomeStatement(ledger);
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
        });
      }

      // 总现金支出（所得税不在结账时扣：计入应付税金、下年初交纳）
      const totalCashOut = maintenanceCost + rentCost + longInterest + longPrincipal + adminCost + rdInvestment;

      // 计算新的现金余额
      const newCash = initialCash - shortSettlement.due + cashIncrease - totalCashOut;
      if (newCash < 0) {
        return { validationError: `本季度现金收支后将透支（缺口 ${-newCash}M），请先贴现应收账款或申请贷款` };
      }
      const cashChange = -shortSettlement.due + cashIncrease - totalCashOut;
      const finalCash = newCash;
      const finalCashChange = cashChange;

      // 回填年末各项日志的现金余额（按发生顺序）
      {
        let running = initialCash - shortSettlement.due + cashIncrease;
        yearEndLogs.forEach(log => {
          running += log.cashChange;
          log.newCash = running;
        });
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
      const quarterEndLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}-end`,
        year: newYear,
        quarter: newQuarter,
        timestamp: Date.now(),
        description: detailedDescription,
        cashChange: finalCashChange,
        newCash: finalCash,
        operator: '系统自动',
      };

      // 年度结束日志记录（结账日志已在上方年末序列生成）
      let yearEndLog: FinancialLogRecord | null = null;
      
      // 更新市场开发进度 - 按照季度跟进
      const updatedMarkets = state.state.marketing.markets.map(market => {
        if (market.status === 'developing') {
          // 计算新进度（每季度+1）
          const newProgress = market.developmentProgress + 1;
          // 将年转换为季度：1年=4季度
          const requiredProgress = market.type === 'local' || market.type === 'regional' ? 4 : 
                                  market.type === 'domestic' ? 8 : 
                                  market.type === 'asian' ? 12 : 16;
          
          return {
            ...market,
            developmentProgress: newProgress,
            status: newProgress >= requiredProgress ? ('available' as const) : ('developing' as const)
          };
        }
        return market;
      });
      
      // 更新ISO认证进度
      const updatedISOCertifications = state.state.marketing.isoCertifications.map(iso => {
        if (iso.status === 'certifying') {
          const newProgress = iso.certificationProgress + 1;
          const requiredProgress = iso.type === 'ISO9000' ? 3 : 4;
          
          return {
            ...iso,
            certificationProgress: newProgress,
            status: newProgress >= requiredProgress ? ('certified' as const) : ('certifying' as const)
          };
        }
        return iso;
      });
      
      // 构建所有日志记录
      const allLogs = [shortSettlementLog, quarterStartLog, arLog, materialArrivalLog, productionLog, quarterEndLog];
      // 只有当有研发投资时才添加研发投资日志
      if (rdLog) {
        allLogs.splice(3, 0, rdLog); // 插入到arLog之后
      }
      allLogs.push(...yearEndLogs);
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
          annualLedger: closingStatement ? emptyLedger() : ledger,
          yearlyLedgers: closingStatement
            ? { ...state.state.operation.yearlyLedgers, [closingYear]: ledger }
            : state.state.operation.yearlyLedgers,
          yearlyIncomeStatements: closingStatement
            ? { ...state.state.operation.yearlyIncomeStatements, [closingYear]: closingStatement }
            : state.state.operation.yearlyIncomeStatements,
        },
        finance: {
          ...state.state.finance,
          cash: finalCash,
          accountsReceivable: newAR,
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
