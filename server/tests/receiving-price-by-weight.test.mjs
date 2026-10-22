import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { matchOcrLinesToCatalog, computeDocumentWarnings } from '../src/services/receiving-ocr-matcher.js';
import { exportLine } from '../src/models/receiving-ap-export-values.js';
import { reviewLedger } from '../src/utils/receiving-value.js';

// Owner 2026-10-22: แพปลาภูเก็ต bills "กะพงไซด์ (ปลากระพงขาว)" 8.3 kg × 145 = 1,203.50, but we order and
// receive the fish as pieces (product 59 ปลากะพง #ตัว). The weight is a bill fact, never a piece count.
const source = path => readFile(new URL(path, import.meta.url), 'utf8');
const weighedAlias = { supplier_key: 'sm:8', bill_text: 'กะพงไซด์ (ปลากระพงขาว )', unit_text: 'kg', product_id: 59,
  product_name: 'ปลากะพง #ตัว', unit_id: 30, unit_multiplier: '1.0000', last_unit_price: '145.000000',
  price_by_weight: 1, confirm_count: 1, is_active: 1 };
const read = { bill_text: 'กะพงไซด์ (ปลากระพงขาว )', quantity_billed: 8.3, unit_text: 'kg', unit_price: 145, amount: 1203.5 };

test('weighed alias: bill kg stays a bill fact; no billed piece count, no unit price, amount kept', () => {
  const [row] = matchOcrLinesToCatalog({ supplierKey: 'sm:8', ocrLines: [read], aliases: [weighedAlias],
    products: [{ id: 59, name: 'ปลากะพง #ตัว', unit_id: 31, unit_name: 'ตัว' }],
    expectedItems: [{ order_item_id: 700, product_id: 59, product_name: 'ปลากะพง #ตัว', quantity_ordered: '3', unit_id: 31, unit_name: 'ตัว' }] });
  assert.equal(row.product_id, 59);
  assert.equal(row.order_item_id, 700);
  assert.equal(row.quantity_billed, null);
  assert.equal(row.unit_price, null);
  assert.equal(row.base_unit_price, null);
  assert.equal(Number(row.amount), 1203.5);
  assert.equal(row.unit_text, 'ตัว', 'the line keeps the ordered piece unit, not the bill kg');
  assert.equal(row.unit_id, 31);
  assert.equal(row.unit_multiplier, 1);
  assert.equal(row.price_by_weight, true);
  assert.equal(Number(row.bill_weight), 8.3);
  assert.equal(row.bill_weight_unit, 'kg');
  assert.equal(Number(row.weight_unit_price), 145);
  assert.equal(Number(row.weight_ref_price), 145);
  const plain = { ...weighedAlias, price_by_weight: 0 };
  const [ordinary] = matchOcrLinesToCatalog({ supplierKey: 'sm:8', ocrLines: [read], aliases: [plain] });
  assert.equal(Number(ordinary.quantity_billed), 8.3, 'an ordinary alias still bills the read quantity');
});

test('weighed line: a changed price per kg is a PRICE_CHANGE; the per-piece cost is not compared', () => {
  const base = { line_no: 1, product_id: 59, quantity_received: '3', quantity_billed: null, unit_price: null, amount: '1203.50',
    price_by_weight: 1, bill_weight: '8.300', bill_weight_unit: 'kg', match_confidence: 1 };
  const prices = new Map([[59, 120]]);
  const same = computeDocumentWarnings({ lines: [{ ...base, weight_unit_price: '145', weight_ref_price: '145' }], latestPricesByProductId: prices });
  assert.equal(same.warnings.filter(w => w.code === 'PRICE_CHANGE').length, 0, '1203.5 / 3 pieces vs 120 per piece is not a price change');
  const changed = computeDocumentWarnings({ lines: [{ ...base, weight_unit_price: '160', weight_ref_price: '145' }], latestPricesByProductId: prices });
  const warning = changed.warnings.find(w => w.code === 'PRICE_CHANGE');
  assert.match(warning.message, /ราคาต่อ กก\. 160\.00 ต่างจากครั้งก่อน \(145\.00\)/);
  const first = computeDocumentWarnings({ lines: [{ ...base, weight_unit_price: '145', weight_ref_price: null }] });
  assert.equal(first.warnings.filter(w => w.code === 'PRICE_CHANGE').length, 0, 'no previous price: nothing to compare');
});

test('weighed line: accounting export uses the bill amount; price per piece = amount / pieces', () => {
  const line = exportLine({ id: 1, product_id: 59, quantity_received: '3', unit_text: 'ตัว', unit_price: null,
    base_unit_price: '401.166667', amount: '1203.50', price_by_weight: 1, review_decision: 'accept' });
  assert.equal(line.amount_satang, 120350);
  assert.equal(line.unit_price_satang, 40117);
  const none = exportLine({ id: 2, quantity_received: '0', amount: '1203.50', price_by_weight: 1 });
  assert.equal(none.amount_satang, 0);
});

test('weighed line: the review ledger counts its bill amount as received, not as a missing price', () => {
  const doc = { total: '1203.50', discount: null, vat: null, lines: [{ id: 1, product_name: 'ปลากะพง #ตัว', quantity_received: '3',
    quantity_billed: null, unit_price: null, amount: '1203.50', price_by_weight: true, review_decision: 'accept' }] };
  const ledger = reviewLedger(doc);
  assert.equal(ledger.billedLines, 120350n);
  assert.equal(ledger.received, 120350n);
  assert.equal(ledger.adjustment, 0n);
  assert.equal(ledger.missingPrice, false);
});

test('weighed alias: schema, OCR persistence, alias learning and admin teaching carry the flag', async () => {
  const schema = await source('../src/models/receiving-documents-schema.js');
  for (const column of ['price_by_weight', 'bill_weight', 'bill_weight_unit', 'weight_unit_price', 'weight_ref_price']) {
    assert.match(schema, new RegExp(`table: 'receiving_document_lines',\\s+column: '${column}'`));
  }
  assert.match(schema, /table: 'supplier_product_aliases',\s+column: 'price_by_weight'/);
  const flow = await source('../src/models/receiving-documents-ocr-flow.js');
  assert.match(flow, /const billQuantity = weighed \? null : raw \? raw\.quantity_billed : bill\.quantity_billed;/);
  assert.match(flow, /await setLineWeight\(connection, docId, target\.id, bill, target\);/);
  const settlement = await source('../src/models/receiving-documents-settlement.js');
  assert.match(settlement, /const learnedPrice = byWeight \? toFiniteNumberOrNull\(line\.weight_unit_price\) : effectiveActualPrice \?\? unitPrice;/);
  assert.match(settlement, /const cleanUnitText = String\(\(byWeight \? line\.bill_weight_unit : line\.unit_text \|\| line\.unit\) \|\| ''\)\.trim\(\);/);
  const admin = await source('../src/models/receiving-suppliers-admin.model.js');
  assert.match(admin, /if \(byWeight && multiplier !== '1\.0000'\) fail\(/);
  assert.match(admin, /if \(byWeight\) await connection\.query\('UPDATE supplier_product_aliases SET price_by_weight = 1 WHERE id = \?'/);
  const helpers = await source('../src/models/receiving-documents-helpers.js');
  assert.match(helpers, /Number\(row\.price_by_weight \|\| 0\) \? \{ price_by_weight: true,/);
});
