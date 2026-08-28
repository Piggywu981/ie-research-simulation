// 运行控制表：按年推导 + CSV 导出（纯函数，依据《你需要写一个用友沙盘ERP的模拟》行格式）
import type { FinancialLogRecord, SaveFile } from '../types/enterprise';

export interface ControlStep {
  id: string;
  name: string;
  phase: '年初' | '季度' | '年末';
}

// 与课程原始表格完全一致的 30 行（年初4 + 季度20 + 年末6）
export const CONTROL_STEPS: ControlStep[] = [
  { id: 'b-1', name: '新年度规划会议', phase: '年初' },
  { id: 'b-2', name: '参加订货会/登记销售订单', phase: '年初' },
  { id: 'b-3', name: '制定新年度计划', phase: '年初' },
  { id: 'b-4', name: '支付应付税', phase: '年初' },
  { id: 'q-1', name: '季初现金盘点（请填写库存数量）', phase: '季度' },
  { id: 'q-2', name: '更新短贷/还本付息', phase: '季度' },
  { id: 'q-3', name: '申请短期贷款', phase: '季度' },
  { id: 'q-4', name: '更新应付账款/归还应付账款', phase: '季度' },
  { id: 'q-5', name: '原材料入库/更新原材料单', phase: '季度' },
  { id: 'q-6', name: '下原料订单', phase: '季度' },
  { id: 'q-7', name: '更新生产/完工入库', phase: '季度' },
  { id: 'q-8', name: '投资新生产线/变卖生产线/生产线转产', phase: '季度' },
  { id: 'q-9', name: '（本项目未启用）', phase: '季度' },
  { id: 'q-10', name: '开始下一批生产', phase: '季度' },
  { id: 'q-11', name: '更新应收账款/应收账款收现', phase: '季度' },
  { id: 'q-12', name: '（本项目未启用：厂房不可交易）', phase: '季度' },
  { id: 'q-13', name: '（本项目未启用）', phase: '季度' },
  { id: 'q-14', name: '按订单交货', phase: '季度' },
  { id: 'q-15', name: '产品研发投资', phase: '季度' },
  { id: 'q-16', name: '支付行政管理费', phase: '季度' },
  { id: 'q-17', name: '其他现金收支情况登记', phase: '季度' },
  { id: 'q-18', name: '入库（收入）数量合计', phase: '季度' },
  { id: 'q-19', name: '出库（现金支出）合计', phase: '季度' },
  { id: 'q-20', name: '本季库存（现金）结余数量', phase: '季度' },
  { id: 'e-1', name: '支付利息/更新长期贷款/申请长期贷款', phase: '年末' },
  { id: 'e-2', name: '支付设备维护费', phase: '年末' },
  { id: 'e-3', name: '支付租金/购买厂房', phase: '年末' },
  { id: 'e-4', name: '计提折旧', phase: '年末' },
  { id: 'e-5', name: '新市场开拓/ISO资格认证投资', phase: '年末' },
  { id: 'e-6', name: '结账', phase: '年末' },
];

/** 组内日志按时间排序后拼为单元格文本 */
const joinLogs = (logs: FinancialLogRecord[]): string => {
  if (logs.length === 0) return '';
  return [...logs]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((l) => l.description)
    .join('；');
};

/** 快照的季度末现金（state 已推进到 (y,q)，即该季季初） */
const quarterStartSnapshot = (saves: SaveFile[], year: number, quarter: number): SaveFile | undefined =>
  saves
    .filter((s) => s.state.operation.currentYear === year && s.state.operation.currentQuarter === quarter)
    .sort((a, b) => b.timestamp - a.timestamp)[0];

/**
 * 生成第 year 年运行控制表数据行：[序号, 操作名称, 季度1, 季度2, 年度3, 季度4]
 * - 季度行：该年该季该步骤有事件则填日志描述串（有现金变动的），否则若有事件填 ✓
 * - q-1 盘点：优先用存档快照 (现金,原料,成品)；无快照时用盘点日志
 * - q-20 结余：该季结束后现金（下一季度快照现金或本季日志 newCash）
 * - q-18/q-19：本季日志现金收/支合计
 * - 年初/年末行：数据填在季度1列
 */
export function buildYearControlTable(
  year: number,
  logs: FinancialLogRecord[],
  saves: SaveFile[],
): string[][] {
  const yearLogs = logs.filter((l) => l.year === year);
  // 该年是否已运营过（有任何日志）：用于年初必经流程行的勾选
  const yearPlayed = yearLogs.length > 0;
  const byStepQuarter = (stepId: string, quarter: number) =>
    yearLogs.filter((l) => l.stepId === stepId && l.quarter === quarter);

  const snapshotCash = (y: number, q: number): number | null => {
    const snap = quarterStartSnapshot(saves, y, q);
    return snap ? snap.state.finance.cash : null;
  };

  return CONTROL_STEPS.map((step, index) => {
    const row: string[] = [String(index + 1), step.name, '', '', '', ''];
    if (step.phase !== '季度') {
      // 年初行数据在Q1；年末行归属收尾年度第4季度
      if (step.id === 'b-1' || step.id === 'b-3') {
        // 规划会议/年度计划为年初必经流程：已运营年份固定勾选
        row[2] = yearPlayed ? '✓' : '';
      } else {
        row[2] = joinLogs(byStepQuarter(step.id, step.phase === '年末' ? 4 : 1));
      }
      // 无数据也不留空白格
      if (!row[2]) row[2] = '—';
      return row;
    }
    for (let q = 1; q <= 4; q++) {
      const cellLogs = byStepQuarter(step.id, q);
      switch (step.id) {
        case 'q-1': {
          // 盘点：优先快照（(现金,原料,成品)），回退盘点日志
          const snap = quarterStartSnapshot(saves, year, q);
          if (snap) {
            const st = snap.state;
            const mats = st.logistics.rawMaterials.map((m) => `${m.quantity}${m.type}`).join('+') || '0';
            const prods = st.logistics.finishedProducts.map((p) => `${p.quantity}${p.type}`).join('+') || '0';
            row[2 + q - 1] = `(${st.finance.cash}M，${mats}，${prods})`;
          } else {
            row[2 + q - 1] = joinLogs(cellLogs);
          }
          break;
        }
        case 'q-18': {
          // 本季全部现金收入合计（跨步骤汇总）
          const income = yearLogs
            .filter((l) => l.quarter === q && l.cashChange > 0)
            .reduce((s, l) => s + l.cashChange, 0);
          row[2 + q - 1] = income > 0 ? `${income}M` : '';
          break;
        }
        case 'q-19': {
          // 本季全部现金支出合计（跨步骤汇总）
          const expense = yearLogs
            .filter((l) => l.quarter === q && l.cashChange < 0)
            .reduce((s, l) => s - l.cashChange, 0);
          row[2 + q - 1] = expense > 0 ? `-${expense}M` : '';
          break;
        }
        case 'q-20': {
          // 本季结余：下一季快照现金，回退本季日志
          const next = snapshotCash(year, q + 1) ?? (q === 4 ? snapshotCash(year + 1, 1) : null);
          if (next !== null) {
            row[2 + q - 1] = `${next}M`;
          } else {
            const endLog = cellLogs[cellLogs.length - 1];
            row[2 + q - 1] = endLog ? `${endLog.newCash}M` : '';
          }
          break;
        }
        default: {
          const cashLogs = cellLogs.filter((l) => l.cashChange !== 0);
          row[2 + q - 1] = cashLogs.length > 0 ? joinLogs(cashLogs) : cellLogs.length > 0 ? '✓' : '';
        }
      }
      // 无事件也不留空白格（未启用/未触发步骤统一填 —）
      if (!row[2 + q - 1]) row[2 + q - 1] = '—';
    }
    return row;
  });
}

/** 转为 CSV 文本（首行标题跨列占位） */
export function toCSV(rows: string[][], year: number): string {
  const title = `第${year}年运行控制表`;
  const lines = [
    `${title},,,,,`,
    `序号,操作名称,季度1,季度2,季度3,季度4`,
    ...rows.map((r) => r.map((cell) => {
      const text = String(cell ?? '');
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }).join(',')),
  ];
  return lines.join('\n');
}
