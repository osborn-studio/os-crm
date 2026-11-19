/** Public-tree guard: no business installation, private exports, or non-TIANYU data packs. */
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { exportData } from '../demo/tianyu/generate.mjs';
import { buildWorkflow } from '../demo/tianyu/ai-workflow/generate.mjs';
const candidates = [
  ...new Set(
    execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
      .split('\0')
      .filter(Boolean),
  ),
].filter(existsSync);
let bytes = 0;
for (const file of candidates) {
  assert(!lstatSync(file).isSymbolicLink(), 'Review symlink before publishing: ' + file);
  assert(
    !file
      .split('/')
      .some((p) =>
        [
          '.local',
          '.artifacts',
          'node_modules',
          'reference',
          'backups',
          'production-data',
          'imports',
          'uploads',
          '.git',
        ].includes(p),
      ),
    'Private path: ' + file,
  );
  assert(!/(?:^|\/)\.env(?:$|\.)/.test(file) || file === '.env.example', 'Environment file: ' + file);
  assert(!/\.(?:crmbackup|pem|key|dump|sqlite3?|xlsx?|zip|sql\.gz)$/i.test(file), 'Private/data archive: ' + file);
  if (file.endsWith('.sql'))
    assert(file.startsWith('packages/database/prisma/migrations/'), 'Only schema migrations may be SQL files');
  if (file.endsWith('.jsonl.gz')) assert.equal(file, 'demo/tianyu/data.jsonl.gz');
  if (file.endsWith('.tar.gz'))
    assert(
      ['scripts/fixtures/upgrade/agent.tar.gz', 'scripts/fixtures/upgrade/receipt.tar.gz'].includes(file),
      'Unreviewed archive',
    );
  const data = readFileSync(file);
  bytes += data.length;
  if (/\.(?:ts|tsx|mjs|py|json|jsonl|md|html|yml|yaml|txt|example)$/.test(file)) {
    const text = data.toString('utf8');
    assert(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text), 'Private key marker: ' + file);
    assert(!/\bsk-[A-Za-z0-9_-]{24,}\b/.test(text), 'API credential-like content: ' + file);
    assert(!/\/Users\/(?!example\b|YOUR_USER\b)[a-zA-Z][^\s"<>]+/.test(text), 'Machine-specific home path: ' + file);
  }
}
const scratch = mkdtempSync(join(tmpdir(), 'crm-public-audit-'));
try {
  const expected = exportData(scratch),
    actual = JSON.parse(readFileSync('demo/tianyu/manifest.json'));
  assert.equal(actual.fictional, true);
  assert.equal(actual.companyCode, 'TIANYU');
  const published = readFileSync('demo/tianyu/data.jsonl.gz');
  // zlib versions and OS headers may differ; verify the shipped archive against
  // its own manifest, then compare every uncompressed source byte across hosts.
  assert.equal(createHash('sha256').update(published).digest('hex'), actual.sha256);
  assert.deepEqual(gunzipSync(published), gunzipSync(readFileSync(join(scratch, 'data.jsonl.gz'))));
  assert.deepEqual(actual.counts, expected.counts);
  assert.equal(actual.version, expected.version);
  assert(actual.counts.customer <= 15000 && actual.counts.opportunity <= 2400);
  const pack = JSON.parse(readFileSync('demo/tianyu/ai-workflow/workflow.json'));
  assert.deepEqual(pack, buildWorkflow());
  assert.equal(pack.containsRealCompanyData, false);
  assert.equal(JSON.parse(readFileSync('demo/tianyu/approval-scenarios.json')).fictional, true);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(
  JSON.stringify({
    status: 'PASS',
    files: candidates.length,
    bytes,
    publicBusinessData: 'TIANYU fictional only',
    machineConfigurationIncluded: false,
    privateExportsIncluded: false,
  }),
);
