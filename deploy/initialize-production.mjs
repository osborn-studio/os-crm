import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { validateProduction } from './policy.mjs';
const require = createRequire(new URL('../packages/database/package.json', import.meta.url));

// An explicit installation operation, never an HTTP or agent capability.
// One transaction: all installation records exist, or none do. No demo seed is called.
export async function initializeProduction(db, env) {
  validateProduction(env);
  const existing = await db.tenant.findUnique({ where: { code: env.TENANT_CODE } });
  if (existing) {
    if (existing.config?.installationMode !== 'production' || existing.config?.installationVersion !== 1) throw new Error('Existing tenant is not a completed production installation; no changes made');
    return { initialized: false, tenantId: existing.id };
  }
  const bcrypt = require('bcrypt');
  const passwordHash = await bcrypt.hash(env.SEED_ADMIN_PASSWORD, 12);
  return db.$transaction(async (tx) => {
    if (await tx.tenant.count() || await tx.user.count() || await tx.customer.count()) throw new Error('First installation requires an empty database; use migration/restore for existing data');
    const tenant = await tx.tenant.create({ data: {
      code: env.TENANT_CODE, name: env.TENANT_NAME, status: 'active', plan: 'enterprise', maxUsers: 100,
      config: { installationMode: 'production', installationVersion: 1, timezone: 'Asia/Shanghai', default_currency: 'CNY' },
    } });
    const tenantId = tenant.id;
    const department = await tx.department.create({ data: { tenantId, name: '管理部', code: 'ADMIN' } });
    const definitions = [
      { code: 'super_admin', name: '管理员', dataScope: 'all', permissions: ['*'] },
      { code: 'sales_manager', name: '销售主管', dataScope: 'dept', permissions: ['customer:*', 'lead:*', 'pool:*', 'opportunity:*', 'contract:*', 'order:*', 'project:*', 'follow_up:*', 'action:*', 'product:read', 'finance:read', 'approval:*', 'dashboard:team', 'ai:use'] },
      { code: 'sales', name: '销售', dataScope: 'self', permissions: ['customer:read', 'customer:create', 'customer:update', 'lead:*', 'pool:claim', 'pool:return', 'opportunity:*', 'contract:read', 'contract:create', 'contract:update', 'order:read', 'order:create', 'order:update', 'project:read', 'project:create', 'project:update', 'follow_up:*', 'action:*', 'product:read', 'finance:read', 'approval:create', 'approval:withdraw', 'ai:use'] },
      { code: 'gm', name: '老板', dataScope: 'all', permissions: ['customer:read', 'lead:read', 'opportunity:read', 'contract:read', 'order:read', 'project:read', 'product:read', 'finance:read', 'follow_up:read', 'action:read', 'approval:approve', 'approval:reject', 'dashboard:*'] },
    ];
    const roles = [];
    for (const definition of definitions) roles.push(await tx.role.create({ data: { tenantId, isSystem: true, ...definition } }));
    const user = await tx.user.create({ data: { tenantId, username: env.ADMIN_USERNAME || 'admin', name: '企业管理员', deptId: department.id, passwordHash } });
    await tx.userRole.create({ data: { tenantId, userId: user.id, roleId: roles[0].id } });
    await tx.department.update({ where: { id: department.id }, data: { leaderId: user.id } });
    const stages = [['new', '初步接洽', 10], ['qualified', '需求确认', 20], ['proposal', '方案报价', 40], ['negotiation', '商务谈判', 60], ['signing', '签约', 80], ['delivery', '交付', 90], ['acceptance', '验收', 95], ['closed', '结项', 100]];
    for (const [index, [code, name, probability]] of stages.entries()) await tx.opportunityStage.create({ data: { tenantId, code, name, probability, sortOrder: index + 1, isWon: code === 'closed' } });
    await tx.poolConfig.create({ data: { tenantId, poolType: 'public', name: '公司公海' } });
    await tx.auditLog.create({ data: { tenantId, userId: user.id, action: 'installation.initialize', objectType: 'tenant', objectId: tenantId, afterData: { installationVersion: 1, mode: 'production' } } });
    return { initialized: true, tenantId };
  }, { isolationLevel: 'Serializable', timeout: 30000 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  try { console.log(JSON.stringify(await initializeProduction(db, process.env))); }
  finally { await db.$disconnect(); }
}
