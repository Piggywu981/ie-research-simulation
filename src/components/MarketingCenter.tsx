'use client';
import React, { useState } from 'react';
import { useEnterpriseStore } from '../store/enterpriseStore';
import { Market, Order, ISOCertification, Advertisement } from '../types/enterprise';

const MarketingCenter: React.FC = () => {
  const { state, placeAdvertisement, selectOrder, deliverOrder, investMarketDevelopment, investISOCertification, addAvailableOrder, removeAvailableOrder, moveOrderToSelected } = useEnterpriseStore();
  const { marketing } = state;
  
  // 广告投放表单状态
  const [adForm, setAdForm] = useState({
    amount: 1,
  });

  // 新增可选订单表单状态
  const [newOrderForm, setNewOrderForm] = useState({
    productType: 'P1' as 'P1' | 'P2' | 'P3' | 'P4',
    quantity: 1,
    unitPrice: 2.0,
    paymentPeriod: 1,
    market: '本地市场',
  });

  // 处理广告投放表单变化
  const handleAdInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type } = e.target;
    setAdForm(prev => ({
      ...prev,
      [name]: type === 'number' ? parseInt(value) || 1 : value,
    }));
  };

  // 提交广告投放
  const handleSubmitAd = (e: React.FormEvent) => {
    e.preventDefault();
    placeAdvertisement(adForm.amount);
    // 重置表单
    setAdForm({ amount: 1 });
  };

  // 处理新增可选订单表单变化
  const handleNewOrderInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setNewOrderForm(prev => ({
      ...prev,
      [name]: type === 'number' ? parseFloat(value) || 0.1 : value as any,
    }));
  };

  // 提交新增可选订单
  const handleSubmitNewOrder = (e: React.FormEvent) => {
    e.preventDefault();
    // 计算总价
    const totalAmount = newOrderForm.quantity * newOrderForm.unitPrice;
    // 提交订单，包含计算的总价
    addAvailableOrder({
      ...newOrderForm,
      totalAmount,
    });
    // 重置表单
    setNewOrderForm({
      productType: 'P1',
      quantity: 1,
      unitPrice: 2.0,
      paymentPeriod: 1,
      market: '本地市场',
    });
  };

  // 获取市场状态样式
  const getMarketStatusClass = (status: string) => {
    switch (status) {
      case 'available':
        return 'bg-green-500 text-white';
      case 'developing':
        return 'bg-yellow-500 text-white';
      case 'unavailable':
        return 'bg-gray-500 text-white';
      default:
        return 'bg-gray-300 text-gray-700';
    }
  };

  // 获取市场状态中文名称
  const getMarketStatusName = (status: string) => {
    switch (status) {
      case 'available':
        return '已准入';
      case 'developing':
        return '开拓中';
      case 'unavailable':
        return '未启动';
      default:
        return '未知状态';
    }
  };

  // 获取ISO认证状态样式
  const getISOStatusClass = (status: string) => {
    switch (status) {
      case 'certified':
        return 'bg-green-500 text-white';
      case 'certifying':
        return 'bg-yellow-500 text-white';
      case 'uncertified':
        return 'bg-gray-500 text-white';
      default:
        return 'bg-gray-300 text-gray-700';
    }
  };

  // 获取ISO认证状态中文名称
  const getISOStatusName = (status: string) => {
    switch (status) {
      case 'certified':
        return '已认证';
      case 'certifying':
        return '认证中';
      case 'uncertified':
        return '未认证';
      default:
        return '未知状态';
    }
  };

  return (
    <div className="space-y-6">
      {/* 营销数据概览 */}
      <div className="dashboard-card">
        <h2 className="dashboard-title">营销数据概览</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="text-sm text-blue-600 mb-1">已准入市场</div>
            <div className="text-2xl font-bold text-blue-800">
              {marketing.markets.filter((m: Market) => m.status === 'available').length}
            </div>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <div className="text-sm text-green-600 mb-1">广告投放次数</div>
            <div className="text-2xl font-bold text-green-800">{marketing.advertisements.length}</div>
          </div>
          <div className="bg-yellow-50 p-4 rounded-lg">
            <div className="text-sm text-yellow-600 mb-1">已选择订单</div>
            <div className="text-2xl font-bold text-yellow-800">{marketing.selectedOrders.length}</div>
          </div>
          <div className="bg-purple-50 p-4 rounded-lg">
            <div className="text-sm text-purple-600 mb-1">已认证ISO</div>
            <div className="text-2xl font-bold text-purple-800">
              {marketing.isoCertifications.filter((iso: ISOCertification) => iso.status === 'certified').length}
            </div>
          </div>
        </div>
      </div>

      {/* 市场与ISO认证 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 市场开拓 */}
        <div className="dashboard-card">
          <h2 className="dashboard-title">市场开拓</h2>
          <div className="space-y-3">
            {marketing.markets.map((market: Market) => (
              <div key={market.type} className="border border-gray-200 rounded-lg p-4 bg-white">
                <div className="flex justify-between items-center mb-2">
                  <div className="font-medium">{market.name}</div>
                  <div className={`px-2 py-1 rounded text-xs font-medium ${getMarketStatusClass(market.status)}`}>
                    {getMarketStatusName(market.status)}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">开拓进度:</span>
                    <span>{market.developmentProgress}/{market.type === 'local' || market.type === 'regional' ? 4 : market.type === 'domestic' ? 8 : market.type === 'asian' ? 12 : 16}Q</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">年度维护费:</span>
                    <span>{market.annualMaintenanceCost}M</span>
                  </div>
                </div>
                <div className="mt-3">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-blue-500 h-2 rounded-full" 
                      style={{ 
                        width: `${Math.min((market.developmentProgress / (market.type === 'local' || market.type === 'regional' ? 4 : market.type === 'domestic' ? 8 : market.type === 'asian' ? 12 : 16)) * 100, 100)}%` 
                      }}
                    ></div>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">开拓进度</div>
                </div>
                {market.status !== 'available' && (
                  <button 
                    className="w-full mt-3 bg-blue-500 text-white py-1 px-3 rounded text-sm hover:bg-blue-600 disabled:bg-blue-300"
                    onClick={() => investMarketDevelopment(market.type)}
                    disabled={market.status === 'developing'}
                  >
                    投资开拓市场
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ISO认证 */}
        <div className="dashboard-card">
          <h2 className="dashboard-title">ISO认证</h2>
          <div className="space-y-3">
            {marketing.isoCertifications.map((iso: ISOCertification) => (
              <div key={iso.type} className="border border-gray-200 rounded-lg p-4 bg-white">
                <div className="flex justify-between items-center mb-2">
                  <div className="font-medium">{iso.name}</div>
                  <div className={`px-2 py-1 rounded text-xs font-medium ${getISOStatusClass(iso.status)}`}>
                    {getISOStatusName(iso.status)}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">认证进度:</span>
                    <span>{iso.certificationProgress}/{iso.type === 'ISO9000' ? 3 : 4}Q</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">已投资:</span>
                    <span>{iso.totalCost}M</span>
                  </div>
                </div>
                <div className="mt-3">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-green-500 h-2 rounded-full" 
                      style={{ 
                        width: `${Math.min((iso.certificationProgress / (iso.type === 'ISO9000' ? 3 : 4)) * 100, 100)}%` 
                      }}
                    ></div>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">认证进度</div>
                </div>
                {iso.status !== 'certified' && (
                  <button 
                    className="w-full mt-3 bg-green-500 text-white py-1 px-3 rounded text-sm hover:bg-green-600 disabled:bg-green-300"
                    onClick={() => investISOCertification(iso.type)}
                    disabled={iso.status === 'certifying'}
                  >
                    投资认证
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 广告投放 */}
      <div className="dashboard-card">
        <h2 className="dashboard-title">广告投放</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 广告投放表单 */}
          <div>
            <form onSubmit={handleSubmitAd} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  广告投放金额 (M)
                </label>
                <input
                  type="number"
                  name="amount"
                  min="1"
                  value={adForm.amount}
                  onChange={handleAdInputChange}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>
              <div className="bg-blue-50 p-3 rounded-lg">
                <div className="text-sm text-blue-800 mb-1">
                  广告投放规则（修改后）
                </div>
                <ul className="text-sm text-gray-600 space-y-1 list-disc pl-5">
                  <li>一次性投放，无需区分市场和产品</li>
                  <li>自动覆盖本地市场和区域市场</li>
                  <li>自动覆盖P1和P2产品</li>
                  <li>投放金额决定选单顺序</li>
                </ul>
              </div>
              <button
                type="submit"
                className="w-full bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-600 font-medium"
              >
                投放广告
              </button>
            </form>
          </div>
          
          {/* 广告投放记录 */}
          <div>
            <h3 className="text-lg font-medium mb-3">广告投放记录</h3>
            {marketing.advertisements.length === 0 ? (
              <div className="text-center py-4 text-gray-500">
                暂无广告投放记录
              </div>
            ) : (
              <div className="space-y-3 max-h-60 overflow-y-auto">
                {marketing.advertisements.map((ad: Advertisement) => (
                  <div key={ad.id} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                    <div className="flex justify-between items-start mb-2">
                      <div className="font-medium">广告投放</div>
                      <div className="text-sm text-gray-600">{ad.period}Q</div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">投放金额:</span>
                        <span>{ad.amount}M</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">覆盖市场:</span>
                        <span>{ad.markets.join(', ')}</span>
                      </div>
                      <div className="flex justify-between col-span-2">
                        <span className="text-gray-600">覆盖产品:</span>
                        <span>{ad.products.join(', ')}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 订单管理 */}
      <div className="dashboard-card">
        <h2 className="dashboard-title">订单管理</h2>
        
        {/* 新增可选订单表单 */}
        <div className="mb-6 p-4 bg-blue-50 rounded-lg">
          <h3 className="text-lg font-medium mb-3">新增可选订单</h3>
          <form onSubmit={handleSubmitNewOrder} className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">产品类型</label>
              <select
                name="productType"
                value={newOrderForm.productType}
                onChange={handleNewOrderInputChange}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              >
                <option value="P1">P1</option>
                <option value="P2">P2</option>
                <option value="P3">P3</option>
                <option value="P4">P4</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">数量</label>
              <input
                type="number"
                name="quantity"
                min="1"
                value={newOrderForm.quantity}
                onChange={handleNewOrderInputChange}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">单价 (M/个)</label>
              <input
                type="number"
                name="unitPrice"
                min="0.1"
                step="0.1"
                value={newOrderForm.unitPrice}
                onChange={handleNewOrderInputChange}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">账期 (Q)</label>
              <input
                type="number"
                name="paymentPeriod"
                min="1"
                max="4"
                value={newOrderForm.paymentPeriod}
                onChange={handleNewOrderInputChange}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">市场</label>
              <select
                name="market"
                value={newOrderForm.market}
                onChange={handleNewOrderInputChange}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              >
                <option value="本地市场">本地市场</option>
                <option value="区域市场">区域市场</option>
                <option value="国内市场">国内市场</option>
                <option value="亚洲市场">亚洲市场</option>
                <option value="国际市场">国际市场</option>
              </select>
            </div>
            <div className="md:col-span-5 text-right">
              <button
                type="submit"
                className="bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-600 font-medium"
              >
                新增可选订单
              </button>
            </div>
          </form>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 可选择订单 */}
          <div>
            <h3 className="text-lg font-medium mb-3">可选择订单</h3>
            {marketing.availableOrders.length === 0 ? (
              <div className="text-center py-4 text-gray-500">
                暂无可用订单
              </div>
            ) : (
              <div className="space-y-3 max-h-60 overflow-y-auto">
                {marketing.availableOrders.map((order: Order) => (
                  <div key={order.id} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="font-medium">{order.productType} 订单</div>
                        <div className="text-sm text-gray-600">市场: {order.market}</div>
                      </div>
                      <div className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-medium">
                        {order.paymentPeriod}Q 账期
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">数量:</span>
                        <span>{order.quantity} 个</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">单价:</span>
                        <span>{order.unitPrice}M</span>
                      </div>
                      <div className="flex justify-between col-span-2">
                        <span className="text-gray-600">总金额:</span>
                        <span className="font-medium">{order.totalAmount}M</span>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button 
                        className="flex-1 bg-blue-500 text-white py-1 px-3 rounded text-sm hover:bg-blue-600"
                        onClick={() => moveOrderToSelected(order.id)}
                      >
                        选择订单
                      </button>
                      <button 
                        className="bg-red-500 text-white py-1 px-3 rounded text-sm hover:bg-red-600"
                        onClick={() => removeAvailableOrder(order.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {/* 已选择订单 */}
          <div>
            <h3 className="text-lg font-medium mb-3">已选择订单</h3>
            {marketing.selectedOrders.length === 0 ? (
              <div className="text-center py-4 text-gray-500">
                暂无已选择的订单
              </div>
            ) : (
              <div className="space-y-3 max-h-60 overflow-y-auto">
                {marketing.selectedOrders.map((order: Order) => (
                  <div key={order.id} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="font-medium">{order.productType} 订单</div>
                        <div className="text-sm text-gray-600">市场: {order.market}</div>
                      </div>
                      <div className={`px-2 py-1 rounded text-xs font-medium ${order.isDelivered ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                        {order.isDelivered ? '已交货' : '待交货'}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">数量:</span>
                        <span>{order.quantity} 个</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">单价:</span>
                        <span>{order.unitPrice}M</span>
                      </div>
                      <div className="flex justify-between col-span-2">
                        <span className="text-gray-600">总金额:</span>
                        <span className="font-medium">{order.totalAmount}M</span>
                      </div>
                      <div className="flex justify-between col-span-2">
                        <span className="text-gray-600">账期:</span>
                        <span>{order.paymentPeriod}Q</span>
                      </div>
                    </div>
                    <button 
                      className="w-full mt-3 bg-green-500 text-white py-1 px-3 rounded text-sm hover:bg-green-600 disabled:bg-green-300"
                      onClick={() => deliverOrder(order.id)}
                      disabled={order.isDelivered}
                    >
                      {order.isDelivered ? '已交货' : '按订单交货'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MarketingCenter;