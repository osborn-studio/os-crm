import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeProduction } from '../deploy/initialize-production.mjs';

assert.equal(process.env.SMOKE_ALLOW_WRITES, 'true');
assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/tb_crm_test_[a-z0-9_]+$/);
const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const prior = 'fd56b998d3a7488285804bb6846cd06a5e51af2d';
const scratch = await mkdtemp(join(tmpdir(), 'crm-receipt-upgrade-'));
let api,
  cloneApi,
  cloneDb,
  log = '',
  checks = 0;
const ok = (v, label) => {
  assert(v, label);
  checks++;
};
function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { env: process.env, encoding: 'utf8', ...options });
  if (r.status !== 0) throw Error('Fixture command failed: ' + cmd + ' ' + (r.stderr ?? '').slice(-1000));
  return r;
}
async function call(path, method = 'GET', body, token, expected = 200) {
  const r = await fetch('http://127.0.0.1:4119/api/v1' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const out = await r.json();
  ok(r.status === expected, `${method} ${path}: ${r.status} ${out.message ?? ''}`);
  return out.data;
}
// The current client and API write AuditLog.source/principal_label, which the prior release predates.
// Add them only while seeding through current code, then restore the exact prior shape before migrating.
const auditColumns = (add) =>
  db.$executeRawUnsafe(
    add
      ? "ALTER TABLE audit_logs ADD COLUMN source ENUM('human','agent','system','import') NOT NULL DEFAULT 'human', ADD COLUMN principal_label VARCHAR(100) NULL"
      : 'ALTER TABLE audit_logs DROP COLUMN source, DROP COLUMN principal_label',
  );
try {
  const archive = run('git', ['archive', prior, 'packages/database/prisma'], { encoding: null }).stdout;
  run('tar', ['-xf', '-', '-C', scratch], { input: archive });
  run('pnpm', [
    '--filter',
    '@partneros/database',
    'exec',
    'prisma',
    'migrate',
    'deploy',
    '--schema',
    join(scratch, 'packages/database/prisma/schema.prisma'),
  ]);
  ok(
    (
      await db.$queryRawUnsafe(
        "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='receipt_vouchers'",
      )
    )[0].n === 0n,
    'Prior release has no voucher table',
  );
  const env = {
    ...process.env,
    DEMO_MODE: 'false',
    TENANT_CODE: 'UPGRADETEST',
    TENANT_NAME: '非空收款升级合成测试',
    ADMIN_USERNAME: 'admin',
    SEED_ADMIN_PASSWORD: 'Upgrade-Only-Password-2026',
    APP_URL: 'http://localhost:3000',
    JWT_SECRET: randomBytes(32).toString('hex'),
    ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    BACKUP_KEY: randomBytes(32).toString('hex'),
  };
  await auditColumns(true);
  await initializeProduction(db, env);
  const tenant = await db.tenant.findUniqueOrThrow({ where: { code: env.TENANT_CODE } });
  const principal = await db.user.findFirstOrThrow({ where: { tenantId: tenant.id, username: 'admin' } });
  const customer = await db.customer.create({
    data: { tenantId: tenant.id, code: 'UPGRADE-C', name: '升级保留客户', ownerId: principal.id },
  });
  const fingerprint = createHash('sha256').update('UPGRADE-BANK-ID').digest('hex');
  await db.$executeRaw`INSERT INTO receipts (tenant_id,receipt_no,customer_id,amount,allocated_amount,unallocated_amount,receipt_date,status,ledger_managed,reference_key,serial_no,created_by,updated_at) VALUES (${tenant.id},'UPGRADE-ROOT',${customer.id},5.00,0.00,5.00,'2026-11-01','draft',true,${fingerprint},'UPGRADE-BANK-ID',${principal.id},CURRENT_TIMESTAMP(3))`;
  await db.$executeRaw`INSERT INTO receipts (tenant_id,receipt_no,customer_id,amount,allocated_amount,unallocated_amount,receipt_date,status,ledger_managed,reference_key,serial_no,created_by,updated_at) VALUES (${tenant.id},'UPGRADE-VOID',${customer.id},2.00,0.00,0.00,'2026-11-01','voided',true,${createHash('sha256').update('UPGRADE-VOID-ID').digest('hex')},'UPGRADE-VOID-ID',${principal.id},CURRENT_TIMESTAMP(3))`;
  await db.$executeRaw`INSERT INTO receipts (tenant_id,receipt_no,customer_id,amount,allocated_amount,unallocated_amount,receipt_date,status,ledger_managed,serial_no,updated_at) VALUES (${tenant.id},'UPGRADE-LEGACY',${customer.id},1.00,0.00,1.00,'2026-11-01','draft',false,'LEGACY-UPGRADE-ID',CURRENT_TIMESTAMP(3))`;
  const before =
    await db.$queryRaw`SELECT id,receipt_no,amount,status,reference_key,updated_at FROM receipts ORDER BY id`;
  await auditColumns(false);
  run('pnpm', ['--filter', '@partneros/database', 'migrate:deploy']);
  const receipts = await db.receipt.findMany({ where: { tenantId: tenant.id }, orderBy: { id: 'asc' } });
  ok(receipts.length === 3, 'Populated old receipts preserved');
  for (let i = 0; i < 3; i++) {
    ok(
      receipts[i].id === before[i].id &&
        receipts[i].amount.eq(before[i].amount) &&
        receipts[i].status === before[i].status &&
        receipts[i].referenceKey === before[i].reference_key &&
        receipts[i].updatedAt.getTime() === before[i].updated_at.getTime() &&
        receipts[i].replacesId === null,
      'Upgrade preserves receipt values, IDs and versions',
    );
  }
  ok(
    (await db.receiptVoucher.count({ where: { tenantId: tenant.id } })) === 2,
    'Only managed receipts with known references get voucher roots',
  );
  const voucher = await db.receiptVoucher.findUniqueOrThrow({
    where: { tenantId_referenceKey: { tenantId: tenant.id, referenceKey: fingerprint } },
  });
  ok(
    voucher.originalReceiptId === receipts[0].id && voucher.currentReceiptId === receipts[0].id,
    'Backfill points to the original managed receipt',
  );
  ok((await db.financeEvent.count()) === 0, 'Upgrade does not fabricate review or correction events');
  ok(
    (await db.user.findUniqueOrThrow({ where: { id: principal.id } })).passwordHash === principal.passwordHash,
    'Upgrade preserves passwords',
  );
  run('pnpm', ['--filter', '@partneros/database', 'migrate:deploy']);
  ok((await db.receiptVoucher.count()) === 2, 'Repeated migration does not duplicate roots');
  api = spawn(process.execPath, ['apps/api/dist/main.js'], {
    env: { ...env, PORT: '4119', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stdout.on('data', (b) => {
    log = (log + b).slice(-5000);
  });
  api.stderr.on('data', (b) => {
    log = (log + b).slice(-5000);
  });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (api.exitCode !== null) throw Error(log);
    try {
      ready = (await fetch('http://127.0.0.1:4119/api/v1/health')).ok;
    } catch {}
    if (ready) break;
    await delay(200);
  }
  ok(ready, 'Upgraded API ready');
  const auth = await call('/auth/login', 'POST', {
    username: 'admin',
    password: env.SEED_ADMIN_PASSWORD,
    tenantCode: env.TENANT_CODE,
  });
  const token = auth.accessToken;
  await call(
    '/finance-ledger/receipts',
    'POST',
    {
      requestKey: randomUUID(),
      customerId: customer.id,
      amount: '5.00',
      receiptDate: '2026-11-01',
      reference: 'UPGRADE-BANK-ID',
      note: '重复凭据应拒绝',
    },
    token,
    409,
  );
  const old = await call('/finance-ledger/receipts/' + receipts[0].id, 'GET', undefined, token);
  ok(old.canCorrect === true, 'Backfilled receipt supports explicit correction');
  const corrected = await call(
    '/finance-ledger/receipts/' + old.id + '/correct',
    'POST',
    {
      requestKey: randomUUID(),
      expectedUpdatedAt: old.updatedAt,
      customerId: customer.id,
      contractId: null,
      amount: '5.50',
      receiptDate: '2026-11-01',
      note: '非空旧版本升级后更正合成测试',
    },
    token,
    201,
  );
  const next = await call('/finance-ledger/receipts/' + corrected.id, 'GET', undefined, token);
  ok(
    next.status === 'draft' && next.amount === '5.5' && next.previous.id === old.id,
    'Upgraded receipt correction keeps history and requires new review',
  );
  ok(
    (
      await db.receiptVoucher.findUniqueOrThrow({
        where: { tenantId_referenceKey: { tenantId: tenant.id, referenceKey: fingerprint } },
      })
    ).currentReceiptId === next.id,
    'Upgraded voucher advances atomically',
  );
  const legacy = await call('/finance-ledger/receipts/' + receipts[2].id, 'GET', undefined, token);
  ok(legacy.canCorrect === false, 'Old external record remains read-only');
  const backupFile = join(scratch, 'corrections.crmbackup'),
    backupEnv = { ...env, DB_TRANSPORT: 'native' };
  run(process.execPath, ['deploy/data.mjs', 'backup', backupFile], { env: backupEnv });
  ok(!(await readFile(backupFile)).includes(Buffer.from('UPGRADE-BANK-ID')), 'Financial backup is encrypted');
  const cloneName = 'tb_crm_restore_c51_' + Date.now();
  const restore = JSON.parse(
    run(process.execPath, ['deploy/data.mjs', 'restore', backupFile, cloneName], { env: backupEnv }).stdout,
  );
  ok(restore.promoted === false, 'Financial restore never promotes or overwrites source');
  const cloneUrl = new URL(process.env.DATABASE_URL);
  cloneUrl.pathname = '/' + cloneName;
  cloneDb = new PrismaClient({ datasources: { db: { url: cloneUrl.href } } });
  const restoredVoucher = await cloneDb.receiptVoucher.findUniqueOrThrow({
    where: { tenantId_referenceKey: { tenantId: tenant.id, referenceKey: fingerprint } },
  });
  ok(
    restoredVoucher.originalReceiptId === old.id && restoredVoucher.currentReceiptId === next.id,
    'Restore preserves original/current correction linkage',
  );
  const restoredNext = await cloneDb.receipt.findUniqueOrThrow({ where: { id: next.id } });
  ok(
    restoredNext.replacesId === old.id && restoredNext.amount.eq('5.50') && restoredNext.status === 'draft',
    'Restore preserves successor amount, predecessor and review state',
  );
  assert.deepEqual(
    await cloneDb.financeEvent.findMany({ orderBy: { id: 'asc' } }),
    await db.financeEvent.findMany({ orderBy: { id: 'asc' } }),
  );
  checks++;
  ok(
    (await cloneDb.receipt.findUniqueOrThrow({ where: { id: old.id } })).referenceKey === fingerprint,
    'Restore retains occupied bank reference',
  );
  const recovered = parseEnv(await readFile(restore.configPath, 'utf8'));
  ok(
    recovered.JWT_SECRET !== env.JWT_SECRET && recovered.ENCRYPTION_KEY === env.ENCRYPTION_KEY,
    'Restore rotates sessions and preserves data encryption configuration',
  );
  cloneApi = spawn(process.execPath, ['apps/api/dist/main.js'], {
    env: { ...env, ...recovered, DATABASE_URL: cloneUrl.href, PORT: '4120', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  cloneApi.stdout.on('data', (b) => {
    log = (log + b).slice(-5000);
  });
  cloneApi.stderr.on('data', (b) => {
    log = (log + b).slice(-5000);
  });
  let cloneReady = false;
  for (let i = 0; i < 80; i++) {
    if (cloneApi.exitCode !== null) throw Error(log);
    try {
      cloneReady = (await fetch('http://127.0.0.1:4120/api/v1/health')).ok;
    } catch {}
    if (cloneReady) break;
    await delay(200);
  }
  ok(cloneReady, 'Recovered financial API starts');
  const stale = await fetch('http://127.0.0.1:4120/api/v1/finance-ledger/receipts/' + next.id, {
    headers: { Authorization: 'Bearer ' + token },
  });
  ok(stale.status === 401, 'Old source bearer cannot access restored clone');
  const relogin = await fetch('http://127.0.0.1:4120/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantCode: env.TENANT_CODE, username: 'admin', password: env.SEED_ADMIN_PASSWORD }),
  });
  ok(relogin.status === 200, 'Restored administrator logs in with preserved password');
  const cloneToken = (await relogin.json()).data.accessToken;
  const restoredRead = await fetch('http://127.0.0.1:4120/api/v1/finance-ledger/receipts/' + next.id, {
    headers: { Authorization: 'Bearer ' + cloneToken },
  });
  ok(restoredRead.status === 200, 'Restored correction readable through authenticated API');
  const restoredDetail = (await restoredRead.json()).data;
  ok(
    restoredDetail.previous.id === old.id &&
      restoredDetail.events.some((e) => e.kind === 'correction.registered') &&
      restoredDetail.canCorrect,
    'Restored chain, audit and current pointer remain usable',
  );
  ok(
    (await db.receipt.count()) === 4 &&
      (
        await db.receiptVoucher.findUniqueOrThrow({
          where: { tenantId_referenceKey: { tenantId: tenant.id, referenceKey: fingerprint } },
        })
      ).currentReceiptId === next.id,
    'Financial source remains unchanged after clone recovery',
  );
  console.log(
    JSON.stringify({
      checks,
      populatedUpgrade: true,
      priorRevision: prior,
      receiptPreservation: true,
      referenceBackfill: true,
      noFabricatedEvents: true,
      upgradedCorrection: true,
      financialBackupRecovery: true,
    }),
  );
} catch (e) {
  console.error(log.slice(-1000));
  throw e;
} finally {
  for (const child of [api, cloneApi])
    if (child) {
      child.kill('SIGTERM');
      await Promise.race([new Promise((r) => child.once('exit', r)), delay(3000)]);
    }
  if (cloneDb) await cloneDb.$disconnect();
  await db.$disconnect();
  await rm(scratch, { recursive: true, force: true });
}
