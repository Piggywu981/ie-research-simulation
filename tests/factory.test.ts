import { beforeEach, describe, it, expect } from 'vitest';
import { useEnterpriseStore, createFreshState } from '../src/store/enterpriseStore';
import { landAndBuildings, annualRent, RENT_BY_TYPE } from '../src/utils/rules';

const store = () => useEnterpriseStore.getState();
const resetStore = () => {
  useEnterpriseStore.setState({ state: createFreshState(), validationError: null });
};

beforeEach(() => resetStore());

describe('厂房权属与派生资产', () => {
  it('初始状态：大厂房自有、小厂房租赁；土地和建筑=40M、当年租金=3M', () => {
    const factories = store().state.production.factories;
    expect(factories[0].holding).toBe('owned');
    expect(factories[1].holding).toBe('leased');
    expect(landAndBuildings(factories)).toBe(40);
    expect(annualRent(factories)).toBe(3);
    expect(RENT_BY_TYPE.large).toBe(5);
  });

  it('annualRent 只认 leasedThisYear 快照，不认实时 holding', () => {
    const factories = [
      { type: 'small' as const, purchasePrice: 30, leasedThisYear: true },
      { type: 'large' as const, purchasePrice: 40, leasedThisYear: false },
    ];
    expect(annualRent(factories)).toBe(3);
  });

  it('v2 存档缺失权属字段时按槽位补齐', () => {
    const legacy = JSON.parse(JSON.stringify(createFreshState()));
    delete legacy.production.factories[0].holding;
    delete legacy.production.factories[0].leasedThisYear;
    delete legacy.production.factories[1].holding;
    delete legacy.production.factories[1].leasedThisYear;
    useEnterpriseStore.getState().loadGame({
      id: 's1', name: '旧档', enterpriseName: '企业1', timestamp: Date.now(),
      resetCount: 0, version: 2, state: legacy, createdAt: new Date().toISOString(),
    });
    const fs = store().state.production.factories;
    expect(fs[0].holding).toBe('owned');
    expect(fs[0].leasedThisYear).toBe(false);
    expect(fs[1].holding).toBe('leased');
    expect(fs[1].leasedThisYear).toBe(true);
  });
});
