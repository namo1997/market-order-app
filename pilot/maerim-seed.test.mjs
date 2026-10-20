import test from 'node:test';
import assert from 'node:assert/strict';
import * as ocr from '../server/src/services/receiving-ocr.service.js';
import { matchOcrLinesToCatalog } from '../server/src/services/receiving-ocr-matcher.js';
import { seedMaerim, MAERIM_PRODUCTS } from './seed-maerim.mjs';
import { pilotOptions } from './codex-ocr.mjs';

test('maerim: opt-in SYNTHETIC seed has rice/eggs, codes under both supplier keys, and order-queue lines', async () => {
  const calls = [];
  const pool = { query: async (sql, params = []) => { calls.push({ sql: sql.replace(/\s+/g, ' '), params }); return [{ insertId: 1 }]; } };
  const result = await seedMaerim(pool, { ocr, productSetup: { prepareSupplierProducts: async () => {} } }, '2026-10-20');
  assert.deepEqual(pilotOptions(['--seed=maerim', '--ocr=mock']), { port: 0, seed: 'maerim', ocr: 'mock' });
  assert.deepEqual([result.products, result.aliases, result.orders, result.orderItems], [3, 6, 1, 3]);
  assert.equal(result.label, 'SYNTHETIC'); assert.ok(result.assumptions.length);
  const products = calls.filter(c => c.sql.startsWith('INSERT INTO products')).map(c => ({ id: c.params[0], name: c.params[1], unit_id: c.params[3] }));
  const aliases = calls.filter(c => c.sql.includes('INSERT INTO supplier_product_aliases')).map(c => ({ supplier_key: c.params[0], product_id: c.params[8], item_code: c.params[10], bill_text: c.params[4], normalized_bill_text: c.params[5], unit_text: c.params[6], unit_multiplier: 1, confirm_count: 1, is_active: 1 }));
  assert.deepEqual([...new Set(aliases.map(a => a.item_code))], ['SYN-2010', 'SYN-5002', 'SYN-11090']);
  assert.equal(calls.filter(c => c.sql.startsWith('INSERT INTO order_items')).length, 3);
  assert.equal(calls.filter(c => c.sql.startsWith('INSERT INTO department_products')).length, 3);
  assert.equal(calls.filter(c => c.sql.startsWith('INSERT INTO stock_templates')).length, 3);
  for (const key of ['sm:1', 'pg:1']) for (let i = 0; i < MAERIM_PRODUCTS.length; i++) {
    const match = matchOcrLinesToCatalog({ ocrLines: [{ bill_text: 'โฟมเบอร์ 1', item_code: MAERIM_PRODUCTS[i].code }], supplierKey: key, aliases, products });
    assert.equal(match[0].product_id, i + 1); assert.equal(match[0].match.source, 'alias');
  }
  for (const p of MAERIM_PRODUCTS) assert.ok(p.name.startsWith('SYNTHETIC'));
  assert.doesNotMatch(JSON.stringify(calls), /\d{9,}/);
});
