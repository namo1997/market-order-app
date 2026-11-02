import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bangkokPeriod, billFromRead, editsFromBody, payableWarnings, sameRef, summarize, validPeriod } from '../src/models/receiving-payables-logic.js';

// Owner 2026-11-02 "ระบบรวบรวมเจ้าหนี้": pick a supplier, photograph the bill, the AI reads quantities and prices at once,
// and the month shows the amount owed per supplier. These cover the pure rules; the model only stores them.
const source = path => readFile(new URL(path, import.meta.url), 'utf8');

test('payables: a read keeps bill numbers; amounts fall back to quantity × price; the total falls back to the rows', () => {
  const bill = billFromRead({ doc_ref: ' INV-0042 ', doc_date: '2026-11-01', total: 2280, supplier_name: 'พิสมัยปลาสด', doc_kind: 'bill',
    lines: [{ bill_text: 'ทับทิม', quantity_billed: 19, unit_text: 'กก.', unit_price: 120, amount: 2280 }, { bill_text: '', amount: null }] });
  assert.equal(bill.doc_ref, 'INV-0042'); assert.equal(bill.doc_date, '2026-11-01'); assert.equal(bill.total, 2280); assert.equal(bill.total_source, 'bill');
  assert.deepEqual(bill.lines, [{ line_no: 1, bill_text: 'ทับทิม', quantity: 19, unit: 'กก.', unit_price: 120, amount: 2280 }], 'an empty row is dropped');
  const computed = billFromRead({ lines: [{ bill_text: 'ไข่', quantity_billed: 10, unit_price: 115 }, { bill_text: 'ผัก', amount: 45.5 }] });
  assert.equal(computed.lines[0].amount, 1150); assert.equal(computed.total, 1195.5); assert.equal(computed.total_source, 'lines');
  assert.equal(billFromRead({}).total, null); assert.equal(billFromRead({}).total_source, 'none');
  assert.equal(billFromRead({ doc_date: '16/9/69' }).doc_date, null, 'only an ISO date is kept');
});

test('payables: a bill counts toward the Bangkok month it was collected; the printed date never moves it', async () => {
  assert.equal(bangkokPeriod(new Date('2026-10-31T18:00:00Z')), '2026-11', '01:00 on 1 Nov in Bangkok');
  assert.equal(bangkokPeriod(new Date('2026-10-31T16:59:00Z')), '2026-10');
  const model = await source('../src/models/receiving-payables.model.js');
  assert.doesNotMatch(model, /period = \?, (?:status|doc_ref)|, period = \? WHERE/, 'reading or editing never changes the month');
  assert.equal(validPeriod('2026-11'), true); assert.equal(validPeriod('2026-13'), false); assert.equal(validPeriod('26-11'), false);
});

test('payables: warnings say what to check — no total, total from rows, sum mismatch (VAT aware), no ref, duplicate, already received', () => {
  const codes = bill => payableWarnings(bill).map(w => w.code);
  assert.deepEqual(codes({ doc_ref: 'A1', total: null, total_source: 'none', line_sum: null, doc_kind: 'bill' }), ['NO_TOTAL']);
  assert.deepEqual(codes({ doc_ref: 'A1', total: 100, total_source: 'lines', line_sum: 100, doc_kind: 'bill' }), ['TOTAL_FROM_LINES']);
  assert.deepEqual(codes({ doc_ref: 'A1', total: 107, total_source: 'bill', line_sum: 100, vat: 7, doc_kind: 'bill' }), [], 'rows + VAT = total');
  assert.deepEqual(codes({ doc_ref: 'A1', total: 150, total_source: 'bill', line_sum: 100, doc_kind: 'bill' }), ['SUM_MISMATCH']);
  assert.deepEqual(codes({ doc_ref: null, total: 100, total_source: 'bill', line_sum: 100, doc_kind: 'statement' }), ['NOT_A_BILL', 'NO_REF']);
  const both = payableWarnings({ doc_ref: 'A1', total: 100, total_source: 'bill', line_sum: 100, doc_kind: 'bill' }, { duplicates: [{ id: 7, doc_date: '2026-11-01', total: 100 }], received: [{ id: 312 }] });
  assert.deepEqual(both.map(w => w.code), ['DUPLICATE', 'RECEIVED']);
  assert.match(both[0].message, /บิลซ้ำ\? เลขที่เดียวกันบันทึกแล้ว \(2026-11-01\) ยอด 100\.00/); assert.match(both[1].message, /ใบรับ #312/);
  assert.equal(sameRef('INV 0042', 'inv-0042'), true); assert.equal(sameRef('', ''), false); assert.equal(sameRef('0042', '0043'), false);
});

test('payables: edits accept only known fields, valid dates and non-negative money', () => {
  assert.deepEqual(editsFromBody({ doc_ref: ' 77 ', total: 1000, status: 'saved', doc_date: '' }), { doc_ref: '77', total: 1000, status: 'saved', doc_date: null });
  assert.deepEqual(editsFromBody({ total: '' }), { total: null });
  for (const bad of [{ total: -1 }, { total: 'abc' }, { doc_date: '1/11/2026' }, { status: 'void' }, { supplier_key: 'sm:1' }, null, []]) {
    assert.throws(() => editsFromBody(bad), error => error.code === 'VALIDATION_FAILED', JSON.stringify(bad));
  }
});

test('payables: the month owed per supplier counts saved bills; drafts and missing totals are counted apart; void never', () => {
  const result = summarize([
    { supplier_key: 'sm:6', supplier_name: 'ไทยน้ำทิพย์', status: 'saved', total: '4170.00' },
    { supplier_key: 'sm:6', supplier_name: 'ไทยน้ำทิพย์', status: 'saved', total: 830.5 },
    { supplier_key: 'sm:32', supplier_name: 'พิสมัย', status: 'saved', total: 2280 },
    { supplier_key: 'sm:32', supplier_name: 'พิสมัย', status: 'saved', total: null },
    { supplier_key: 'sm:32', supplier_name: 'พิสมัย', status: 'draft', total: 999 },
    { supplier_key: 'sm:8', supplier_name: 'แพปลา', status: 'void', total: 5000 },
  ]);
  assert.equal(result.total, 7280.5); assert.equal(result.bill_count, 4); assert.equal(result.draft_count, 1); assert.equal(result.missing_total_count, 1);
  assert.deepEqual(result.shops.map(shop => [shop.supplier_key, shop.total, shop.bill_count, shop.draft_count, shop.missing_total_count]),
    [['sm:6', 5000.5, 2, 0, 0], ['sm:32', 2280, 2, 1, 1]], 'highest amount first; a voided-only shop is not listed');
});

test('payables: routes are accounting/admin only and checked before any table is created; reads use the receiving reader', async () => {
  const controller = await source('../src/controllers/receiving-payables.controller.js');
  assert.ok(controller.indexOf('model.assertPayablesUser(req.user)') < controller.indexOf('await model.ensurePayablesTables()'));
  const model = await source('../src/models/receiving-payables.model.js');
  assert.match(model, /canReadReceivingLedger\(user\)/);
  assert.match(model, /read = extractBillWithVision/);
  assert.doesNotMatch(model, /receiving_document_lines|inventory|stock_movements|UPDATE receiving_documents/, 'never touches receipts or stock');
  const server = await source('../src/server.js');
  assert.match(server, /app\.use\('\/api\/receiving-payables', receivingPayablesRoutes\)/);
});
