/** Public fictional fixture: confirm valve supply as business, never software commission. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { SCALE } from '../demo/tianyu/generate.mjs';
const args = process.argv.slice(2),
  index = args.indexOf('--company-config');
assert(args.includes('--confirm-fictional-tianyu') && index >= 0 && args[index + 1]);
const cfg = JSON.parse(fs.readFileSync(resolve(args[index + 1])));
assert.equal(cfg.TENANT_CODE, 'TIANYU');
assert.equal(cfg.ACCOUNT_PURPOSE, 'test');
assert.match(new URL(cfg.DATABASE_URL).pathname, /^\/tbcrm_c_[a-f0-9]{16}$/);
const base = args.includes('--base-url') ? args[args.indexOf('--base-url') + 1] : 'http://127.0.0.1:3000',
  url = new URL(base);
assert.equal(url.protocol, 'http:');
assert(['localhost', '127.0.0.1'].includes(url.hostname));
const headers = { 'Content-Type': 'application/json', 'X-Company-Code': 'TIANYU' };
async function call(path, body) {
  const r = await fetch(base + '/api/v1/' + path, {
    headers,
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60000),
  });
  const j = await r.json();
  if (!r.ok) throw Error(path + ' ' + JSON.stringify(j));
  return j.data;
}
headers.Authorization =
  'Bearer ' + (await call('auth/login', { tenantCode: 'TIANYU', username: 'admin', password: '12345' })).accessToken;
const allRows = [];
for (let page = 1; ; page++) {
  const r = await call('workspace/contracts?pageSize=100&page=' + page + '&personRange=company');
  allRows.push(...r.items);
  if (page * 100 >= r.meta.total) break;
}
const rows = allRows.filter((c) => /^TY-HT-\d{5}$/.test(c.contractNo));
assert.equal(
  rows.length,
  SCALE.contracts,
  'Expected the fixed Tianyu base contracts; imported drafts are not classified',
);
const pending = [];
let alreadyClassified = 0;
for (const c of rows.filter((c) => ['signed', 'executing', 'completed'].includes(c.status))) {
  const d = await call('trade/contracts/' + c.id);
  if (d.classification) {
    alreadyClassified++;
    continue;
  }
  pending.push({
    kind: 'contracts',
    id: c.id,
    expectedUpdatedAt: d.updatedAt,
    category: 'business',
    reason: '公开虚构天雨场景：本合同为阀门供货及配套服务，按我方业务统计；渠道客户为供货付款方，不是软件返佣。',
    sourceIds: ['synthetic:tianyu:valve-business-v1', 'crm:contract:' + c.id],
  });
}
let classified = 0;
for (let i = 0; i < pending.length; i += 40) {
  const items = pending.slice(i, i + 40),
    digest = createHash('sha256').update(JSON.stringify(items)).digest('hex').slice(0, 32);
  const r = await call('trade/classify', { requestKey: 'ty-trade-v1-' + digest, items });
  assert.deepEqual(r.externalEffects, []);
  classified += r.items.length;
}
const report = await call('analytics/business?from=2010-01-01&to=2060-12-31&personRange=company');
assert.equal(report.summary.unclassifiedCount, 0);
assert.equal(report.summary.unmatchedInvoiceCount, 0);
const proof = {
  status: 'PASS',
  company: 'TIANYU',
  classified,
  alreadyClassified,
  signedBusinessContracts: report.summary.contractCount,
  invoiceLinksComplete: true,
  financialAmountsChanged: false,
  externalEffects: 0,
};
const output = args.includes('--receipt') ? args[args.indexOf('--receipt') + 1] : '.local/tianyu-trade-proof.json';
fs.mkdirSync(resolve(output, '..'), { recursive: true });
fs.writeFileSync(output, JSON.stringify(proof, null, 2), { mode: 0o600 });
console.log(JSON.stringify(proof));
