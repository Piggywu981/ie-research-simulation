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