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
    if (path === '/workspace/overview') {
      const actorId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub;
      const expectedRange=['admin','boss'].includes(username)?'company':username==='manager'?'department':'self';
      assert.equal(data.audience.personRange,expectedRange,'Role default matches owner-approved scope');
      if(expectedRange==='company')assert.equal(data.audience.ownerIds,null,'Company default is not restricted to the actor');
      else assert(data.audience.ownerIds.includes(actorId),'Personal/team scope includes the actor');
      const opts=await fetch(base+'/api/v1/workspace/statistics-options',{headers:{Authorization:`Bearer ${token}`}});
      assert.equal(opts.status,200);const options=(await opts.json()).data;
      const selected=expectedRange==='department'?`department&deptId=${options.defaultDeptId}`:expectedRange;
      const customers=await fetch(base+'/api/v1/workspace/customers?personRange='+selected+'&pageSize=1',{headers:{Authorization:`Bearer ${token}`}});
      assert.equal(customers.status,200);assert.equal(data.customers,(await customers.json()).data.meta.total,'Role overview matches its business records');
      const own=await fetch(base+'/api/v1/workspace/overview?personRange=self',{headers:{Authorization:`Bearer ${token}`}});
      assert.equal(own.status,200);assert.deepEqual((await own.json()).data.audience,{personRange:'self',ownerIds:[actorId]},'Explicit self remains personal for every role');
      const company = await fetch(base + '/api/v1/workspace/overview?personRange=company', {headers:{Authorization:`Bearer ${token}`}});
      if (['admin','boss'].includes(username)) {
        assert.equal(company.status,200,'Company scope explicitly authorized');
        const all = (await company.json()).data;
        assert.deepEqual(all.audience,{personRange:'company',ownerIds:null});
        assert(all.customers > 0,'Synthetic company fixtures visible under authorized company selection');
      } else assert.equal(company.status,403,'Unprivileged role cannot select company scope');
    }
  }
  console.log(username + ': login, overview and schemas OK');
}
console.log('Deployment read-only acceptance passed.');
