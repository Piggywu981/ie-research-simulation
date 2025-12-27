'use client';
import React, { useState } from 'react';
import { useEnterpriseStore } from '../store/enterpriseStore';
import { FinancialLogRecord } from '../types/enterprise';
import ProductionCenter from '../components/ProductionCenter';
import LogisticsCenter from '../components/LogisticsCenter';
import MarketingCenter from '../components/MarketingCenter';
import OperationCenter from '../components/OperationCenter';
import SaveLoadPanel from '../components/SaveLoadPanel';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// 定义中心类型
type CenterType = 'finance' | 'production' | 'logistics' | 'marketing' | 'operation';

export default function Home() {
  const { state, applyLongTermLoan, applyShortTermLoan } = useEnterpriseStore();
  const { finance, operation } = state;
  const [activeCenter, setActiveCenter] = useState<CenterType>('finance');

  // 计算权益（股东资本 + 利润留存）
  const totalEquity = finance.equity + finance.retainedProfit;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 存档管理面板 */}
      <SaveLoadPanel />
      {/* 顶部导航栏 */}
      <header className="bg-white shadow-md">
        <div className="container mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center">
            <h1 className="text-xl font-bold text-gray-800">用友ERP沙盘模拟（企业1专属版）</h1>
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 bg-blue-50 px-3 py-1 rounded-full">
              <span className="text-sm font-medium text-blue-800">当前年度/季度：</span>
              <span className="text-sm font-bold text-blue-800">第{operation.currentYear}年 / 第{operation.currentQuarter}季度</span>
            </div>
            <div className="flex items-center space-x-2 bg-green-50 px-3 py-1 rounded-full">
              <span className="text-sm font-medium text-green-800">现金余额：</span>
              <span className="text-sm font-bold text-green-800">{finance.cash}M</span>
            </div>
            <div className="flex items-center space-x-2 bg-yellow-50 px-3 py-1 rounded-full">
              <span className="text-sm font-medium text-yellow-800">核心任务：</span>
              <span className="text-sm font-bold text-yellow-800">待支付应付税</span>
            </div>
          </div>
        </div>
      </header>

      {/* 主要内容区域 */}
      <main className="container mx-auto px-4 py-6">
        {/* 导航选项卡 */}
        <div className="bg-white rounded-lg shadow-md p-4 mb-6">
          <div className="flex space-x-4">
            <button 
              className={`px-4 py-2 rounded-md font-medium ${activeCenter === 'finance' ? 'bg-blue-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
              onClick={() => setActiveCenter('finance')}
            >
              财务中心
            </button>
            <button 
              className={`px-4 py-2 rounded-md font-medium ${activeCenter === 'production' ? 'bg-blue-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
              onClick={() => setActiveCenter('production')}
            >
              生产中心
            </button>
            <button 
              className={`px-4 py-2 rounded-md font-medium ${activeCenter === 'logistics' ? 'bg-blue-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
              onClick={() => setActiveCenter('logistics')}
            >
              物流中心
            </button>
            <button 
              className={`px-4 py-2 rounded-md font-medium ${activeCenter === 'marketing' ? 'bg-blue-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
              onClick={() => setActiveCenter('marketing')}
            >
              营销中心
            </button>
            <button 
              className={`px-4 py-2 rounded-md font-medium ${activeCenter === 'operation' ? 'bg-blue-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
              onClick={() => setActiveCenter('operation')}
            >
              运营流程
            </button>
          </div>
        </div>

        {/* 动态内容区域 */}
        {activeCenter === 'finance' && (
          /* 财务中心面板 */
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* 现金与贷款 */}
            <div className="md:col-span-2 space-y-4">
              <div className="dashboard-card">
                <h2 className="dashboard-title">财务数据概览</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <div className="text-sm text-blue-600 mb-1">现金</div>
                    <div className="text-2xl font-bold text-blue-800">{finance.cash}M</div>
                  </div>
                  <div className="bg-red-50 p-4 rounded-lg">
                    <div className="text-sm text-red-600 mb-1">长期贷款</div>
                    <div className="text-2xl font-bold text-red-800">{finance.longTermLoan.amount}M</div>
                  </div>
                  <div className="bg-yellow-50 p-4 rounded-lg">
                    <div className="text-sm text-yellow-600 mb-1">短期贷款</div>
                    <div className="text-2xl font-bold text-yellow-800">{finance.shortTermLoan.amount}M</div>
                  </div>
                  <div className="bg-green-50 p-4 rounded-lg">
                    <div className="text-sm text-green-600 mb-1">权益</div>
                    <div className="text-2xl font-bold text-green-800">{totalEquity}M</div>
                  </div>
                </div>
              </div>

              {/* 现金流量图 */}
              <div className="dashboard-card">
                <h2 className="dashboard-title">现金流量动态图</h2>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={state.operation.cashFlowHistory}
                      margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        dataKey={(entry) => `第${entry.year}年${entry.quarter}Q`} 
                        tick={{ fontSize: 12 }}
                      />
                      <YAxis 
                        label={{ value: '现金余额 (M)', angle: -90, position: 'insideLeft' }} 
                        tick={{ fontSize: 12 }}
                      />
                      <Tooltip 
                        formatter={(value) => [`${value}M`, '现金余额']} 
                        labelFormatter={(label) => `${label}`}
                      />
                      <Legend />
                      <Line 
                        type="monotone" 
                        dataKey="cash" 
                        name="现金余额" 
                        stroke="#1890ff" 
                        strokeWidth={2} 
                        dot={{ r: 4 }} 
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 贷款申请 */}
              <div className="dashboard-card">
                <h2 className="dashboard-title">贷款申请</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* 长期贷款 */}
                  <div className="border border-gray-200 rounded-lg p-4">
                    <h3 className="text-lg font-medium mb-4">长期贷款</h3>
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="text-sm text-gray-600">贷款期限</div>
                          <div className="font-medium">3年 (12季度)</div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-600">年息</div>
                          <div className="font-medium">10%</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="text-sm text-gray-600">贷款额度</div>
                          <div className="font-medium">每次20M，最多40M</div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-600">当前已贷</div>
                          <div className="font-medium">{finance.longTermLoan.amount}M</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="text-sm text-gray-600">贷款时间</div>
                          <div className="font-medium">每年年末</div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-600">还款方式</div>
                          <div className="font-medium">年底付息，到期还本</div>
                        </div>
                      </div>
                      <button 
                        className="w-full bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 disabled:bg-blue-300"
                        disabled={finance.longTermLoan.amount >= 40 || state.operation.currentQuarter !== 4}
                        onClick={applyLongTermLoan}
                      >
                        申请20M长期贷款
                      </button>
                      {state.operation.currentQuarter !== 4 && (
                        <div className="text-xs text-red-500 text-center">
                          只有在第4季度才能申请长期贷款
                        </div>
                      )}
                      {finance.longTermLoan.amount >= 40 && (
                        <div className="text-xs text-red-500 text-center">
                          长期贷款已达上限40M
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* 短期贷款 */}
                  <div className="border border-gray-200 rounded-lg p-4">
                    <h3 className="text-lg font-medium mb-4">短期贷款</h3>
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="text-sm text-gray-600">贷款期限</div>
                          <div className="font-medium">1年 (4季度)</div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-600">年息</div>
                          <div className="font-medium">5%</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="text-sm text-gray-600">贷款额度</div>
                          <div className="font-medium">每次20M，最多40M</div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-600">当前已贷</div>
                          <div className="font-medium">{finance.shortTermLoan.amount}M</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="text-sm text-gray-600">贷款时间</div>
                          <div className="font-medium">1月和6月 (季度1和季度3)</div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-600">还款方式</div>
                          <div className="font-medium">到期一次还本付息</div>
                        </div>
                      </div>
                      <button 
                        className="w-full bg-green-500 text-white py-2 px-4 rounded-md hover:bg-green-600 disabled:bg-green-300"
                        disabled={finance.shortTermLoan.amount >= 40 || ![1, 3].includes(state.operation.currentQuarter)}
                        onClick={applyShortTermLoan}
                      >
                        申请20M短期贷款
                      </button>
                      {!([1, 3].includes(state.operation.currentQuarter)) && (
                        <div className="text-xs text-red-500 text-center">
                          只有在第1和第3季度才能申请短期贷款
                        </div>
                      )}
                      {finance.shortTermLoan.amount >= 40 && (
                        <div className="text-xs text-red-500 text-center">
                          短期贷款已达上限40M
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* 财务日志 */}
              <div className="dashboard-card">
                <h2 className="dashboard-title">财务日志</h2>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          时间
                        </th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          描述
                        </th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          现金变动 (M)
                        </th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          新现金余额 (M)
                        </th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          操作人
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {state.operation.financialLogs.slice(0, 5).map((log: FinancialLogRecord) => (
                        <tr key={log.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            第{log.year}年{log.quarter}Q
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {log.description}
                          </td>
                          <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${log.cashChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {log.cashChange >= 0 ? '+' : ''}{log.cashChange}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {log.newCash}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {log.operator}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {state.operation.financialLogs.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    暂无财务日志
                  </div>
                )}
              </div>
            </div>

            {/* 右侧信息 */}
            <div className="space-y-4">
              {/* 短期贷款 */}
              <div className="dashboard-card">
                <h2 className="dashboard-title">短期贷款</h2>
                <div className="bg-red-50 p-4 rounded-lg space-y-2">
                  <div className="text-2xl font-bold text-red-800 text-center">
                    {finance.shortTermLoan.amount}M
                  </div>
                  <div className="text-sm text-red-600 flex justify-between">
                    <span>剩余期限:</span>
                    <span>{finance.shortTermLoan.term}季度</span>
                  </div>
                  <div className="text-sm text-red-600 flex justify-between">
                    <span>贷款利率:</span>
                    <span>{finance.shortTermLoan.interestRate * 100}%</span>
                  </div>
                </div>
              </div>

              {/* 长期贷款 */}
              <div className="dashboard-card">
                <h2 className="dashboard-title">长期贷款</h2>
                <div className="bg-orange-50 p-4 rounded-lg space-y-2">
                  <div className="text-2xl font-bold text-orange-800 text-center">
                    {finance.longTermLoan.amount}M
                  </div>
                  <div className="text-sm text-orange-600 flex justify-between">
                    <span>剩余期限:</span>
                    <span>{finance.longTermLoan.term}季度</span>
                  </div>
                  <div className="text-sm text-orange-600 flex justify-between">
                    <span>贷款利率:</span>
                    <span>{finance.longTermLoan.interestRate * 100}%</span>
                  </div>
                </div>
              </div>

              {/* 权益信息 */}
              <div className="dashboard-card">
                <h2 className="dashboard-title">权益信息</h2>
                <div className="space-y-2">
                  <div className="flex justify-between p-2 bg-gray-50 rounded">
                    <span className="text-sm">股东资本</span>
                    <span className="text-sm font-medium">{finance.equity}M</span>
                  </div>
                  <div className="flex justify-between p-2 bg-gray-50 rounded">
                    <span className="text-sm">利润留存</span>
                    <span className="text-sm font-medium">{finance.retainedProfit}M</span>
                  </div>
                  <div className="flex justify-between p-2 bg-gray-50 rounded">
                    <span className="text-sm">年度净利</span>
                    <span className="text-sm font-medium">{finance.annualNetProfit}M</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 生产中心 */}
        {activeCenter === 'production' && <ProductionCenter />}

        {/* 物流中心 */}
        {activeCenter === 'logistics' && <LogisticsCenter />}

        {/* 营销中心 */}
        {activeCenter === 'marketing' && <MarketingCenter />}

        {/* 运营流程 */}
        {activeCenter === 'operation' && <OperationCenter />}
      </main>
    </div>
  );
}