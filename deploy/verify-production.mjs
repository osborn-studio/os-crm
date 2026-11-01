import assert from 'node:assert/strict';
const base = process.env.CRM_URL || 'http://127.0.0.1:3000';
assert.equal((await fetch(base)).status, 200);
assert.equal((await fetch(base + '/api/v1/health/ready')).status, 200);
const response = await fetch(base + '/api/v1/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tenantCode: process.env.TENANT_CODE, username: process.env.ADMIN_USERNAME || 'admin', password: process.env.SEED_ADMIN_PASSWORD }),
});
assert(response.ok, 'Company administrator login');
const token = (await response.json()).data.accessToken;
const headers = { Authorization: `Bearer ${token}` };
for (const path of ['/workspace/overview', '/workspace/schema', '/approvals/schema']) {
  const r = await fetch(base + '/api/v1' + path, { headers });
  assert(r.ok, path);
  if (path === '/workspace/overview' && process.argv.includes('--expect-empty')) assert.equal((await r.json()).data.customers, 0, 'First install has no demo customers');
}
// Only CI, never an unannounced mutation in the operator's normal acceptance command.
if (process.env.DEPLOYMENT_FIXTURE) {
  const name = process.env.DEPLOYMENT_FIXTURE;
  assert.match(name, /^ci-persistence-[0-9]+$/);
  if (process.argv.includes('--create-fixture')) {
    const r = await fetch(base + '/api/v1/workspace/customers', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ requestKey: crypto.randomUUID(), data: { name, remark: 'Synthetic production installation CI fixture' } }) });
    assert.equal(r.status, 201);
  }
  const r = await fetch(base + '/api/v1/workspace/customers?keyword=' + encodeURIComponent(name), { headers });
  assert(r.ok && (await r.json()).data.items.some(c => c.name === name), 'Fixture survives restart or restore');
}
console.log('Installation verification passed: UI, health, company login, contracts and optional CI persistence.');
