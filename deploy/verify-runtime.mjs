import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readdir, stat } from 'node:fs/promises';
const api = createRequire(new URL('../apps/api/package.json', import.meta.url));
const database = createRequire(new URL('../packages/database/package.json', import.meta.url));
assert.match(api('@nestjs/core/package.json').version, /^11\./);
for (const name of ['@nestjs/cli', 'jest', 'eslint', 'webpack']) {
  assert.throws(() => api.resolve(name + '/package.json'), { code: 'MODULE_NOT_FOUND' }, 'Development-only package leaked into runtime: ' + name);
}
const installed = await readdir(new URL('../node_modules/.pnpm/', import.meta.url));
for (const prefix of ['@nestjs+cli@', 'jest@', 'eslint@', 'webpack@']) {
  assert(!installed.some((name) => name.startsWith(prefix)), 'Orphaned development files leaked into runtime: ' + prefix);
}
for (const name of ['@prisma/client', 'tsx', 'bcrypt']) assert(database.resolve(name), 'Missing installation/seed runtime dependency: ' + name);
// Prisma's package root exports types, not the CLI entry point.
assert((await stat(new URL('../packages/database/node_modules/prisma/build/index.js', import.meta.url))).isFile());
for (const path of ['../apps/api/dist/main.js', '../apps/web/dist/index.html']) assert((await stat(new URL(path, import.meta.url))).isFile());
console.log(JSON.stringify({ runtime: true, freshProductionInstall: true, developmentToolchainAbsent: true, migrationAndDemoDependenciesPresent: true }));
