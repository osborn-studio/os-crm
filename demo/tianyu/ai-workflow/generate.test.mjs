import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkflow } from './generate.mjs';
import { validateTianyuTarget, prepareManifest } from '../../../scripts/tianyu-ai-workflow.mjs';
import { readFileSync } from 'node:fs';
const pack = buildWorkflow();
test('fictional workflow preserves independent source provenance and all requested business situations', () => {
  assert.equal(pack.fictional, true);
  assert.equal(pack.containsRealCompanyData, false);
  assert.equal(pack.cases.length, 12);
  assert.equal(new Set(pack.sources.map((s) => s.id)).size, pack.sources.length);
  assert(pack.cases.every((c) => c.customerName.endsWith('（天雨示例）')));
  assert(pack.sources.every((s) => s.fictional && s.authorization.includes('仅本公开演示资料')));
  assert.deepEqual(new Set(pack.cases.map((c) => c.kind)), new Set(['lead', 'quote', 'lost', 'draft', 'reference']));
  assert.equal(pack.knowledge.filter((e) => e.evidenceStatus === 'proposed').length, 36);
});
test('business manifest does not duplicate signed opportunities or turn unknown and conflicting prices into zero', () => {
  const customers = new Map(
    pack.cases.map((c) => [
      c.customerId,
      { id: c.customerId, name: c.customerName, code: c.customerKey, updatedAt: '2026-11-16T00:00:00.000Z' },
    ]),
  );
  const m = prepareManifest(pack, customers, '00000000-0000-4000-8000-000000000001');
  assert.equal(m.cases.length, 8);
  assert(m.cases.every((c) => c.outcome !== 'won'));
  assert.equal(m.actions.length, 0);
  assert(m.cases.some((c) => c.amount === null && c.forecastEligible === false));
  for (const c of m.cases) if (c.quoteVersions?.length) assert.equal(c.amount, c.quoteVersions.at(-1).amount);
  const presentationIds = new Set(pack.sources.filter((s) => s.sourceType === 'presentation').map((s) => s.id));
  assert(m.followups.every((f) => !presentationIds.has(f.sourceId)));
  assert(m.followups.some((f) => f.kind === 'revision'));
  assert.equal(
    m.cases.find((c) => c.draft).draft.items.reduce((s, x) => s + x.manDays * Number(x.unitPrice), 0),
    17400,
  );
});
test('installer refuses business and other-company destinations before any database/network access', () => {
  const v = {
    TENANT_CODE: 'TIANYU',
    ACCOUNT_PURPOSE: 'test',
    TIANYU_ALLOW_WORKFLOW: 'true',
    DATABASE_URL: 'mysql://fixture:fixture@127.0.0.1/tb_crm_test_tianyu_unit',
  };
  validateTianyuTarget(v);
  for (const patch of [
    { TENANT_CODE: 'OTHERCO' },
    { ACCOUNT_PURPOSE: 'business' },
    { TIANYU_ALLOW_WORKFLOW: 'false' },
    { DATABASE_URL: 'mysql://fixture:fixture@remote.example/tb_crm_test_tianyu_unit' },
    { DATABASE_URL: 'mysql://fixture:fixture@127.0.0.1/production' },
  ])
    assert.throws(() => validateTianyuTarget({ ...v, ...patch }));
});
test('richer approval fixtures have enough business content, distinct reviewers and sequential/all/any paths', () => {
  const s = JSON.parse(readFileSync(new URL('../approval-scenarios.json', import.meta.url)));
  assert.equal(s.fictional, true);
  assert.equal(s.flows.length, 36);
  assert(s.fields.length >= 16 && s.fields.length <= 20);
  assert.deepEqual(new Set(s.flows.map((f) => f.mode)), new Set(['single', 'all', 'any']));
  for (const f of s.flows) {
    assert(!f.reviewers.includes(f.applicantId));
    assert.equal(f.reviewers.length, new Set(f.reviewers).size);
    assert(f.mode === 'single' || f.reviewers.length >= 2);
    assert(f.reasonTemplate.includes(f.topic));
    assert(f.evidenceTemplate.includes('TY-SP-SRC'));
  }
});
