import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';
import { autoDecision, withAutoDecisions, staffReceiving } from '../src/pages/receiving/review-a.js';

// Owner 2026-10-28 "มันกดเยอะมาก ลดขั้นตอนหน่อย" / "หน้าที่ของพนักงานแค่รับสินค้าให้ตรงเท่านั้น": staff count and sign.
// No read-back, no per-row decisions, no prices; only a count that differs from the bill or an AI-guessed product asks.
const staff = { id: 1, name: 'ผู้รับ', role: 'user', branch_id: 1, department_id: 1 };
const accounting = { ...staff, role: 'accounting' };
const row = patch => ({ line_no: 1, product_id: 7, product_name: 'อกไก่', order_item_id: 42, unit_text: 'กก.', quantity_ordered: '2', quantity_billed: '2',
  unit_price: '60', ordered_price: '60', amount: '120', bill_text: 'อกไก่', counted_quantity: null, quantity_received: '0', review_decision: null, match: { source: 'order', confidence: 1 }, ...patch });
const blind = lines => ({ id: 5, client_uuid: 'quick-5', status: 'draft', kind: 'bill', scope: 'department', branch_id: 1, department_id: 1, supplier_name_text: 'ร้านไก่',
  images: [{ id: 1, page_no: 1 }], early_read: 'done', ocr: { status: 'done' }, counted_complete_at: null, warnings: [], lines });
const text = h => h.text(h.visible());
const open = (doc, user = staff) => harness('DocumentEditor', { initialDocument: doc, user, onBack() {}, scanFirst: true });
const decisions = h => h.calls.filter(call => call[0] === 'update').at(-1)?.[2].lines.map(line => line.review_decision);
async function draw(h) {
  const canvas = h.find(n => n.type === 'canvas');
  canvas.props.onPointerDown({ button: 0, pointerType: 'mouse', pointerId: 1, clientX: 50, clientY: 50, preventDefault() {} });
  canvas.props.onPointerUp(); await h.settle();
}

test('staff: a count that matches the bill goes straight to the signing sheet and confirms; no read-back, decisions or prices', async () => {
  const h = await open(blind([row({ id: 1 }), row({ id: 2, line_no: 2, product_id: 8, product_name: 'ปีกกลาง', order_item_id: 43, bill_text: 'ปีกกลาง', quantity_billed: '3', unit_price: '50', ordered_price: '45', amount: '150' })]));
  await h.select('นับได้ อกไก่', '2'); await h.select('นับได้ ปีกกลาง', '3');
  await h.click('ยืนยันการนับและเทียบบิล');
  assert.equal(h.calls.filter(call => call[0] === 'count').length, 1, 'the count is sent without a read-back sheet');
  assert.deepEqual(decisions(h), ['accept', 'price_review'], 'each row takes its own decision; the price goes to accounting');
  assert.equal(h.text(h.all().find(n => n.type === 'nav')), 'นับเซ็น');
  assert.ok(h.visible().some(n => n.type === 'canvas'), 'the signing sheet opens by itself');
  await draw(h); await h.click('เซ็นและยืนยันรับ');
  assert.equal(h.calls.filter(call => call[0] === 'confirm').length, 1);
  const done = h.text(h.find(n => n.props.className === 'ra-success'));
  assert.match(done, /รับ 2 จาก 2 รายการ/); assert.doesNotMatch(done, /บาท|รอราคา|รอบิล/);
  h.unmount();
});

test('staff check screen: the received count and "ตรงบิล", nothing about price, order or bill notes', async () => {
  const h = await open(blind([row({ id: 1 })]));
  await h.select('นับได้ อกไก่', '2'); await h.click('ยืนยันการนับและเทียบบิล');
  await h.click('ยกเลิก');
  const screen = text(h);
  assert.match(screen, /รับ 1 จาก 1 รายการ/); assert.match(screen, /ตรงบิลทุกรายการ/);
  assert.doesNotMatch(screen, /ราคา|บาท|ใบสั่ง|ข้อสังเกต|ตัดสินใจ|สรุปก่อนเซ็น/);
  assert.equal(h.find(n => n.type === 'button' && h.text(n) === 'เซ็นรับของ').props.disabled, false);
  h.unmount();
});

test('staff: a count that differs from the bill stays on screen and can be counted again', async () => {
  const h = await open(blind([row({ id: 1, quantity_billed: '5', quantity_ordered: '5' })]));
  await h.select('นับได้ อกไก่', '4'); await h.click('ยืนยันการนับและเทียบบิล');
  assert.deepEqual(decisions(h), ['short']);
  assert.equal(h.visible().some(n => n.type === 'canvas'), false, 'a difference is shown before signing');
  assert.match(text(h), /ไม่ตรงบิล/); assert.match(text(h), /บิล 5 · นับ 4 กก\./);
  await h.click('นับใหม่ อกไก่'); await h.select('นับใหม่ อกไก่', '5'); await h.click('บันทึก');
  const saved = h.calls.filter(call => call[0] === 'update').at(-1)[2].lines[0];
  assert.equal(Number(saved.quantity_received), 5); assert.equal(saved.review_decision, 'accept');
  assert.match(text(h), /ตรงบิลทุกรายการ/);
  h.unmount();
});

test('staff: an AI-guessed product asks ใช่ / ไม่ใช่; ไม่ใช่ receives the bill row for accounting to link', async () => {
  const guess = row({ id: 1, product_id: 9, product_name: 'หมูสับ', order_item_id: null, quantity_ordered: null, ordered_price: null, bill_text: 'หมูบด', quantity_billed: '1', match: { source: 'ai', confidence: 0.4 } });
  const h = await open(blind([guess]));
  await h.select('นับได้ หมูสับ', '1'); await h.click('ยืนยันการนับและเทียบบิล');
  assert.match(text(h), /ใช่สินค้านี้ไหม/); assert.match(text(h), /ตอบ ใช่ \/ ไม่ใช่ ก่อนเซ็น/);
  assert.equal(h.find(n => n.type === 'button' && h.text(n) === 'เซ็นรับของ').props.disabled, true);
  await h.click('ไม่ใช่ หมูสับ');
  const saved = h.calls.filter(call => call[0] === 'update').at(-1)[2].lines[0];
  assert.equal(saved.product_id, null); assert.equal(saved.order_item_id, null);
  assert.equal(saved.review_decision, 'receive_unmatched'); assert.equal(saved.remember_alias, false);
  h.unmount();
  const yes = await open(blind([guess]));
  await yes.select('นับได้ หมูสับ', '1'); await yes.click('ยืนยันการนับและเทียบบิล'); await yes.click('ใช่ หมูสับ');
  const confirmed = yes.calls.filter(call => call[0] === 'update').at(-1)[2].lines[0];
  assert.equal(confirmed.product_id, 9); assert.equal(confirmed.review_decision, 'accept'); assert.equal(confirmed.match.source, 'manual');
  yes.unmount();
});

test('staff no-bill receipt: count, then sign; every row asks accounting for the bill', async () => {
  const h = await open({ ...blind([row({ id: 1, quantity_billed: null, unit_price: null, amount: null, bill_text: '' })]), kind: 'manual_receipt', images: [], early_read: null, ocr: { status: 'none' } });
  await h.select('นับได้ อกไก่', '2'); await h.click('ยืนยันการนับ');
  assert.deepEqual(decisions(h), ['missing_bill']);
  assert.ok(h.visible().some(n => n.type === 'canvas'));
  assert.equal(h.calls.some(call => call[0] === 'ocr'), false);
  h.unmount();
});

test('accounting keeps the read-back and the per-row review', async () => {
  const h = await open(blind([row({ id: 1 })]), accounting);
  await h.select('นับได้ อกไก่', '2'); await h.click('ยืนยันการนับและเทียบบิล');
  assert.match(text(h), /ทวนจำนวนก่อนยืนยัน/);
  await h.click('ถูกต้อง ยืนยันการนับ');
  assert.equal(h.text(h.all().find(n => n.type === 'nav')), 'นับตรวจสรุปเซ็น');
  assert.equal(h.calls.some(call => call[0] === 'update'), false, 'no automatic decisions for accounting');
  h.unmount();
});

test('automatic decisions: staff roles, unmatched rows, AI rows that did not come, no-bill receipts', () => {
  assert.equal(staffReceiving({ role: 'user' }), true); assert.equal(staffReceiving({ role: 'staff' }), true);
  for (const role of ['admin', 'super_admin', 'accounting', 'accountant']) assert.equal(staffReceiving({ role }), false);
  const doc = { kind: 'bill', ocr: { status: 'done' } };
  const counted = patch => row({ counted_quantity: '2', quantity_received: '2', ...patch });
  assert.equal(autoDecision(counted({ product_id: null, order_item_id: null, product_name: null }), doc), 'receive_unmatched');
  assert.equal(autoDecision(counted({ product_id: null, order_item_id: null, counted_quantity: '0', quantity_received: '0' }), doc), 'short');
  assert.equal(autoDecision(counted({ match: { source: 'ai' } }), doc), null, 'a guessed product needs a person');
  assert.equal(autoDecision(counted({ match: { source: 'ai' }, counted_quantity: '0', quantity_received: '0' }), doc), 'short');
  assert.equal(autoDecision(counted({}), { kind: 'manual_receipt' }), 'missing_bill');
  assert.equal(autoDecision(counted({}), { kind: 'bill', ocr: { status: 'failed' } }), null, 'waits for the bill');
  const unmatched = withAutoDecisions({ ...doc, lines: [counted({ product_id: null, order_item_id: null, remember_alias: true })] }).lines[0];
  assert.equal(unmatched.remember_alias, false);
  assert.equal(withAutoDecisions({ ...doc, lines: [counted({ review_decision: 'accept' })] }), null);
});
