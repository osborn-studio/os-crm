// Synthetic native-MySQL integration. Never targets a demo/customer database.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeProduction } from '../deploy/initialize-production.mjs';
assert.equal(process.env.SMOKE_ALLOW_WRITES, 'true');
assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/tb_crm_test_[a-z0-9_]+$/);
const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient(),
  scratch = await mkdtemp(join(tmpdir(), 'crm-service-'));
const password = 'Service-Fixture-Password-2026';
const env = {
  ...process.env,
  DEMO_MODE: 'false',
  TENANT_CODE: 'COUNTERSIGNTEST',
  TENANT_NAME: '售后闭环合成测试',
  ADMIN_USERNAME: 'admin',
  SEED_ADMIN_PASSWORD: password,
  APP_URL: 'http://localhost:3000',
  JWT_SECRET: randomBytes(32).toString('hex'),
  ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  BACKUP_KEY: randomBytes(32).toString('hex'),
};
await initializeProduction(db, env);
let checks = 0,
  log = '',
  cloneDb,
  cloneApi;
const api = spawn(process.execPath, ['apps/api/dist/main.js'], {
  env: { ...env, HOST: '127.0.0.1', PORT: '4150' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
api.stdout.on('data', (v) => {
  log = (log + v).slice(-5000);
});
api.stderr.on('data', (v) => {
  log = (log + v).slice(-5000);
});
const ok = (v, label) => {
  assert(v, label);
  checks++;
};
async function call(path, method = 'GET', body, token, expected = 200, port = 4150) {
  const r = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  const out = await r.json();
  ok(r.status === expected, `${method} ${path}: expected ${expected}, got ${r.status}: ${out.message ?? ''}`);
  return out.data;
}
async function ready(port) {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/v1/health/ready`)).ok) return;
    } catch {}
    await delay(150);
  }
  throw Error(log);
}
const req = (data, row) => ({ requestKey: randomUUID(), ...(row ? { expectedUpdatedAt: row.updatedAt } : {}), data });
const login = async (username, tenantCode = env.TENANT_CODE, port = 4150) =>
  (await call('/auth/login', 'POST', { username, password, tenantCode }, undefined, 200, port)).accessToken;
const query = (sql) => {
  const u = new URL(env.DATABASE_URL),
    mysql = process.env.MYSQL_BIN_DIR ? join(process.env.MYSQL_BIN_DIR, 'mysql') : 'mysql';
  const r = spawnSync(
    mysql,
    [
      '--protocol=TCP',
      '--host=' + u.hostname,
      '--port=' + u.port,
      '--user=' + decodeURIComponent(u.username),
      u.pathname.slice(1),
      '--execute',
      sql,
    ],
    { env: { ...env, MYSQL_PWD: decodeURIComponent(u.password) }, encoding: 'utf8' },
  );
  if (r.status !== 0) throw Error(r.stderr);
};
try {
  await ready(4150);
  const admin = await login('admin');
  const tid = (await db.tenant.findUniqueOrThrow({ where: { code: env.TENANT_CODE } })).id;
  const roles = await call('/system/roles', 'GET', undefined, admin);
  const catalog = await call('/service-tickets/schema', 'GET', undefined, admin);
  ok(
    catalog.length === 11 &&
      catalog.every((c) => c.version === '1.0' && c.inputSchema.type === 'object' && c.agentEnabled === false),
    'Versioned machine-readable contracts remain unavailable as agent tools',
  );
  const dept = await call('/system/departments', 'POST', req({ name: '售后合成部门' }), admin, 201);
  const dept2 = await call('/system/departments', 'POST', req({ name: '另一个部门' }), admin, 201);
  const users = {},
    tokens = {};
  for (const [username, code, deptId] of [
    ['sales', 'sales', dept.id],
    ['peer', 'sales', dept.id],
    ['manager', 'sales_manager', dept.id],
    ['outsider', 'sales', dept2.id],
    ['boss', 'gm', dept.id],
  ]) {
    users[username] = await call(
      '/system/users',
      'POST',
      req({ username, name: '合成' + username, password, deptId, roleIds: [roles.find((r) => r.code === code).id] }),
      admin,
      201,
    );
    tokens[username] = await login(username);
  }
  ok(
    (await call('/service-tickets/schema', 'GET', undefined, tokens.boss)).every((c) => c.effect === 'read'),
    'Boss discovers only authorized read contracts',
  );
  for (const username of ['manager2', 'manager3']) {
    users[username] = await call(
      '/system/users',
      'POST',
      req({
        username,
        name: '合成' + username,
        password,
        deptId: dept.id,
        roleIds: [roles.find((r) => r.code === 'sales_manager').id],
      }),
      admin,
      201,
    );
    tokens[username] = await login(username);
  }
  const adminId = (await db.user.findFirst({ where: { tenantId: tid, username: 'admin' } })).id;
  const all = (ids, name = '多人核对') => ({
    name,
    approverType: 'users_all',
    approverValue: ids.join(','),
    condition: 'always',
  });
  const single = (userId, name = '最终核准') => ({
    name,
    approverType: 'user',
    approverValue: String(userId),
    condition: 'always',
  });
  const save = async (name, nodes, bizType = 'general', expected = 201) =>
    call(
      '/approvals/flows',
      'POST',
      { requestKey: randomUUID(), name, bizType, priority: 1000, nodes, fields: [] },
      admin,
      expected,
    );
  const publish = async (f) =>
    call(
      '/approvals/flows/' + f.id + '/publish',
      'POST',
      { requestKey: randomUUID(), expectedUpdatedAt: f.updatedAt },
      admin,
      201,
    );
  const flow = async (name, nodes, bizType = 'general') => {
    const f = await save(name, nodes, bizType);
    await publish(f);
    return f;
  };
  const start = async (f) =>
    call(
      '/approvals',
      'POST',
      { requestKey: randomUUID(), flowId: f.id, title: '合成会签申请', form: {} },
      tokens.sales,
      201,
    );
  const detail = async (a) => call('/approvals/' + a.id, 'GET', undefined, admin);
  const pending = async (token, a) =>
    (await call('/approvals/pending', 'GET', undefined, token)).filter((n) => n.approval.id === a.id);
  const decision = async (
    a,
    nodeId,
    token,
    action = 'approve',
    body = { requestKey: randomUUID(), comment: '合成核对意见' },
    expected = 201,
  ) => call('/approvals/' + a.id + '/nodes/' + nodeId + '/' + action, 'POST', body, token, expected);
  const nodeOf = async (a, userId) =>
    (await detail(a)).nodes.find((n) => n.approverId === userId && n.action === 'pending');
  const transfer = async (a, nodeId, targetUserId, token, expected = 201) => {
    const current = await detail(a);
    return call(
      '/approvals/' + a.id + '/nodes/' + nodeId + '/transfer',
      'POST',
      { requestKey: randomUUID(), expectedUpdatedAt: current.updatedAt, targetUserId, reason: '合成会签交接' },
      token,
      expected,
    );
  };
  await save('重复人不能会签', [all([users.manager.id, users.manager.id])], 'general', 400);
  await save('普通销售不能会签', [all([users.manager.id, users.sales.id])], 'general', 400);
  const f = await flow('合成两人会签再核准', [all([users.manager.id, users.boss.id]), single(adminId)]);
  await call(
    '/approvals',
    'POST',
    { requestKey: randomUUID(), flowId: f.id, title: '申请人不得参与自己的会签', form: {} },
    tokens.manager,
    400,
  );
  const otherTenant = await db.tenant.create({ data: { code: 'COUNTEROTHER', name: '合成其他企业' } });
  const foreignRole = await db.role.create({
    data: {
      tenantId: otherTenant.id,
      code: 'foreign_reviewer',
      name: '合成外企审批人',
      permissions: ['approval:approve', 'approval:reject'],
    },
  });
  const foreign = await db.user.create({
    data: {
      tenantId: otherTenant.id,
      username: 'foreign',
      name: '外企合成人员',
      passwordHash: (await db.user.findFirst({ where: { id: adminId } })).passwordHash,
    },
  });
  await db.userRole.create({ data: { tenantId: otherTenant.id, userId: foreign.id, roleId: foreignRole.id } });
  await save('不得跨企业会签', [all([users.manager.id, foreign.id])], 'general', 400);
  const preview = await call('/approvals/flows/' + f.id + '/preview', 'POST', { amount: '0.00' }, tokens.sales, 201);
  ok(
    preview.nodes.length === 3 && preview.nodes[0].order === preview.nodes[1].order && preview.nodes[0].mode === 'all',
    'Preview groups independent votes into one all-required stage',
  );
  let a = await start(f),
    d = await detail(a);
  ok(
    (await pending(tokens.manager, a)).length === 1 &&
      (await pending(tokens.boss, a)).length === 1 &&
      (await pending(admin, a)).length === 0,
    'Every first-stage member sees pending; future stage stays inactive',
  );
  const m = d.nodes.find((n) => n.approverId === users.manager.id),
    b = d.nodes.find((n) => n.approverId === users.boss.id),
    last = d.nodes.find((n) => n.approverId === adminId);
  await decision(a, last.id, admin, 'approve', undefined, 403);
  const keyBody = { requestKey: randomUUID(), comment: '合成：先由非锚点成员同意' };
  const partial = await decision(a, b.id, tokens.boss, 'approve', keyBody);
  ok(
    partial.status === 'pending' && partial.waitingForCountersign === true && (await pending(admin, a)).length === 0,
    'A non-anchor first vote cannot advance or call the business callback',
  );
  await decision(a, b.id, tokens.boss, 'approve', keyBody);
  ok(
    (await db.approvalEvent.count({ where: { tenantId: tid, approvalId: a.id, action: 'approved', nodeId: b.id } })) ===
      1,
    'Vote replay keeps one event',
  );
  await decision(a, m.id, tokens.manager);
  ok(
    (await pending(admin, a)).length === 1 &&
      (await db.notification.count({
        where: { tenantId: tid, userId: adminId, bizId: a.id, type: 'approval.created' },
      })) === 1,
    'Only full stage agreement activates and notifies next stage once',
  );
  await decision(a, last.id, admin);
  ok((await detail(a)).status === 'approved', 'All stages complete');
  // Non-anchor transfer retains stage membership and cannot merge two votes into one person.
  const t = await start(f),
    tn = await nodeOf(t, users.boss.id);
  await transfer(t, tn.id, users.manager.id, tokens.boss, 400);
  await transfer(t, tn.id, users.sales.id, tokens.boss, 400);
  await transfer(t, tn.id, users.manager2.id, tokens.boss);
  await decision(t, tn.id, tokens.boss, 'approve', undefined, 403);
  const successor = await nodeOf(t, users.manager2.id);
  ok(
    successor.nodeOrder === tn.nodeOrder && (await pending(tokens.manager2, t)).length === 1,
    'Transferred non-anchor vote stays active in same stage',
  );
  await decision(t, successor.id, tokens.manager2);
  const tm = await nodeOf(t, users.manager.id);
  await transfer(t, tm.id, users.manager2.id, tokens.manager, 400);
  await decision(t, tm.id, tokens.manager);
  await decision(t, (await nodeOf(t, adminId)).id, admin);
  const transferred = await detail(t);
  ok(
    transferred.nodes.find((n) => n.id === tn.id).action === 'transferred' &&
      transferred.formData.flowSnapshot.nodes.some((n) => n.approverId === users.boss.id),
    'Original group snapshot and transfer lineage are immutable',
  );
  const gf = await flow('合成仅会签', [all([users.manager.id, users.manager2.id])]);
  const concurrent = await start(gf),
    cm = await nodeOf(concurrent, users.manager.id),
    cm2 = await nodeOf(concurrent, users.manager2.id);
  const votes = await Promise.all([
    decision(concurrent, cm.id, tokens.manager),
    decision(concurrent, cm2.id, tokens.manager2),
  ]);
  ok(
    votes.some((v) => v.status === 'pending') &&
      votes.some((v) => v.status === 'approved') &&
      (await detail(concurrent)).status === 'approved',
    'Concurrent independent votes serialize one final completion',
  );
  ok(
    (await db.notification.count({ where: { tenantId: tid, bizId: concurrent.id, type: 'approval.completed' } })) === 1,
    'Concurrent finalization creates one completion inbox message',
  );
  const rejected = await start(gf),
    rm = await nodeOf(rejected, users.manager.id),
    rm2 = await nodeOf(rejected, users.manager2.id);
  await decision(rejected, rm2.id, tokens.manager2, 'reject', {
    requestKey: randomUUID(),
    comment: '合成：证据不足退回',
  });
  await decision(rejected, rm.id, tokens.manager, 'approve', undefined, 403);
  ok(
    (await detail(rejected)).status === 'rejected' && (await pending(tokens.manager, rejected)).length === 0,
    'One rejection terminates the whole group without auto-approval',
  );
  const mixed = await start(gf),
    mix1 = await nodeOf(mixed, users.manager.id),
    mix2 = await nodeOf(mixed, users.manager2.id);
  const mixedStatuses = await Promise.all(
    [
      [mix1, tokens.manager, 'approve'],
      [mix2, tokens.manager2, 'reject'],
    ].map(async ([node, token, action]) => {
      const response = await fetch(
        'http://127.0.0.1:4150/api/v1/approvals/' + mixed.id + '/nodes/' + node.id + '/' + action,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ requestKey: randomUUID(), comment: '合成并发核对' }),
        },
      );
      return response.status;
    }),
  );
  ok(
    mixedStatuses.every((s) => [201, 403].includes(s)) && (await detail(mixed)).status === 'rejected',
    'Concurrent approval and rejection cannot accidentally approve the instance',
  );
  ok(
    (await db.notification.count({ where: { tenantId: tid, bizId: mixed.id, type: 'approval.completed' } })) === 1,
    'Concurrent mixed decisions emit one final inbox result',
  );
  const legacy = await flow('合成旧式顺序审批', [single(users.manager.id), single(users.manager2.id)]),
    legacyApproval = await start(legacy);
  await decision(
    legacyApproval,
    (await nodeOf(legacyApproval, users.manager2.id)).id,
    tokens.manager2,
    'approve',
    undefined,
    403,
  );
  await decision(legacyApproval, (await nodeOf(legacyApproval, users.manager.id)).id, tokens.manager);
  await decision(legacyApproval, (await nodeOf(legacyApproval, users.manager2.id)).id, tokens.manager2);
  ok(
    (await detail(legacyApproval)).status === 'approved',
    'Existing single-person sequential definitions retain their original semantics',
  );
  const withdrawn = await start(gf),
    wm = await nodeOf(withdrawn, users.manager.id);
  const user = await call('/system/users/' + users.manager.id, 'GET', undefined, admin);
  await call('/system/users/' + user.id, 'PUT', req({ status: 'inactive' }, user), admin, 409);
  await call('/approvals/' + withdrawn.id + '/withdraw', 'POST', { requestKey: randomUUID() }, tokens.sales, 201);
  await decision(withdrawn, wm.id, tokens.manager, 'approve', undefined, 403);
  const failure = await start(gf),
    fm = await nodeOf(failure, users.manager.id),
    faultBody = { requestKey: randomUUID(), comment: '合成晚期故障安全重试' };
  const before = {
    nodes: await db.approvalNode.findMany({ where: { approvalId: failure.id }, orderBy: { id: 'asc' } }),
    events: await db.approvalEvent.count({ where: { approvalId: failure.id } }),
    commands: await db.commandExecution.count(),
    audit: await db.auditLog.count(),
    messages: await db.notification.count(),
  };
  query(
    "CREATE TRIGGER fixture_countersign_audit BEFORE INSERT ON audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic countersign audit failure'",
  );
  try {
    await decision(failure, fm.id, tokens.manager, 'approve', faultBody, 500);
  } finally {
    query('DROP TRIGGER fixture_countersign_audit');
  }
  assert.deepEqual(
    await db.approvalNode.findMany({ where: { approvalId: failure.id }, orderBy: { id: 'asc' } }),
    before.nodes,
  );
  checks++;
  ok(
    (await db.approvalEvent.count({ where: { approvalId: failure.id } })) === before.events &&
      (await db.commandExecution.count()) === before.commands &&
      (await db.auditLog.count()) === before.audit &&
      (await db.notification.count()) === before.messages,
    'Late audit failure rolls back stage, votes, events, receipt and inbox',
  );
  await decision(failure, fm.id, tokens.manager, 'approve', faultBody);
  await decision(failure, (await nodeOf(failure, users.manager2.id)).id, tokens.manager2);
  // Live flow edits never rewrite the participants of an in-flight instance.
  const preserved = await start(gf),
    snapshot = (await detail(preserved)).formData.flowSnapshot;
  const revised = await save(gf.name, [all([users.manager.id, users.manager2.id, users.manager3.id])]);
  await publish(revised);
  const afterEdit = await detail(preserved);
  assert.deepEqual(afterEdit.formData.flowSnapshot, snapshot);
  checks++;
  ok(afterEdit.nodes.length === 2, 'Publishing a new definition does not add voters to an existing instance');
  await call('/approvals/' + preserved.id + '/withdraw', 'POST', { requestKey: randomUUID() }, tokens.sales, 201);
  const cf = await flow('合成合同会签', [all([users.manager.id, users.manager2.id])], 'contract');
  const customer = await call('/workspace/customers', 'POST', req({ name: '会签合成客户' }), tokens.sales, 201);
  const contract = await call(
    '/workspace/contracts',
    'POST',
    req({ name: '合成会签合同', customerId: customer.id, contractType: 'implementation', amount: '1200.00' }),
    tokens.sales,
    201,
  );
  let contractRow = await call('/workspace/contracts/' + contract.id, 'GET', undefined, tokens.sales);
  await call(
    '/workspace/contracts/' + contract.id + '/submit',
    'POST',
    { requestKey: randomUUID(), expectedUpdatedAt: contractRow.updatedAt },
    tokens.sales,
    201,
  );
  contractRow = await call('/workspace/contracts/' + contract.id, 'GET', undefined, tokens.sales);
  const ca = { id: contractRow.approvalId },
    c1 = await nodeOf(ca, users.manager.id);
  await decision(ca, c1.id, tokens.manager);
  ok(
    (await call('/workspace/contracts/' + contract.id, 'GET', undefined, tokens.sales)).status === 'pending_approval',
    'First vote does not apply contract callback',
  );
  const c2 = await nodeOf(ca, users.manager2.id),
    finalBody = { requestKey: randomUUID(), comment: '合成最后一票' };
  query(
    "CREATE TRIGGER fixture_countersign_final BEFORE INSERT ON audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic final callback rollback'",
  );
  try {
    await decision(ca, c2.id, tokens.manager2, 'approve', finalBody, 500);
  } finally {
    query('DROP TRIGGER fixture_countersign_final');
  }
  ok(
    (await call('/workspace/contracts/' + contract.id, 'GET', undefined, tokens.sales)).status === 'pending_approval' &&
      (await detail(ca)).status === 'pending',
    'Final callback and final vote roll back together',
  );
  await decision(ca, c2.id, tokens.manager2, 'approve', finalBody);
  const approvedContract = await call('/workspace/contracts/' + contract.id, 'GET', undefined, tokens.sales);
  await decision(ca, c2.id, tokens.manager2, 'approve', finalBody);
  ok(
    approvedContract.status === 'approved' &&
      (await call('/workspace/contracts/' + contract.id, 'GET', undefined, tokens.sales)).updatedAt ===
        approvedContract.updatedAt,
    'Final retry does not repeat business callback',
  );
  const pendingRestore = await start(revised);
  await decision(pendingRestore, (await nodeOf(pendingRestore, users.manager.id)).id, tokens.manager);
  ok(
    (await detail(pendingRestore)).nodes.filter((n) => n.action === 'pending').length === 2,
    'Recovery fixture retains a partially approved live group',
  );
  const run = (args) => {
    const r = spawnSync(process.execPath, args, { env: { ...env, DB_TRANSPORT: 'native' }, encoding: 'utf8' });
    if (r.status !== 0) throw Error((r.stderr ?? '').slice(-1000));
    return r.stdout;
  };
  const file = join(scratch, 'service.crmbackup');
  run(['deploy/data.mjs', 'backup', file]);
  const cloneName = 'tb_crm_restore_sign_' + Date.now(),
    restored = JSON.parse(run(['deploy/data.mjs', 'restore', file, cloneName]));
  ok(restored.promoted === false, 'Recovery never promotes or overwrites source');
  const cloneUrl = new URL(env.DATABASE_URL);
  cloneUrl.pathname = '/' + cloneName;
  cloneDb = new PrismaClient({ datasources: { db: { url: cloneUrl.href } } });
  for (const model of [
    'approval',
    'approvalNode',
    'approvalEvent',
    'approvalFlow',
    'approvalFlowNode',
    'commandExecution',
    'auditLog',
    'notification',
  ]) {
    assert.deepEqual(
      await cloneDb[model].findMany({ orderBy: { id: 'asc' } }),
      await db[model].findMany({ orderBy: { id: 'asc' } }),
    );
    checks++;
  }
  const recovered = parseEnv(await readFile(restored.configPath, 'utf8'));
  cloneApi = spawn(process.execPath, ['apps/api/dist/main.js'], {
    env: { ...env, ...recovered, DATABASE_URL: cloneUrl.href, PORT: '4151', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  cloneApi.stdout.on('data', (v) => {
    log = (log + v).slice(-5000);
  });
  cloneApi.stderr.on('data', (v) => {
    log = (log + v).slice(-5000);
  });
  await ready(4151);
  await call('/service-tickets', 'GET', undefined, admin, 401, 4151);
  const clonedToken = await login('admin', env.TENANT_CODE, 4151);
  const cloned = await call('/approvals/' + pendingRestore.id, 'GET', undefined, clonedToken, 200, 4151);
  ok(
    cloned.status === 'pending' &&
      cloned.nodes.filter((n) => n.action === 'approved').length === 1 &&
      cloned.nodes.filter((n) => n.action === 'pending').length === 2,
    'Encrypted clone preserves partially-approved group and immutable snapshot',
  );
  const cloneManager = await login('manager2', env.TENANT_CODE, 4151);
  const inbox = await call('/approvals/pending', 'GET', undefined, cloneManager, 200, 4151);
  const vote = inbox.find((n) => n.approval.id === pendingRestore.id);
  ok(!!vote, 'Recovered participant sees current group vote');
  await call(
    '/approvals/' + pendingRestore.id + '/nodes/' + vote.nodeId + '/approve',
    'POST',
    { requestKey: randomUUID(), comment: 'Synthetic recovery vote' },
    cloneManager,
    201,
    4151,
  );
  ok(
    (await detail(pendingRestore)).nodes.filter((n) => n.action === 'pending').length === 2,
    'Recovery exercise never changes original pending votes',
  );
  console.log(
    JSON.stringify({
      checks,
      countersign: true,
      independentVotes: true,
      currentStageOnly: true,
      transferLineage: true,
      duplicateVoteGuard: true,
      concurrency: true,
      atomicCallback: true,
      immutableSnapshot: true,
      encryptedRecovery: true,
      noExternalMessages: true,
    }),
  );
} finally {
  api.kill('SIGTERM');
  await Promise.race([new Promise((r) => api.once('exit', r)), delay(3000)]);
  if (cloneApi) {
    cloneApi.kill('SIGTERM');
    await Promise.race([new Promise((r) => cloneApi.once('exit', r)), delay(3000)]);
  }
  if (cloneDb) await cloneDb.$disconnect();
  await db.$disconnect();
  await rm(scratch, { recursive: true, force: true });
}
