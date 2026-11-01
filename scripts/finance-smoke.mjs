import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeProduction } from '../deploy/initialize-production.mjs';
assert.equal(process.env.SMOKE_ALLOW_WRITES, 'true');
assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/tb_crm_test_[a-z0-9_]+$/);
const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
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
  TENANT_CODE: 'FINANCETEST',
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
  env: { ...env, PORT: '4116', HOST: '127.0.0.1' },
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
  const r = await fetch('http://127.0.0.1:4116/api/v1' + path, {
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
  for (let i = 0; i < 100; i++) {
    if (api.exitCode !== null) throw Error(log);
    try {
      ready = (await fetch('http://127.0.0.1:4116/api/v1/health')).ok;
    } catch {}
    if (ready) break;
    await delay(200);
  }
  ok(ready, 'API ready');
  admin = await login('admin', env.SEED_ADMIN_PASSWORD);
  const roles = (await call('/system/roles', 'GET', undefined, admin)).data;
  const tid = (await db.tenant.findUniqueOrThrow({ where: { code: env.TENANT_CODE } })).id;
  const dept = (await call('/system/departments', 'POST', req({ name: '合成销售部' }), admin, 201)).data;
  const users = {};
  for (const [username, roleCode, deptId] of [
    ['admin2', 'super_admin', null],
    ['sales', 'sales', dept.id],
    ['peer', 'sales', dept.id],
    ['manager', 'sales_manager', dept.id],
    ['boss', 'gm', null],
  ]) {
    users[username] = (
      await call(
        '/system/users',
        'POST',
        req({
          username,
          name: '合成' + username,
          password: pw,
          deptId,
          roleIds: [roles.find((r) => r.code === roleCode).id],
        }),
        admin,
        201,
      )
    ).data;
  }
  const admin2 = await login('admin2');
  sales = await login('sales');
  peer = await login('peer');
  manager = await login('manager');
  boss = await login('boss');
  await flow('合同核准', 'contract', users.boss.id);
  const customer = await create('customers', { name: '核销合成客户' }),
    otherCustomer = await create('customers', { name: '其他合成客户' });
  const draft = await create('contracts', {
    name: '核销测试合同',
    customerId: customer.id,
    contractType: 'implementation',
    amount: '100.10',
  });
  const ledger = (r, t = admin) => call('/finance-ledger/receipts/' + r.id, 'GET', undefined, t).then((x) => x.data);
  const getPlan = async (c) => db.paymentPlan.findFirstOrThrow({ where: { tenantId: tid, contractId: c.id } });
  const regBody = (reference, amount = '60.10', cid = customer.id, contractId) => ({
    requestKey: randomUUID(),
    customerId: cid,
    ...(contractId ? { contractId } : {}),
    amount,
    receiptDate: '2026-11-01',
    reference,
    note: '合成到账凭据，非真实银行数据',
  });
  const register = async (body, t = admin, expected = 201) =>
    (await call('/finance-ledger/receipts', 'POST', body, t, expected)).data;
  const action = async (r, name, extra = {}, t = admin, expected = 201) =>
    call(
      `/finance-ledger/receipts/${r.id}/${name}`,
      'POST',
      { requestKey: randomUUID(), expectedUpdatedAt: r.updatedAt, note: '合成台账处理', ...extra },
      t,
      expected,
    );
  await register(regBody('DRAFT', '1.00', customer.id, draft.id), admin, 409);
  const c = await sign(draft);
  const c2 = await sign(
    await create('contracts', {
      name: '同客户另一合同',
      customerId: customer.id,
      contractType: 'implementation',
      amount: '50.00',
    }),
  );
  const foreignCustomerContract = await sign(
    await create('contracts', {
      name: '其他客户合同',
      customerId: otherCustomer.id,
      contractType: 'implementation',
      amount: '30.00',
    }),
  );
  for (const t of [sales, manager, boss]) await register(regBody('DENY'), t, 403);
  await register({ ...regBody('ACTOR'), tenantId: tid }, admin, 400);
  await register({ ...regBody('NUMBER'), amount: 1 }, admin, 400);
  await register({ ...regBody('PRECISION'), amount: '1.001' }, admin, 400);
  await register({ ...regBody('DATE'), receiptDate: '2026-02-30' }, admin, 400);
  const body = regBody('LEDGER-001', '60.10', customer.id, c.id);
  const created = await register(body);
  const replay = await register(body);
  ok(created.id === replay.id, 'Register replay is stable');
  await register({ ...body, note: 'Changed replay' }, admin, 409);
  await register({ ...body, requestKey: randomUUID() }, admin, 409);
  await register({ ...regBody(' ＬＥＤＧＥＲ－００１ '), requestKey: randomUUID() }, admin, 409);
  let r = await ledger(created);
  ok(r.amount === '60.1' && r.unallocatedAmount === '60.1', 'Exact initial balances');
  let p = await getPlan(c);
  await action(
    r,
    'allocate',
    { paymentPlanId: p.id, expectedPlanUpdatedAt: p.updatedAt.toISOString(), amount: '0.10' },
    admin,
    409,
  );
  await action(r, 'confirm', {}, admin, 403);
  await action(r, 'confirm', {}, sales, 403);
  const confirmBody = { requestKey: randomUUID(), expectedUpdatedAt: r.updatedAt, note: '第二管理员核对合成凭据' };
  await call(`/finance-ledger/receipts/${r.id}/confirm`, 'POST', confirmBody, admin2, 201);
  await call(`/finance-ledger/receipts/${r.id}/confirm`, 'POST', confirmBody, admin2, 201);
  ok(
    (await db.financeEvent.count({ where: { tenantId: tid, receiptId: r.id, kind: 'confirmed' } })) === 1,
    'No duplicate confirmation event',
  );
  await call(
    `/finance-ledger/receipts/${r.id}/confirm`,
    'POST',
    { ...confirmBody, requestKey: randomUUID() },
    admin2,
    409,
  );
  r = await ledger(r);
  const pOther = await getPlan(foreignCustomerContract),
    pOtherContract = await getPlan(c2);
  await action(
    r,
    'allocate',
    { paymentPlanId: pOther.id, expectedPlanUpdatedAt: pOther.updatedAt.toISOString(), amount: '0.10' },
    admin,
    400,
  );
  await action(
    r,
    'allocate',
    { paymentPlanId: pOtherContract.id, expectedPlanUpdatedAt: pOtherContract.updatedAt.toISOString(), amount: '0.10' },
    admin,
    400,
  );
  await action(
    r,
    'allocate',
    { paymentPlanId: p.id, expectedPlanUpdatedAt: p.updatedAt.toISOString(), amount: '60.11' },
    admin,
    409,
  );
  const allocateBody = {
    requestKey: randomUUID(),
    expectedUpdatedAt: r.updatedAt,
    note: '首笔分摊0.10',
    paymentPlanId: p.id,
    expectedPlanUpdatedAt: p.updatedAt.toISOString(),
    amount: '0.10',
  };
  await call(`/finance-ledger/receipts/${r.id}/allocate`, 'POST', allocateBody, admin, 201);
  await call(`/finance-ledger/receipts/${r.id}/allocate`, 'POST', allocateBody, admin, 201);
  ok(
    (await db.receiptAllocation.count({ where: { receiptId: r.id, active: true } })) === 1,
    'Idempotency creates one allocation',
  );
  r = await ledger(r);
  p = await getPlan(c);
  ok(r.allocatedAmount === '0.1' && r.unallocatedAmount === '60', 'Decimal cent balance');
  ok(p.receivedAmount.eq('0.10') && p.outstandingAmount.eq('100.00'), 'Plan cent balance');
  ok((await db.contract.findUniqueOrThrow({ where: { id: c.id } })).totalReceived.eq('0.10'), 'Contract cent balance');
  await action(r, 'void', {}, admin, 409);
  await action(r, 'allocate', {
    paymentPlanId: p.id,
    expectedPlanUpdatedAt: p.updatedAt.toISOString(),
    amount: '50.00',
  });
  r = await ledger(r);
  p = await getPlan(c);
  ok(r.allocations.filter((x) => x.active).length === 2, 'Same pair supports distinct subsequent allocations');
  const first = r.allocations.find((x) => String(x.amount) === '0.1');
  const reverseBody = {
    requestKey: randomUUID(),
    expectedUpdatedAt: r.updatedAt,
    note: '更正首笔核销，非退款',
    allocationId: first.id,
    expectedPlanUpdatedAt: p.updatedAt.toISOString(),
  };
  await call(`/finance-ledger/receipts/${r.id}/reverse`, 'POST', reverseBody, admin, 201);
  await call(`/finance-ledger/receipts/${r.id}/reverse`, 'POST', reverseBody, admin, 201);
  r = await ledger(r);
  p = await getPlan(c);
  ok(r.allocatedAmount === '50' && r.unallocatedAmount === '10.1', 'Reversal restores exact receipt balance');
  ok(
    r.allocations.some((x) => x.id === first.id && !x.active && x.reverseReason),
    'Reversed original row retained',
  );
  await action(r, 'reverse', { allocationId: first.id, expectedPlanUpdatedAt: p.updatedAt.toISOString() }, admin, 409);
  await action(r, 'allocate', {
    paymentPlanId: p.id,
    expectedPlanUpdatedAt: p.updatedAt.toISOString(),
    amount: '0.10',
  });
  r = await ledger(r);
  ok(r.allocations.length === 3, 'Reallocation retains prior reversal history');
  for (const a of r.allocations.filter((x) => x.active)) {
    r = await ledger(r);
    p = await getPlan(c);
    await action(r, 'reverse', { allocationId: a.id, expectedPlanUpdatedAt: p.updatedAt.toISOString() });
  }
  r = await ledger(r);
  p = await getPlan(c);
  ok(
    r.allocatedAmount === '0' && r.unallocatedAmount === '60.1' && p.receivedAmount.eq(0),
    'Full reversal clears ledger allocations',
  );
  const finalContract = await db.contract.findUniqueOrThrow({ where: { id: c.id } });
  ok(
    finalContract.totalReceived.eq(0) && finalContract.totalOutstanding.eq('100.10'),
    'Full reversal restores contract balances',
  );
  await action(r, 'void');
  r = await ledger(r);
  ok(r.status === 'voided' && r.unallocatedAmount === '0', 'Voided receipt unavailable');
  await action(
    r,
    'allocate',
    { paymentPlanId: p.id, expectedPlanUpdatedAt: p.updatedAt.toISOString(), amount: '0.01' },
    admin,
    409,
  );
  await register({ ...body, requestKey: randomUUID() }, admin, 409);
  const raceRef = 'REG-RACE';
  const registers = await Promise.all([
    call('/finance-ledger/receipts', 'POST', regBody(raceRef), admin, null),
    call('/finance-ledger/receipts', 'POST', regBody(raceRef), admin, null),
  ]);
  ok(
    registers
      .map((x) => x.status)
      .sort()
      .join(',') === '201,409',
    'Duplicate registration race creates one receipt',
  );
  // Independent receipts compete for one plan; balance and plan version are checked atomically.
  const raceContract = await sign(
    await create('contracts', {
      name: '并发核销合同',
      customerId: customer.id,
      contractType: 'implementation',
      amount: '1.00',
    }),
  );
  const receipts = [];
  for (let i = 0; i < 2; i++) {
    let row = await ledger(await register(regBody('ALLOC-RACE-' + i, '1.00', customer.id, raceContract.id)));
    await action(row, 'confirm', {}, admin2);
    receipts.push(await ledger(row));
  }
  const racePlan = await getPlan(raceContract);
  const races = await Promise.all(
    receipts.map((row) =>
      action(
        row,
        'allocate',
        { paymentPlanId: racePlan.id, expectedPlanUpdatedAt: racePlan.updatedAt.toISOString(), amount: '1.00' },
        admin,
        null,
      ),
    ),
  );
  ok(
    races
      .map((x) => x.status)
      .sort()
      .join(',') === '201,409',
    'Only one concurrent allocation succeeds',
  );
  ok((await getPlan(raceContract)).receivedAmount.eq('1.00'), 'No over-allocation');
  ok(
    (await db.receiptAllocation.count({ where: { paymentPlanId: racePlan.id, active: true } })) === 1,
    'Losing command leaves no partial allocation',
  );
  // Tampered fixture balance must fail closed, rather than silently repair it.
  let mismatch = await ledger(await register(regBody('MISMATCH', '1.00', customer.id, c2.id)));
  await action(mismatch, 'confirm', {}, admin2);
  mismatch = await ledger(mismatch);
  await db.paymentPlan.update({ where: { id: pOtherContract.id }, data: { outstandingAmount: '49.99' } });
  const mismatchPlan = await getPlan(c2);
  await action(
    mismatch,
    'allocate',
    { paymentPlanId: mismatchPlan.id, expectedPlanUpdatedAt: mismatchPlan.updatedAt.toISOString(), amount: '0.01' },
    admin,
    409,
  );
  ok(
    (await db.receiptAllocation.count({ where: { receiptId: mismatch.id } })) === 0,
    'Reconciliation failure has no partial writes',
  );
  await db.paymentPlan.update({ where: { id: pOtherContract.id }, data: { outstandingAmount: '50.00' } });
  // Two plans compete for a single receipt; stale receipt versions cannot spend it twice.
  let shared = await ledger(await register(regBody('SHARED-RECEIPT', '1.00')));
  await action(shared, 'confirm', {}, admin2);
  shared = await ledger(shared);
  const sharedPlans = [await getPlan(c), await getPlan(c2)];
  const sharedRace = await Promise.all(
    sharedPlans.map((p) =>
      action(
        shared,
        'allocate',
        { paymentPlanId: p.id, expectedPlanUpdatedAt: p.updatedAt.toISOString(), amount: '0.75' },
        admin,
        null,
      ),
    ),
  );
  ok(
    sharedRace
      .map((x) => x.status)
      .sort()
      .join(',') === '201,409',
    'Only one concurrent use of receipt succeeds',
  );
  shared = await ledger(shared);
  ok(shared.allocatedAmount === '0.75' && shared.unallocatedAmount === '0.25', 'No double use of receipt balance');
  const sharedAllocation = shared.allocations.find((x) => x.active);
  const sharedPlan = await db.paymentPlan.findUniqueOrThrow({ where: { id: sharedAllocation.paymentPlanId } });
  const reverseRace = await Promise.all(
    [1, 2].map(() =>
      action(
        shared,
        'reverse',
        { allocationId: sharedAllocation.id, expectedPlanUpdatedAt: sharedPlan.updatedAt.toISOString() },
        admin,
        null,
      ),
    ),
  );
  ok(
    reverseRace
      .map((x) => x.status)
      .sort()
      .join(',') === '201,409',
    'Only one concurrent reversal succeeds',
  );
  shared = await ledger(shared);
  ok(shared.allocatedAmount === '0' && shared.unallocatedAmount === '1', 'Concurrent reversal restores only once');
  // A failure after financial rows were written must roll back all balances and command receipts.
  let rollback = await ledger(await register(regBody('ROLLBACK', '1.00', customer.id, c2.id)));
  await action(rollback, 'confirm', {}, admin2);
  rollback = await ledger(rollback);
  const rollbackPlan = await getPlan(c2);
  const rollbackBody = {
    requestKey: randomUUID(),
    expectedUpdatedAt: rollback.updatedAt,
    note: '故障回滚合成测试',
    paymentPlanId: rollbackPlan.id,
    expectedPlanUpdatedAt: rollbackPlan.updatedAt.toISOString(),
    amount: '0.50',
  };
  fixtureSql(
    `CREATE TRIGGER fixture_finance_rollback BEFORE INSERT ON finance_events FOR EACH ROW BEGIN IF NEW.kind = 'allocated' AND NEW.receipt_id = ${rollback.id} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic finance rollback'; END IF; END`,
  );
  try {
    await call(`/finance-ledger/receipts/${rollback.id}/allocate`, 'POST', rollbackBody, admin, 500);
  } finally {
    fixtureSql('DROP TRIGGER fixture_finance_rollback');
  }
  ok(
    (await ledger(rollback)).allocatedAmount === '0' && (await getPlan(c2)).receivedAmount.eq(0),
    'Receipt and plan roll back after late event failure',
  );
  ok(
    (await db.contract.findUniqueOrThrow({ where: { id: c2.id } })).totalReceived.eq(0),
    'Contract balance rolls back after late failure',
  );
  ok(
    (await db.receiptAllocation.count({ where: { receiptId: rollback.id } })) === 0,
    'Allocation insertion rolled back',
  );
  ok(
    (await db.commandExecution.count({ where: { tenantId: tid, requestKey: rollbackBody.requestKey } })) === 0,
    'Failed command not recorded as successful',
  );
  await call(`/finance-ledger/receipts/${rollback.id}/allocate`, 'POST', rollbackBody, admin, 201);
  rollback = await ledger(rollback);
  const recovered = rollback.allocations.find((x) => x.active);
  const recoveredPlan = await getPlan(c2);
  await action(rollback, 'reverse', {
    allocationId: recovered.id,
    expectedPlanUpdatedAt: recoveredPlan.updatedAt.toISOString(),
  });
  // Pending contractual changes freeze financial allocations and withdrawal releases the gate.
  await flow('合同变更核准', 'contract_change', users.boss.id);
  const guarded = await sign(
    await create('contracts', {
      name: '合同变更冻结核销',
      customerId: customer.id,
      contractType: 'implementation',
      amount: '10.00',
    }),
  );
  let guardedReceipt = await ledger(await register(regBody('GUARDED', '1.00', customer.id, guarded.id)));
  await action(guardedReceipt, 'confirm', {}, admin2);
  guardedReceipt = await ledger(guardedReceipt);
  const proposed = (
    await call(
      `/commercial/contracts/${guarded.id}/changes/preview`,
      'POST',
      { changeType: 'terms', data: { paymentTerms: '合成新条款' } },
      sales,
      201,
    )
  ).data;
  const pending = (
    await call(
      `/commercial/contracts/${guarded.id}/changes`,
      'POST',
      {
        requestKey: randomUUID(),
        expectedUpdatedAt: proposed.expectedUpdatedAt,
        changeType: 'terms',
        data: { paymentTerms: '合成新条款' },
        reason: '合成变更请求',
        form: {},
      },
      sales,
      201,
    )
  ).data;
  let guardedPlan = await getPlan(guarded);
  await action(
    guardedReceipt,
    'allocate',
    { paymentPlanId: guardedPlan.id, expectedPlanUpdatedAt: guardedPlan.updatedAt.toISOString(), amount: '1.00' },
    admin,
    409,
  );
  await call('/approvals/' + pending.approvalId + '/withdraw', 'POST', { requestKey: randomUUID() }, sales, 201);
  guardedPlan = await getPlan(guarded);
  await action(guardedReceipt, 'allocate', {
    paymentPlanId: guardedPlan.id,
    expectedPlanUpdatedAt: guardedPlan.updatedAt.toISOString(),
    amount: '1.00',
  });
  // Receipt-side corruption also fails closed.
  let badReceipt = await ledger(await register(regBody('BAD-RECEIPT', '1.00')));
  await action(badReceipt, 'confirm', {}, admin2);
  badReceipt = await ledger(badReceipt);
  await db.receipt.update({ where: { id: badReceipt.id }, data: { unallocatedAmount: '0.99' } });
  badReceipt = await ledger(badReceipt);
  const badPlan = await getPlan(c2);
  await action(
    badReceipt,
    'allocate',
    { paymentPlanId: badPlan.id, expectedPlanUpdatedAt: badPlan.updatedAt.toISOString(), amount: '0.10' },
    admin,
    409,
  );
  ok(
    (await db.receiptAllocation.count({ where: { receiptId: badReceipt.id } })) === 0,
    'Unbalanced receipt is not silently corrected',
  );
  // Read scopes, legacy protection and independent foreign tenant.
  await ledger(created, sales);
  await ledger(created, boss);
  await call('/finance-ledger/receipts/' + created.id, 'GET', undefined, peer, 404);
  const hidden = await create('customers', { name: '仅同事可见的客户' }, peer);
  const hiddenReceipt = await register(regBody('HIDDEN', '1.00', hidden.id));
  await call('/finance-ledger/receipts/' + hiddenReceipt.id, 'GET', undefined, sales, 404);
  const legacy = await db.receipt.create({
    data: {
      tenantId: tid,
      receiptNo: 'LEGACY',
      serialNo: ' LEGACY-ID ',
      customerId: customer.id,
      amount: '1.00',
      unallocatedAmount: '1.00',
      receiptDate: new Date(),
      status: 'draft',
    },
  });
  await action(await ledger(legacy), 'confirm', {}, admin2, 409);
  await register(regBody('ＬＥＧＡＣＹ－ＩＤ', '1.00'), admin, 409);
  const sharedDetail = (await call('/workspace/receipts/' + created.id, 'GET', undefined, sales)).data;
  ok(
    sharedDetail.related.allocations.length > 0 &&
      sharedDetail.related.financeEvents.some((e) => e.kind === 'allocation.reversed'),
    'Shared workspace read exposes scoped ledger evidence for existing read-only MCP adapter',
  );
  const mcpRead = await fetch('http://127.0.0.1:4116/api/v1/mcp', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + sales,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'workspace.get', arguments: { kind: 'receipts', recordId: created.id } },
    }),
  });
  ok(mcpRead.status === 200, 'MCP ledger read responds');
  const mcpResult = await mcpRead.json();
  ok(!mcpResult.result.isError, 'Authorized MCP ledger read succeeds');
  const mcpLedger = JSON.parse(mcpResult.result.content[0].text);
  ok(
    mcpLedger.related.financeEvents.some((e) => e.kind === 'allocation.reversed'),
    'Actual read-only MCP includes scoped financial reversal evidence',
  );
  const foreign = await db.tenant.create({ data: { code: 'FOREIGNFINANCE', name: '外部合成企业', status: 'active' } });
  const foreignCustomer = await db.customer.create({
    data: { tenantId: foreign.id, code: 'FOREIGN', name: '不可跨企业' },
  });
  const foreignReceipt = await db.receipt.create({
    data: {
      tenantId: foreign.id,
      receiptNo: 'FOREIGN-R',
      customerId: foreignCustomer.id,
      amount: '1.00',
      unallocatedAmount: '1.00',
      receiptDate: new Date(),
      status: 'draft',
      ledgerManaged: true,
    },
  });
  await call('/finance-ledger/receipts/' + foreignReceipt.id, 'GET', undefined, admin, 404);
  await action(foreignReceipt, 'confirm', {}, admin2, 404);
  await register(regBody('FOREIGN-CUSTOMER', '1.00', foreignCustomer.id), admin, 404);
  const bossSchema = (await call('/finance-ledger/schema', 'GET', undefined, boss)).data;
  ok(
    bossSchema.every((x) => x.effect === 'read'),
    'Boss only receives read capabilities',
  );
  const events = await db.financeEvent.findMany({ where: { tenantId: tid, receiptId: created.id } });
  ok(
    events.some((x) => x.kind === 'allocation.reversed' && x.evidence.before && x.evidence.after),
    'Before/after evidence retained',
  );
  ok(
    !JSON.stringify(events).includes('password') && !JSON.stringify(events).includes('accessToken'),
    'No credentials in events',
  );
  console.log(
    JSON.stringify({
      checks,
      receivableLedger: true,
      independentConfirmation: true,
      exactDecimals: true,
      allocationReversal: true,
      noBankMovement: true,
      concurrency: true,
      tenantScopes: true,
      immutableHistory: true,
    }),
  );
} catch (e) {
  console.error(log.slice(-1400));
  throw e;
} finally {
  api.kill('SIGTERM');
  await Promise.race([new Promise((r) => api.once('exit', r)), delay(3000)]);
  await db.$disconnect();
}
