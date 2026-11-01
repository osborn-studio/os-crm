/**
 * PartnerOS CRM 种子数据脚本
 * 执行：pnpm db:seed 或 npx tsx prisma/seed.ts
 * 幂等：使用 upsert，重复执行不报错不重复插入
 * 对应文档：docs/reference/qwen-design/12_工程规范/种子数据规格.md
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  if (process.env.DEMO_MODE !== 'true' || !/(demo|test)/.test(new URL(process.env.DATABASE_URL!).pathname))
    throw new Error('种子数据仅允许写入显式启用的demo/test数据库');
  console.log('🌱 开始灌入种子数据...');

  // 1. 租户
  const tenant = await prisma.tenant.upsert({
    where: { code: 'TINGMENG' },
    update: {},
    create: {
      name: '上海町萌网络科技有限公司',
      code: 'TINGMENG',
      plan: 'enterprise',
      maxUsers: 50,
      maxCustomers: 10000,
      status: 'active',
      config: { default_currency: 'CNY', default_tax_rate: 13, timezone: 'Asia/Shanghai' },
    },
  });
  const tid = tenant.id;
  console.log(`  ✅ 租户: ${tenant.name} (id=${tid})`);

  // 2. 部门
  const departments = [
    { name: '总经理办公室', code: 'GM', sortOrder: 1 },
    { name: '销售一部', code: 'SALES1', sortOrder: 2 },
    { name: '销售二部', code: 'SALES2', sortOrder: 3 },
    { name: '售前部', code: 'PRESALES', sortOrder: 4 },
    { name: '交付部', code: 'DELIVERY', sortOrder: 5 },
    { name: '财务部', code: 'FINANCE', sortOrder: 6 },
    { name: '渠道部', code: 'CHANNEL', sortOrder: 7 },
  ];
  for (const dept of departments) {
    await prisma.department.upsert({
      where: { id: dept.sortOrder }, // 用固定ID保证幂等
      update: { name: dept.name, code: dept.code },
      create: { id: dept.sortOrder, tenantId: tid, ...dept, parentId: null },
    });
  }
  console.log(`  ✅ 部门: ${departments.length}个`);

  // 3. 角色（12个预置）
  const roles = [
    { code: 'super_admin', name: '超级管理员', dataScope: 'all' as const, permissions: ['*'] },
    {
      code: 'gm',
      name: '总经理',
      dataScope: 'all' as const,
      permissions: [
        'approval:approve',
        'approval:reject',
        'approval:withdraw',
        'dashboard:*',
        'customer:read',
        'opportunity:read',
        'contract:read',
        'contract:approve',
        'order:read',
        'finance:read',
        'project:read',
        'report:*',
        'approval:*',
      ],
    },
    {
      code: 'sales_manager',
      name: '销售经理',
      dataScope: 'dept' as const,
      permissions: [
        'approval:approve',
        'approval:reject',
        'approval:withdraw',
        'customer:*',
        'lead:*',
        'pool:*',
        'opportunity:*',
        'contract:read',
        'contract:create',
        'contract:approve',
        'order:read',
        'finance:read',
        'project:read',
        'dashboard:team',
        'approval:create',
        'report:team',
      ],
    },
    {
      code: 'sales',
      name: '客户经理',
      dataScope: 'self' as const,
      permissions: [
        'approval:create',
        'approval:withdraw',
        'customer:read',
        'customer:create',
        'customer:update',
        'lead:*',
        'pool:claim',
        'pool:return',
        'opportunity:*',
        'contract:read',
        'contract:create',
        'contract:update',
        'order:read',
        'order:create',
        'finance:read',
        'project:read',
        'follow_up:*',
        'action:*',
        'ai:use',
      ],
    },
    {
      code: 'presales',
      name: '售前顾问',
      dataScope: 'custom' as const,
      permissions: [
        'customer:read',
        'opportunity:read',
        'opportunity:update',
        'contract:read',
        'follow_up:create',
        'action:*',
        'ai:use',
      ],
    },
    {
      code: 'pm',
      name: '交付PM',
      dataScope: 'custom' as const,
      permissions: [
        'customer:read',
        'contract:read',
        'order:read',
        'project:*',
        'timesheet:approve',
        'document:*',
        'follow_up:create',
        'action:*',
        'ai:use',
      ],
    },
    {
      code: 'consultant',
      name: '实施顾问',
      dataScope: 'self' as const,
      permissions: ['project:read', 'task:update', 'timesheet:create', 'document:create', 'follow_up:create'],
    },
    {
      code: 'finance',
      name: '财务',
      dataScope: 'all' as const,
      permissions: [
        'customer:read',
        'contract:read',
        'order:read',
        'invoice:*',
        'payment:*',
        'receipt:*',
        'aging:*',
        'collection:*',
        'finance:*',
        'report:finance',
      ],
    },
    {
      code: 'channel_manager',
      name: '渠道经理',
      dataScope: 'custom' as const,
      permissions: [
        'customer:read',
        'lead:*',
        'opportunity:*',
        'contract:read',
        'partner:*',
        'pool:assign',
        'dashboard:channel',
      ],
    },
    {
      code: 'partner',
      name: '伙伴用户',
      dataScope: 'self' as const,
      permissions: ['customer:read_own', 'opportunity:create_own', 'opportunity:read_own', 'lead:create'],
    },
    {
      code: 'bi_analyst',
      name: 'BI分析师',
      dataScope: 'all' as const,
      permissions: ['*:read', 'report:*', 'dashboard:*', 'export:*'],
    },
    {
      code: 'ai_copilot',
      name: 'AI副驾驶',
      dataScope: 'all' as const,
      permissions: [
        'customer:read',
        'customer:update_ai',
        'opportunity:read',
        'opportunity:update_ai',
        'finance:read',
        'project:read',
        'follow_up:read',
      ],
    },
  ];
  const demoPermissions: Record<string, string[]> = {
    gm: [
      'customer:read',
      'lead:read',
      'opportunity:read',
      'contract:read',
      'order:read',
      'project:read',
      'follow_up:read',
      'action:read',
      'product:read',
      'finance:read',
      'dashboard:*',
      'approval:*',
      'report:*',
    ],
    sales_manager: [
      'customer:*',
      'pool:*',
      'lead:*',
      'opportunity:*',
      'contract:*',
      'order:*',
      'project:*',
      'follow_up:*',
      'action:*',
      'product:read',
      'finance:read',
      'dashboard:team',
      'approval:create',
      'approval:withdraw',
      'approval:approve',
      'approval:reject',
      'report:team',
    ],
    sales: [
      'customer:read',
      'customer:create',
      'customer:update',
      'pool:claim',
      'pool:return',
      'lead:*',
      'opportunity:*',
      'contract:read',
      'contract:create',
      'contract:update',
      'order:*',
      'project:*',
      'follow_up:*',
      'action:*',
      'product:read',
      'finance:read',
      'approval:create',
      'approval:withdraw',
      'ai:use',
    ],
  };
  for (const role of roles) if (demoPermissions[role.code]) role.permissions = demoPermissions[role.code];
  const roleMap: Record<string, number> = {};
  for (let i = 0; i < roles.length; i++) {
    const r = roles[i];
    const role = await prisma.role.upsert({
      where: { id: i + 1 },
      update: { name: r.name, permissions: r.permissions as any, dataScope: r.dataScope },
      create: { id: i + 1, tenantId: tid, ...r, permissions: r.permissions as any, isSystem: true },
    });
    roleMap[r.code] = role.id;
  }
  console.log(`  ✅ 角色: ${roles.length}个`);

  // 4. 用户
  const seedPassword = process.env.SEED_ADMIN_PASSWORD;
  const minimumPasswordLength = process.env.DEMO_MODE === 'true' ? 5 : 12;
  if (!seedPassword || seedPassword.length < minimumPasswordLength) throw new Error(`SEED_ADMIN_PASSWORD必须至少${minimumPasswordLength}位`);
  const passwordHash = await bcrypt.hash(seedPassword, 12);
  const users = [
    { username: 'admin', name: '系统管理员', deptId: 1, position: '管理员', roleCodes: ['super_admin'] },
    {
      username: 'demo-owner',
      name: '演示负责人',
      deptId: 1,
      position: '总经理',
      phone: '13800000000',
      roleCodes: ['gm'],
    },
    { username: 'sales01', name: '演示销售一', deptId: 2, position: '客户经理', roleCodes: ['sales'] },
    { username: 'sales02', name: '演示销售二', deptId: 2, position: '客户经理', roleCodes: ['sales'] },
    { username: 'sales03', name: '演示销售三', deptId: 3, position: '客户经理', roleCodes: ['sales'] },
    { username: 'sales04', name: '演示销售四', deptId: 3, position: '客户经理', roleCodes: ['sales'] },
    { username: 'sales05', name: '演示销售五', deptId: 2, position: '客户经理', roleCodes: ['sales'] },
    { username: 'manager', name: '演示销售主管', deptId: 2, position: '销售主管', roleCodes: ['sales_manager'] },
    { username: 'boss', name: '演示老板', deptId: 1, position: '总经理', roleCodes: ['gm'] },
    { username: 'sales', name: '演示销售', deptId: 2, position: '客户经理', roleCodes: ['sales'] },
    { username: 'finance01', name: '财务专员', deptId: 6, position: '财务', roleCodes: ['finance'] },
  ];
  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    const user = await prisma.user.upsert({
      where: { id: i + 1 },
      update: { name: u.name, deptId: u.deptId, position: u.position },
      create: {
        id: i + 1,
        tenantId: tid,
        username: u.username,
        name: u.name,
        passwordHash,
        deptId: u.deptId,
        position: u.position,
        phone: u.phone || null,
        status: 'active',
      },
    });
    // 分配角色
    for (const rc of u.roleCodes) {
      await prisma.userRole.upsert({
        where: { tenantId_userId_roleId: { tenantId: tid, userId: user.id, roleId: roleMap[rc] } },
        update: {},
        create: { tenantId: tid, userId: user.id, roleId: roleMap[rc] },
      });
    }
  }
  const manager = await prisma.user.findFirst({ where: { tenantId: tid, username: 'manager' } });
  await prisma.department.update({ where: { id: 2 }, data: { leaderId: manager!.id } });
  console.log(`  ✅ 用户: ${users.length}个（密码从本地环境读取）`);

  // 5. 商机阶段（9级）
  const stages = [
    { code: 'intention', name: '意向', sortOrder: 1, probability: 5, stallThresholdDays: 45, color: '#94a3b8' },
    { code: 'contact', name: '初步接触', sortOrder: 2, probability: 10, stallThresholdDays: 30, color: '#64748b' },
    {
      code: 'requirement',
      name: '需求确认',
      sortOrder: 3,
      probability: 20,
      stallThresholdDays: 30,
      color: '#3b82f6',
      requiredFields: ['demand_summary', 'amount'],
    },
    {
      code: 'proposal',
      name: '方案报价',
      sortOrder: 4,
      probability: 40,
      stallThresholdDays: 45,
      color: '#2563eb',
      requiredFields: ['demand_summary', 'amount', 'expected_close_date'],
    },
    { code: 'negotiation', name: '商务谈判', sortOrder: 5, probability: 60, stallThresholdDays: 30, color: '#d97706' },
    { code: 'signing', name: '签约', sortOrder: 6, probability: 80, stallThresholdDays: 21, color: '#16a34a' },
    { code: 'delivery', name: '交付', sortOrder: 7, probability: 90, stallThresholdDays: 180, color: '#0d9488' },
    { code: 'acceptance', name: '验收', sortOrder: 8, probability: 95, stallThresholdDays: 60, color: '#059669' },
    {
      code: 'closed',
      name: '结项',
      sortOrder: 9,
      probability: 100,
      stallThresholdDays: 0,
      color: '#334155',
      isWon: true,
    },
  ];
  for (const s of stages) {
    await prisma.opportunityStage.upsert({
      where: { tenantId_code: { tenantId: tid, code: s.code } },
      update: { name: s.name, probability: s.probability, stallThresholdDays: s.stallThresholdDays },
      create: {
        tenantId: tid,
        ...s,
        requiredFields: (s as any).requiredFields || null,
        isWon: (s as any).isWon || false,
        isLost: false,
      },
    });
  }
  console.log(`  ✅ 商机阶段: ${stages.length}个`);

  // 6. 公私海配置
  await prisma.poolConfig.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      tenantId: tid,
      poolType: 'public',
      deptId: null,
      name: '公司公海',
      maxClaimPerDay: 3,
      protectDays: 30,
      followRequiredDays: 15,
      autoRecycleDays: 60,
      recycleTo: 'public',
      privateMax: 50,
      claimNeedApproval: false,
      assignStrategy: 'manual',
      isActive: true,
    },
  });
  console.log(`  ✅ 公私海配置: 1条`);

  // 7. 系统设置
  const settings = [
    { key: 'pool_protect_days', value: '30', group: 'pool', type: 'number' as const, desc: '保护期天数' },
    { key: 'pool_follow_required_days', value: '15', group: 'pool', type: 'number' as const, desc: '跟进要求天数' },
    { key: 'pool_auto_recycle_days', value: '60', group: 'pool', type: 'number' as const, desc: '自动回收天数' },
    { key: 'pool_private_max_sales', value: '50', group: 'pool', type: 'number' as const, desc: '销售私海上限' },
    { key: 'pool_max_claim_per_day', value: '3', group: 'pool', type: 'number' as const, desc: '每日领取上限' },
    { key: 'pool_cooldown_days', value: '7', group: 'pool', type: 'number' as const, desc: '冷却期天数' },
    { key: 'lead_qualified_score', value: '60', group: 'lead', type: 'number' as const, desc: '线索合格评分阈值' },
    { key: 'lead_expire_days', value: '30', group: 'lead', type: 'number' as const, desc: '线索过期天数' },
    {
      key: 'contract_approval_vp_threshold',
      value: '200000',
      group: 'contract',
      type: 'number' as const,
      desc: 'VP审批金额阈值',
    },
    {
      key: 'contract_approval_gm_threshold',
      value: '500000',
      group: 'contract',
      type: 'number' as const,
      desc: '总经理审批金额阈值',
    },
    {
      key: 'order_discount_sales_limit',
      value: '10',
      group: 'order',
      type: 'number' as const,
      desc: '销售折扣权限(%)',
    },
    { key: 'order_credit_multiplier', value: '1.2', group: 'order', type: 'number' as const, desc: '信用额度倍率' },
    {
      key: 'finance_remind_before_days',
      value: '7',
      group: 'finance',
      type: 'number' as const,
      desc: '回款提醒提前天数',
    },
    { key: 'project_man_day_cost', value: '1500', group: 'project', type: 'number' as const, desc: '默认人天成本(元)' },
    { key: 'ai_default_model', value: 'qwen-max', group: 'ai', type: 'string' as const, desc: 'AI默认模型' },
    { key: 'ai_token_monthly_quota', value: '5000', group: 'ai', type: 'number' as const, desc: 'AI月配额(次)' },
  ];
  for (const s of settings) {
    await prisma.systemSetting.upsert({
      where: { tenantId_settingKey: { tenantId: tid, settingKey: s.key } },
      update: { settingValue: s.value },
      create: {
        tenantId: tid,
        settingKey: s.key,
        settingValue: s.value,
        valueType: s.type,
        settingGroup: s.group,
        description: s.desc,
        defaultValue: s.value,
        isSystem: true,
      },
    });
  }
  console.log(`  ✅ 系统设置: ${settings.length}条`);

  // 8. 产品目录
  const products = [
    { name: 'YonSuite-财务模块', code: 'YS-FIN', category: 'software', unit: '套', listPrice: 0, taxRate: 13 },
    { name: 'YonSuite-供应链模块', code: 'YS-SCM', category: 'software', unit: '套', listPrice: 0, taxRate: 13 },
    { name: 'YonSuite-用户许可', code: 'YS-USER', category: 'software', unit: '用户', listPrice: 0, taxRate: 13 },
    { name: 'BIP高级版-模块', code: 'BIP-ADV', category: 'software', unit: '套', listPrice: 0, taxRate: 13 },
    { name: '实施服务-人天', code: 'SVC-MANDAY', category: 'service', unit: '人天', listPrice: 1500, taxRate: 6 },
    { name: '运维服务-年费', code: 'SVC-MAINT', category: 'service', unit: '年', listPrice: 0, taxRate: 6 },
    { name: 'AI FDE-场景交付', code: 'AI-FDE', category: 'ai_fde', unit: '场景', listPrice: 0, taxRate: 6 },
    { name: 'PartnerOS CRM-订阅', code: 'CRM-SUB', category: 'subscription', unit: '年', listPrice: 0, taxRate: 6 },
  ];
  for (const p of products) {
    await prisma.product.upsert({
      where: { id: products.indexOf(p) + 1 },
      update: { name: p.name, listPrice: p.listPrice },
      create: {
        id: products.indexOf(p) + 1,
        tenantId: tid,
        ...p,
        listPrice: p.listPrice,
        isActive: true,
        sortOrder: products.indexOf(p),
      },
    });
  }
  console.log(`  ✅ 产品目录: ${products.length}个`);

  console.log('\n🎉 种子数据灌入完成！');
  console.log('   登录账号: admin（使用SEED_ADMIN_PASSWORD）');
  console.log('   演示负责人账号: demo-owner');
}

main()
  .catch((e) => {
    console.error('❌ 种子数据失败:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
