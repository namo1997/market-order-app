import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';
import { documentReviewSummary, reviewAttention, reviewChangeMessage } from '../src/pages/receiving/receiving-review.js';

const line = (id, values = {}) => ({ id, line_no: id, product_id: id, order_item_id: id,
  product_name: `ผัก ${id}`, unit_text: 'กก.', quantity_received: '1', quantity_billed: '1',
  amount: '10', unit_price: '10', match: { source: 'manual' }, ...values });
const doc = (values = {}) => ({ id: 5, status: 'draft', kind: 'bill', delivery_date: '2026-10-16',
  product_group_id: 1, supplier_name_text: 'ร้าน 1', has_receiver_signature: true,
  total: '20', discount: '0', vat: '0', images: [], lines: [line(1), line(2)],
  ocr: { status: 'done' }, warnings: [], ...values });
const group = (id, received = false) => ({ supplier_key: `pg:${id}`, supplier_name: `ร้าน ${id}`,
  items: [{ order_item_id: id, product_id: id, product_name: `ผัก ${id}`, quantity_ordered: '1',
    received_quantity: received ? '1' : '0', is_received: received, unit_name: 'กก.' }] });
const text = h => h.text(h.visible()[0]);
const primary = h => h.find(node => node.type === 'button' && node.props.className?.includes('sg-primary'));
const editor = (initial = doc(), overrides = {}, props = {}) => harness('DocumentEditor', {
  initialDocument: initial, user: { id: 1, name: 'ผู้รับ', role: 'receiver' }, onBack() {}, onChanged() {}, ...props,
}, { expected: async () => [{ items: [group(1).items[0], group(2).items[0]] }], ...overrides }, {}, {},
{ setTimeout: done => { done(); return 1; }, clearTimeout() {} });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

// Use real Receiving -> DocumentEditor -> confirm handlers; only HTTP/timers are mocked.
async function confirmWithQueue(before, overrides = {}, failList = false) {
  const queue = deferred();
  let confirmed = false, confirmations = 0;
  const initial = doc();
  const h = await harness('Receiving', {}, {
    expected: async () => confirmed ? queue.promise : before,
    list: async () => { if (confirmed && failList) { await queue.promise; throw new Error('โหลดเอกสารไม่ได้'); } return [initial]; },
    get: async () => initial,
    confirm: async () => { confirmed = true; confirmations++; return { ...initial, status: 'confirmed' }; },
    ...overrides,
  }, {}, {}, { setTimeout: done => { done(); return 1; }, clearTimeout() {} });
  await h.radio('documents'); await h.click('เปิดเอกสาร #5 ร้าน 1 ร่าง');
  await h.radio('sign'); await h.click('ตรวจรับ'); await h.click('ยืนยัน');
  assert.equal(confirmations, 1);
  assert.equal(h.text(primary(h)), 'กำลังโหลดคิว…'); assert.equal(primary(h).props.disabled, true);
  assert.ok(!text(h).includes('รับร้านถัดไป')); assert.ok(!text(h).includes('กลับหน้ารับสินค้า'));
  assert.ok(h.visible().some(node => node.type === 'button' && h.text(node) === 'ดูเอกสาร'));
  h.budget();
  return { h, queue, confirmations: () => confirmations };
}





















test('UX064 #2: missing-price changes retain acknowledgement message without repeating the price notice copy', async () => {
  const before = documentReviewSummary(doc(), [group(1).items[0], group(2).items[0]]);
  const after = documentReviewSummary(doc({ lines: [line(1), line(2, { amount: null, unit_price: null })], total: '10' }),
    [group(1).items[0], group(2).items[0]]);
  assert.equal(reviewAttention({ ...after, unreviewedCount: 2 }), '');
  assert.equal(reviewChangeMessage(before, after), 'สรุปเปลี่ยน: ข้อมูลราคาเปลี่ยน');
  assert.equal(after.pricing.label, 'ยังไม่มีราคา 1 รายการ');
});
