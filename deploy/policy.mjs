// Shared by the installer, container startup and installation tests.
import { createHash } from 'node:crypto';
const publicDemoKeyFingerprints = new Set([
  '99cf0fe4c3a0b3d5bcb3f29dcccd23abdb8fb0f3b0799009ce978a0eb8a126a8',
  '0574c2ffed91d73063ec1bc6ad702dfd44019afed2a239d7a75af1ca8ffe430d',
]);
export function strongPassword(value) {
  return typeof value === 'string' && value.length >= 12 && value.length <= 72 &&
    /^[A-Za-z0-9!@#%^*+_.-]+$/.test(value) && /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value);
}

export function validateProduction(env) {
  if (env.DEMO_MODE !== 'false') throw new Error('Production installation requires DEMO_MODE=false');
  if (!/^[A-Z][A-Z0-9_-]{1,29}$/.test(env.TENANT_CODE || '')) throw new Error('TENANT_CODE: use 2-30 uppercase letters, digits, _ or -');
  if (!env.TENANT_NAME?.trim() || env.TENANT_NAME.length > 100 || /[\x00-\x1f\x7f]/.test(env.TENANT_NAME)) throw new Error('TENANT_NAME is required (1-100 printable characters)');
  if (!strongPassword(env.SEED_ADMIN_PASSWORD)) throw new Error('Administrator password: 12-72 supported characters, with upper/lowercase letters and digits');
  for (const name of ['JWT_SECRET', 'ENCRYPTION_KEY', 'BACKUP_KEY']) {
    if (!/^[a-f0-9]{64}$/.test(env[name] || '') || new Set(env[name]).size < 8) throw new Error(`${name} must be an independent random 32-byte hexadecimal key`);
    if (publicDemoKeyFingerprints.has(createHash('sha256').update(env[name]).digest('hex'))) throw new Error(`${name} is a publicly shared demo key; generate a new key`);
  }
  if (new Set([env.JWT_SECRET, env.ENCRYPTION_KEY, env.BACKUP_KEY]).size !== 3) throw new Error('Signing, encryption and backup keys must be independent');
  if (/[\x00-\x20\x7f]/.test(env.APP_URL || '')) throw new Error('APP_URL cannot contain whitespace or control characters');
  const url = new URL(env.APP_URL || '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('APP_URL must be an HTTP(S) origin');
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Remote APP_URL requires HTTPS via a reverse proxy');
  if (!/^[a-zA-Z0-9_-]{2,40}$/.test(env.ADMIN_USERNAME || 'admin')) throw new Error('Invalid administrator username');
  const port = Number(env.WEB_PORT || 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('WEB_PORT must be 1024-65535');
  return env;
}
