import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { validateProduction } from './policy.mjs';
import { encodeBackup, decodeBackup } from './backup-format.mjs';
const hex = () => randomBytes(32).toString('hex');
const settings = () => ({ DEMO_MODE: 'false', TENANT_CODE: 'ACME', TENANT_NAME: '测试企业 Test Company', SEED_ADMIN_PASSWORD: 'Installer-Test-Password-2026', JWT_SECRET: hex(), ENCRYPTION_KEY: hex(), BACKUP_KEY: hex(), APP_URL: 'http://localhost:3000' });
test('production refuses weak/demo passwords, unsafe company code, reused keys and remote HTTP', () => {
  const valid = settings();
  assert.equal(validateProduction(valid), valid);
  for (const change of [
    { DEMO_MODE: 'true' }, { SEED_ADMIN_PASSWORD: '12345' }, { SEED_ADMIN_PASSWORD: 'abcdefghijkl' },
    { TENANT_CODE: 'bad\nINJECTED=value' }, { TENANT_NAME: 'name\nvalue' }, { TENANT_NAME: 'name\0value' },
    { ENCRYPTION_KEY: valid.JWT_SECRET }, { JWT_SECRET: '0'.repeat(64) }, { APP_URL: 'http://crm.example.com' },
    { APP_URL: 'https://user:secret@crm.example.com' }, { APP_URL: 'https://crm.example.com/path' }, { APP_URL: 'http://local\nhost:3000' }, { WEB_PORT: 'NaN' },
  ]) assert.throws(() => validateProduction({ ...valid, ...change }));
  assert.doesNotThrow(() => validateProduction({ ...valid, APP_URL: 'https://crm.example.com' }));
});
test('installer generates private, independent secrets; preserves existing configuration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crm-install-'));
  try {
    const file = join(dir, 'production.env');
    const env = { ...process.env, ...settings() };
    const run = () => spawnSync(process.execPath, ['deploy/configure-production.mjs', file], { env, encoding: 'utf8' });
    assert.equal(run().status, 0);
    const raw = readFileSync(file, 'utf8');
    const config = parseEnv(raw);
    assert.equal(config.TENANT_NAME, env.TENANT_NAME);
    validateProduction(config);
    assert.notEqual(config.JWT_SECRET, env.JWT_SECRET);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.notEqual(run().status, 0);
    assert.equal(readFileSync(file, 'utf8'), raw);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
const snapshot = () => {
  const sql = 'CREATE TABLE synthetic (id INT); INSERT INTO synthetic VALUES (1);';
  return { format: 1, configuration: { ENCRYPTION_KEY: hex() }, sql, sqlSha256: createHash('sha256').update(sql).digest('hex') };
};
test('backup round-trip preserves database and encryption config without exposing plaintext', () => {
  const key = hex(), original = snapshot();
  const bytes = encodeBackup(original, key);
  assert.deepEqual(decodeBackup(bytes, key), original);
  assert.equal(bytes.includes(Buffer.from(original.sql)), false);
  assert.equal(bytes.includes(Buffer.from(original.configuration.ENCRYPTION_KEY)), false);
  assert.notDeepEqual(encodeBackup(original, key), bytes);
});
test('wrong key, truncated archive, tampered header/cipher/tag and incorrect SQL checksum fail closed', () => {
  const key = hex(), bytes = encodeBackup(snapshot(), key);
  assert.throws(() => decodeBackup(bytes, hex()));
  assert.throws(() => decodeBackup(bytes.subarray(0, 25), key));
  for (const position of [0, 20, 35, bytes.length - 1]) {
    const changed = Buffer.from(bytes); changed[position] ^= 1;
    assert.throws(() => decodeBackup(changed, key));
  }
  assert.throws(() => decodeBackup(encodeBackup({ ...snapshot(), sqlSha256: 'invalid' }, key), key));
});
