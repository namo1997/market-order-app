import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fkViolations } from '../server/tests/helpers/ddl-fk-scan.mjs';
import { LEGACY_FIXTURE_DDL } from '../server/tests/integration/legacy-receiving-schema.mjs';
import { seed, pilotFixtureDdl } from './seed.mjs';
import * as ocr from '../server/src/services/receiving-ocr.service.js';

const dir = fileURLToPath(new URL('./', import.meta.url));

// Real MySQL refuses ALTER ... MODIFY on a column used by a foreign key; unit tests with fake DBs cannot see it.
test('pilot seeds never ALTER/MODIFY/CHANGE a foreign-key or primary-key column', async () => {
  const files = { fixture: LEGACY_FIXTURE_DDL.join(';\n') };
  for (const name of (await readdir(dir)).filter(n => n.endsWith('.mjs') && !n.endsWith('.test.mjs'))) files[name] = await readFile(`${dir}${name}`, 'utf8');
  assert.deepEqual(fkViolations(files), []);
});

test('fixture DDL is adjusted at CREATE time: products.id AUTO_INCREMENT, supplier_masters.line_id, users role', () => {
  const adjusted = LEGACY_FIXTURE_DDL.map(pilotFixtureDdl);
  const table = name => adjusted.find(ddl => ddl.includes(`CREATE TABLE IF NOT EXISTS ${name} (`));
  assert.match(table('products'), /id INT PRIMARY KEY AUTO_INCREMENT,/);
  assert.match(table('supplier_masters'), /line_id VARCHAR\(100\) NULL/);
  assert.match(table('users'), /role VARCHAR\(30\)/);
  // Foreign keys that reference products(id) are still declared on the children.
  assert.match(table('order_items'), /REFERENCES products\(id\)/);
  assert.ok(adjusted.every(ddl => !/ALTER\s+TABLE/i.test(ddl)));
});

for (const profile of ['maerim', 'all', 'default']) {
  test(`seed profile ${profile} issues no ALTER ... MODIFY/CHANGE statement`, async () => {
    const statements = [];
    const pool = { query: async sql => { statements.push(String(sql).replace(/\s+/g, ' ')); return [{ insertId: 1 }]; } };
    const source = { ocr, order: { ensureOrderReceivingColumns: async () => {} }, inventory: { ensureInventoryTables: async () => {} },
      schema: { ensureReceivingDocumentsTables: async () => {} }, productSetup: { prepareSupplierProducts: async () => {} } };
    await seed(fileURLToPath(new URL('../server', import.meta.url)), pool, source, { profile, date: '2026-10-20' });
    assert.ok(statements.some(sql => /CREATE TABLE IF NOT EXISTS products \(/.test(sql) && /AUTO_INCREMENT/.test(sql)));
    assert.ok(statements.some(sql => /CREATE TABLE IF NOT EXISTS stock_templates/.test(sql)));
    assert.deepEqual(statements.filter(sql => /^ALTER\s+TABLE\s+\S+\s+(MODIFY|CHANGE)/i.test(sql)), []);
  });
}
