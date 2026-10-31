import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeProduction } from '../deploy/initialize-production.mjs';
assert.equal(process.env.SMOKE_ALLOW_WRITES, 'true');
assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/tb_crm_test_[a-z0-9_]+$/);
const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const env = {
  ...process.env,
  DEMO_MODE: 'false',
  TENANT_CODE: 'IDENTITYTEST',
  TENANT_NAME: '身份闭环合成测试企业',
  ADMIN_USERNAME: 'admin',
  SEED_ADMIN_PASSWORD: 'Identity-Test-Password-2026',
  APP_URL: 'http://localhost:3000',
  JWT_SECRET: randomBytes(32).toString('hex'),
  ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  BACKUP_KEY: randomBytes(32).toString('hex'),
};
await initializeProduction(db, env);
const api = spawn(process.execPath, ['apps/api/dist/main.js'], {
  env: { ...env, HOST: '127.0.0.1', PORT: '4096' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '',
  checks = 0;
api.stdout.on('data', (d) => {
  log = (log + d).slice(-10000);
});
api.stderr.on('data', (d) => {
  log = (log + d).slice(-10000);
});
const ok = (value, label) => {
  assert(value, label);
  checks++;
};
const base = 'http://127.0.0.1:4096/api/v1';
async function call(path, method = 'GET', data, token, expected = 200) {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(20000),
  });
  const out = await r.json();
  if (expected !== null)
    ok(r.status === expected, method + ' ' + path + ' expected ' + expected + ' got ' + r.status + ' ' + out.message);
  return { status: r.status, data: out.data, body: out };
}
const pw = 'Staff-Test-Password-2026';
const login = async (username, password = pw, expected = 200, tenantCode = env.TENANT_CODE) =>
  (await call('/auth/login', 'POST', { tenantCode, username, password }, undefined, expected)).data;
const command = (data, row) => ({
  requestKey: randomUUID(),
  ...(row ? { expectedUpdatedAt: row.updatedAt } : {}),
  data,
});
let admin;
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (api.exitCode !== null) throw Error(log);
    try {
      ready = (await fetch(base + '/health')).ok;
    } catch {}
    if (ready) break;
    await delay(200);
  }
  ok(ready, 'API starts');
  const owner = await login('admin', env.SEED_ADMIN_PASSWORD);
  admin = owner.accessToken;
  const roles = (await call('/system/roles', 'GET', undefined, admin)).data;
  const role = (code) => roles.find((r) => r.code === code).id;
  const dept = (await call('/system/departments', 'POST', command({ name: '销售测试部', code: 'SALES' }), admin, 201))
    .data;
  const createBody = command({
    username: 'staff',
    name: '合成销售',
    password: pw,
    deptId: dept.id,
    roleIds: [role('sales')],
  });
  let staff = (await call('/system/users', 'POST', createBody, admin, 201)).data;
  const replay = (await call('/system/users', 'POST', createBody, admin, 201)).data;
  ok(replay.id === staff.id, 'Create idempotency');
  ok((await db.user.count({ where: { username: 'staff' } })) === 1, 'No duplicate user');
  ok(!JSON.stringify(staff).includes('passwordHash'), 'No password hash in user response');
  const manager = (
    await call(
      '/system/users',
      'POST',
      command({
        username: 'manager',
        name: '合成主管',
        password: pw,
        deptId: dept.id,
        roleIds: [role('sales_manager')],
      }),
      admin,
      201,
    )
  ).data;
  const boss = (
    await call(
      '/system/users',
      'POST',
      command({ username: 'boss', name: '合成老板', password: pw, roleIds: [role('gm')] }),
      admin,
      201,
    )
  ).data;
  const staffLogin = await login('staff'),
    managerLogin = await login('manager'),
    bossLogin = await login('boss');
  await call('/system/users', 'GET', undefined, staffLogin.accessToken, 403);
  await call('/system/departments', 'POST', command({ name: '非法部门' }), managerLogin.accessToken, 403);
  await call('/system/roles/' + role('super_admin'), 'PUT', { code: 'changed' }, admin, 503);
  await call('/workspace/customers', 'POST', command({ name: '禁止老板写入' }), bossLogin.accessToken, 403);
  const own = (await call('/auth/me', 'GET', undefined, admin)).data;
  const tenantId = (await db.user.findUniqueOrThrow({ where: { id: own.id } })).tenantId;
  await call('/system/users/' + own.id, 'PUT', command({ status: 'inactive' }, own), admin, 409);
  await call('/system/users/' + own.id, 'PUT', command({ roleIds: [role('sales')] }, own), admin, 409);
  await call(
    '/system/users',
    'POST',
    { ...command({ username: 'injected', name: '注入', password: pw, roleIds: [role('sales')] }), tenantId: 999 },
    admin,
    400,
  );
  await call(
    '/system/users',
    'POST',
    command({ username: 'weak', name: '弱口令', password: '12345', roleIds: [role('sales')] }),
    admin,
    400,
  );
  const foreign = await db.tenant.create({ data: { code: 'FOREIGNTEST', name: '异企业合成测试', status: 'active' } });
  const foreignRole = await db.role.create({
    data: { tenantId: foreign.id, code: 'sales', name: '异企业角色', dataScope: 'self' },
  });
  const foreignDept = await db.department.create({ data: { tenantId: foreign.id, name: '异企业部门' } });
  await call(
    '/system/users',
    'POST',
    command({ username: 'crossrole', name: '跨企业', password: pw, roleIds: [foreignRole.id] }),
    admin,
    400,
  );
  await call(
    '/system/users',
    'POST',
    command({ username: 'crossdept', name: '跨企业', password: pw, deptId: foreignDept.id, roleIds: [role('sales')] }),
    admin,
    400,
  );
  ok(
    (await db.user.count({ where: { username: { in: ['crossrole', 'crossdept', 'weak', 'injected'] } } })) === 0,
    'Invalid creates roll back entirely',
  );
  await call('/system/departments', 'POST', command({ name: '非法父级', parentId: foreignDept.id }), admin, 400);
  await call('/system/users', 'POST', null, admin, 400);
  await call(
    '/system/users',
    'POST',
    command({ username: 'bademail', name: '错误类型', password: pw, email: false, roleIds: [role('sales')] }),
    admin,
    400,
  );
  await call(
    '/system/users',
    'POST',
    command({ username: 'mixedroles', name: '混用角色', password: pw, roleIds: [role('sales'), role('gm')] }),
    admin,
    400,
  );
  await call('/system/departments', 'POST', command({ name: '重复编码', code: 'SALES' }), admin, 409);
  await call(
    '/system/users/' + staff.id,
    'PUT',
    command({ status: ['active'] }, (await call('/system/users/' + staff.id, 'GET', undefined, admin)).data),
    admin,
    400,
  );
  await call('/system/users?status=unknown', 'GET', undefined, admin, 400);
  const currentDept = (await call('/system/departments/tree', 'GET', undefined, admin)).data.find(
    (d) => d.id === dept.id,
  );
  await call('/system/departments/' + dept.id, 'PUT', command({ parentId: dept.id }, currentDept), admin, 400);
  await call('/system/departments/' + dept.id, 'PUT', command({ status: 0 }, currentDept), admin, 409);
  let fresh = (await call('/system/users/' + staff.id, 'GET', undefined, admin)).data;
  await call('/system/users/' + staff.id, 'PUT', command({ name: '更新后的合成销售' }, fresh), admin);
  await call('/system/users/' + staff.id, 'PUT', command({ name: '过期编辑' }, fresh), admin, 409);
  const resetPw = 'Reset-Staff-Password-2026';
  fresh = (await call('/system/users/' + staff.id, 'GET', undefined, admin)).data;
  await call(
    '/system/users/' + staff.id + '/reset-password',
    'POST',
    command({ password: resetPw }, fresh),
    admin,
    201,
  );
  await call('/auth/me', 'GET', undefined, staffLogin.accessToken, 401);
  await call('/auth/refresh', 'POST', { refreshToken: staffLogin.refreshToken }, undefined, 401);
  await login('staff', pw, 401);
  const resetLogin = await login('staff', resetPw);
  const me = (await call('/auth/me', 'GET', undefined, resetLogin.accessToken)).data;
  await call(
    '/auth/password',
    'POST',
    {
      requestKey: randomUUID(),
      expectedUpdatedAt: me.updatedAt,
      currentPassword: 'wrong',
      newPassword: 'New-Staff-Password-2026',
    },
    resetLogin.accessToken,
    403,
  );
  const newPw = 'New-Staff-Password-2026';
  await call(
    '/auth/password',
    'POST',
    { requestKey: randomUUID(), expectedUpdatedAt: me.updatedAt, currentPassword: resetPw, newPassword: newPw },
    resetLogin.accessToken,
  );
  await call('/auth/me', 'GET', undefined, resetLogin.accessToken, 401);
  const one = await login('staff', newPw),
    two = await login('staff', newPw);
  const sessions = (await call('/auth/sessions', 'GET', undefined, one.accessToken)).data;
  ok(sessions.some((s) => s.current) && sessions.length === 2, 'Only own active sessions');
  ok(!JSON.stringify(sessions).includes('refreshHash'), 'No refresh hash exposed');
  await call('/auth/logout', 'POST', {}, one.accessToken);
  await call('/auth/me', 'GET', undefined, one.accessToken, 401);
  await call('/auth/me', 'GET', undefined, two.accessToken);
  const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
  apiRequire('reflect-metadata');
  const { PrismaService } = apiRequire('./dist/database/prisma.service.js');
  const { runCommand } = apiRequire('./dist/modules/workspace/command-runner.js');
  const commandDb = new PrismaService();
  try {
    for (const [token, roles] of [
      [one.accessToken, ['sales']],
      [two.accessToken, ['super_admin']],
      [two.accessToken, ['sales']],
    ]) {
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
      let executed = false;
      await assert.rejects(
        runCommand(
          commandDb,
          {
            userId: staff.id,
            tenantId: claims.tid,
            deptId: dept.id,
            roles,
            permissions: ['*'],
            dataScope: 'all',
            sessionId: claims.sid,
          },
          'identity.test.stale',
          { requestKey: randomUUID() },
          async () => {
            executed = true;
            return {};
          },
        ),
      );
      checks++;
      ok(!executed, 'Revoked session or stale actor blocked inside write transaction before work');
    }
  } finally {
    await commandDb.$disconnect();
  }

  await call('/auth/sessions/revoke-all', 'POST', {}, two.accessToken);
  await call('/auth/me', 'GET', undefined, two.accessToken, 401);
  const rotation = await login('staff', newPw);
  const rotated = (await call('/auth/refresh', 'POST', { refreshToken: rotation.refreshToken })).data;
  ok(rotated.refreshToken !== rotation.refreshToken, 'Refresh token rotates');
  await call('/auth/me', 'GET', undefined, rotated.accessToken);
  await call('/auth/refresh', 'POST', { refreshToken: rotation.refreshToken }, undefined, 401);
  await call('/auth/me', 'GET', undefined, rotated.accessToken, 401);
  const concurrent = await login('staff', newPw);
  const results = await Promise.all([
    call('/auth/refresh', 'POST', { refreshToken: concurrent.refreshToken }, undefined, null),
    call('/auth/refresh', 'POST', { refreshToken: concurrent.refreshToken }, undefined, null),
  ]);
  ok(
    results
      .map((r) => r.status)
      .sort()
      .join() === '200,401',
    'Concurrent refresh has one winner and one rejected replay',
  );
  await call('/auth/me', 'GET', undefined, results.find((r) => r.status === 200).data.accessToken, 401);
  const expiring = await login('staff', newPw);
  const sid = JSON.parse(Buffer.from(expiring.accessToken.split('.')[1], 'base64url')).sid;
  await db.authSession.update({ where: { id: sid }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await call('/auth/me', 'GET', undefined, expiring.accessToken, 401);
  const beforeDisable = await login('staff', newPw);
  fresh = (await call('/system/users/' + staff.id, 'GET', undefined, admin)).data;
  await call('/system/users/' + staff.id, 'PUT', command({ status: 'inactive' }, fresh), admin);
  await call('/auth/me', 'GET', undefined, beforeDisable.accessToken, 401);
  await login('staff', newPw, 403);
  fresh = (await call('/system/users/' + staff.id, 'GET', undefined, admin)).data;
  await call('/system/users/' + staff.id, 'PUT', command({ status: 'active' }, fresh), admin);
  const reactivated = await login('staff', newPw);
  await call('/auth/me', 'GET', undefined, reactivated.accessToken);
  fresh = (await call('/system/users/' + staff.id, 'GET', undefined, admin)).data;
  await call('/system/users/' + staff.id, 'PUT', command({ roleIds: [role('gm')] }, fresh), admin);
  await call('/auth/me', 'GET', undefined, reactivated.accessToken, 401);
  let nowBoss = await login('staff', newPw);
  await call('/workspace/customers', 'POST', command({ name: '角色撤销后禁止写入' }), nowBoss.accessToken, 403);
  for (let i = 0; i < 8; i++) await login(i % 2 ? 'STAFF' : 'staff', 'Wrong-Password-2026', 401);
  await login('staff', newPw, 429);
  await login('admin', env.SEED_ADMIN_PASSWORD);
  const lockedUser = (await call('/system/users/' + staff.id, 'GET', undefined, admin)).data;
  await call(
    '/system/users/' + staff.id + '/reset-password',
    'POST',
    command({ password: newPw }, lockedUser),
    admin,
    201,
  );
  nowBoss = await login('staff', newPw);
  await db.authAttempt.updateMany({ data: { windowStartedAt: new Date(Date.now() - 16 * 60000) } });
  await login('staff', newPw);
  const otherDept = (await call('/system/departments', 'POST', command({ name: '交接测试部' }), admin, 201)).data;
  let d = (await call('/system/departments/tree', 'GET', undefined, admin)).data.find((x) => x.id === dept.id);
  await call('/system/departments/' + dept.id, 'PUT', command({ leaderId: manager.id }, d), admin);
  let m = (await call('/system/users/' + manager.id, 'GET', undefined, admin)).data;
  const pending = await db.approval.create({
    data: {
      tenantId,
      approvalNo: 'IDENTITY-PENDING',
      bizType: 'test',
      bizId: 1,
      title: '合成审批阻断测试',
      applicantId: own.id,
      nodes: {
        create: {
          tenantId,
          nodeOrder: 1,
          nodeName: '待处理',
          approverId: manager.id,
        },
      },
    },
  });
  await call('/system/users/' + manager.id, 'PUT', command({ deptId: otherDept.id }, m), admin, 409);
  await db.approval.update({ where: { id: pending.id }, data: { status: 'withdrawn' } });
  await call('/system/users/' + manager.id, 'PUT', command({ deptId: otherDept.id }, m), admin);
  ok(
    (await db.department.findUniqueOrThrow({ where: { id: dept.id } })).leaderId === null,
    'Transferred leader pointer cleared',
  );
  await call('/auth/me', 'GET', undefined, managerLogin.accessToken, 401);
  const audit = JSON.stringify(await db.auditLog.findMany()),
    executions = JSON.stringify(await db.commandExecution.findMany());
  for (const secret of [pw, newPw, resetPw, rotation.refreshToken, rotated.accessToken])
    ok(
      !audit.includes(secret) && !executions.includes(secret),
      'Credentials excluded from audit and idempotency results',
    );
  const schema = (await call('/auth/capabilities', 'GET', undefined, nowBoss.accessToken)).data;
  ok(
    schema.every((c) => c.permission === 'authenticated') &&
      schema.every((c) => c.version === '1.0' && c.inputSchema && c.outputSchema),
    'Capabilities filtered and versioned',
  );
  const secondAdmin = (
    await call(
      '/system/users',
      'POST',
      command({ username: 'admin2', name: '第二合成管理员', password: pw, roleIds: [role('super_admin')] }),
      admin,
      201,
    )
  ).data;
  const otherAdmin = await login('admin2');
  const firstRow = (await call('/system/users/' + own.id, 'GET', undefined, admin)).data;
  const secondRow = (await call('/system/users/' + secondAdmin.id, 'GET', undefined, admin)).data;
  const collisions = await Promise.all([
    call('/system/users/' + secondAdmin.id, 'PUT', command({ status: 'inactive' }, secondRow), admin, null),
    call('/system/users/' + own.id, 'PUT', command({ status: 'inactive' }, firstRow), otherAdmin.accessToken, null),
  ]);
  ok(
    collisions.some((r) => r.status === 200) && collisions.some((r) => [401, 403, 409].includes(r.status)),
    'Concurrent mutual-disable cannot remove both administrators',
  );
  ok(
    (await db.user.count({
      where: {
        tenantId,
        status: 'active',
        roles: { some: { roleId: role('super_admin') } },
      },
    })) >= 1,
    'At least one administrator remains',
  );
  console.log(
    JSON.stringify({
      checks,
      companyIsolation: true,
      accountLifecycle: true,
      atomicRoles: true,
      sessionRevocation: true,
      refreshRotationReplay: true,
      persistentCaseInsensitiveThrottle: true,
      passwordChangeReset: true,
      departmentHandover: true,
      lastAdminConcurrency: true,
      noCredentialsInAudit: true,
    }),
  );
} catch (e) {
  console.error(log.slice(-1500));
  throw e;
} finally {
  api.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => api.once('exit', resolve)), delay(3000)]);
  await db.$disconnect();
}
