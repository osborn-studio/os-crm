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
const db = new PrismaClient();
const scratch = await mkdtemp(join(tmpdir(), 'crm-approval-recovery-'));
let cloneApi, cloneDb;
function fixtureSql(sql) {
  const url = new URL(process.env.DATABASE_URL);
  const result = spawnSync(
    process.env.MYSQL_BIN_DIR ? join(process.env.MYSQL_BIN_DIR, 'mysql') : 'mysql',
    [
      '--protocol=TCP',
      '--host=' + url.hostname,
      '--port=' + (url.port || '3306'),
      '--user=' + decodeURIComponent(url.username),
      url.pathname.slice(1),
      '--delimiter=//',
      '--execute',
      sql + '//',
    ],
    { env: { ...process.env, MYSQL_PWD: decodeURIComponent(url.password) }, encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error('Synthetic SQL fixture failed: ' + (result.stderr || result.error?.message));
}
const env = {
  ...process.env,
  DEMO_MODE: 'false',
  TENANT_CODE: 'APPROVALTEST',
  TENANT_NAME: '收款核销闭环合成测试',
  ADMIN_USERNAME: 'admin',
  SEED_ADMIN_PASSWORD: 'Commercial-Only-Password-2026',
  APP_URL: 'http://localhost:3000',
  JWT_SECRET: randomBytes(32).toString('hex'),
  ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  BACKUP_KEY: randomBytes(32).toString('hex'),
};
await initializeProduction(db, env);
const api = spawn(process.execPath, ['apps/api/dist/main.js'], {
  env: { ...env, PORT: '4122', HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '',
  checks = 0;
api.stdout.on('data', (b) => {
  log = (log + b).slice(-10000);
});
api.stderr.on('data', (b) => {
  log = (log + b).slice(-10000);
});
const ok = (value, label) => {
  assert(value, label);
  checks++;
};
async function call(path, method = 'GET', body, token, expected = 200) {
  const r = await fetch('http://127.0.0.1:4122/api/v1' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  const out = await r.json();
  if (expected !== null)
    ok(r.status === expected, `${method} ${path}: expected ${expected}, got ${r.status} ${out.message ?? ''}`);
  return { status: r.status, data: out.data, body: out };
}
const req = (data, row) => ({ requestKey: randomUUID(), ...(row ? { expectedUpdatedAt: row.updatedAt } : {}), data });
const pw = 'Sales-Fixture-Password-2026';
let admin, sales, peer, manager, boss;
const login = async (username, password = pw, tenantCode = env.TENANT_CODE) =>
  (await call('/auth/login', 'POST', { username, password, tenantCode })).data.accessToken;
const create = async (kind, data, t = sales) => (await call('/workspace/' + kind, 'POST', req(data), t, 201)).data;
const detail = async (kind, row, t = sales) =>
  (await call(`/workspace/${kind}/${row.id ?? row}`, 'GET', undefined, t)).data;
const command = async (kind, row, action, extra = {}, t = sales, expected = 201) =>
  (
    await call(
      `/workspace/${kind}/${row.id}/${action}`,
      'POST',
      { requestKey: randomUUID(), expectedUpdatedAt: row.updatedAt, ...extra },
      t,
      expected,
    )
  ).data;
async function approve(approvalId, t = boss) {
  const p = (await call('/approvals/pending', 'GET', undefined, t)).data.find((n) => n.approval.id === approvalId);
  ok(!!p, 'Assigned approval visible');
  return (
    await call(
      `/approvals/${approvalId}/nodes/${p.nodeId}/approve`,
      'POST',
      { requestKey: randomUUID(), comment: '合成测试审批' },
      t,
      201,
    )
  ).data;
}
async function flow(name, bizType, approverId, fields = []) {
  const f = (
    await call(
      '/approvals/flows',
      'POST',
      {
        requestKey: randomUUID(),
        name,
        bizType,
        condition: 'always',
        priority: 100,
        nodes: [{ name: '负责人核准', approverType: 'user', approverValue: String(approverId), condition: 'always' }],
        fields,
      },
      admin,
      201,
    )
  ).data;
  await call(
    '/approvals/flows/' + f.id + '/publish',
    'POST',
    { requestKey: randomUUID(), expectedUpdatedAt: f.updatedAt },
    admin,
    201,
  );
  return f;
}
async function sign(c) {
  let row = await detail('contracts', c);
  await command('contracts', row, 'submit');
  row = await detail('contracts', c);
  await approve(row.approvalId);
  row = await detail('contracts', c);
  await command('contracts', row, 'sign');
  return detail('contracts', c);
}
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (api.exitCode !== null) throw Error(log);
    try {
      ready = (await fetch('http://127.0.0.1:4122/api/v1/health')).ok;
    } catch {}
    if (ready) break;
    await delay(200);
  }
  ok(ready, 'API ready');
  const readiness = (await call('/health/ready')).data;
  ok(readiness.status === 'ready' && readiness.database === 'reachable', 'Unauthenticated readiness reaches the real database without business records');
  admin = await login('admin', env.SEED_ADMIN_PASSWORD);
  const tid = (await db.tenant.findUniqueOrThrow({ where: { code: env.TENANT_CODE } })).id;
  const roles = (await call('/system/roles', 'GET', undefined, admin)).data;
  const dept = (await call('/system/departments', 'POST', req({ name: '转审合成部门' }), admin, 201)).data;
  const users = {},
    tokens = {};
  for (const [username, roleCode] of [
    ['sales', 'sales'],
    ['peer', 'sales'],
    ['manager', 'sales_manager'],
    ['manager2', 'sales_manager'],
    ['boss', 'gm'],
    ['admin2', 'super_admin'],
  ]) {
    users[username] = (
      await call(
        '/system/users',
        'POST',
        req({
          username,
          name: '合成' + username,
          password: pw,
          deptId: dept.id,
          roleIds: [roles.find((r) => r.code === roleCode).id],
        }),
        admin,
        201,
      )
    ).data;
    tokens[username] = await login(username);
  }
  sales = tokens.sales;
  manager = tokens.manager;
  boss = tokens.boss;
  const makeFlow = async (name, ids) => {
    const f = (
      await call(
        '/approvals/flows',
        'POST',
        {
          requestKey: randomUUID(),
          name,
          bizType: 'general',
          nodes: ids.map((u, i) => ({
            name: '第' + (i + 1) + '级核准',
            approverType: 'user',
            approverValue: String(u),
            condition: 'always',
          })),
          fields: [{ key: 'reason', label: '申请说明', type: 'text', required: true }],
        },
        admin,
        201,
      )
    ).data;
    await call(
      `/approvals/flows/${f.id}/publish`,
      'POST',
      { requestKey: randomUUID(), expectedUpdatedAt: f.updatedAt },
      admin,
      201,
    );
    return f;
  };
  const f = await makeFlow('转审及人员交接', [users.manager.id, users.boss.id]);
  const make = async (title = '仅合成数据的审批') =>
    (
      await call(
        '/approvals',
        'POST',
        {
          requestKey: randomUUID(),
          flowId: f.id,
          title,
          amount: '0.01',
          form: { reason: '合成申请，非真实采购或付款' },
        },
        sales,
        201,
      )
    ).data;
  const read = async (a, t = admin) => (await call(`/approvals/${a.id ?? a}`, 'GET', undefined, t)).data;
  const audits = async (a, t = admin) => (await call(`/approvals/${a.id ?? a}/events`, 'GET', undefined, t)).data;
  const body = (a, target, reason = '合成人员交接') => ({
    requestKey: randomUUID(),
    expectedUpdatedAt: a.updatedAt,
    targetUserId: target,
    reason,
  });
  const move = (a, nodeId, data, t = admin, expected = 201) =>
    call(`/approvals/${a.id}/nodes/${nodeId}/transfer`, 'POST', data, t, expected);
  const decide = (a, nodeId, t, action = 'approve', expected = 201, data = {}) =>
    call(
      `/approvals/${a.id}/nodes/${nodeId}/${action}`,
      'POST',
      {
        requestKey: randomUUID(),
        comment: '合成核准',
        ...data,
      },
      t,
      expected,
    );
  let a = await read(await make());
  const firstId = a.currentNodeId;
  ok((await audits(a)).items.length === 1, 'Submission event created');
  await call(`/approvals/${a.id}`, 'GET', undefined, tokens.peer, 404);
  await call(`/approvals/${a.id}/events`, 'GET', undefined, tokens.peer, 404);
  ok(
    !(await call('/approvals/history', 'GET', undefined, tokens.peer)).data.items.some((r) => r.id === a.id),
    'Unrelated history scoped',
  );
  await move(a, firstId, body(a, users.manager2.id), sales, 403);
  await move(a, firstId, body(a, users.manager2.id), tokens.admin2, 201);
  let after = await read(a);
  ok(after.currentNodeId !== firstId && after.status === 'pending', 'Administrator recovers current without approving');
  ok(JSON.stringify(after.formData) === JSON.stringify(a.formData), 'Immutable flow and form snapshot');
  ok(
    after.nodes.find((n) => n.id === firstId).approverId === users.manager.id &&
      after.nodes.find((n) => n.id === firstId).action === 'transferred',
    'Original assignee retained',
  );
  ok(
    (await call('/approvals/pending', 'GET', undefined, manager)).data.length === 0,
    'Old assignee no pending authority',
  );
  await decide(a, firstId, manager, 'approve', 403);
  ok(
    (await call('/approvals/pending', 'GET', undefined, tokens.manager2)).data.some(
      (n) => n.nodeId === after.currentNodeId,
    ),
    'New assignee pending',
  );
  const transferEvent = (await audits(a)).items.find((e) => e.action === 'transferred');
  ok(
    transferEvent.evidence.fromName === users.manager.name &&
      transferEvent.evidence.toName === users.manager2.name &&
      transferEvent.actorId === users.admin2.id,
    'Actor and person snapshots retained',
  );
  ok((await read(a, manager)).id === a.id, 'Previous approver retains history read');
  ok(
    (await call('/approvals/history', 'GET', undefined, manager)).data.items.some((r) => r.id === a.id),
    'Previous approver history list retained',
  );
  const candidates = (
    await call(`/approvals/${a.id}/nodes/${after.currentNodeId}/transfer-people`, 'GET', undefined, tokens.manager2)
  ).data;
  ok(
    !candidates.items.some((u) => [users.sales.id, users.peer.id, users.manager2.id].includes(u.id)),
    'Candidates exclude applicant, unprivileged, old assignee',
  );
  ok(
    candidates.items.some((u) => u.id === users.manager.id),
    'Valid approver candidate',
  );
  await call(
    `/approvals/${a.id}/nodes/${after.currentNodeId}/transfer-people?after=-1`,
    'GET',
    undefined,
    tokens.manager2,
    400,
  );
  await call('/approvals/history?after=NaN', 'GET', undefined, admin, 400);
  await call(`/approvals/${a.id}/events?after=0`, 'GET', undefined, admin, 400);
  for (const target of [users.sales.id, users.peer.id, users.manager2.id, 2147483600])
    await move(after, after.currentNodeId, body(after, target), tokens.manager2, 400);
  await move(
    after,
    after.currentNodeId,
    { ...body(after, users.manager.id), actorId: users.admin2.id },
    tokens.manager2,
    400,
  );
  await move(after, after.currentNodeId, { ...body(after, users.manager.id), reason: ' ' }, tokens.manager2, 400);
  await move(
    after,
    after.currentNodeId,
    { ...body(after, users.manager.id), expectedUpdatedAt: a.updatedAt },
    tokens.manager2,
    409,
  );
  const foreign = await db.tenant.create({ data: { code: 'FOREIGNAPPROVAL', name: '外部合成企业', status: 'active' } });
  const foreignUser = await db.user.create({
    data: { tenantId: foreign.id, username: 'foreign', name: '外部合成人员', passwordHash: 'not-a-valid-hash' },
  });
  await move(after, after.currentNodeId, body(after, foreignUser.id), admin, 400);
  const foreignApproval = await db.approval.create({
    data: {
      tenantId: foreign.id,
      approvalNo: 'SYNTHETIC-FOREIGN',
      bizType: 'general',
      bizId: -1,
      title: '其他企业',
      applicantId: foreignUser.id,
    },
  });
  await call(`/approvals/${foreignApproval.id}`, 'GET', undefined, admin, 404);
  await call(`/approvals/${foreignApproval.id}/events`, 'GET', undefined, admin, 404);
  await move(foreignApproval, firstId, body(foreignApproval, users.manager2.id), admin, 404);
  // Non-current owner cannot hand over early; administrators can recover all remaining assignments.
  const future = after.nodes.find((n) => n.approverId === users.boss.id);
  await move(after, future.id, body(after, users.manager.id), boss, 403);
  const bossView = (await call(`/system/users/${users.boss.id}`, 'GET', undefined, admin)).data;
  await call(`/system/users/${users.boss.id}`, 'PUT', req({ status: 'inactive' }, bossView), admin, 409);
  const futureMove = body(after, users.manager.id);
  const futureMoved = (await move(after, future.id, futureMove)).data;
  const replay = (await move(after, future.id, futureMove)).data;
  ok(replay.nodeId === futureMoved.nodeId, 'Durable transfer replay returns same successor');
  after = await read(a);
  ok(after.currentNodeId !== futureMoved.nodeId, 'Future transfer does not skip current node');
  ok(
    (await call('/approvals/pending', 'GET', undefined, manager)).data.length === 0,
    'Future successor not prematurely actionable',
  );
  await decide(a, futureMoved.nodeId, manager, 'approve', 403);
  await call(`/system/users/${users.boss.id}`, 'PUT', req({ status: 'inactive' }, bossView), admin, 200);
  await call('/approvals/history', 'GET', undefined, boss, 401);
  await decide(after, after.currentNodeId, tokens.manager2);
  after = await read(a);
  ok(after.currentNodeId === futureMoved.nodeId, 'Flow advances to transferred future successor');
  await decide(after, after.currentNodeId, manager);
  after = await read(a);
  ok(
    after.status === 'approved' && after.nodes.filter((n) => n.action === 'approved').length === 2,
    'Transferred flow completes both required positions',
  );
  await move(after, futureMoved.nodeId, body(after, users.manager2.id), admin, 400);
  ok(
    (await audits(a, sales)).items.filter((e) => e.action === 'approved').length === 2,
    'Applicant sees final decision evidence',
  );
  // Current assignee transfer, replay conflicts and concurrency.
  const one = await makeFlow('当前转审合成流程', [users.manager.id]);
  const single = async (title) =>
    read(
      (
        await call(
          '/approvals',
          'POST',
          { requestKey: randomUUID(), flowId: one.id, title, form: { reason: '合成并发或回滚验证' } },
          sales,
          201,
        )
      ).data,
    );
  let b = await single('当前审批人转审');
  const bBody = body(b, users.manager2.id);
  const moved = (await move(b, b.currentNodeId, bBody, manager)).data;
  ok(
    (await move(b, b.currentNodeId, bBody, manager)).data.nodeId === moved.nodeId,
    'Assigned actor replay no duplicate successor',
  );
  await move(b, b.currentNodeId, { ...bBody, reason: 'different' }, manager, 409);
  b = await read(b);
  ok(
    (await audits(b)).items[0].evidence.administratorRecovery === false,
    'Self initiated transfer recorded distinctly',
  );
  await decide(b, b.currentNodeId, tokens.manager2, 'reject');
  ok((await read(b)).status === 'rejected', 'Successor can reject');
  const c = await single('并发转审');
  const results = await Promise.all([
    move(c, c.currentNodeId, body(c, users.manager2.id), manager, null),
    move(c, c.currentNodeId, body(c, users.admin2.id), manager, null),
  ]);
  ok(
    results.filter((r) => r.status === 201).length === 1 && results.every((r) => [201, 400, 409].includes(r.status)),
    'Only one concurrent successor',
  );
  ok((await read(c)).nodes.length === 2, 'No transfer fork');
  const d = await single('审批与转审竞态');
  const race = await Promise.all([
    move(d, d.currentNodeId, body(d, users.manager2.id), manager, null),
    decide(d, d.currentNodeId, manager, 'approve', null),
  ]);
  ok(race.filter((r) => r.status === 201).length === 1, 'Decision versus transfer one wins');
  const e = await single('撤回与转审竞态');
  await move(e, e.currentNodeId, body(e, users.manager2.id), manager);
  await call(`/approvals/${e.id}/withdraw`, 'POST', { requestKey: randomUUID() }, sales, 201);
  const withdrawn = await read(e);
  await decide(withdrawn, withdrawn.nodes.find((n) => n.action === 'pending').id, tokens.manager2, 'approve', 403);
  ok((await audits(e)).items[0].action === 'withdrawn', 'Withdrawal evidence after transfer retained');
  // Failure after nodes/current pointer are changed must roll everything back, including inbox and command receipt.
  const failure = await single('故障回滚验证');
  const failureBody = body(failure, users.manager2.id);
  const counts = async () => ({
    nodes: await db.approvalNode.count({ where: { approvalId: failure.id } }),
    events: await db.approvalEvent.count({ where: { approvalId: failure.id } }),
    inbox: await db.notification.count({ where: { tenantId: tid } }),
    commands: await db.commandExecution.count({ where: { tenantId: tid } }),
  });
  const beforeFailure = await counts();
  fixtureSql(
    "CREATE TRIGGER fixture_transfer_rollback BEFORE INSERT ON approval_events FOR EACH ROW BEGIN IF NEW.action = 'transferred' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic transfer rollback'; END IF; END",
  );
  try {
    await move(failure, failure.currentNodeId, failureBody, manager, 500);
  } finally {
    fixtureSql('DROP TRIGGER fixture_transfer_rollback');
  }
  ok(
    JSON.stringify(await counts()) === JSON.stringify(beforeFailure),
    'Late failure rolls back nodes events inbox and command',
  );
  ok(
    (await read(failure)).currentNodeId === failure.currentNodeId &&
      (await read(failure)).updatedAt === failure.updatedAt,
    'Late failure preserves version and current pointer',
  );
  await move(failure, failure.currentNodeId, failureBody, manager);
  const inboxFailure = await single('通知写入故障回滚');
  const inboxBody = body(inboxFailure, users.manager2.id);
  const beforeInbox = {
    nodes: await db.approvalNode.count(),
    events: await db.approvalEvent.count(),
    inbox: await db.notification.count(),
    commands: await db.commandExecution.count(),
  };
  fixtureSql(
    "CREATE TRIGGER fixture_transfer_inbox_rollback BEFORE INSERT ON notifications FOR EACH ROW BEGIN IF NEW.type = 'approval.transferred' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic inbox rollback'; END IF; END",
  );
  try {
    await move(inboxFailure, inboxFailure.currentNodeId, inboxBody, manager, 500);
  } finally {
    fixtureSql('DROP TRIGGER fixture_transfer_inbox_rollback');
  }
  ok(
    JSON.stringify({
      nodes: await db.approvalNode.count(),
      events: await db.approvalEvent.count(),
      inbox: await db.notification.count(),
      commands: await db.commandExecution.count(),
    }) === JSON.stringify(beforeInbox),
    'Inbox failure rolls back successor, pointer, existing event and command',
  );
  await move(inboxFailure, inboxFailure.currentNodeId, inboxBody, manager);
  // Candidate permission/status/department checks are revalidated during write.
  const invalid = await single('候选权限重检');
  await db.user.update({ where: { id: users.manager2.id }, data: { status: 'inactive' } });
  await move(invalid, invalid.currentNodeId, body(invalid, users.manager2.id), admin, 400);
  await db.user.update({ where: { id: users.manager2.id }, data: { status: 'active' } });
  await db.department.update({ where: { id: dept.id }, data: { status: 0 } });
  await move(invalid, invalid.currentNodeId, body(invalid, users.manager2.id), admin, 400);
  await db.department.update({ where: { id: dept.id }, data: { status: 1 } });
  const roleLink = await db.userRole.findFirstOrThrow({ where: { userId: users.manager2.id } });
  await db.userRole.deleteMany({ where: { userId: users.manager2.id } });
  await move(invalid, invalid.currentNodeId, body(invalid, users.manager2.id), admin, 400);
  await db.userRole.create({ data: { tenantId: tid, userId: users.manager2.id, roleId: roleLink.roleId } });
  // The same transfer service works for business documents and leaves callback timing unchanged.
  await flow('合同转审核准', 'contract', users.manager.id);
  const customer = await create('customers', { name: '转审合成客户' });
  const contract = await create('contracts', {
    name: '转审合成合同',
    customerId: customer.id,
    contractType: 'implementation',
    amount: '10.01',
  });
  await command('contracts', await detail('contracts', contract), 'submit');
  const pendingContract = await detail('contracts', contract);
  let contractApproval = await read(pendingContract.approvalId);
  await move(contractApproval, contractApproval.currentNodeId, body(contractApproval, users.manager2.id), manager);
  ok((await detail('contracts', contract)).status === 'pending_approval', 'Transfer does not invoke contract callback');
  contractApproval = await read(contractApproval);
  await decide(contractApproval, contractApproval.currentNodeId, tokens.manager2);
  ok(
    (await detail('contracts', contract)).status === 'approved',
    'Successor decision invokes guarded business callback',
  );
  const activeNotifications = await db.notification.findMany({
    where: { tenantId: tid, type: 'approval.transferred', bizId: contractApproval.id },
  });
  ok(
    activeNotifications.length === 3 && activeNotifications.every((n) => n.channel === 'inbox'),
    'Transfer creates exactly original/target/applicant inbox records, no external send',
  );
  // Candidate scan pages can be empty after permissions are filtered; cursor still makes progress.
  await db.user.createMany({
    data: Array.from({ length: 102 }, (_, i) => ({
      tenantId: tid,
      username: 'page-no-role-' + i,
      name: '无审批权限合成人员',
      passwordHash: 'not-a-valid-hash',
    })),
  });
  const candidatePage1 = (
    await call(`/approvals/${invalid.id}/nodes/${invalid.currentNodeId}/transfer-people`, 'GET', undefined, admin)
  ).data;
  ok(candidatePage1.nextCursor !== null, 'Candidate scan reports continuation after hundred users');
  const candidatePage2 = (
    await call(
      `/approvals/${invalid.id}/nodes/${invalid.currentNodeId}/transfer-people?after=${candidatePage1.nextCursor}`,
      'GET',
      undefined,
      admin,
    )
  ).data;
  ok(
    candidatePage2.items.length === 0 && candidatePage2.nextCursor === null,
    'Empty permission-filtered final candidate page is explicit',
  );
  // Pagination uses stable cursors and never includes another tenant's rows.
  await db.approval.createMany({
    data: Array.from({ length: 53 }, (_, i) => ({
      tenantId: tid,
      approvalNo: 'PAGE-' + i,
      bizType: 'general',
      bizId: -10000 - i,
      title: '合成分页',
      applicantId: users.sales.id,
    })),
  });
  const page1 = (await call('/approvals/history', 'GET', undefined, admin)).data;
  const page2 = (await call(`/approvals/history?after=${page1.nextCursor}`, 'GET', undefined, admin)).data;
  ok(
    page1.items.length === 50 &&
      page2.items.length > 0 &&
      !page2.items.some((r) => page1.items.some((p) => p.id === r.id)),
    'History pages do not overlap',
  );
  ok(
    ![...page1.items, ...page2.items].some((r) => r.id === foreignApproval.id),
    'Administrator history remains tenant scoped',
  );
  ok((await audits(page1.items[0])).items.length === 0, 'Legacy approvals have no fabricated events');
  await db.approvalEvent.createMany({
    data: Array.from({ length: 53 }, (_, i) => ({
      tenantId: tid,
      approvalId: invalid.id,
      actorId: users.admin2.id,
      actorName: '分页合成人员',
      action: 'synthetic',
      note: '仅分页测试' + i,
      evidence: {},
    })),
  });
  const eventPage1 = await audits(invalid);
  const eventPage2 = (
    await call(`/approvals/${invalid.id}/events?after=${eventPage1.nextCursor}`, 'GET', undefined, admin)
  ).data;
  ok(
    eventPage1.items.length === 50 &&
      eventPage2.items.length === 4 &&
      !eventPage2.items.some((e) => eventPage1.items.some((p) => p.id === e.id)),
    'Event pagination preserves all entries',
  );
  // Nonempty encrypted recovery preserves transferred nodes, source snapshot, inbox, events and command replay.
  const backupFile = join(scratch, 'approval.crmbackup');
  const run = (args) => {
    const r = spawnSync(process.execPath, args, { env: { ...env, DB_TRANSPORT: 'native' }, encoding: 'utf8' });
    if (r.status !== 0) throw Error('Recovery fixture failed: ' + (r.stderr ?? '').slice(-1000));
    return r.stdout;
  };
  run(['deploy/data.mjs', 'backup', backupFile]);
  ok(!(await readFile(backupFile)).includes(Buffer.from('合成人员交接')), 'Approval backup encrypted');
  const cloneName = 'tb_crm_restore_c6_' + Date.now();
  const restored = JSON.parse(run(['deploy/data.mjs', 'restore', backupFile, cloneName]));
  ok(restored.promoted === false, 'Recovery preserves source and does not promote');
  const cloneUrl = new URL(process.env.DATABASE_URL);
  cloneUrl.pathname = '/' + cloneName;
  cloneDb = new PrismaClient({ datasources: { db: { url: cloneUrl.href } } });
  for (const model of ['approval', 'approvalNode', 'approvalEvent', 'notification', 'commandExecution']) {
    assert.deepEqual(
      await cloneDb[model].findMany({ orderBy: { id: 'asc' } }),
      await db[model].findMany({ orderBy: { id: 'asc' } }),
    );
    checks++;
  }
  const recovered = parseEnv(await readFile(restored.configPath, 'utf8'));
  ok(
    recovered.JWT_SECRET !== env.JWT_SECRET && recovered.ENCRYPTION_KEY === env.ENCRYPTION_KEY,
    'Recovery rotates sessions and retains data encryption key',
  );
  cloneApi = spawn(process.execPath, ['apps/api/dist/main.js'], {
    env: { ...env, ...recovered, DATABASE_URL: cloneUrl.href, HOST: '127.0.0.1', PORT: '4123' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  cloneApi.stdout.on('data', (b) => {
    log = (log + b).slice(-5000);
  });
  cloneApi.stderr.on('data', (b) => {
    log = (log + b).slice(-5000);
  });
  let cloneReady = false;
  for (let i = 0; i < 100; i++) {
    if (cloneApi.exitCode !== null) throw Error(log);
    try {
      cloneReady = (await fetch('http://127.0.0.1:4123/api/v1/health')).ok;
    } catch {}
    if (cloneReady) break;
    await delay(200);
  }
  ok(cloneReady, 'Recovered API ready');
  const cloneCall = async (path, method, data, token, expected = 200) => {
    const r = await fetch('http://127.0.0.1:4123/api/v1' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      signal: AbortSignal.timeout(30000),
    });
    const out = await r.json();
    ok(r.status === expected, 'Recovered ' + path + ' status ' + r.status);
    return out.data;
  };
  await cloneCall(`/approvals/${contractApproval.id}`, 'GET', undefined, admin, 401);
  const cloneLogin = await cloneCall('/auth/login', 'POST', {
    tenantCode: env.TENANT_CODE,
    username: 'admin',
    password: env.SEED_ADMIN_PASSWORD,
  });
  const restoredApproval = await cloneCall(
    `/approvals/${contractApproval.id}`,
    'GET',
    undefined,
    cloneLogin.accessToken,
  );
  ok(
    restoredApproval.status === 'approved' && restoredApproval.nodes.some((n) => n.action === 'transferred'),
    'Recovered API exposes final status and original transferred node',
  );
  const restoredEvents = await cloneCall(
    `/approvals/${contractApproval.id}/events`,
    'GET',
    undefined,
    cloneLogin.accessToken,
  );
  ok(
    restoredEvents.items.some((e) => e.evidence.toUserId === users.manager2.id),
    'Recovered authenticated read preserves transfer evidence',
  );
  ok(
    (await db.approval.findUniqueOrThrow({ where: { id: contractApproval.id } })).status === 'approved',
    'Source approval unchanged by clone login',
  );
  console.log(
    JSON.stringify({
      checks,
      approvalTransfer: true,
      administratorRecovery: true,
      immutableHistory: true,
      independentReview: true,
      concurrency: true,
      atomicRollback: true,
      offboarding: true,
      tenantScopes: true,
      pagination: true,
      encryptedRecovery: true,
      noExternalMessages: true,
    }),
  );
} catch (e) {
  console.error(log.slice(-1600));
  throw e;
} finally {
  api.kill('SIGTERM');
  await Promise.race([new Promise((r) => api.once('exit', r)), delay(3000)]);
  await db.$disconnect();
  if (cloneApi) {
    cloneApi.kill('SIGTERM');
    await Promise.race([new Promise((r) => cloneApi.once('exit', r)), delay(3000)]);
  }
  if (cloneDb) await cloneDb.$disconnect();
  await rm(scratch, { recursive: true, force: true });
}
