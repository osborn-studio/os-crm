// Read-only acceptance against a running deployment. No business mutations.
import assert from 'node:assert/strict';
const base = process.env.DEMO_URL || 'http://127.0.0.1:3000';
const ui = await fetch(base);
assert.equal(ui.status, 200);
assert.match(await ui.text(), /伴圆 CRM/);
const health = await fetch(base + '/api/v1/health/ready');
assert.equal(health.status, 200);
for (const username of ['admin', 'manager', 'sales', 'boss']) {
  const login = await fetch(base + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: process.env.SEED_ADMIN_PASSWORD }) });
  assert.equal(login.status, 200, username + ' login');
  const token = (await login.json()).data.accessToken;
  const fixture = process.env.DEPLOYMENT_FIXTURE;
  if (username === 'sales' && fixture) {
    assert.match(fixture, /^ci-persistence-[0-9]+$/, 'Only named synthetic CI fixtures allowed');
    if (process.argv.includes('--create-fixture')) {
      const created = await fetch(base + '/api/v1/workspace/customers', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requestKey: crypto.randomUUID(), data: { name: fixture, remark: 'Synthetic CI restart fixture' } }),
      });
      assert.equal(created.status, 201, 'Create synthetic persistence fixture');
    }
    const query = await fetch(base + '/api/v1/workspace/customers?keyword=' + encodeURIComponent(fixture), { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(query.status, 200);
    assert((await query.json()).data.items.some((row) => row.name === fixture), 'Created customer persists across restart');
    console.log('Synthetic persistence fixture present.');
  }
  for (const path of ['/workspace/overview', '/workspace/schema', '/approvals/schema']) {
    const res = await fetch(base + '/api/v1' + path, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200, username + path);
    const data = (await res.json()).data;
    if (path === '/workspace/overview') assert(data.customers > 0, 'Seeded data visible');
  }
  console.log(username + ': login, overview and schemas OK');
}
console.log('Deployment read-only acceptance passed.');
