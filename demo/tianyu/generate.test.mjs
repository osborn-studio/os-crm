import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate, exportData, accounts } from './generate.mjs';
import { installTianyu } from '../../scripts/tianyu-demo.mjs';
const data = generate(),
  rows = (m) => data.get(m),
  by = (m) => new Map(rows(m).map((r) => [r.id, r]));
const cents = (n) => Math.round(Number(n) * 100);
test('deterministic public synthetic archive and scale', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tianyu-'));
  try {
    const first = exportData(dir);
    exportData(dir);
    assert.equal(
      createHash('sha256')
        .update(readFileSync(join(dir, 'data.jsonl.gz')))
        .digest('hex'),
      first.sha256,
    );
    assert.equal(rows('customer').length, 15000);
    assert.equal(new Set(rows('customer').map((c) => c.nameFingerprint)).size, 15000);
    assert.equal(rows('opportunity').length, 2400);
    assert.equal(rows('followUp').length, 9000);
    assert.equal(accounts.length, 14);
    assert(first.accounts.every((a) => a.password === '12345'));
    assert(rows('customer').every((c) => c.website.startsWith('https://example.invalid/')));
    assert(rows('contact').every((c) => c.email.endsWith('@example.invalid') && !c.phone));
  } finally {
    rmSync(dir, { recursive: true });
  }
});
test('contract, invoice, payment-plan and receipt balances reconcile in cents', () => {
  const contracts = by('contract'),
    plans = by('paymentPlan'),
    receipts = by('receipt');
  for (const c of contracts.values()) {
    const ps = rows('paymentPlan').filter((p) => p.contractId === c.id);
    if (!ps.length) continue;
    assert.equal(
      ps.reduce((s, p) => s + cents(p.amount), 0),
      cents(c.amount),
    );
    assert.equal(
      ps.reduce((s, p) => s + cents(p.receivedAmount), 0),
      cents(c.totalReceived),
    );
    assert.equal(
      ps.reduce((s, p) => s + cents(p.outstandingAmount), 0),
      cents(c.totalOutstanding),
    );
  }
  for (const inv of rows('invoice')) {
    assert(contracts.has(inv.contractId));
    assert.equal(cents(inv.amount), cents(inv.amountExclTax) + cents(inv.taxAmount));
  }
  for (const a of rows('receiptAllocation')) {
    assert(plans.has(a.paymentPlanId));
    assert(receipts.has(a.receiptId));
    assert.equal(plans.get(a.paymentPlanId).contractId, receipts.get(a.receiptId).contractId);
  }
  for (const r of receipts.values()) {
    assert.equal(cents(r.amount), cents(r.allocatedAmount) + cents(r.unallocatedAmount));
    assert.equal(
      rows('receiptAllocation')
        .filter((a) => a.receiptId === r.id)
        .reduce((s, a) => s + cents(a.amount), 0),
      cents(r.allocatedAmount),
    );
  }
});
test('order totals and delivery quantities are consistent', () => {
  const orders = by('order');
  for (const line of rows('orderItem')) {
    const o = orders.get(line.orderId);
    assert.equal(cents(line.quantity * Number(line.unitPrice)), cents(o.totalAmountInclTax));
    assert.equal(cents(line.amount), cents(o.totalAmountInclTax));
    assert.equal(cents(o.totalAmount) + cents(o.totalTax), cents(o.totalAmountInclTax));
    assert(line.deliveredQty <= line.quantity);
  }
});
test('approval groups and project references use existing fictional people', () => {
  const users = new Set(accounts.map((a) => a.id)),
    approvals = by('approval'),
    projects = by('project'),
    milestones = by('projectMilestone');
  for (const n of rows('approvalNode')) {
    assert(approvals.has(n.approvalId));
    assert(users.has(n.approverId));
  }
  const group = rows('approvalNode').filter((n) => n.approvalId === 10041);
  assert.equal(group.length, 2);
  assert(group.every((n) => n.action === 'pending'));
  for (const t of rows('projectTask')) {
    assert(projects.has(t.projectId));
    assert.equal(milestones.get(t.milestoneId).projectId, t.projectId);
    assert(users.has(t.assigneeId));
  }
});
test('installer rejects production, wrong company, unapproved and remote targets before database access', async () => {
  const valid = {
    TENANT_CODE: 'TIANYU',
    ACCOUNT_PURPOSE: 'test',
    TIANYU_ALLOW_SEED: 'true',
    DATABASE_URL: 'mysql://demo:demo@127.0.0.1/tb_crm_test_tianyu_unit',
  };
  const db = new Proxy(
    {},
    {
      get() {
        throw Error('database must not be accessed');
      },
    },
  );
  for (const patch of [
    { TENANT_CODE: 'TINGMENG' },
    { ACCOUNT_PURPOSE: 'business' },
    { TIANYU_ALLOW_SEED: 'false' },
    { DATABASE_URL: 'mysql://demo:demo@example.invalid/tb_crm_test_tianyu_unit' },
    { DATABASE_URL: 'mysql://demo:demo@localhost/business' },
  ])
    await assert.rejects(
      installTianyu(db, { ...valid, ...patch }),
      (e) => !String(e).includes('database must not be accessed'),
    );
});
test('project progress reflects completed milestone weights and all milestones have a responsible owner', () => {
  for (const project of rows('project')) {
    const ms = rows('projectMilestone').filter((m) => m.projectId === project.id);
    assert.equal(
      ms.reduce((s, m) => s + (m.status === 'completed' ? m.weight : 0), 0),
      project.progress,
    );
    assert(ms.every((m) => m.ownerId === 1200));
  }
});
