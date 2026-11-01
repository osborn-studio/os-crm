import { spawn, spawnSync } from 'node:child_process';
import { existsSync, openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
if (process.env.DEMO_MODE !== 'true') throw new Error('Set DEMO_MODE=true for the local demonstration');
const target = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(target.hostname) || !/^\/tb_crm_demo(?:_\d+)?$/.test(target.pathname))
  throw new Error('演示启动器仅允许本机独立tb_crm_demo数据库');
let connected = false;
try {
  await db.$connect();
  connected = true;
} catch {}
if (!connected) {
  const base =
      process.env.TB_CRM_MYSQL_HOME || join(homedir(), '.local/share/tb-crm-runtime/mysql-8.4.11-macos15-arm64'),
    dir = resolve(base, '..'),
    data = join(dir, 'demo-data');
  if (!existsSync(join(base, 'bin/mysqld')) || !existsSync(data))
    throw new Error('请先安装并初始化MySQL，或启动docker compose中的mysql服务');
  const log = openSync(join(dir, 'mysql-launch.log'), 'a');
  const mysql = spawn(
    join(base, 'bin/mysqld'),
    [
      '--no-defaults',
      `--basedir=${base}`,
      `--datadir=${data}`,
      '--bind-address=127.0.0.1',
      '--port=3307',
      '--mysqlx=OFF',
      `--socket=${join(dir, 'mysql.sock')}`,
      `--log-error=${join(dir, 'mysql.log')}`,
      `--pid-file=${join(dir, 'mysql.pid')}`,
    ],
    { detached: true, stdio: ['ignore', log, log] },
  );
  mysql.unref();
  for (let i = 0; i < 30; i++) {
    await delay(500);
    try {
      await db.$connect();
      connected = true;
      break;
    } catch {}
  }
  if (!connected) throw new Error('MySQL启动失败，请查看本机运行目录日志');
}
await db.$disconnect();
const migrated = spawnSync('pnpm', ['--filter', '@partneros/database', 'migrate:deploy'], { stdio: 'inherit' });
if (migrated.status !== 0) process.exit(migrated.status ?? 1);
if (!existsSync('apps/api/dist/main.js') || !existsSync('apps/web/dist/index.html')) {
  const r = spawnSync('pnpm', ['build'], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const api = spawn(process.execPath, ['dist/main.js'], {
  cwd: 'apps/api',
  env: { ...process.env, HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
api.stdout.on('data', (c) => {
  log += c;
});
api.stderr.on('data', (c) => {
  log += c;
  process.stderr.write(c);
});
let ready = false;
for (let i = 0; i < 60; i++) {
  if (api.exitCode !== null) throw new Error(log.slice(-3000));
  try {
    ready = (await fetch(`http://127.0.0.1:${process.env.PORT || 4000}/api/v1/health/ready`)).ok;
  } catch {}
  if (ready) break;
  await delay(250);
}
if (!ready) {
  api.kill();
  throw new Error('API启动超时');
}
const web = spawn(process.execPath, ['scripts/serve-web.mjs'], { env: process.env, stdio: 'inherit' });
console.log('伴圆CRM演示已启动： http://localhost:3000 ；账号见本机 .local/演示账号.md；Ctrl+C停止网页和API。');
const stop = () => {
  api.kill('SIGTERM');
  web.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
api.on('exit', () => web.kill());
web.on('exit', () => api.kill());
