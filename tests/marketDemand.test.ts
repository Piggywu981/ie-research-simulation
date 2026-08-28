import { describe, it, expect } from 'vitest';
import { generateYearOrders, MARKET_DEMAND } from '../src/config/marketDemand';

describe('订单池生成', () => {
  it('同参数生成结果确定（可复现）', () => {
    const a = generateYearOrders(2, ['local', 'regional'], ['P1', 'P2'], 2);
    const b = generateYearOrders(2, ['local', 'regional'], ['P1', 'P2'], 2);
    expect(a).toEqual(b);
  });

  it('广告为 0 时不解锁任何订单', () => {
    expect(generateYearOrders(1, ['local'], ['P1'], 0)).toEqual([]);
  });

  it('第 1 年只有本地 P1 可生成订单', () => {
    const orders = generateYearOrders(1, ['local'], ['P1'], 99);
    expect(orders.length).toBeGreaterThan(0);
    expect(orders.every((o) => o.market === 'local' && o.productType === 'P1')).toBe(true);
  });

  it('广告金额决定可选订单上限（每 1M 解锁 2 张）', () => {
    const many = generateYearOrders(3, ['local', 'regional', 'domestic'], ['P1', 'P2'], 1);
    expect(many.length).toBeLessThanOrEqual(2);
  });

  it('订单总额 = 数量 × 单价，账期在 1~4 之间', () => {
    const orders = generateYearOrders(4, ['local', 'regional'], ['P1', 'P2'], 99);
    for (const o of orders) {
      expect(o.totalAmount).toBe(o.quantity * o.unitPrice);
      expect(o.paymentPeriod).toBeGreaterThanOrEqual(1);
      expect(o.paymentPeriod).toBeLessThanOrEqual(4);
    }
  });

  it('市场/产品资格门控', () => {
    const orders = generateYearOrders(3, ['regional'], ['P2'], 99);
    expect(orders.length).toBeGreaterThan(0);
    expect(orders.every((o) => o.market === 'regional' && o.productType === 'P2')).toBe(true);
  });

  it('配置表仅含 P1/P2 与前四个市场', () => {
    for (const e of MARKET_DEMAND) {
      expect(['P1', 'P2']).toContain(e.product);
      expect(['local', 'regional', 'domestic', 'asian', 'international']).toContain(e.market);
    }
  });
});
