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
  TENANT_CODE: 'EVIDENCETEST',
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
  env: { ...env, HOST: '127.0.0.1', PORT: '4140' },
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
async function call(path, method = 'GET', body, token, expected = 200, port = 4140) {
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
const login = async (username, tenantCode = env.TENANT_CODE, port = 4140) =>
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
  await ready(4140);
  const admin = await login('admin');
  const tid = (await db.tenant.findUniqueOrThrow({ where: { code: env.TENANT_CODE } })).id;
  const roles = await call('/system/roles', 'GET', undefined, admin);
  const attachmentCatalog = await call('/evidence-attachments/schema', 'GET', undefined, admin);
  ok(
    attachmentCatalog.length === 4 &&
      attachmentCatalog.every(
        (c) =>
          c.version === (['attachment.upload', 'attachment.withdraw'].includes(c.id) ? '2.0' : '1.0') &&
          c.agentEnabled === false &&
          c.inputSchema.type === 'object' &&
          c.outputSchema.type,
      ),
    'Versioned attachment schemas remain explicit and unavailable to agents',
  );
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
  const customer = await db.customer.create({
    data: {
      tenantId: tid,
      code: 'SYNTHETIC-SERVICE',
      name: '售后合成客户',
      ownerId: users.sales.id,
      poolType: 'private',
    },
  });
  // Upstream accepted-project lifecycle is separately covered by delivery smoke; this fixture is explicitly synthetic.
  const p = await db.project.create({
    data: {
      tenantId: tid,
      projectNo: 'SYNTHETIC-ACCEPTED',
      name: '合成已验收项目',
      customerId: customer.id,
      pmId: users.sales.id,
      salesOwnerId: users.sales.id,
      status: 'completed',
      acceptanceState: 'accepted',
      plannedStartDate: new Date('2026-01-01'),
      plannedEndDate: new Date('2026-01-02'),
    },
  });
  const projectBefore = await db.project.findUnique({ where: { id: p.id } });
  const active = await db.project.create({
    data: {
      tenantId: tid,
      projectNo: 'SYNTHETIC-ACTIVE-EVIDENCE',
      name: '合成进行中项目',
      customerId: customer.id,
      pmId: users.sales.id,
      salesOwnerId: users.sales.id,
      status: 'active',
      actualStartDate: new Date(),
      plannedStartDate: new Date('2026-01-01'),
      plannedEndDate: new Date('2026-01-02'),
    },
  });
  const task = await db.projectTask.create({
    data: {
      tenantId: tid,
      projectId: active.id,
      title: '合成证据任务',
      assigneeId: users.sales.id,
      status: 'in_progress',
    },
  });
  const pdf = Buffer.from('%PDF-1.7\nsynthetic-private-evidence-' + randomUUID() + '\n%%EOF');
  const body = (extra = {}) => ({
    requestKey: randomUUID(),
    subjectKind: 'projects',
    subjectId: active.id,
    filename: '合成验收证据.pdf',
    contentBase64: pdf.toString('base64'),
    acknowledged: true,
    ...extra,
  });
  const parentVersion = async (kind, subjectId) => {
    const model = { projects: db.project, tasks: db.projectTask, 'service-tickets': db.serviceTicket }[kind];
    const row = model && Number.isInteger(subjectId) ? await model.findUnique({ where: { id: subjectId } }) : null;
    return (row?.updatedAt ?? new Date(0)).toISOString();
  };
  // Fill the reviewed parent version once per body, so deliberate replays resend identical input.
  const upload = async (input = body(), token = tokens.sales, expected = 201) => {
    if (!('expectedParentUpdatedAt' in input))
      input.expectedParentUpdatedAt = await parentVersion(input.subjectKind, input.subjectId);
    return call('/evidence-attachments', 'POST', input, token, expected);
  };
  const content = (row, token = tokens.sales, expected = 200, port = 4140) =>
    call('/evidence-attachments/' + row.id + '/content', 'GET', undefined, token, expected, port);
  const listing = (kind = 'projects', subjectId = active.id, token = tokens.sales) =>
    call('/evidence-attachments?subjectKind=' + kind + '&subjectId=' + subjectId, 'GET', undefined, token);
  const withdraw = async (row, token = tokens.sales, extra = {}, expected = 201) =>
    call(
      '/evidence-attachments/' + row.id + '/withdraw',
      'POST',
      {
        requestKey: randomUUID(),
        expectedUpdatedAt: row.updatedAt,
        expectedParentUpdatedAt: await parentVersion(row.subjectKind, row.subjectId),
        reason: '合成：原文件上传有误',
        ...extra,
      },
      token,
      expected,
    );
  await upload(body(), null, 401);
  await upload(body(), tokens.boss, 403);
  await upload(body(), tokens.outsider, 404);
  for (const extra of [
    { filename: '../a.pdf' },
    { filename: 'bad.html' },
    { contentBase64: 'not base64' },
    { acknowledged: false },
    { tenantId: tid + 1 },
    { subjectKind: 'customers' },
    { filename: 'a.png' },
    { contentBase64: Buffer.alloc(1024 * 1024 + 1).toString('base64') },
  ])
    await upload(body(extra), tokens.sales, 400);
  const requestBody = body(),
    uploadRow = await upload(requestBody),
    again = await upload(requestBody);
  ok(
    uploadRow.id === again.id && (await db.evidenceAttachment.count({ where: { tenantId: tid } })) === 1,
    'Identical upload retry stores exactly one binary',
  );
  await upload({ ...requestBody, filename: 'different.pdf' }, tokens.sales, 409);
  const list = await listing();
  ok(
    list.length === 1 &&
      !JSON.stringify(list).includes(pdf.toString('base64')) &&
      !Object.hasOwn(list[0], 'contentBytes'),
    'Listing is explicit metadata without binary',
  );
  const downloaded = await content(uploadRow);
  ok(
    Buffer.from(downloaded.contentBase64, 'base64').equals(pdf) && downloaded.sha256 === uploadRow.sha256,
    'Exact original bytes and SHA256 preserved',
  );
  const raw = await fetch('http://127.0.0.1:4140/api/v1/evidence-attachments/' + uploadRow.id + '/content', {
    headers: { Authorization: 'Bearer ' + tokens.sales },
  });
  ok(
    raw.headers.get('x-content-type-options') === 'nosniff' && raw.headers.get('cache-control') === 'no-store',
    'Download responses forbid content sniffing and caching',
  );
  await content(uploadRow, null, 401);
  await content(uploadRow, tokens.outsider, 404);
  await content(uploadRow, tokens.boss);
  await withdraw(uploadRow, tokens.manager, {}, 403);
  const auditor = await db.user.findFirst({ where: { tenantId: tid, username: 'admin' } });
  const other = await db.tenant.create({ data: { code: 'EVIDENCEOTHER', name: '另一合成企业' } });
  const foreign = await db.evidenceAttachment.create({
    data: {
      tenantId: other.id,
      subjectKind: 'projects',
      subjectId: active.id,
      filename: 'foreign.pdf',
      mediaType: 'application/pdf',
      size: pdf.length,
      sha256: uploadRow.sha256,
      contentBytes: pdf,
      createdBy: users.sales.id,
    },
  });
  await content(foreign, admin, 404);
  // A forged/degraded active role must not use an already-issued JWT to read retained evidence.
  const role = await db.role.findFirst({ where: { tenantId: tid, code: 'sales' } });
  const originalPermissions = role.permissions;
  await db.role.update({ where: { id: role.id }, data: { permissions: ['customer:read'] } });
  await content(uploadRow, tokens.sales, 403);
  await upload(requestBody, tokens.sales, 403);
  await db.role.update({ where: { id: role.id }, data: { permissions: originalPermissions } });
  // Review and completed objects freeze mutation while retaining readable proof.
  await db.project.update({ where: { id: active.id }, data: { acceptanceState: 'pending' } });
  await upload(body(), tokens.sales, 409);
  await withdraw(uploadRow, tokens.sales, {}, 409);
  await content(uploadRow);
  await db.project.update({ where: { id: active.id }, data: { acceptanceState: 'not_requested' } });
  const taskFile = await upload(body({ subjectKind: 'tasks', subjectId: task.id }));
  await call(
    '/workspace/tasks/' + task.id + '/complete',
    'POST',
    {
      requestKey: randomUUID(),
      expectedUpdatedAt: task.updatedAt.toISOString(),
      note: '旧页面不能跳过新增证据',
      actualHours: '1.0',
    },
    tokens.sales,
    409,
  );
  const taskNow = await db.projectTask.findUnique({ where: { id: task.id } });
  await call(
    '/workspace/tasks/' + task.id + '/complete',
    'POST',
    {
      requestKey: randomUUID(),
      expectedUpdatedAt: taskNow.updatedAt.toISOString(),
      note: '合成完成，附证据',
      actualHours: '1.0',
    },
    tokens.sales,
    201,
  );
  const taskEvent = await db.deliveryEvent.findFirst({
    where: { tenantId: tid, taskId: task.id, kind: 'task.complete' },
  });
  ok(
    taskEvent.evidence.attachments.some((a) => a.id === taskFile.id && a.sha256 === taskFile.sha256),
    'Task completion seals attachment ID/hash in immutable event',
  );
  // A cross-department executor of another task gains project read, but not this task or its evidence.
  const sideTask = await db.projectTask.create({
    data: {
      tenantId: tid,
      projectId: active.id,
      title: '合成跨部门任务',
      assigneeId: users.outsider.id,
      status: 'in_progress',
    },
  });
  await call('/workspace/tasks/' + task.id, 'GET', undefined, tokens.outsider, 404);
  const sealed = (detail) =>
    detail.related.deliveryEvents.find((e) => e.taskId === task.id && e.kind === 'task.complete');
  const outsiderView = sealed(await call('/workspace/projects/' + active.id, 'GET', undefined, tokens.outsider));
  ok(
    outsiderView.evidence.attachments.length === 0 &&
      outsiderView.evidence.attachmentsWithheld === 1 &&
      !JSON.stringify(outsiderView).includes(taskFile.sha256) &&
      !JSON.stringify(outsiderView).includes('合成验收证据'),
    'Project history withholds attachment metadata of tasks the reader cannot open',
  );
  ok(
    sealed(await call('/workspace/projects/' + active.id, 'GET', undefined, tokens.sales)).evidence.attachments.some(
      (a) => a.id === taskFile.id,
    ),
    'Task owner still sees sealed attachment metadata in project history',
  );
  await db.projectTask.update({ where: { id: sideTask.id }, data: { deletedAt: new Date() } });
  await upload(body({ subjectKind: 'tasks', subjectId: task.id }), tokens.sales, 409);
  await db.projectMilestone.create({
    data: {
      tenantId: tid,
      projectId: active.id,
      name: '合成完成里程碑',
      sortOrder: 1,
      stage: 'acceptance',
      plannedDate: new Date('2026-01-02'),
      status: 'completed',
      ownerId: users.sales.id,
    },
  });
  const activeNow = await db.project.findUnique({ where: { id: active.id } });
  const reviewedRound = activeNow.updatedAt.toISOString();
  await call(
    '/workspace/projects/' + active.id + '/request_acceptance',
    'POST',
    { requestKey: randomUUID(), expectedUpdatedAt: activeNow.updatedAt.toISOString(), note: '合成提交项目验收' },
    tokens.sales,
    201,
  );
  const acceptance = await db.deliveryEvent.findFirst({
    where: { tenantId: tid, projectId: active.id, kind: 'acceptance.requested' },
  });
  ok(
    acceptance.evidence.attachments.some((a) => a.id === uploadRow.id && a.sha256 === uploadRow.sha256),
    'Project acceptance seals exact project evidence metadata',
  );
  await withdraw(uploadRow, admin, {}, 409);
  const pending = await db.project.findUnique({ where: { id: active.id } });
  await call(
    '/workspace/projects/' + active.id + '/reject_acceptance',
    'POST',
    { requestKey: randomUUID(), expectedUpdatedAt: pending.updatedAt.toISOString(), note: '合成拒收整改' },
    tokens.manager,
    201,
  );
  // Requests prepared before submission must not land in the rework round after rejection.
  await upload(body({ expectedParentUpdatedAt: reviewedRound }), tokens.sales, 409);
  await withdraw(uploadRow, tokens.sales, { expectedParentUpdatedAt: reviewedRound }, 409);
  ok(
    (await db.evidenceAttachment.findUnique({ where: { id: uploadRow.id } })).withdrawnAt === null,
    'Stale parent version rejects delayed upload and withdrawal after a review round',
  );
  const withdrawn = await withdraw(uploadRow);
  ok(
    !!withdrawn.withdrawnAt && (await db.evidenceAttachment.count({ where: { id: uploadRow.id } })) === 1,
    'Withdrawal retains original blob and hash',
  );
  await content(uploadRow, tokens.sales, 403);
  await content(uploadRow, admin);
  await withdraw(withdrawn, tokens.sales, {}, 409);
  // Ticket files are frozen by solution submission and included in its immutable evidence.
  let row = await call(
    '/service-tickets',
    'POST',
    {
      requestKey: randomUUID(),
      projectId: p.id,
      title: '合成附件售后',
      description: '合成问题，上传处理证据',
      priority: 'medium',
    },
    tokens.sales,
    201,
  );
  const tc = async (action, token = tokens.sales, extra = {}) =>
    (row = await call(
      '/service-tickets/' + row.id + '/' + action,
      'POST',
      { requestKey: randomUUID(), expectedUpdatedAt: row.updatedAt, note: '合成附件处理记录', ...extra },
      token,
      201,
    ));
  await tc('assign', tokens.sales, { userId: users.sales.id });
  await tc('start');
  const ticketFile = await upload(body({ subjectKind: 'service-tickets', subjectId: row.id }));
  await call(
    '/service-tickets/' + row.id + '/resolve',
    'POST',
    { requestKey: randomUUID(), expectedUpdatedAt: row.updatedAt, note: '旧页面需先核对新增文件' },
    tokens.sales,
    409,
  );
  row = await call('/service-tickets/' + row.id, 'GET', undefined, tokens.sales);
  await tc('resolve');
  const solution = await db.serviceTicketEvent.findFirst({
    where: { tenantId: tid, ticketId: row.id, kind: 'resolve' },
  });
  ok(
    solution.evidence.attachments.some((a) => a.id === ticketFile.id && a.sha256 === ticketFile.sha256),
    'Solution submission snapshots attachment evidence',
  );
  await upload(body({ subjectKind: 'service-tickets', subjectId: row.id }), tokens.sales, 409);
  await withdraw(ticketFile, admin, {}, 409);
  await tc('close', tokens.manager);
  // Fault after blob insertion and command receipt must leave neither success state nor consumed quota.
  const faultBody = body(),
    counts = {
      files: await db.evidenceAttachment.count(),
      commands: await db.commandExecution.count(),
      audit: await db.auditLog.count(),
    };
  query(
    "CREATE TRIGGER fixture_attachment_rollback BEFORE INSERT ON audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic late attachment audit failure'",
  );
  try {
    await upload(faultBody, tokens.sales, 500);
  } finally {
    query('DROP TRIGGER fixture_attachment_rollback');
  }
  ok(
    (await db.evidenceAttachment.count()) === counts.files &&
      (await db.commandExecution.count()) === counts.commands &&
      (await db.auditLog.count()) === counts.audit,
    'Late audit failure rolls back blob, quota and durable receipt',
  );
  const retried = await upload(faultBody);
  await content(retried);
  // Corruption is refused rather than returning altered bytes as the original evidence.
  await db.evidenceAttachment.update({ where: { id: retried.id }, data: { contentBytes: Buffer.from('corrupted') } });
  await content(retried, tokens.sales, 409);
  await db.evidenceAttachment.update({ where: { id: retried.id }, data: { contentBytes: pdf } });
  const beforeAudit = JSON.stringify(await db.auditLog.findMany({ where: { tenantId: tid } })),
    beforeCommands = JSON.stringify(await db.commandExecution.findMany({ where: { tenantId: tid } }));
  ok(
    !beforeAudit.includes(pdf.toString('base64')) && !beforeCommands.includes(pdf.toString('base64')),
    'No binary is duplicated into audit or command receipts',
  );
  const capped = await db.project.create({
    data: {
      tenantId: tid,
      projectNo: 'SYNTHETIC-COUNT-CAP',
      name: '合成附件条数上限',
      customerId: customer.id,
      pmId: users.sales.id,
      salesOwnerId: users.sales.id,
      status: 'active',
      actualStartDate: new Date(),
      plannedStartDate: new Date('2026-01-01'),
      plannedEndDate: new Date('2026-01-02'),
    },
  });
  await db.evidenceAttachment.createMany({
    data: Array.from({ length: 100 }, () => ({
      tenantId: tid,
      subjectKind: 'projects',
      subjectId: capped.id,
      filename: 'count-fixture.pdf',
      mediaType: 'application/pdf',
      size: pdf.length,
      sha256: uploadRow.sha256,
      contentBytes: pdf,
      createdBy: users.sales.id,
    })),
  });
  ok(
    (await listing('projects', capped.id)).length === 100,
    'All100 retained object records are visible without truncation',
  );
  await upload(body({ subjectId: capped.id }), tokens.sales, 409);
  // Fill with truthful, explicit synthetic blobs: concurrent uploads cannot exceed retained quota.
  const big = Buffer.alloc(1024 * 1024, 32);
  big.write('%PDF-1.7\n');
  const { createHash } = await import('node:crypto');
  const sha = createHash('sha256').update(big).digest('hex');
  for (let i = 0; i < 15; i++)
    await db.evidenceAttachment.create({
      data: {
        tenantId: tid,
        subjectKind: 'projects',
        subjectId: active.id,
        filename: 'synthetic-capacity-' + i + '.pdf',
        mediaType: 'application/pdf',
        size: big.length,
        sha256: sha,
        contentBytes: big,
        createdBy: auditor.id,
      },
    });
  const medium = Buffer.alloc(600 * 1024, 32);
  medium.write('%PDF-1.7\n');
  // Separate parents, so only the shared enterprise quota (not the parent version) can reject one.
  const sibling = await db.project.create({
    data: {
      tenantId: tid,
      projectNo: 'SYNTHETIC-QUOTA-SIBLING',
      name: '合成配额并发项目',
      customerId: customer.id,
      pmId: users.sales.id,
      salesOwnerId: users.sales.id,
      status: 'active',
      actualStartDate: new Date(),
      plannedStartDate: new Date('2026-01-01'),
      plannedEndDate: new Date('2026-01-02'),
    },
  });
  const concurrentBodies = [];
  for (const [i, subjectId] of [
    [1, active.id],
    [2, sibling.id],
  ])
    concurrentBodies.push({
      ...body({ subjectId, filename: 'concurrent-' + i + '.pdf', contentBase64: medium.toString('base64') }),
      expectedParentUpdatedAt: await parentVersion('projects', subjectId),
    });
  const concurrent = await Promise.all(
    concurrentBodies.map(async (input) => {
      const r = await fetch('http://127.0.0.1:4140/api/v1/evidence-attachments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokens.sales },
        body: JSON.stringify(input),
      });
      return r.status;
    }),
  );
  ok(concurrent.sort().join(',') === '201,409', 'Concurrent retained quota admits exactly one upload');
  ok(
    (await db.evidenceAttachment.aggregate({ where: { tenantId: tid }, _sum: { size: true } }))._sum.size <=
      16 * 1024 * 1024,
    'Enterprise historical retention never exceeds16MiB',
  );
  const run = (args) => {
    const r = spawnSync(process.execPath, args, { env: { ...env, DB_TRANSPORT: 'native' }, encoding: 'utf8' });
    if (r.status !== 0) throw Error((r.stderr ?? '').slice(-1000));
    return r.stdout;
  };
  const file = join(scratch, 'service.crmbackup');
  run(['deploy/data.mjs', 'backup', file]);
  const cloneName = 'tb_crm_restore_evidence_' + Date.now(),
    restored = JSON.parse(run(['deploy/data.mjs', 'restore', file, cloneName]));
  ok(restored.promoted === false, 'Recovery never promotes or overwrites source');
  const cloneUrl = new URL(env.DATABASE_URL);
  cloneUrl.pathname = '/' + cloneName;
  cloneDb = new PrismaClient({ datasources: { db: { url: cloneUrl.href } } });
  for (const model of [
    'serviceTicket',
    'serviceTicketEvent',
    'commandExecution',
    'auditLog',
    'notification',
    'evidenceAttachment',
    'deliveryEvent',
  ]) {
    assert.deepEqual(
      await cloneDb[model].findMany({ orderBy: { id: 'asc' } }),
      await db[model].findMany({ orderBy: { id: 'asc' } }),
    );
    checks++;
  }
  const recovered = parseEnv(await readFile(restored.configPath, 'utf8'));
  cloneApi = spawn(process.execPath, ['apps/api/dist/main.js'], {
    env: { ...env, ...recovered, DATABASE_URL: cloneUrl.href, PORT: '4141', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  cloneApi.stdout.on('data', (v) => {
    log = (log + v).slice(-5000);
  });
  cloneApi.stderr.on('data', (v) => {
    log = (log + v).slice(-5000);
  });
  await ready(4141);
  await call('/service-tickets', 'GET', undefined, admin, 401, 4141);
  const clonedToken = await login('admin', env.TENANT_CODE, 4141),
    cloned = await call('/service-tickets/' + row.id, 'GET', undefined, clonedToken, 200, 4141);
  ok(cloned.status === 'closed', 'Recovered authenticated API preserves closed solution');
  const recoveredFile = await content(ticketFile, clonedToken, 200, 4141);
  ok(
    Buffer.from(recoveredFile.contentBase64, 'base64').equals(pdf) && recoveredFile.sha256 === ticketFile.sha256,
    'Private binary survives encrypted backup and restored authorized download',
  );
  console.log(
    JSON.stringify({
      checks,
      privateAttachments: true,
      scopedDownload: true,
      frozenReview: true,
      evidenceSnapshots: true,
      retainedWithdrawal: true,
      concurrencyQuota: true,
      atomicRollback: true,
      binaryIntegrity: true,
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
