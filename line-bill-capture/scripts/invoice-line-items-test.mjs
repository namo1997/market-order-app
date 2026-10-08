import assert from 'node:assert/strict';
import { INVOICE_LINE_ITEMS_SCHEMA, normalizeInvoiceLineItems, normalizeInvoiceLineItemsResult } from '../src/invoice-line-items.js';
import { normalizeAnalysis } from '../src/ai-worker.js';

const row = { line_no: 1, description: 'ปลา 1 แพ็ค x 6', product_code: '001', quantity: 2, unit: 'แพ็ค x 6', unit_price: 10, amount: 20 };
assert.deepEqual(normalizeInvoiceLineItems([row, row]), [row, row]);
assert.deepEqual(normalizeInvoiceLineItems([{ description: '  ปลา  ' }]), [{
  line_no: null, description: 'ปลา', product_code: null, quantity: null, unit: null, unit_price: null, amount: null
}]);
assert.deepEqual(normalizeInvoiceLineItems([{ ...row, quantity: null, unit_price: null, amount: null }])[0], { ...row, quantity: null, unit_price: null, amount: null });
assert.equal(normalizeInvoiceLineItems([{ ...row, quantity: 0, unit_price: 0, amount: 0 }])[0].amount, 0);
const malformed = [null, [], 'fish', {}, { description: ' ' },
  ...['quantity', 'unit_price', 'amount'].flatMap((key) => ['0', '', true, -1, Infinity, NaN].map((value) => ({ ...row, [key]: value }))),
  ...[0, -1, 1.5, '1', Infinity].map((line_no) => ({ ...row, line_no })),
  { ...row, description: 'x'.repeat(501) }, { ...row, product_code: 'x'.repeat(101) },
  { ...row, unit: 'x'.repeat(81) }, { ...row, product_code: 123 }, { ...row, unit: false }
];
assert.deepEqual(normalizeInvoiceLineItemsResult(malformed), { items: [], truncated: false, invalid_count: malformed.length });
assert.deepEqual(normalizeInvoiceLineItemsResult(undefined), { items: [], truncated: false, invalid_count: 0 });
assert.deepEqual(normalizeInvoiceLineItemsResult({ description: 'fish' }), { items: [], truncated: false, invalid_count: 1 });
const oversized = normalizeInvoiceLineItemsResult(Array.from({ length: 301 }, () => row));
assert.equal(oversized.items.length, 300);
assert.equal(oversized.truncated, true);
assert.equal(oversized.invalid_count, 0);
const mixed = normalizeInvoiceLineItemsResult([malformed[0], row]);
assert.deepEqual(mixed, { items: [row], truncated: false, invalid_count: 1 });
assert.equal(INVOICE_LINE_ITEMS_SCHEMA.maxItems, 300);
assert.equal(INVOICE_LINE_ITEMS_SCHEMA.items.additionalProperties, false);
// ทดสอบเส้นทาง normalize จริงโดยไม่เรียก AI หรือเปิดฐานข้อมูล
const legacy = normalizeAnalysis({ category: 'bill', bill_total_value: 3432.5 });
assert.deepEqual(legacy.line_items, []);
assert.equal(legacy.bill_subtotal_value, null);
assert.equal(legacy.discount_value, null);
assert.equal(legacy.line_items_complete, null);
assert.equal(legacy.needs_review, false);
const normalizedAi = normalizeAnalysis({ category: 'bill', bill_total_value: 3432.5,
  bill_subtotal_value: 3450.5, discount_value: 18,
  line_items: [row, row, { ...row, amount: '20' }] });
assert.deepEqual(normalizedAi.line_items, [row, row]);
assert.equal(normalizedAi.line_items_invalid_count, 1);
assert.equal(normalizedAi.line_items_complete, false);
assert.equal(normalizedAi.bill_total_value, 3432.5);
assert.equal(normalizedAi.bill_subtotal_value, 3450.5);
assert.equal(normalizedAi.discount_value, 18);
assert.equal(normalizedAi.needs_review, false);
const roundtrip = normalizeAnalysis(JSON.parse(JSON.stringify(normalizedAi)));
assert.deepEqual(roundtrip.line_items, normalizedAi.line_items);
assert.equal(roundtrip.line_items_invalid_count, 1);
assert.equal(roundtrip.line_items_complete, false);
assert.equal(roundtrip.bill_total_value, 3432.5);
assert.equal(normalizeAnalysis({ ...normalizedAi, bill_subtotal_value: '3450.50', discount_value: false }).bill_subtotal_value, null);
assert.equal(normalizeAnalysis({ ...normalizedAi, discount_value: false }).discount_value, null);
const truncatedAi = normalizeAnalysis({ category: 'bill', line_items: Array.from({ length: 301 }, () => row) });
assert.equal(normalizeAnalysis(JSON.parse(JSON.stringify(truncatedAi))).line_items_truncated, true);
assert.equal(truncatedAi.line_items_complete, false);
assert.equal(normalizeAnalysis({ category: 'bill', line_items: [row], line_items_complete: false }).line_items_complete, false);
assert.equal(normalizeAnalysis({ category: 'bill', line_items: [row], line_items_complete: true }).line_items_complete, true);
assert.equal(normalizeAnalysis({ category: 'bill', line_items: [], line_items_complete: true }).line_items_complete, true);
assert.equal(normalizeAnalysis({ category: 'bill', line_items: [row], line_items_complete: 'true' }).line_items_complete, null);
assert.equal(normalizeAnalysis({ category: 'bill', line_items: [null], line_items_complete: true }).line_items_complete, false);
console.log('invoice-line-items: nulls, strict cells, invalid rows, duplicates, pack units and 300-row limit passed');
