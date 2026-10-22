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
  assert.match(flow, /const billQuantity = weighed \? bill\.quantity_billed \?\? null/);
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

// Owner's bills 2026-10-22: ต.ดริ๊งค์ prints VAT-inclusive line prices (3,800 = total; pre-VAT 3,551.40 + VAT 248.60).
test('VAT-inclusive line prices are not a SUM_MISMATCH; a real gap still is', () => {
  const line = { line_no: 1, product_id: 582, quantity_billed: '100', quantity_received: '1200', unit_price: '38', amount: '3800', match_confidence: 1 };
  const codes = doc => computeDocumentWarnings({ document: doc, lines: [line] }).warnings.map(w => w.code);
  assert.ok(!codes({ subtotal: '3551.40', vat: '248.60', total: '3800' }).includes('SUM_MISMATCH'));
  assert.ok(!codes({ subtotal: '3800', vat: '248.60', total: '3800' }).includes('SUM_MISMATCH'));
  assert.ok(codes({ subtotal: '3551.40', vat: '248.60', total: '4000' }).includes('SUM_MISMATCH'));
  assert.ok(!codes({ subtotal: '3800', vat: '266', total: '4066' }).includes('SUM_MISMATCH'), 'VAT-exclusive lines still reconcile');
});

// Owner 2026-10-22: the customer's street address (122/19 ม.6 ...) says nothing about the receiving branch.
test('bill reading never guesses the branch from the customer address', async () => {
  const provider = await source('../src/services/receiving-ocr-provider.js');
  assert.match(provider, /ห้ามเดาสาขาจากที่อยู่\/เลขที่บ้านของลูกค้า \(เช่น 122\/19 ม\.6\) ถ้าบิลไม่ได้เขียนชื่อสาขาหรือสถานที่ส่ง ship_to = null;/);
});

// Owner 2026-10-22: ร้านน้ำแข็ง vic has no letterhead; its cash-sale pad carries "บริษัท โซลาว จำกัด" as the customer.
test('a cash-sale bill that only names Solao as the customer is a bill, not our own statement', async () => {
  const provider = await source('../src/services/receiving-ocr-provider.js');
  assert.match(provider, /แต่บิลเงินสด\/ใบส่งของของร้านที่เขียนหรือประทับชื่อ โซลาว ไว้ในช่องหัวบิลหรือช่องลูกค้า \(ร้านไม่มีหัวบิลของตัวเอง\) และมีรายการสินค้าพร้อมจำนวน\/ราคา คือ bill/);
});

// Owner 2026-10-22 (ข.): staff pick the receiving branch; warn only when the bill clearly names another branch.
test('ship-to warning only for a clearly named other branch', async () => {
  const { billBranchMismatch } = await import('../src/services/receiving-ocr-checks.js');
  const branches = [{ id: 1, name: 'สาขาคันคลอง' }, { id: 2, name: 'สาขาผลิตคันคลอง' }, { id: 3, name: 'สาขาสันกำแพง' }, { id: 4, name: 'สาขาผลิตสันกำแพง' }];
  for (const generic of ['บริษัท โซลาว จำกัด สาขาสำนักงานใหญ่ (00000)', 'บริษัท โซลาว จำกัด (สำนักงานใหญ่)', 'โซลา', '122/19 ม.6 ถ.คันคลองชลประทาน']) {
    for (const id of [1, 2, 3, 4]) assert.equal(billBranchMismatch(generic === '122/19 ม.6 ถ.คันคลองชลประทาน' ? null : generic, null, id, branches), false, `${generic} @${id}`);
  }
  assert.equal(billBranchMismatch('สาขาผลิตคันคลอง', null, 2, branches), false, 'the most specific name wins');
  assert.equal(billBranchMismatch('สาขาผลิตคันคลอง', null, 1, branches), true);
  assert.equal(billBranchMismatch('ร้านโซลาวบ้านแจ้', null, 3, branches), false);
  assert.equal(billBranchMismatch('ร้านโซลาวบ้านแจ้', null, 1, branches), true);
  assert.equal(billBranchMismatch('- สาขาคันคลอง', 'บริษัท โซลาว จำกัด สาขาสำนักงานใหญ่ (00000)', 1, branches), false);
});

// Owner 2026-10-22: read bills faster. Bench on 10 real bills (gpt-6-luna): effort "low" median ~9–11 s vs
// default ~12–17 s with the same rows read (28/29) — set RECEIVING_OCR_REASONING_EFFORT=low.
test('reasoning effort is an opt-in setting for reasoning models only', async () => {
  const { getOcrModelParameters } = await import('../src/services/receiving-ocr-provider.js');
  assert.deepEqual(getOcrModelParameters('gpt-6-luna', 'low'), { max_completion_tokens: 65536, reasoning_effort: 'low' });
  assert.deepEqual(getOcrModelParameters('gpt-6-luna', ''), { max_completion_tokens: 65536 });
  assert.deepEqual(getOcrModelParameters('gpt-6-luna', 'turbo'), { max_completion_tokens: 65536 }, 'unknown values are ignored');
  assert.deepEqual(getOcrModelParameters('gpt-4o', 'low'), { temperature: 0.1, max_completion_tokens: 16384 });
  const provider = await source('../src/services/receiving-ocr-provider.js');
  assert.match(provider, /reasoningEffort = getEnv\(\)\.RECEIVING_OCR_REASONING_EFFORT \|\| ''/);
  assert.match(provider, /\['temperature', 'max_tokens', 'max_completion_tokens', 'reasoning_effort'\]/);
});

// Owner 2026-10-22 (Asiamart "(1*10)"): a taught pack size must reach the receipt, not only the shortcut.
test('pack shortcut: OCR rows are stored in counting units; learning keeps the taught pack size', async () => {
  const flow = await source('../src/models/receiving-documents-ocr-flow.js');
  assert.match(flow, /pack !== 1 && printedQuantity !== null \? Math\.round\(printedQuantity \* pack \* 100\) \/ 100/);
  assert.match(flow, /pack !== 1 && printedPrice !== null \? Math\.round\(printedPrice \/ pack \* 1000000\) \/ 1000000/);
  const alias = await source('../src/models/receiving-documents-alias.js');
  assert.match(alias, /const nextMultiplier = Number\(learnedMultiplier\) === 1 && Number\(existing\.unit_multiplier\) > 0 && Number\(existing\.unit_multiplier\) !== 1/);
  const { aliasReferencePrice } = await import('../src/services/receiving-ocr-matcher.js');
  assert.equal(aliasReferencePrice({ product_id: 382, unit_multiplier: '10.0000' }, new Map([[382, 40]])), 400);
  assert.equal(aliasReferencePrice({ product_id: 382, unit_multiplier: '10.0000', last_unit_price: '41' }), 410);
  assert.equal(aliasReferencePrice({ product_id: 59, price_by_weight: 1, last_unit_price: '145' }, new Map([[59, 400]])), 145);
  assert.equal(aliasReferencePrice({ product_id: 59, price_by_weight: 1 }, new Map([[59, 400]])), null);
});

test('pack shortcut rows carry the product counting unit, not the printed bill unit', () => {
  const alias = { supplier_key: 'sm:3', bill_text: 'ครัววังทิพย์ แป้งทอดกรอบ 1 กก. (1*10)', item_code: 'C0501007', unit_text: '', product_id: 382,
    product_name: 'แป้งกรอบ', product_unit_id: 9, product_unit_name: 'ถุง', unit_id: 9, unit_multiplier: '10.0000', confirm_count: 1, is_active: 1 };
  const [row] = matchOcrLinesToCatalog({ supplierKey: 'sm:3', aliases: [alias], units: [{ id: 21, name: 'กล่อง' }],
    ocrLines: [{ item_code: 'C0501007', bill_text: 'ครัววังทิพย์ แป้งทอดกรอบ 1 กก. (1*10)', quantity_billed: 1, unit_text: 'กล่อง', unit_price: 400, amount: 400 }] });
  assert.equal(row.unit_text, 'ถุง');
  assert.equal(row.unit_id, 9);
  assert.equal(Number(row.quantity_received), 10);
});

// Owner 2026-10-22 (ก.): misread long names match automatically; sizes/digits never bend.
test('near name: up to 2 letters off on a long taught name matches; digits, codes and ties block it', () => {
  const fish = [
    { supplier_key: 'sm:8', bill_text: 'กะพงไซด์ (ปลากระพงขาว )', unit_text: 'kg', product_id: 59, product_name: 'ปลากะพง #ตัว', price_by_weight: 1, confirm_count: 1, is_active: 1 },
    { supplier_key: 'sm:8', bill_text: 'กะพงไซด์ (ปลากระพงขาว ฝาผีเสื้อ)', unit_text: 'kg', product_id: 475, product_name: 'ปลากะพงแล่ฟินเลย์', price_by_weight: 1, confirm_count: 1, is_active: 1 }];
  const read = (bill_text, extra = {}) => matchOcrLinesToCatalog({ supplierKey: 'sm:8', aliases: fish,
    ocrLines: [{ bill_text, quantity_billed: 8.5, unit_text: 'kg', unit_price: 145, amount: 1232.5, ...extra }] })[0];
  assert.equal(read('กระพงไซด์ (ปลากระพงขาว)').product_id, 59);
  assert.equal(read('กระพงไซด์ (ปลากระพงขาว)').price_by_weight, true, 'the near shortcut keeps its weighed setting');
  assert.equal(read('กระพงไซด์ (ปลากระพงขาว ผาผีเสื้อ)').product_id, 475);
  assert.equal(read('กระพงไซด์ (ปลาทับทิมแดง)').product_id, null, 'too far');
  const water = [{ supplier_key: 'sm:24', bill_text: 'น้ำดื่ม โซลาว 600 มล. เอวคอด', product_id: 582, product_name: 'น้ำดื่ม Solao', confirm_count: 1, is_active: 1 }];
  const w = text => matchOcrLinesToCatalog({ supplierKey: 'sm:24', aliases: water, ocrLines: [{ bill_text: text, quantity_billed: 100, unit_price: 38, amount: 3800 }] })[0];
  assert.equal(w('น้ำดื่ม โซลาว 600 มล. เอวอดอ').product_id, 582);
  assert.equal(w('น้ำดื่ม โซลาว 800 มล. เอวคอด').product_id, null, 'a different size never matches');
  const bags = [6, 8].map(n => ({ supplier_key: 'sm:7', bill_text: `ถุงหิ้วดาวส้ม ${n}x14 นิ้ว`, product_id: 350 + n, product_name: `ถุงหิ้ว ${n}*14`, confirm_count: 1, is_active: 1 }));
  const bag = text => matchOcrLinesToCatalog({ supplierKey: 'sm:7', aliases: bags, ocrLines: [{ bill_text: text, quantity_billed: 5 }] })[0];
  assert.equal(bag('ถุงหิ้วดาวสัม 8x14 นิ้ว').product_id, 358);
  assert.equal(bag('ถุงหิ้วดาวสัม 9x14 นิ้ว').product_id, null);
  assert.equal(w('น้ำดื่ม').product_id, null, 'short names stay exact');
  const coded = [{ ...water[0], item_code: 'W600' }];
  assert.equal(matchOcrLinesToCatalog({ supplierKey: 'sm:24', aliases: coded, ocrLines: [{ bill_text: 'น้ำดื่ม โซลาว 600 มล. เอวอดอ', item_code: 'X999' }] })[0].product_id, null, 'a contradicting code blocks it');
});

// Owner 2026-10-22: "ให้แบ่งความซับซ้อนของบิล เข้า 6.1" — hard bills go to the larger model.
test('complex bills: shops marked complex use the larger model; a weak fast read is read again by it', async () => {
  const { weakBillRead } = await import('../src/services/receiving-ocr-checks.js');
  const good = { confidence: 0.85, warnings: [], lines: [{ bill_text: 'ไข่เบอร์ 1' }], unreadable_line_count: 0 };
  assert.equal(weakBillRead(good), false);
  assert.equal(weakBillRead({ ...good, confidence: 0.38 }), true);
  assert.equal(weakBillRead({ ...good, warnings: ['BILL_TOTAL_MISMATCH'] }), true);
  assert.equal(weakBillRead({ ...good, lines: [{ bill_text: '…' }, { bill_text: 'ไข่' }] }), true, 'a row without a readable name');
  assert.equal(weakBillRead({ ...good, unreadable_line_count: 1 }), true);
  const flow = await source('../src/models/receiving-documents-ocr-flow.js');
  assert.match(flow, /const complexModel = ocrOptions\.model \? '' : String\(globalThis\.process\?\.env\?\.RECEIVING_OCR_MODEL_COMPLEX \|\| ''\)\.trim\(\);/);
  assert.match(flow, /if \(complexModel && complexBills\) ocrResult = await extractBillWithVision\(\{ \.\.\.readRequest, model: complexModel \}\);/);
  assert.match(flow, /catch \{ \/\* the fast read stands when the larger model is unavailable \*\/ \}/);
  const admin = await source('../src/models/receiving-supplier-customers.model.js');
  assert.match(admin, /action: 'ocr_mode'/);
  const routes = await source('../src/routes/receiving-admin.routes.js');
  assert.match(routes, /router\.put\('\/suppliers\/:key\/ocr-mode'/);
});
