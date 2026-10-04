// 贷款台账记录（长贷/短贷统一建模，支持还本付息生命周期）
export interface LoanRecord {
  id: string;
  kind: 'long' | 'short';
  principal: number;
  rate: number; // 年息
  drawnAbs: number; // 放贷绝对季度
  termQuarters: number; // 期限（季度）
}

// 年度台账（利润表科目累计，随年末结账归档清零）
export interface AnnualLedger {
  salesRevenue: number;
  directCosts: number;
  adminFee: number;
  adFee: number;
  marketDevFee: number;
  rdFee: number;
  isoFee: number;
  conversionFee: number;
  maintenanceFee: number;
  rentFee: number;
  otherFee: number;
  depreciation: number;
  interestExpense: number;
  discountFee: number;
  extraExpense: number;
}

// 利润表计算结果
export interface IncomeStatementResult {
  grossProfit: number;
  beforeDepreciation: number;
  beforeInterest: number;
  pretax: number;
  tax: number;
  net: number;
}

// 财务数据类型
export interface FinanceData {
  // 现金
  cash: number;
  // 贷款台账
  loans: LoanRecord[];
  // 长期贷款（聚合展示字段，与台账联动）
  longTermLoan: {
    amount: number;
    term: number; // 剩余期限（季度）
    interestRate: number;
    maxAmount: number; // 最大贷款金额
    minAmount: number; // 最小贷款金额
  };
  // 短期贷款（聚合展示字段，与台账联动）
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
  status: 'running' | 'installing' | 'converting' | 'maintaining' | 'idle' | 'selling' | 'stopped'; // stopped表示因原材料不足等原因停产
  product: 'P1' | 'P2' | 'P3' | 'P4' | null;
  purchasePrice: number;
  installationPeriod: number;
  productionPeriod: number;
  conversionPeriod: number;
  conversionCost: number;
  maintenanceCost: number;
  salvageValue: number;
  remainingLife: number; // 剩余使用年限
  netValue: number; // 设备净值（折旧计提基数）
  builtInYear: number; // 安装完工年份（0 表示开局既有），当年建成不提折旧
  inProgressProducts: number; // 在制品数量
  installationProgress: number; // 安装进度（0到installationPeriod）
  conversionProgress: number; // 转产进度（0到conversionPeriod）
}

// 厂房持有方式
export type FactoryHolding = 'owned' | 'leased' | 'none';

// 厂房类型
export interface Factory {
  id: string;
  name: string;
  type: 'large' | 'small';
  purchasePrice: number;
  capacity: number; // 可容纳生产线数量
  productionLines: ProductionLine[];
  // 持有方式：自有 / 租赁 / 未持有（槽位保留但不可放置生产线）
  holding: FactoryHolding;
  // 本年度（年初时点）是否租赁中；租金结算只认此快照，不认实时 holding
  leasedThisYear: boolean;
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
      status: 'idle' | 'active' | 'completed'; // 分期研发：待启动/进行中/已完成
      paidQuarters: number; // 已支付研发投资的季度数（1M/季 × 6季）
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

// 原材料订单类型（orderPeriod/arrivalPeriod 为绝对季度索引，跨年不失序）
export interface RawMaterialOrder {
  id: string;
  materialType: 'R1' | 'R2' | 'R3' | 'R4';
  quantity: number;
  price: number;
  orderPeriod: number; // 下单绝对季度
  arrivalPeriod: number; // 预计到货绝对季度
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
  yearsInvested: number; // 累计投资年数
  investedThisYear: boolean; // 本年度是否已投资（开拓或维持）
  annualMaintenanceCost: number;
}

// ISO认证类型
export interface ISOCertification {
  type: 'ISO9000' | 'ISO14000';
  name: string;
  status: 'certified' | 'certifying' | 'uncertified';
  certificationProgress: number; // 认证进度（年）
  yearsInvested: number; // 累计投资年数
  investedThisYear: boolean; // 本年度是否已投资
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

// flow = 记录一次真实现金增减；summary = 整季净额重述，不得参与现金重演算（规格 §4.1）
export type LogKind = 'flow' | 'summary';

// 存档格式版本单点定义：store 的两处写入、迁移判断、包结构都必须引用它，避免再出现 §5.7 那类漂移
export const SAVE_FORMAT_VERSION = 4;

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
  stepId?: string; // 运行控制表步骤标记：'b-1'..'b-4'（年初）| 'q-1'..'q-20'（季度）| 'e-1'..'e-6'（年末）
  kind: LogKind;
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
  // 游戏结束标志
  isGameOver: boolean;
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
  // 本年度台账（年末结账后归档至 yearlyLedgers 并清零）
  annualLedger: AnnualLedger;
  // 历年台账归档
  yearlyLedgers: Record<number, AnnualLedger>;
  // 历年利润表归档
  yearlyIncomeStatements: Record<number, IncomeStatementResult>;
};

// 存档类型
export interface SaveFile {
  id: string;
  name: string;
  enterpriseName: string;
  timestamp: number;
  resetCount: number;
  version: number; // 存档格式版本：3=厂房权属/租赁快照，4=财务日志 flow/summary 分类
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
  // 运营暂停（教学讲解模式）：暂停期间所有变更类操作被拒绝
  isPaused: boolean;
};
