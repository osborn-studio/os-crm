import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
assert.equal(process.env.SMOKE_ALLOW_WRITES, 'true', 'Requires explicit disposable test writes');
assert.match(new URL(process.env.DATABASE_URL).pathname, /test/, 'Requires test database');
const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const port = process.env.SMOKE_PORT || '4100';
const api = spawn(process.execPath, ['dist/main.js'], {
  cwd: new URL('../apps/api/', import.meta.url),
  env: { ...process.env, PORT: port },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '',
  checks = 0;
api.stdout.on('data', (c) => {
  log += c;
});
api.stderr.on('data', (c) => {
  log += c;
});
const base = `http://127.0.0.1:${port}/api/v1`;
const eq = (a, b, label) => {
  assert.deepEqual(a, b, label);
  checks++;
};
async function call(path, method = 'GET', body, token, expected = 200) {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const out = await r.json();
  if (expected !== null) eq(r.status, expected, `${method} ${path}: ${out.message ?? ''}`);
  return { status: r.status, data: out.data, body: out };
}
const newKey = () => randomUUID();
const create = async (t, k, data, requestKey = newKey()) =>
  (await call(`/workspace/${k}`, 'POST', { requestKey, data }, t, 201)).data;
const detail = async (t, k, r) =>
  (await call(`/workspace/${k}/${typeof r === 'number' ? r : r.id}`, 'GET', undefined, t)).data;
const command = async (t, k, r, action, extra = {}) =>
  (
    await call(
      `/workspace/${k}/${r.id}/${action}`,
      'POST',
      { requestKey: newKey(), expectedUpdatedAt: r.updatedAt, ...extra },
      t,
      201,
    )
  ).data;
const login = async (username) =>
  (await call('/auth/login', 'POST', { username, password: process.env.SEED_ADMIN_PASSWORD }, undefined, 200)).data
    .accessToken;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (api.exitCode !== null) throw new Error('API exited');
    try {
      ready = (await fetch(base + '/health')).ok;
    } catch {}
    if (ready) break;
    await delay(200);
  }
  assert(ready, 'Readiness timeout');
  await call('/workspace/customers', 'GET', undefined, undefined, 401);
  const [admin, manager, sales, boss, peer, other] = await Promise.all(
    ['admin', 'manager', 'sales', 'boss', 'sales01', 'sales03'].map(login),
  );
  for (const t of [admin, manager, sales, boss]) {
    await call('/workspace/overview', 'GET', undefined, t);
    await call('/workspace/schema', 'GET', undefined, t);
  }
  await call('/system/users', 'GET', undefined, sales, 403);
  await call('/approvals/people', 'GET', undefined, boss, 403);
  await call('/workspace/customers', 'POST', { requestKey: newKey(), data: { name: '老板不可编辑' } }, boss, 403);
  const plans = await db.paymentPlan.findMany({ where: { planNo: { startsWith: 'DEMO-HK-' } } });
  const cents = (value) => {
    const [whole, fraction = ''] = String(value).split('.');
    return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
  };
  eq(plans.length, 24, 'Linked demo payment plans');
  for (const plan of plans)
    eq(cents(plan.receivedAmount) + cents(plan.outstandingAmount), cents(plan.amount), 'Plan balance');
  const allocations = await db.receiptAllocation.findMany({ include: { receipt: true } });
  for (const receiptId of new Set(allocations.map((x) => x.receiptId))) {
    const rows = allocations.filter((x) => x.receiptId === receiptId);
    eq(
      rows.reduce((sum, x) => sum + cents(x.amount), 0n),
      cents(rows[0].receipt.allocatedAmount),
      'Allocation balance',
    );
  }
  const salesOverview = (await call('/workspace/overview', 'GET', undefined, sales)).data;
  assert(salesOverview.projects > 0 && Number(salesOverview.signedAmount) > 0, 'Sales has a complete demo portfolio');
  checks++;
  const seedProject = await db.project.findFirstOrThrow({ where: { status: 'active' } });
  const customerStats = (
    await call('/capabilities/customer.get/invoke', 'POST', { customerId: seedProject.customerId }, admin, 201)
  ).data.result.statistics;
  eq(
    customerStats.activeProjects,
    await db.project.count({
      where: { tenantId: seedProject.tenantId, customerId: seedProject.customerId, status: 'active', deletedAt: null },
    }),
    'Admin customer tool statistics match active project records',
  );
  const name = `数据测试${Date.now()}`,
    requestKey = newKey(),
    payload = { name, industry: '制造/工业' };
  const customer = await create(sales, 'customers', payload, requestKey);
  const duplicate = await create(sales, 'customers', payload, requestKey);
  eq(duplicate.id, customer.id, 'Create replay');
  const reordered = await create(sales, 'customers', { industry: '制造/工业', name }, requestKey);
  eq(reordered.id, customer.id, 'JSON property order does not change idempotency');
  await call('/workspace/customers', 'POST', { requestKey, data: { name: '不能复用不同内容' } }, sales, 409);
  const foreign = await create(other, 'customers', { name: `跨部门${name}` });
  await call(`/workspace/customers/${foreign.id}`, 'GET', undefined, sales, 404);
  await call(`/workspace/customers/${foreign.id}`, 'GET', undefined, manager, 404);
  await detail(boss, 'customers', foreign);
  const mate = await create(peer, 'customers', { name: `同组${name}` });
  await detail(manager, 'customers', mate);
  await call(`/workspace/customers/${mate.id}`, 'GET', undefined, sales, 404);
  await call(
    '/workspace/opportunities',
    'POST',
    { requestKey: newKey(), data: { name: '越权关联', customerId: foreign.id, amount: '100' } },
    sales,
    404,
  );
  const contact = await create(sales, 'contacts', {
    name: '合成联系人',
    customerId: customer.id,
    phone: '13800000000',
  });
  await call(
    `/workspace/contacts/${contact.id}`,
    'PUT',
    { requestKey: newKey(), expectedUpdatedAt: contact.updatedAt, data: { phone: '' } },
    sales,
    200,
  );
  eq((await detail(sales, 'contacts', contact)).phone, null, 'Clearing optional fields persists');
  await create(sales, 'followups', {
    customerId: customer.id,
    content: '验证需求并约定下一步',
    nextAction: '提交方案',
  });
  await create(sales, 'actions', { title: '客户方案沟通', targetId: customer.id, dueDate: '2026-11-02' });
  const lead = await create(sales, 'leads', { companyName: `线索${name}`, source: 'website' });
  const converted = await command(sales, 'leads', lead, 'convert');
  await detail(sales, 'customers', converted.id);
  let opp = await create(sales, 'opportunities', {
    name: `商机${name}`,
    customerId: customer.id,
    amount: '200000',
    demandSummary: '客户经营与销售协同',
  });
  await command(sales, 'opportunities', opp, 'advance');
  opp = await detail(sales, 'opportunities', opp);
  const products = (await call('/workspace/products', 'GET', undefined, sales)).data.items;
  await command(sales, 'opportunities', opp, 'quote', {
    items: [{ productId: products[0].id, quantity: 2, unitPrice: '100000' }],
  });
  const contract = await create(sales, 'contracts', {
    name: `合同${name}`,
    customerId: customer.id,
    opportunityId: opp.id,
    contractType: 'implementation',
    amount: '200000',
    taxRate: 6,
  });
  const approveBusiness = async (kind, record) => {
    await command(sales, kind, record, 'submit');
    const current = await detail(sales, kind, record);
    eq(current.status, 'pending_approval', 'Business pending');
    const mp = (await call('/approvals/pending', 'GET', undefined, manager)).data.find(
      (p) => p.approval.id === current.approvalId,
    );
    assert(mp, 'Manager pending');
    checks++;
    const bp = (await call('/approvals/pending', 'GET', undefined, boss)).data;
    eq(
      bp.some((p) => p.approval.id === current.approvalId),
      false,
      'Future node hidden',
    );
    // Never trust the seeded numeric boss ID: resolve it from the authenticated user fixture.
    const bossUser = await db.user.findFirstOrThrow({ where: { username: 'boss', tenantId: customer.tenantId } });
    const futureNode = await db.approvalNode.findFirstOrThrow({
      where: { approvalId: current.approvalId, approverId: bossUser.id },
    });
    await call(
      `/approvals/${current.approvalId}/nodes/${futureNode.id}/approve`,
      'POST',
      { requestKey: newKey() },
      boss,
      403,
    );
    await call(
      `/approvals/${current.approvalId}/nodes/${mp.nodeId}/approve`,
      'POST',
      { requestKey: newKey() },
      manager,
      201,
    );
    const pending = (await call('/approvals/pending', 'GET', undefined, boss)).data.find(
      (p) => p.approval.id === current.approvalId,
    );
    assert(pending, 'Boss now pending');
    checks++;
    await call(
      `/approvals/${current.approvalId}/nodes/${pending.nodeId}/approve`,
      'POST',
      { requestKey: newKey() },
      boss,
      201,
    );
    eq((await detail(sales, kind, record)).status, kind === 'projects' ? 'active' : 'approved', 'Approval callback');
  };
  await approveBusiness('contracts', contract);
  const approved = await detail(sales, 'contracts', contract);
  await command(sales, 'contracts', approved, 'sign');
  await call(
    `/workspace/contracts/${contract.id}/sign`,
    'POST',
    { requestKey: newKey(), expectedUpdatedAt: approved.updatedAt },
    sales,
    409,
  );
  const signed = await detail(sales, 'contracts', contract);
  eq(signed.status, 'signed');
  const generatedOrder = await command(sales, 'contracts', signed, 'order');
  let order = await detail(sales, 'orders', generatedOrder.id);
  await approveBusiness('orders', order);
  order = await detail(sales, 'orders', order);
  await command(sales, 'orders', order, 'confirm');
  order = await detail(sales, 'orders', order);
  await command(sales, 'orders', order, 'deliver');
  const generatedProject = await command(sales, 'contracts', await detail(sales, 'contracts', signed), 'project');
  let project = await detail(sales, 'projects', generatedProject.id);
  await approveBusiness('projects', project);
  project = await detail(sales, 'projects', project);
  const dcmd = async (token, kind, row, action, extra = {}, expected = 201) =>
    call(
      `/workspace/${kind}/${row.id}/${action}`,
      'POST',
      { requestKey: newKey(), expectedUpdatedAt: row.updatedAt, ...extra },
      token,
      expected,
    );
  await dcmd(sales, 'projects', project, 'advance', { note: 'Cannot progress unstarted' }, 400);
  await call(
    '/workspace/tasks',
    'POST',
    { requestKey: newKey(), data: { title: 'Unstarted blocked', projectId: project.id } },
    sales,
    400,
  );
  await command(sales, 'projects', project, 'start');
  project = await detail(sales, 'projects', project);
  await dcmd(sales, 'projects', project, 'request_acceptance', { note: 'Premature acceptance' }, 409);
  const milestoneId = project.related.milestones[0].id;
  await call(
    '/workspace/tasks',
    'POST',
    { requestKey: newKey(), data: { title: 'Invalid milestone', projectId: project.id, milestoneId: 9999999 } },
    sales,
    400,
  );
  let task = await create(sales, 'tasks', { title: 'Delivery task', projectId: project.id, milestoneId });
  project = await detail(sales, 'projects', project);
  await dcmd(sales, 'projects', project, 'advance', { note: 'Unfinished task blocks milestone' }, 409);
  await dcmd(sales, 'tasks', task, 'complete', { note: 'Cannot complete before starting', actualHours: '1.0' }, 409);
  await dcmd(sales, 'tasks', task, 'start_task', {}, 400);
  await dcmd(boss, 'tasks', task, 'start_task', { note: 'Boss read only' }, 403);
  await dcmd(peer, 'tasks', task, 'start_task', { note: 'Other sales cannot see task' }, 404);
  await command(sales, 'tasks', task, 'start_task', { note: 'Started delivery' });
  task = await detail(sales, 'tasks', task);
  await dcmd(sales, 'tasks', task, 'complete', { note: 'Invalid exact hours', actualHours: '1.25' }, 400);
  const taskBody = {
    requestKey: newKey(),
    expectedUpdatedAt: task.updatedAt,
    note: 'Evidence: fixture test report',
    actualHours: '2.5',
  };
  const beforeEvents = await db.deliveryEvent.count({ where: { projectId: project.id } });
  const taskResult = await call(`/workspace/tasks/${task.id}/complete`, 'POST', taskBody, sales, 201);
  const retryResult = await call(`/workspace/tasks/${task.id}/complete`, 'POST', taskBody, sales, 201);
  eq(retryResult.data, taskResult.data, 'Task completion durable replay');
  await call(
    `/workspace/tasks/${task.id}/complete`,
    'POST',
    { ...taskBody, note: 'Changed replay payload' },
    sales,
    409,
  );
  await call(`/workspace/tasks/${task.id}/complete`, 'POST', { ...taskBody, requestKey: newKey() }, sales, 409);
  eq(
    await db.deliveryEvent.count({ where: { projectId: project.id } }),
    beforeEvents + 1,
    'Exactly one task evidence event',
  );
  task = await detail(sales, 'tasks', task);
  eq(task.actualHours, '2.5');
  await call(
    `/workspace/tasks/${task.id}`,
    'PUT',
    { requestKey: newKey(), expectedUpdatedAt: task.updatedAt, data: { title: 'Cannot rewrite done task' } },
    sales,
    409,
  );
  for (let i = 0; i < 4; i++) {
    project = await detail(sales, 'projects', project);
    await command(sales, 'projects', project, 'advance', { note: 'Milestone evidence ' + i });
  }
  project = await detail(sales, 'projects', project);
  eq(project.progress, 100);
  await dcmd(sales, 'projects', project, 'accept', { note: 'Self acceptance blocked' }, 403);
  await dcmd(admin, 'projects', project, 'accept', { note: 'Request required' }, 409);
  await command(sales, 'projects', project, 'request_acceptance', { note: 'All deliverables submitted' });
  project = await detail(sales, 'projects', project);
  eq(project.acceptanceState, 'pending');
  await call(
    '/workspace/tasks',
    'POST',
    { requestKey: newKey(), data: { title: 'Frozen task creation', projectId: project.id } },
    sales,
    409,
  );
  await dcmd(sales, 'tasks', task, 'reopen_task', { note: 'Cannot mutate pending acceptance' }, 409);
  await dcmd(sales, 'projects', project, 'accept', { note: 'Self acceptance blocked' }, 403);
  await dcmd(boss, 'projects', project, 'accept', { note: 'Boss business writes blocked' }, 403);
  const rejectBody = {
    requestKey: newKey(),
    expectedUpdatedAt: project.updatedAt,
    note: 'Rejected: add delivery evidence',
  };
  const decisions = await Promise.all([
    call(`/workspace/projects/${project.id}/reject_acceptance`, 'POST', rejectBody, admin, null),
    call(
      `/workspace/projects/${project.id}/reject_acceptance`,
      'POST',
      { requestKey: newKey(), expectedUpdatedAt: project.updatedAt, note: 'Concurrent rejection' },
      manager,
      null,
    ),
  ]);
  eq(decisions.map((r) => r.status).sort(), [201, 409], 'Only one concurrent acceptance decision');
  project = await detail(sales, 'projects', project);
  eq(project.acceptanceState, 'rejected');
  await command(sales, 'tasks', task, 'reopen_task', { note: 'Remediation: revise implementation' });
  project = await detail(sales, 'projects', project);
  eq(project.progress, 0, 'Reopened first-stage task resets dependent milestones');
  eq(
    project.related.milestones.every((m) => m.status === 'pending'),
    true,
  );
  await dcmd(sales, 'projects', project, 'request_acceptance', { note: 'Still not remediated' }, 409);
  task = await detail(sales, 'tasks', task);
  await command(sales, 'tasks', task, 'start_task', { note: 'Begin remediation' });
  task = await detail(sales, 'tasks', task);
  await command(sales, 'tasks', task, 'complete', { note: 'Revised test report', actualHours: '3.5' });
  for (let i = 0; i < 4; i++) {
    project = await detail(sales, 'projects', project);
    await command(sales, 'projects', project, 'advance', { note: 'Revalidated milestone ' + i });
  }
  project = await detail(sales, 'projects', project);
  await command(sales, 'projects', project, 'request_acceptance', { note: 'Resubmit revised evidence' });
  project = await detail(sales, 'projects', project);
  await dcmd(admin, 'projects', project, 'accept', { note: 'Reviewed revised deliverables' });
  project = await detail(sales, 'projects', project);
  eq(project.status, 'completed');
  eq(project.acceptanceState, 'accepted');
  eq(project.stage, 'closed');
  eq(
    project.related.deliveryEvents.some((e) => e.kind === 'acceptance.rejected'),
    true,
    'Rejected history retained',
  );
  eq(
    project.related.deliveryEvents.filter((e) => e.kind === 'task.complete').length,
    2,
    'Both delivery evidence versions retained',
  );
  task = await detail(sales, 'tasks', task);
  await dcmd(sales, 'tasks', task, 'reopen_task', { note: 'Cannot rewrite closed delivery' }, 400);
  await call(
    '/workspace/tasks',
    'POST',
    { requestKey: newKey(), data: { title: 'Closed project blocked', projectId: project.id } },
    sales,
    400,
  );
  const publicCustomer = (await call('/workspace/customers?poolType=public', 'GET', undefined, sales)).data.items[0];
  assert(publicCustomer, 'Public fixture');
  const racing = await Promise.all(
    [sales, peer].map((token) =>
      call(
        `/workspace/customers/${publicCustomer.id}/claim`,
        'POST',
        { requestKey: newKey(), expectedUpdatedAt: publicCustomer.updatedAt },
        token,
        null,
      ),
    ),
  );
  eq(racing.filter((r) => r.status === 201).length, 1, 'Only one claimant');
  assert(
    racing.every((r) => [201, 404, 409].includes(r.status)),
    'Loser is denied or conflicts',
  );
  checks++;
  const salesUser = await db.user.findFirstOrThrow({ where: { tenantId: customer.tenantId, username: 'sales' } });
  const flowData = {
    requestKey: newKey(),
    name: `通用测试${Date.now()}`,
    bizType: 'general',
    condition: 'always',
    priority: 100,
    nodes: [{ name: '主管处理', approverType: 'role', approverValue: 'sales_manager', condition: 'always' }],
    fields: [{ key: 'reason', label: '申请事由', type: 'text', required: true }],
  };
  await call(
    '/approvals/flows',
    'POST',
    {
      ...flowData,
      requestKey: newKey(),
      name: '不能选择无审批权限的销售',
      nodes: [{ name: '无权人员', approverType: 'user', approverValue: String(salesUser.id), condition: 'always' }],
    },
    admin,
    400,
  );
  const flow = (await call('/approvals/flows', 'POST', flowData, admin, 201)).data;
  await call(
    `/approvals/flows/${flow.id}/publish`,
    'POST',
    { requestKey: newKey(), expectedUpdatedAt: flow.updatedAt },
    admin,
    201,
  );
  await call(
    '/approvals',
    'POST',
    { requestKey: newKey(), flowId: flow.id, title: '缺少事由', amount: 0, form: {} },
    sales,
    400,
  );
  const application = (
    await call(
      '/approvals',
      'POST',
      { requestKey: newKey(), flowId: flow.id, title: '通用申请测试', amount: 0, form: { reason: '真实数据库验证' } },
      sales,
      201,
    )
  ).data;
  const active = (await call('/approvals/pending', 'GET', undefined, manager)).data.find(
    (p) => p.approval.id === application.id,
  );
  assert(active);
  checks++;
  await call(
    `/approvals/${application.id}/nodes/${active.nodeId}/reject`,
    'POST',
    { requestKey: newKey(), comment: '资料需补充' },
    manager,
    201,
  );
  eq((await db.approval.findUniqueOrThrow({ where: { id: application.id } })).status, 'rejected');
  const withdrawal = (
    await call(
      '/approvals',
      'POST',
      { requestKey: newKey(), flowId: flow.id, title: '撤回测试', amount: 0, form: { reason: '流程验证' } },
      sales,
      201,
    )
  ).data;
  await call(`/approvals/${withdrawal.id}/withdraw`, 'POST', { requestKey: newKey() }, sales, 201);
  eq(
    (await call('/approvals/pending', 'GET', undefined, manager)).data.some((p) => p.approval.id === withdrawal.id),
    false,
    'Withdrawn not pending',
  );
  for (const kind of [
    'customers',
    'contacts',
    'leads',
    'opportunities',
    'contracts',
    'orders',
    'projects',
    'tasks',
    'actions',
    'followups',
    'products',
    'payment-plans',
    'invoices',
    'receipts',
  ])
    await call(`/workspace/${kind}`, 'GET', undefined, sales);
  await call('/workspace/invoices', 'POST', { requestKey: newKey(), data: {} }, sales, 400);
  await call('/contracts', 'GET', undefined, admin, 503);
  eq((await call('/integrations', 'GET', undefined, admin)).data.length, 2);
  await call('/integrations/dingtalk/test', 'POST', {}, admin, 503);
  const cap = (await call('/capabilities/customer.get/invoke', 'POST', { customerId: customer.id }, sales, 201)).data;
  eq(cap.result.name, name);
  assert(cap.executionId);
  checks++;
  await call('/capabilities/customer.search/invoke', 'POST', { tenantId: 999 }, sales, 400);
  // Independent foreign-tenant fixture verifies object lookup uses authenticated tenant context.
  const foreignTenant = await db.tenant.upsert({
    where: { code: 'SMOKE_FOREIGN' },
    update: {},
    create: { code: 'SMOKE_FOREIGN', name: '跨租户合成测试', status: 'active' },
  });
  const cross = await db.customer.create({
    data: { tenantId: foreignTenant.id, code: newKey().slice(0, 20), name: '不可跨租户读取' },
  });
  await call(`/workspace/customers/${cross.id}`, 'GET', undefined, admin, 404);
  const foreignProject = await db.project.create({
    data: {
      tenantId: foreignTenant.id,
      customerId: cross.id,
      projectNo: 'FOREIGN-DELIVERY',
      name: 'Foreign private delivery',
      pmId: salesUser.id,
      salesOwnerId: salesUser.id,
      status: 'active',
      actualStartDate: new Date(),
      plannedStartDate: new Date(),
      plannedEndDate: new Date(),
    },
  });
  const foreignTask = await db.projectTask.create({
    data: {
      tenantId: foreignTenant.id,
      projectId: foreignProject.id,
      title: 'Foreign private task',
      assigneeId: salesUser.id,
    },
  });
  await db.deliveryEvent.create({
    data: {
      tenantId: foreignTenant.id,
      projectId: foreignProject.id,
      actorId: salesUser.id,
      kind: 'fixture.private',
      note: 'Must stay isolated',
      evidence: {},
    },
  });
  await call(`/workspace/projects/${foreignProject.id}`, 'GET', undefined, admin, 404);
  await call(`/workspace/tasks/${foreignTask.id}`, 'GET', undefined, admin, 404);
  await dcmd(admin, 'projects', foreignProject, 'advance', { note: 'Cross tenant forbidden' }, 404);
  await dcmd(admin, 'tasks', foreignTask, 'start_task', { note: 'Cross tenant forbidden' }, 404);
  const mcp = async (method, params, rpcId) => {
    const r = await fetch(base + '/mcp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sales}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpcId, method, params }),
    });
    eq(r.status, 200, `MCP ${method}`);
    return r.json();
  };
  const init = await mcp(
    'initialize',
    { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'smoke', version: '1.0' } },
    1,
  );
  eq(init.result.serverInfo.name, 'tb-crm');
  const tools = await mcp('tools/list', {}, 2);
  eq(tools.result.tools.length, 7);
  const tool = await mcp('tools/call', { name: 'customer.get', arguments: { customerId: customer.id } }, 3);
  eq(JSON.parse(tool.result.content[0].text).result.name, name);
  const workspaceTool = await mcp(
    'tools/call',
    { name: 'workspace.get', arguments: { kind: 'contracts', recordId: contract.id } },
    4,
  );
  eq(JSON.parse(workspaceTool.result.content[0].text).id, contract.id);
  const approvalCatalog = (await call('/approvals/schema', 'GET', undefined, sales)).data;
  eq(
    approvalCatalog.some((o) => o.id === 'approval.flow.save'),
    false,
    'Designer contract hidden from sales',
  );
  eq(
    (await call('/approvals/schema', 'GET', undefined, admin)).data.some((o) => o.id === 'approval.flow.save'),
    true,
    'Designer contract available to admin',
  );
  const discovery = await mcp('resources/list', {}, 5);
  eq(discovery.result.resources.length, 2, 'Business and approval discovery resources');
  const discovered = await mcp('resources/read', { uri: 'crm://approval-capabilities' }, 6);
  eq(
    JSON.parse(discovered.result.contents[0].text).some((o) => o.id === 'approval.create'),
    true,
    'Readable approval contract',
  );
  const specialFlow = (
    await call(
      '/approvals/flows',
      'POST',
      { ...flowData, requestKey: newKey(), name: `合同补充字段${Date.now()}`, bizType: 'contract', priority: 999 },
      admin,
      201,
    )
  ).data;
  await call(
    `/approvals/flows/${specialFlow.id}/publish`,
    'POST',
    { requestKey: newKey(), expectedUpdatedAt: specialFlow.updatedAt },
    admin,
    201,
  );
  const specialContract = await create(sales, 'contracts', {
    name: `补充表单${name}`,
    customerId: customer.id,
    contractType: 'implementation',
    amount: '1000',
  });
  const approvalForm = (await call(`/workspace/contracts/${specialContract.id}/approval-form`, 'GET', undefined, sales))
    .data;
  eq(approvalForm.fields[0].key, 'reason', 'Business form follows designer');
  await call(
    `/workspace/contracts/${specialContract.id}/submit`,
    'POST',
    { requestKey: newKey(), expectedUpdatedAt: specialContract.updatedAt },
    sales,
    400,
  );
  eq(
    await db.approval.count({ where: { tenantId: customer.tenantId, bizType: 'contract', bizId: specialContract.id } }),
    0,
    'Invalid form leaves no partial approval',
  );
  await command(sales, 'contracts', specialContract, 'submit', { form: { reason: '设计器字段联动验证' } });
  const pendingContract = await detail(sales, 'contracts', specialContract);
  await call(`/approvals/${pendingContract.approvalId}/withdraw`, 'POST', { requestKey: newKey() }, sales, 201);
  eq((await detail(sales, 'contracts', specialContract)).status, 'draft', 'Withdraw callback');
  await create(admin, 'products', {
    name: '合成测试产品',
    code: `P${Date.now()}`,
    category: 'service',
    unit: '项',
    listPrice: '1500',
    taxRate: 6,
  });
  const role = await db.role.findFirstOrThrow({ where: { tenantId: customer.tenantId, code: 'sales' } });
  const permissions = role.permissions;
  try {
    await db.role.update({
      where: { id: role.id },
      data: { permissions: permissions.filter((p) => p !== 'customer:read') },
    });
    await call('/workspace/customers', 'GET', undefined, sales, 403);
  } finally {
    await db.role.update({ where: { id: role.id }, data: { permissions } });
  }
  const audits = await db.auditLog.count({ where: { tenantId: customer.tenantId, userId: salesUser.id } });
  assert(audits > 10);
  checks++;
  console.log(
    `PASS ${checks} real-MySQL checks: four roles, row scopes, concurrency, idempotency, approval designer/reject/withdraw, lead-to-project, finance read-only, MCP and audit.`,
  );
} catch (error) {
  process.stderr.write(log.slice(-16000));
  throw error;
} finally {
  api.kill('SIGTERM');
  await db.$disconnect();
}
