import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { matchOcrLinesToCatalog, computeDocumentWarnings, splitHandwrittenCount } from '../src/services/receiving-ocr-matcher.js';
import { confirmIssueCandidates } from '../src/models/receiving-issues-policy.js';
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

// Owner 2026-10-22: พิสมัยปลาสด writes "ช่อน 10ก" = 10 fish weighing 8.4 kg (the number before the name is kg).
test('handwritten count note: split from the name only for a bare ก/ต or an a+b sum', () => {
  assert.deepEqual(splitHandwrittenCount('ช่อน 10ก'), { base: 'ช่อน', count: 10 });
  assert.deepEqual(splitHandwrittenCount('ช่อน 10 ต.'), { base: 'ช่อน', count: 10 });
  assert.deepEqual(splitHandwrittenCount('ดุก 5+5'), { base: 'ดุก', count: 10 });
  for (const name of ['ข้าวหอมมะลิ 15กก', 'ไข่ No1', 'หมึก 20ก (เล่ม?)', 'โคคาโคลา 1x24', 'ดุก', 'น้ำปลา 700']) {
    assert.equal(splitHandwrittenCount(name), null, name);
  }
});

test('weighed alias + handwritten count: the name matches without the note and the count becomes the billed pieces', () => {
  const alias = { ...weighedAlias, supplier_key: 'sm:32', bill_text: 'ช่อน', unit_text: '', product_id: 1028, product_name: 'ปลาช่อน 6-7 ขีด เผา', last_unit_price: '170' };
  const [row] = matchOcrLinesToCatalog({ supplierKey: 'sm:32', aliases: [alias],
    ocrLines: [{ bill_text: 'ช่อน 10ก', quantity_billed: 8.4, unit_text: 'กก.', unit_price: 170, amount: 1428 }] });
  assert.equal(row.product_id, 1028);
  assert.equal(row.quantity_billed, 10);
  assert.equal(Number(row.bill_weight), 8.4);
  assert.equal(Number(row.amount), 1428);
  const plainAlias = { ...alias, price_by_weight: 0, product_id: 456, product_name: 'ปลาหมึกอาเจน', bill_text: 'หมึก' };
  const [squid] = matchOcrLinesToCatalog({ supplierKey: 'sm:32', aliases: [plainAlias],
    ocrLines: [{ bill_text: 'หมึก 20ก', quantity_billed: 19.5, unit_text: 'กก.', unit_price: 120, amount: 2340 }] });
  assert.equal(squid.product_id, 456, 'an ordinary shortcut also matches without the note');
  assert.equal(Number(squid.quantity_billed), 19.5, 'and keeps the bill quantity column');
  const [exact] = matchOcrLinesToCatalog({ supplierKey: 'sm:32', aliases: [plainAlias, { ...plainAlias, bill_text: 'หมึก 20ก', product_id: 999 }],
    ocrLines: [{ bill_text: 'หมึก 20ก', quantity_billed: 19.5, unit_price: 120, amount: 2340 }] });
  assert.equal(exact.product_id, 999, 'an exact taught name still wins');
});

test('weighed line with a bill piece count: a missing fish is a shortage worth amount / pieces', () => {
  const line = { id: 1, product_name: 'ปลาช่อน 6-7 ขีด เผา', counted_quantity: '9', quantity_received: '9', quantity_billed: '10',
    unit_price: null, amount: '1428.00', price_by_weight: 1, unit_text: 'ตัว', review_decision: 'short' };
  const [issue] = confirmIssueCandidates([line], new Map());
  assert.equal(issue.type, 'shortage');
  assert.equal(issue.quantity, '1.00');
  assert.equal(issue.amount, '142.80');
  const ledger = reviewLedger({ total: '1428', lines: [{ ...line, price_by_weight: true }] });
  assert.equal(ledger.received, 128520n, '9 of 10 billed fish');
  const exported = exportLine({ ...line, quantity_received: '9' });
  assert.equal(exported.amount_satang, 128520);
  assert.equal(exported.unit_price_satang, 14280);
  assert.equal(exportLine({ ...line, quantity_received: '10' }).amount_satang, 142800);
});

test('weighed line learning keeps the shortcut name without the handwritten count', async () => {
  const settlement = await source('../src/models/receiving-documents-settlement.js');
  assert.match(settlement, /const cleanBillText = countNote && \(countNote\[3\] \|\| countNote\[2\]\.includes\('\+'\)\) \? countNote\[1\]\.trim\(\) : rawBillText;/);
  const flow = await source('../src/models/receiving-documents-ocr-flow.js');
  assert.match(flow, /const billQuantity = weighed \? bill\.quantity_billed \?\? null : raw \? raw\.quantity_billed : bill\.quantity_billed;/);
});

// Owner 2026-10-22: ต้นพยอม "ไข่ไก่ NO 1" is taught as 471 ไข่ไก่; คันคลอง orders 298 ไข่ไก่ (ผลิตคันคลอง).
test('branch variant: a shortcut lands on the ordered sibling "<name> (<place>)" when it is the only one', () => {
  const alias = { supplier_key: 'sm:7', bill_text: 'ไข่ไก่ NO 1', unit_text: '', product_id: 471, product_name: 'ไข่ไก่', unit_id: 5, confirm_count: 1, is_active: 1 };
  const read = [{ bill_text: 'ไข่ไก่ No1', quantity_billed: 10, unit_text: 'แผง', unit_price: 138, amount: 1380 }];
  const kk = { order_item_id: 91, product_id: 298, product_name: 'ไข่ไก่ (ผลิตคันคลอง)', quantity_ordered: '10', unit_id: 6, unit_name: 'แผง' };
  const [row] = matchOcrLinesToCatalog({ supplierKey: 'sm:7', aliases: [alias], ocrLines: read, expectedItems: [kk] });
  assert.equal(row.product_id, 298);
  assert.equal(row.order_item_id, 91);
  assert.equal(row.product_name, 'ไข่ไก่ (ผลิตคันคลอง)');
  assert.equal(row.unit_id, 6);
  const own = { order_item_id: 92, product_id: 471, product_name: 'ไข่ไก่', quantity_ordered: '10', unit_id: 5, unit_name: 'แผง' };
  assert.equal(matchOcrLinesToCatalog({ supplierKey: 'sm:7', aliases: [alias], ocrLines: read, expectedItems: [kk, own] })[0].product_id, 471, 'the taught product itself wins');
  const market = { order_item_id: 93, product_id: 911, product_name: 'ไข่ไก่ (ตลาดสด)', quantity_ordered: '5', unit_id: 6, unit_name: 'แผง' };
  assert.equal(matchOcrLinesToCatalog({ supplierKey: 'sm:7', aliases: [alias], ocrLines: read, expectedItems: [kk, market] })[0].product_id, 471, 'two siblings: no guess');
  assert.equal(matchOcrLinesToCatalog({ supplierKey: 'sm:7', aliases: [alias], ocrLines: read, expectedItems: [{ ...kk, product_name: 'ไข่ไก่ดำ' }] })[0].product_id, 471);
});
