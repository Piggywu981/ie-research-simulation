// 财务数据类型
export interface FinanceData {
  // 现金
  cash: number;
  // 长期贷款
  longTermLoan: {
    amount: number;
    term: number; // 剩余期限（季度）
    interestRate: number;
    maxAmount: number; // 最大贷款金额
    minAmount: number; // 最小贷款金额
  };
  // 短期贷款
  shortTermLoan: {
    amount: number;
    term: number; // 剩余期限（季度）
    interestRate: number;
    maxAmount: number; // 最大贷款金额
    minAmount: number; // 最小贷款金额
    lendingPeriods: number[]; // 放贷月份
  };
  // 应收账款（分4期）
  accountsReceivable: [number, number, number, number];
  // 应付款
  accountsPayable: number;
  // 应交税
  taxesPayable: number;
  // 股东资本
  equity: number;
  // 利润留存
  retainedProfit: number;
  // 年度净利
  annualNetProfit: number;
}

// 生产线类型
export interface ProductionLine {
  id: string;
  name: string;
  type: 'automatic' | 'semi-automatic' | 'manual' | 'flexible';
  status: 'running' | 'installing' | 'converting' | 'maintaining' | 'idle' | 'selling';
  product: 'P1' | 'P2' | 'P3' | 'P4' | null;
  purchasePrice: number;
  installationPeriod: number;
  productionPeriod: number;
  conversionPeriod: number;
  conversionCost: number;
  maintenanceCost: number;
  salvageValue: number;
  remainingLife: number; // 剩余使用年限
  inProgressProducts: number; // 在制品数量
  installationProgress: number; // 安装进度（0到installationPeriod）
  conversionProgress: number; // 转产进度（0到conversionPeriod）
}

// 厂房类型
export interface Factory {
  id: string;
  name: string;
  type: 'large' | 'small';
  purchasePrice: number;
  capacity: number; // 可容纳生产线数量
  productionLines: ProductionLine[];
}

// 生产数据类型
export interface ProductionData {
  factories: Factory[];
  // 产品研发状态
  productRD: {
    P1: boolean; // 是否完成研发
    P2: {
      completed: boolean;
      progress: number; // 研发进度（0-6）
      totalInvestment: number;
    };
    P3: {
      completed: boolean;
      progress: number;
      totalInvestment: number;
    };
    P4: {
      completed: boolean;
      progress: number;
      totalInvestment: number;
    };
  };
}

// 原材料类型
export interface RawMaterial {
  type: 'R1' | 'R2' | 'R3' | 'R4';
  name: string;
  quantity: number;
  price: number;
  leadTime: number; // 采购提前期（季度）
}

// 成品类型
export interface FinishedProduct {
  type: 'P1' | 'P2' | 'P3' | 'P4';
  name: string;
  quantity: number;
  price: number;
}

// 原材料订单类型
export interface RawMaterialOrder {
  id: string;
  materialType: 'R1' | 'R2' | 'R3' | 'R4';
  quantity: number;
  price: number;
  orderPeriod: number; // 下单季度
  arrivalPeriod: number; // 预计到货季度
}

// 物流数据类型
export interface LogisticsData {
  // 原材料库存
  rawMaterials: RawMaterial[];
  // 成品库存
  finishedProducts: FinishedProduct[];
  // 原材料订单
  rawMaterialOrders: RawMaterialOrder[];
}

// 市场类型
export interface Market {
  type: 'local' | 'regional' | 'domestic' | 'asian' | 'international';
  name: string;
  status: 'available' | 'developing' | 'unavailable';
  developmentProgress: number; // 开发进度（年）
  annualMaintenanceCost: number;
}

// ISO认证类型
export interface ISOCertification {
  type: 'ISO9000' | 'ISO14000';
  name: string;
  status: 'certified' | 'certifying' | 'uncertified';
  certificationProgress: number; // 认证进度（季度）
  totalCost: number;
}

// 广告投放类型
export interface Advertisement {
  id: string;
  amount: number;
  period: number; // 投放季度
  markets: string[]; // 覆盖市场
  products: string[]; // 覆盖产品
}

// 订单类型
export interface Order {
  id: string;
  productType: 'P1' | 'P2' | 'P3' | 'P4';
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  paymentPeriod: number; // 账期（季度）
  market: string; // 所属市场
  isSelected: boolean; // 是否已选择
  isDelivered: boolean; // 是否已交货
}

// 营销数据类型
export interface MarketingData {
  // 市场状态
  markets: Market[];
  // ISO认证状态
  isoCertifications: ISOCertification[];
  // 广告投放记录
  advertisements: Advertisement[];
  // 可选择订单
  availableOrders: Order[];
  // 已选择订单
  selectedOrders: Order[];
}

// 财务日志记录类型
export interface FinancialLogRecord {
  id: string;
  year: number;
  quarter: number;
  timestamp: number;
  description: string;
  cashChange: number;
  newCash: number;
  operator: string;
}

// 现金流量记录类型
export interface CashFlowRecord {
  year: number;
  quarter: number;
  cash: number;
  description: string;
}

// 运营流程类型
export interface OperationData {
  currentYear: number;
  currentQuarter: number;
  // 操作记录
  operationLogs: {
    id: string;
    time: string;
    operator: string;
    action: string;
    dataChange: string;
  }[];
  // 财务日志记录
  financialLogs: FinancialLogRecord[];
  // 年度规划
  annualPlan: {
    marketDevelopment: string[];
    productRD: string[];
    productionPlan: string;
    marketingPlan: string;
  };
  // 现金流量历史记录
  cashFlowHistory: CashFlowRecord[];
};

// 存档类型
export interface SaveFile {
  id: string;
  name: string;
  enterpriseName: string;
  timestamp: number;
  resetCount: number;
  state: EnterpriseState;
  createdAt: string;
}

// 生产线类型余量类型
export interface ProductionLineLimits {
  automatic: number;
  'semi-automatic': number;
  manual: number;
  flexible: number;
}

// 企业状态类型
export interface EnterpriseState {
  finance: FinanceData;
  productionLineLimits: ProductionLineLimits;
  production: ProductionData;
  logistics: LogisticsData;
  marketing: MarketingData;
  operation: OperationData;
};
