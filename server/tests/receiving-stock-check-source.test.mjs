import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Execute the real template SELECT on SQLite, rather than fabricate its rows.
// All data are synthetic; no file, application config, or real DB is loaded.
test('StockCheck template resolves latest receipt/void only for its product and department; unknown source stays null', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE stock_templates (id INT,department_id INT,product_id INT,category_id INT,required_quantity INT,min_quantity INT,daily_required INT,check_input_unit_id INT,check_to_base_multiplier INT,created_at TEXT,updated_at TEXT);
      CREATE TABLE products (id INT,name TEXT,code TEXT,barcode TEXT,qr_code TEXT,default_price INT,unit_id INT,product_group_id INT);
      CREATE TABLE units (id INT,name TEXT,abbreviation TEXT);
      CREATE TABLE product_groups (id INT,name TEXT);
      CREATE TABLE stock_categories (id INT,name TEXT,sort_order INT);
      CREATE TABLE inventory_transactions (id INT,product_id INT,department_id INT,notes TEXT);
      INSERT INTO products VALUES (7,'SYNTHETIC A','A',NULL,NULL,10,2,3),(8,'SYNTHETIC B','B',NULL,NULL,10,2,3);
      INSERT INTO stock_templates (id,department_id,product_id,check_to_base_multiplier) VALUES (1,10,7,12),(2,10,8,1),(3,20,7,1);
      INSERT INTO inventory_transactions VALUES
        (1,7,10,'รับสินค้าตามเอกสาร #1'),
        (2,7,10,'รับสินค้าตามเอกสาร #2'),
        (3,7,10,'ยกเลิกเอกสารรับสินค้า #2: SYNTHETIC'),
        (4,7,10,'เบิกไปใช้'),
        (99,7,20,'รับสินค้าตามเอกสาร #99');`);
    const calls = [];
    const pool = { query: async (sql, args) => {
      calls.push({ sql, args });
      if (sql.startsWith('SHOW COLUMNS')) return [[{ Field: args[0] }]];
      return [db.prepare(sql).all(...args)];
    } };
    const context = vm.createContext({ console });
    const module = new vm.SourceTextModule(await readFile(new URL('../src/models/stock-check.model.js', import.meta.url), 'utf8'), { context });
    const dependencies = [];
    await module.link(name => {
      assert.equal(name, '../config/database.js');
      const dep = new vm.SyntheticModule(['default'], function () { this.setExport('default', pool); }, { context });
      dependencies.push(dep); return dep;
    });
    await module.evaluate();
    const rows = await module.namespace.getTemplateByDepartmentId(10);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].latest_receiving_notes, 'ยกเลิกเอกสารรับสินค้า #2: SYNTHETIC');
    assert.equal(rows[0].check_to_base_multiplier, 12, 'display-unit conversion settings remain unchanged');
    assert.equal(rows[1].latest_receiving_notes, null);
    assert.deepEqual(Array.from(calls.at(-1).args), [10], 'department is bound, never interpolated');
  } finally { db.close(); }
});
