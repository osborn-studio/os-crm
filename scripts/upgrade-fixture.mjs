import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
const root = new URL('./fixtures/upgrade/', import.meta.url);
export function readUpgradeFixture(name) {
  if (!['agent', 'receipt'].includes(name)) throw Error('Unknown upgrade fixture');
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
  const item = manifest[name];
  const bytes = readFileSync(new URL(name + '.tar.gz', root));
  if (createHash('sha256').update(bytes).digest('hex') !== item.sha256)
    throw Error('Historical upgrade fixture hash mismatch');
  return gunzipSync(bytes);
}
