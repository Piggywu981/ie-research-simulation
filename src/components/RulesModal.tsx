'use client';
import React from 'react';

// 规则说明弹窗：内置运营规则（重点标注修改后的广告投放规则）
const RULE_SECTIONS: { title: string; highlight?: boolean; items: string[] }[] = [
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
      '大厂房：买价40M、租金5M/年、容量6条线；小厂房：买价30M、租金3M/年、容量4条线。初始大厂房自有、小厂房租赁，年末支付租金。',
      '生产线：手工线5M/3Q、半自动8M/2Q、全自动16M/4Q、柔性线24M/4Q；加工费均为1M/产品。',
      '购买按安装周期平均支付投资，安装完成的下一季度方可生产；转产需周期与费用，完成后下一季度可换产品。',
      '维护费1M/年（年末支付）；当年在建与当年出售的生产线免维护费。',
      '折旧：每年按净值1/3取整计提（年末）；当年建成不提折旧；净值<3M时每年提1M。',
      '出售：净值<残值按净值转现金；净值>残值按残值转现金，差额计入综合费用。',
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
    title: '费用、折旧与税金',
    items: [
      '综合费用：行政管理费（进入第4季度收取1M）、市场开拓费、产品研发费、ISO认证费、广告费、转产费、设备维护费、厂房租金等。',
      '所得税：年末按税前利润25%计入应付税金，下一年年初交纳。',
    ],
  },
  {
    title: '运营时间',
    items: [
      '共4年16个季度：每年年初（规划会议、订货会、支付应付税）→ 4个季度运营 → 年末（长贷、维护费、租金、折旧、市场/ISO投资、结账）。',
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
