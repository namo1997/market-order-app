import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read, createReceivingHarness } from './helpers/receiving-fake-db.mjs';

test('receiving-documents-schema works without global process, creates alias_events table, and NEVER alters existing tables (R2-2, R2-4, R2-7)', async () => {
  const executedQueries = [];
  const mockDb = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      executedQueries.push({ sql: normalized, params });
      if (normalized.startsWith('SHOW COLUMNS')) {
        if (params[0] === 'unit_price') {
          return [[{ Field: 'unit_price', Type: 'decimal(12,2)' }]];
        }
        return [[]];
      }
      return [{ affectedRows: 1 }];
    }
  };

  // ไม่มี process ใน context เพื่อพิสูจน์ว่าไม่เกิด ReferenceError: process is not defined
  const context = vm.createContext({ console });
  const schemaModule = new vm.SourceTextModule(
    await read('../src/models/receiving-documents-schema.js'),
    { context }
  );
  await schemaModule.link((specifier) => {
    if (specifier.endsWith('/database.js')) {
      return new vm.SyntheticModule(['default'], function () {
        this.setExport('default', mockDb);
      }, { context });
    }
    throw new Error(`Unexpected dependency: ${specifier}`);
  });
  await schemaModule.evaluate();

  const { RECEIVING_DOCUMENT_TABLES_DDL, ensureReceivingDocumentsTables } = schemaModule.namespace;
  assert.ok(RECEIVING_DOCUMENT_TABLES_DDL.receiving_documents.includes('ocr_images_hash'));
  assert.ok(RECEIVING_DOCUMENT_TABLES_DDL.receiving_document_lines.includes('unit_price DECIMAL(12,6)'));
  assert.ok(RECEIVING_DOCUMENT_TABLES_DDL.receiving_document_lines.includes('quantity_received DECIMAL(10,2)'));
  assert.ok(RECEIVING_DOCUMENT_TABLES_DDL.receiving_document_lines.includes('prev_order_quantity DECIMAL(10,2)'));
  assert.ok(RECEIVING_DOCUMENT_TABLES_DDL.receiving_document_lines.includes('prev_order_receive_notes TEXT'));
  assert.ok(RECEIVING_DOCUMENT_TABLES_DDL.receiving_document_images.includes('sha256'));
  assert.ok(RECEIVING_DOCUMENT_TABLES_DDL.supplier_product_aliases.includes('candidate_product_id'));
  assert.ok(RECEIVING_DOCUMENT_TABLES_DDL.supplier_product_alias_events.includes('CREATE TABLE IF NOT EXISTS supplier_product_alias_events'));

  await ensureReceivingDocumentsTables(mockDb);

  // R2-4: ต้องไม่มีคำสั่ง ALTER TABLE ตารางเดิมของระบบ (order_items, inventory_balance, inventory_transactions)
  for (const forbiddenTable of ['order_items', 'inventory_balance', 'inventory_transactions']) {
    assert.equal(
      executedQueries.some((q) => q.sql.includes(`ALTER TABLE ${forbiddenTable}`)),
      false,
      `Must NEVER alter existing table ${forbiddenTable}`
    );
  }

  assert.ok(
    executedQueries.some((q) =>
      q.sql.includes('ALTER TABLE receiving_document_lines MODIFY COLUMN unit_price DECIMAL(12,6) NULL')
    )
  );
});

test("Unavailable receiving tables return 503 RECEIVING_NOT_READY", async () => {
  const h = await createReceivingHarness();
  const user = { id: 12, name: 'UserA', role: 'user', branch_id: 1, department_id: 10 };

  // R2-5: ถ้าตารางยังไม่ถูกสร้างบนฐานข้อมูล (ER_NO_SUCH_TABLE) ต้องได้ 503 RECEIVING_NOT_READY
  h.state.simulateMissingTables = true;
  const notReadyRes = await h.invoke('listDocuments', { user, query: { date: h.today } });
  assert.equal(notReadyRes.statusCode, 503);
  assert.equal(notReadyRes.body.code, 'RECEIVING_NOT_READY');
  h.state.simulateMissingTables = false;
});
