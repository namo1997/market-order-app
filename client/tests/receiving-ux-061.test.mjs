import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { harness } from './receiving-harness.mjs';
import { documentReviewSummary, reviewFingerprint } from '../src/pages/receiving/receiving-review.js';
import { moneyStatus, priceCompleteness } from '../src/pages/receiving/receiving-status.js';

const line = (id, values = {}) => ({ id, line_no: id, product_id: id, order_item_id: id,
  product_name: `ผัก ${id}`, unit_text: 'กก.', quantity_received: '1', quantity_billed: '1', amount: '10', unit_price: '10',
  match: { source: 'order' }, ...values });
const document = (values = {}) => ({ id: 5, status: 'draft', kind: 'bill', delivery_date: '2026-10-16',
  has_receiver_signature: true, total: '20', discount: '0', vat: '0', images: [], lines: [line(1), line(2)],
  ocr: { status: 'done' }, warnings: [{ code: 'PRICE_CHANGE', line_no: 1 }], ...values });
const expected = [1, 2].map(id => ({ order_item_id: id, product_id: id, quantity_ordered: '1', received_quantity: '0', unit_name: 'กก.' }));
const editor = (doc = document(), overrides = {}) => harness('DocumentEditor', { initialDocument: doc,
  user: { id: 1, name: 'ผู้รับ', role: 'receiver' }, onBack() {}, onChanged() {} },
{ expected: async () => [{ items: expected }], ...overrides }, {}, {}, { setTimeout: done => { done(); return 1; }, clearTimeout() {} });
const summaryLabel = (h) => h.find(node => node.props.className === 'rc-review-trigger').props['aria-label'];
const buttonTexts = h => h.visible().filter(node => node.type === 'button').map(node => h.text(node));





test('UX061 #1: equal counts with different reasons still require an updated summary', () => {
  const before = documentReviewSummary(document(), expected);
  const after = documentReviewSummary(document({ warnings: [{ code: 'LOW_CONFIDENCE', line_no: 1 }] }), expected);
  assert.equal(before.itemCount, after.itemCount); assert.notEqual(reviewFingerprint(before), reviewFingerprint(after));
});

test('UX061 #2: missing/blank prices differ from explicit zero while the money equation remains unchanged', () => {
  const lines = [line(1, { amount: null, unit_price: null }), line(2, { amount: '', unit_price: '' }),
    line(3, { amount: '0', unit_price: null }), line(4, { amount: null, unit_price: '0' })];
  assert.deepEqual(priceCompleteness(lines), { missingCount: 2, label: 'ยังไม่มีราคา 2 รายการ' });
  const money = moneyStatus(lines, '0', '0', '0'); assert.equal(money.status, 'ok'); assert.equal(money.adjusted, 0n);
  assert.deepEqual(priceCompleteness([line(1)]), { missingCount: 0, label: '' });
});





test('UX061 #4: same code+line across bill/OCR sources merges once; different lines and unknown scope survive', () => {
  const doc = document({ warnings: [{ code: 'PRICE_CHANGE', line_no: 1 }, { code: 'PRICE_CHANGE', line_no: 2 }, { code: 'PRICE_CHANGE' }],
    ocr: { warnings: [{ code: 'PRICE_CHANGE', line_no: '1' }, { code: 'PRICE_CHANGE', line_no: '2' }, 'PRICE_CHANGE'] } });
  const checks = documentReviewSummary(doc, expected);
  assert.equal(checks.itemCount, 2); assert.equal(checks.documentCount, 1);
  for (const row of checks.rows) assert.equal(row.reasons.filter(reason => reason.includes('ราคาเปลี่ยน')).length, 1);
  assert.match(checks.documentReasons[0], /^ทั้งบิล \(ไม่ระบุรายการ\): ราคาเปลี่ยน/);
  assert.equal(doc.ocr.warnings.length, 3, 'summarizing never mutates source warnings');
});





test('UX061 #4: identical fallback text from distinct codes/scopes is never silently discarded', () => {
  const checks = documentReviewSummary(document({ warnings: [{ code: 'UNKNOWN_A' }, { code: 'UNKNOWN_B' },
    { code: 'UNKNOWN_A', line_no: 1 }, { code: 'UNKNOWN_B', line_no: 1 }] }), expected);
  assert.equal(checks.documentCount, 2); assert.equal(checks.rows.length, 1); assert.equal(checks.rows[0].reasons.length, 2);
});
