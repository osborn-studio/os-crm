import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
const MAGIC = Buffer.from('OSCRM-BACKUP-1\n');
export const MAX_SQL_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 192 * 1024 * 1024;
function key(value) {
  if (!/^[a-f0-9]{64}$/.test(value || '') || new Set(value).size < 8) throw new Error('BACKUP_KEY must be a random 32-byte hexadecimal key');
  return Buffer.from(value, 'hex');
}
export function encodeBackup(snapshot, backupKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(backupKey), iv);
  cipher.setAAD(MAGIC);
  const payload = gzipSync(JSON.stringify(snapshot));
  return Buffer.concat([MAGIC, iv, cipher.update(payload), cipher.final(), cipher.getAuthTag()]);
}
export function decodeBackup(bytes, backupKey) {
  if (bytes.length > MAX_ARCHIVE_BYTES || bytes.length < MAGIC.length + 29 || !bytes.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Invalid backup format or size');
  const decipher = createDecipheriv('aes-256-gcm', key(backupKey), bytes.subarray(MAGIC.length, MAGIC.length + 12));
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(bytes.subarray(-16));
  // Authenticate completely before decompression and, critically, before any database write.
  const compressed = Buffer.concat([decipher.update(bytes.subarray(MAGIC.length + 12, -16)), decipher.final()]);
  const snapshot = JSON.parse(gunzipSync(compressed, { maxOutputLength: MAX_ARCHIVE_BYTES }).toString('utf8'));
  if (snapshot.format !== 1 || typeof snapshot.sql !== 'string' || Buffer.byteLength(snapshot.sql) > MAX_SQL_BYTES || !snapshot.configuration || typeof snapshot.configuration !== 'object') throw new Error('Invalid backup payload');
  if (createHash('sha256').update(snapshot.sql).digest('hex') !== snapshot.sqlSha256) throw new Error('SQL checksum mismatch');
  return snapshot;
}
