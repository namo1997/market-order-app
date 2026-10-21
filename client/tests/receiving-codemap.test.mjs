import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// docs/modules/receiving-codemap.md is the first stop for finding receiving files; keep it complete and true.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const map = readFileSync(path.join(root, 'docs/modules/receiving-codemap.md'), 'utf8');
const dirs = {
  C: 'client/src/pages/receiving', A: 'client/src/receiving-app', AD: 'client/src/pages/admin/receiving',
  M: 'server/src/models', S: 'server/src/services', CT: 'client/tests', ST: 'server/tests',
};
const codeSpans = [...map.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

test('codemap mentions every receiving client file', () => {
  const missing = [];
  for (const key of ['C', 'A', 'AD']) {
    for (const name of readdirSync(path.join(root, dirs[key]))) {
      if (/\.test\.mjs$/.test(name)) continue;
      const stem = name.replace(/\.(jsx|js|mjs|css)$/, '');
      if (!map.includes(name) && !map.includes(stem)) missing.push(`${dirs[key]}/${name}`);
    }
  }
  assert.deepEqual(missing, [], 'add these files to docs/modules/receiving-codemap.md');
});

test('codemap prefixed paths exist', () => {
  const broken = [];
  for (const span of codeSpans) {
    const m = span.match(/^(C|A|AD|M|S|CT|ST)\/([\w./-]+)$/);
    if (!m || /[*{]/.test(m[2])) continue;
    const base = path.join(root, dirs[m[1]], m[2]);
    if (!existsSync(base) && !existsSync(`${base}.test.mjs`)) broken.push(span);
  }
  assert.deepEqual(broken, []);
});

test('codemap test names refer to real test files', () => {
  const tests = new Set([
    ...readdirSync(path.join(root, dirs.CT)), ...readdirSync(path.join(root, dirs.ST)),
  ].filter((n) => n.endsWith('.test.mjs')).map((n) => n.replace(/\.test\.mjs$/, '')));
  const known = (n) => tests.has(n) || tests.has(`receiving-${n}`) || [...tests].some((t) => t.startsWith(`receiving-${n}`));
  const unknown = [];
  for (const line of map.split('\n').filter((l) => l.startsWith('|'))) {
    const cells = line.split('|');
    const testCell = cells.at(-2) ?? '';
    const names = [...testCell.matchAll(/`([a-z0-9-]+(?:\.[a-z-]+)?)`/g)].map((m) => m[1]);
    for (const n of names) if (/^(receiving-|fix-|ux-|device-|round-|p8|polish|sign|review-|scan)/.test(n) && !known(n)) unknown.push(n);
  }
  assert.deepEqual(unknown, []);
});
