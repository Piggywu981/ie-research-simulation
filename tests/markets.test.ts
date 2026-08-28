import { beforeEach, describe, it, expect } from 'vitest';
import { useEnterpriseStore, createFreshState } from '../src/store/enterpriseStore';

const store = () => useEnterpriseStore.getState();
const advance = (n: number) => {
  for (let i = 0; i < n; i++) store().nextQuarter();
};
const injectCash = (amount: number) => {
  useEnterpriseStore.setState({
    state: { ...store().state, finance: { ...store().state.finance, cash: amount } },
  });
};

beforeEach(() => {
  useEnterpriseStore.setState({ state: createFreshState(), validationError: null });
});

describe('市场开拓年度模型', () => {
  it('非第4季度投资被拒绝', () => {
    store().investMarketDevelopment('regional');
    expect(store().validationError).toContain('第4季度');
    expect(store().state.finance.cash).toBe(20);
  });

  it('区域市场1年开拓：第1年年末投1M即获准入', () => {
    advance(3); // Q4
    injectCash(30);
    const cashBefore = store().state.finance.cash;
    store().investMarketDevelopment('regional');
    expect(store().validationError).toBeNull();
    expect(store().state.finance.cash).toBe(cashBefore - 1);
    const regional = store().state.marketing.markets.find(m => m.type === 'regional')!;
    expect(regional.status).toBe('available');
    expect(regional.yearsInvested).toBe(1);
    expect(store().state.operation.annualLedger.marketDevFee).toBe(1);
  });

  it('同一市场同年度重复投资被拒绝', () => {
    advance(3);
    injectCash(30);
    store().investMarketDevelopment('regional');
    store().investMarketDevelopment('regional');
    expect(store().validationError).toContain('本年度已投资');
  });

  it('国内市场需连续2年投资', () => {
    advance(3); // 第1年Q4
    injectCash(30);
    store().investMarketDevelopment('domestic');
    expect(store().validationError).toBeNull();
    let domestic = store().state.marketing.markets.find(m => m.type === 'domestic')!;
    expect(domestic.status).toBe('developing');
    advance(4); // 年末结算 + 进入第2年Q4
    injectCash(30);
    store().investMarketDevelopment('domestic');
    expect(store().validationError).toBeNull();
    domestic = store().state.marketing.markets.find(m => m.type === 'domestic')!;
    expect(domestic.status).toBe('available');
    expect(domestic.yearsInvested).toBe(2);
  });

  it('已准入市场年末未投1M维护则丧失准入（第1年豁免本地）', () => {
    // 第1年：本地未维护，豁免
    advance(4);
    expect(store().state.marketing.markets.find(m => m.type === 'local')!.status).toBe('available');
    // 第2年：本地未维护 → 丧失
    advance(4);
    const local = store().state.marketing.markets.find(m => m.type === 'local')!;
    expect(local.status).toBe('unavailable');
    expect(store().state.operation.operationLogs.some(l => l.action === '市场丧失准入')).toBe(true);
  });

  it('投1M维持则保留准入', () => {
    advance(7); // 第2年Q4
    injectCash(30);
    store().investMarketDevelopment('local'); // 维护本地
    expect(store().validationError).toBeNull();
    advance(1); // 年末结算
    expect(store().state.marketing.markets.find(m => m.type === 'local')!.status).toBe('available');
  });
});

describe('ISO认证年度模型', () => {
  it('非第4季度投资被拒绝', () => {
    store().investISOCertification('ISO9000');
    expect(store().validationError).toContain('第4季度');
  });

  it('ISO9000需连续2年投资，每年仅1次', () => {
    advance(3);
    injectCash(30);
    store().investISOCertification('ISO9000');
    expect(store().validationError).toBeNull();
    expect(store().state.marketing.isoCertifications.find(i => i.type === 'ISO9000')!.status).toBe('certifying');
    store().investISOCertification('ISO9000');
    expect(store().validationError).toContain('本年度已投资');
    advance(1); // 年末
    advance(3); // 第2年Q4
    injectCash(30);
    store().investISOCertification('ISO9000');
    expect(store().validationError).toBeNull();
    expect(store().state.marketing.isoCertifications.find(i => i.type === 'ISO9000')!.status).toBe('certified');
  });

  it('ISO14000需连续3年投资', () => {
    for (let y = 0; y < 3; y++) {
      advance(3); // 每年Q4
      injectCash(30);
      store().investISOCertification('ISO14000');
      expect(store().validationError).toBeNull();
      advance(1); // 年末
    }
    expect(store().state.marketing.isoCertifications.find(i => i.type === 'ISO14000')!.status).toBe('certified');
    expect(store().state.marketing.isoCertifications.find(i => i.type === 'ISO14000')!.totalCost).toBe(3);
  });
});
