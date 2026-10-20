import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';
import { reusableDraft } from '../src/pages/receiving/draft-reuse.js';
import { rowDecision, orderDifference, receiptDecisionText } from '../src/pages/receiving/review-a.js';
const user = { id: 12, role: 'user', branch_id: 1, department_id: 10, receiving_scope: 'department' };
const line = { id: 1, product_id: 7, product_name: 'ปีกกลาง', order_item_id: 50, line_no: 1, unit_text: 'กิโลกรัม', quantity_ordered: '10', counted_quantity: '40', quantity_received: '40', quantity_billed: '40', unit_price: '60', match: { source: 'order' } };
const doc = (patch = {}) => ({ id: 5, client_uuid: 'round-k', status: 'draft', kind: 'bill', delivery_date: '2026-10-20', images: [], warnings: [], ocr: { status: 'done' }, counted_complete_at: '2026-10-20T01:00:00Z', lines: [line], ...patch });
const text = h => h.text(h.visible());

test('K2 same supplier/date/branch/scope offers oldest draft and never conflates departments, dates, or suppliers', () => {
  const base = { ...doc(), branch_id: 1, department_id: 10, product_group_id: 3 };
  const options = { group: { supplier_key: 'pg:3' }, date: base.delivery_date, user };
  assert.equal(reusableDraft([{ ...base, id: 9 }, base], options).id, 5);
  for (const patch of [{ status: 'confirmed' }, { status: 'void' }, { delivery_date: '2026-10-19' }, { branch_id: 2 }, { department_id: 30 }, { scope: 'branch' }, { product_group_id: 4 }]) assert.equal(reusableDraft([{ ...base, ...patch }], options), null);
  assert.equal(reusableDraft([{ ...base, scope: 'branch', department_id: 30 }], { ...options, user: { ...user, receiving_scope: 'branch' } }).id, 5);
});

test('K2 creation form resumes saved draft by ID without creating or overwriting its original kind/lines', async () => {
  const current = doc({ kind: 'manual_receipt' });
  const opened = [];
  const h = await harness('CreateDocument', { user, group: { supplier_key: 'pg:3', supplier_name: 'ร้านไก่', items: [] }, date: current.delivery_date, existingDocument: current, onCreated: next => opened.push(next), onClose() {} }, { get: async id => { assert.equal(id, 5); return current; }, create: async () => assert.fail('must resume') });
  assert.match(text(h), /ทำต่อใบ #5/);
  await h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.equal(opened[0].kind, 'manual_receipt'); assert.equal(h.calls.some(c => c[0] === 'create'), false);
});

test('K2 new receiving forms send resume_draft so server handles stale queue/restart races', async () => {
  const h = await harness('CreateDocument', { user, group: { supplier_key: 'pg:3', supplier_name: 'ร้านไก่', items: [] }, date: '2026-10-20', onCreated() {}, onClose() {} });
  await h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.equal(h.calls.find(c => c[0] === 'create')[1].resume_draft, true);
});

test('K3 blind capture explains deferred AI and hidden preview for local and uploaded pages without exposing bill images', async () => {
  for (const saved of [false, true]) {
    const h = await harness('ImagePages', { doc: doc({ counted_complete_at: null, images: saved ? [{ id: 2, page_no: 1 }] : [] }), blind: true, pending: saved ? [] : [{ key: 'photo', dataUrl: 'data:image/jpeg;base64,fixture' }], setPending() {}, setProcessing() {}, inputRef: { current: {} } });
    assert.match(text(h), /ถ่ายแล้ว 1 หน้า · จะส่งให้ AI อ่านหลังนับครบ/);
    assert.match(text(h), /ซ่อนรูปบิลไว้ระหว่างนับของ/); assert.doesNotMatch(text(h), /รอส่ง 1 หน้า/);
    assert.equal(h.all().some(n => n.type === 'img' && String(n.props.src).startsWith('data:image')), false);
  }
});

test('K4 zero physical/received and missing or zero bill has one meaningful decision; positive goods keep bill/return choices', async () => {
  for (const quantity_billed of [null, '0']) {
    const absent = { ...line, counted_quantity: '0', quantity_received: '0', quantity_billed };
    const h = await harness('ReviewRows', { doc: doc({ lines: [absent] }), onDecide() {} });
    assert.equal(rowDecision(absent, doc()).kind, 'not_delivered');
    assert.match(text(h), /ไม่ได้มาส่ง · ค้างตามใบสั่ง \(ตามของ\)/);
    assert.doesNotMatch(text(h), /ขอบิลจากร้าน|คืนร้าน 0/);
    assert.equal(receiptDecisionText({ ...absent, review_decision: 'not_delivered' }), 'ไม่ได้มาส่ง · ค้างตามใบสั่ง (ตามของ)');
  }
  assert.equal(rowDecision({ ...line, quantity_billed: null }, doc()).kind, 'missing_bill');
  assert.equal(rowDecision({ ...line, counted_quantity: '0', quantity_received: '0', quantity_billed: '1' }, doc()).kind, 'short');
});

test('K5 counted 40/billed 40/ordered 10 warns over 30 and requires individual acceptance outside bulk matched rows', async () => {
  const h = await harness('DocumentEditor', { initialDocument: doc(), user, onBack() {} });
  assert.match(text(h), /เกินจากใบสั่ง 30 กิโลกรัม \(ข้อมูลประกอบ\)/);
  assert.equal(h.find(n => n.type === 'button' && h.text(n) === 'ยืนยันทั้งหมดที่ตรง').props.disabled, true);
  await h.click('ยืนยันรับเกินใบสั่ง 40 กิโลกรัม');
  assert.equal(h.calls.find(c => c[0] === 'update')[2].lines[0].review_decision, 'over_order');
  assert.equal(orderDifference({ ...line, quantity_received: '0.3', quantity_ordered: '0.1', quantity_billed: '0.3' }), 'เกินจากใบสั่ง 0.2 กิโลกรัม');
  assert.equal(orderDifference({ ...line, quantity_ordered: null }), '');
  assert.equal(rowDecision({ ...line, quantity_ordered: '40' }, doc()).kind, 'accept');
  const price = rowDecision({ ...line, ordered_price: '50' }, doc());
  assert.equal(price.kind, 'price_review'); assert.match(price.action, /ยืนยันรับเกินใบสั่ง.*ส่งตรวจราคา/);
});

test('K1 editor registers safe previous steps and refuses Back while OCR outcome is pending', async () => {
  let action;
  const h = await harness('DocumentEditor', { initialDocument: doc(), user, onBack() {}, onBackActionChange: value => { action = value; } });
  action.back(); await h.settle(); assert.equal(h.find(n => n.props['data-step']).props['data-step'], 'images');
  const pending = await harness('DocumentEditor', { initialDocument: doc({ ocr: { status: 'pending' } }), user, onBack() {}, onBackActionChange: value => { action = value; } });
  assert.equal(action.blocked, true); pending.unmount(); assert.equal(action, null);
});
