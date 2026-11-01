import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { validateProduction } from './policy.mjs';
import { initializeProduction } from './initialize-production.mjs';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const demo = process.env.DEMO_MODE === 'true';
if (!demo) validateProduction(process.env);
const target = new URL(process.env.DATABASE_URL);
if (demo && target.pathname !== '/tb_crm_demo') throw new Error('Demo container only initializes tb_crm_demo');
if (!demo && !/^\/tb_crm(?:_restore_[a-z0-9_]{1,40})?$/.test(target.pathname)) throw new Error('Invalid production database name');
function run(args) {
  // Runtime must never ask pnpm to reconcile a root-built dependency tree after
  // switching to the unprivileged node user (or attempt network installation).
  const r = spawnSync(process.execPath, args, { cwd: 'packages/database', stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`Setup failed: ${args.join(' ')}`);
}
run(['--env-file-if-exists=../../.env', 'node_modules/prisma/build/index.js', 'migrate', 'deploy']);
const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
// Seed exactly once. Restarting an edited demo must preserve its data and users.
const tenant = demo ? await db.tenant.findUnique({ where: { code: 'TINGMENG' } }) : null;
if (!demo) {
  console.log(JSON.stringify(await initializeProduction(db, process.env)));
} else if (!tenant?.config?.demoInitializationComplete) {
  run(['--env-file=../../.env', '--import', 'tsx', 'prisma/seed.ts']);
  run(['--env-file=../../.env', '--import', 'tsx', 'prisma/demo.ts']);
  const initialized = await db.tenant.findUniqueOrThrow({ where: { code: 'TINGMENG' } });
  await db.tenant.update({ where: { id: initialized.id }, data: { config: { ...initialized.config, demoInitializationComplete: true } } });
}
await db.$disconnect();
const api = spawn(process.execPath, ['dist/main.js'], { cwd: 'apps/api', stdio: 'inherit' });
let ready = false;
for (let i = 0; i < 120; i++) {
  if (api.exitCode !== null) throw new Error('API exited before readiness');
  try { ready = (await fetch('http://127.0.0.1:4000/api/v1/health/ready')).ok; } catch {}
  if (ready) break;
  await delay(250);
}
if (!ready) { api.kill(); throw new Error('API readiness timed out'); }
const web = spawn(process.execPath, ['scripts/serve-web.mjs'], { stdio: 'inherit' });
const stop = () => { api.kill('SIGTERM'); web.kill('SIGTERM'); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
api.on('exit', (code) => { process.exitCode = code || 0; web.kill(); });
web.on('exit', (code) => { process.exitCode = code || 0; api.kill(); });
