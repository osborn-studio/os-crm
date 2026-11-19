/** Deterministic fictional valve-sales dataset. No source documents or real company data. */
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
export const VERSION = '2.0';
export const DEMO_PASSWORD = '12345';
export const AS_OF = '2026-11-16';
export const SCALE = Object.freeze({
  customers: 15000,
  privateCustomers: 3000,
  opportunities: 2400,
  contracts: 360,
  leads: 240,
  convertedLeads: 150,
  followups: 9000,
  projects: 84,
  initialActions: 120,
});
export const accounts = [
  [1, 'admin', '天雨演示管理员', 'super_admin', 1],
  [1001, 'ty_boss', '天雨经营负责人', 'gm', 1],
  [1010, 'ty_mgr_east', '华东销售主管', 'sales_manager', 10],
  [1011, 'ty_mgr_south', '华南销售主管', 'sales_manager', 20],
  ...Array.from({ length: 6 }, (_, i) => [
    1100 + i,
    'ty_sales' + String(i + 1).padStart(2, '0'),
    (i < 3 ? '华东' : '华南') + '销售' + ((i % 3) + 1),
    'sales',
    i < 3 ? 10 : 20,
  ]),
  [1200, 'ty_pm', '项目交付负责人', 'sales_manager', 30],
  [1201, 'ty_engineer', '技术协作演示', 'sales', 30],
  [1300, 'ty_channel', '渠道业务演示', 'sales', 10],
  [1400, 'ty_finance', '财务复核演示管理员', 'super_admin', 40],
].map(([id, username, name, roleCode, deptId], i) => ({
  id,
  username,
  name,
  roleCode,
  deptId,
  employeeNo: 'TY' + String(i + 1).padStart(5, '0'),
}));
const day = (n) => new Date(Date.parse(AS_OF + 'T00:00:00Z') + n * 86400000).toISOString();
const fingerprint = (s) =>
  createHash('sha256').update(s.normalize('NFKC').replace(/\s+/gu, '').toLowerCase()).digest('hex');
const money = (n) => Number(n).toFixed(2);
const tax = (n) => {
  const gross = BigInt(Math.round(n * 100)),
    net = (gross * 100n + 56n) / 113n;
  const fmt = (c) => c / 100n + '.' + String(c % 100n).padStart(2, '0');
  return { amountExclTax: fmt(net), taxAmount: fmt(gross - net) };
};
const regions = ['华东', '华南', '华北', '西部'];
const names = ['澄川', '清岚', '远屿', '松澜', '栖岳', '星湾', '雁河', '临源', '青屿', '云杉'];
const industries = ['市政水务', '石油化工', '电力能源', '冶金制造', '工业配套', '渠道经销'];
const anchorNames = [
  '清源装备',
  '云澜化工',
  '慕源电力',
  '溪原水利',
  '澄源水务',
  '沧海化工',
  '海岚流控经销商',
  '远澜能源',
  '星屿装备',
  '雁川冶金',
  '临澜成套',
  '青屿水利',
];
const owners = [1100, 1101, 1102, 1103, 1104, 1105, 1300];
const owner = (i) => (i === 6 ? 1300 : i < 24 || [1200, 1208, 1209].includes(i) ? 1100 : owners[i % owners.length]);
const dept = (u) => accounts.find((a) => a.id === u).deptId;
const customerName = (i) =>
  i < 12
    ? anchorNames[i] + '（天雨示例）'
    : i === 1200
      ? '桐澜设备（天雨示例）'
      : `${names[i % 10]}${industries[i % 6]}${String(i + 1).padStart(6, '0')}（示例）`;
export function generate() {
  const groups = new Map();
  const add = (model, data) => {
    if (!groups.has(model)) groups.set(model, []);
    groups.get(model).push(data);
  };
  for (const [id, name, parentId, leaderId] of [
    [10, '华东销售部', 1, 1010],
    [20, '华南销售部', 1, 1011],
    [30, '技术与交付部', 1, 1200],
    [40, '商务财务部', 1, 1400],
  ])
    add('department', { id, code: 'TY-D' + id, name, parentId, leaderId });
  for (const a of accounts.filter((a) => a.id !== 1)) add('user', { ...a, status: 'active' });
  const products = Array.from({ length: 48 }, (_, i) => {
    const custom = i >= 32;
    return {
      id: 1000 + i,
      code: 'TY-' + (custom ? 'C' : 'S') + String(i + 1).padStart(3, '0'),
      name:
        (custom ? '定制' : '标准') +
        ['球阀', '闸阀', '蝶阀', '止回阀', '调节阀', '截止阀'][i % 6] +
        ' DN' +
        [25, 50, 80, 100, 150, 200][i % 6] +
        ' PN' +
        [16, 25, 40][i % 3],
      category: custom ? '定制阀门' : '标准阀门',
      subCategory: custom ? '按图供货' : '目录供货',
      specification: `${['碳钢', '不锈钢'][i % 2]} / ${['法兰', '对夹'][i % 2]} / ${['手动', '气动', '电动'][i % 3]}`,
      description: '天雨虚构演示产品；按客户需求确认规格和供货范围。',
      unit: '台',
      listPrice: money(1200 + (i % 12) * 800),
      taxRate: '13',
      sortOrder: i,
    };
  });
  for (const p of products) add('product', p);
  for (let i = 0; i < SCALE.customers; i++) {
    const privateCustomer = i < SCALE.privateCustomers,
      u = owner(i),
      name = customerName(i);
    add('customer', {
      id: 10000 + i,
      code: 'TY-KH-' + String(i + 1).padStart(6, '0'),
      name,
      nameFingerprint: fingerprint(name),
      shortName: i < 12 ? anchorNames[i] : names[i % 10] + String(i + 1),
      industry: industries[i % 6],
      customerCategory: i === 6 || i % 6 === 5 ? 'sales_channel' : 'direct',
      channelBrand: i === 6 || i % 6 === 5 ? '其他' : null,
      level: i < 24 ? '重点客户' : i % 3 ? '普通客户' : '潜在客户',
      region: regions[i % 4],
      address: regions[i % 4] + '示例工业园 ' + ((i % 200) + 1) + '号',
      website: 'https://example.invalid/tianyu/' + (i + 1),
      poolType: privateCustomer ? 'private' : 'public',
      ownerId: privateCustomer ? u : null,
      ownerDeptId: privateCustomer ? dept(u) : null,
      protectUntil: privateCustomer ? day(365) : null,
      lastFollowAt: day(privateCustomer ? -(i % 28) : -(100 + (i % 200))),
      createdBy: privateCustomer ? u : 1,
      createdAt: day(-30 - (i % 730)),
      tags: {
        demo: 'TIANYU',
        businessType: i % 3 === 2 ? '定制件' : '标准件',
        role: ['终端业主', 'EPC总包', '设计院', '成套厂', '终端业主', '经销商'][i % 6],
      },
      remark:
        i === 6
          ? '渠道客户，终端项目及付款单位在商机和合同中分别说明。'
          : '天雨阀门公开演示资料，所有客户及交易均为虚构。',
    });
    if (privateCustomer) {
      add('privateHolding', { customerId: 10000 + i, userId: u, claimedAt: day(-30), protectUntil: day(365) });
      for (let j = 0; j < 2; j++)
        add('contact', {
          id: 10000 + i * 2 + j,
          customerId: 10000 + i,
          name: (j ? '技术' : '采购') + '联系人' + String(i + 1),
          title: j ? '设备工程师' : '采购负责人',
          decisionRole: j ? 'influencer' : 'decision_maker',
          isPrimary: j === 0,
          email: `contact${i + 1}-${j}@example.invalid`,
          createdBy: u,
        });
    }
  }
  const contractStatuses = [
    'draft',
    'pending_approval',
    'rejected',
    'approved',
    'signed',
    'executing',
    'completed',
    'signed',
    'executing',
    'signed',
    'completed',
    'signed',
  ];
  const stages = ['new', 'qualified', 'proposal', 'negotiation', 'signing', 'delivery', 'acceptance', 'closed'];
  const probability = [10, 20, 40, 60, 80, 90, 95, 100];
  const amounts = [180000, 360000, 420000, 600000, 120000, 2400000, 960000, 1500000, 1200000, 800000, 500000, 1000000];
  const contracts = [];
  for (let i = 0; i < SCALE.opportunities; i++) {
    const signed =
      i < SCALE.contracts && !['draft', 'pending_approval', 'rejected', 'approved'].includes(contractStatuses[i % 12]);
    const status = signed ? 'won' : i >= SCALE.contracts && i % 10 >= 8 ? 'lost' : 'open';
    const stage =
      status === 'won'
        ? i % 12 === 6 || i % 12 === 10
          ? 'closed'
          : 'delivery'
        : status === 'lost'
          ? 'negotiation'
          : stages[i % 5];
    const amount = i < 12 ? amounts[i] : i === 1208 ? 1800000 : i === 1209 ? 900000 : 120000 + (i % 50) * 10000;
    const custom = i % 3 === 2,
      p = products[custom ? 32 + (i % 16) : i % 32],
      u = owner(i);
    const title =
      i === 1208
        ? '石化改造项目 商务掉单'
        : i === 1209
          ? '紧急交期项目 资源评估掉单'
          : (i < 12 ? anchorNames[i] : names[i % 10]) +
            ['水厂改造', '化工装置', '热电配套', '冶金检修', '成套设备', '经销备货'][i % 6] +
            ' ' +
            (custom ? '定制阀门' : '标准阀门') +
            '项目' +
            String(i + 1).padStart(5, '0');
    const sourceDate = day(-20 - (i % 450)).slice(0, 10);
    add('opportunity', {
      id: 10000 + i,
      code: 'TY-SJ-' + String(i + 1).padStart(5, '0'),
      name: title,
      customerId: 10000 + i,
      ownerId: u,
      stage,
      status,
      amount: money(amount),
      weightedAmount: status === 'open' ? money((amount * probability[stages.indexOf(stage)]) / 100) : '0',
      expectedCloseDate: status === 'open' ? day((i % 180) - 30) : day(-10 - (i % 400)),
      closedAt: status === 'open' ? null : day(-10 - (i % 400)),
      winDate: status === 'won' ? day(-10 - (i % 400)) : null,
      source: i === 6 || i % 6 === 5 ? '经销渠道' : '直销',
      priority: i < 24 ? 'high' : 'medium',
      isKey: i < 24,
      leadId: i < SCALE.convertedLeads ? 10000 + i : null,
      healthScore: 35 + (i % 60),
      healthFactors: {
        salesIntake: {
          caseKey: 'TY-' + String(i + 1),
          sourceDate,
          amountKnown: true,
          forecastEligible: true,
          amountBasis: '阀门供货含税金额',
          channel: i === 6 || i % 6 === 5 ? '经销渠道' : '直销',
          lossGroup: status === 'lost' ? 'confirmed' : null,
          lossConfirmedAt: status === 'lost' ? day(-10 - (i % 400)).slice(0, 10) : null,
        },
        demo: 'TIANYU',
      },
      lossReason: status === 'lost' ? (i === 1209 ? 'internal_capacity_shortage' : 'competitor') : null,
      lossDetail:
        status === 'lost'
          ? i === 1209
            ? '评估后确认项目窗口内人员与产能无法满足，主动放弃。'
            : '商务评估后客户选择其他供应方案，归档报价及跟进。'
          : null,
      contractId: i < SCALE.contracts ? 10000 + i : null,
      demandSummary: `${p.name}；${p.specification}；${custom ? '客户图纸版本B，技术澄清、评审及交付协调' : '目录供货，确认数量、交期及付款安排'}。${i === 6 ? '渠道为海岚流控，终端为澄源化工，合同付款方按经销商保留。' : ''}`,
      nextAction:
        status === 'open'
          ? '确认技术要求、报价反馈及签约排期'
          : status === 'lost'
            ? '完成掉单复盘，保留历史证据'
            : '按合同交付和回款节点推进',
      nextActionDate: status === 'lost' ? null : day(1 + (i % 14)),
      createdBy: u,
      createdAt: day(-20 - (i % 450)),
      lastFollowAt: day(-i % 28),
      followCount: i < 3000 ? 4 : 3,
    });
    add('opportunityProduct', {
      opportunityId: 10000 + i,
      productId: p.id,
      productName: p.name,
      quantity: custom ? 20 : 100,
      estimatedPrice: money(amount / (custom ? 20 : 100)),
      estimatedAmount: money(amount),
    });
    for (let v = 1; v <= (i < 24 ? 3 : 1); v++)
      add('opportunityQuote', {
        opportunityId: 10000 + i,
        version: v,
        total: money(i < 24 && v < 3 ? amount + (3 - v) * 10000 : amount),
        items: [
          {
            productId: p.id,
            productName: p.name,
            quantity: 1,
            estimatedPrice: money(i < 24 && v < 3 ? amount + (3 - v) * 10000 : amount),
            estimatedAmount: money(i < 24 && v < 3 ? amount + (3 - v) * 10000 : amount),
            specification: p.specification,
          },
        ],
        createdBy: u,
        createdAt: day(-20 - (i % 450) + v),
      });
    if (i < SCALE.contracts) {
      const cs = contractStatuses[i % 12];
      contracts.push({ i, id: 10000 + i, customerId: 10000 + i, ownerId: u, amount, signed, status: cs, title });
      add('contract', {
        id: 10000 + i,
        contractNo: 'TY-HT-' + String(i + 1).padStart(5, '0'),
        name: title + '供货合同',
        signingCompany: '天雨阀门科技有限公司（示例）',
        customerId: 10000 + i,
        opportunityId: 10000 + i,
        contractType: i === 6 ? 'channel' : 'other',
        amount: money(amount),
        ...tax(amount),
        taxRate: '13',
        status: cs,
        signDate: signed ? day(-10 - (i % 400)) : null,
        startDate: signed ? day(-10 - (i % 400)) : null,
        endDate: signed ? day(180 + (i % 360)) : null,
        durationMonths: custom ? 18 : 6,
        ownerId: u,
        totalOutstanding: signed ? money(amount) : '0',
        paymentTerms: '首付30%；发货款50%；验收15%；质保5%。分期金额及日期以回款计划为准。',
        remark: custom
          ? '定制供货：询价、图纸B版及技术澄清记录见商机和项目任务。'
          : '标准供货：报价、合同、订单及收款计划关联。',
        approvalId: 10000 + i * 3 + 2,
        createdBy: u,
        createdAt: day(-20 - (i % 450)),
      });
      add('contractItem', {
        contractId: 10000 + i,
        productId: p.id,
        itemName: p.name,
        itemType: 'hardware',
        quantity: custom ? 20 : 100,
        unit: '台',
        unitPrice: money(amount / (custom ? 20 : 100)),
        amount: money(amount),
        taxRate: '13',
        specification: p.specification,
      });
    }
  }
  for (let i = 0; i < SCALE.leads; i++)
    add('lead', {
      id: 10000 + i,
      code: 'TY-XS-' + String(i + 1).padStart(5, '0'),
      companyName: customerName(i < SCALE.convertedLeads ? i : 1200 + i),
      contactName: '采购联络人' + (i + 1),
      source: ['exhibition', 'referral', 'partner', 'website'][i % 4],
      industry: industries[i % 6],
      demand: '阀门产品询价、设备改造或渠道补货需求。',
      status: i < SCALE.convertedLeads ? 'converted' : ['new', 'assigned', 'qualified', 'unqualified'][i % 4],
      assigneeId: owner(i),
      convertedCustomerId: i < SCALE.convertedLeads ? 10000 + i : null,
      convertedOpportunityId: i < SCALE.convertedLeads ? 10000 + i : null,
      convertedAt: i < SCALE.convertedLeads ? day(-15) : null,
      createdBy: owner(i),
      createdAt: day(-i % 120),
    });
  for (let i = 0; i < SCALE.followups; i++) {
    const oi = i % SCALE.opportunities,
      u = owner(oi);
    add('followUp', {
      id: 10000 + i,
      targetType: 'opportunity',
      targetId: 10000 + oi,
      customerId: 10000 + oi,
      method: ['visit', 'phone', 'meeting', 'other'][i % 4],
      content: [
        '确认阀型、口径、材质及设备改造需求。',
        '完成技术澄清，确认客户图纸及交期。',
        '沟通报价版本、预算及竞争方案。',
        '核对合同付款、发运进度及后续安排。',
      ][i % 4],
      result: ['需求已记录', '待客户反馈', '报价待确认', '跟进中'][i % 4],
      nextAction: '确认下一步反馈并更新行动计划',
      nextFollowAt: day(1 + (i % 20)),
      createdBy: u,
      createdAt: day(-(i % 600)),
    });
  }
  for (let i = 0; i < SCALE.initialActions; i++)
    add('actionPlan', {
      id: 10000 + i,
      targetType: 'customer',
      targetId: 10000 + i,
      title: ['报价反馈', '图纸确认', '合同推进', '交付验收', '回款核对', '售后回访'][i % 6] + ' ' + customerName(i),
      content: '确认负责人、业务证据、计划时间与处理结果。',
      assigneeId: owner(i),
      dueDate: day(i % 5 === 3 ? -3 : (i % 30) - 7),
      priority: i % 5 === 0 ? 'high' : 'medium',
      status: ['pending', 'in_progress', 'completed', 'overdue', 'cancelled'][i % 5],
      source: 'manual',
      completedAt: i % 5 === 2 ? day(-1) : null,
      createdBy: owner(i),
    });
  for (const c of contracts) {
    const manager = dept(c.ownerId) === 20 ? 1011 : 1010;
    for (let v = 0; v < 3; v++) {
      const id = 10000 + c.i * 3 + v,
        status =
          v === 0
            ? 'rejected'
            : v === 1
              ? 'withdrawn'
              : c.status === 'pending_approval'
                ? 'pending'
                : c.status === 'draft'
                  ? 'withdrawn'
                  : c.status === 'rejected'
                    ? 'rejected'
                    : 'approved';
      const any = c.i === 13 && v === 2,
        approvers = any ? [manager, 1001] : [manager];
      const nodes = approvers.map((a) => ({
        name: any ? '管理层或签' : '供货合同审批',
        approverId: a,
        order: 1,
        mode: any ? 'any' : 'single',
      }));
      add('approval', {
        id,
        approvalNo: 'TY-SP-' + String(c.i * 3 + v + 1).padStart(6, '0'),
        bizType: 'contract',
        bizId: c.id,
        bizNo: 'TY-HT-' + String(c.i + 1).padStart(5, '0'),
        title: c.title + '合同审批 第' + (v + 1) + '版',
        applicantId: c.ownerId,
        status,
        currentNodeId: status === 'pending' ? 20000 + (c.i * 3 + v) * 2 : null,
        formData: {
          amount: money(c.amount),
          demo: 'TIANYU',
          flowSnapshot: { id: 1000, name: any ? '天雨合同或签' : '天雨供货合同审批', version: 1, fields: [], nodes },
        },
        startedAt: day(-20 - (c.i % 400) + v),
        completedAt: status === 'pending' ? null : day(-19 - (c.i % 400) + v),
        createdAt: day(-20 - (c.i % 400) + v),
      });
      for (const [n, a] of approvers.entries())
        add('approvalNode', {
          id: 20000 + (c.i * 3 + v) * 2 + n,
          approvalId: id,
          nodeOrder: 1,
          nodeName: any ? '管理层或签' : '供货合同审批',
          approverId: a,
          action:
            status === 'pending'
              ? 'pending'
              : status === 'approved'
                ? 'approved'
                : status === 'rejected'
                  ? 'rejected'
                  : 'skipped',
          comment: status === 'pending' ? null : status === 'withdrawn' ? '修订版本后重新提交' : '已核对本版供货条件',
          actedAt: ['approved', 'rejected'].includes(status) ? day(-19 - (c.i % 400) + v) : null,
        });
    }
    if (!c.signed) continue;
    const paidRatio = c.status === 'completed' ? 1 : c.i === 9 ? 0.4 : c.i === 11 ? 0.95 : [0, 0.3, 0.6, 0.8][c.i % 4];
    let remaining = Math.round(c.amount * paidRatio),
      received = remaining,
      invoiced = 0;
    const ratios = [0.3, 0.5, 0.15, 0.05];
    const invoiceStages = c.status === 'completed' ? 4 : 1 + (c.i % 3);
    for (let j = 0; j < 4; j++) {
      const pid = 10000 + c.i * 4 + j,
        amount = Math.round(c.amount * ratios[j]),
        paid = Math.min(remaining, amount);
      remaining -= paid;
      const due = day(c.i === 11 && j === 3 ? 300 : j * 60 - 120 + (c.i % 150));
      const inv = j < invoiceStages;
      if (inv) invoiced += amount;
      add('paymentPlan', {
        id: pid,
        contractId: c.id,
        planNo: 'TY-P-' + c.i + '-' + j,
        amount: money(amount),
        ratio: money(ratios[j] * 100),
        dueDate: due,
        triggerCondition: ['首付', '发货款', '验收款', '质保款'][j],
        status: paid === amount ? 'completed' : paid ? 'partial' : due < day(0) ? 'overdue' : 'pending',
        receivedAmount: money(paid),
        outstandingAmount: money(amount - paid),
        invoiceRequired: true,
        invoiceId: inv ? pid : null,
        remark: '阀门供货分期，公开虚构演示。',
      });
      if (inv)
        add('invoice', {
          id: pid,
          invoiceNo: 'TY-FP-' + c.i + '-' + j,
          contractId: c.id,
          customerId: c.customerId,
          amount: money(amount),
          ...tax(amount),
          taxRate: '13',
          invoiceTitle: customerName(c.i),
          content: '阀门供货',
          invoiceDate: day(-60 + (c.i % 50)),
          status: 'invoiced',
          createdBy: 1,
        });
      if (paid)
        add('receiptAllocation', {
          receiptId: c.id,
          paymentPlanId: pid,
          amount: money(paid),
          allocatedBy: 1400,
          allocatedAt: day(-10),
        });
    }
    if (received)
      add('receipt', {
        id: c.id,
        receiptNo: 'TY-SK-' + c.i,
        customerId: c.customerId,
        contractId: c.id,
        amount: money(received),
        allocatedAmount: money(received),
        unallocatedAmount: '0',
        ledgerManaged: true,
        referenceKey: fingerprint('TY-RECEIPT-' + c.i),
        receiptDate: day(-10 + (c.i % 10)),
        status: 'confirmed',
        createdBy: 1,
        confirmedBy: 1400,
        confirmedAt: day(-9),
        payerName: customerName(c.i),
        remark: '公开虚构演示到账记录',
      });
    Object.assign(
      groups.get('contract').find((r) => r.id === c.id),
      { totalReceived: money(received), totalInvoiced: money(invoiced), totalOutstanding: money(c.amount - received) },
    );
    add('order', {
      id: c.id,
      orderNo: 'TY-DD-' + String(c.i + 1).padStart(5, '0'),
      contractId: c.id,
      customerId: c.customerId,
      opportunityId: c.id,
      orderType: 'standard',
      status: c.status === 'completed' ? 'completed' : c.i % 2 ? 'confirmed' : 'delivered',
      totalAmount: tax(c.amount).amountExclTax,
      totalTax: tax(c.amount).taxAmount,
      totalAmountInclTax: money(c.amount),
      orderDate: day(-50 - (c.i % 150)),
      expectedDeliveryDate: day(30 + (c.i % 120)),
      actualDeliveryDate: c.status === 'completed' || c.i % 2 === 0 ? day(-5) : null,
      deliveryAddress: regions[c.i % 4] + '示例项目现场',
      ownerId: c.ownerId,
      yonyouSyncStatus: 'manual',
      remark: '阀门供货订单，交付及验收记录关联。',
      createdBy: c.ownerId,
    });
    const p = products[c.i % 3 === 2 ? 32 + (c.i % 16) : c.i % 32],
      quantity = c.i % 3 === 2 ? 20 : 100;
    add('orderItem', {
      orderId: c.id,
      itemName: p.name,
      itemType: 'hardware',
      productId: p.id,
      quantity,
      unit: '台',
      unitPrice: money(c.amount / quantity),
      amount: money(c.amount),
      taxRate: '13',
      taxAmount: tax(c.amount).taxAmount,
      deliveredQty: c.status === 'completed' || c.i % 2 === 0 ? quantity : 0,
    });
    if (c.status === 'completed' || c.i % 2 === 0)
      add('orderDelivery', {
        orderId: c.id,
        deliveryType: 'ship',
        deliveryDate: day(-5),
        trackingNo: 'TY-SHIP-' + c.i,
        carrier: '天雨示例物流',
        items: [{ itemName: p.name, quantity }],
        receiverConfirm: true,
        confirmedBy: '示例收货人',
        confirmedAt: day(-3),
        operatorId: 1200,
        remark: '模拟物流记录，无真实运输业务。',
      });
  }
  // Existing platform project/task/acceptance services supply the coordination story.
  const eligible = contracts.filter((c) => c.signed).slice(0, SCALE.projects);
  for (const [k, c] of eligible.entries()) {
    const completed = k % 8 === 7,
      hold = k % 8 === 6;
    add('project', {
      id: c.id,
      projectNo: 'TY-XM-' + String(k + 1).padStart(4, '0'),
      name: customerName(c.i) + '阀门技术与交付协同',
      contractId: c.id,
      customerId: c.customerId,
      opportunityId: c.id,
      projectType: 'other',
      stage: completed ? 'closed' : ['blueprint', 'development', 'testing', 'acceptance'][k % 4],
      status: completed ? 'completed' : hold ? 'on_hold' : 'active',
      pmId: 1200,
      salesOwnerId: c.ownerId,
      teamIds: [1201],
      plannedStartDate: day(-90),
      plannedEndDate: day(30 + (k % 120)),
      actualStartDate: day(-80),
      actualEndDate: completed ? day(-5) : null,
      progress: completed ? 100 : (k % 4) * 25,
      acceptanceState: completed ? 'accepted' : 'not_requested',
      budgetAmount: money(c.amount * 0.2),
      remark: '图纸确认、供货协调、资料准备和验收归档。',
      createdBy: 1200,
    });
    for (let j = 0; j < 4; j++) {
      const done = completed || j < k % 4,
        pid = 10000 + k * 4 + j;
      add('projectMilestone', {
        id: pid,
        projectId: c.id,
        name: ['需求与图纸确认', '供货方案确认', '检验资料准备', '现场交付验收'][j],
        stage: ['blueprint', 'development', 'testing', 'acceptance'][j],
        sortOrder: j,
        weight: 25,
        ownerId: 1200,
        plannedDate: day(-60 + j * 40),
        status: done ? 'completed' : 'pending',
        actualDate: done ? day(-30 + j * 5) : null,
        completedBy: done ? 1200 : null,
        completedAt: done ? day(-30 + j * 5) : null,
        deliverables: ['确认的规格及图纸', '供货范围和排期', '检验及交付资料', '签收及验收反馈'][j],
      });
      add('projectTask', {
        id: pid,
        projectId: c.id,
        milestoneId: pid,
        title: ['确认口径材质与图纸', '核对供货范围与交期', '整理检验和交付资料', '跟踪现场验收反馈'][j],
        description: '记录任务处理结果并上传业务证据。',
        assigneeId: 1201,
        status: done ? 'done' : j === k % 4 ? 'in_progress' : 'todo',
        priority: 'medium',
        plannedHours: '8',
        actualHours: done ? '8' : '0',
        dueDate: day(j * 7 - 7),
        completedAt: done ? day(-1) : null,
        createdBy: 1200,
      });
    }
    Object.assign(
      groups.get('contract').find((r) => r.id === c.id),
      { projectId: c.id },
    );
    Object.assign(
      groups.get('opportunity').find((r) => r.id === c.id),
      { projectId: c.id },
    );
    if (k < 30)
      add('serviceTicket', {
        id: c.id,
        projectId: c.id,
        customerId: c.customerId,
        title: ['执行器调试协助', '密封件检查', '交付资料补充'][k % 3] + ' ' + customerName(c.i),
        description: '客户反馈设备使用或交付资料问题，安排响应、处理和回访。',
        priority: k % 3 ? 'medium' : 'high',
        status: ['open', 'in_progress', 'resolved', 'closed'][k % 4],
        createdBy: c.ownerId,
        assigneeId: 1201,
        resolvedBy: k % 4 >= 2 ? 1201 : null,
        resolution: k % 4 >= 2 ? '已提供处理方案并完成回访' : null,
      });
  }
  add('receipt', {
    id: 50000,
    receiptNo: 'TY-YS-001',
    customerId: 10004,
    amount: '50000',
    allocatedAmount: '0',
    unallocatedAmount: '50000',
    ledgerManaged: true,
    referenceKey: fingerprint('TY-ADVANCE'),
    receiptDate: day(-1),
    status: 'confirmed',
    createdBy: 1,
    confirmedBy: 1400,
    confirmedAt: day(0),
    remark: '示例预收待核销',
  });
  add('receipt', {
    id: 50001,
    receiptNo: 'TY-SK-DRAFT',
    customerId: 10004,
    contractId: 10004,
    amount: '60000',
    allocatedAmount: '0',
    unallocatedAmount: '60000',
    ledgerManaged: true,
    referenceKey: fingerprint('TY-DRAFT'),
    receiptDate: day(0),
    status: 'draft',
    createdBy: 1,
    remark: '待复核收款登记',
  });
  for (const c of contracts) {
    const row = groups.get('customer')[c.i];
    row.contractCount = 1;
    row.contractAmount = c.signed ? money(c.amount) : '0';
    row.isTrading = c.signed;
    row.isProspect = !c.signed;
  }
  for (let i = 0; i < 42; i++)
    add('calendarEntry', {
      ownerId: accounts[i % accounts.length].id,
      title: ['报价反馈', '技术资料确认', '交付协调', '回款核对', '客户回访', '销售周计划'][i % 6],
      description: '天雨阀门本人业务推进安排。',
      location: '天雨示例业务安排',
      startsAt: new Date(Date.parse(day(1 + (i % 7))) + (i % 8) * 3600000 + 3600000).toISOString(),
      endsAt: new Date(Date.parse(day(1 + (i % 7))) + (i % 8) * 3600000 + 7200000).toISOString(),
      freeBusy: 'busy',
      status: 'scheduled',
    });
  return groups;
}
export function exportData(directory) {
  mkdirSync(directory, { recursive: true });
  const g = generate();
  const lines =
    [...g].flatMap(([model, rows]) => rows.map((data) => JSON.stringify({ model, data }))).join('\n') + '\n';
  const bytes = gzipSync(Buffer.from(lines), { mtime: 0 });
  writeFileSync(directory + '/data.jsonl.gz', bytes);
  const manifest = {
    version: VERSION,
    asOf: AS_OF,
    companyCode: 'TIANYU',
    companyName: '天雨阀门',
    fictional: true,
    counts: Object.fromEntries([...g].map(([m, r]) => [m, r.length])),
    accounts: accounts.map((a) => ({ ...a, password: DEMO_PASSWORD })),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  writeFileSync(directory + '/manifest.json', JSON.stringify(manifest, null, 2));
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(exportData(fileURLToPath(new URL('.', import.meta.url))).counts));
