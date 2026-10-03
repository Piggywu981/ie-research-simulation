// 市场订单池：课程材料未提供官方需求预测表（详见设计规格第9节），
// 以下数值为参照经典沙盘教学的 P1/P2 需求曲线拟定的初始值，教师可按课程实际数据修改。
import type { ProductId } from '../utils/rules';

export type MarketId = 'local' | 'regional' | 'domestic' | 'asian' | 'international';

export interface DemandEntry {
  market: MarketId;
  product: 'P1' | 'P2';
  // 第1~4年可生成订单数
  ordersByYear: [number, number, number, number];
  unitPrice: [number, number]; // 单价区间（M，整数）
  quantityRange: [number, number];
}

export const MARKET_DEMAND: DemandEntry[] = [
  { market: 'local', product: 'P1', ordersByYear: [4, 5, 5, 4], unitPrice: [4, 6], quantityRange: [2, 5] },
  { market: 'local', product: 'P2', ordersByYear: [0, 3, 4, 4], unitPrice: [6, 8], quantityRange: [1, 4] },
  { market: 'regional', product: 'P1', ordersByYear: [2, 3, 3, 3], unitPrice: [4, 6], quantityRange: [1, 4] },
  { market: 'regional', product: 'P2', ordersByYear: [0, 2, 3, 3], unitPrice: [6, 8], quantityRange: [1, 3] },
  { market: 'domestic', product: 'P1', ordersByYear: [0, 1, 2, 2], unitPrice: [5, 7], quantityRange: [2, 4] },
  { market: 'domestic', product: 'P2', ordersByYear: [0, 1, 2, 2], unitPrice: [7, 9], quantityRange: [1, 3] },
];

// 市场开拓所需年数（本地初始已准入，无需开拓）
export const MARKET_DEVELOP_YEARS: Record<MarketId, number> = {
  local: 0,
  regional: 1,
  domestic: 2,
  asian: 3,
  international: 4,
};

// ISO 认证所需年数
export const ISO_REQUIRED_YEARS = { ISO9000: 2, ISO14000: 3 } as const;

// 每 1M 广告解锁 2 张可选订单（体现"市场订单数量有限，需合理投放广告"）
export const ORDERS_UNLOCKED_PER_AD = 2;

// 确定性伪随机（LCG），保证同一年同一配置生成的订单池可复现
const lcg = (seed: number) => () => (seed = (seed * 48271) % 2147483647) / 2147483647;

export interface GeneratedOrder {
  productType: 'P1' | 'P2';
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  paymentPeriod: number; // 1~4 季账期
  market: MarketId;
}

export function generateYearOrders(
  year: 1 | 2 | 3 | 4,
  availableMarkets: string[],
  qualifiedProducts: string[],
  adAmount: number,
): GeneratedOrder[] {
  const rand = lcg(year * 97 + 13);
  const pool: GeneratedOrder[] = [];
  for (const entry of MARKET_DEMAND) {
    if (!availableMarkets.includes(entry.market) || !qualifiedProducts.includes(entry.product)) continue;
    const count = entry.ordersByYear[year - 1];
    for (let i = 0; i < count; i++) {
      const quantity = entry.quantityRange[0] + Math.floor(rand() * (entry.quantityRange[1] - entry.quantityRange[0] + 1));
      const unitPrice = entry.unitPrice[0] + Math.floor(rand() * (entry.unitPrice[1] - entry.unitPrice[0] + 1));
      const paymentPeriod = 1 + Math.floor(rand() * 4);
      pool.push({
        productType: entry.product,
        quantity,
        unitPrice,
        totalAmount: quantity * unitPrice,
        paymentPeriod,
        market: entry.market,
      });
    }
  }
  // 订单按总额降序排列，广告投入决定可选数量上限
  pool.sort((a, b) => b.totalAmount - a.totalAmount);
  const unlocked = Math.max(0, adAmount) * ORDERS_UNLOCKED_PER_AD;
  return pool.slice(0, Math.min(pool.length, unlocked));
}
