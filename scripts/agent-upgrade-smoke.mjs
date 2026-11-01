import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeProduction } from '../deploy/initialize-production.mjs';
assert.equal(process.env.SMOKE_ALLOW_WRITES, 'true');
assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/tb_crm_test_[a-z0-9_]+$/);
const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient(),
  scratch = await mkdtemp(join(tmpdir(), 'crm-agent-upgrade-'));
const prior = 'efb1b762624aa5a538a825e0a0b5d93e050d597d';
let api,
  log = '',
  checks = 0;
const ok = (v, label) => {
  assert(v, label);
  checks++;
};
function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { env: process.env, encoding: 'utf8', ...options });
  if (result.status !== 0) throw Error('Upgrade fixture failed: ' + cmd + ' ' + (result.stderr ?? '').slice(-800));
  return result;
}
const env = {
  ...process.env,
  DEMO_MODE: 'false',
  ENABLE_LEGACY_CRON: 'false',
  TENANT_CODE: 'AGENTUPGRADE',
  TENANT_NAME: '非空智能体升级合成企业',
  ADMIN_USERNAME: 'admin',
  SEED_ADMIN_PASSWORD: 'Upgrade-Only-Password-2026',
  APP_URL: 'http://localhost:3000',
  JWT_SECRET: randomBytes(32).toString('hex'),
  ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  BACKUP_KEY: randomBytes(32).toString('hex'),
};
async function start() {
  api = spawn(process.execPath, ['apps/api/dist/main.js'], {
    env: { ...env, HOST: '127.0.0.1', PORT: '4130' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stdout.on('data', (b) => {
    log = (log + b).slice(-5000);
  });
  api.stderr.on('data', (b) => {
    log = (log + b).slice(-5000);
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (api.exitCode !== null) throw Error(log);
    try {
      ready = (await fetch('http://127.0.0.1:4130/api/v1/health/ready')).ok;
    } catch {}
    if (ready) break;
    await delay(200);
  }
  ok(ready, 'Upgrade API ready');
}
async function stop() {
  if (!api) return;
  api.kill('SIGTERM');
  await Promise.race([new Promise((r) => api.once('exit', r)), delay(3000)]);
  api = undefined;
}
async function call(path, method = 'GET', input, token, expected = 200) {
  const r = await fetch('http://127.0.0.1:4130/api/v1' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    signal: AbortSignal.timeout(30000),
  });
  const out = await r.json();
  ok(r.status === expected, path + ': ' + r.status + ' ' + out.message);
  return out.data;
}
try {
  const archive = run('git', ['archive', prior, 'packages/database/prisma'], { encoding: null }).stdout;
  run('tar', ['-xf', '-', '-C', scratch], { input: archive });
  run('pnpm', [
    '--filter',
    '@partneros/database',
    'exec',
    'prisma',
    'migrate',
    'deploy',
    '--schema',
    join(scratch, 'packages/database/prisma/schema.prisma'),
  ]);
  const columnsBefore = await db.$queryRaw`SHOW COLUMNS FROM agent_executions`;
  ok(
    !columnsBefore.some((r) => r.Field === 'capability_version'),
    'Actual prior schema has no capability-version column',
  );
  await initializeProduction(db, env);
  const tenant = await db.tenant.findUniqueOrThrow({ where: { code: env.TENANT_CODE } });
  const owner = await db.user.findFirstOrThrow({ where: { tenantId: tenant.id, username: 'admin' } });
  const customer = await db.customer.create({
    data: {
      tenantId: tenant.id,
      code: 'AGENT-UPGRADE-C',
      name: '升级保留合成客户',
      ownerId: owner.id,
      poolType: 'private',
    },
  });
  await start();
  const human = (
    await call('/auth/login', 'POST', {
      tenantCode: env.TENANT_CODE,
      username: 'admin',
      password: env.SEED_ADMIN_PASSWORD,
    })
  ).accessToken;
  const grant = await call(
    '/agent-control/grants',
    'POST',
    {
      requestKey: randomUUID(),
      name: '升级前创建的合成委托',
      purpose: '验证正常升级保留有效凭证及历史',
      minutes: 60,
      maxCalls: 50,
      capabilities: ['customer.search', 'customer.get', 'action.propose', 'action.execute'],
    },
    human,
    201,
  );
  ok(
    (await call('/agent-runtime/capabilities', 'GET', undefined, grant.token)).remainingCalls === 50,
    'Live credential works against the old schema without using new receipt column',
  );
  const oldProposal = await db.agentProposal.create({
    data: {
      id: randomUUID(),
      tenantId: tenant.id,
      ownerId: owner.id,
      grantId: grant.id,
      requestKey: randomUUID(),
      inputHash: createHash('sha256').update('synthetic-old-proposal').digest('hex'),
      input: { title: '旧版合成待核对建议', targetId: customer.id, dueDate: '2026-11-02' },
      customerId: customer.id,
      customerVersion: customer.updatedAt,
      customerName: customer.name,
      expiresAt: new Date(Date.now() + 20 * 60000),
    },
  });
  const oldExecutionId = randomUUID(),
    oldKey = randomUUID(),
    oldHash = createHash('sha256').update('synthetic-old-read').digest('hex');
  await db.$executeRaw`INSERT INTO agent_executions (id,tenant_id,grant_id,owner_id,capability_id,request_key,input_hash,status,result,duration_ms,created_at,completed_at) VALUES
    (${oldExecutionId},${tenant.id},${grant.id},${owner.id},'customer.search',${oldKey},${oldHash},'succeeded',${JSON.stringify({ syntheticHistoricalFixture: true })},12,CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3))`;
  await stop();
  const oldRows =
    await db.$queryRaw`SELECT id,tenant_id,grant_id,owner_id,capability_id,request_key,input_hash,status,result,error_code,duration_ms,created_at,completed_at FROM agent_executions ORDER BY id`;
  const grantBefore = await db.agentGrant.findUniqueOrThrow({ where: { id: grant.id } });
  const proposalsBefore = await db.agentProposal.findMany({ orderBy: { id: 'asc' } });
  const sessionsBefore = await db.authSession.findMany({ orderBy: { id: 'asc' } });
  const auditCount = await db.auditLog.count(),
    commandCount = await db.commandExecution.count();
  run('pnpm', ['--filter', '@partneros/database', 'migrate:deploy']);
  assert.deepEqual(
    await db.$queryRaw`SELECT id,tenant_id,grant_id,owner_id,capability_id,request_key,input_hash,status,result,error_code,duration_ms,created_at,completed_at FROM agent_executions ORDER BY id`,
    oldRows,
  );
  checks++;
  const oldReceipt = await db.agentExecution.findUniqueOrThrow({ where: { id: oldExecutionId } });
  ok(oldReceipt.capabilityVersion === '1.0', 'Known version 1.0 backfilled without rewriting old outcome');
  assert.deepEqual(await db.agentGrant.findUniqueOrThrow({ where: { id: grant.id } }), grantBefore);
  checks++;
  assert.deepEqual(await db.agentProposal.findMany({ orderBy: { id: 'asc' } }), proposalsBefore);
  checks++;
  assert.deepEqual(await db.authSession.findMany({ orderBy: { id: 'asc' } }), sessionsBefore);
  checks++;
  ok(
    (await db.user.findUniqueOrThrow({ where: { id: owner.id } })).passwordHash === owner.passwordHash,
    'Upgrade preserves password hash',
  );
  ok(
    (await db.auditLog.count()) === auditCount && (await db.commandExecution.count()) === commandCount,
    'Migration does not fabricate decisions, calls or audit',
  );
  run('pnpm', ['--filter', '@partneros/database', 'migrate:deploy']);
  ok(
    (await db.agentExecution.count()) === 1 && (await db.agentProposal.count()) === 1,
    'Repeated migrate does not duplicate historical entries',
  );
  await start();
  ok(
    (await call('/agent-runtime/capabilities', 'GET', undefined, grant.token)).remainingCalls === 50,
    'Normal upgrade preserves valid credential and budget',
  );
  const oldReceiptRead = await call('/agent-runtime/receipts/' + oldExecutionId, 'GET', undefined, grant.token);
  ok(
    oldReceiptRead.capabilityVersion === '1.0' && oldReceiptRead.status === 'succeeded',
    'Authenticated old receipt readable after upgrade',
  );
  const currentProposal = (await call('/agent-control/proposals', 'GET', undefined, human)).items.find(
    (p) => p.id === oldProposal.id,
  );
  await call(
    '/agent-control/proposals/' + oldProposal.id + '/approve',
    'POST',
    {
      requestKey: randomUUID(),
      expectedUpdatedAt: currentProposal.updatedAt,
      reason: '升级后核对旧版合成建议，不改变原意图',
    },
    human,
    201,
  );
  const invoked = await call(
    '/agent-runtime/invoke',
    'POST',
    { requestKey: randomUUID(), capabilityId: 'action.execute', input: { proposalId: oldProposal.id } },
    grant.token,
    201,
  );
  ok(
    invoked.result.actionId > 0 &&
      (await db.actionPlan.findUniqueOrThrow({ where: { id: invoked.result.actionId } })).source === 'ai_recommend',
    'Existing pending proposal can be explicitly reviewed and executed after upgrade',
  );
  ok(
    (await db.agentExecution.findUniqueOrThrow({ where: { id: invoked.executionId } })).capabilityVersion === '1.0',
    'New execution stores version explicitly',
  );
  ok(
    (await db.agentExecution.findUniqueOrThrow({ where: { id: oldExecutionId } })).status === 'succeeded',
    'New execution leaves old receipt untouched',
  );
  console.log(
    JSON.stringify({
      checks,
      populatedAgentUpgrade: true,
      priorRevision: prior,
      historicalFieldsPreserved: true,
      normalUpgradePreservesCredential: true,
      knownVersionBackfill: true,
      noFabricatedEvents: true,
      postUpgradeExplicitExecution: true,
    }),
  );
} catch (e) {
  console.error(log.slice(-1200));
  throw e;
} finally {
  await stop();
  await db.$disconnect();
  await rm(scratch, { recursive: true, force: true });
}
