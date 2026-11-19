/** Fixed synthetic installation operation. No SQL/tool endpoint, no production import, no deletion. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generate, exportData, VERSION, AS_OF, accounts, DEMO_PASSWORD, SCALE } from '../demo/tianyu/generate.mjs';
const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client'),
  bcrypt = require('bcrypt');
export async function installTianyu(db, env) {
  assert.equal(env.TENANT_CODE, 'TIANYU', 'Only the TIANYU company');
  assert.equal(env.ACCOUNT_PURPOSE, 'test', 'Only a disposable test account');
  assert.equal(env.TIANYU_ALLOW_SEED, 'true', 'Explicit seed authorization required');
  const url = new URL(env.DATABASE_URL);
  assert(['localhost', '127.0.0.1'].includes(url.hostname), 'Local installation only');
  assert(/^\/(tbcrm_c_[a-f0-9]{16}|tb_crm_test_tianyu_[a-z0-9_]+)$/.test(url.pathname), 'Unexpected database name');
  const tenant = await db.tenant.findUniqueOrThrow({ where: { code: 'TIANYU' } });
  assert.equal(await db.tenant.count(), 1);
  const config = tenant.config ?? {};
  if (config.tianyuDemoVersion) {
    assert.equal(config.tianyuDemoVersion, VERSION);
    return { reused: true, version: VERSION, asOf: AS_OF };
  }
  assert.equal(await db.customer.count(), 0, 'Requires an empty business dataset');
  assert.equal(await db.opportunity.count(), 0);
  assert.equal(await db.contract.count(), 0);
  assert.equal(await db.user.count(), 1, 'Requires only the initial admin');
  const data = generate(),
    passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const order = [
    'department',
    'user',
    'customer',
    'privateHolding',
    'contact',
    'product',
    'lead',
    'opportunity',
    'opportunityProduct',
    'opportunityQuote',
    'contract',
    'contractItem',
    'approval',
    'approvalNode',
    'paymentPlan',
    'invoice',
    'receipt',
    'receiptAllocation',
    'order',
    'orderItem',
    'orderDelivery',
    'project',
    'projectMilestone',
    'projectTask',
    'serviceTicket',
    'followUp',
    'actionPlan',
    'calendarEntry',
  ];
  const counts = Object.fromEntries([...data].map(([m, rows]) => [m, rows.length]));
  await db.$transaction(
    async (tx) => {
      // Recheck the initialization boundary inside the write transaction.
      const current = await tx.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
      assert(!current.config?.tianyuDemoVersion);
      assert.equal(await tx.customer.count(), 0);
      await tx.tenant.update({
        where: { id: tenant.id },
        data: { name: '天雨阀门', maxCustomers: 100000, maxUsers: 100 },
      });
      const roles = await tx.role.findMany({ where: { tenantId: tenant.id } });
      const roleIds = new Map(roles.map((r) => [r.code, r.id]));
      await tx.user.update({
        where: { id: accounts[0].id },
        data: { name: accounts[0].name, username: 'admin', employeeNo: accounts[0].employeeNo, passwordHash },
      });
      for (const model of order) {
        const rows = data.get(model) ?? [];
        for (let offset = 0; offset < rows.length; offset += 500) {
          const batch = rows.slice(offset, offset + 500).map((raw) => {
            const row = { tenantId: tenant.id, ...raw };
            if (model === 'user') {
              delete row.roleCode;
              row.passwordHash = passwordHash;
            }
            if (model === 'department') row.leaderId = null;
            if (model === 'opportunity') row.leadId = null;
            if (model === 'paymentPlan') row.invoiceId = null;
            return row;
          });
          if (batch.length) await tx[model].createMany({ data: batch });
        }
      }
      for (const a of accounts.slice(1))
        await tx.userRole.create({ data: { tenantId: tenant.id, userId: a.id, roleId: roleIds.get(a.roleCode) } });
      for (const d of data.get('department'))
        await tx.department.update({ where: { id: d.id }, data: { leaderId: d.leaderId } });
      // Optional links close only after both ends have been materialized.
      for (const c of data.get('paymentPlan').filter((p) => p.invoiceId))
        await tx.paymentPlan.update({ where: { id: c.id }, data: { invoiceId: c.invoiceId } });
      for (let i = 0; i < SCALE.convertedLeads; i++)
        await tx.opportunity.update({ where: { id: 10000 + i }, data: { leadId: 10000 + i } });
      for (const [id, name, bizType, approver] of [
        [1000, '天雨供货合同审批', 'contract', 1010],
        [1001, '天雨订单审批', 'order', 1010],
        [1002, '天雨项目立项审批', 'project_initiation', 1200],
      ]) {
        await tx.approvalFlow.create({
          data: {
            id,
            tenantId: tenant.id,
            name,
            bizType,
            isActive: true,
            priority: 10,
            version: 1,
            definition: { fields: [] },
            createdBy: 1,
          },
        });
        await tx.approvalFlowNode.create({
          data: {
            tenantId: tenant.id,
            flowId: id,
            nodeOrder: 1,
            nodeName: name,
            approverType: 'user',
            approverValue: String(approver),
          },
        });
      }
      await tx.poolConfig.updateMany({
        where: { tenantId: tenant.id },
        data: { maxClaimPerDay: 5, privateMax: 3000, protectDays: 30, autoRecycleDays: 180 },
      });
      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          userId: 1,
          action: 'demo.tianyu.install',
          objectType: 'tenant',
          objectId: tenant.id,
          afterData: { version: VERSION, asOf: AS_OF, synthetic: true, counts, externalWrites: 0 },
        },
      });
      await tx.tenant.update({
        where: { id: tenant.id },
        data: {
          config: {
            ...config,
            tianyuDemoVersion: VERSION,
            tianyuDemoAsOf: AS_OF,
            tianyuDemoCounts: counts,
            tianyuDemoCredentialRevision: 2,
          },
        },
      });
    },
    { isolationLevel: 'Serializable', timeout: 240000, maxWait: 10000 },
  );
  return { reused: false, version: VERSION, asOf: AS_OF, counts, users: accounts.length, externalWrites: 0 };
}
async function main() {
  if (process.argv.includes('--export')) {
    console.log(JSON.stringify(exportData(fileURLToPath(new URL('../demo/tianyu/', import.meta.url))).counts));
    return;
  }
  assert(process.argv.includes('--apply'), 'Use --export or --apply');
  const configIndex = process.argv.indexOf('--company-config');
  const env =
    configIndex < 0
      ? process.env
      : {
          ...JSON.parse(readFileSync(process.argv[configIndex + 1], 'utf8')),
          TIANYU_ALLOW_SEED: process.argv.includes('--confirm-fictional-tianyu') ? 'true' : 'false',
        };
  const db = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  try {
    console.log(JSON.stringify(await installTianyu(db, env)));
  } finally {
    await db.$disconnect();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
