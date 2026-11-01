// Run on the host with Node 24. Never overwrites or drops an existing database.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { encodeBackup, decodeBackup, MAX_SQL_BYTES } from './backup-format.mjs';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const [command, filename, restoreDatabase] = process.argv.slice(2);
if (!['backup', 'restore'].includes(command) || !filename) throw new Error('Usage: node --env-file=deploy/production.env deploy/data.mjs backup FILE | restore FILE tb_crm_restore_NAME');
const native = process.env.DB_TRANSPORT === 'native';
const database = native ? new URL(process.env.DATABASE_URL).pathname.slice(1) : process.env.DB_NAME || 'tb_crm';
if (!/^[a-zA-Z0-9_]{1,64}$/.test(database)) throw new Error('Invalid source database');
const composeFile = process.env.CRM_COMPOSE_ENV || 'deploy/production.env';
const schemaSha256 = createHash('sha256').update(readFileSync('packages/database/prisma/schema.prisma')).digest('hex');
function run(tool, args, input, root = false) {
  let executable, parameters, env = { ...process.env };
  if (native) {
    const url = new URL(process.env.DATABASE_URL);
    executable = process.env.MYSQL_BIN_DIR ? join(process.env.MYSQL_BIN_DIR, tool) : tool;
    parameters = ['--protocol=TCP', '--host=' + url.hostname, '--port=' + (url.port || 3306), '--user=' + url.username, ...args];
    env.MYSQL_PWD = decodeURIComponent(url.password);
  } else {
    executable = 'docker';
    // Only fixed command text; credentials are expanded inside the container, never in host arguments.
    const script = root ? 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec "$@"' : 'MYSQL_PWD="$MYSQL_PASSWORD" exec "$@"';
    parameters = ['compose', '--env-file', composeFile, '-f', 'deploy/compose.production.yml', 'exec', '-T', 'mysql', 'sh', '-c', script, 'crm-data', tool, '--user=' + (root ? 'root' : 'crm'), ...args];
  }
  const result = spawnSync(executable, parameters, { input, env, encoding: 'utf8', maxBuffer: MAX_SQL_BYTES, timeout: 300000 });
  if (result.error || result.status !== 0) throw new Error(`Database ${tool} failed; target was not promoted. ${result.error?.message || result.stderr?.slice(0, 600) || ''}`);
  return result.stdout;
}
const query = (sql, db, root = false) => run('mysql', ['--batch', '--skip-column-names', ...(db ? [db] : []), '--execute', sql], undefined, root);
const tables = ['tenants', 'users', 'roles', 'customers', 'contacts', 'opportunities', 'contracts', 'orders', 'projects', 'payment_plans', 'receipts', 'audit_logs'];
function counts(db, root = false) {
  return Object.fromEntries(tables.map(table => [table, Number(query(`SELECT COUNT(*) FROM \`${table}\``, db, root).trim())]));
}
if (command === 'backup') {
  const configNames = ['DEMO_MODE', 'TENANT_CODE', 'TENANT_NAME', 'ADMIN_USERNAME', 'SEED_ADMIN_PASSWORD', 'MYSQL_ROOT_PASSWORD', 'MYSQL_PASSWORD', 'JWT_SECRET', 'ENCRYPTION_KEY', 'DB_NAME', 'WEB_PORT', 'APP_URL'];
  const configuration = Object.fromEntries(configNames.filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));
  const sql = run('mysqldump', ['--single-transaction', '--skip-lock-tables', '--no-tablespaces', '--set-gtid-purged=OFF', '--hex-blob', database]);
  const snapshot = { format: 1, createdAt: new Date().toISOString(), database, configuration, schemaSha256, sql, sqlSha256: createHash('sha256').update(sql).digest('hex') };
  const file = resolve(filename);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, encodeBackup(snapshot, process.env.BACKUP_KEY), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ action: 'backup', file, source: database, sqlBytes: Buffer.byteLength(sql), encrypted: true }));
} else {
  if (!/^tb_crm_restore_[a-z0-9_]{1,40}$/.test(restoreDatabase || '')) throw new Error('Restore requires a new tb_crm_restore_NAME database');
  if (statSync(filename).size > 192 * 1024 * 1024) throw new Error('Backup exceeds supported size');
  const snapshot = decodeBackup(readFileSync(filename), process.env.BACKUP_KEY);
  if (snapshot.schemaSha256 !== schemaSha256) throw new Error('Backup schema differs from this checkout. Restore using the matching source version first');
  // SQL is authenticated by the operator's separate backup key; never import unauthenticated input.
  // Generated mysqldump never changes the selected database. Reject hand-crafted cross-database dumps.
  if (/^\s*(?:USE\s|CREATE\s+DATABASE|DROP\s+DATABASE|SOURCE\s|\\!)/im.test(snapshot.sql)) throw new Error('Backup must contain a single-database dump');
  const configPath = resolve(filename + '.' + restoreDatabase + '.env');
  const receiptPath = resolve(filename + '.' + restoreDatabase + '.receipt.json');
  const { existsSync } = await import('node:fs');
  if (existsSync(configPath) || existsSync(receiptPath)) throw new Error('Restore output already exists; no database changes made');
  // CREATE without IF NOT EXISTS refuses any existing target, even one left by an interrupted restore.
  query(`CREATE DATABASE \`${restoreDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, undefined, true);
  run('mysql', [restoreDatabase], snapshot.sql, true);
  const restoredCounts = counts(restoreDatabase, true);
  if (!native) query(`GRANT ALL PRIVILEGES ON \`${restoreDatabase}\`.* TO 'crm'@'%'`, undefined, true);
  const recovered = { ...snapshot.configuration,
    MYSQL_ROOT_PASSWORD: process.env.MYSQL_ROOT_PASSWORD || snapshot.configuration.MYSQL_ROOT_PASSWORD,
    MYSQL_PASSWORD: process.env.MYSQL_PASSWORD || snapshot.configuration.MYSQL_PASSWORD,
    DB_NAME: restoreDatabase, BACKUP_KEY: process.env.BACKUP_KEY,
    JWT_SECRET: randomBytes(32).toString('hex'), // A restored copy invalidates old sessions.
  };
  writeFileSync(configPath, Object.entries(recovered).filter(([,v]) => v !== undefined).map(([k,v]) => `${k}=${JSON.stringify(v)}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
  const receipt = { action: 'restore', source: snapshot.database, target: restoreDatabase, backupCreatedAt: snapshot.createdAt, restoredAt: new Date().toISOString(), sqlSha256: snapshot.sqlSha256, counts: restoredCounts, configPath, promoted: false };
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify(receipt));
}
