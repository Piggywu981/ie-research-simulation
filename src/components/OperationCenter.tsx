'use client';
import React, { useState } from 'react';
import { useEnterpriseStore } from '../store/enterpriseStore';
import { buildYearControlTable, toCSV, CONTROL_STEPS } from '../utils/controlTable';
import { FinancialLogRecord, SaveFile as EnterpriseSaveFile } from '../types/enterprise';

// 操作步骤类型定义
interface OperationStep {
  phase: string;
  step: string;
  description: string;
}

// 生产费用类型定义
interface ProductionCost {
  cost: number;
  product: string;
  lineType: string;
}

// 分组后的生产费用类型定义
interface GroupedProductionCost {
  cost: number;
  product: string;
  lineType: string;
  count: number;
}

// 简化的存档数据类型定义
type SaveFile = EnterpriseSaveFile;

// 工具函数：获取最新的存档数据
const getLatestSaveFile = (
  allSaveFiles: SaveFile[],
  year: number,
  quarter: number
): SaveFile | null => {
  const targetSaveFiles = allSaveFiles.filter(saveFile => {
    const saveYear = saveFile.state.operation.currentYear;
    const saveQuarter = saveFile.state.operation.currentQuarter;
    return saveYear === year && saveQuarter === quarter;
  });

  if (targetSaveFiles.length === 0) {
    return null;
  }

  // 按时间戳排序，获取最新的存档
  return [...targetSaveFiles].sort((a, b) => b.timestamp - a.timestamp)[0];
};

// 补充关键词：行名须与课程 CSV 原文一致（CONTROL_STEPS 是唯一来源），但事件文案的用词不完全同词——
// 年末租金日志是「支付厂房租金：…」、新租日志是「新租厂房：…」，都不含行名拆出的「支付租金」子串，
// 于是每年照付的租金在页面上只能显示成横杠。这里仅为本页单元格的判定补精确关键词；
// 导出 CSV 由 buildYearControlTable 按 stepId 取数，不经过本函数，因此不受影响。
const EXTRA_STEP_KEYWORDS: Record<string, string[]> = {
  '支付租金/购买厂房': ['支付厂房租金', '新租厂房'],
};

// 工具函数：匹配操作与日志
const matchOperation = (log: any, stepDescription: string): boolean => {
  const logText = (log.action || log.description || '').toLowerCase();
  const stepText = stepDescription.toLowerCase();

  // 关键词匹配
  const keyWords = [
    ...stepText.split(/[\s/、（）]/).filter(word => word.length > 0),
    ...(EXTRA_STEP_KEYWORDS[stepDescription] ?? []).map(word => word.toLowerCase()),
  ];
  const matchCount = keyWords.filter(word => logText.includes(word)).length;

  // 如果匹配到2个以上关键词，或完全包含，或部分匹配
  return (
    matchCount >= 2 ||
    logText.includes(stepText) ||
    stepText.includes(logText) ||
    (logText.length > 0 && keyWords.some(word => logText.includes(word)))
  );
};

// 工具函数：获取生产线数据
const getProductionLineData = (
  allSaveFiles: SaveFile[],
  year: number,
  quarter: number
) => {
  // 查找指定年份和季度的存档
  const targetSaveFiles = allSaveFiles.filter(save => {
    return save.state.operation.currentYear === year && 
           save.state.operation.currentQuarter === quarter;
  });

  if (targetSaveFiles.length === 0) {
    return [];
  }

  // 按时间戳排序，获取该季度的所有存档
  const sortedSaves = [...targetSaveFiles].sort((a, b) => a.timestamp - b.timestamp);
  
  // 获取最新的存档
  const latestSave = sortedSaves[sortedSaves.length - 1];
  
  // 检查该季度是否有生产线处于running状态
  const runningLines = latestSave.state.production.factories.flatMap((factory: any) =>
    factory.productionLines.filter((line: any) => line.status === 'running')
  );
  
  return runningLines;
};

// 工具函数：计算生产费用
const calculateProductionCosts = (productionLines: any[]): ProductionCost[] => {
  return productionLines.map(line => {
    // 加工费用：根据生产线类型不同
    const processingCost = 1; // 所有类型目前都为1，可根据业务需求调整
    const totalCost = processingCost;

    return {
      cost: -totalCost, // 支出为负数
      product: line.product,
      lineType: line.type
    };
  });
};

// 工具函数：合并同类生产费用
const groupProductionCosts = (costs: ProductionCost[]): GroupedProductionCost[] => {
  const grouped = costs.reduce((acc, item) => {
    // 确保product和lineType是字符串
    const product = item.product || '未知产品';
    const lineType = item.lineType || '未知类型';
    const key = `${product}-${lineType}`;
    if (!acc[key]) {
      acc[key] = {
        cost: 0,
        product: product,
        lineType: lineType,
        count: 0
      };
    }
    acc[key].cost += item.cost;
    acc[key].count += 1;
    return acc;
  }, {} as Record<string, GroupedProductionCost>);

  return Object.values(grouped);
};

// 工具函数：格式化生产线类型
const formatLineType = (lineType: string): string => {
  switch (lineType) {
    case 'automatic':
      return '自';
    case 'semi-automatic':
      return '半';
    case 'manual':
      return '手';
    default:
      return '柔';
  }
};

// 工具函数：格式化生产费用显示
const formatProductionCost = (cost: GroupedProductionCost): string => {
  return `${cost.cost}M (${cost.product}，${formatLineType(cost.lineType)})`;
};

// 工具函数：获取季初现金盘点数据
const getQuarterStartInventory = (
  allSaveFiles: SaveFile[],
  year: number,
  quarter: number,
  financialLogs: FinancialLogRecord[],
  cashFlowHistory: any[]
) => {
  // 第一年第一季度使用初始数据
  if (year === 1 && quarter === 1) {
    return {
      cash: '40M',
      finishedProducts: '',
      rawMaterials: ''
    };
  }

  // 查找对应季度的存档（使用当前季度数据）
  const latestSave = getLatestSaveFile(allSaveFiles, year, quarter);

  if (latestSave) {
    // 从存档中获取数据
    return {
      cash: `${latestSave.state.finance.cash}M`,
      finishedProducts: latestSave.state.logistics.finishedProducts
        .filter(product => product.quantity > 0)
        .map(product => `${product.type}: ${product.quantity}`)
        .join(', '),
      rawMaterials: latestSave.state.logistics.rawMaterials
        .filter(material => material.quantity > 0)
        .map(material => `${material.type}: ${material.quantity}`)
        .join(', ')
    };
  } else {
    // 从日志/现金流历史获取数据。
    // 此处原有一条按描述文本 `季初现金盘点` 匹配 q-1 盘点日志的死分支（规格 §4.1 记录），
    // q-1 的真实描述是 `(现金M，原料，成品)` 括号串，永不命中，已删除。
    // 也不改为读那条日志的 newCash：它是 initialCash + 应收收现，不扣短贷本息与应付归还，
    // 显示出来是错数；季初现金仍以 cashFlowHistory（按季记账的实际余额）为准。
    let cash = '-';
    const cashFlow = cashFlowHistory.find(record => {
      return record.year === year && record.quarter === quarter;
    });
    if (cashFlow) {
      cash = `${cashFlow.cash}M`;
    }

    // 查找最近的库存数据
    const logsBeforeQuarter = financialLogs.filter(log => {
      return (log.year < year) || (log.year === year && log.quarter < quarter);
    });

    let finishedProducts = '';
    let rawMaterials = '';

    if (logsBeforeQuarter.length > 0) {
      const recentLog = [...logsBeforeQuarter].sort((a, b) => b.timestamp - a.timestamp)[0];

      if (recentLog.description.includes('原料库存')) {
        const rawMaterialMatch = recentLog.description.match(/原料库存：([^，]+)/);
        if (rawMaterialMatch) {
          rawMaterials = rawMaterialMatch[1];
        }

        const finishedProductMatch = recentLog.description.match(/成品库存：([^，]+)/);
        if (finishedProductMatch) {
          finishedProducts = finishedProductMatch[1];
        }
      }
    }

    return {
      cash,
      finishedProducts,
      rawMaterials
    };
  }
};

// 工具函数：格式化库存显示
const formatInventory = (cash: string, finishedProducts: string, rawMaterials: string): string => {
  let displayText = `${cash}，${finishedProducts}，${rawMaterials}`;

  // 清理显示文本，确保没有多余的逗号和空格
  displayText = displayText.replace(/，+/g, '，');
  displayText = displayText.replace(/，，/g, '，');
  displayText = displayText.replace(/，$/g, '');
  displayText = displayText.replace(/\s+/g, ' ').trim();

  return displayText;
};

// 工具函数：获取季度末现金结余
const getQuarterEndCash = (
  financialLogs: FinancialLogRecord[],
  year: number,
  quarter: number
): string => {
  // 查找该季度的季度末日志
  const quarterEndLog = financialLogs.find(log => {
    return (
      log.year === year &&
      log.quarter === quarter &&
      log.description.includes('季度结束现金变动')
    );
  });

  if (quarterEndLog) {
    return `${quarterEndLog.newCash}M`;
  }

  // 查找该季度的任何日志
  const quarterLogs = financialLogs.filter(log => {
    return log.year === year && log.quarter === quarter;
  });

  if (quarterLogs.length > 0) {
    // 显示最后一个日志的现金余额
    const lastQuarterLog = [...quarterLogs].sort((a, b) => b.timestamp - a.timestamp)[0];
    return `${lastQuarterLog.newCash}M`;
  }

  return '-';
};

// 工具函数：获取产品研发投资数据
const getRDDatum = (
  financialLogs: FinancialLogRecord[],
  year: number,
  quarter: number
): string => {
  // 查找该季度的研发投资日志
  const rdLogs = financialLogs.filter(log => {
    return (
      log.year === year &&
      log.quarter === quarter &&
      (log.description.includes('产品研发投资') ||
        (log.description.includes('投资') &&
          (log.description.includes('P2') ||
            log.description.includes('P3') ||
            log.description.includes('P4'))))
    );
  });

  if (rdLogs.length > 0) {
    // 格式化第一个研发日志
    const rdLog = rdLogs[0];
    // 从日志描述中提取产品名称
    const productMatch = rdLog.description.match(/P[234]/);
    const productName = productMatch ? productMatch[0] : '';

    return `${rdLog.cashChange >= 0 ? '+' : ''}${rdLog.cashChange}M ${productName ? `(${productName})` : ''}`;
  }

  return '-';
};

// 工具函数：获取原料订单数据
const getMaterialOrderDatum = (
  financialLogs: FinancialLogRecord[],
  year: number,
  quarter: number
): string => {
  // 查找该季度的原料订单日志
  const materialOrderLogs = financialLogs.filter(log => {
    return (
      log.year === year &&
      log.quarter === quarter &&
      log.description.includes('下') &&
      log.description.includes('原料订单')
    );
  });

  if (materialOrderLogs.length > 0) {
    // 格式化所有原料订单日志
    const formattedOrders = materialOrderLogs.map(orderLog => {
      // 从日志描述中提取原料类型和数量
      const materialMatch = orderLog.description.match(/R[1234]/);
      const quantityMatch = orderLog.description.match(/\d+个/);

      const materialType = materialMatch ? materialMatch[0] : '';
      const quantity = quantityMatch ? quantityMatch[0].replace('个', '') : '';

      return `${orderLog.cashChange >= 0 ? '+' : ''}${orderLog.cashChange}M (${quantity}${materialType})`;
    });

    return formattedOrders.join(', ');
  }

  return '-';
};

// 工具函数：获取原材料入库数据
const getMaterialArrivalDatum = (
  rawMaterialOrders: any[],
  year: number,
  quarter: number
): string => {
  // 计算当前季度对应的总季度数（第1年第1季度=1，第1年第2季度=2，...，第2年第1季度=5）
  const currentTotalPeriod = (year - 1) * 4 + quarter;

  // 查找预计在当前季度到货的原材料订单
  const arrivingOrders = rawMaterialOrders.filter(order => {
    return order.arrivalPeriod === currentTotalPeriod;
  });

  if (arrivingOrders.length > 0) {
    // 格式化所有到货的原料订单
    const formattedArrivals = arrivingOrders.map(order => {
      return `${order.quantity}${order.materialType}`;
    });

    return formattedArrivals.join(', ');
  }

  return '-';
};

// 工具函数：获取其他现金收支数据（广告投放）
const getOtherCashFlowDatum = (
  financialLogs: FinancialLogRecord[],
  year: number,
  quarter: number
): string => {
  // 排除依据是日志的 kind 字段（规格 §4.1），不再靠描述文本：
  // 原来这一串 `!description.includes(...)` 负向关键词里，`季初现金盘点` 永不命中
  // （q-1 的真实描述是 `(现金M，原料，成品)` 括号串），其余关键词又要与下面的「广告」
  // 同时成立才可能生效——系统生成的日志里没有这种交集，真出现时（玩家在 q-17 自填文本）
  // 该条目本就属于本行、排除它反而漏显。整段只会误导后人，故删；季度末重述行由 kind 排除。
  const otherLogs = financialLogs.filter(log => {
    return (
      log.year === year &&
      log.quarter === quarter &&
      log.kind === 'flow' &&
      log.description.includes('广告')
    );
  });

  if (otherLogs.length > 0) {
    // 格式化每条广告投放记录
    const formattedLogs = otherLogs.map(log => {
      return `${log.cashChange >= 0 ? '+' : ''}${log.cashChange}M (广告投放)`;
    });
    return formattedLogs.join(', ');
  }

  return '-';
};

// 工具函数：计算季度收入或支出合计
// 导出仅为让「页面消费方只加 flow」这条判据可被单测钉住（与 CSV 导出器同源），页面行为不变。
// 规格 §4.1：只加 flow——summary（季度结束现金变动）重述的是同季其它日志的净额，计入即重复一遍。
export const calculateQuarterTotal = (
  financialLogs: FinancialLogRecord[],
  year: number,
  quarter: number,
  isIncome: boolean
): number => {
  return financialLogs
    .filter(log => log.year === year && log.quarter === quarter && log.kind === 'flow')
    .reduce((sum, log) => {
      const change = isIncome
        ? (log.cashChange > 0 ? log.cashChange : 0)
        : (log.cashChange < 0 ? log.cashChange : 0);
      return sum + change;
    }, 0);
};

// 工具函数：格式化合计显示
const formatTotal = (total: number, isIncome: boolean): string => {
  if (total === 0) {
    return '-';
  }
  return `${isIncome ? (total > 0 ? '+' : '') : ''}${total}M`;
};

// 操作步骤数据：与导出器共用 CONTROL_STEPS，避免两份行名各改一处
const OPERATION_STEPS: OperationStep[] = CONTROL_STEPS.map(s => ({
  phase: s.phase,
  step: s.phase === '季度' ? s.id.slice(2) : '',
  description: s.name,
}));

// 操作记录组件
const OperationLogs: React.FC<{
  logs: Array<{
    id: string;
    time: string;
    operator: string;
    action: string;
    dataChange: string;
  }>;
}> = ({ logs }) => {
  // 导出日志功能
  const exportLogs = () => {
    // 生成日志文件内容
    const logContent = logs
      .map(
        log => `${log.time} | ${log.operator} | ${log.action} | ${log.dataChange}`
      )
      .join('\n');

    // 创建Blob对象
    const blob = new Blob([logContent], { type: 'text/plain' });

    // 创建下载链接
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `企业1-操作日志-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`;

    // 触发下载
    document.body.appendChild(a);
    a.click();

    // 清理
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="dashboard-card">
      <div className="flex justify-between items-center mb-4">
        <h2 className="dashboard-title">操作记录</h2>
        {logs.length > 0 && (
          <button
            onClick={exportLogs}
            className="bg-blue-600 text-white px-3 py-1 rounded-md text-sm hover:bg-blue-700 transition-colors"
          >
            导出日志
          </button>
        )}
      </div>

      {logs.length === 0 ? (
        <div className="text-center py-8 text-gray-500">暂无操作记录</div>
      ) : (
        <div className="max-h-80 overflow-y-auto space-y-3">
          {logs.map(log => (
            <div key={log.id} className="border border-gray-200 rounded-lg p-4 bg-white">
              <div className="flex justify-between items-start mb-2">
                <div className="font-medium">{log.action}</div>
                <div className="text-xs text-gray-500">{log.time}</div>
              </div>
              <div className="text-sm text-gray-600">{log.dataChange}</div>
              <div className="text-xs text-gray-500 mt-1">操作人: {log.operator}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// 运营概览组件
const OperationOverview: React.FC<{
  currentYear: number;
  currentQuarter: number;
  operationLogsCount: number;
  onNextQuarter: () => void;
}> = ({ currentYear, currentQuarter, operationLogsCount, onNextQuarter }) => {
  return (
    <div className="dashboard-card">
      <h2 className="dashboard-title">运营概览</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-blue-50 p-4 rounded-lg">
          <div className="text-sm text-blue-600 mb-1">当前年度</div>
          <div className="text-2xl font-bold text-blue-800">第{currentYear}年</div>
        </div>
        <div className="bg-green-50 p-4 rounded-lg">
          <div className="text-sm text-green-600 mb-1">当前季度</div>
          <div className="text-2xl font-bold text-green-800">第{currentQuarter}季度</div>
        </div>
        <div className="bg-yellow-50 p-4 rounded-lg">
          <div className="text-sm text-yellow-600 mb-1">操作记录</div>
          <div className="text-2xl font-bold text-yellow-800">{operationLogsCount}条</div>
        </div>
      </div>

      {/* 控制按钮组 */}
      <div className="mt-4 flex flex-wrap justify-center gap-3">
        <button
          className="bg-blue-500 text-white py-2 px-6 rounded-lg hover:bg-blue-600 font-medium flex items-center space-x-2"
          onClick={onNextQuarter}
        >
          <span>进入下一季度</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M14 5l7 7m0 0l-7 7m7-7H3"
            />
          </svg>
        </button>
      </div>
    </div>
  );
};

// 其他现金收支情况登记（运行控制表：季度-17）
const OtherCashFlowForm: React.FC<{
  onRegister: (description: string, amount: number) => void;
}> = ({ onRegister }) => {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('1');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(amount);
    if (!description.trim() || !Number.isFinite(parsed) || parsed === 0) return;
    onRegister(description.trim(), parsed);
    setDescription('');
    setAmount('1');
  };

  return (
    <div className="dashboard-card">
      <h2 className="dashboard-title">其他现金收支情况登记（控制表行17）</h2>
      <p className="text-sm text-gray-500 mb-3">登记标准流程外的现金收支；支出填负数、收入填正数，单位 M。</p>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="收支说明，如：出售废料"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]"
        />
        <input
          type="number"
          step="any"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-28"
        />
        <button
          type="submit"
          className="bg-green-500 text-white py-2 px-5 rounded-lg hover:bg-green-600 text-sm font-medium"
        >
          登记收支
        </button>
      </form>
    </div>
  );
};

// 工具函数：生成CSV内容

// 按年导出运行控制表（第X年运行控制表.csv，含年初/季度/年末全部30行）
const YearlyExportButtons: React.FC<{
  allSaveFiles: EnterpriseSaveFile[];
  financialLogs: FinancialLogRecord[];
  currentYear: number;
}> = ({ allSaveFiles, financialLogs, currentYear }) => {
  const handleExportYear = (year: number) => {
    const table = buildYearControlTable(year, financialLogs, allSaveFiles);
    const csvContent = toCSV(table, year);
    const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `第${year}年运行控制表.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const yearsWithData = new Set(financialLogs.map((l) => l.year));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-gray-600">导出运行控制表：</span>
      {[1, 2, 3, 4].map((year) => {
        const hasData = yearsWithData.has(year) || (year === currentYear && financialLogs.length > 0);
        return (
          <button
            key={year}
            onClick={() => handleExportYear(year)}
            disabled={!hasData}
            className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center space-x-1 ${
              hasData
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            <span>第{year}年</span>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
};

// 季度单元格组件
const QuarterCell: React.FC<{
  allSaveFiles: SaveFile[];
  financialLogs: FinancialLogRecord[];
  cashFlowHistory: any[];
  rawMaterialOrders: any[];
  step: OperationStep;
  year: number;
  quarter: number;
  currentState: any;
}> = ({
  allSaveFiles,
  financialLogs,
  cashFlowHistory,
  rawMaterialOrders,
  step,
  year,
  quarter,
  currentState
}) => {
  // 根据日志记录判断该操作是否完成：必须限定在本年本季度，
  // 否则一次操作（如第2年第3季度出售厂房）会把 4 张年表 ×4 季共 16 个格子全部点亮，
  // 与按 stepId+年+季取数的导出 CSV（其余 15 格为 —）自相矛盾。
  // 本函数与 buildYearControlTable 的双轨推导是已知取舍，改由单一来源渲染另行跟进（见规格 §10）。
  const isCompleted = financialLogs.some(log => {
    return log.year === year && log.quarter === quarter && matchOperation(log, step.description);
  });

  // 根据财务日志获取具体数值。候选集排除 summary：matchOperation 是宽松的文本匹配，
  // 而 v4 起 summary.cashChange 是「整季净额重述」，一旦被当成某个操作步骤的金额就会重复计
  // （isCompleted 保留看全部日志，故重述串仍能点亮格子，只是不供数值）。
  const financialLog = financialLogs.find(log => {
    return log.kind !== 'summary' && log.year === year && log.quarter === quarter && matchOperation(log, step.description);
  });

  // 检查是否有其他相关日志
  const hasRelatedLog = financialLogs.some(log => {
    return log.year === year && log.quarter === quarter;
  });

  // 特殊处理：季初现金盘点
  if (step.description.includes('季初现金盘点')) {
    const { cash, finishedProducts, rawMaterials } = getQuarterStartInventory(
      allSaveFiles,
      year,
      quarter,
      financialLogs,
      cashFlowHistory
    );
    const displayText = formatInventory(cash, finishedProducts, rawMaterials);

    return (
      <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
        <div className="text-sm font-medium text-blue-600">{displayText}</div>
      </td>
    );
  }

  // 特殊处理：现金结余数量
  if (step.description.includes('本季库存（现金）结余数量')) {
    const cashBalance = getQuarterEndCash(financialLogs, year, quarter);

    return (
      <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
        <div className="text-sm font-medium text-blue-600">{cashBalance}</div>
      </td>
    );
  }

  // 特殊处理：产品研发投资
  if (step.description.includes('产品研发投资')) {
    const rdDatum = getRDDatum(financialLogs, year, quarter);

    if (rdDatum !== '-') {
      return (
        <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
          <div className="text-sm font-medium text-blue-600">{rdDatum}</div>
        </td>
      );
    }

    return (
      <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
        <div className="w-6 h-0 border-t border-gray-400 mx-auto"></div>
      </td>
    );
  }

  // 特殊处理：下原料订单
  if (step.description.includes('下原料订单')) {
    const materialOrderDatum = getMaterialOrderDatum(financialLogs, year, quarter);

    if (materialOrderDatum !== '-') {
      return (
        <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
          <div className="text-sm font-medium text-blue-600">{materialOrderDatum}</div>
        </td>
      );
    }

    return (
      <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
        <div className="w-6 h-0 border-t border-gray-400 mx-auto"></div>
      </td>
    );
  }

  // 特殊处理：原材料入库/更新原材料单
  if (step.description.includes('原材料入库/更新原材料单')) {
    const materialArrivalDatum = getMaterialArrivalDatum(rawMaterialOrders, year, quarter);

    if (materialArrivalDatum !== '-') {
      return (
        <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
          <div className="text-sm font-medium text-blue-600">{materialArrivalDatum}</div>
        </td>
      );
    }

    return (
      <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
        <div className="w-6 h-0 border-t border-gray-400 mx-auto"></div>
      </td>
    );
  }

  // 特殊处理：支付行政管理费
  if (step.description.includes('支付行政管理费')) {
    // 行政管理费固定发生在每年第四季度
    if (quarter === 4) {
      return (
        <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
          <div className="text-sm font-medium text-blue-600">-1M</div>
        </td>
      );
    }

    return (
      <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
        <div className="w-6 h-0 border-t border-gray-400 mx-auto"></div>
      </td>
    );
  }

  // 特殊处理：开始下一批生产
  if (step.description.includes('开始下一批生产')) {
    try {
      // 获取生产线数据
      const productionLineData = getProductionLineData(allSaveFiles, year, quarter);

      // 如果没有运行中的生产线，显示横线
      if (productionLineData.length === 0) {
        return (
          <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
            <div className="w-6 h-0 border-t border-gray-400 mx-auto"></div>
          </td>
        );
      }

      // 计算生产费用
      const productionCosts = calculateProductionCosts(productionLineData);
      // 合并同类项
      const groupedCosts = groupProductionCosts(productionCosts);
      // 格式化显示
      const formattedProduction = groupedCosts.map(formatProductionCost);

      return (
        <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
          <div className="text-sm font-medium text-blue-600">
            {formattedProduction.join('/')}
          </div>
        </td>
      );
    } catch (error) {
      return (
        <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
          <div className="w-6 h-0 border-t border-gray-400 mx-auto"></div>
        </td>
      );
    }
  }

  // 特殊处理：其他现金收支情况登记
  if (step.description.includes('其他现金收支情况登记')) {
    const otherCashFlowDatum = getOtherCashFlowDatum(financialLogs, year, quarter);

    if (otherCashFlowDatum !== '-') {
      return (
        <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
          <div className="text-sm font-medium text-blue-600">{otherCashFlowDatum}</div>
        </td>
      );
    }

    return (
      <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
        <div className="w-6 h-0 border-t border-gray-400 mx-auto"></div>
      </td>
    );
  }

  // 特殊处理：收入合计和支出合计
  if (
    step.description.includes('入库（收入）数量合计') ||
    step.description.includes('出库（现金支出）合计')
  ) {
    const isIncome = step.description.includes('收入');
    const total = calculateQuarterTotal(financialLogs, year, quarter, isIncome);
    const formattedTotal = formatTotal(total, isIncome);

    if (formattedTotal !== '-') {
      return (
        <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
          <div className="text-sm font-medium text-blue-600">{formattedTotal}</div>
        </td>
      );
    }
  }

  // 特殊处理：新年度规划会议和制定新年度计划固定在每年第一季度打勾
  if (
    step.description.includes('新年度规划会议') ||
    step.description.includes('制定新年度计划')
  ) {
    // 固定在每年第一季度显示为已完成
    if (quarter === 1) {
      return (
        <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
          <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center mx-auto">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
        </td>
      );
    } else {
      // 其他季度显示横杠占位符
      return (
        <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
          <div className="w-6 h-0 border-t border-gray-400 mx-auto"></div>
        </td>
      );
    }
  }

  // 默认情况
  return (
    <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
      {isCompleted ? (
        <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center mx-auto">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
      ) : financialLog && financialLog.cashChange !== 0 ? (
        // 如果有财务日志且金额不为0，显示具体数值
        <div className="text-sm font-medium text-blue-600">
          {financialLog.cashChange >= 0 ? '+' : ''}{financialLog.cashChange}M
        </div>
      ) : hasRelatedLog ? (
        // 如果该季度有日志但没有匹配的操作，显示横线
        <div className="w-6 h-0 border-t border-gray-400 mx-auto"></div>
      ) : (
        // 否则显示空圆圈
        <div className="w-6 h-6 rounded-full bg-gray-200 mx-auto"></div>
      )}
    </td>
  );
};

// 运营控制表组件
const OperationControlTable: React.FC<{
  allSaveFiles: SaveFile[];
  financialLogs: FinancialLogRecord[];
  cashFlowHistory: any[];
  rawMaterialOrders: any[];
  currentState: any;
}> = ({ allSaveFiles, financialLogs, cashFlowHistory, rawMaterialOrders, currentState }) => {
  return (
    <div className="dashboard-card">
      <div className="flex justify-between items-center mb-4">
        <h2 className="dashboard-title text-2xl font-bold text-green-600">模拟结束报告</h2>
        <YearlyExportButtons
          allSaveFiles={allSaveFiles}
          financialLogs={financialLogs}
          currentYear={financialLogs[0]?.year ?? 1}
        />
      </div>

      <div className="mb-4">
        <p className="text-lg font-medium">模拟已完成，共运行了4年16个季度</p>
        <p className="text-gray-600">以下是各年度运营情况汇总</p>
      </div>

      {/* 报告表格 */}
      {[1, 2, 3, 4].map(year => (
        <div key={year} className="mb-8">
          <h3 className="text-xl font-semibold mb-4">第{year}年运营控制表</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full border border-gray-200">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-4 py-2 text-left text-sm font-medium text-gray-600">序号</th>
                  <th className="border border-gray-300 px-4 py-2 text-left text-sm font-medium text-gray-600">请按照顺序执行下列各项操作</th>
                  <th className="border border-gray-300 px-4 py-2 text-center text-sm font-medium text-gray-600">第1季度</th>
                  <th className="border border-gray-300 px-4 py-2 text-center text-sm font-medium text-gray-600">第2季度</th>
                  <th className="border border-gray-300 px-4 py-2 text-center text-sm font-medium text-gray-600">第3季度</th>
                  <th className="border border-gray-300 px-4 py-2 text-center text-sm font-medium text-gray-600">第4季度</th>
                </tr>
              </thead>
              <tbody>
                {OPERATION_STEPS.map((step, index) => (
                  <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="border border-gray-300 px-4 py-2 text-sm text-gray-600">{step.step || ''}</td>
                    <td className="border border-gray-300 px-4 py-2 text-sm text-gray-700">{step.description}</td>
                    {[1, 2, 3, 4].map(quarter => (
                      <QuarterCell
                        key={quarter}
                        allSaveFiles={allSaveFiles}
                        financialLogs={financialLogs}
                        cashFlowHistory={cashFlowHistory}
                        rawMaterialOrders={rawMaterialOrders}
                        step={step}
                        year={year}
                        quarter={quarter}
                        currentState={currentState}
                      />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
};

// 主组件
const OperationCenter: React.FC = () => {
  const { state, nextQuarter, getSaveFiles, registerOtherCashFlow } = useEnterpriseStore();
  const { operation, production, logistics } = state;

  // 获取所有存档
  const allSaveFiles = getSaveFiles();

  return (
    <div className="space-y-6">
      {/* 游戏结束报告 */}
      {operation.isGameOver && (
        <OperationControlTable
          allSaveFiles={allSaveFiles}
          financialLogs={operation.financialLogs}
          cashFlowHistory={operation.cashFlowHistory}
          rawMaterialOrders={logistics.rawMaterialOrders}
          currentState={state}
        />
      )}

      {/* 运营概览（游戏未结束时显示） */}
      {!operation.isGameOver && (
        <OperationOverview
          currentYear={operation.currentYear}
          currentQuarter={operation.currentQuarter}
          operationLogsCount={operation.operationLogs.length}
          onNextQuarter={nextQuarter}
        />
      )}

      {/* 其他现金收支登记（控制表行17） */}
      {!operation.isGameOver && (
        <OtherCashFlowForm onRegister={registerOtherCashFlow} />
      )}

      {/* 按年导出运行控制表（运营中随时可导出已完成年度） */}
      <div className="dashboard-card">
        <YearlyExportButtons
          allSaveFiles={allSaveFiles}
          financialLogs={operation.financialLogs}
          currentYear={operation.currentYear}
        />
      </div>

      {/* 操作记录 */}
      <OperationLogs logs={operation.operationLogs} />
    </div>
  );
};

export default OperationCenter;