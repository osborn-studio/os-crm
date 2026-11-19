/** Independently invented valve-industry stories. Never reads another company or local work files. */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generate, accounts, VERSION as BASE_VERSION } from '../generate.mjs';
export const VERSION = '2.0-ai-20261116';
export const AS_OF = '2026-11-16';
const stamp = (d) => new Date(Date.parse(AS_OF + 'T02:00:00Z') + d * 86400000).toISOString();
const money = (n) => Number(n).toFixed(2);
const recipes = [
  [
    '泵站扩建初步选型',
    'lead',
    null,
    '客户提供介质和空间照片，初步确认DN150与DN200两种口径；尚未确定设计压力、预算和采购主体。',
    ['收齐工况参数和设备位照片', '确认设计院与采购决策人', '形成选型建议后再评估报价'],
  ],
  [
    '耐腐蚀调节阀三轮报价',
    'quote',
    152600,
    '首轮144000元，加入定位器后156800元，调整分批供货最终152600元；图纸仍需客户书面确认。',
    ['确认最终配置清单与图纸C版', '核对152600元报价反馈及付款条件', '技术确认后准备供货合同草稿'],
  ],
  [
    '高温阀组紧急改造资源掉单',
    'lost',
    258600,
    '客户要求四周内完成改造，高温密封验证与控制联调人员同期已满；我方在商务阶段确认无法承接并主动放弃。',
    ['归档报价与客户要求的交付窗口', '补齐高温密封试验和控制联调资源', '有新窗口后先做产能评审再决定重启'],
  ],
  [
    '非标阀组试制服务合同草稿',
    'draft',
    17400,
    '12人天试制与测试服务，单价1450元；双方方案范围基本对齐，合同尚未签章，不能建立正式应收。',
    ['核对试制样件、测试标准及12人天范围', '确认含税金额与两期付款约定', '签章完成后另走正式签约与收款计划'],
  ],
  [
    '水务阀组分期交付回款',
    'reference',
    null,
    '基于演示帐套已有签约合同，分别核对预付款、供货款、验收款和质保款；已有实际单据优先。',
    ['核对供货批次签收与付款触发条件', '跟进已开票部分的付款审批', '取得到账凭据后由另一管理员复核核销'],
  ],
  [
    '长周期装置项目技术变更',
    'reference',
    null,
    '18个月供货周期，客户提出法兰接口与驱动方案调整；先评审变更影响，保留原已签金额和原始图纸版本。',
    ['评审图纸D版对材料和交期的影响', '形成变更前后范围及费用对照', '按现有审批流程确认后再修改正式单据'],
  ],
  [
    '经销渠道甲方与终端项目',
    'reference',
    null,
    '渠道公司作为合同付款方，终端项目总盘子680万元只是业务背景；本公司业绩以已有合同和实际回款为依据，不把终端总额全算进来。',
    ['核对渠道甲方、终端业主与付款主体', '按本公司合同核对开票和未收余额', '产品奖励与服务供货收入分别记录'],
  ],
  [
    '维保续费价格冲突核对',
    'quote',
    null,
    '两份材料分别提及每季8700元和9600元，服务期间、备件包及最终价未核；金额保持未知，不年化并入销售预测。',
    ['与采购确认两份版本的先后和适用范围', '明确维保期间、备件及响应约定', '确认最终金额后形成新版报价'],
  ],
  [
    '历史开票资料缺合同',
    'lead',
    null,
    '模拟历史开票资料载明32450元，但未取得有效合同对应关系；只形成待核资料与补单行动，不凭开票材料伪造合同签署。',
    ['核对开票抬头与签约及付款主体', '寻找订单、验收或历史协议依据', '证据齐备后补合同草稿并按正常审批处理'],
  ],
  [
    '成套阀门商务评估掉单',
    'lost',
    316800,
    '客户要求耐低温测试与同时驻场调试，既有交付团队无法覆盖同期开工；商务沟通后主动放弃，保留报价轮次与资源原因。',
    ['整理低温测试与现场调试技能要求', '复盘缺少的合格人员和排期窗口', '建立合作资源清单，后续重新评审'],
  ],
  [
    '验收尾款与质保收尾',
    'reference',
    null,
    '已有演示供货合同进入收尾核对，验收、开票、到账是不同事实；不把计划日期当作已经收款。',
    ['核对验收报告和遗留问题清单', '逐笔核对开票、已收与合同未收金额', '与客户确认尾款及质保释放条件'],
  ],
  [
    '渠道复购与现场服务报价',
    'quote',
    44800,
    '渠道提出增加现场定位与检修服务，报价44800元；服务订单与原供货合同分开，采购反馈尚未确认。',
    ['核对现场服务地点和停机窗口', '确认44800元报价、人员及差旅范围', '客户接受后准备独立服务订单'],
  ],
];
export function buildWorkflow() {
  const base = generate(),
    customers = new Map(base.get('customer').map((r) => [r.id, r])),
    contracts = new Map(base.get('contract').map((r) => [r.id, r]));
  const cases = [],
    sources = [],
    knowledge = [];
  for (const [i, [name, kind, amount, issue, steps]] of recipes.entries()) {
    const customer = customers.get(10000 + i),
      contract = contracts.get(10000 + i),
      key = 'TYAI-' + String(i + 1).padStart(2, '0');
    const versions =
      i === 1
        ? [144000, 156800, 152600]
        : i === 2
          ? [231400, 258600]
          : i === 9
            ? [299400, 316800]
            : i === 11
              ? [42600, 44800]
              : i === 3
                ? [17400]
                : [];
    const events = [
      {
        type: 'presentation',
        internal: true,
        offset: -66 - i,
        title: '选型与业务场景方案',
        text: name + '；资料为阀门应用场景与初步方案，形成线索，不代表客户接受报价。',
      },
      {
        type: 'authorized_chat',
        internal: false,
        offset: -49 - i,
        title: '获授权的客户沟通片段',
        text: '客户围绕' + name + '沟通：' + issue + ' 下一步需核对：' + steps[0] + '。',
      },
      {
        type: 'meeting_summary',
        internal: false,
        offset: -43 - i,
        title: '需求澄清会议纪要',
        text:
          '讨论主题：' +
          name +
          '。当前问题：' +
          issue +
          ' 会议待办：' +
          steps.join('；') +
          '。未确认的签约、验收与到账不能当作已完成。',
      },
      ...versions.map((v, j) => ({
        type: j ? 'quotation_revision' : 'quotation',
        internal: true,
        offset: -36 - i + j * 4,
        title: '报价V' + (j + 1),
        text:
          '虚构报价V' +
          (j + 1) +
          '，金额' +
          money(v) +
          ' CNY；本次调整对应产品配置、供货或服务范围；报价文件制作不等于实际客户拜访。',
        amount: money(v),
      })),
      {
        type: kind === 'reference' ? 'contract_review' : kind === 'draft' ? 'contract_draft' : 'work_review',
        internal: true,
        offset: -2 - i,
        title: '证据整理与下一步判断',
        text: issue + ' AI整理结论：' + steps.join('；') + '。这是一条工作资料整理记录，后续实际处理状态另行确认。',
      },
    ].map((e, j) => ({
      id: key + '-SRC-' + String(j + 1).padStart(2, '0'),
      caseKey: key,
      customerKey: customer.code,
      fictional: true,
      sourceType: e.type,
      internalWork: e.internal,
      title: e.title,
      occurredAt: stamp(e.offset),
      authorizedBy: customer.ownerId,
      authorization: '仅本公开演示资料；不代表授权读取真实企业、员工或个人账号',
      text: e.text,
      ...(e.amount ? { amount: e.amount, currency: 'CNY' } : {}),
    }));
    sources.push(...events);
    const r = {
      key,
      name,
      customerKey: customer.code,
      customerId: customer.id,
      customerName: customer.name,
      ownerId: customer.ownerId,
      ownerName: accounts.find((a) => a.id === customer.ownerId).name,
      kind,
      amount: amount === null ? null : money(amount),
      amountBasis:
        kind === 'reference'
          ? '沿用既有演示合同；核对当前单据，不重复新增成交'
          : amount === null
            ? '金额待核，不填0，不年化'
            : '本次独立事项的虚构报价总额；不是已确认应收',
      forecastEligible: amount !== null && kind !== 'reference',
      issue,
      steps,
      versions: events
        .filter((e) => e.amount)
        .map((e) => ({ amount: e.amount, sourceId: e.id, sourceDate: e.occurredAt.slice(0, 10), basis: e.text })),
      sourceIds: events.map((e) => e.id),
      events,
      existingContractId: kind === 'reference' ? contract.id : null,
      existingOpportunityId: kind === 'reference' ? 10000 + i : null,
      sourceContractStatus: kind === 'reference' ? contract.status : null,
    };
    cases.push(r);
    const projectContent = {
      fictional: true,
      customerKey: r.customerKey,
      caseKey: key,
      事项: name,
      当前问题: issue,
      阶段:
        kind === 'lead'
          ? '潜在线索/需求确认'
          : kind === 'lost'
            ? '商务阶段掉单'
            : kind === 'draft'
              ? '方案确认，合同未签'
              : kind === 'reference'
                ? '沿用签约合同履约'
                : '已报价或待核报价',
      可能商机金额: r.amount,
      金额口径: r.amountBasis,
      历史资料: events.map((e) => ({ sourceId: e.id, type: e.sourceType, date: e.occurredAt, summary: e.text })),
      未来行动: steps,
      原合同引用: r.existingContractId,
      AI判断依据: '方案形成线索；报价形成商机；修订保留历史；合同草稿不当签约；实际收款沿用单据。',
      授权边界: '仅天雨合成资料，当前角色与客户数据范围；不读取或复制其他公司。',
    };
    const entry = {
      key: 'tianyu:ai:project:' + key,
      kind: 'project',
      title: '【演示数据】' + r.customerName + '｜' + name,
      customerId: r.customerId,
      summary: issue + ' 下一步：' + steps.join('；'),
      evidenceStatus: amount === null && kind !== 'reference' ? 'pending' : 'historical',
      sources: events.map((e) => ({ id: e.id, label: e.title, location: 'demo://TIANYU/' + e.id })),
      content: projectContent,
      expectedVersion: 0,
    };
    knowledge.push(entry);
    for (const e of events.filter((e) => e.sourceType === 'meeting_summary' || e.sourceType === 'authorized_chat'))
      knowledge.push({
        key: 'tianyu:ai:source:' + e.id,
        kind: 'meeting',
        title: '【演示数据】' + r.customerName + '｜' + e.title,
        customerId: r.customerId,
        summary: e.text,
        evidenceStatus: 'historical',
        sources: [{ id: e.id, label: e.title, location: 'demo://TIANYU/' + e.id }],
        content: {
          fictional: true,
          associationStatus: 'linked',
          customerKey: r.customerKey,
          caseKey: key,
          occurredAt: e.occurredAt,
          资料类型: e.sourceType,
          正文: e.text,
          授权: e.authorization,
        },
        expectedVersion: 0,
      });
    if (kind === 'lost')
      knowledge.push({
        key: 'tianyu:ai:capacity:' + key,
        kind: 'outsourcing',
        title: '【演示数据】' + r.customerName + '｜资源与掉单复盘',
        customerId: r.customerId,
        summary: issue,
        evidenceStatus: 'historical',
        sources: entry.sources,
        content: {
          fictional: true,
          customerKey: r.customerKey,
          caseKey: key,
          最后到达阶段: '商务',
          报价总额: r.amount,
          掉单原因: '项目窗口内人员和技能资源不足，主动放弃',
          模块技能: i === 2 ? ['高温密封验证', '控制联调', '现场实施'] : ['耐低温测试', '多现场调试', '质量认证'],
          永久能力不具备: null,
          重新承接条件: steps,
          说明: '这是虚构容量评估，不将人手不足自动写成永久不支持该功能。',
        },
        expectedVersion: 0,
      });
  }
  const products = base
    .get('product')
    .slice(0, 4)
    .map((p) => ({
      key: 'tianyu:ai:product:' + p.code,
      kind: 'product',
      title: '【演示数据】' + p.name,
      customerId: null,
      summary: p.description,
      content: {
        fictional: true,
        产品编码: p.code,
        产品: p.name,
        规格: p.specification,
        目录单价: p.listPrice,
        币种: 'CNY',
        单位: p.unit,
        说明: '虚构阀门产品价表，不是任何实际厂商报价。',
      },
      evidenceStatus: 'verified_source',
      sources: [
        { id: 'TY-CATALOGUE-' + p.code, label: '天雨虚构产品目录', location: 'demo://TIANYU/catalogue/' + p.code },
      ],
      expectedVersion: 0,
    }));
  knowledge.push(
    ...products,
    ...products.map((p) => ({
      ...p,
      key: p.key.replace(':product:', ':price:'),
      kind: 'price',
      title: p.title + '｜版本价格',
      summary: '虚构目录单价 ' + p.content.目录单价 + ' CNY/' + p.content.单位,
      content: { ...p.content, 价格版本: AS_OF, 报价层: '虚构产品目录价', 销售折扣: '按演示报价版本另核' },
    })),
  );
  for (const c of cases)
    for (const [i, step] of c.steps.entries())
      knowledge.push({
        key: 'tianyu:ai:plan:' + c.key + '-' + (i + 1),
        kind: 'project',
        title: '【演示数据】AI行动｜' + c.customerName + '｜' + step,
        customerId: c.customerId,
        summary: step + '；来源：' + c.issue,
        evidenceStatus: 'proposed',
        sources: c.sourceIds.map((id) => ({ id, label: '天雨虚构业务资料', location: 'demo://TIANYU/' + id })),
        content: {
          fictional: true,
          entryType: 'action_plan',
          caseKey: c.key,
          customerKey: c.customerKey,
          行动: step,
          日期性质: '拟定内部处理日期，非客户承诺或已完成事实',
          计划优先级: c.kind === 'lost' ? 'medium' : 'high',
        },
        expectedVersion: 0,
      });
  const data = {
    format: 'tianyu.ai-workflow@2.0',
    version: VERSION,
    baseVersion: BASE_VERSION,
    asOf: AS_OF,
    companyCode: 'TIANYU',
    companyName: '天雨阀门',
    fictional: true,
    containsRealCompanyData: false,
    description: 'AI基于授权资料整理客户历史并拟定未来计划的合成业务样例；所有输入及数据独立虚构，未读取真实客户资料。',
    cases,
    sources,
    knowledge,
    counts: {
      cases: cases.length,
      sources: sources.length,
      knowledge: knowledge.length,
      newCases: cases.filter((c) => c.kind !== 'reference').length,
      referenceCases: cases.filter((c) => c.kind === 'reference').length,
    },
    externalEffects: 0,
  };
  data.sha256 = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  return data;
}
export function exportWorkflow(dir = fileURLToPath(new URL('./', import.meta.url))) {
  mkdirSync(dir, { recursive: true });
  const d = buildWorkflow();
  writeFileSync(
    new URL('workflow.json', pathToFileURL(dir.endsWith('/') ? dir : dir + '/')),
    JSON.stringify(d, null, 2) + '\n',
  );
  return d.counts;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(exportWorkflow()));
