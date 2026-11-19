/** Complete synthetic TIANYU v2 + evidence + approval regression. Never a business database. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import { initializeProduction } from '../deploy/initialize-production.mjs';
import { installTianyu } from './tianyu-demo.mjs';
import { installOpportunityActions } from './tianyu-opportunity-actions.mjs';
import { applyWorkflow } from './tianyu-ai-workflow.mjs';
import { installApprovalScenarios } from './tianyu-approval-scenarios.mjs';
import { accounts, DEMO_PASSWORD } from '../demo/tianyu/generate.mjs';
assert.equal(process.env.SMOKE_ALLOW_WRITES, 'true');
assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/tb_crm_test_tianyu_[a-z0-9_]+$/);
const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const env = {
  ...process.env,
  TENANT_CODE: 'TIANYU',
  TENANT_NAME: '天雨阀门',
  ACCOUNT_PURPOSE: 'test',
  DEMO_MODE: 'false',
  TIANYU_ALLOW_SEED: 'true',
  ADMIN_USERNAME: 'admin',
  SEED_ADMIN_PASSWORD: 'Synthetic-' + randomBytes(15).toString('hex'),
  JWT_SECRET: randomBytes(32).toString('hex'),
  ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  BACKUP_KEY: randomBytes(32).toString('hex'),
  APP_URL: 'http://localhost:3000',
  CRM_BUSINESS_RULES_ENABLED: 'false',
  ENABLE_LEGACY_CRON: 'false',
};
let api,
  log = '',
  checks = 0;
const eq = (a, b, msg) => {
  assert.deepEqual(a, b, msg);
  checks++;
};
try {
  eq(await db.tenant.count(), 0, 'Fresh synthetic database');
  await initializeProduction(db, env);
  const base = await installTianyu(db, env);
  eq(base.counts.customer, 15000, '75% fewer customers');
  const before = Object.fromEntries(
    await Promise.all(
      ['contract', 'invoice', 'receipt', 'paymentPlan'].map(async (k) => [
        k,
        await db[k].findMany({ orderBy: { id: 'asc' } }),
      ]),
    ),
  );
  api = spawn(process.execPath, ['apps/api/dist/main.js'], {
    env: { ...env, HOST: '127.0.0.1', PORT: '4154' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const s of [api.stdout, api.stderr]) s.on('data', (x) => (log = (log + x).slice(-18000)));
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try {
      ready = (await fetch('http://127.0.0.1:4154/api/v1/health/ready')).ok;
    } catch {}
    if (ready) break;
    if (api.exitCode !== null) throw Error(log);
    await delay(100);
  }
  eq(ready, true, 'API ready');
  const tokens = {};
  async function call(path, id, body) {
    const r = await fetch('http://127.0.0.1:4154/api/v1/' + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(tokens[id] ? { Authorization: 'Bearer ' + tokens[id] } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60000),
    });
    const j = await r.json();
    assert(r.ok, path + ' HTTP ' + r.status + ' ' + JSON.stringify(j));
    checks++;
    return j.data;
  }
  for (const a of accounts)
    tokens[a.id] = (
      await call('auth/login', a.id, { tenantCode: 'TIANYU', username: a.username, password: DEMO_PASSWORD })
    ).accessToken;
  const state = {},
    workflow = await applyWorkflow({ call: (p, b) => call(p, 1, b), state });
  eq(workflow.stories, 12, 'Twelve complex stories');
  eq(workflow.sourceMaterials, 58, 'Original fictional materials');
  eq(workflow.newCases, 8, 'Eight new cases; signed references not duplicated');
  eq(workflow.newOpportunities, 6, 'Unknown and quote rules');
  eq(workflow.aiActions, 36, 'AI-recommended plans');
  eq(workflow.localCalendarEntries, 36, 'Action calendar links');
  eq(await db.actionPlan.count({ where: { source: 'ai_recommend' } }), 36, 'Persisted AI provenance');
  eq(await db.opportunity.count({ where: { status: 'won' } }), 240, 'No duplicate won revenue');
  for (const [label, v] of Object.entries(state))
    if (v?.body && v?.receipt && (label === 'commit' || label.startsWith('activities-'))) {
      const replay = await call(
        label === 'commit' ? 'sales-intake/commit' : 'business-knowledge/activities',
        1,
        v.body,
      );
      eq(replay, v.receipt, 'Idempotent source batch ' + label);
    }
  const counts = async () =>
      Promise.all(
        ['lead', 'opportunity', 'followUp', 'actionPlan', 'calendarEntry', 'knowledgeEntry'].map((k) => db[k].count()),
      ),
    saved = await counts();
  await applyWorkflow({ call: (p, b) => call(p, 1, b), state });
  eq(await counts(), saved, 'Workflow rerun no duplicates');
  const unknown = await db.opportunity.findFirstOrThrow({ where: { name: { contains: '维保续费价格冲突' } } });
  eq((await call('workspace/opportunities/' + unknown.id, 1)).amount, null, 'Conflicting renewal stays unknown');
  const spec = JSON.parse(readFileSync(new URL('../demo/tianyu/approval-scenarios.json', import.meta.url))),
    as = {},
    approval = await installApprovalScenarios({ call, spec, state: as });
  eq(approval.flows.length, 36, 'Richer published approval types');
  assert(approval.approvals.length >= 230);
  checks++;
  const approvalCount = await db.approval.count();
  await installApprovalScenarios({ call, spec, state: as });
  eq(await db.approval.count(), approvalCount, 'Approval rerun no duplicates');
  for (const f of approval.flows.filter((f) => f.mode === 'any')) {
    const sample = approval.approvals.find((a) => a.flowId === f.id && a.scenario === 'approved');
    const nodes = await db.approvalNode.findMany({ where: { approvalId: sample.id } });
    eq(nodes.filter((n) => n.action === 'approved').length, 1, 'Any-sign only one real decision');
    assert(nodes.some((n) => n.action !== 'approved'));
    checks++;
  }
  for (const f of approval.flows.filter((f) => f.mode === 'all')) {
    const sample = approval.approvals.find((a) => a.flowId === f.id && a.scenario === 'approved');
    const nodes = await db.approvalNode.findMany({ where: { approvalId: sample.id } });
    eq(
      nodes.every((n) => n.action === 'approved'),
      true,
      'All-sign independently completed',
    );
  }
  for (const [kind, rows] of Object.entries(before)) {
    const current = await db[kind].findMany({ where: { id: { in: rows.map((r) => r.id) } }, orderBy: { id: 'asc' } });
    eq(current, rows, 'Existing ' + kind + ' rows unchanged');
  }
  const draft = await db.contract.findFirstOrThrow({ where: { name: { contains: '非标试制与测试服务合同草稿' } } });
  eq([draft.status, draft.totalOutstanding.toFixed(2)], ['draft', '0.00'], 'New draft is not debt');
  eq(await db.invoice.count(), before.invoice.length, 'No fictitious invoices');
  eq(await db.receipt.count(), before.receipt.length, 'No fictitious receipts');
  const manager = await call('analytics/funnel?from=2010-01-01&to=2060-12-31', 1010),
    sales = await call('analytics/funnel?from=2010-01-01&to=2060-12-31', 1100);
  assert(manager.summary.count >= sales.summary.count && sales.summary.count > 0);
  checks++;
  const opportunityPlans = await installOpportunityActions(db, { ...env, TIANYU_ALLOW_ACTIVITY_SEED: 'true' });
  eq(opportunityPlans.openOpportunities, 1752, 'Only reduced base opportunities, not imported AI cases');
  eq(opportunityPlans.newActions, 1752, 'Every base open opportunity has a next action');
  eq(opportunityPlans.newCalendarEntries, 1752, 'Every base next action has a local proposed slot');
  const repeatedPlans = await installOpportunityActions(db, { ...env, TIANYU_ALLOW_ACTIVITY_SEED: 'true' });
  eq(
    [repeatedPlans.newActions, repeatedPlans.newCalendarEntries],
    [0, 0],
    'Supplemental plans replay without duplicates',
  );
  eq(await db.actionPlan.count({ where: { source: 'ai_recommend' } }), 36, 'Case-specific AI plans preserved');
  console.log(
    JSON.stringify({
      result: 'PASS',
      checks,
      baseCounts: base.counts,
      workflow,
      opportunityPlans,
      approval: approval.counts,
      fixtures: 'TIANYU synthetic only',
      financialRecordsPreserved: true,
      externalEffects: 0,
    }),
  );
} catch (e) {
  console.error(log);
  throw e;
} finally {
  api?.kill('SIGTERM');
  await db.$disconnect();
}
