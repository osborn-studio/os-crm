// Integration test: explicitly supplied disposable MySQL database only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeProduction } from './initialize-production.mjs';
import { decodeBackup, encodeBackup } from './backup-format.mjs';
const target = new URL(process.env.DATABASE_URL);
if (!/^tb_crm_test_[a-z0-9_]+$/.test(target.pathname.slice(1)) || process.env.SMOKE_ALLOW_WRITES !== 'true') throw new Error('Requires SMOKE_ALLOW_WRITES=true and disposable tb_crm_test_* database');
const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const dir = mkdtempSync(join(tmpdir(), 'crm-recovery-'));
const hex = () => randomBytes(32).toString('hex');
const env = { ...process.env, DEMO_MODE: 'false', TENANT_CODE: 'INSTALLTEST', TENANT_NAME: '安装恢复测试企业', ADMIN_USERNAME: 'admin', SEED_ADMIN_PASSWORD: 'Private-Test-Password-2026', JWT_SECRET: hex(), ENCRYPTION_KEY: hex(), BACKUP_KEY: hex(), APP_URL: 'http://localhost:3000', DB_TRANSPORT: 'native' };
let api;
let restored;
let checks = 0;
const ok = (value, label) => { assert(value, label); checks++; };
function data(command, file, name, overrides = {}, expectedSuccess = true) {
  const result = spawnSync(process.execPath, ['deploy/data.mjs', command, file, ...(name ? [name] : [])], { env: { ...env, ...overrides }, encoding: 'utf8' });
  ok(expectedSuccess ? result.status === 0 : result.status !== 0, result.stderr || command);
  return result.stdout;
}
try {
  ok((await db.tenant.count()) === 0, 'Fresh database required');
  const result = await initializeProduction(db, env);
  ok(result.initialized, 'First initialization');
  ok((await db.user.count()) === 1, 'Only administrator created');
  ok((await db.role.count()) === 4, 'Four roles');
  for (const model of ['customer', 'contact', 'contract', 'opportunity', 'order', 'project', 'receipt', 'invoice']) ok((await db[model].count()) === 0, model + ' has no synthetic business');
  const admin = await db.user.findFirstOrThrow();
  await db.user.update({ where: { id: admin.id }, data: { name: '已修改管理员' } });
  await db.customer.create({ data: { tenantId: result.tenantId, name: '恢复校验合成客户', code: 'RESTORE-TEST', ownerId: admin.id, createdBy: admin.id } });
  const repeat = await initializeProduction(db, { ...env, SEED_ADMIN_PASSWORD: 'Changed-Test-Password-2026', TENANT_NAME: '禁止覆盖名称' });
  ok(!repeat.initialized, 'Restart does not reinitialize');
  const unchanged = await db.user.findFirstOrThrow();
  ok(unchanged.name === '已修改管理员' && unchanged.passwordHash === admin.passwordHash, 'Restart preserves password and user edits');
  ok((await db.tenant.findFirstOrThrow()).name === env.TENANT_NAME, 'Restart preserves company');
  await assert.rejects(initializeProduction(db, { ...env, TENANT_CODE: 'OTHERCOMPANY' })); checks++;
  ok((await db.tenant.count()) === 1, 'Cannot initialize a second company into an occupied database');
  const file = join(dir, 'installation.crmbackup');
  data('backup', file);
  const bytes = readFileSync(file);
  ok(!bytes.includes(Buffer.from('恢复校验合成客户')), 'Backup encrypted');
  data('backup', file, undefined, {}, false); // No accidental overwrite.
  const name = 'tb_crm_restore_test_' + Date.now();
  data('restore', file, name, { BACKUP_KEY: hex() }, false);
  ok((await db.$queryRaw`SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ${name}`).length === 0, 'Wrong key creates no database');
  const corrupt = join(dir, 'tampered.crmbackup'); bytes[30] ^= 1; writeFileSync(corrupt, bytes);
  data('restore', corrupt, name, {}, false);
  ok((await db.$queryRaw`SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ${name}`).length === 0, 'Tampering creates no database');
  const mismatched = join(dir, 'other-schema.crmbackup');
  const changedSchema = decodeBackup(readFileSync(file), env.BACKUP_KEY);
  changedSchema.schemaSha256 = 'unmatched';
  writeFileSync(mismatched, encodeBackup(changedSchema, env.BACKUP_KEY));
  data('restore', mismatched, name, {}, false);
  ok((await db.$queryRaw`SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ${name}`).length === 0, 'Schema mismatch creates no database');
  const restoredResult = JSON.parse(data('restore', file, name));
  ok(restoredResult.promoted === false && restoredResult.counts.customers === 1, 'Fresh clone restored, never auto-promoted');
  const cloneUrl = new URL(target); cloneUrl.pathname = '/' + name;
  restored = new PrismaClient({ datasources: { db: { url: cloneUrl.href } } });
  ok((await restored.customer.findFirstOrThrow()).name === '恢复校验合成客户', 'Customer restored exactly');
  ok((await restored.user.findFirstOrThrow()).passwordHash === admin.passwordHash, 'Password hash preserved');
  ok((await restored.auditLog.count()) === (await db.auditLog.count()), 'Audit trail preserved');
  data('restore', file, name, {}, false);
  const duplicate = join(dir, 'duplicate.crmbackup'); writeFileSync(duplicate, readFileSync(file));
  data('restore', duplicate, name, {}, false); // Existing database, even with different output paths.
  ok((await restored.customer.count()) === 1, 'Existing clone preserved');
  ok((await db.customer.count()) === 1 && (await db.user.findFirstOrThrow()).name === '已修改管理员', 'Source database unchanged');
  const { parseEnv } = await import('node:util');
  const recovered = parseEnv(readFileSync(restoredResult.configPath, 'utf8'));
  ok(recovered.ENCRYPTION_KEY === env.ENCRYPTION_KEY, 'Encryption key recovered');
  ok(recovered.JWT_SECRET !== env.JWT_SECRET, 'Sessions rotated on clone');
  ok(recovered.DB_NAME === name, 'Recovered config selects clone');
  api = spawn(process.execPath, ['apps/api/dist/main.js'], { env: { ...env, ...recovered, DATABASE_URL: cloneUrl.href, PORT: '4097', HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; api.stdout.on('data', b => { log = (log + b).slice(-8000); }); api.stderr.on('data', b => { log = (log + b).slice(-8000); });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (api.exitCode !== null) throw new Error('Restored API failed: ' + log);
    try { ready = (await fetch('http://127.0.0.1:4097/api/v1/health/ready')).ok; } catch {}
    if (ready) break; await delay(250);
  }
  ok(ready, 'Restored API starts');
  const response = await fetch('http://127.0.0.1:4097/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantCode: env.TENANT_CODE, username: 'admin', password: env.SEED_ADMIN_PASSWORD }) });
  ok(response.ok, 'Company administrator logs into restored clone');
  const token = (await response.json()).data.accessToken;
  const customers = await fetch('http://127.0.0.1:4097/api/v1/workspace/customers', { headers: { Authorization: `Bearer ${token}` } });
  ok(customers.ok && (await customers.json()).data.items.some(c => c.name === '恢复校验合成客户'), 'Restored business readable through authenticated API');
  console.log(JSON.stringify({ checks, installation: true, noDemoData: true, restartPreservesUsers: true, encryptedBackup: true, tamperFailsBeforeWrite: true, restoreIntoNewDatabase: true, sourcePreserved: true, restoredApiLogin: true }));
} finally {
  if (api) { api.kill('SIGTERM'); await Promise.race([new Promise(resolve => api.once('exit', resolve)), delay(3000)]); }
  if (restored) await restored.$disconnect();
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
}
