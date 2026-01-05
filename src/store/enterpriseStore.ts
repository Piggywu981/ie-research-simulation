import { create } from 'zustand';
import { EnterpriseState, SaveFile, ProductionLine, FinancialLogRecord, Order } from '../types/enterprise';

// 全局状态，用于跟踪重置次数
let resetCount = 0;

// 企业初始状态
const initialState: EnterpriseState = {
  finance: {
    cash: 40, // 40M（根据规则设定的初始现金）
    longTermLoan: {
      amount: 0, // 初始贷款为0
      term: 12, // 3年 = 12季度
      interestRate: 0.1, // 10%
      maxAmount: 40, // 最多40M
      minAmount: 20, // 每次20M
    },
    shortTermLoan: {
      amount: 0, // 初始贷款为0
      term: 4, // 1年 = 4季度
      interestRate: 0.05, // 5%
      maxAmount: 40, // 最多40M
      minAmount: 20, // 每次20M
      lendingPeriods: [1, 6], // 1月和6月放贷（对应季度1和季度3）
    },
    accountsReceivable: [0, 0, 0, 0], // 初始无应收账款
    accountsPayable: 0,
    taxesPayable: 0, // 初始无应交税
    equity: 60 + 16 + 0 + 0 + 0 - 40, // 总资产 - 负债 = 权益 (厂房40+20 + 设备16 + 原料0 + 成品0 + 在制品0) - 现金40 = 36
    retainedProfit: 7, // 利润留存
    annualNetProfit: 0, // 初始年度净利
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
            inProgressProducts: 0, // 0个P1在制品，价值0M
            installationProgress: 0, // 已完成安装
            conversionProgress: 0, // 未在转产
          },
        ],
      },
      {
        id: 'factory-2',
        name: '企业1小厂房',
        type: 'small',
        purchasePrice: 20, // 小厂房价值20M
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
            inProgressProducts: 0, // 0个P1在制品，价值0M
            installationProgress: 0, // 已完成安装
            conversionProgress: 0, // 未在转产
          },
        ],
      },
    ],
    productRD: {
      P1: true, // 已完成研发
      P2: {
        completed: false,
        progress: 0, // 0/6
        totalInvestment: 0,
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
      { type: 'R1', name: '原材料1', quantity: 0, price: 1, leadTime: 1 }, // 0个R1，每个1M，共计0M
      { type: 'R2', name: '原材料2', quantity: 0, price: 1, leadTime: 1 },
      { type: 'R3', name: '原材料3', quantity: 0, price: 1, leadTime: 2 },
      { type: 'R4', name: '原材料4', quantity: 0, price: 1, leadTime: 2 },
    ],
    finishedProducts: [
      { type: 'P1', name: '产品1', quantity: 0, price: 2 }, // 0个P1，每个2M，共计0M
      { type: 'P2', name: '产品2', quantity: 0, price: 4 }, // P2=R1+R2+1M=3M，定价4M
      { type: 'P3', name: '产品3', quantity: 0, price: 6 }, // P3=2R2+R3+1M=4M，定价6M
      { type: 'P4', name: '产品4', quantity: 0, price: 8 }, // P4=R2+R3+2R4+1M=5M，定价8M
    ],
    rawMaterialOrders: [], // 初始无原料订单
  },
  marketing: {
    markets: [
      { type: 'local', name: '本地市场', status: 'available', developmentProgress: 4, annualMaintenanceCost: 1 }, // 已开通，进度4Q
      { type: 'regional', name: '区域市场', status: 'developing', developmentProgress: 0, annualMaintenanceCost: 1 }, // 第二年可用
      { type: 'domestic', name: '国内市场', status: 'unavailable', developmentProgress: 0, annualMaintenanceCost: 1 }, // 第三年可用
      { type: 'asian', name: '亚洲市场', status: 'unavailable', developmentProgress: 0, annualMaintenanceCost: 1 },
      { type: 'international', name: '国际市场', status: 'unavailable', developmentProgress: 0, annualMaintenanceCost: 1 },
    ],
    isoCertifications: [
      { type: 'ISO9000', name: 'ISO9000认证', status: 'uncertified', certificationProgress: 0, totalCost: 0 },
      { type: 'ISO14000', name: 'ISO14000认证', status: 'uncertified', certificationProgress: 0, totalCost: 0 },
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
        cashChange: 40,
        newCash: 40,
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
        cash: 40,
        description: '初始现金',
      },
    ],
  },
};

// 创建Zustand store
export const useEnterpriseStore = create<{
  state: EnterpriseState;
  saveFiles: SaveFile[];
  resetCount: number;
  // 财务操作
  updateCash: (amount: number, description?: string) => void;
  updateLongTermLoan: (amount: number, term: number) => void;
  updateShortTermLoan: (amount: number, term: number) => void;
  updateAccountsReceivable: (period: 0 | 1 | 2 | 3, amount: number) => void;
  updateTaxesPayable: (amount: number) => void;
  applyLongTermLoan: () => void;
  applyShortTermLoan: () => void;
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
    set({ 
      state: JSON.parse(JSON.stringify(saveFile.state)),
      resetCount: saveFile.resetCount
    });
    // 添加操作日志
    get().addOperationLog('加载存档', `加载存档：${saveFile.name}`);
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
  
  // 申请长期贷款
  applyLongTermLoan: () =>
    set((state) => {
      // 检查是否符合贷款条件
      if (state.state.operation.currentQuarter !== 4) {
        return state; // 只有第4季度才能申请长期贷款
      }
      if (state.state.finance.longTermLoan.amount >= 40) {
        return state; // 长期贷款已达上限
      }
      
      const loanAmount = 20; // 每次20M
      const newLongTermLoanAmount = state.state.finance.longTermLoan.amount + loanAmount;
      const newCash = state.state.finance.cash + loanAmount;
      
      // 记录财务日志
      const financialLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}`,
        year: state.state.operation.currentYear,
        quarter: state.state.operation.currentQuarter,
        timestamp: Date.now(),
        description: `申请长期贷款20M，期限3年，年息10%`,
        cashChange: loanAmount,
        newCash,
        operator: '企业1管理者',
      };
      
      return {
        state: {
          ...state.state,
          finance: {
            ...state.state.finance,
            longTermLoan: {
              ...state.state.finance.longTermLoan,
              amount: newLongTermLoanAmount,
            },
            cash: newCash,
          },
          operation: {
            ...state.state.operation,
            financialLogs: [financialLog, ...state.state.operation.financialLogs],
          },
        },
      };
    }),
  
  // 申请短期贷款
  applyShortTermLoan: () =>
    set((state) => {
      // 检查是否符合贷款条件
      if (![1, 3].includes(state.state.operation.currentQuarter)) {
        return state; // 只有第1和第3季度才能申请短期贷款
      }
      if (state.state.finance.shortTermLoan.amount >= 40) {
        return state; // 短期贷款已达上限
      }
      
      const loanAmount = 20; // 每次20M
      const newShortTermLoanAmount = state.state.finance.shortTermLoan.amount + loanAmount;
      const newCash = state.state.finance.cash + loanAmount;
      
      // 记录财务日志
      const financialLog: FinancialLogRecord = {
        id: `finlog-${Date.now()}`,
        year: state.state.operation.currentYear,
        quarter: state.state.operation.currentQuarter,
        timestamp: Date.now(),
        description: `申请短期贷款20M，期限1年，年息5%`,
        cashChange: loanAmount,
        newCash,
        operator: '企业1管理者',
      };
      
      return {
        state: {
          ...state.state,
          finance: {
            ...state.state.finance,
            shortTermLoan: {
              ...state.state.finance.shortTermLoan,
              amount: newShortTermLoanAmount,
            },
            cash: newCash,
          },
          operation: {
            ...state.state.operation,
            financialLogs: [financialLog, ...state.state.operation.financialLogs],
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
      const newSelectedOrders = state.state.marketing.selectedOrders.map((order) =>
        order.id === orderId ? { ...order, isDelivered: true } : order
      );
      
      const deliveredOrder = newSelectedOrders.find((order) => order.id === orderId);
      if (deliveredOrder) {
        // 更新成品库存
        const newFinishedProducts = state.state.logistics.finishedProducts.map((product) =>
          product.type === deliveredOrder.productType
            ? { ...product, quantity: product.quantity - deliveredOrder.quantity }
            : product
        );
        
        // 更新应收账款
        const newAR = [...state.state.finance.accountsReceivable] as [number, number, number, number];
        newAR[deliveredOrder.paymentPeriod - 1] += deliveredOrder.totalAmount;
        
        return {
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
          },
        };
      }
      
      return state;
    }),

  // 运营操作
  nextQuarter: () =>
    set((state) => {
      const newQuarter = state.state.operation.currentQuarter === 4 ? 1 : state.state.operation.currentQuarter + 1;
      const newYear = state.state.operation.currentQuarter === 4 ? state.state.operation.currentYear + 1 : state.state.operation.currentYear;
      
      // 季度初日志记录 - 季初现金盘点的初始数据
      const initialCash = state.state.finance.cash;
      
      // 1. 处理季初现金盘点
      // 2. 更新还贷/还本付息（这里简化处理，实际应根据贷款期限处理）
      // 3. 申请短期贷款（这里简化处理，实际应根据放贷月份处理）
      
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
        newCash: initialCash + cashIncrease,
        operator: '系统自动',
      };
      
      // 5. 更新生产研发进度
      const updatedProductRD = { ...state.state.production.productRD };
      let rdInvestment = 0;
      // 记录研发完成的产品
      const completedProducts: string[] = [];
      for (const product of ['P2', 'P3', 'P4'] as const) {
        // 只对已经投资但未完成的产品更新进度
        if (!updatedProductRD[product].completed && updatedProductRD[product].totalInvestment > 0) {
          // 每个季度研发进度+1
          const newProgress = updatedProductRD[product].progress + 1;
          const requiredProgress = 6; // P2、P3、P4都改为6个季度
          updatedProductRD[product] = {
            ...updatedProductRD[product],
            progress: Math.min(newProgress, requiredProgress),
            completed: newProgress >= requiredProgress,
          };
          // 记录研发完成的产品
          if (newProgress >= requiredProgress) {
            completedProducts.push(product);
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
      
      // 8. 计算季度维护成本（如果是新的一年的第1季度）
      let maintenanceCost = 0;
      if (newQuarter === 1) {
        // 每年支付一次维护费
        state.state.production.factories.forEach(factory => {
          factory.productionLines.forEach(line => {
            maintenanceCost += line.maintenanceCost;
          });
        });
      }
      
      // 9. 计算贷款利息
      // 长期贷款利息（每年支付）
      let longTermInterest = 0;
      if (newQuarter === 1) {
        longTermInterest = state.state.finance.longTermLoan.amount * state.state.finance.longTermLoan.interestRate;
      }
      
      // 短期贷款利息（每季度支付）
      const shortTermInterest = state.state.finance.shortTermLoan.amount * state.state.finance.shortTermLoan.interestRate;
      
      // 总利息支出
      const totalInterest = longTermInterest + shortTermInterest;
      
      // 10. 支付行政管理费（第四季度开始时扣除1M）
      const adminCost = newQuarter === 4 ? 1 : 0;
      
      // 总现金支出
      const totalCashOut = maintenanceCost + totalInterest + adminCost + rdInvestment;
      
      // 计算新的现金余额
      const newCash = state.state.finance.cash + cashIncrease - totalCashOut;
      const cashChange = cashIncrease - totalCashOut;
      
      // 处理年度所得税（第四季度结束时）
      let taxAmount = 0;
      if (state.state.operation.currentQuarter === 4) {
        // 计算所得税（假设税率为25%）
        const annualProfit = state.state.finance.annualNetProfit;
        taxAmount = annualProfit > 0 ? Math.round(annualProfit * 0.25 * 100) / 100 : 0;
      }
      
      // 扣除所得税后的现金余额
      const finalCash = newCash - taxAmount;
      const finalCashChange = cashChange - taxAmount;
      
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
      if (maintenanceCost > 0) {
        detailedDescription += ` - 设备维护费 ${maintenanceCost}M`;
      }
      if (longTermInterest > 0) {
        detailedDescription += ` - 长期贷款利息 ${longTermInterest}M`;
      }
      if (shortTermInterest > 0) {
        detailedDescription += ` - 短期贷款利息 ${shortTermInterest}M`;
      }
      if (adminCost > 0) {
        detailedDescription += ` - 行政管理费 ${adminCost}M`;
      }
      if (rdInvestment > 0) {
        detailedDescription += ` - 研发投资 ${rdInvestment}M`;
      }
      if (taxAmount > 0) {
        detailedDescription += ` - 年度所得税 ${taxAmount}M`;
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
      
      // 年度结束日志记录
      let yearEndLog: FinancialLogRecord | null = null;
      if (state.state.operation.currentQuarter === 4) {
        yearEndLog = {
          id: `finlog-${Date.now()}-yearend`,
          year: newYear,
          quarter: newQuarter,
          timestamp: Date.now(),
          description: `第${state.state.operation.currentYear}年结束，年度结账，年度所得税：${taxAmount}M`,
          cashChange: -taxAmount,
          newCash: finalCash,
          operator: '系统自动',
        };
      }
      
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
      const allLogs = [quarterStartLog, arLog, materialArrivalLog, productionLog, quarterEndLog];
      // 只有当有研发投资时才添加研发投资日志
      if (rdLog) {
        allLogs.splice(2, 0, rdLog); // 插入到arLog之后
      }
      if (yearEndLog) {
        allLogs.push(yearEndLog);
      }
      
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
        },
        finance: {
          ...state.state.finance,
          cash: finalCash,
          accountsReceivable: newAR,
          // 新年度重置年度净利润
          annualNetProfit: newYear > state.state.operation.currentYear ? 0 : state.state.finance.annualNetProfit,
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
