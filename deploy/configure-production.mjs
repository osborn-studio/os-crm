import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { validateProduction } from './policy.mjs';
const target = process.argv[2] || 'deploy/production.env';
if (existsSync(target)) throw new Error('Configuration already exists. Preserved; use start-production to restart.');
const hex = () => randomBytes(32).toString('hex');
const config = validateProduction({
  DEMO_MODE: 'false', TENANT_CODE: process.env.TENANT_CODE,
  TENANT_NAME: process.env.TENANT_NAME, ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD,
  MYSQL_ROOT_PASSWORD: hex(), MYSQL_PASSWORD: hex(), JWT_SECRET: hex(), ENCRYPTION_KEY: hex(), BACKUP_KEY: hex(),
  DB_NAME: 'tb_crm', WEB_PORT: process.env.WEB_PORT || '3000', APP_URL: process.env.APP_URL || `http://localhost:${process.env.WEB_PORT || '3000'}`,
});
// Values containing whitespace are quoted using the Node/Docker common dotenv subset.
if (/["'\\$#]/.test(config.TENANT_NAME)) throw new Error('TENANT_NAME cannot contain quotes, backslashes, $ or #');
writeFileSync(target, Object.entries(config).map(([k, v]) => `${k}='${v}'`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
console.log('Created independent production configuration. Keep production.env and an offline copy of BACKUP_KEY private.');
