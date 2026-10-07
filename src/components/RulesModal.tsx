'use client';
import React from 'react';
// 能力边界那句与两条余地**只有一份**（src/utils/audit.ts，规格 §4.6）：核对报告的首行、README 与本弹窗
// 都 import 它，任何一处自己打一遍，三处就会各自漂走（tests/integrityCopy.test.ts 断引用相等，重写同字面量过不了）。
import { CAUSE_TEXT, INTEGRITY_BOUNDARY, INTEGRITY_CAVEATS } from '../utils/audit';

// 规则说明弹窗：内置运营规则（重点标注修改后的广告投放规则）
// RULE_SECTIONS 导出给 tests/integrityCopy.test.ts：本仓库测试环境是 node、无 jsdom（规格 §7），
// 渲染测不了，就断言**渲染要用的数据**——节是否存在、位置对不对、里面是不是那两个常量对象本身。
export const RULE_SECTIONS: { title: string; highlight?: boolean; items: string[] }[] = [
  {
    title: '广告投放规则（本系统修改项）',
    highlight: true,
    items: [
      '投放一次广告即同时完成本地市场和区域市场的宣传覆盖，且同时覆盖 P1、P2 两款产品，无需区分市场和产品单独投放。',
      '广告投放金额决定选单顺序与可选订单数量：每 1M 广告解锁 2 张可选订单。',
      '广告投放时机：每年年初（第1季度）订货会前。',
      '市场订单数量有限，广告投入不保证必然获得订单，请结合市场需求合理投放。',
    ],
  },
  {
    title: '市场开发与准入',
    items: [
      '市场划分：本地（初始已准入）、区域、国内、亚洲、国际。',
      '开拓费用与年限：区域 1M/1年、国内 2M/2年、亚洲 3M/3年、国际 4M/4年。',
      '市场开拓投资按年度支付（年末操作），每个市场每年最多投资 1M，可中断；全部投资完成后获得准入。',
      '已进入市场每年需投入 1M 维持（年末操作），否则视为放弃该市场。',
    ],
  },
  {
    title: '销售会议与订单争取',
    items: [
      '每年初召开销售会议（订货会），系统按已准入市场与产品资格生成当年订单池。',
      '订单信息包含产品类型、数量、单价、总额、账期。',
      '仅企业1参与订单选择，按广告投放金额解锁可选订单数量。',
    ],
  },
  {
    title: '厂房与生产线',
    items: [
      '厂房参数：大厂房 买价40M/租金5M·年/容量6条线；小厂房 买价30M/租金3M·年/容量4条线。厂房不提折旧，折旧只针对生产线设备。',
      '初始状态：大厂房自有、小厂房租赁。租金于年末（第4季度）按该年年初的租赁状态结算：年末新租从次年起计租；租赁中的厂房不能出售，只能先买断，也不提供退租。',
      '厂房交易：年末（第4季度）可购买（租赁中即买断、未持有即新购）或新租厂房；出售自有厂房四个季度皆可，但需先腾空该厂房内的生产线。未持有的槽位不能放置生产线。',
      '出售厂房按原值（大40M/小30M）计入4Q应收款，不当季到账，可按 7:1 规则贴现（与其他应收款同池、自最早账期起扣）。年末买断仍需支付当年租金。第4年第2季度起的出售在本年度内无法收现、款项将留在应收账款中（模拟在第4年末结束，4个季度账期已走不完，需要现金只能贴现）；第4年第1季度出售仍可正常收现。',
      '本系统为单企业设定，不存在其他企业，故"向其他企业购买/出售原材料""向其他企业购买/出售成品"两项操作不启用，运行控制表中这两行保留并在行名标注不启用理由。',
      '生产线：手工线5M/3Q、半自动8M/2Q、全自动16M/4Q、柔性线24M/4Q；加工费均为1M/产品。',
      '购买按安装周期平均支付投资，安装完成的下一季度方可生产；转产需周期与费用，完成后下一季度可换产品。',
      '维护费1M/年（年末支付）；当年在建与当年出售的生产线免维护费。',
      '折旧：每年按净值1/3取整计提（年末）；当年建成不提折旧；净值<3M时每年提1M。',
      '出售生产线：净值<残值按净值转现金；净值>残值按残值转现金，差额计入综合费用。',
    ],
  },
  {
    title: '采购与生产',
    items: [
      'R1、R2 订购提前1个季度；R3、R4 提前2个季度；到货入库时付款（现金不足计入应付款）。',
      '开始生产时按产品结构投料并支付加工费1M/产品：P1=R1、P2=R1+R2。',
      '每条生产线不可同时生产两种产品；缺料自动停产，原料充足后自动复工。',
    ],
  },
  {
    title: '产品研发与ISO认证',
    items: [
      '本期运营仅开放 P2 研发：周期6个季度、总投资6M，按季度平均支付（1M/季），现金不足自动中断、恢复后自动续投。',
      'ISO9000：≥2年、每年投资1M；ISO14000：≥3年、每年投资1M（年末操作，可同时或延期进行）。',
    ],
  },
  {
    title: '融资与资金管理',
    items: [
      '长期贷款：每年年末申请，每次20M，未还本余额最多40M，年息10%，期限3年，年底付息、到期还本。',
      '短期贷款：第1季度初（1月）和第3季度初（6月）放贷，每次20M，未还本余额最多40M，年息5%，期限1年，到期一次还本付息。',
      '资金贴现：有应收款时可随时进行，金额为7的倍数，每7M支付1M贴息（到账6M）。',
      '禁止民间借贷等违法行为。',
    ],
  },
  {
    title: '存档与完整性校验',
    highlight: true,
    items: [
      '存档包：一个 JSON 文件（不带 BOM），含当前进度、全部历史快照与两者指纹；可在另一台电脑或另一浏览器导入继续运营。',
      '导入默认不覆盖：与本机同 id 的历史帧不替换原有存档，而是追加新 id（形如 -imported-1）、列表名加注（导入1）；落库前先看预览，再由「仅加入存档列表」与「设为当前进度」二选一。',
      '账实重演算：每帧用自带的现金流水（kind=flow）独立重推余额并与帧末现金比对，只依据该帧、不跨帧拼接；不符时报出是第几年第几季，并给出「流水重演算」与「帧末现金」两个读数。',
      '缺期初现金种子的帧报「起算链不完整」，与「账实不符」是两种结论；后者分三类：'
        + `${CAUSE_TEXT['flow-log']} / ${CAUSE_TEXT['restated-log']} / ${CAUSE_TEXT['both']}。`,
      '包指纹：导出时对规范化 JSON 计算 SHA-256（另有逐帧指纹）。换设备或非 HTTPS 环境算不出摘要时，逐帧标注「哈希未计算（非 HTTPS 环境）」，绝不静默当成不一致。指纹只是篡改线索、不是锁：改完数据自己重算摘要的人防不住。',
      '核对报告：预览当场算出的逐帧结论与指纹判定可导出为 txt / json 两种，首行就是下面这句能力边界声明；报告只转录本机在预览那一刻算过的结果，不再重算一遍。',
      '导出与核对（读文件、算预览）在运营暂停时仍可用；只有会改动本机存档的两个落库动作要先继续运营。',
      INTEGRITY_BOUNDARY,
      // 两条余地**直接**引常量，前面不再垫一句说明（复审 item 4）：旧垫句是为解释常量里那句
      // 「条数见〔报告版面的〕帧统计」而写的方向指代——印在这里指向 nothing。现在句子本身上下文无关
      // （见 audit.ts 的 INTEGRITY_CAVEATS），补丁句就没了存在理由；留着它反而多出第四个版本。
      ...INTEGRITY_CAVEATS,
    ],
  },
  {
    title: '费用、折旧与税金',
    items: [
      '综合费用：行政管理费（进入第4季度收取1M）、市场开拓费、产品研发费、ISO认证费、广告费、转产费、设备维护费、厂房租金等。',
      '所得税：年末按税前利润25%计入应付税金，下一年年初交纳。',
    ],
  },
  {
    title: '运营时间',
    items: [
      '共4年16个季度：每年年初（规划会议、订货会、支付应付税）→ 4个季度运营（出售厂房四个季度皆可）→ 年末（长贷、维护费、租金与厂房购买/租赁、折旧、市场/ISO投资、结账）。',
      '第1年为建设周期，合理安排生产与市场开拓节奏。',
    ],
  },
];

const RulesModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-800">运营规则说明</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-4 space-y-5">
          {RULE_SECTIONS.map((section) => (
            <section
              key={section.title}
              className={`rounded-lg p-4 ${section.highlight ? 'bg-amber-50 border border-amber-300' : 'bg-gray-50'}`}
            >
              <h3 className={`font-semibold mb-2 ${section.highlight ? 'text-amber-700' : 'text-gray-700'}`}>
                {section.highlight ? '★ ' : ''}{section.title}
              </h3>
              <ul className="space-y-1.5">
                {section.items.map((item, i) => (
                  <li key={i} className="text-sm text-gray-600 leading-relaxed flex">
                    <span className="mr-2 text-gray-400">·</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="px-6 py-3 border-t border-gray-200 text-right">
          <button
            onClick={onClose}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium"
          >
            我已了解
          </button>
        </div>
      </div>
    </div>
  );
};

export default RulesModal;
