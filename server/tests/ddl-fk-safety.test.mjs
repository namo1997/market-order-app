import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fkViolations, foreignKeyColumns, modifiedColumns } from './helpers/ddl-fk-scan.mjs';
import { LEGACY_FIXTURE_DDL } from './integration/legacy-receiving-schema.mjs';

const src = name => fileURLToPath(new URL(`../src/models/${name}`, import.meta.url));
// Schema code reached by the supplier product-create / CSV import endpoints (prepareSupplierProducts + import).
const MODELS = ['receiving-supplier-products.model.js', 'product.model.js', 'department-products.model.js',
  'stock-check.model.js', 'supplier-master.model.js', 'receiving-documents-schema.js', 'receiving-suppliers-admin.model.js'];

test('scanner flags MODIFY/CHANGE on foreign-key or primary-key columns (the ER_FK_COLUMN_CANNOT_CHANGE_CHILD bug)', () => {
  const ddl = 'CREATE TABLE c (id INT, product_id INT, FOREIGN KEY (product_id) REFERENCES products(id))';
  assert.deepEqual([...foreignKeyColumns([ddl])].sort(), ['id', 'product_id']);
  assert.equal(modifiedColumns('await pool.query(`ALTER TABLE products MODIFY id INT NOT NULL AUTO_INCREMENT`)')[0].column, 'id');
  assert.equal(fkViolations({ a: ddl, b: 'ALTER TABLE products MODIFY id INT NOT NULL AUTO_INCREMENT' }).length, 1);
  assert.equal(fkViolations({ a: ddl, b: 'ALTER TABLE x CHANGE COLUMN `product_id` product_id BIGINT' }).length, 1);
  assert.equal(fkViolations({ a: ddl, b: 'ALTER TABLE products ADD COLUMN barcode VARCHAR(255) NULL' }).length, 0);
});

test('lazy schema ensure for supplier product create never MODIFY/CHANGEs a foreign-key column', async () => {
  const files = {};
  for (const name of MODELS) files[name] = await readFile(src(name), 'utf8');
  files['legacy-fixture'] = LEGACY_FIXTURE_DDL.join(';\n');
  assert.deepEqual(fkViolations(files), []);
});
