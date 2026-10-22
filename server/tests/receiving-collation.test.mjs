import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { LEGACY_FIXTURE_DDL, CORE_COLLATION, MODERN_COLLATION } from './integration/legacy-receiving-schema.mjs';

// Production fact (read-only preflight 2026-10-21, MySQL 9.7, database default utf8mb4_0900_ai_ci):
// branches, departments, users, units, products, product_groups, orders and order_items are
// utf8mb4_unicode_ci; supplier_masters, product_supplier_master_links and product_group_* are
// utf8mb4_0900_ai_ci. Receiving tables stay utf8mb4_unicode_ci and every cross-collation string
// expression against the 0900 tables carries an explicit COLLATE (ER_CANT_AGGREGATE_2COLLATIONS).
const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
const read = file => readFileSync(path.join(srcDir, file), 'utf8');
const walk = dir => readdirSync(path.join(srcDir, dir), { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const receivingSources = walk('').filter(file => /(^|\/)receiving-[^/]*\.js$/.test(file));

test('receiving-owned CREATE TABLE statements are explicit utf8mb4_unicode_ci (never 0900, never the database default)', () => {
  const schemaFiles = receivingSources.filter(file => /receiving-(documents|queue|push|issues)-schema\.js$/.test(file));
  assert.equal(schemaFiles.length, 4);
  let tables = 0;
  for (const file of schemaFiles) {
    const text = read(file);
    const creates = text.match(/CREATE TABLE IF NOT EXISTS/g)?.length ?? 0;
    const engines = text.match(/ENGINE=InnoDB/g)?.length ?? 0;
    const unicode = text.match(/DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci/g)?.length ?? 0;
    assert.ok(creates > 0, file);
    assert.equal(engines, creates, `${file}: one table suffix per CREATE TABLE`);
    assert.equal(unicode, creates, `${file}: every receiving table is utf8mb4_unicode_ci`);
    assert.doesNotMatch(text, /0900/, `${file}: receiving tables must not be 0900`);
    tables += creates;
  }
  assert.equal(tables, 14 + 3 + 2 + 6, 'documents (incl. supplier customer names + bill refs 2026-10-22) + queue + push + issues tables');
});

test('fixture reproduces the Production collation mix (core unicode_ci, supplier_masters and product_group_* 0900)', () => {
  assert.equal(CORE_COLLATION, 'utf8mb4_unicode_ci');
  assert.equal(MODERN_COLLATION, 'utf8mb4_0900_ai_ci');
  const collationOf = name => {
    const ddl = LEGACY_FIXTURE_DDL.find(item => new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\(`).test(item));
    assert.ok(ddl, name);
    return /COLLATE=(\w+)/.exec(ddl)[1];
  };
  for (const name of ['branches', 'departments', 'users', 'units', 'products', 'product_groups', 'orders', 'order_items']) {
    assert.equal(collationOf(name), 'utf8mb4_unicode_ci', name);
  }
  for (const name of ['supplier_masters', 'product_supplier_master_links', 'product_group_scopes', 'product_group_links']) {
    assert.equal(collationOf(name), 'utf8mb4_0900_ai_ci', name);
  }
});

test('disposable MySQL databases for the pilot and the integration run use the 0900 database default like Production', () => {
  const pilot = readFileSync(fileURLToPath(new URL('../../pilot/start-server.mjs', import.meta.url)), 'utf8');
  const it = readFileSync(fileURLToPath(new URL('../scripts/run-receiving-mysql-it.mjs', import.meta.url)), 'utf8');
  assert.match(pilot, /CREATE DATABASE receiving_pilot CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci/);
  assert.match(it, /CREATE DATABASE receiving_it CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci/);
  const seed = readFileSync(fileURLToPath(new URL('../../pilot/seed.mjs', import.meta.url)), 'utf8');
  assert.doesNotMatch(seed, /supplier_masters[^`]*COLLATE=utf8mb4_unicode_ci/);
});

// A string comparison or UNION that mixes supplier_masters (0900) with product_groups (unicode_ci) is only
// legal with an explicit COLLATE. Returns the offending fragments of one SQL text.
export function collationViolations(sql) {
  if (!/supplier_masters/.test(sql)) return [];
  const found = [];
  const trimmed = /TRIM\((\w+)\.name\)(\s+COLLATE\s+\w+)?\s*=\s*TRIM\((\w+)\.name\)(\s+COLLATE\s+\w+)?/g;
  for (const match of sql.matchAll(trimmed)) if (!match[2] && !match[4]) found.push(match[0]);
  if (/\bUNION\b/i.test(sql)) {
    for (const match of sql.matchAll(/\bsm\.(name|code)\b(?!\s+COLLATE\s+utf8mb4_unicode_ci)\s*(,|AS\b)/g)) found.push(match[0]);
  }
  return found;
}
// Template literals of a JS source (nested `${ `...` }` handled), comments and quoted strings skipped.
export function sqlSegments(text) {
  const out = [];
  const skipString = (i, quote) => { for (i++; i < text.length && text[i] !== quote; i++) if (text[i] === '\\') i++; return i + 1; };
  const skipComment = i => text[i + 1] === '/' ? (text.indexOf('\n', i) < 0 ? text.length : text.indexOf('\n', i))
    : (text.indexOf('*/', i + 2) < 0 ? text.length : text.indexOf('*/', i + 2) + 2);
  const expression = i => {
    for (let depth = 1; i < text.length;) {
      const c = text[i];
      if (c === '`') i = template(i + 1);
      else if (c === "'" || c === '"') i = skipString(i, c);
      else if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) i = skipComment(i);
      else { if (c === '{') depth++; if (c === '}' && --depth === 0) return i + 1; i++; }
    }
    return i;
  };
  const template = i => {
    while (i < text.length) {
      if (text[i] === '\\') i += 2;
      else if (text[i] === '`') return i + 1;
      else if (text[i] === '$' && text[i + 1] === '{') i = expression(i + 2);
      else i++;
    }
    return i;
  };
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (c === '`') { const end = template(i + 1); out.push(text.slice(i + 1, end - 1)); i = end; }
    else if (c === "'" || c === '"') i = skipString(i, c);
    else if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) i = skipComment(i);
    else i++;
  }
  return out;
}

test('collation checker flags the exact statements that failed on staging and accepts the fixed ones', () => {
  assert.deepEqual(collationViolations('FROM supplier_masters sm JOIN product_groups pg ON TRIM(pg.name) = TRIM(sm.name)').length, 1);
  assert.equal(collationViolations("SELECT CONCAT('sm:', sm.id) AS k, sm.code AS code, sm.name AS name FROM supplier_masters sm UNION ALL SELECT 1").length, 2);
  assert.deepEqual(collationViolations('FROM supplier_masters sm JOIN product_groups pg ON TRIM(pg.name) = TRIM(sm.name) COLLATE utf8mb4_unicode_ci'), []);
  assert.deepEqual(collationViolations('SELECT sm.code COLLATE utf8mb4_unicode_ci AS code, sm.name COLLATE utf8mb4_unicode_ci AS name FROM supplier_masters sm UNION ALL SELECT 1'), []);
});

test('no receiving SQL compares or unions supplier_masters strings with other tables without an explicit COLLATE', () => {
  let inspected = 0;
  for (const file of receivingSources) {
    for (const sql of sqlSegments(read(file))) {
      if (!/supplier_masters/.test(sql)) continue;
      inspected++;
      assert.deepEqual(collationViolations(sql), [], `${file}: ${sql.replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  }
  assert.ok(inspected >= 6, `expected the supplier registry/catalog statements to be inspected, got ${inspected}`);
  // The two statements that failed on staging deployment 58e637fc must carry the COLLATE.
  assert.match(read('models/receiving-suppliers-admin.model.js'), /TRIM\(pg\.name\) = TRIM\(sm\.name\) COLLATE utf8mb4_unicode_ci/);
  assert.match(read('models/receiving-supplier-catalog.js'), /TRIM\(legacy\.name\) = TRIM\(sm\.name\) COLLATE utf8mb4_unicode_ci/);
  assert.match(read('models/receiving-supplier-catalog.js'), /TRIM\(sm\.name\) COLLATE utf8mb4_unicode_ci = TRIM\(pg\.name\)/);
});
