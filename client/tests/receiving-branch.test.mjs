import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, armPad } from './receiving-harness.mjs';
import { canReceiveBranch, branchOrderIds } from '../src/pages/receiving/receiving-branch.js';
import { hasPendingQuantity } from '../src/pages/receiving/receiving-queue.js';
import { pendingKey } from '../src/pages/receiving/receiving-utils.js';
const user = { id: 12, role: 'user', branch_id: 1, department_id: 10, name: 'หัวหน้า' };
const parts = [{ order_item_id: 50, department_id: 10, department_name: 'ครัว', quantity_ordered: '6', quantity_received: '6' },
  { order_item_id: 60, department_id: 30, department_name: 'สโตร์', quantity_ordered: '4', quantity_received: '4' }];
const group = { supplier_key: 'pg:3', supplier_name: 'ร้านผัก', branch_id: 1, scope: 'branch', status: 'due_today', due_date: '2026-10-18',
  items: [{ order_item_id: 50, order_item_ids: [50,60], product_id: 7, product_name: 'ผัก', unit_name: 'กก.',
    quantity_ordered: '10', received_quantity: '0', remaining_quantity: '10.00', is_received: false, departments: parts }] };
const document = () => ({ counted_complete_at: '2026-10-18T00:00:00Z', id: 1, scope: 'branch', status: 'draft', kind: 'bill', branch_id: 1, department_id: 10,
  created_at: '2026-10-18T06:00:00Z', receiver_user_id: 12, supplier_name_text: 'ร้านผัก', delivery_date: '2026-10-18', doc_ref: null, doc_date: null,
  total: null, images: [], warnings: [], ocr: { status: 'done' }, has_receiver_signature: true,
  lines: [{ id: 1, line_no: 1, product_id: 7, product_name: 'ผัก', bill_text: 'ผัก', order_item_id: 50,
    review_decision: null, counted_quantity: '10', unit_id: 2, unit_text: 'กก.', quantity_received: '10', quantity_billed: null, unit_price: '20', amount: null,
    match: { source: 'order', confidence: 1 }, departments: parts }] });

test('branch permission matches legacy authenticated users; pending UUID isolated by scope; selected totals retain all order IDs', () => {
  assert.equal(canReceiveBranch(user), true); assert.equal(canReceiveBranch({ ...user, role: 'admin', branch_id: null }), true);
  assert.equal(canReceiveBranch({ ...user, branch_id: null }), false); assert.equal(canReceiveBranch({}), false);
  assert.deepEqual(branchOrderIds(group.items), [50,60]);
  assert.notEqual(pendingKey(user), pendingKey({ ...user, receiving_scope: 'branch' }));
});

test('scope selector sends branch expected/list; shop reveals departments; create submits every department in one request', async () => {
  const requests = []; const sent = [];
  const h = await harness('Receiving', {}, { expected: async (date, scope) => { requests.push(['expected',scope]); return [group]; },
    list: async filters => { requests.push(['list',filters]); return []; }, create: async body => { sent.push(body); return document(); } }, { user });
  await h.radio('branch');
  assert.equal(requests.at(-2)[1].scope, 'branch'); assert.equal(requests.at(-1)[1].scope, 'branch');
  await h.click('ดูเอกสาร');
  assert.equal(h.visible().some(node => node.type === 'form' && node.props.id === 'rc-create'), false);
  await h.click('ดูคิวรอรับ');
  await h.click('เลือกร้าน ร้านผัก'); assert.match(h.text(h.visible()), /แยกแผนก/);
  assert.match(h.text(h.visible()), /ครัว/); assert.match(h.text(h.visible()), /สโตร์/);
  await h.click('รับของ ร้านผัก');
  const form = h.find(node => node.type === 'form' && node.props.id === 'rc-create');
  await form.props.onSubmit({ preventDefault() {} }); await h.settle();
  const body = sent[0];
  assert.equal(body.scope, 'branch'); assert.deepEqual([...body.order_item_ids], [50,60]);
  assert.equal(sent.length, 1);
  assert.ok(h.find(node => node.props['aria-label'] === 'ใบรับทั้งสาขา'));
  assert.match(h.text(h.visible()), /นับของครบแล้ว/); h.unmount();
});

test('branch creation deselects/reselects all department IDs; retry keeps UUID and selected scope', async () => {
  const sent = []; let fail = true;
  const h = await harness('CreateDocument', { group, date: '2026-10-18', user: { ...user, receiving_scope: 'branch' }, onCreated() {}, onClose() {} },
    { create: async body => { sent.push(body); if (fail) throw { request: {} }; return { ...document(), client_uuid: body.client_uuid }; } });
  let checkbox = h.find(node => node.type === 'input' && node.props.type === 'checkbox');
  checkbox.props.onChange({ target: { checked: false } }); await h.settle();
  checkbox = h.find(node => node.type === 'input' && node.props.type === 'checkbox'); assert.equal(checkbox.props.checked, false);
  checkbox.props.onChange({ target: { checked: true } }); await h.settle();
  const submit = () => h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  await submit(); await h.settle(); fail = false; await submit(); await h.settle();
  assert.equal(sent[0].client_uuid, sent[1].client_uuid); assert.equal(sent[1].scope, 'branch');
  assert.deepEqual([...sent[1].order_item_ids], [50,60]); h.unmount();
});

for (const qty of ['5', '15', '0.01']) {
  test(`branch editor ${qty}: edit aggregate, save breakdown, confirm once; blocked while dirty/offline`, async () => {
    let current = document(); let release;
    const h = await harness('BranchDocumentEditor', { initialDocument: current, user, onBack() {}, onChanged() {} }, {
      update: async (id, body) => { current = { ...current, lines: current.lines.map(line => ({ ...line, ...body.lines.find(patch => patch.id === line.id), departments: parts })) }; h.calls.push(['updated', body]); return current; },
      confirm: async () => { h.calls.push(['confirmed']); return new Promise(resolve => { release = () => resolve({ ...current, status: 'confirmed' }); }); },
    });
    await h.click('แก้'); await h.select('แก้จำนวนหลังเปิดบิล ผัก', qty);
    assert.equal(h.find(node => node.type === 'button' && h.text(node) === 'ดูสรุปก่อนเซ็น').props.disabled, true);
    await h.click(`รับ ${qty} กก. · ให้บัญชีขอบิลจากร้าน`);
    const saved = h.calls.find(call => call[0] === 'updated')[1];
    assert.equal(Number(saved.lines[0].quantity_received), Number(qty)); assert.equal(saved.lines.length, 1);
    assert.match(h.text(h.visible()), /ตัดสินใจแล้ว/);
    await h.click('ดูสรุปก่อนเซ็น'); await h.click('ไปเซ็นรับของ');
    const button = h.find(node => node.type === 'button' && h.text(node) === 'ยืนยันรับสินค้า');
    const request = button.props.onClick(); await h.settle(); await button.props.onClick();
    assert.equal(h.calls.filter(call => call[0] === 'confirmed').length, 1);
    release(); await request; await h.settle(); assert.match(h.text(h.visible()), /ยืนยันแล้ว/); h.unmount();
    const offline = await harness('BranchDocumentEditor', { initialDocument: document(), user, online: false });
    assert.equal(offline.find(node => node.type === 'button' && offline.text(node) === 'ดูสรุปก่อนเซ็น').props.disabled, true); offline.unmount();
  });
}

test('branch editor confirmed view shows totals/departments and voids whole document with reason', async () => {
  let next;
  const h = await harness('BranchDocumentEditor', { initialDocument: { ...document(), status: 'confirmed' }, user: { ...user, role: 'admin' }, onChanged: value => { next = value; } });
  assert.match(h.text(h.visible()), /200.00 บาท/); assert.ok(h.visible().some(node => node.type === 'img' || h.text(node).includes('เซ็นแล้ว'))); assert.match(h.text(h.visible()), /ครัว/);
  await h.select('เหตุผลยกเลิก', 'ผิดบิล'); await h.click('ยกเลิกใบรับ');
  assert.deepEqual(h.calls.find(call => call[0] === 'void').slice(1), [1, 'ผิดบิล']); assert.equal(next.status, 'void'); h.unmount();
});

test('branch queue does not hide a pending department behind another department over-receipt', () => {
  assert.equal(hasPendingQuantity({ order_item_ids: [50,60], quantity_ordered: '10', received_quantity: '10', remaining_quantity: '4' }), true);
});

test('branch header-only save preserves department quantities; price-only save sends no quantity redistribution', async () => {
  const initial = document(); initial.lines[0].quantity_received = '4';
  initial.lines[0].departments = parts.map((part, i) => ({ ...part, quantity_received: i ? '4' : '0' }));
  let current = initial;
  const sent = [];
  const h = await harness('BranchDocumentEditor', { initialDocument: initial, user, onChanged() {} }, {
    update: async (id, body) => { sent.push(body); current = { ...current, doc_ref: body.doc_ref,
      lines: current.lines.map(line => ({ ...line, ...body.lines.find(patch => patch.id === line.id) })) }; return current; },
  });
  await h.select('เลขที่บิล', 'BR-1'); await h.click('บันทึกหัวบิล');
  assert.equal(sent[0].lines[0].quantity_received, undefined);
  assert.deepEqual(current.lines[0].departments.map(part => part.quantity_received), ['0','4']);
  await h.click('แก้'); await h.select('ราคาบิล ผัก', '25'); await h.click('รับ 4 กก. · ให้บัญชีขอบิลจากร้าน');
  assert.equal(sent[1].lines[0].quantity_received, undefined);
  assert.equal(sent[1].lines[0].unit_price, '25'); assert.equal(sent[1].lines[0].amount, '100.00');
  h.unmount();
});

test('branch cannot confirm while new signature ink is unsaved', async () => {
  const initial = document(); initial.lines[0].review_decision = 'accept';
  const h = await harness('BranchDocumentEditor', { initialDocument: initial, user, onChanged() {} });
  await h.click('ดูสรุปก่อนเซ็น'); await h.click('ไปเซ็นรับของ'); await h.click('ล้างแล้วเซ็นใหม่');
  await armPad(h);
  const pad = h.find(node => node.type === 'canvas');
  pad.props.onPointerDown({ button: 0, pointerType: 'mouse', pointerId: 1, clientX: 30, clientY: 30, preventDefault() {} });
  pad.props.onPointerUp(); await h.settle();
  assert.ok(!h.visible().some(node => node.type === 'button' && h.text(node) === 'ยืนยันรับสินค้า'));
  await h.click('ยกเลิก');
  assert.equal(h.find(node => node.type === 'button' && h.text(node) === 'ยืนยันรับสินค้า').props.disabled, true);
  h.unmount();
});

test('branch additional receipt without order cannot open an empty branch draft', async () => {
  const h = await harness('Receiving', {}, {}, { user });
  await h.radio('branch'); await h.click('ตัวเลือก');
  assert.equal(h.find(node => node.type === 'button' && h.text(node) === 'รับสินค้าเพิ่ม (ไม่อ้างอิงใบสั่ง)').props.disabled, true);
  assert.match(h.text(h.visible()), /หากไม่มีใบสั่งให้เลือกแผนกของฉัน/);
  h.unmount();
});
