'use client';
import React, { useState } from 'react';
import { useEnterpriseStore } from '../store/enterpriseStore';
import { Factory, ProductionLine } from '../types/enterprise';

const ProductionCenter: React.FC = () => {
  const { state, investProductR_D, addProductionLine, removeProductionLine, cancelProduction, startProduction } = useEnterpriseStore();
  const { production, finance, productionLineLimits } = state;
  const [addingLine, setAddingLine] = useState<string | null>(null); // 记录当前正在添加生产线的厂房ID
  const [selectedProduct, setSelectedProduct] = useState<'P1' | 'P2' | 'P3' | 'P4'>('P1');
  const [selectedLineType, setSelectedLineType] = useState<'automatic' | 'semi-automatic' | 'manual' | 'flexible'>('automatic');

  // 计算已使用的生产线数量
  const getUsedProductionLines = (lineType: 'automatic' | 'semi-automatic' | 'manual' | 'flexible') => {
    return production.factories.reduce((total: number, factory: any) => {
      return total + factory.productionLines.filter((line: any) => line.type === lineType).length;
    }, 0);
  };

  // 获取生产线剩余数量
  const getRemainingProductionLines = (lineType: 'automatic' | 'semi-automatic' | 'manual' | 'flexible') => {
    return productionLineLimits[lineType] - getUsedProductionLines(lineType);
  };

  // 生产线类型配置
  const lineConfig = {
    automatic: {
      name: '全自动生产线',
      purchasePrice: 16,
      productionPeriod: 1,
      description: '1季度生产1个产品，高投资，高效率',
    },
    'semi-automatic': {
      name: '半自动生产线',
      purchasePrice: 8,
      productionPeriod: 2,
      description: '2季度生产1个产品，中等投资，中等效率',
    },
    manual: {
      name: '手工线',
      purchasePrice: 5,
      productionPeriod: 3,
      description: '3季度生产1个产品，低投资，低效率',
    },
    flexible: {
      name: '柔性线',
      purchasePrice: 24,
      productionPeriod: 1,
      description: '1季度生产1个产品，高投资，高效率，无转产费用',
    },
  };

  // 获取生产线状态的样式类
  const getStatusClass = (status: string) => {
    switch (status) {
      case 'running':
        return 'bg-green-500 text-white';
      case 'converting':
        return 'bg-yellow-500 text-white';
      case 'maintaining':
        return 'bg-blue-500 text-white';
      case 'idle':
        return 'bg-gray-500 text-white';
      case 'selling':
        return 'bg-red-500 text-white';
      default:
        return 'bg-gray-300 text-gray-700';
    }
  };

  // 获取生产线状态的中文名称
  const getStatusName = (status: string) => {
    switch (status) {
      case 'running':
        return '生产中';
      case 'converting':
        return '转产中';
      case 'maintaining':
        return '维护中';
      case 'idle':
        return '闲置';
      case 'selling':
        return '出售中';
      default:
        return '未知状态';
    }
  };

  return (
    <div className="space-y-6">
      {/* 生产数据概览 */}
      <div className="dashboard-card">
        <h2 className="dashboard-title">生产数据概览</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="text-sm text-blue-600 mb-1">厂房数量</div>
            <div className="text-2xl font-bold text-blue-800">{production.factories.length}</div>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <div className="text-sm text-green-600 mb-1">生产线数量</div>
            <div className="text-2xl font-bold text-green-800">
              {production.factories.reduce((sum: number, factory: any) => sum + factory.productionLines.length, 0)}
            </div>
          </div>
          <div className="bg-yellow-50 p-4 rounded-lg">
            <div className="text-sm text-yellow-600 mb-1">在制品数量</div>
            <div className="text-2xl font-bold text-yellow-800">
              {production.factories.reduce((sum: number, factory: any) => 
                sum + factory.productionLines.reduce((lineSum: number, line: any) => lineSum + line.inProgressProducts, 0), 0)}
            </div>
          </div>
        </div>
      </div>

      {/* 厂房与生产线布局 */}
      <div className="dashboard-card">
        <h2 className="dashboard-title">厂房与生产线布局</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {production.factories.map((factory: Factory) => (
            <div key={factory.id} className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">{factory.name}</h3>
                <div className="text-sm text-gray-500">
                  容量: {factory.productionLines.length}/{factory.capacity} 条生产线
                </div>
              </div>
              
              {/* 生产线列表 */}
              <div className="space-y-3">
                {factory.productionLines.map((line: ProductionLine) => (
                  <div key={line.id} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="font-medium">{line.name}</div>
                        <div className="text-sm text-gray-600">生产 {line.product}</div>
                      </div>
                      <div className={`px-2 py-1 rounded text-xs font-medium ${getStatusClass(line.status)}`}>
                        {getStatusName(line.status)}
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">生产周期:</span>
                        <span>{line.productionPeriod}Q</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">维护费:</span>
                        <span>{line.maintenanceCost}M/年</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">剩余寿命:</span>
                        <span>{line.remainingLife}年</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">在制品:</span>
                        <span>{line.inProgressProducts}个</span>
                      </div>
                    </div>
                    
                    {/* 操作按钮 */}
                    <div className="mt-3 flex gap-2">
                      {line.status === 'running' && (
                        <button
                          onClick={() => cancelProduction(line.id)}
                          className="flex-1 bg-red-500 text-white py-1 px-3 rounded text-xs hover:bg-red-600 transition-colors"
                        >
                          取消生产
                        </button>
                      )}
                      {line.status === 'idle' && (
                        <button
                          onClick={() => startProduction(line.id)}
                          className="flex-1 bg-green-500 text-white py-1 px-3 rounded text-xs hover:bg-green-600 transition-colors"
                        >
                          开始生产
                        </button>
                      )}
                      <button
                        onClick={() => removeProductionLine(factory.id, line.id)}
                        className="bg-gray-500 text-white py-1 px-3 rounded text-xs hover:bg-gray-600 transition-colors"
                      >
                        移除
                      </button>
                    </div>
                  </div>
                ))}
                
                {/* 空闲生产线位置 */}
                {Array.from({ length: factory.capacity - factory.productionLines.length }).map((_, index) => (
                  <div key={`empty-${index}`} className="border-2 border-dashed border-gray-300 rounded-lg p-3 bg-white">
                    {addingLine === factory.id ? (
                      // 添加生产线表单
                      <div className="space-y-3">
                        <div className="text-center font-medium">添加新生产线</div>
                        <div>
                          <label className="block text-sm text-gray-600 mb-1">选择生产线类型:</label>
                          <select 
                            value={selectedLineType}
                            onChange={(e) => setSelectedLineType(e.target.value as 'automatic' | 'semi-automatic' | 'manual' | 'flexible')}
                            className="w-full border border-gray-300 rounded-md p-2 text-sm"
                          >
                            <option 
                              value="automatic" 
                              disabled={getRemainingProductionLines('automatic') <= 0}
                            >
                              全自动生产线 (剩余: {getRemainingProductionLines('automatic')})
                            </option>
                            <option 
                              value="semi-automatic" 
                              disabled={getRemainingProductionLines('semi-automatic') <= 0}
                            >
                              半自动生产线 (剩余: {getRemainingProductionLines('semi-automatic')})
                            </option>
                            <option 
                              value="manual" 
                              disabled={getRemainingProductionLines('manual') <= 0}
                            >
                              手工线 (剩余: {getRemainingProductionLines('manual')})
                            </option>
                            <option 
                              value="flexible" 
                              disabled={getRemainingProductionLines('flexible') <= 0}
                            >
                              柔性线 (剩余: {getRemainingProductionLines('flexible')})
                            </option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm text-gray-600 mb-1">选择产品:</label>
                          <select 
                            value={selectedProduct}
                            onChange={(e) => setSelectedProduct(e.target.value as 'P1' | 'P2' | 'P3' | 'P4')}
                            className="w-full border border-gray-300 rounded-md p-2 text-sm"
                          >
                            <option value="P1">P1 (已完成研发)</option>
                            <option value="P2" disabled={!production.productRD.P2.completed}>
                              P2 ({production.productRD.P2.completed ? '已完成研发' : '研发中'})
                            </option>
                            <option value="P3" disabled={!production.productRD.P3.completed}>
                              P3 ({production.productRD.P3.completed ? '已完成研发' : '研发中'})
                            </option>
                            <option value="P4" disabled={!production.productRD.P4.completed}>
                              P4 ({production.productRD.P4.completed ? '已完成研发' : '研发中'})
                            </option>
                          </select>
                        </div>
                        <div className="bg-gray-50 p-2 rounded">
                          <div className="text-sm font-medium">{lineConfig[selectedLineType].name}规格:</div>
                          <div className="text-xs text-gray-600 mt-1">{lineConfig[selectedLineType].description}</div>
                          <div className="text-sm font-medium mt-1">价格: {lineConfig[selectedLineType].purchasePrice}M</div>
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => {
                              addProductionLine(factory.id, selectedLineType, selectedProduct);
                              setAddingLine(null);
                            }}
                            disabled={finance.cash < lineConfig[selectedLineType].purchasePrice}
                            className="flex-1 bg-blue-500 text-white py-2 px-3 rounded text-sm hover:bg-blue-600 disabled:bg-blue-300"
                          >
                            确认添加
                          </button>
                          <button 
                            onClick={() => setAddingLine(null)}
                            className="flex-1 bg-gray-300 text-gray-700 py-2 px-3 rounded text-sm hover:bg-gray-400"
                          >
                            取消
                          </button>
                        </div>
                        {finance.cash < lineConfig[selectedLineType].purchasePrice && (
                          <div className="text-xs text-red-500 text-center">
                            现金不足，需要{lineConfig[selectedLineType].purchasePrice}M
                          </div>
                        )}
                      </div>
                    ) : (
                      // 空闲位置显示
                      <div className="text-center">
                        <div className="text-gray-400 mb-2">空闲生产线位置</div>
                        <button 
                          onClick={() => setAddingLine(factory.id)}
                          className="bg-green-500 text-white py-1 px-3 rounded text-xs hover:bg-green-600"
                        >
                          添加生产线
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 产品研发进度 */}
      <div className="dashboard-card">
        <h2 className="dashboard-title">产品研发进度</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* P1 产品 */}
          <div className="border border-gray-200 rounded-lg p-4 bg-white">
            <div className="flex justify-between items-center mb-2">
              <div className="font-medium">P1 产品</div>
              <div className="status-active px-2 py-1 rounded text-xs">已完成</div>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
              <div className="bg-green-500 h-2 rounded-full" style={{ width: '100%' }}></div>
            </div>
            <div className="text-sm text-gray-600 text-center">无需额外研发</div>
          </div>

          {/* P2 产品 */}
          <div className="border border-gray-200 rounded-lg p-4 bg-white">
            <div className="flex justify-between items-center mb-2">
              <div className="font-medium">P2 产品</div>
              <div className={`px-2 py-1 rounded text-xs ${production.productRD.P2.completed ? 'status-active' : 'status-pending'}`}>
                {production.productRD.P2.completed ? '已完成' : '研发中'}
              </div>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
              <div 
                className="bg-blue-500 h-2 rounded-full" 
                style={{ width: `${(production.productRD.P2.progress / 6) * 100}%` }}
              ></div>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">进度:</span>
              <span>{production.productRD.P2.progress}/6Q</span>
            </div>
            <div className="flex justify-between text-sm mt-1">
              <span className="text-gray-600">总投资:</span>
              <span>{production.productRD.P2.totalInvestment}M</span>
            </div>
            <div className="mt-3">
              <button 
                className="w-full bg-blue-500 text-white py-1 px-3 rounded text-sm hover:bg-blue-600 disabled:bg-blue-300"
                onClick={() => investProductR_D('P2', 6)}
                disabled={production.productRD.P2.completed || production.productRD.P2.totalInvestment > 0}
              >
                投资研发
              </button>
            </div>
          </div>

          {/* P3 产品 */}
          <div className="border border-gray-200 rounded-lg p-4 bg-white">
            <div className="flex justify-between items-center mb-2">
              <div className="font-medium">P3 产品</div>
              <div className={`px-2 py-1 rounded text-xs ${production.productRD.P3.completed ? 'status-active' : 'status-pending'}`}>
                {production.productRD.P3.completed ? '已完成' : '研发中'}
              </div>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
              <div 
                className="bg-blue-500 h-2 rounded-full" 
                style={{ width: `${(production.productRD.P3.progress / 6) * 100}%` }}
              ></div>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">进度:</span>
              <span>{production.productRD.P3.progress}/6Q</span>
            </div>
            <div className="flex justify-between text-sm mt-1">
              <span className="text-gray-600">总投资:</span>
              <span>{production.productRD.P3.totalInvestment}M</span>
            </div>
            <div className="mt-3">
              <button 
                className="w-full bg-blue-500 text-white py-1 px-3 rounded text-sm hover:bg-blue-600 disabled:bg-blue-300"
                onClick={() => investProductR_D('P3', 6)}
                disabled={production.productRD.P3.completed || production.productRD.P3.totalInvestment > 0}
              >
                投资研发
              </button>
            </div>
          </div>

          {/* P4 产品 */}
          <div className="border border-gray-200 rounded-lg p-4 bg-white">
            <div className="flex justify-between items-center mb-2">
              <div className="font-medium">P4 产品</div>
              <div className={`px-2 py-1 rounded text-xs ${production.productRD.P4.completed ? 'status-active' : 'status-pending'}`}>
                {production.productRD.P4.completed ? '已完成' : '研发中'}
              </div>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
              <div 
                className="bg-blue-500 h-2 rounded-full" 
                style={{ width: `${(production.productRD.P4.progress / 6) * 100}%` }}
              ></div>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">进度:</span>
              <span>{production.productRD.P4.progress}/6Q</span>
            </div>
            <div className="flex justify-between text-sm mt-1">
              <span className="text-gray-600">总投资:</span>
              <span>{production.productRD.P4.totalInvestment}M</span>
            </div>
            <div className="mt-3">
              <button 
                className="w-full bg-blue-500 text-white py-1 px-3 rounded text-sm hover:bg-blue-600 disabled:bg-blue-300"
                onClick={() => investProductR_D('P4', 6)}
                disabled={production.productRD.P4.completed || production.productRD.P4.totalInvestment > 0}
              >
                投资研发
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductionCenter;