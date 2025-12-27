'use client';
import React from 'react';
import { useEnterpriseStore } from '../store/enterpriseStore';
import { FinancialLogRecord } from '../types/enterprise';

const OperationCenter: React.FC = () => {
  const { state, nextQuarter } = useEnterpriseStore();
  const { operation } = state;

  // 获取当前季度的操作步骤
  const getCurrentSteps = () => {
    const baseSteps = [
      '季初现金盘点',
      '更新短贷/还本付息',
      '申请短期贷款/高利贷',
      '更新应付款/归还应付款',
      '原材料入库/更新原料订单',
      '下原料订单',
      '更新生产/完工入库',
      '生产线操作（投资/变卖/转产）',
      '原材料/成品买卖（可选）',
      '开始下一批生产',
      '更新应收款/应收款收现',
      '出售厂房（可选）',
      '成品买卖（可选）',
      '按订单交货',
      '产品研发投资',
      '支付行政管理费（年末统一支付）',
      '登记其他现金收支',
      '统计入库（收入）合计',
      '统计出库（现金支出）合计',
      '计算本季库存（现金）结余',
    ];

    // 如果是年末，添加年末步骤
    if (operation.currentQuarter === 4) {
      return [
        ...baseSteps,
        '支付利息/更新长期贷款/申请长期贷款',
        '支付设备维护费',
        '支付租金/购买厂房（可选）',
        '计提折旧',
        '市场开拓/ISO资格认证投资（可选）',
        '结账（计算年度净利润）',
      ];
    }

    return baseSteps;
  };

  return (
    <div className="space-y-6">
      {/* 运营概览 */}
      <div className="dashboard-card">
        <h2 className="dashboard-title">运营概览</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="text-sm text-blue-600 mb-1">当前年度</div>
            <div className="text-2xl font-bold text-blue-800">第{operation.currentYear}年</div>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <div className="text-sm text-green-600 mb-1">当前季度</div>
            <div className="text-2xl font-bold text-green-800">第{operation.currentQuarter}季度</div>
          </div>
          <div className="bg-yellow-50 p-4 rounded-lg">
            <div className="text-sm text-yellow-600 mb-1">操作记录</div>
            <div className="text-2xl font-bold text-yellow-800">{operation.operationLogs.length}条</div>
          </div>
        </div>
        
        {/* 控制按钮组 */}
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <button
            className="bg-blue-500 text-white py-2 px-6 rounded-lg hover:bg-blue-600 font-medium flex items-center space-x-2"
            onClick={nextQuarter}
          >
            <span>进入下一季度</span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
          {/* 导出功能封装为函数 */}
          <button
            onClick={() => {
              const exportYearData = (exportYear: number) => {
                const { finance, logistics, production, marketing, operation } = state;
                
                // 从现金流量历史记录中获取全年各季度的数据
                const yearCashFlowData = operation.cashFlowHistory.filter(record => record.year === exportYear);
                
                // 从财务日志中获取各季度的现金余额
                const yearFinancialLogs = operation.financialLogs.filter(log => log.year === exportYear);
                
                // 获取所有存档文件，用于获取历史季度数据
                const saveFiles = JSON.parse(localStorage.getItem('enterpriseSaveFiles') || '[]');
                
                // 定义完整的操作步骤和数据
                const annualSteps = [
                  { id: 'annual-1', name: '新年度规划会议', data: '' },
                  { id: 'annual-2', name: '参加订货会/登记销售订单', data: `${marketing.availableOrders.length}个可用订单` },
                  { id: 'annual-3', name: '制定新年度计划', data: '' },
                  { id: 'annual-4', name: '支付应付税', data: `${finance.taxesPayable}M` }
                ];
                
                // 初始化季度数据对象
                const quarterData: Record<number, { cash: number; description: string }> = {
                  1: { cash: exportYear === 1 ? 40 : (saveFiles.find((file: any) => file.state?.operation?.currentYear === exportYear - 1 && file.state?.operation?.currentQuarter === 4)?.state?.operation?.cash || 40), description: '' },
                  2: { cash: 0, description: '' },
                  3: { cash: 0, description: '' },
                  4: { cash: 0, description: '' }
                };
                
                // 重新计算季度结束时的现金余额，考虑所有财务日志
                for (let quarter = 1; quarter <= 4; quarter++) {
                  // 获取当前季度的所有财务日志
                  const quarterLogs = yearFinancialLogs.filter(log => log.quarter === quarter);
                  
                  // 计算当前季度的现金变动总和
                  let cashChange = 0;
                  quarterLogs.forEach(log => {
                    cashChange += log.cashChange;
                  });
                  
                  // 计算季度结束现金余额
                  // 修复：本季库存结余 = 季初现金 + 季度支出（不重复计算收入）
                  // 只保留季初现金和支出部分，收入已包含在季初现金中
                  if (quarter === 1) {
                    // 季度1的初始现金是季初现金，只加上支出部分
                    // 计算支出部分（cashChange中为负的部分）
                    const expenseOnly = quarterLogs.reduce((sum, log) => sum + (log.cashChange < 0 ? log.cashChange : 0), 0);
                    quarterData[quarter].cash += expenseOnly;
                  } else {
                    // 后续季度的初始现金是上一季度的结束余额，加上当前季度的现金变动
                    quarterData[quarter].cash = quarterData[quarter - 1].cash + cashChange;
                  }
                  
                  quarterData[quarter].description = `第${exportYear}年第${quarter}季度现金余额`;
                }
                
                // 计算季初现金余额（季度1的季初现金是初始现金40M，后续季度的季初现金是上一季度的结束余额）
                const quarterStartCash: Record<number, number> = {
                  1: exportYear === 1 ? 40 : (saveFiles.find((file: any) => file.state?.operation?.currentYear === exportYear - 1 && file.state?.operation?.currentQuarter === 4)?.state?.operation?.cash || 40), // 第1年季度1的季初现金是初始现金40M，其他年份是上一年末的现金
                  2: quarterData[1]?.cash || 0, // 季度2的季初现金是季度1的结束余额
                  3: quarterData[2]?.cash || 0, // 季度3的季初现金是季度2的结束余额
                  4: quarterData[3]?.cash || 0  // 季度4的季初现金是季度3的结束余额
                };
                
                // 计算各季度的收入（序号18）和支出（序号19）
                const quarterlyIncome: Record<number, string> = { 1: '', 2: '', 3: '', 4: '' };
                const quarterlyExpense: Record<number, string> = { 1: '', 2: '', 3: '', 4: '' };
                
                // 从财务日志计算各季度的收入和支出
                for (let quarter = 1; quarter <= 4; quarter++) {
                  const quarterLogs = yearFinancialLogs.filter(log => log.quarter === quarter);
                  
                  // 计算季度收入（现金增加）
                  let totalIncome = 0;
                  let products = '';
                  
                  // 计算季度支出（现金减少）
                  let totalExpense = 0;
                  
                  quarterLogs.forEach(log => {
                    if (log.cashChange > 0) {
                      totalIncome += log.cashChange;
                    } else {
                      totalExpense += Math.abs(log.cashChange);
                    }
                    
                    // 提取产品信息（如果有）
                    if (log.description.includes('P1')) {
                      const p1Match = log.description.match(/(\d+)P1/g);
                      if (p1Match) {
                        products += p1Match.join(' ');
                      }
                    }
                    if (log.description.includes('P2')) {
                      const p2Match = log.description.match(/(\d+)P2/g);
                      if (p2Match) {
                        products += p2Match.join(' ');
                      }
                    }
                    if (log.description.includes('P3')) {
                      const p3Match = log.description.match(/(\d+)P3/g);
                      if (p3Match) {
                        products += p3Match.join(' ');
                      }
                    }
                    if (log.description.includes('P4')) {
                      const p4Match = log.description.match(/(\d+)P4/g);
                      if (p4Match) {
                        products += p4Match.join(' ');
                      }
                    }
                  });
                  
                  // 格式化序号18数据：资金收入 + 产品信息
                  if (totalIncome > 0) {
                    quarterlyIncome[quarter] = `${totalIncome}M ${products.trim()}`;
                  } else {
                    quarterlyIncome[quarter] = products.trim();
                  }
                  
                  // 格式化序号19数据：总支出（带负号）
                  quarterlyExpense[quarter] = totalExpense > 0 ? `-${totalExpense}M` : '';
                }
                
                // 筛选指定年份的存档，并按季度排序
                const yearSaveFiles = saveFiles
                  .filter((file: any) => file.state?.operation?.currentYear === exportYear)
                  .sort((a: any, b: any) => {
                    const quarterA = a.state?.operation?.currentQuarter || 0;
                    const quarterB = b.state?.operation?.currentQuarter || 0;
                    return quarterA - quarterB;
                  });
                
                // 获取指定季度的存档数据
                const getQuarterState = (quarter: number) => {
                  // 找到对应季度的存档
                  const saveFile = yearSaveFiles.find((file: any) => {
                    const fileQuarter = file.state?.operation?.currentQuarter || 0;
                    return fileQuarter === quarter;
                  });
                  
                  // 如果找到存档，返回存档数据；否则返回当前数据（针对当前季度）
                  if (saveFile) {
                    return saveFile.state;
                  }
                  return state;
                };
                
                // 创建季度特定的数据生成函数
                const getQuarterlyData = (quarter: number) => {
                  // 对于导出历史年份数据，显示所有季度数据
                  const quarterState = getQuarterState(quarter);
                  const { finance: quarterFinance, logistics: quarterLogistics, production: quarterProduction, marketing: quarterMarketing } = quarterState;
                  
                  return {
                    shortTermLoan: `短期贷款: ${quarterFinance.shortTermLoan.amount}M, 利息: ${(quarterFinance.shortTermLoan.amount * quarterFinance.shortTermLoan.interestRate).toFixed(2)}M`,
                    maxLoan: `最大可贷: ${quarterFinance.shortTermLoan.maxAmount}M`,
                    accountsPayable: `${quarterFinance.accountsPayable}M`,
                    rawMaterials: `R1: ${quarterLogistics.rawMaterials.find((m: any) => m.type === 'R1')?.quantity || 0}, R2: ${quarterLogistics.rawMaterials.find((m: any) => m.type === 'R2')?.quantity || 0}, R3: ${quarterLogistics.rawMaterials.find((m: any) => m.type === 'R3')?.quantity || 0}, R4: ${quarterLogistics.rawMaterials.find((m: any) => m.type === 'R4')?.quantity || 0}`,
                    rawMaterialOrders: `${quarterLogistics.rawMaterialOrders.length}个订单`,
                    finishedProducts: `P1: ${quarterLogistics.finishedProducts.find((p: any) => p.type === 'P1')?.quantity || 0}, P2: ${quarterLogistics.finishedProducts.find((p: any) => p.type === 'P2')?.quantity || 0}, P3: ${quarterLogistics.finishedProducts.find((p: any) => p.type === 'P3')?.quantity || 0}, P4: ${quarterLogistics.finishedProducts.find((p: any) => p.type === 'P4')?.quantity || 0}`,
                    productionLines: `${quarterProduction.factories.reduce((sum: number, f: any) => sum + f.productionLines.length, 0)}条生产线`,
                    accountsReceivable: `应收款: ${quarterFinance.accountsReceivable.reduce((sum: number, ar: number) => sum + ar, 0)}M`,
                    factories: `${quarterProduction.factories.length}个厂房`,
                    deliveredOrders: `${quarterMarketing.selectedOrders.filter((o: any) => o.isDelivered).length}/${quarterMarketing.selectedOrders.length}个订单已交付`,
                    productRD: `P2: ${quarterProduction.productRD.P2.completed ? '已完成' : `${quarterProduction.productRD.P2.progress}/6`}, P3: ${quarterProduction.productRD.P3.completed ? '已完成' : `${quarterProduction.productRD.P3.progress}/6`}, P4: ${quarterProduction.productRD.P4.completed ? '已完成' : `${quarterProduction.productRD.P4.progress}/6`}`
                  };
                };
                
                const quarterlySteps = [
                  { 
                    id: 'q-1', 
                    name: '季初现金盘点（请填写库存数量）', 
                    data: {
                      1: quarterStartCash[1] ? `${quarterStartCash[1]}M` : '',
                      2: quarterStartCash[2] ? `${quarterStartCash[2]}M` : '',
                      3: quarterStartCash[3] ? `${quarterStartCash[3]}M` : '',
                      4: quarterStartCash[4] ? `${quarterStartCash[4]}M` : ''
                    }
                  },
                  { 
                    id: 'q-2', 
                    name: '更新短贷/还本付息', 
                    data: {
                      1: getQuarterlyData(1).shortTermLoan || '',
                      2: getQuarterlyData(2).shortTermLoan || '',
                      3: getQuarterlyData(3).shortTermLoan || '',
                      4: getQuarterlyData(4).shortTermLoan || ''
                    }
                  },
                  { 
                    id: 'q-3', 
                    name: '申请短期贷款（高利贷）', 
                    data: {
                      1: getQuarterlyData(1).maxLoan || '',
                      2: getQuarterlyData(2).maxLoan || '',
                      3: getQuarterlyData(3).maxLoan || '',
                      4: getQuarterlyData(4).maxLoan || ''
                    }
                  },
                  { 
                    id: 'q-4', 
                    name: '更新应付账款/归还应付账款', 
                    data: {
                      1: getQuarterlyData(1).accountsPayable || '',
                      2: getQuarterlyData(2).accountsPayable || '',
                      3: getQuarterlyData(3).accountsPayable || '',
                      4: getQuarterlyData(4).accountsPayable || ''
                    }
                  },
                  { 
                    id: 'q-5', 
                    name: '原材料入库/更新原材料单', 
                    data: {
                      1: getQuarterlyData(1).rawMaterials || '',
                      2: getQuarterlyData(2).rawMaterials || '',
                      3: getQuarterlyData(3).rawMaterials || '',
                      4: getQuarterlyData(4).rawMaterials || ''
                    }
                  },
                  { 
                    id: 'q-6', 
                    name: '下原料订单', 
                    data: {
                      1: getQuarterlyData(1).rawMaterialOrders || '',
                      2: getQuarterlyData(2).rawMaterialOrders || '',
                      3: getQuarterlyData(3).rawMaterialOrders || '',
                      4: getQuarterlyData(4).rawMaterialOrders || ''
                    }
                  },
                  { 
                    id: 'q-7', 
                    name: '更新生产/完工入库', 
                    data: {
                      1: getQuarterlyData(1).finishedProducts || '',
                      2: getQuarterlyData(2).finishedProducts || '',
                      3: getQuarterlyData(3).finishedProducts || '',
                      4: getQuarterlyData(4).finishedProducts || ''
                    }
                  },
                  { 
                    id: 'q-8', 
                    name: '投资新生产线/变卖生产线/生产线转产', 
                    data: {
                      1: getQuarterlyData(1).productionLines || '',
                      2: getQuarterlyData(2).productionLines || '',
                      3: getQuarterlyData(3).productionLines || '',
                      4: getQuarterlyData(4).productionLines || ''
                    }
                  },
                  { id: 'q-9', name: '向其他企业购买原材料/出售原材料', data: { 1: '', 2: '', 3: '', 4: '' } },
                  { id: 'q-10', name: '开始下一批生产', data: { 1: '', 2: '', 3: '', 4: '' } },
                  { 
                    id: 'q-11', 
                    name: '更新应收账款/应收账款收现', 
                    data: {
                      1: getQuarterlyData(1).accountsReceivable || '',
                      2: getQuarterlyData(2).accountsReceivable || '',
                      3: getQuarterlyData(3).accountsReceivable || '',
                      4: getQuarterlyData(4).accountsReceivable || ''
                    }
                  },
                  { 
                    id: 'q-12', 
                    name: '出售厂房', 
                    data: {
                      1: getQuarterlyData(1).factories || '',
                      2: getQuarterlyData(2).factories || '',
                      3: getQuarterlyData(3).factories || '',
                      4: getQuarterlyData(4).factories || ''
                    }
                  },
                  { id: 'q-13', name: '向其他企业购买成品/出售成品', data: { 1: '', 2: '', 3: '', 4: '' } },
                  { 
                    id: 'q-14', 
                    name: '按订单交货', 
                    data: {
                      1: getQuarterlyData(1).deliveredOrders || '',
                      2: getQuarterlyData(2).deliveredOrders || '',
                      3: getQuarterlyData(3).deliveredOrders || '',
                      4: getQuarterlyData(4).deliveredOrders || ''
                    }
                  },
                  { 
                    id: 'q-15', 
                    name: '产品研发投资', 
                    data: {
                      1: getQuarterlyData(1).productRD || '',
                      2: getQuarterlyData(2).productRD || '',
                      3: getQuarterlyData(3).productRD || '',
                      4: getQuarterlyData(4).productRD || ''
                    }
                  },
                  { id: 'q-16', name: '支付行政管理费', data: { 1: '1M/年', 2: '1M/年', 3: '1M/年', 4: '1M/年' } },
                  { id: 'q-17', name: '其他现金收支情况登记', data: { 1: '', 2: '', 3: '', 4: '' } },
                  { id: 'q-18', name: '入库（收入）数量合计', data: { 1: '', 2: '', 3: '', 4: '' } },
                  { id: 'q-19', name: '出库（现金支出）合计', data: { 1: '', 2: '', 3: '', 4: '' } },
                  { 
                    id: 'q-20', 
                    name: '本季库存（现金）结余数量', 
                    data: {
                      1: quarterData[1].cash ? `${quarterData[1].cash}M` : '',
                      2: quarterData[2].cash ? `${quarterData[2].cash}M` : '',
                      3: quarterData[3].cash ? `${quarterData[3].cash}M` : '',
                      4: quarterData[4].cash ? `${quarterData[4].cash}M` : ''
                    }
                  }
                ];
                
                // 获取指定年份的存档，用于获取年末数据
                const yearEndSaveFile = saveFiles.find((file: any) => 
                  file.state?.operation?.currentYear === exportYear && 
                  file.state?.operation?.currentQuarter === 4
                );
                
                // 使用存档数据或当前数据
                const yearEndState = yearEndSaveFile ? yearEndSaveFile.state : state;
                const { 
                  finance: yearEndFinance, 
                  production: yearEndProduction, 
                  marketing: yearEndMarketing 
                } = yearEndState;
                
                const yearEndSteps = [
                  { 
                    id: 'yearend-1', 
                    name: '支付利息/更新长期贷款/申请长期贷款', 
                    data: `长期贷款: ${yearEndFinance.longTermLoan.amount}M, 利息: ${(yearEndFinance.longTermLoan.amount * yearEndFinance.longTermLoan.interestRate).toFixed(2)}M`
                  },
                  { 
                    id: 'yearend-2', 
                    name: '支付设备维护费', 
                    data: `${yearEndProduction.factories.reduce((sum: number, f: any) => 
                      sum + f.productionLines.reduce((lineSum: number, line: any) => lineSum + line.maintenanceCost, 0), 0
                    )}M`
                  },
                  { id: 'yearend-3', name: '支付租金/购买厂房', data: '' },
                  { id: 'yearend-4', name: '计提折旧', data: '2M/季度' },
                  { 
                    id: 'yearend-5', 
                    name: '新市场开拓/ISO资格认证投资', 
                    data: `${yearEndMarketing.markets.filter((m: any) => m.status === 'developing').length}个市场开发中`
                  },
                  { 
                    id: 'yearend-6', 
                    name: '结账', 
                    data: `年度净利: ${yearEndFinance.annualNetProfit}M`
                  }
                ];
                
                // 构建CSV数据
                let csvContent = '';
                
                // 添加表头
                csvContent += `第${exportYear}年运行控制表,,,,,\n`;
                csvContent += '序号,请按照顺序执行下列各项操作，每执行完一项操作，请在相应的方格内打勾,季度1,季度2,季度3,季度4\n';
                
                // 添加年初操作
                annualSteps.forEach((step, index) => {
                  // 用引号包裹包含逗号的数据，防止被Excel分割到不同列
                  const quotedData = step.data.includes(',') ? `"${step.data}"` : step.data;
                  csvContent += `,${step.name},${quotedData},,,\n`;
                });
                
                // 从财务日志中获取各季度的操作记录和数据变化
                const quarterlyFinancialData: Record<number, FinancialLogRecord[]> = {
                  1: yearFinancialLogs.filter(log => log.quarter === 1),
                  2: yearFinancialLogs.filter(log => log.quarter === 2),
                  3: yearFinancialLogs.filter(log => log.quarter === 3),
                  4: yearFinancialLogs.filter(log => log.quarter === 4)
                };
                
                // 计算各季度的其他支出金额
                const quarterlyOtherExpenses: Record<number, number> = {
                  1: 0,
                  2: 0,
                  3: 0,
                  4: 0
                };
                
                // 提取其他支出记录（包含"其他支出"的财务日志）
                yearFinancialLogs.forEach(log => {
                  if (log.description.includes('其他支出')) {
                    quarterlyOtherExpenses[log.quarter] += Math.abs(log.cashChange);
                  }
                });
                
                // 添加季度操作 - 只写入一次操作步骤，将全年各季度数据放在对应列中
                quarterlySteps.forEach((step, index) => {
                  // 对于不同的操作步骤，根据实际情况获取对应季度的数据
                  let q1Data = '';
                  let q2Data = '';
                  let q3Data = '';
                  let q4Data = '';
                  
                  // 根据操作步骤ID获取对应的数据
                  switch (step.id) {
                    case 'q-1':
                      // 季初现金盘点 - 使用季初现金余额
                      q1Data = quarterStartCash[1] ? `${quarterStartCash[1]}M` : '';
                      q2Data = quarterStartCash[2] ? `${quarterStartCash[2]}M` : '';
                      q3Data = quarterStartCash[3] ? `${quarterStartCash[3]}M` : '';
                      q4Data = quarterStartCash[4] ? `${quarterStartCash[4]}M` : '';
                      break;
                    case 'q-18':
                      // 入库（收入）数量合计
                      q1Data = quarterlyIncome[1] || '';
                      q2Data = quarterlyIncome[2] || '';
                      q3Data = quarterlyIncome[3] || '';
                      q4Data = quarterlyIncome[4] || '';
                      break;
                    case 'q-19':
                      // 出库（现金支出）合计
                      q1Data = quarterlyExpense[1] || '';
                      q2Data = quarterlyExpense[2] || '';
                      q3Data = quarterlyExpense[3] || '';
                      q4Data = quarterlyExpense[4] || '';
                      break;
                    case 'q-20':
                      // 本季库存结余数量 - 使用季度结束时的现金余额
                      q1Data = quarterData[1].cash ? `${quarterData[1].cash}M` : '';
                      q2Data = quarterData[2].cash ? `${quarterData[2].cash}M` : '';
                      q3Data = quarterData[3].cash ? `${quarterData[3].cash}M` : '';
                      q4Data = quarterData[4].cash ? `${quarterData[4].cash}M` : '';
                      break;
                    case 'q-2':
                    case 'q-3':
                    case 'q-4':
                    case 'q-5':
                    case 'q-6':
                    case 'q-7':
                    case 'q-8':
                    case 'q-11':
                    case 'q-12':
                    case 'q-14':
                    case 'q-15':
                      // 这些步骤显示所有季度数据
                      q1Data = step.data[1] || '';
                      q2Data = step.data[2] || '';
                      q3Data = step.data[3] || '';
                      q4Data = step.data[4] || '';
                      break;
                    case 'q-17':
                      // 其他现金收支情况登记 - 显示其他支出金额
                      q1Data = quarterlyOtherExpenses[1] > 0 ? `${quarterlyOtherExpenses[1]}M` : '';
                      q2Data = quarterlyOtherExpenses[2] > 0 ? `${quarterlyOtherExpenses[2]}M` : '';
                      q3Data = quarterlyOtherExpenses[3] > 0 ? `${quarterlyOtherExpenses[3]}M` : '';
                      q4Data = quarterlyOtherExpenses[4] > 0 ? `${quarterlyOtherExpenses[4]}M` : '';
                      break;
                    default:
                      // 其他步骤留空，或者显示状态
                      q1Data = '';
                      q2Data = '';
                      q3Data = '';
                      q4Data = '';
                  }
                  
                  // 用引号包裹包含逗号的数据，防止被Excel分割到不同列
                  const quotedQ1Data = q1Data.includes(',') ? `"${q1Data}"` : q1Data;
                  const quotedQ2Data = q2Data.includes(',') ? `"${q2Data}"` : q2Data;
                  const quotedQ3Data = q3Data.includes(',') ? `"${q3Data}"` : q3Data;
                  const quotedQ4Data = q4Data.includes(',') ? `"${q4Data}"` : q4Data;
                  
                  // 构建行数据，将全年各季度数据放在对应列中
                  const rowData = `${index + 1},${step.name},${quotedQ1Data},${quotedQ2Data},${quotedQ3Data},${quotedQ4Data}\n`;
                  
                  csvContent += rowData;
                });
                
                // 添加年末操作
                yearEndSteps.forEach((step) => {
                  // 用引号包裹包含逗号的数据，防止被Excel分割到不同列
                  const quotedData = step.data.includes(',') ? `"${step.data}"` : step.data;
                  csvContent += `,${step.name},${quotedData},,,\n`;
                });
                
                // 添加UTF-8 BOM头，解决Excel乱码问题
                const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
                const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8;' });
                
                // 创建下载链接
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `第${exportYear}年运行控制表.csv`;
                
                // 触发下载
                document.body.appendChild(a);
                a.click();
                
                // 清理
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              };
              
              // 调用导出函数，导出当前年份数据
              exportYearData(state.operation.currentYear);
            }}
            className="bg-green-500 text-white py-2 px-6 rounded-lg hover:bg-green-600 font-medium flex items-center space-x-2 mr-2"
          >
            <span>导出运行控制表</span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>
          
          {/* 新增导出上一年数据按钮 */}
          {state.operation.currentYear > 1 && (
            <button
              onClick={() => {
                const exportYearData = (exportYear: number) => {
                  const { finance, logistics, production, marketing, operation } = state;
                  
                  // 从现金流量历史记录中获取全年各季度的数据
                  const yearCashFlowData = operation.cashFlowHistory.filter(record => record.year === exportYear);
                  
                  // 从财务日志中获取各季度的现金余额
                  const yearFinancialLogs = operation.financialLogs.filter(log => log.year === exportYear);
                  
                  // 定义完整的操作步骤和数据
                  const annualSteps = [
                    { id: 'annual-1', name: '新年度规划会议', data: '' },
                    { id: 'annual-2', name: '参加订货会/登记销售订单', data: `${marketing.availableOrders.length}个可用订单` },
                    { id: 'annual-3', name: '制定新年度计划', data: '' },
                    { id: 'annual-4', name: '支付应付税', data: `${finance.taxesPayable}M` }
                  ];
                  
                  // 获取所有存档文件，用于获取历史季度数据
                  const saveFiles = JSON.parse(localStorage.getItem('enterpriseSaveFiles') || '[]');
                  
                  // 初始化季度数据对象
                  const quarterData: Record<number, { cash: number; description: string }> = {
                    1: { cash: exportYear === 1 ? 40 : (saveFiles.find((file: any) => file.state?.operation?.currentYear === exportYear - 1 && file.state?.operation?.currentQuarter === 4)?.state?.operation?.cash || 40), description: '' },
                    2: { cash: 0, description: '' },
                    3: { cash: 0, description: '' },
                    4: { cash: 0, description: '' }
                  };
                  
                  // 重新计算季度结束时的现金余额，考虑所有财务日志
                  for (let quarter = 1; quarter <= 4; quarter++) {
                    // 获取当前季度的所有财务日志
                    const quarterLogs = yearFinancialLogs.filter(log => log.quarter === quarter);
                    
                    // 计算当前季度的现金变动总和
                    let cashChange = 0;
                    quarterLogs.forEach(log => {
                      cashChange += log.cashChange;
                    });
                    
                    // 计算季度结束现金余额
                    // 修复：本季库存结余 = 季初现金 + 季度支出（不重复计算收入）
                    // 只保留季初现金和支出部分，收入已包含在季初现金中
                    if (quarter === 1) {
                      // 季度1的初始现金是季初现金，只加上支出部分
                      // 计算支出部分（cashChange中为负的部分）
                      const expenseOnly = quarterLogs.reduce((sum, log) => sum + (log.cashChange < 0 ? log.cashChange : 0), 0);
                      quarterData[quarter].cash += expenseOnly;
                    } else {
                      // 后续季度的初始现金是上一季度的结束余额，加上当前季度的现金变动
                      quarterData[quarter].cash = quarterData[quarter - 1].cash + cashChange;
                    }
                    
                    quarterData[quarter].description = `第${exportYear}年第${quarter}季度现金余额`;
                  }
                  
                  // 计算季初现金余额（季度1的季初现金是初始现金40M，后续季度的季初现金是上一季度的结束余额）
                  const quarterStartCash: Record<number, number> = {
                    1: exportYear === 1 ? 40 : (saveFiles.find((file: any) => file.state?.operation?.currentYear === exportYear - 1 && file.state?.operation?.currentQuarter === 4)?.state?.operation?.cash || 40), // 第1年季度1的季初现金是初始现金40M，其他年份是上一年末的现金
                    2: quarterData[1]?.cash || 0, // 季度2的季初现金是季度1的结束余额
                    3: quarterData[2]?.cash || 0, // 季度3的季初现金是季度2的结束余额
                    4: quarterData[3]?.cash || 0  // 季度4的季初现金是季度3的结束余额
                  };
                  
                  // 计算各季度的收入（序号18）和支出（序号19）
                  const quarterlyIncome: Record<number, string> = { 1: '', 2: '', 3: '', 4: '' };
                  const quarterlyExpense: Record<number, string> = { 1: '', 2: '', 3: '', 4: '' };
                  
                  // 从财务日志计算各季度的收入和支出
                  for (let quarter = 1; quarter <= 4; quarter++) {
                    const quarterLogs = yearFinancialLogs.filter(log => log.quarter === quarter);
                    
                    // 计算季度收入（现金增加）
                    let totalIncome = 0;
                    let products = '';
                    
                    // 计算季度支出（现金减少）
                    let totalExpense = 0;
                    
                    quarterLogs.forEach(log => {
                      if (log.cashChange > 0) {
                        totalIncome += log.cashChange;
                      } else {
                        totalExpense += Math.abs(log.cashChange);
                      }
                      
                      // 提取产品信息（如果有）
                      if (log.description.includes('P1')) {
                        const p1Match = log.description.match(/(\d+)P1/g);
                        if (p1Match) {
                          products += p1Match.join(' ');
                        }
                      }
                      if (log.description.includes('P2')) {
                        const p2Match = log.description.match(/(\d+)P2/g);
                        if (p2Match) {
                          products += p2Match.join(' ');
                        }
                      }
                      if (log.description.includes('P3')) {
                        const p3Match = log.description.match(/(\d+)P3/g);
                        if (p3Match) {
                          products += p3Match.join(' ');
                        }
                      }
                      if (log.description.includes('P4')) {
                        const p4Match = log.description.match(/(\d+)P4/g);
                        if (p4Match) {
                          products += p4Match.join(' ');
                        }
                      }
                    });
                    
                    // 格式化序号18数据：资金收入 + 产品信息
                    if (totalIncome > 0) {
                      quarterlyIncome[quarter] = `${totalIncome}M ${products.trim()}`;
                    } else {
                      quarterlyIncome[quarter] = products.trim();
                    }
                    
                    // 格式化序号19数据：总支出（带负号）
                    quarterlyExpense[quarter] = totalExpense > 0 ? `-${totalExpense}M` : '';
                  }
                  
                  // 筛选指定年份的存档，并按季度排序
                  const yearSaveFiles = saveFiles
                    .filter((file: any) => file.state?.operation?.currentYear === exportYear)
                    .sort((a: any, b: any) => {
                      const quarterA = a.state?.operation?.currentQuarter || 0;
                      const quarterB = b.state?.operation?.currentQuarter || 0;
                      return quarterA - quarterB;
                    });
                  
                  // 获取指定季度的存档数据
                  const getQuarterState = (quarter: number) => {
                    // 找到对应季度的存档
                    const saveFile = yearSaveFiles.find((file: any) => {
                      const fileQuarter = file.state?.operation?.currentQuarter || 0;
                      return fileQuarter === quarter;
                    });
                    
                    // 如果找到存档，返回存档数据；否则返回当前数据（针对当前季度）
                    if (saveFile) {
                      return saveFile.state;
                    }
                    return state;
                  };
                  
                  // 创建季度特定的数据生成函数
                  const getQuarterlyData = (quarter: number) => {
                    // 对于导出历史年份数据，显示所有季度数据
                    const quarterState = getQuarterState(quarter);
                    const { finance: quarterFinance, logistics: quarterLogistics, production: quarterProduction, marketing: quarterMarketing } = quarterState;
                    
                    return {
                      shortTermLoan: `短期贷款: ${quarterFinance.shortTermLoan.amount}M, 利息: ${(quarterFinance.shortTermLoan.amount * quarterFinance.shortTermLoan.interestRate).toFixed(2)}M`,
                      maxLoan: `最大可贷: ${quarterFinance.shortTermLoan.maxAmount}M`,
                      accountsPayable: `${quarterFinance.accountsPayable}M`,
                      rawMaterials: `R1: ${quarterLogistics.rawMaterials.find((m: any) => m.type === 'R1')?.quantity || 0}, R2: ${quarterLogistics.rawMaterials.find((m: any) => m.type === 'R2')?.quantity || 0}, R3: ${quarterLogistics.rawMaterials.find((m: any) => m.type === 'R3')?.quantity || 0}, R4: ${quarterLogistics.rawMaterials.find((m: any) => m.type === 'R4')?.quantity || 0}`,
                      rawMaterialOrders: `${quarterLogistics.rawMaterialOrders.length}个订单`,
                      finishedProducts: `P1: ${quarterLogistics.finishedProducts.find((p: any) => p.type === 'P1')?.quantity || 0}, P2: ${quarterLogistics.finishedProducts.find((p: any) => p.type === 'P2')?.quantity || 0}, P3: ${quarterLogistics.finishedProducts.find((p: any) => p.type === 'P3')?.quantity || 0}, P4: ${quarterLogistics.finishedProducts.find((p: any) => p.type === 'P4')?.quantity || 0}`,
                      productionLines: `${quarterProduction.factories.reduce((sum: number, f: any) => sum + f.productionLines.length, 0)}条生产线`,
                      accountsReceivable: `应收款: ${quarterFinance.accountsReceivable.reduce((sum: number, ar: number) => sum + ar, 0)}M`,
                      factories: `${quarterProduction.factories.length}个厂房`,
                      deliveredOrders: `${quarterMarketing.selectedOrders.filter((o: any) => o.isDelivered).length}/${quarterMarketing.selectedOrders.length}个订单已交付`,
                      productRD: `P2: ${quarterProduction.productRD.P2.completed ? '已完成' : `${quarterProduction.productRD.P2.progress}/6`}, P3: ${quarterProduction.productRD.P3.completed ? '已完成' : `${quarterProduction.productRD.P3.progress}/6`}, P4: ${quarterProduction.productRD.P4.completed ? '已完成' : `${quarterProduction.productRD.P4.progress}/6`}`
                    };
                  };
                  
                  const quarterlySteps = [
                    { 
                      id: 'q-1', 
                      name: '季初现金盘点（请填写库存数量）', 
                      data: {
                        1: quarterStartCash[1] ? `${quarterStartCash[1]}M` : '',
                        2: quarterStartCash[2] ? `${quarterStartCash[2]}M` : '',
                        3: quarterStartCash[3] ? `${quarterStartCash[3]}M` : '',
                        4: quarterStartCash[4] ? `${quarterStartCash[4]}M` : ''
                      }
                    },
                    { 
                      id: 'q-2', 
                      name: '更新短贷/还本付息', 
                      data: {
                        1: getQuarterlyData(1).shortTermLoan || '',
                        2: getQuarterlyData(2).shortTermLoan || '',
                        3: getQuarterlyData(3).shortTermLoan || '',
                        4: getQuarterlyData(4).shortTermLoan || ''
                      }
                    },
                    { 
                      id: 'q-3', 
                      name: '申请短期贷款（高利贷）', 
                      data: {
                        1: getQuarterlyData(1).maxLoan || '',
                        2: getQuarterlyData(2).maxLoan || '',
                        3: getQuarterlyData(3).maxLoan || '',
                        4: getQuarterlyData(4).maxLoan || ''
                      }
                    },
                    { 
                      id: 'q-4', 
                      name: '更新应付账款/归还应付账款', 
                      data: {
                        1: getQuarterlyData(1).accountsPayable || '',
                        2: getQuarterlyData(2).accountsPayable || '',
                        3: getQuarterlyData(3).accountsPayable || '',
                        4: getQuarterlyData(4).accountsPayable || ''
                      }
                    },
                    { 
                      id: 'q-5', 
                      name: '原材料入库/更新原材料单', 
                      data: {
                        1: getQuarterlyData(1).rawMaterials || '',
                        2: getQuarterlyData(2).rawMaterials || '',
                        3: getQuarterlyData(3).rawMaterials || '',
                        4: getQuarterlyData(4).rawMaterials || ''
                      }
                    },
                    { 
                      id: 'q-6', 
                      name: '下原料订单', 
                      data: {
                        1: getQuarterlyData(1).rawMaterialOrders || '',
                        2: getQuarterlyData(2).rawMaterialOrders || '',
                        3: getQuarterlyData(3).rawMaterialOrders || '',
                        4: getQuarterlyData(4).rawMaterialOrders || ''
                      }
                    },
                    { 
                      id: 'q-7', 
                      name: '更新生产/完工入库', 
                      data: {
                        1: getQuarterlyData(1).finishedProducts || '',
                        2: getQuarterlyData(2).finishedProducts || '',
                        3: getQuarterlyData(3).finishedProducts || '',
                        4: getQuarterlyData(4).finishedProducts || ''
                      }
                    },
                    { 
                      id: 'q-8', 
                      name: '投资新生产线/变卖生产线/生产线转产', 
                      data: {
                        1: getQuarterlyData(1).productionLines || '',
                        2: getQuarterlyData(2).productionLines || '',
                        3: getQuarterlyData(3).productionLines || '',
                        4: getQuarterlyData(4).productionLines || ''
                      }
                    },
                    { id: 'q-9', name: '向其他企业购买原材料/出售原材料', data: { 1: '', 2: '', 3: '', 4: '' } },
                    { id: 'q-10', name: '开始下一批生产', data: { 1: '', 2: '', 3: '', 4: '' } },
                    { 
                      id: 'q-11', 
                      name: '更新应收账款/应收账款收现', 
                      data: {
                        1: getQuarterlyData(1).accountsReceivable || '',
                        2: getQuarterlyData(2).accountsReceivable || '',
                        3: getQuarterlyData(3).accountsReceivable || '',
                        4: getQuarterlyData(4).accountsReceivable || ''
                      }
                    },
                    { 
                      id: 'q-12', 
                      name: '出售厂房', 
                      data: {
                        1: getQuarterlyData(1).factories || '',
                        2: getQuarterlyData(2).factories || '',
                        3: getQuarterlyData(3).factories || '',
                        4: getQuarterlyData(4).factories || ''
                      }
                    },
                    { id: 'q-13', name: '向其他企业购买成品/出售成品', data: { 1: '', 2: '', 3: '', 4: '' } },
                    { 
                      id: 'q-14', 
                      name: '按订单交货', 
                      data: {
                        1: getQuarterlyData(1).deliveredOrders || '',
                        2: getQuarterlyData(2).deliveredOrders || '',
                        3: getQuarterlyData(3).deliveredOrders || '',
                        4: getQuarterlyData(4).deliveredOrders || ''
                      }
                    },
                    { 
                      id: 'q-15', 
                      name: '产品研发投资', 
                      data: {
                        1: getQuarterlyData(1).productRD || '',
                        2: getQuarterlyData(2).productRD || '',
                        3: getQuarterlyData(3).productRD || '',
                        4: getQuarterlyData(4).productRD || ''
                      }
                    },
                    { id: 'q-16', name: '支付行政管理费', data: { 1: '1M/年', 2: '1M/年', 3: '1M/年', 4: '1M/年' } },
                    { id: 'q-17', name: '其他现金收支情况登记', data: { 1: '', 2: '', 3: '', 4: '' } },
                    { id: 'q-18', name: '入库（收入）数量合计', data: { 1: '', 2: '', 3: '', 4: '' } },
                    { id: 'q-19', name: '出库（现金支出）合计', data: { 1: '', 2: '', 3: '', 4: '' } },
                    { 
                      id: 'q-20', 
                      name: '本季库存（现金）结余数量', 
                      data: {
                        1: quarterData[1].cash ? `${quarterData[1].cash}M` : '',
                        2: quarterData[2].cash ? `${quarterData[2].cash}M` : '',
                        3: quarterData[3].cash ? `${quarterData[3].cash}M` : '',
                        4: quarterData[4].cash ? `${quarterData[4].cash}M` : ''
                      }
                    }
                  ];
                  
                  // 获取指定年份的存档，用于获取年末数据
                  const yearEndSaveFile = saveFiles.find((file: any) => 
                    file.state?.operation?.currentYear === exportYear && 
                    file.state?.operation?.currentQuarter === 4
                  );
                  
                  // 使用存档数据或当前数据
                  const yearEndState = yearEndSaveFile ? yearEndSaveFile.state : state;
                  const { 
                    finance: yearEndFinance, 
                    production: yearEndProduction, 
                    marketing: yearEndMarketing 
                  } = yearEndState;
                  
                  const yearEndSteps = [
                    { 
                      id: 'yearend-1', 
                      name: '支付利息/更新长期贷款/申请长期贷款', 
                      data: `长期贷款: ${yearEndFinance.longTermLoan.amount}M, 利息: ${(yearEndFinance.longTermLoan.amount * yearEndFinance.longTermLoan.interestRate).toFixed(2)}M`
                    },
                    { 
                      id: 'yearend-2', 
                      name: '支付设备维护费', 
                      data: `${yearEndProduction.factories.reduce((sum: number, f: any) => 
                        sum + f.productionLines.reduce((lineSum: number, line: any) => lineSum + line.maintenanceCost, 0), 0
                      )}M`
                    },
                    { id: 'yearend-3', name: '支付租金/购买厂房', data: '' },
                    { id: 'yearend-4', name: '计提折旧', data: '2M/季度' },
                    { 
                      id: 'yearend-5', 
                      name: '新市场开拓/ISO资格认证投资', 
                      data: `${yearEndMarketing.markets.filter((m: any) => m.status === 'developing').length}个市场开发中`
                    },
                    { 
                      id: 'yearend-6', 
                      name: '结账', 
                      data: `年度净利: ${yearEndFinance.annualNetProfit}M`
                    }
                  ];
                  
                  // 构建CSV数据
                  let csvContent = '';
                  
                  // 添加表头
                  csvContent += `第${exportYear}年运行控制表,,,,,\n`;
                  csvContent += '序号,请按照顺序执行下列各项操作，每执行完一项操作，请在相应的方格内打勾,季度1,季度2,季度3,季度4\n';
                  
                  // 添加年初操作
                  annualSteps.forEach((step, index) => {
                    // 用引号包裹包含逗号的数据，防止被Excel分割到不同列
                    const quotedData = step.data.includes(',') ? `"${step.data}"` : step.data;
                    csvContent += `,${step.name},${quotedData},,,\n`;
                  });
                  
                  // 从财务日志中获取各季度的操作记录和数据变化
                  const quarterlyFinancialData: Record<number, FinancialLogRecord[]> = {
                    1: yearFinancialLogs.filter(log => log.quarter === 1),
                    2: yearFinancialLogs.filter(log => log.quarter === 2),
                    3: yearFinancialLogs.filter(log => log.quarter === 3),
                    4: yearFinancialLogs.filter(log => log.quarter === 4)
                  };
                  
                  // 计算各季度的其他支出金额
                  const quarterlyOtherExpenses: Record<number, number> = {
                    1: 0,
                    2: 0,
                    3: 0,
                    4: 0
                  };
                  
                  // 提取其他支出记录（包含"其他支出"的财务日志）
                  yearFinancialLogs.forEach(log => {
                    if (log.description.includes('其他支出')) {
                      quarterlyOtherExpenses[log.quarter] += Math.abs(log.cashChange);
                    }
                  });
                  
                  // 添加季度操作 - 只写入一次操作步骤，将全年各季度数据放在对应列中
                  quarterlySteps.forEach((step, index) => {
                    // 对于不同的操作步骤，根据实际情况获取对应季度的数据
                    let q1Data = '';
                    let q2Data = '';
                    let q3Data = '';
                    let q4Data = '';
                    
                    // 根据操作步骤ID获取对应的数据
                  switch (step.id) {
                    case 'q-1':
                      // 季初现金盘点 - 使用季初现金余额
                      q1Data = quarterStartCash[1] ? `${quarterStartCash[1]}M` : '';
                      q2Data = quarterStartCash[2] ? `${quarterStartCash[2]}M` : '';
                      q3Data = quarterStartCash[3] ? `${quarterStartCash[3]}M` : '';
                      q4Data = quarterStartCash[4] ? `${quarterStartCash[4]}M` : '';
                      break;
                    case 'q-18':
                      // 入库（收入）数量合计
                      q1Data = quarterlyIncome[1] || '';
                      q2Data = quarterlyIncome[2] || '';
                      q3Data = quarterlyIncome[3] || '';
                      q4Data = quarterlyIncome[4] || '';
                      break;
                    case 'q-19':
                      // 出库（现金支出）合计
                      q1Data = quarterlyExpense[1] || '';
                      q2Data = quarterlyExpense[2] || '';
                      q3Data = quarterlyExpense[3] || '';
                      q4Data = quarterlyExpense[4] || '';
                      break;
                    case 'q-20':
                      // 本季库存结余数量 - 使用季度结束时的现金余额
                      q1Data = quarterData[1].cash ? `${quarterData[1].cash}M` : '';
                      q2Data = quarterData[2].cash ? `${quarterData[2].cash}M` : '';
                      q3Data = quarterData[3].cash ? `${quarterData[3].cash}M` : '';
                      q4Data = quarterData[4].cash ? `${quarterData[4].cash}M` : '';
                      break;
                    case 'q-2':
                    case 'q-3':
                    case 'q-4':
                    case 'q-5':
                    case 'q-6':
                    case 'q-7':
                    case 'q-8':
                    case 'q-11':
                    case 'q-12':
                    case 'q-14':
                    case 'q-15':
                      // 这些步骤显示所有季度数据
                      q1Data = step.data[1] || '';
                      q2Data = step.data[2] || '';
                      q3Data = step.data[3] || '';
                      q4Data = step.data[4] || '';
                      break;
                    case 'q-17':
                      // 其他现金收支情况登记 - 显示其他支出金额
                      q1Data = quarterlyOtherExpenses[1] > 0 ? `${quarterlyOtherExpenses[1]}M` : '';
                      q2Data = quarterlyOtherExpenses[2] > 0 ? `${quarterlyOtherExpenses[2]}M` : '';
                      q3Data = quarterlyOtherExpenses[3] > 0 ? `${quarterlyOtherExpenses[3]}M` : '';
                      q4Data = quarterlyOtherExpenses[4] > 0 ? `${quarterlyOtherExpenses[4]}M` : '';
                      break;
                    default:
                      // 其他步骤留空，或者显示状态
                      q1Data = '';
                      q2Data = '';
                      q3Data = '';
                      q4Data = '';
                    }
                    
                    // 用引号包裹包含逗号的数据，防止被Excel分割到不同列
                    const quotedQ1Data = q1Data.includes(',') ? `"${q1Data}"` : q1Data;
                    const quotedQ2Data = q2Data.includes(',') ? `"${q2Data}"` : q2Data;
                    const quotedQ3Data = q3Data.includes(',') ? `"${q3Data}"` : q3Data;
                    const quotedQ4Data = q4Data.includes(',') ? `"${q4Data}"` : q4Data;
                    
                    // 构建行数据，将全年各季度数据放在对应列中
                    const rowData = `${index + 1},${step.name},${quotedQ1Data},${quotedQ2Data},${quotedQ3Data},${quotedQ4Data}\n`;
                    
                    csvContent += rowData;
                  });
                  
                  // 添加年末操作
                  yearEndSteps.forEach((step) => {
                    // 用引号包裹包含逗号的数据，防止被Excel分割到不同列
                    const quotedData = step.data.includes(',') ? `"${step.data}"` : step.data;
                    csvContent += `,${step.name},${quotedData},,,\n`;
                  });
                  
                  // 添加UTF-8 BOM头，解决Excel乱码问题
                  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
                  const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8;' });
                  
                  // 创建下载链接
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `第${exportYear}年运行控制表.csv`;
                  
                  // 触发下载
                  document.body.appendChild(a);
                  a.click();
                  
                  // 清理
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                };
                
                // 调用导出函数，导出上一年数据
                exportYearData(state.operation.currentYear - 1);
              }}
              className="bg-blue-500 text-white py-2 px-6 rounded-lg hover:bg-blue-600 font-medium flex items-center space-x-2"
            >
              <span>导出上一年数据</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 年度运营流程图 */}
      <div className="dashboard-card">
        <h2 className="dashboard-title">年度运营流程</h2>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm font-medium mb-4">
            点击步骤可查看详情
          </div>
          
          {/* 简化的流程图展示 */}
          <div className="overflow-x-auto">
            <div className="min-w-full">
              {/* 年初流程 */}
              <div className="mb-6">
                <div className="flex items-center justify-center mb-4">
                  <div className="bg-blue-100 text-blue-800 px-4 py-2 rounded-full font-medium">年初</div>
                </div>
                <div className="flex justify-center space-x-4">
                  <div className="bg-white border border-blue-200 rounded-lg p-3 shadow-sm">
                    新年度规划会议
                  </div>
                  <div className="flex items-center">
                    <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </div>
                  <div className="bg-white border border-blue-200 rounded-lg p-3 shadow-sm">
                    制定新年度计划
                  </div>
                  <div className="flex items-center">
                    <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </div>
                  <div className="bg-white border border-blue-200 rounded-lg p-3 shadow-sm">
                    支付应付税
                  </div>
                </div>
              </div>
              
              {/* 季度流程 */}
              <div className="mb-6">
                <div className="flex items-center justify-center mb-4">
                  <div className="bg-green-100 text-green-800 px-4 py-2 rounded-full font-medium">季度运营</div>
                </div>
                <div className="flex flex-col items-center space-y-4">
                  {/* 季度流程步骤 */}
                  <div className="flex flex-wrap justify-center gap-4">
                    {getCurrentSteps().slice(0, 8).map((step, index) => (
                      <div key={index} className="bg-white border border-green-200 rounded-lg p-3 shadow-sm min-w-[120px] text-center">
                        {step}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center">
                    <svg className="w-6 h-6 text-gray-400 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </div>
                  <div className="flex flex-wrap justify-center gap-4">
                    {getCurrentSteps().slice(8, 16).map((step, index) => (
                      <div key={index} className="bg-white border border-green-200 rounded-lg p-3 shadow-sm min-w-[120px] text-center">
                        {step}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center">
                    <svg className="w-6 h-6 text-gray-400 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </div>
                  <div className="flex flex-wrap justify-center gap-4">
                    {getCurrentSteps().slice(16).map((step, index) => (
                      <div key={index} className="bg-white border border-green-200 rounded-lg p-3 shadow-sm min-w-[120px] text-center">
                        {step}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              
              {/* 年末流程 */}
              {operation.currentQuarter === 4 && (
                <div>
                  <div className="flex items-center justify-center mb-4">
                    <div className="bg-red-100 text-red-800 px-4 py-2 rounded-full font-medium">年末</div>
                  </div>
                  <div className="flex justify-center space-x-4">
                    <div className="bg-white border border-red-200 rounded-lg p-3 shadow-sm">
                      支付利息/更新长期贷款
                    </div>
                    <div className="flex items-center">
                      <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                    </div>
                    <div className="bg-white border border-red-200 rounded-lg p-3 shadow-sm">
                      支付设备维护费
                    </div>
                    <div className="flex items-center">
                      <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                    </div>
                    <div className="bg-white border border-red-200 rounded-lg p-3 shadow-sm">
                      结账（计算年度净利润）
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 当前季度操作步骤 */}
      <div className="dashboard-card">
        <h2 className="dashboard-title">第{operation.currentQuarter}季度操作步骤</h2>
        <div className="space-y-2">
          {getCurrentSteps().map((step, index) => (
            <div key={index} className="flex items-center p-3 bg-white border border-gray-200 rounded-lg shadow-sm">
              <div className="w-8 h-8 bg-blue-100 text-blue-800 rounded-full flex items-center justify-center font-medium mr-3">
                {index + 1}
              </div>
              <div className="flex-1">{step}</div>
              <div className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-medium">
                待执行
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 操作记录 */}
      <div className="dashboard-card">
        <div className="flex justify-between items-center mb-4">
          <h2 className="dashboard-title">操作记录</h2>
          {operation.operationLogs.length > 0 && (
            <button
              onClick={() => {
                // 生成日志文件内容
                const logContent = operation.operationLogs
                  .map((log: { id: string; time: string; operator: string; action: string; dataChange: string }) => `${log.time} | ${log.operator} | ${log.action} | ${log.dataChange}`)
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
              }}
              className="bg-blue-600 text-white px-3 py-1 rounded-md text-sm hover:bg-blue-700 transition-colors"
            >
              导出日志
            </button>
          )}
        </div>
        
        {operation.operationLogs.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            暂无操作记录
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto space-y-3">
            {operation.operationLogs.map((log: { id: string; time: string; operator: string; action: string; dataChange: string }) => (
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
    </div>
  );
};

export default OperationCenter;