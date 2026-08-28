'use client';
import React, { useState } from 'react';
import { useEnterpriseStore } from '../store/enterpriseStore';

// 资金贴现面板：应收账款按 7 的倍数贴现，每 7M 支付 1M 贴息（到账 6M）
const DiscountPanel: React.FC = () => {
  const { state, discountReceivable, setValidationError } = useEnterpriseStore();
  const [amount, setAmount] = useState('');

  const totalReceivable = state.finance.accountsReceivable.reduce((s, v) => s + v, 0);
  const parsed = parseInt(amount, 10);

  const handleDiscount = () => {
    if (Number.isNaN(parsed) || parsed <= 0) {
      setValidationError('请输入有效的贴现金额');
      return;
    }
    discountReceivable(parsed);
    if (!useEnterpriseStore.getState().validationError) {
      setAmount('');
    }
  };

  const maxMultipleOf7 = Math.floor(totalReceivable / 7) * 7;

  return (
    <div className="dashboard-card">
      <h2 className="dashboard-title">资金贴现（7:1）</h2>
      <p className="text-sm text-gray-500 mb-3">
        应收款可随时贴现：金额为 7 的倍数，每 7M 支付 1M 贴息、到账 6M。
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="text-sm">
          <span className="text-gray-600">应收账款余额：</span>
          <span className="font-semibold text-gray-800">{totalReceivable}M</span>
          {maxMultipleOf7 > 0 && (
            <span className="text-gray-400 ml-2">（最多可贴 {maxMultipleOf7}M）</span>
          )}
        </div>
        <input
          type="number"
          min={7}
          step={7}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="贴现金额（7的倍数）"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-44"
          disabled={totalReceivable <= 0 || state.isPaused}
        />
        <button
          onClick={handleDiscount}
          disabled={totalReceivable < 7 || state.isPaused}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:bg-gray-300 text-sm font-medium"
        >
          贴现
        </button>
      </div>
      {parsed > 0 && parsed % 7 === 0 && (
        <p className="text-xs text-gray-500 mt-2">
          预计到账 {parsed - parsed / 7}M（贴息 {parsed / 7}M）
        </p>
      )}
    </div>
  );
};

export default DiscountPanel;
