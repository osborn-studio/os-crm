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
  TENANT_CODE: 'COMMERCIALTEST',
  TENANT_NAME: '客户合同闭环合成测试',
  ADMIN_USERNAME: 'admin',
  SEED_ADMIN_PASSWORD: 'Commercial-Only-Password-2026',
  APP_URL: 'http://localhost:3000',
  JWT_SECRET: randomBytes(32).toString('hex'),
  ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  BACKUP_KEY: randomBytes(32).toString('hex'),
};
await initializeProduction(db, env);
const api = spawn(process.execPath, ['apps/api/dist/main.js'], {
  env: { ...env, PORT: '4112', HOST: '127.0.0.1' },
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
  const r = await fetch('http://127.0.0.1:4112/api/v1' + path, {
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
      ready = (await fetch('http://127.0.0.1:4112/api/v1/health')).ok;
    } catch {}
    if (ready) break;
    await delay(200);
  }
  ok(ready, 'API ready');
  admin = await login('admin', env.SEED_ADMIN_PASSWORD);
  const roles = (await call('/system/roles', 'GET', undefined, admin)).data;
  const role = (code) => roles.find((r) => r.code === code).id;
  const tid = (await db.tenant.findUniqueOrThrow({ where: { code: env.TENANT_CODE } })).id;
  const dept = (await call('/system/departments', 'POST', req({ name: '销售一部' }), admin, 201)).data;
  const otherDept = (await call('/system/departments', 'POST', req({ name: '销售二部' }), admin, 201)).data;
  const users = {};
  for (const [username, code, deptId] of [
    ['sales', 'sales', dept.id],
    ['peer', 'sales', dept.id],
    ['peer2', 'sales', dept.id],
    ['other', 'sales', otherDept.id],
    ['manager', 'sales_manager', dept.id],
    ['boss', 'gm', null],
    ['admin2', 'super_admin', null],
  ])
    users[username] = (
      await call(
        '/system/users',
        'POST',
        req({ username, name: '合成' + username, password: pw, deptId, roleIds: [role(code)] }),
        admin,
        201,
      )
    ).data;
  sales = await login('sales');
  peer = await login('peer');
  manager = await login('manager');
  boss = await login('boss');
  const other = await login('other'),
    admin2 = await login('admin2');
  const preview = async (csv, t = admin) =>
    (await call('/commercial/customers/import/preview', 'POST', { requestKey: randomUUID(), csv }, t, 201)).data;
  const commit = (p, t = admin, k = randomUUID(), expected = 201) =>
    call(
      '/commercial/customers/import/commit',
      'POST',
      { requestKey: k, previewId: p.previewId, digest: p.digest },
      t,
      expected,
    );
  await call(
    '/commercial/customers/import/preview',
    'POST',
    { requestKey: randomUUID(), csv: '客户名称\n禁止销售导入' },
    sales,
    403,
  );
  const legacy = await create('customers', { name: 'ＡＣＭＥ 公司' }, other); // Hidden duplicate must not expose its identity.
  await call('/workspace/customers', 'POST', req({ name: 'acme公司' }), sales, 409);
  const previewBody = {
    requestKey: randomUUID(),
    csv: '客户名称,级别\nacme公司,普通客户\n首次导入甲,普通客户\n 首次导入甲 ,普通客户\n首次导入乙,重点客户',
  };
  const p = (await call('/commercial/customers/import/preview', 'POST', previewBody, admin, 201)).data;
  ok(p.ready === 2 && p.duplicates === 2 && p.errors === 0, 'Duplicate normalization and file duplicates');
  ok(
    !(JSON.stringify(p.rows).includes('ownerId') || JSON.stringify(p.rows).includes('customerId')),
    'Preview reports no duplicate customer IDs',
  );
  const replay = (await call('/commercial/customers/import/preview', 'POST', previewBody, admin, 201)).data;
  ok(replay.previewId === p.previewId, 'Preview idempotency');
  await commit(p, admin2, randomUUID(), 404);
  const k = randomUUID(),
    receipt = (await commit(p, admin, k)).data;
  ok(receipt.imported === 2 && receipt.skippedDuplicates === 2, 'Explicit valid rows imported to public pool');
  ok(
    (await commit(p, admin, k)).data.customerIds.join() === receipt.customerIds.join(),
    'Commit replay returns same receipt',
  );
  await commit(p, admin, randomUUID(), 409);
  ok(
    (await db.customer.count({ where: { tenantId: tid, name: '首次导入甲', poolType: 'public' } })) === 1,
    'Single public customer persisted',
  );
  const bad = await preview('客户名称,级别\n可用但不提交,普通客户\n错误记录,不存在级别');
  await commit(bad, admin, randomUUID(), 400);
  ok((await db.customer.count({ where: { name: '可用但不提交' } })) === 0, 'Any error prevents all business writes');
  const exp = await preview('客户名称\n已过期');
  await db.customerImport.update({ where: { id: exp.previewId }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await commit(exp, admin, randomUUID(), 409);
  const stale = await preview('客户名称\n预检后发生重复\n应整体回滚');
  await create('customers', { name: '预检后发生重复' }, peer);
  await commit(stale, admin, randomUUID(), 409);
  ok((await db.customer.count({ where: { name: '应整体回滚' } })) === 0, 'Duplicate race causes no partial batch');
  const corrupt = await preview('客户名称\n摘要校验');
  await call(
    '/commercial/customers/import/commit',
    'POST',
    { requestKey: randomUUID(), previewId: corrupt.previewId, digest: 'altered' },
    admin,
    409,
  );
  const simultaneous = await preview('客户名称\n并发导入只一条');
  const racing = await Promise.all([
    commit(simultaneous, admin, randomUUID(), null),
    commit(simultaneous, admin, randomUUID(), null),
  ]);
  ok(
    racing
      .map((r) => r.status)
      .sort()
      .join() === '201,409',
    'Only one parallel commit',
  );
  ok((await db.customer.count({ where: { name: '并发导入只一条' } })) === 1, 'No parallel duplicate');
  const large = await preview(
    '客户名称,备注\n' + Array.from({ length: 200 }, (_, i) => '批量验证' + i + ',' + '长'.repeat(1000)).join('\n'),
  );
  ok(large.ready === 200, 'Large UTF-8 payload above default 100KiB accepted');
  ok((await commit(large)).data.imported === 200, '200 row transaction succeeds');
  const foreign = await db.tenant.create({ data: { code: 'C3FOREIGN', name: '跨企业合成测试', status: 'active' } });
  const fr = await db.role.create({
    data: { tenantId: foreign.id, code: 'super_admin', name: '外企管理员', dataScope: 'all', permissions: ['*'] },
  });
  const fu = await db.user.create({
    data: {
      tenantId: foreign.id,
      username: 'foreignadmin',
      name: '外企合成人员',
      passwordHash: (await db.user.findFirstOrThrow({ where: { tenantId: tid, username: 'admin' } })).passwordHash,
    },
  });
  await db.userRole.create({ data: { tenantId: foreign.id, userId: fu.id, roleId: fr.id } });
  const foreignToken = await login('foreignadmin', env.SEED_ADMIN_PASSWORD, 'C3FOREIGN');
  await commit(corrupt, foreignToken, randomUUID(), 404);
  const sourceLead = await create('leads', { companyName: '完整销售交接客户', source: 'website' });
  const converted = await command('leads', sourceLead, 'convert');
  const isolated = await detail('customers', converted);
  ok(
    (await db.privateHolding.count({ where: { customerId: isolated.id, userId: users.sales.id } })) === 1,
    'Lead conversion creates private holding',
  );
  await call(
    '/workspace/leads/' + sourceLead.id,
    'PUT',
    req({ demand: '禁止改写历史' }, await detail('leads', sourceLead)),
    sales,
    400,
  );
  const contact = await create('contacts', { customerId: isolated.id, name: '历史联系人' });
  const follow = await create('followups', { customerId: isolated.id, content: '历史作者保留' });
  const opp = await create('opportunities', { name: '报价版本商机', customerId: isolated.id, amount: '0.50' });
  ok(opp.stage === 'new', 'Fresh installation uses actual first configured stage');
  ok(
    (await call('/commercial/opportunity-stages', 'GET', undefined, sales)).data[0].code === 'new',
    'Board stage contract uses enterprise definitions',
  );
  const product = await create('products', { name: '原始报价产品', code: 'C3-PRODUCT', listPrice: '0.10' }, admin);
  const q1 = await command('opportunities', await detail('opportunities', opp), 'quote', {
    items: [
      { productId: product.id, quantity: 3, unitPrice: '0.10' },
      { productId: product.id, quantity: 1, unitPrice: '0.20' },
    ],
  });
  ok(q1.version === 1 && q1.total === '0.5', 'Exact Decimal quote and first revision');
  const pd = await detail('products', product, admin);
  await call('/workspace/products/' + product.id, 'PUT', req({ name: '后续产品名称' }, pd), admin);
  const q2 = await command('opportunities', await detail('opportunities', opp), 'quote', {
    items: [{ productId: product.id, quantity: 3, unitPrice: '0.30' }],
  });
  ok(q2.version === 2 && q2.total === '0.9', 'Quote revisions increment');
  const ov = await detail('opportunities', opp);
  ok(
    ov.related.quoteVersions[1].items[0].productName === '原始报价产品',
    'Earlier product snapshot survives catalog rename',
  );
  await call(
    '/workspace/opportunities/' + opp.id + '/quote',
    'POST',
    {
      requestKey: randomUUID(),
      expectedUpdatedAt: ov.updatedAt,
      items: [{ productId: product.id, quantity: 1, unitPrice: '99999999999.99' }],
    },
    sales,
    400,
  );
  await call(
    '/workspace/contracts',
    'POST',
    req({
      name: '错误报价金额',
      customerId: isolated.id,
      opportunityId: opp.id,
      contractType: 'implementation',
      amount: '1.00',
    }),
    sales,
    400,
  );
  let linked = await create('contracts', {
    name: '报价关联合同',
    customerId: isolated.id,
    opportunityId: opp.id,
    contractType: 'implementation',
    amount: '0.90',
  });
  ok(linked.quoteSnapshot.version === 2, 'Contract freezes chosen quote revision');
  await command('opportunities', await detail('opportunities', opp), 'quote', {
    items: [{ productId: product.id, quantity: 4, unitPrice: '0.30' }],
  });
  linked = await detail('contracts', linked);
  ok(linked.quoteSnapshot.version === 2, 'Later quote does not drift existing contract');
  await call('/workspace/contracts/' + linked.id, 'PUT', req({ paymentTerms: '保留旧报价条款' }, linked), sales);
  linked = await detail('contracts', linked);
  ok(linked.quoteSnapshot.version === 2, 'Non-price edits preserve selected revision');
  await call('/workspace/contracts/' + linked.id, 'PUT', req({ amount: '1.20' }, linked), sales);
  linked = await detail('contracts', linked);
  ok(linked.quoteSnapshot.version === 3, 'Explicit draft price adoption records newest matching revision');
  await flow('合同审批', 'contract', users.boss.id);
  const changeFlow = await flow('合同变更审批', 'contract_change', users.boss.id, [
    { key: 'evidenceRef', label: '凭据编号', type: 'text', required: true },
  ]);
  const c = await sign(
    await create('contracts', {
      name: '变更验收合同',
      customerId: isolated.id,
      contractType: 'implementation',
      amount: '100.10',
    }),
  );
  const changeBody = { changeType: 'amount', data: { amount: '113.00', taxRate: '13' } };
  const plan = (await call('/commercial/contracts/' + c.id + '/changes/preview', 'POST', changeBody, sales, 201)).data;
  ok(plan.formFields[0].key === 'evidenceRef', 'Designer fields resolved from actual matching flow');
  const missing = {
    requestKey: randomUUID(),
    expectedUpdatedAt: plan.expectedUpdatedAt,
    ...changeBody,
    reason: '含税金额调整凭据',
  };
  await call('/commercial/contracts/' + c.id + '/changes', 'POST', missing, sales, 400);
  ok(
    (await db.contractChange.count({ where: { contractId: c.id } })) === 0,
    'Invalid approval form rolls back request',
  );
  ok((await detail('contracts', c)).updatedAt === plan.expectedUpdatedAt, 'Failed request rolls back source stamp');
  const request = {
    ...missing,
    requestKey: randomUUID(),
    form: { evidenceRef: 'C3-EVIDENCE', businessSnapshot: { proposed: { amount: '0.01' }, reason: '伪造审批证据' } },
  };
  const change = (await call('/commercial/contracts/' + c.id + '/changes', 'POST', request, sales, 201)).data;
  ok((await detail('contracts', c)).amount === '100.1', 'Request does not prematurely change amount');
  const pending = (await call('/approvals/pending', 'GET', undefined, boss)).data.find(
    (n) => n.approval.id === change.approvalId,
  );
  ok(
    pending.approval.formData.businessSnapshot.proposed.amount === '113.00',
    'Approver receives authoritative before/after evidence',
  );
  await call(
    `/approvals/${change.approvalId}/nodes/${pending.nodeId}/approve`,
    'POST',
    { requestKey: randomUUID() },
    sales,
    403,
  );
  await call(
    '/approvals',
    'POST',
    { requestKey: randomUUID(), flowId: changeFlow.id, form: { evidenceRef: '不能绕过' } },
    sales,
    400,
  );
  await command('contracts', await detail('contracts', c), 'order', {}, sales, 409);
  await call(
    '/commercial/customers/' + isolated.id + '/handover/preview',
    'POST',
    { userId: users.peer.id },
    manager,
    409,
  );
  const requestReplay = (await call('/commercial/contracts/' + c.id + '/changes', 'POST', request, sales, 201)).data;
  ok(requestReplay.id === change.id, 'Change request replay returns original approval');
  await call('/commercial/contracts/' + c.id + '/changes/preview', 'POST', changeBody, sales, 409);
  await call('/commercial/contracts/' + c.id + '/changes/preview', 'POST', changeBody, boss, 403);
  await approve(change.approvalId);
  const amended = await detail('contracts', c);
  ok(
    amended.amount === '113' && amended.amountExclTax === '100' && amended.taxAmount === '13',
    'Approval atomically recalculates Decimal amount/tax',
  );
  const pay = await db.paymentPlan.findFirstOrThrow({ where: { contractId: c.id } });
  ok(
    pay.amount.toFixed(2) === '113.00' && pay.outstandingAmount.toFixed(2) === '113.00',
    'Unexecuted plan updated in same transaction',
  );
  const rejectedPlan = (
    await call(
      '/commercial/contracts/' + c.id + '/changes/preview',
      'POST',
      { changeType: 'terms', data: { paymentTerms: '不应生效的条款' } },
      sales,
      201,
    )
  ).data;
  const reject = (
    await call(
      '/commercial/contracts/' + c.id + '/changes',
      'POST',
      {
        requestKey: randomUUID(),
        expectedUpdatedAt: rejectedPlan.expectedUpdatedAt,
        changeType: 'terms',
        data: { paymentTerms: '不应生效的条款' },
        reason: '测试驳回',
        form: { evidenceRef: 'REJECT' },
      },
      sales,
      201,
    )
  ).data;
  let pn = (await call('/approvals/pending', 'GET', undefined, boss)).data.find(
    (n) => n.approval.id === reject.approvalId,
  );
  await call(
    `/approvals/${reject.approvalId}/nodes/${pn.nodeId}/reject`,
    'POST',
    { requestKey: randomUUID(), comment: '驳回测试' },
    boss,
    201,
  );
  ok((await detail('contracts', c)).paymentTerms !== '不应生效的条款', 'Rejection preserves original contract');
  const withdrawPlan = (
    await call(
      '/commercial/contracts/' + c.id + '/changes/preview',
      'POST',
      { changeType: 'terms', data: { paymentTerms: '撤回条款' } },
      sales,
      201,
    )
  ).data;
  const withdraw = (
    await call(
      '/commercial/contracts/' + c.id + '/changes',
      'POST',
      {
        requestKey: randomUUID(),
        expectedUpdatedAt: withdrawPlan.expectedUpdatedAt,
        changeType: 'terms',
        data: { paymentTerms: '撤回条款' },
        reason: '测试撤回',
        form: { evidenceRef: 'WITHDRAW' },
      },
      sales,
      201,
    )
  ).data;
  await call('/approvals/' + withdraw.approvalId + '/withdraw', 'POST', { requestKey: randomUUID() }, sales, 201);
  ok(
    (await db.contractChange.findUniqueOrThrow({ where: { id: withdraw.id } })).status === 'withdrawn',
    'Withdrawal closes change state',
  );
  const terminated = await sign(
    await create('contracts', {
      name: '可终止合同',
      customerId: isolated.id,
      contractType: 'implementation',
      amount: '20.00',
    }),
  );
  const tp = (
    await call(
      '/commercial/contracts/' + terminated.id + '/changes/preview',
      'POST',
      { changeType: 'terminate', data: {} },
      sales,
      201,
    )
  ).data;
  const term = (
    await call(
      '/commercial/contracts/' + terminated.id + '/changes',
      'POST',
      {
        requestKey: randomUUID(),
        expectedUpdatedAt: tp.expectedUpdatedAt,
        changeType: 'terminate',
        data: {},
        reason: '终止凭据说明',
        form: { evidenceRef: 'END' },
      },
      sales,
      201,
    )
  ).data;
  await approve(term.approvalId);
  ok((await detail('contracts', terminated)).status === 'terminated', 'Termination only after approval');
  const cancelled = await db.paymentPlan.findFirstOrThrow({ where: { contractId: terminated.id } });
  ok(cancelled.status === 'cancelled' && cancelled.outstandingAmount.eq(0), 'Termination cancels unexecuted plan');
  const stats = await db.customer.findUniqueOrThrow({ where: { id: isolated.id } });
  ok(stats.contractCount === 1 && stats.contractAmount.eq('113.00'), 'Customer effective contract totals recomputed');
  const order = await command('contracts', await detail('contracts', c), 'order');
  await call(
    '/commercial/contracts/' + c.id + '/changes/preview',
    'POST',
    { changeType: 'amount', data: { amount: '120.00' } },
    sales,
    409,
  );
  const proj = await command('contracts', await detail('contracts', c), 'project');
  const handoverPreview = async (target = users.peer.id, t = manager) =>
    (await call('/commercial/customers/' + isolated.id + '/handover/preview', 'POST', { userId: target }, t, 201)).data;
  let hp = await handoverPreview();
  ok(
    hp.counts.opportunities === 1 && hp.counts.contracts === 3 && hp.counts.orders === 1 && hp.counts.projects === 1,
    'Handover previews full sales graph',
  );
  await call(
    '/commercial/customers/' + isolated.id + '/handover/preview',
    'POST',
    { userId: users.other.id },
    manager,
    400,
  );
  await call(
    '/commercial/customers/' + isolated.id + '/handover/preview',
    'POST',
    { userId: users.peer.id },
    sales,
    403,
  );
  await command('customers', await detail('customers', isolated), 'return', {}, sales, 409);
  await command('customers', await detail('customers', isolated), 'assign', { userId: users.peer.id }, manager, 409);
  await create('opportunities', { customerId: isolated.id, name: '预检后新增商机', amount: '10.00' });
  await call(
    '/commercial/customers/' + isolated.id + '/handover',
    'POST',
    {
      requestKey: randomUUID(),
      expectedUpdatedAt: hp.expectedUpdatedAt,
      digest: hp.digest,
      userId: users.peer.id,
      reason: '交接范围已改变',
    },
    manager,
    409,
  );
  hp = await handoverPreview();
  const handoverBody = {
    requestKey: randomUUID(),
    expectedUpdatedAt: hp.expectedUpdatedAt,
    digest: hp.digest,
    userId: users.peer.id,
    reason: '销售归属整体交接',
  };
  await call('/commercial/customers/' + isolated.id + '/handover', 'POST', handoverBody, manager, 201);
  await call('/commercial/customers/' + isolated.id + '/handover', 'POST', handoverBody, manager, 201);
  await call('/workspace/customers/' + isolated.id, 'GET', undefined, sales, 404);
  await call('/workspace/opportunities/' + opp.id, 'GET', undefined, sales, 404);
  await call('/workspace/contracts/' + c.id, 'GET', undefined, sales, 404);
  await call('/workspace/customers/' + isolated.id, 'GET', undefined, peer);
  await call('/workspace/contracts/' + c.id, 'GET', undefined, peer);
  await call('/workspace/orders/' + order.id, 'GET', undefined, peer);
  await call('/workspace/projects/' + proj.id, 'GET', undefined, peer);
  ok(
    (await db.followUp.findUniqueOrThrow({ where: { id: follow.id } })).createdBy === users.sales.id,
    'Historical author preserved',
  );
  ok(
    (await db.project.findUniqueOrThrow({ where: { id: proj.id } })).pmId === users.sales.id,
    'Delivery project manager not silently reassigned',
  );
  ok(
    (await db.contact.findUniqueOrThrow({ where: { id: contact.id } })).customerId === isolated.id,
    'Contact relationship preserved',
  );
  ok(
    (await db.privateHolding.count({ where: { customerId: isolated.id, userId: users.peer.id } })) === 1,
    'One current private holding',
  );
  const mixed = await db.opportunity.create({
    data: {
      tenantId: tid,
      code: 'C3-MIXED',
      name: '历史跨部门销售归属',
      customerId: isolated.id,
      ownerId: users.other.id,
      stage: 'new',
      amount: '1.00',
    },
  });
  await call(
    '/commercial/customers/' + isolated.id + '/handover/preview',
    'POST',
    { userId: users.peer2.id },
    manager,
    403,
  );
  ok(
    (await db.opportunity.findUniqueOrThrow({ where: { id: mixed.id } })).ownerId === users.other.id,
    'Cross-department graph untouched',
  );
  const managerRole = await db.role.findUniqueOrThrow({ where: { id: role('sales_manager') } });
  await db.role.update({ where: { id: managerRole.id }, data: { permissions: [] } });
  await call('/commercial/customers/handover/options', 'GET', undefined, manager, 403);
  await db.role.update({ where: { id: managerRole.id }, data: { permissions: managerRole.permissions } });
  const guardedCustomer = await create('customers', { name: '陈旧合同变更验证客户' });
  const guarded = await sign(
    await create('contracts', {
      name: '陈旧回调验证合同',
      customerId: guardedCustomer.id,
      contractType: 'implementation',
      amount: '0.10',
    }),
  );
  const stalePlan = (
    await call(
      '/commercial/contracts/' + guarded.id + '/changes/preview',
      'POST',
      { changeType: 'terms', data: { paymentTerms: '不得被陈旧审批写入' } },
      sales,
      201,
    )
  ).data;
  const staleChange = (
    await call(
      '/commercial/contracts/' + guarded.id + '/changes',
      'POST',
      {
        requestKey: randomUUID(),
        expectedUpdatedAt: stalePlan.expectedUpdatedAt,
        changeType: 'terms',
        data: { paymentTerms: '不得被陈旧审批写入' },
        reason: '并发源版本测试',
        form: { evidenceRef: 'STALE' },
      },
      sales,
      201,
    )
  ).data;
  await db.contract.update({
    where: { id: guarded.id },
    data: { name: '模拟其他受控变更后的合同', updatedAt: new Date(Date.now() + 1000) },
  });
  const staleNode = (await call('/approvals/pending', 'GET', undefined, boss)).data.find(
    (n) => n.approval.id === staleChange.approvalId,
  );
  await call(
    `/approvals/${staleChange.approvalId}/nodes/${staleNode.nodeId}/approve`,
    'POST',
    { requestKey: randomUUID() },
    boss,
    409,
  );
  ok(
    (await db.approval.findUniqueOrThrow({ where: { id: staleChange.approvalId } })).status === 'pending' &&
      (await db.approvalNode.findUniqueOrThrow({ where: { id: staleNode.nodeId } })).action === 'pending',
    'Failed callback rolls back approval and node',
  );
  ok(
    (await db.contract.findUniqueOrThrow({ where: { id: guarded.id } })).paymentTerms !== '不得被陈旧审批写入',
    'Failed callback does not mutate contract terms',
  );
  await call('/approvals/' + staleChange.approvalId + '/withdraw', 'POST', { requestKey: randomUUID() }, sales, 201);
  // An inactive former member can still be handed over by their department supervisor.
  const dormant = await create('customers', { name: '离职销售待交接客户' });
  const su = (await call('/system/users/' + users.sales.id, 'GET', undefined, admin)).data;
  await call('/system/users/' + users.sales.id, 'PUT', req({ status: 'inactive' }, su), admin);
  const opts = (await call('/commercial/customers/handover/options', 'GET', undefined, manager)).data;
  ok(
    opts.customers.some((r) => r.id === dormant.id),
    'Supervisor can find inactive former member customer',
  );
  const dp = (
    await call(
      '/commercial/customers/' + dormant.id + '/handover/preview',
      'POST',
      { userId: users.peer.id },
      manager,
      201,
    )
  ).data;
  await call(
    '/commercial/customers/' + dormant.id + '/handover',
    'POST',
    {
      requestKey: randomUUID(),
      expectedUpdatedAt: dp.expectedUpdatedAt,
      digest: dp.digest,
      userId: users.peer.id,
      reason: '离职交接',
    },
    manager,
    201,
  );
  const history = (await call('/commercial/contracts/' + c.id + '/changes', 'GET', undefined, peer)).data;
  ok(
    history.some((r) => r.status === 'approved') &&
      history.some((r) => r.status === 'rejected') &&
      history.some((r) => r.status === 'withdrawn'),
    'Visible owner receives all immutable change outcomes',
  );
  await call('/commercial/contracts/' + c.id + '/changes', 'GET', undefined, foreignToken, 404);
  const overview = (await call('/workspace/overview', 'GET', undefined, admin)).data;
  ok(overview.signedAmount === '113.1', 'Overview agrees with effective signed contracts after termination');
  ok(
    (await db.auditLog.count({ where: { action: 'customer.sales.handover' } })) === 2,
    'Handover retry does not duplicate audit',
  );
  console.log(
    JSON.stringify({
      checks,
      imports: true,
      largeUtf8Batch: true,
      duplicateRaces: true,
      quoteHistory: true,
      contractQuoteSnapshot: true,
      contractChangeApproval: true,
      changeRejectWithdraw: true,
      termination: true,
      atomicSalesHandover: true,
      inactiveOwnerHandover: true,
      crossTenantIsolation: true,
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
