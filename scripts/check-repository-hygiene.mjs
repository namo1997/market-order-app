#!/usr/bin/env node
// Read-only source/search check. No builds, DB access, generated fixtures or writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const listed = execFileSync('rg', ['--files', '--hidden'], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 ** 2 }).trim().split('\n');
const files = new Set(listed);
const generatedSegment = /(^|\/)(\.git|node_modules|dist|build|coverage|\.cache|\.tmp|tmp|output|outputs|test-results|playwright-report|\.playwright-cli|\.codex-work|\.local-preview|\.local-recovery|\.backups|\.railway-import|\.button-audit|artifacts)(\/|$)/;
const historical = /^(archive\/|reports\/|docs\/releases\/|server\/database\/backups\/|server\/scripts\/archive\/)|(^|\/)docs\/(archive|evidence)\//;
const artifactFile = /\.(log|tsbuildinfo|sqlite(?:-.*)?|db(?:-.*)?|sql\.gz|dump)$/;
const leaks = listed.filter(file => generatedSegment.test(file) || historical.test(file) || artifactFile.test(file));
assert.equal(leaks.length, 0, 'Normal search exposes generated/archive files: ' + leaks.slice(0, 10).join(', '));

const required = [
  '.ignore', '.gitignore', 'AGENTS.md', 'CLAUDE.md', 'README.md', 'AI_GUIDE.md',
  'docs/REPOSITORY_HYGIENE.md', 'docs/SSD_STORAGE.md', 'scripts/check-repository-hygiene.mjs',
  'server/src/server.js', 'client/src/main.jsx', 'server/tests/order-safety.test.mjs',
  'server/database/schema.sql', 'server/database/migrations/001_create_inventory_tables.sql',
  'server/.env.example', 'client/.env.example',
  'line-bill-capture/AGENTS.md', 'line-bill-capture/src/server.js', 'line-bill-capture/mobile-admin-v3/src/App.tsx',
  'general-cashflow/server/src/server.js', 'general-cashflow/server/test/receipts.test.js',
  'management-accounting/AGENTS.md', 'management-accounting/server/src/receivables-source-safety.js',
  'management-accounting/server/migrations/001_init.sql', 'management-accounting-PLAN.md',
];
for (const file of required) assert.ok(files.has(file), 'Current source/document hidden from search: ' + file);

// The index is explicitly readable even though normal search excludes archive.
const indexPath = path.join(root, 'archive/README.md');
const index = fs.readFileSync(indexPath, 'utf8');
let links = 0;
for (const match of index.matchAll(/\]\(([^)]+)\)/g)) {
  const target = match[1];
  if (/^[a-z]+:/.test(target) || target.startsWith('#')) continue;
  assert.ok(fs.existsSync(path.resolve(path.dirname(indexPath), target.split('#')[0])), 'Broken archive link: ' + target);
  links++;
}
console.log(`Workspace hygiene OK: ${required.length} current source/config paths visible; generated/archive paths excluded; ${links} archive links valid.`);
