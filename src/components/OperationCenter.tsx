'use client';
import React from 'react';
import { useEnterpriseStore } from '../store/enterpriseStore';
import { FinancialLogRecord } from '../types/enterprise';

const OperationCenter: React.FC = () => {
  const { state, nextQuarter, getSaveFiles } = useEnterpriseStore();
  const { operation } = state;

  // 运行控制表操作项
  const operationSteps = [
    {
      phase: '年初',
      step: '',
      description: '新年度规划会议',
    },
    {
      phase: '年初',
      step: '',
      description: '参加订货会/登记销售订单',
    },
    {
      phase: '年初',
      step: '',
      description: '制定新年度计划',
    },
    {
      phase: '年初',
      step: '',
      description: '支付应付税',
    },
    {
      phase: '季度',
      step: '1',
      description: '季初现金盘点（请填写库存数量）',
    },
    {
      phase: '季度',
      step: '2',
      description: '更新短贷/还本付息',
    },
    {
      phase: '季度',
      step: '3',
      description: '申请短期贷款/高利贷',
    },
    {
      phase: '季度',
      step: '4',
      description: '更新应付账款/归还应付账款',
    },
    {
      phase: '季度',
      step: '5',
      description: '原材料入库/更新原材料单',
    },
    {
      phase: '季度',
      step: '6',
      description: '下原料订单',
    },
    {
      phase: '季度',
      step: '7',
      description: '更新生产/完工入库',
    },
    {
      phase: '季度',
      step: '8',
      description: '投资新生产线/变卖生产线/生产线转产',
    },
    {
      phase: '季度',
      step: '9',
      description: '向其他企业购买原材料/出售原材料',
    },
    {
      phase: '季度',
      step: '10',
      description: '开始下一批生产',
    },
    {
      phase: '季度',
      step: '11',
      description: '更新应收账款/应收账款收现',
    },
    {
      phase: '季度',
      step: '12',
      description: '出售厂房',
    },
    {
      phase: '季度',
      step: '13',
      description: '向其他企业购买成品/出售成品',
    },
    {
      phase: '季度',
      step: '14',
      description: '按订单交货',
    },
    {
      phase: '季度',
      step: '15',
      description: '产品研发投资',
    },
    {
      phase: '季度',
      step: '16',
      description: '支付行政管理费',
    },
    {
      phase: '季度',
      step: '17',
      description: '其他现金收支情况登记',
    },
    {
      phase: '季度',
      step: '18',
      description: '入库（收入）数量合计',
    },
    {
      phase: '季度',
      step: '19',
      description: '出库（现金支出）合计',
    },
    {
      phase: '季度',
      step: '20',
      description: '本季库存（现金）结余数量',
    },
    {
      phase: '年末',
      step: '',
      description: '支付利息/更新长期贷款/申请长期贷款',
    },
    {
      phase: '年末',
      step: '',
      description: '支付设备维护费',
    },
    {
      phase: '年末',
      step: '',
      description: '支付租金/购买厂房',
    },
    {
      phase: '年末',
      step: '',
      description: '计提折旧',
    },
    {
      phase: '年末',
      step: '',
      description: '新市场开拓/ISO资格认证投资',
    },
    {
      phase: '年末',
      step: '',
      description: '结账',
    },
  ];



  // 导出报告为CSV
  const exportReport = () => {
    // 生成符合运行控制表格式的CSV
    let csvContent = '';
    
    // 获取所有存档
    const allSaveFiles = getSaveFiles();
    
    // 按年份生成表格
    [1, 2, 3, 4].forEach(year => {
      // 年份标题
      csvContent += `第${year}年运营控制表\n`;
      
      // 表头
      csvContent += '序号,操作项,第1季度,第2季度,第3季度,第4季度\n';
      
      // 添加操作项
      operationSteps.forEach(step => {
        // 跳过非季度操作项（年末操作不显示在季度表格中）
        if (step.phase !== '季度') return;
        
        const row = [
          step.step || '',
          step.description
        ];
        
        // 为每个季度生成内容
        [1, 2, 3, 4].forEach(quarter => {
          // 根据日志记录判断该操作是否完成
          const isCompleted = state.operation.operationLogs.some(log => {
            const logText = (log.action || '').toLowerCase();
            const stepText = step.description.toLowerCase();
            
            // 关键词匹配
            const keyWords = stepText.split(/[\s/、（）]/).filter(word => word.length > 0);
            const matchCount = keyWords.filter(word => logText.includes(word)).length;
            
            return matchCount >= 2 || 
                   logText.includes(stepText) || 
                   stepText.includes(logText) ||
                   (logText.length > 0 && keyWords.some(word => logText.includes(word)));
          });
          
          // 根据财务日志获取具体数值
          const financialLog = state.operation.financialLogs.find(log => {
            return log.year === year && 
                   log.quarter === quarter && 
                   (log.description.toLowerCase().includes(step.description.toLowerCase()) ||
                    step.description.toLowerCase().includes(log.description.toLowerCase()));
          });
          
          let cellContent = '';
          
          // 特殊处理：开始下一批生产
          if (step.description.includes('开始下一批生产')) {
            // 查找该季度的生产相关日志
            const productionLogs = state.operation.operationLogs.filter(log => {
              return log.action.includes('开始生产') && 
                     (log.dataChange || '').includes(`第${year}年第${quarter}季度`);
            });
            
            // 获取所有运行中的生产线，计算生产费用
            const runningLines = state.production.factories.flatMap(factory => 
              factory.productionLines.filter(line => line.status === 'running')
            );
            
            // 如果有运行中的生产线，计算生产费用
            if (runningLines.length > 0) {
              // 计算每条生产线的生产费用（只计算加工费）
              const productionCosts = runningLines.map(line => {
                // 只计算加工费，因为原料已经订购过了
                // 加工费用：根据生产线类型不同
                const processingCost = line.type === 'automatic' ? 1 : 
                                     line.type === 'semi-automatic' ? 1 : 
                                     line.type === 'manual' ? 1 : 1;
                
                // 总生产费用
                const totalCost = processingCost;
                
                return {
                  cost: -totalCost, // 支出为负数
                  product: line.product,
                  lineType: line.type
                };
              });
              
              // 合并同类项：按产品和生产线类型分组
              const groupedCosts = productionCosts.reduce((acc, item) => {
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
              }, {} as Record<string, { cost: number; product: string; lineType: string; count: number }>);
              
              // 格式化生产记录
              const formattedProduction = Object.values(groupedCosts).map(item => {
                // 简化生产线类型显示
                const simplifiedLineType = item.lineType === 'automatic' ? '自' : 
                                        item.lineType === 'semi-automatic' ? '半' :
                                        item.lineType === 'manual' ? '手' : '柔';
                return `${item.cost}M (${item.product}，${simplifiedLineType})`;
              });
              
              cellContent = formattedProduction.join('/');
            } else {
              cellContent = '-';
            }
          }
          // 特殊处理：其他现金收支情况登记 - 只保留广告投放
          else if (step.description.includes('其他现金收支情况登记')) {
            // 查找该季度的所有财务日志
            const allQuarterLogs = state.operation.financialLogs.filter(log => {
              return log.year === year && log.quarter === quarter;
            });
            
            // 过滤出其他现金收支（只保留广告投放）
            const otherLogs = allQuarterLogs.filter(log => {
              // 排除已在其他步骤处理的日志类型，只保留广告投放
              return !log.description.includes('季初现金盘点') &&
                     !log.description.includes('应收账款') &&
                     !log.description.includes('原材料入库') &&
                     !log.description.includes('下原料订单') &&
                     !log.description.includes('产品研发投资') &&
                     !log.description.includes('支付行政管理费') &&
                     !log.description.includes('季度结束现金变动') &&
                     !log.description.includes('年度结束') &&
                     log.description.includes('广告'); // 只保留广告投放
            });
            
            if (otherLogs.length > 0) {
              // 格式化每条广告投放记录
              const formattedLogs = otherLogs.map(log => {
                return `${log.cashChange >= 0 ? '+' : ''}${log.cashChange}M (广告投放)`;
              });
              cellContent = formattedLogs.join(', ');
            } else {
              cellContent = '-';
            }
          }
          // 特殊处理：季初现金盘点
          else if (step.description.includes('季初现金盘点')) {
            // 第一年第一季度使用初始数据
            if (year === 1 && quarter === 1) {
              const cash = '40M';
              const finishedProducts = ''; // 初始成品库存为0
              const rawMaterials = ''; // 初始原材料库存为0
              
              // 格式化显示：现金总额，产品库存情况，原料库存情况
              cellContent = `${cash}，${finishedProducts}，${rawMaterials}`;
              
              // 清理显示文本，确保没有多余的逗号和空格
              cellContent = cellContent.replace(/，+/g, '，');
              cellContent = cellContent.replace(/，，/g, '，');
              cellContent = cellContent.replace(/，$/g, '');
              cellContent = cellContent.replace(/\s+/g, ' ').trim();
            } else {
              // 其他季度尝试从存档中获取数据
              let cash = '-';
              let finishedProducts = '';
              let rawMaterials = '';
              
              // 计算目标季度（季初现金盘点的数据来自上一季度末）
              const targetQuarter = quarter === 1 ? 4 : quarter - 1;
              const targetYear = quarter === 1 ? year - 1 : year;
              
              // 查找对应季度末的存档
              const targetSaveFiles = allSaveFiles.filter(saveFile => {
                // 检查存档中的年份和季度
                const saveYear = saveFile.state.operation.currentYear;
                const saveQuarter = saveFile.state.operation.currentQuarter;
                
                // 匹配目标年份和季度
                return saveYear === targetYear && saveQuarter === targetQuarter;
              });
              
              // 如果找到匹配的存档，使用最新的一个
              if (targetSaveFiles.length > 0) {
                // 按时间戳排序，获取最新的存档
                const latestSave = [...targetSaveFiles].sort((a, b) => b.timestamp - a.timestamp)[0];
                
                // 使用存档中的数据
                cash = `${latestSave.state.finance.cash}M`;
                
                // 格式化产品库存，只显示数量大于0的产品
                finishedProducts = latestSave.state.logistics.finishedProducts
                  .filter(product => product.quantity > 0)
                  .map(product => `${product.type}: ${product.quantity}`)
                  .join(', ');
                
                // 格式化原料库存，只显示数量大于0的原料
                rawMaterials = latestSave.state.logistics.rawMaterials
                  .filter(material => material.quantity > 0)
                  .map(material => `${material.type}: ${material.quantity}`)
                  .join(', ');
              } else {
                // 如果没有找到匹配的存档，回退到原来的逻辑
                // 查找该季度的季初日志
                const quarterStartLog = state.operation.financialLogs.find(log => {
                  return log.year === year && 
                         log.quarter === quarter && 
                         log.description.includes('季初现金盘点');
                });
                
                // 查找该季度的现金数据
                if (quarterStartLog) {
                  cash = `${quarterStartLog.newCash}M`;
                } else {
                  // 尝试从现金流量历史记录获取
                  const cashFlow = state.operation.cashFlowHistory.find(record => {
                    return record.year === year && record.quarter === quarter;
                  });
                  if (cashFlow) {
                    cash = `${cashFlow.cash}M`;
                  }
                }
                
                // 遍历所有财务日志，找到该季度之前的库存数据
                const logsBeforeQuarter = state.operation.financialLogs.filter(log => {
                  return (log.year < year) || (log.year === year && log.quarter < quarter);
                });
                
                // 如果有之前的日志，尝试从日志中提取库存信息
                if (logsBeforeQuarter.length > 0) {
                  // 查找最近的季初或季度末日志
                  const recentLog = [...logsBeforeQuarter]
                    .sort((a, b) => b.timestamp - a.timestamp)[0];
                  
                  // 从日志描述中提取库存信息
                  if (recentLog.description.includes('原料库存')) {
                    // 解析原料库存
                    const rawMaterialMatch = recentLog.description.match(/原料库存：([^，]+)/);
                    if (rawMaterialMatch) {
                      rawMaterials = rawMaterialMatch[1];
                    }
                    
                    // 解析成品库存
                    const finishedProductMatch = recentLog.description.match(/成品库存：([^，]+)/);
                    if (finishedProductMatch) {
                      finishedProducts = finishedProductMatch[1];
                    }
                  }
                }
              }
              
              // 格式化显示：现金总额，产品库存情况，原料库存情况
              cellContent = `${cash}，${finishedProducts}，${rawMaterials}`;
              
              // 清理显示文本，确保没有多余的逗号和空格
              cellContent = cellContent.replace(/，+/g, '，');
              cellContent = cellContent.replace(/，，/g, '，');
              cellContent = cellContent.replace(/，$/g, '');
              cellContent = cellContent.replace(/\s+/g, ' ').trim();
            }
          }
          // 特殊处理：现金结余数量
          else if (step.description.includes('本季库存（现金）结余数量')) {
            // 查找该季度的季度末日志
            const quarterEndLog = state.operation.financialLogs.find(log => {
              return log.year === year && 
                     log.quarter === quarter && 
                     log.description.includes('季度结束现金变动');
            });
            
            // 如果找不到季度末日志，尝试查找该季度的任何日志
            const anyQuarterLog = state.operation.financialLogs.find(log => {
              return log.year === year && log.quarter === quarter;
            });
            
            if (quarterEndLog) {
              cellContent = `${quarterEndLog.newCash}M`;
            } else if (anyQuarterLog) {
              // 如果有该季度的日志但没有季度末日志，显示最后一个日志的现金余额
              const lastQuarterLog = [...state.operation.financialLogs]
                .filter(log => log.year === year && log.quarter === quarter)
                .sort((a, b) => b.timestamp - a.timestamp)[0];
              cellContent = `${lastQuarterLog.newCash}M`;
            } else {
              cellContent = '-';
            }
          }
          // 特殊处理：产品研发投资
          else if (step.description.includes('产品研发投资')) {
            // 查找该季度的研发投资日志
            const rdLogs = state.operation.financialLogs.filter(log => {
              return log.year === year && 
                     log.quarter === quarter && 
                     (log.description.includes('产品研发投资') || 
                      log.description.includes('投资') && 
                      (log.description.includes('P2') || 
                       log.description.includes('P3') || 
                       log.description.includes('P4')));
            });
             
            if (rdLogs.length > 0) {
              // 格式化第一个研发日志
              const rdLog = rdLogs[0];
              // 从日志描述中提取产品名称
              const productMatch = rdLog.description.match(/P[234]/);
              const productName = productMatch ? productMatch[0] : '';
               
              cellContent = `${rdLog.cashChange >= 0 ? '+' : ''}${rdLog.cashChange}M ${productName ? `(${productName})` : ''}`;
            } else {
              cellContent = '-';
            }
          }
          // 特殊处理：下原料订单
          else if (step.description.includes('下原料订单')) {
            // 查找该季度的原料订单日志
            const materialOrderLogs = state.operation.financialLogs.filter(log => {
              return log.year === year && 
                     log.quarter === quarter && 
                     log.description.includes('下') && 
                     log.description.includes('原料订单');
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
              cellContent = formattedOrders.join(', ');
            } else {
              cellContent = '-';
            }
          }
          // 特殊处理：原材料入库/更新原材料单
          else if (step.description.includes('原材料入库/更新原材料单')) {
            // 计算当前季度对应的总季度数（第1年第1季度=1，第1年第2季度=2，...，第2年第1季度=5）
            const currentTotalPeriod = (year - 1) * 4 + quarter;
             
            // 查找预计在当前季度到货的原材料订单
            const arrivingOrders = state.logistics.rawMaterialOrders.filter(order => {
              return order.arrivalPeriod === currentTotalPeriod;
            });
             
            if (arrivingOrders.length > 0) {
              // 格式化所有到货的原料订单
              const formattedArrivals = arrivingOrders.map(order => {
                return `${order.quantity}${order.materialType}`;
              });
              cellContent = formattedArrivals.join(', ');
            } else {
              cellContent = '-';
            }
          }
          // 特殊处理：支付行政管理费（固定在第四季度）
          else if (step.description.includes('支付行政管理费')) {
            if (quarter === 4) {
              cellContent = '-1M';
            } else {
              cellContent = '-';
            }
          }
          // 特殊处理：收入合计和支出合计
          else if (step.description.includes('入库（收入）数量合计') || 
                   step.description.includes('出库（现金支出）合计')) {
            // 查找该季度的财务日志，计算合计
            const quarterLogs = state.operation.financialLogs.filter(log => {
              return log.year === year && log.quarter === quarter;
            });
            
            if (step.description.includes('入库（收入）数量合计')) {
              // 计算收入合计
              const totalIncome = quarterLogs
                .filter(log => log.cashChange > 0)
                .reduce((sum, log) => sum + log.cashChange, 0);
              cellContent = totalIncome > 0 ? `+${totalIncome}M` : '-';
            } else {
              // 计算支出合计
              const totalExpense = quarterLogs
                .filter(log => log.cashChange < 0)
                .reduce((sum, log) => sum + log.cashChange, 0);
              cellContent = totalExpense < 0 ? `${totalExpense}M` : '-';
            }
          }
          // 特殊处理：新年度规划会议和制定新年度计划固定在每年第一季度打勾
          else if (step.description.includes('新年度规划会议') || step.description.includes('制定新年度计划')) {
            // 固定在每年第一季度显示为已完成，其他季度显示横杠占位符
            cellContent = quarter === 1 ? '已完成' : '-';
          }
          // 其他操作项，显示是否完成
          else {
            cellContent = isCompleted ? '已完成' : '-';
          }
          
          row.push(cellContent);
        });
        
        csvContent += row.join(',') + '\n';
      });
      
      // 年份之间添加空行
      csvContent += '\n\n';
    });

    // 创建Blob对象
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    
    // 创建下载链接
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `运行控制表.csv`;
    
    // 触发下载
    document.body.appendChild(a);
    a.click();
    
    // 清理
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* 游戏结束报告 */}
      {operation.isGameOver && (
        <div className="dashboard-card">
          <div className="flex justify-between items-center mb-4">
            <h2 className="dashboard-title text-2xl font-bold text-green-600">模拟结束报告</h2>
            <button
              onClick={exportReport}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium flex items-center space-x-2"
            >
              <span>导出报告</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
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
                    {operationSteps.map((step, index) => (
                      <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="border border-gray-300 px-4 py-2 text-sm text-gray-600">{step.step || ''}</td>
                        <td className="border border-gray-300 px-4 py-2 text-sm text-gray-700">{step.description}</td>
                        {[1, 2, 3, 4].map(quarter => {
                          // 更灵活的匹配算法
                          const matchOperation = (log: any) => {
                            const logText = (log.action || log.description || '').toLowerCase();
                            const stepText = step.description.toLowerCase();
                            
                            // 关键词匹配
                            const keyWords = stepText.split(/[\s/、（）]/).filter(word => word.length > 0);
                            const matchCount = keyWords.filter(word => logText.includes(word)).length;
                            
                            // 如果匹配到2个以上关键词，或完全包含，或部分匹配
                            return matchCount >= 2 || 
                                   logText.includes(stepText) || 
                                   stepText.includes(logText) ||
                                   (logText.length > 0 && keyWords.some(word => logText.includes(word)));
                          };
                          
                          // 根据日志记录判断该操作是否完成
                          const isCompleted = state.operation.operationLogs.some(log => {
                            return matchOperation(log);
                          });
                          
                          // 根据财务日志获取具体数值
                          const financialLog = state.operation.financialLogs.find(log => {
                            return log.year === year && 
                                   log.quarter === quarter && 
                                   matchOperation(log);
                          });
                          
                          // 特殊处理：季初现金盘点
                          if (step.description.includes('季初现金盘点')) {
                            // 第一年第一季度使用初始数据
                            if (year === 1 && quarter === 1) {
                              const cash = '40M';
                              const finishedProducts = ''; // 初始成品库存为0
                              const rawMaterials = ''; // 初始原材料库存为0
                               
                              // 格式化显示：现金总额，产品库存情况，原料库存情况
                              const displayText = `${cash}，${finishedProducts}，${rawMaterials}`;
                               
                              // 清理显示文本，确保没有多余的逗号和空格
                              let cleanedText = displayText;
                              // 移除连续的逗号
                              cleanedText = cleanedText.replace(/，+/g, '，');
                              // 移除产品库存和原料库存之间的空逗号
                              cleanedText = cleanedText.replace(/，，/g, '，');
                              // 移除末尾的逗号
                              cleanedText = cleanedText.replace(/，$/g, '');
                              // 移除连续的空格
                              cleanedText = cleanedText.replace(/\s+/g, ' ').trim();
                               
                              return (
                                <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
                                  <div className="text-sm font-medium text-blue-600">
                                    {cleanedText}
                                  </div>
                                </td>
                              );
                            }
                             
                            // 其他季度尝试从存档中获取数据
                            let cash = '-';
                            let finishedProducts = '';
                            let rawMaterials = '';
                             
                            // 获取所有存档
                            const allSaveFiles = getSaveFiles();
                             
                            // 计算目标季度（季初现金盘点的数据来自上一季度末）
                            const targetQuarter = quarter === 1 ? 4 : quarter - 1;
                            const targetYear = quarter === 1 ? year - 1 : year;
                             
                            // 查找对应季度末的存档
                            const targetSaveFiles = allSaveFiles.filter(saveFile => {
                              // 检查存档中的年份和季度
                              const saveYear = saveFile.state.operation.currentYear;
                              const saveQuarter = saveFile.state.operation.currentQuarter;
                               
                              // 匹配目标年份和季度
                              return saveYear === targetYear && saveQuarter === targetQuarter;
                            });
                             
                            // 如果找到匹配的存档，使用最新的一个
                            if (targetSaveFiles.length > 0) {
                              // 按时间戳排序，获取最新的存档
                              const latestSave = [...targetSaveFiles].sort((a, b) => b.timestamp - a.timestamp)[0];
                               
                              // 使用存档中的数据
                              cash = `${latestSave.state.finance.cash}M`;
                               
                              // 格式化产品库存，只显示数量大于0的产品
                              finishedProducts = latestSave.state.logistics.finishedProducts
                                .filter(product => product.quantity > 0)
                                .map(product => `${product.type}: ${product.quantity}`)
                                .join(', ');
                               
                              // 格式化原料库存，只显示数量大于0的原料
                              rawMaterials = latestSave.state.logistics.rawMaterials
                                .filter(material => material.quantity > 0)
                                .map(material => `${material.type}: ${material.quantity}`)
                                .join(', ');
                            } else {
                              // 如果没有找到匹配的存档，回退到原来的逻辑
                              // 查找该季度的季初日志
                              const quarterStartLog = state.operation.financialLogs.find(log => {
                                return log.year === year && 
                                       log.quarter === quarter && 
                                       log.description.includes('季初现金盘点');
                              });
                               
                              // 查找该季度的现金数据
                              if (quarterStartLog) {
                                cash = `${quarterStartLog.newCash}M`;
                              } else {
                                // 尝试从现金流量历史记录获取
                                const cashFlow = state.operation.cashFlowHistory.find(record => {
                                  return record.year === year && record.quarter === quarter;
                                });
                                if (cashFlow) {
                                  cash = `${cashFlow.cash}M`;
                                }
                              }
                               
                              // 遍历所有财务日志，找到该季度之前的库存数据
                              const logsBeforeQuarter = state.operation.financialLogs.filter(log => {
                                return (log.year < year) || (log.year === year && log.quarter < quarter);
                              });
                               
                              // 如果有之前的日志，尝试从日志中提取库存信息
                              if (logsBeforeQuarter.length > 0) {
                                // 查找最近的季初或季度末日志
                                const recentLog = [...logsBeforeQuarter]
                                  .sort((a, b) => b.timestamp - a.timestamp)[0];
                               
                                // 从日志描述中提取库存信息
                                if (recentLog.description.includes('原料库存')) {
                                  // 解析原料库存
                                  const rawMaterialMatch = recentLog.description.match(/原料库存：([^，]+)/);
                                  if (rawMaterialMatch) {
                                    rawMaterials = rawMaterialMatch[1];
                                  }
                                   
                                  // 解析成品库存
                                  const finishedProductMatch = recentLog.description.match(/成品库存：([^，]+)/);
                                  if (finishedProductMatch) {
                                    finishedProducts = finishedProductMatch[1];
                                  }
                                }
                              }
                            }
                             
                            // 格式化显示：现金总额，产品库存情况，原料库存情况
                            const displayText = `${cash}，${finishedProducts}，${rawMaterials}`;
                             
                            // 清理显示文本，确保没有多余的逗号和空格
                            let cleanedText = displayText;
                            // 移除连续的逗号
                            cleanedText = cleanedText.replace(/，+/g, '，');
                            // 移除产品库存和原料库存之间的空逗号
                            cleanedText = cleanedText.replace(/，，/g, '，');
                            // 移除末尾的逗号
                            cleanedText = cleanedText.replace(/，$/g, '');
                            // 移除连续的空格
                            cleanedText = cleanedText.replace(/\s+/g, ' ').trim();
                             
                            return (
                              <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
                                <div className="text-sm font-medium text-blue-600">
                                  {cleanedText}
                                </div>
                              </td>
                            );
                          }
                          
                          // 特殊处理：现金结余数量
                          if (step.description.includes('本季库存（现金）结余数量')) {
                            // 查找该季度的季度末日志
                            const quarterEndLog = state.operation.financialLogs.find(log => {
                              return log.year === year && 
                                     log.quarter === quarter && 
                                     log.description.includes('季度结束现金变动');
                            });
                             
                            // 如果找不到季度末日志，尝试查找该季度的任何日志
                            const anyQuarterLog = state.operation.financialLogs.find(log => {
                              return log.year === year && log.quarter === quarter;
                            });
                             
                            if (quarterEndLog) {
                              return (
                                <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
                                  <div className="text-sm font-medium text-blue-600">
                                    {quarterEndLog.newCash}M
                                  </div>
                                </td>
                              );
                            } else if (anyQuarterLog) {
                              // 如果有该季度的日志但没有季度末日志，显示最后一个日志的现金余额
                              const lastQuarterLog = [...state.operation.financialLogs]
                                .filter(log => log.year === year && log.quarter === quarter)
                                .sort((a, b) => b.timestamp - a.timestamp)[0];
                                
                              return (
                                <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
                                  <div className="text-sm font-medium text-blue-600">
                                    {lastQuarterLog.newCash}M
                                  </div>
                                </td>
                              );
                            } else {
                              // 如果没有任何日志，显示横线占位符
                              return (
                                <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
                                  <div className="w-6 h-0 border-t border-gray-400 mx-auto"></div>
                                </td>
                              );
                            }
                          }
                          
                          // 特殊处理：产品研发投资
                          if (step.description.includes('产品研发投资')) {
                            // 查找该季度的研发投资日志
                            const rdLogs = state.operation.financialLogs.filter(log => {
                              return log.year === year && 
                                     log.quarter === quarter && 
                                     (log.description.includes('产品研发投资') || 
                                      log.description.includes('投资') && 
                                      (log.description.includes('P2') || 
                                       log.description.includes('P3') || 
                                       log.description.includes('P4')));
                            });
                            
                            if (rdLogs.length > 0) {
                              // 格式化第一个研发日志
                              const rdLog = rdLogs[0];
                              // 从日志描述中提取产品名称
                              const productMatch = rdLog.description.match(/P[234]/);
                              const productName = productMatch ? productMatch[0] : '';
                              
                              return (
                                <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
                                  <div className="text-sm font-medium text-blue-600">
                                    {rdLog.cashChange >= 0 ? '+' : ''}{rdLog.cashChange}M {productName ? `(${productName})` : ''}
                                  </div>
                                </td>
                              );
                            } else {
                              // 如果没有研发投资，显示横线占位符（与其他行保持一致）
                              return (
                                <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
                                  <div className="w-6 h-0 border-t border-gray-400 mx-auto"></div>
                                </td>
                              );
                            }
                          }
                          
                          // 特殊处理：下原料订单
                          if (step.description.includes('下原料订单')) {
                            // 查找该季度的原料订单日志
                            const materialOrderLogs = state.operation.financialLogs.filter(log => {
                              return log.year === year && 
                                     log.quarter === quarter && 
                                     log.description.includes('下') && 
                                     log.description.includes('原料订单');
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
                              
                              return (
                                <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
                                  <div className="text-sm font-medium text-blue-600">
                                    {formattedOrders.join(', ')}
                                  </div>
                                </td>
                              );
                            } else {
                              // 如果没有原料订单，显示横线占位符
                              return (
                                <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
                                  <div className="w-6 h-0 border-t border-gray-400 mx-auto"></div>
                                </td>
                              );
                            }
                          }
                          
                          // 特殊处理：原材料入库/更新原材料单
                          if (step.description.includes('原材料入库/更新原材料单')) {
                            // 计算当前季度对应的总季度数（第1年第1季度=1，第1年第2季度=2，...，第2年第1季度=5）
                            const currentTotalPeriod = (year - 1) * 4 + quarter;
                            
                            // 查找预计在当前季度到货的原材料订单
                            const arrivingOrders = state.logistics.rawMaterialOrders.filter(order => {
                              return order.arrivalPeriod === currentTotalPeriod;
                            });
                            
                            if (arrivingOrders.length > 0) {
                              // 格式化所有到货的原料订单
                              const formattedArrivals = arrivingOrders.map(order => {
                                return `${order.quantity}${order.materialType}`;
                              });
                              
                              return (
                                <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
                                  <div className="text-sm font-medium text-blue-600">
                                    {formattedArrivals.join(', ')}
                                  </div>
                                </td>
                              );
                            } else {
                              // 如果没有原材料入库，显示横线占位符
                              return (
                                <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
                                  <div className="w-6 h-0 border-t border-gray-400 mx-auto"></div>
                                </td>
                              );
                            }
                          }
                          
                          // 特殊处理：支付行政管理费
                          if (step.description.includes('支付行政管理费')) {
                            // 行政管理费固定发生在每年第四季度
                            if (quarter === 4) {
                              // 查找该年度第四季度的季度末日志
                              const quarterEndLogs = state.operation.financialLogs.filter(log => {
                                return log.year === year && 
                                       log.quarter === quarter && 
                                       log.description.includes('季度结束现金变动') && 
                                       log.description.includes('行政管理费');
                              });
                              
                              if (quarterEndLogs.length > 0) {
                                // 行政管理费固定为1M
                                return (
                                  <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
                                    <div className="text-sm font-medium text-blue-600">
                                      -1M
                                    </div>
                                  </td>
                                );
                              }
                            }
                            
                            // 非第四季度或没有找到日志，显示横线占位符
                            return (
                              <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
                                <div className="w-6 h-0 border-t border-gray-400 mx-auto"></div>
                              </td>
                            );
                          }
                          
                          // 特殊处理：开始下一批生产
                          else if (step.description.includes('开始下一批生产')) {
                            // 查找该季度的生产相关日志
                            const productionLogs = state.operation.operationLogs.filter(log => {
                              return log.action.includes('开始生产') && 
                                     (log.dataChange || '').includes(`第${year}年第${quarter}季度`);
                            });
                            
                            // 获取所有运行中的生产线，计算生产费用
                            const runningLines = state.production.factories.flatMap(factory => 
                              factory.productionLines.filter(line => line.status === 'running')
                            );
                            
                            // 如果有运行中的生产线，计算生产费用
                            if (runningLines.length > 0) {
                              // 计算每条生产线的生产费用（只计算加工费）
                              const productionCosts = runningLines.map(line => {
                                // 只计算加工费，因为原料已经订购过了
                                // 加工费用：根据生产线类型不同
                                const processingCost = line.type === 'automatic' ? 1 : 
                                                     line.type === 'semi-automatic' ? 1 : 
                                                     line.type === 'manual' ? 1 : 1;
                                
                                // 总生产费用
                                const totalCost = processingCost;
                                
                                return {
                                  cost: -totalCost, // 支出为负数
                                  product: line.product,
                                  lineType: line.type
                                };
                              });
                              
                              // 合并同类项：按产品和生产线类型分组
                              const groupedCosts = productionCosts.reduce((acc, item) => {
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
                              }, {} as Record<string, { cost: number; product: string; lineType: string; count: number }>);
                              
                              // 格式化生产记录
                              const formattedProduction = Object.values(groupedCosts).map(item => {
                                // 简化生产线类型显示
                                const simplifiedLineType = item.lineType === 'automatic' ? '自' : 
                                                        item.lineType === 'semi-automatic' ? '半' :
                                                        item.lineType === 'manual' ? '手' : '柔';
                                return `${item.cost}M (${item.product}，${simplifiedLineType})`;
                              });
                              
                              return (
                                <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
                                  <div className="text-sm font-medium text-blue-600">
                                    {formattedProduction.join('/')}
                                  </div>
                                </td>
                              );
                            } else {
                              // 没有生产记录，显示横线占位符
                              return (
                                <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
                                  <div className="w-6 h-0 border-t border-gray-400 mx-auto"></div>
                                </td>
                              );
                            }
                          }
                          // 特殊处理：其他现金收支情况登记
                          else if (step.description.includes('其他现金收支情况登记')) {
                            // 查找该季度的所有财务日志
                            const allQuarterLogs = state.operation.financialLogs.filter(log => {
                              return log.year === year && log.quarter === quarter;
                            });
                            
                            // 过滤出其他现金收支（只保留广告投放）
                            const otherLogs = allQuarterLogs.filter(log => {
                              // 排除已在其他步骤处理的日志类型，只保留广告投放
                              return !log.description.includes('季初现金盘点') &&
                                     !log.description.includes('应收账款') &&
                                     !log.description.includes('原材料入库') &&
                                     !log.description.includes('下原料订单') &&
                                     !log.description.includes('产品研发投资') &&
                                     !log.description.includes('支付行政管理费') &&
                                     !log.description.includes('季度结束现金变动') &&
                                     !log.description.includes('年度结束') &&
                                     log.description.includes('广告'); // 只保留广告投放
                            });
                            
                            if (otherLogs.length > 0) {
                              // 格式化每条广告投放记录
                              const formattedLogs = otherLogs.map(log => {
                                return `${log.cashChange >= 0 ? '+' : ''}${log.cashChange}M (广告投放)`;
                              });
                              
                              return (
                                <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
                                  <div className="text-sm font-medium text-blue-600">
                                    {formattedLogs.join(', ')}
                                  </div>
                                </td>
                              );
                            } else {
                              // 没有广告投放，显示横线占位符
                              return (
                                <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
                                  <div className="w-6 h-0 border-t border-gray-400 mx-auto"></div>
                                </td>
                              );
                            }
                          }
                          
                          // 特殊处理：收入合计和支出合计
                          if (step.description.includes('入库（收入）数量合计') || 
                              step.description.includes('出库（现金支出）合计')) {
                            // 计算该季度的收入或支出合计
                            const isIncome = step.description.includes('收入');
                            const total = state.operation.financialLogs
                              .filter(log => log.year === year && log.quarter === quarter)
                              .reduce((sum, log) => {
                                const change = isIncome ? 
                                  (log.cashChange > 0 ? log.cashChange : 0) : 
                                  (log.cashChange < 0 ? log.cashChange : 0); // 使用负数值而不是绝对值
                                return sum + change;
                              }, 0);
                              
                            // 收入显示正数，支出显示负数
                            if (total !== 0) {
                              return (
                                <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
                                  <div className="text-sm font-medium text-blue-600">
                                    {/* 收入显示+号，支出保留负号 */}
                                    {isIncome ? (total > 0 ? '+' : '') : ''}{total}M
                                  </div>
                                </td>
                              );
                            }
                          }
                          
                          // 特殊处理：新年度规划会议和制定新年度计划固定在每年第一季度打勾
                          if (step.description.includes('新年度规划会议') || step.description.includes('制定新年度计划')) {
                            // 固定在每年第一季度显示为已完成
                            if (quarter === 1) {
                              return (
                                <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
                                  <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center mx-auto">
                                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
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
                          
                          // 检查是否有其他相关日志
                          const hasRelatedLog = state.operation.financialLogs.some(log => {
                            return log.year === year && log.quarter === quarter;
                          });
                          
                          return (
                            <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
                              {isCompleted ? (
                                <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center mx-auto">
                                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
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
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 运营概览（游戏未结束时显示） */}
      {!operation.isGameOver && (
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
          </div>
        </div>
      )}

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