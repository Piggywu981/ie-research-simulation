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

  // 生成报告数据
  const generateReportData = () => {
    // 获取所有存档文件
    const saveFiles = getSaveFiles();
    
    // 按年份和季度组织的报告数据
    const reportData: { [year: string]: { [quarter: string]: any[] } } = {
      '1': { '1': [], '2': [], '3': [], '4': [] },
      '2': { '1': [], '2': [], '3': [], '4': [] },
      '3': { '1': [], '2': [], '3': [], '4': [] },
      '4': { '1': [], '2': [], '3': [], '4': [] },
    };

    // 遍历所有财务日志
    state.operation.financialLogs.forEach(log => {
      const yearKey = log.year.toString();
      const quarterKey = log.quarter.toString();
      
      if (reportData[yearKey] && reportData[yearKey][quarterKey]) {
        reportData[yearKey][quarterKey].push(log);
      }
    });

    return reportData;
  };

  // 导出报告为CSV
  const exportReport = () => {
    // 生成符合运行控制表格式的CSV
    let csvContent = '序号,操作项\n';
    
    // 添加操作项
    operationSteps.forEach((step, index) => {
      // 只导出序号和操作项，不包含年份季度列
      const row = [
        step.step || '',
        step.description
      ];
      csvContent += row.join(',') + '\n';
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
                            const quarterStartLog = state.operation.financialLogs.find(log => {
                              return log.year === year && 
                                     log.quarter === quarter && 
                                     log.description.includes('季初现金盘点');
                            });
                            if (quarterStartLog) {
                              return (
                                <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
                                  <div className="text-sm font-medium text-blue-600">
                                    {quarterStartLog.newCash}M
                                  </div>
                                </td>
                              );
                            }
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
                            } else if (state.operation.cashFlowHistory) {
                              // 尝试从现金流量历史记录获取
                              const cashFlow = state.operation.cashFlowHistory.find(record => {
                                return record.year === year && record.quarter === quarter;
                              });
                              
                              if (cashFlow) {
                                return (
                                  <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
                                    <div className="text-sm font-medium text-blue-600">
                                      {cashFlow.cash}M
                                    </div>
                                  </td>
                                );
                              }
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
                              // 格式化第一个原料订单日志
                              const orderLog = materialOrderLogs[0];
                              // 从日志描述中提取原料类型和数量
                              const materialMatch = orderLog.description.match(/R[1234]/);
                              const quantityMatch = orderLog.description.match(/\d+个/);
                              
                              const materialType = materialMatch ? materialMatch[0] : '';
                              const quantity = quantityMatch ? quantityMatch[0].replace('个', '') : '';
                              
                              return (
                                <td key={quarter} className="border border-gray-300 px-4 py-2 text-center">
                                  <div className="text-sm font-medium text-blue-600">
                                    {orderLog.cashChange >= 0 ? '+' : ''}{orderLog.cashChange}M ({quantity}{materialType})
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