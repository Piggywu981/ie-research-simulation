'use client';
import React, { useState } from 'react';
import { useEnterpriseStore } from '../store/enterpriseStore';
import { RawMaterial, FinishedProduct, RawMaterialOrder } from '../types/enterprise';

const LogisticsCenter: React.FC = () => {
  const { state, placeRawMaterialOrder, cancelRawMaterialOrder } = useEnterpriseStore();
  const { logistics, operation } = state;
  
  // 下订单表单状态
  const [orderForm, setOrderForm] = useState({
    materialType: 'R1' as 'R1' | 'R2' | 'R3' | 'R4',
    quantity: 1,
  });

  // 处理表单输入变化
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setOrderForm(prev => ({
      ...prev,
      [name]: type === 'number' ? parseInt(value) || 1 : value,
    }));
  };

  // 提交订单
  const handleSubmitOrder = (e: React.FormEvent) => {
    e.preventDefault();
    placeRawMaterialOrder(orderForm.materialType, orderForm.quantity);
    // 重置表单
    setOrderForm(prev => ({
      ...prev,
      quantity: 1,
    }));
  };

  // 获取原材料的采购提前期
  const getLeadTime = (materialType: string) => {
    const material = logistics.rawMaterials.find((m: RawMaterial) => m.type === materialType);
    return material ? material.leadTime : 0;
  };

  return (
    <div className="space-y-6">
      {/* 物流数据概览 */}
      <div className="dashboard-card">
        <h2 className="dashboard-title">物流数据概览</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="text-sm text-blue-600 mb-1">原材料种类</div>
            <div className="text-2xl font-bold text-blue-800">{logistics.rawMaterials.length}</div>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <div className="text-sm text-green-600 mb-1">成品种类</div>
            <div className="text-2xl font-bold text-green-800">{logistics.finishedProducts.length}</div>
          </div>
          <div className="bg-yellow-50 p-4 rounded-lg">
            <div className="text-sm text-yellow-600 mb-1">原材料总数量</div>
            <div className="text-2xl font-bold text-yellow-800">
              {logistics.rawMaterials.reduce((sum: number, material: RawMaterial) => sum + material.quantity, 0)}
            </div>
          </div>
          <div className="bg-purple-50 p-4 rounded-lg">
            <div className="text-sm text-purple-600 mb-1">成品总数量</div>
            <div className="text-2xl font-bold text-purple-800">
              {logistics.finishedProducts.reduce((sum: number, product: FinishedProduct) => sum + product.quantity, 0)}
            </div>
          </div>
        </div>
      </div>

      {/* 库存管理 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 原材料库存 */}
        <div className="dashboard-card">
          <h2 className="dashboard-title">原材料库存</h2>
          <div className="grid grid-cols-2 gap-4">
            {logistics.rawMaterials.map((material: RawMaterial) => (
              <div key={material.type} className="border border-gray-200 rounded-lg p-4 bg-white">
                <div className="flex justify-between items-center mb-2">
                  <div className="font-medium">{material.name}</div>
                  <div className="text-sm text-gray-500">{material.type}</div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-3xl font-bold text-gray-800">{material.quantity}</div>
                  <div className="text-sm text-gray-600">
                    采购提前期: {material.leadTime}Q
                  </div>
                </div>
                <div className="mt-3">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-blue-500 h-2 rounded-full" 
                      style={{ width: `${Math.min((material.quantity / 10) * 100, 100)}%` }}
                    ></div>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">库存水平</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 成品库存 */}
        <div className="dashboard-card">
          <h2 className="dashboard-title">成品库存</h2>
          <div className="grid grid-cols-2 gap-4">
            {logistics.finishedProducts.map((product: FinishedProduct) => (
              <div key={product.type} className="border border-gray-200 rounded-lg p-4 bg-white">
                <div className="flex justify-between items-center mb-2">
                  <div className="font-medium">{product.name}</div>
                  <div className="text-sm text-gray-500">{product.type}</div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-3xl font-bold text-gray-800">{product.quantity}</div>
                  <div className="text-sm text-gray-600">
                    单价: {product.price}M
                  </div>
                </div>
                <div className="mt-3">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-green-500 h-2 rounded-full" 
                      style={{ width: `${Math.min((product.quantity / 10) * 100, 100)}%` }}
                    ></div>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">库存水平</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 原材料订单管理 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 原材料订单 */}
        <div className="dashboard-card">
          <h2 className="dashboard-title">原材料订单</h2>
          {logistics.rawMaterialOrders.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              暂无未完成的原材料订单
            </div>
          ) : (
            <div className="space-y-3">
              {logistics.rawMaterialOrders.map((order: RawMaterialOrder) => (
                <div key={order.id} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="font-medium">{order.materialType} 订单</div>
                      <div className="text-sm text-gray-600">
                        数量: {order.quantity} 个, 单价: {order.price}M
                      </div>
                    </div>
                    <div className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-medium">
                      预计 {order.arrivalPeriod}Q 到货
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                    <div className="flex justify-between">
                      <span className="text-gray-600">下单季度:</span>
                      <span>{order.orderPeriod}Q</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">订单金额:</span>
                      <span>{order.quantity * order.price}M</span>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={() => cancelRawMaterialOrder(order.id)}
                      className="text-red-600 hover:text-red-800 text-sm font-medium"
                    >
                      取消订单
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 下原材料订单 */}
        <div className="dashboard-card">
          <h2 className="dashboard-title">下原材料订单</h2>
          <form onSubmit={handleSubmitOrder} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                原材料类型
              </label>
              <select
                name="materialType"
                value={orderForm.materialType}
                onChange={handleInputChange}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              >
                {logistics.rawMaterials.map((material: RawMaterial) => (
                  <option key={material.type} value={material.type}>
                    {material.name} ({material.type}) - 提前期 {material.leadTime}Q
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                数量
              </label>
              <input
                type="number"
                name="quantity"
                min="1"
                value={orderForm.quantity}
                onChange={handleInputChange}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
            </div>
            <div className="bg-blue-50 p-3 rounded-lg">
              <div className="text-sm text-blue-800 mb-1">
                采购信息
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">当前季度:</span>
                  <span>{operation.currentQuarter}Q</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">预计到货季度:</span>
                  <span>{operation.currentQuarter + getLeadTime(orderForm.materialType)}Q</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">单价:</span>
                  <span>
                    {logistics.rawMaterials.find((m: RawMaterial) => m.type === orderForm.materialType)?.price}M
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">订单总金额:</span>
                  <span>
                    {orderForm.quantity * (logistics.rawMaterials.find((m: RawMaterial) => m.type === orderForm.materialType)?.price || 0)}M
                  </span>
                </div>
              </div>
            </div>
            <button
              type="submit"
              className="w-full bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-600 font-medium"
            >
              提交订单
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default LogisticsCenter;