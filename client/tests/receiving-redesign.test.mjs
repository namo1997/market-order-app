import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { harness } from './receiving-harness.mjs';
import { reviewCounters, transitionReview, newReviewState } from '../src/pages/receiving/line-review-state.js';

const user = { id: 1, name: 'มาลี', role: 'receiver', branch_id: 1, department_id: 1 };
const row = (id, values = {}) => ({ id, line_no: id, product_id: id, order_item_id: id, product_name: `สินค้า ${id}`, bill_text: `สินค้า ${id}`,
  quantity_received: '1', quantity_billed: '1', unit_price: '10', amount: '10', unit_text: 'กก.', match: { source: 'order', confidence: .95 }, ...values });
const items = rows => rows.map(line => ({ order_item_id: line.id, product_id: line.id, product_name: line.product_name, quantity_ordered: '1', received_quantity: '0', unit_name: 'กก.' }));
const document = (values = {}) => ({ id: 21, status: 'draft', kind: 'bill', supplier_name_text: 'ร้านป้าดา', delivery_date: '2026-10-16', receiver_name: user.name,
  lines: [row(1), row(2), row(3)], total: '30', vat: '0', discount: '0', images: [], warnings: [], ocr: { status: 'done' }, ...values });
const editor = (doc = document(), api = {}, props = {}, runtime = {}) => harness('DocumentEditor', { initialDocument: doc, user, onBack() {}, onChanged() {}, ...props }, {
  expected: async () => [{ items: items(doc.lines) }], ...api,
}, {}, {}, { setTimeout: done => { done(); return 1; }, clearTimeout() {}, ...runtime });
const chosen = h => h.visible().filter(node => node.type === 'input' && node.props.type === 'checkbox' && node.props.checked);
const primary = h => h.find(node => node.type === 'button' && node.props.className?.includes('sg-primary'));
const ink = async h => { const pad = h.find(node => node.type === 'canvas'); pad.props.onPointerDown({ pointerType: 'mouse', button: 0, pointerId: 1, clientX: 30, clientY: 30, preventDefault() {} }); pad.props.onPointerUp(); await h.settle(); };

test('redesign B home: current shop has only three preview rows; visible queue changes capture context without creating', async () => {
  const groups = ['ร้านป้าดา', 'ร้านเจ๊นิด', 'ร้านลุงชัย'].map((supplier_name, index) => ({ supplier_key: `pg:${index}`, supplier_name, items: items(Array.from({ length: index ? 2 : 56 }, (_, i) => row(i + 1))) }));
  const h = await harness('Receiving', {}, { expected: async () => groups });
  assert.match(h.text(h.visible()), /เช้านี้รับจาก 3 ร้าน/);
  assert.equal(h.visible().filter(node => node.type === 'li').length, 3);
  assert.match(h.text(h.visible()), /รอรับ60 รายการ/);
  await h.click('ดูรายการทั้งหมด 56 รายการ'); assert.equal(h.visible().filter(node => node.type === 'li').length, 56);
  await h.click('เลือกร้าน ร้านเจ๊นิด');
  assert.equal(h.text(primary(h)), 'ถ่ายบิลร้านนี้'); assert.equal(h.calls.length, 0);
  await h.click('ถ่ายบิลร้านนี้'); assert.ok(h.find(node => node.type === 'input' && node.props.value === 'ร้านเจ๊นิด'));
  h.unmount();
});

test('redesign home: empty result offers capture; document tab still creates an independent receipt', async () => {
  const h = await harness('Receiving', {}, { expected: async () => [] });
  assert.ok(h.visible().some(node => node.props['data-illustration'] === 'empty-today'));
  assert.equal(h.text(primary(h)), 'ถ่ายบิล'); await h.click('ถ่ายบิล');
  assert.ok(h.find(node => node.type === 'form')); h.unmount();
  const other = await harness('Receiving'); await other.radio('documents'); await other.click('ถ่ายบิล');
  const supplier = other.find(node => node.type === 'input' && node.props.maxLength === 255);
  assert.equal(supplier.props.value, ''); other.unmount();
});

test('redesign selection: all selects only safe displayed rows, clear changes no data, filter change clears stale selection', async () => {
  const h = await editor(document({ warnings: [{ code: 'LOW_CONFIDENCE', line_no: 2 }], lines: [row(1), row(2), row(3, { unit_text: 'ถุง' })] }));
  await h.radio('lines'); assert.equal(chosen(h).length, 0);
  await h.click('เลือกทั้งหมดที่แสดง'); assert.equal(chosen(h).length, 1); assert.equal(chosen(h)[0].props.id, 'line-0-review');
  assert.match(h.text(h.visible()), /ตรวจแล้ว 0\/3/); assert.equal(h.calls.length, 0);
  await h.click('ล้างที่เลือก'); assert.equal(chosen(h).length, 0);
  await h.click('เลือกทั้งหมดที่แสดง'); await h.click('ทั้งหมด'); assert.equal(chosen(h).length, 0); h.unmount();
});

test('redesign selection: accepting filtered proposals does not select or overwrite a reviewed manual row', async () => {
  const h = await editor(document({ lines: [row(1), row(2, { match: { source: 'manual' }, quantity_received: '0.5' }), row(3)] }));
  await h.radio('lines'); await h.click('เลือกทั้งหมดที่แสดง'); assert.equal(chosen(h).length, 2);
  await h.click('ใช้ AI 2 รายการ'); assert.match(h.text(h.all()), /ตรวจแล้ว 1\/3/);
  await h.click('ใช้ค่ากับ 2 รายการ'); assert.match(h.text(h.visible()), /ตรวจแล้ว 3\/3/);
  await h.click('ทั้งหมด'); assert.equal(h.find(node => node.props.id === 'line-1-inline').props.value, '0.5');
  await h.click('เลิกทำ'); assert.match(h.text(h.visible()), /ตรวจแล้ว 1\/3/); assert.equal(h.calls.length, 0); h.unmount();
});

test('redesign warning: inspect is read only; risky AI requires a separate explicit decision after reasons are visible', async () => {
  const dirty = [];
  const h = await editor(document({ warnings: [{ code: 'LOW_CONFIDENCE', line_no: 1 }] }), {}, { onDirtyChange: value => dirty.push(value) });
  await h.radio('lines'); await h.click('ตรวจ สินค้า 1');
  assert.match(h.text(h.visible()), /อ่านบิลได้ไม่ชัด/); assert.equal(dirty.at(-1), false);
  assert.equal(h.visible().some(node => node.type === 'input' && node.props.inputMode === 'decimal'), false);
  await h.click('ปิด'); await h.click('ตรวจ สินค้า 1'); assert.match(h.text(h.visible()), /เหตุที่ต้องตรวจ/);
  assert.equal(h.calls.length, 0); await h.click('ใช้ AI รายการนี้'); assert.match(h.text(h.visible()), /ตรวจแล้ว 1\/3/); h.unmount();
});

test('redesign batch: partial receipt preview explains ordered/previous/remaining and requires acknowledgement before replacing manual values', async () => {
  const doc = document({ lines: [row(1, { quantity_received: '0.1', match: { source: 'manual' } })], total: '10' });
  const h = await editor(doc, { expected: async () => [{ items: [{ ...items(doc.lines)[0], received_quantity: '0.7' }] }] });
  await h.radio('lines'); await h.click('ทั้งหมด'); await h.click('เลือกทั้งหมดที่แสดง'); await h.click('เท่าที่สั่ง');
  assert.match(h.text(h.visible()), /สั่ง 1 รับแล้ว 0.7 ค้าง 0.30/); assert.match(h.text(h.visible()), /แทนค่าที่คนแก้/);
  assert.equal(primary(h).props.disabled, true);
  const ack = h.find(node => node.type === 'input' && node.props.type === 'checkbox'); ack.props.onChange({ target: { checked: true } }); await h.settle();
  await h.click('ใช้ค่ากับ 1 รายการ'); assert.equal(h.find(node => node.props.id === 'line-0-inline').props.value, '0.30');
  await h.click('เลิกทำ'); assert.equal(h.find(node => node.props.id === 'line-0-inline').props.value, '0.1'); h.unmount();
});

test('redesign zero: explicit zero retains row, billed amount and order identity; undo restores proposal provenance', () => {
  const line = row(1); line._aiProposal = { ...line };
  let state = { ...newReviewState(), lines: [line] };
  state = transitionReview(state, { type: 'preview', action: 'zero', indices: [0] }, { expectedItems: items([line]) });
  assert.equal(state.lines[0].quantity_received, '1');
  state = transitionReview(state, { type: 'confirm' });
  assert.equal(state.lines.length, 1); assert.equal(state.lines[0].quantity_received, '0'); assert.equal(state.lines[0].amount, '10'); assert.equal(state.lines[0].order_item_id, 1);
  state = transitionReview(state, { type: 'undo' }); assert.equal(state.lines[0], line); assert.equal(reviewCounters(state.lines, items([line]), 'bill').reviewed, 0);
});

test('redesign full flow: select all, review, both saved signatures, confirmed receipt, next shop; API writes happen only on explicit actions', async () => {
  let next = false;
  const h = await editor(document(), {}, { onNextShop: () => { next = true; } });
  await h.radio('lines'); await h.click('เลือกทั้งหมดที่แสดง'); await h.click('ใช้ AI 3 รายการ'); assert.equal(h.calls.length, 0);
  await h.click('ใช้ค่ากับ 3 รายการ'); await h.click('ไปเซ็น'); await ink(h); await h.click('บันทึกเซ็น');
  await h.click('เซ็นผู้ส่ง'); await h.select('ชื่อ', 'สมชาย'); await ink(h); await h.click('บันทึกเซ็น'); await h.click('ปิด');
  assert.equal(h.visible().filter(node => node.props.className === 'rc-saved-signature').length, 2);
  await h.click('ตรวจรับ'); await h.click('ยืนยัน'); assert.ok(h.visible().some(node => node.props['data-illustration'] === 'received-success'));
  assert.match(h.text(h.visible()), /เลขที่รับ#21/); assert.equal(h.calls.filter(call => call[0] === 'confirm').length, 1);
  await h.click('รับร้านถัดไป'); assert.equal(next, true); h.unmount();
});

test('redesign ledger CSS contract: four columns share track widths, numeric/header no-wrap, measured large text reflows to two levels', async () => {
  const css = postcss.parse(await readFile(new URL('../src/pages/receiving/receiving.css', import.meta.url), 'utf8'));
  const rules = selector => { const values = {}; css.walkRules(selector, rule => rule.walkDecls(decl => { values[decl.prop] = decl.value; })); return values; };
  const columns = rules('.solao .rc-compact-head, .solao .rc-compact-row')['grid-template-columns'];
  assert.equal(columns, 'minmax(0,1fr) minmax(32px,.28fr) minmax(64px,.55fr) minmax(60px,.5fr)');
  assert.equal(rules('.solao .rc-compact-head > :not(:first-child)')['white-space'], 'nowrap');
  assert.equal(rules('.solao .rc-ordered, .solao .rc-line-amount')['white-space'], 'nowrap');
  assert.equal(rules(".solao .rc-document[data-large-text='true'] .rc-product-cell")['grid-column'], '1 / -1');
  const source = await readFile(new URL('../src/pages/receiving/use-review-layout.js', import.meta.url), 'utf8');
  assert.match(source, /getComputedStyle\(element\).fontSize/);
});


test('redesign capture: selected preview changes page, add page remains explicit, OCR starts only after every upload is acknowledged', async () => {
  let releaseSecond;
  const order = [], doc = document();
  let uuid = 0;
  const h = await editor(doc, {
    image: async () => new Blob(['synthetic-bill']),
    uploadImage: async (_id, page) => { order.push(`upload:${page}`); if (page === 2) await new Promise(resolve => { releaseSecond = resolve; }); return { image_id: page }; },
    ocr: async () => { order.push('ocr'); return { ...doc, images: [{ id: 1, page_no: 1 }, { id: 2, page_no: 2 }] }; },
  }, {}, { crypto: { randomUUID: () => `page-${++uuid}` } });
  const file = name => ({ size: 20, type: 'image/jpeg', name, slice: () => new Blob([new Uint8Array([255, 216, 255])]) });
  await h.find(node => node.type === 'input' && node.props.type === 'file').props.onChange({ target: { files: [file('one.jpg'), file('two.jpg')], value: '' } }); await h.settle();
  assert.match(h.text(h.visible()), /รอส่ง 2 หน้า/); await h.click('รูปใหม่ 2');
  assert.ok(h.find(node => node.type === 'img' && node.props.alt === 'บิลหน้าที่เลือก 2'));
  assert.ok(h.find(node => node.type === 'button' && h.text(node) === 'เพิ่มหน้า'));
  const uploading = primary(h).props.onClick(); await h.settle();
  assert.deepEqual(order, ['upload:1', 'upload:2']); assert.equal(primary(h).props.disabled, true);
  releaseSecond(); await uploading; await h.settle(); assert.deepEqual(order, ['upload:1', 'upload:2', 'ocr']);
  assert.match(h.text(h.visible()), /ตรวจแล้ว 0\/3/); h.unmount();
});

test('redesign capture: ambiguous OCR after upload requires checking latest result and never resends automatically', async () => {
  const h = await editor(document(), { uploadImage: async () => ({ image_id: 1 }), image: async () => new Blob(['bill']), ocr: async () => { h.calls.push(['ocr']); throw { request: {} }; } });
  await h.find(node => node.type === 'input' && node.props.type === 'file').props.onChange({ target: { files: [{ size: 20, type: 'image/jpeg', name: 'bill.jpg', slice: () => new Blob([new Uint8Array([255, 216, 255])]) }], value: '' } }); await h.settle();
  await h.click('ส่งอ่านบิล'); assert.equal(h.text(primary(h)), 'ตรวจผลล่าสุด');
  assert.equal(h.calls.filter(call => call[0] === 'ocr').length, 1); h.unmount();
});


test('redesign human edits: inspecting a proposal never lets AI overwrite an unsaved manual quantity', async () => {
  const h = await editor(); await h.radio('lines'); await h.click('แก้ สินค้า 1');
  await h.select('รับจริง', '0.25');
  assert.equal(h.find(node => node.type === 'button' && h.text(node) === 'ใช้ AI รายการนี้').props.disabled, true);
  await h.click('บันทึกรายการ'); await h.click('ทั้งหมด');
  assert.equal(h.find(node => node.props.id === 'line-0-inline').props.value, '0.25');
  assert.match(h.text(h.visible()), /ตรวจแล้ว 1\/3/); assert.equal(h.calls.length, 0); h.unmount();
});

test('redesign next shop: confirmed document opened from history returns to expected queue using document supplier identity', async () => {
  const groups = ['ร้านป้าดา', 'ร้านเจ๊นิด', 'ร้านลุงชัย'].map((supplier_name, i) => ({ supplier_key: `pg:${i + 1}`, supplier_name, items: items([row(i + 1)]) }));
  const doc = document({ product_group_id: 2, supplier_name_text: 'ร้านเจ๊นิด', status: 'confirmed' });
  const h = await harness('Receiving', {}, { expected: async () => groups, list: async () => [doc], get: async () => doc });
  await h.radio('documents'); await h.click('เปิดเอกสาร #21 ร้านเจ๊นิด ยืนยันแล้ว'); await h.radio('sign');
  await h.click('รับร้านถัดไป');
  assert.ok(h.find(node => node.type === 'input' && node.props.value === 'expected').props.checked);
  const current = h.find(node => node.props.className === 'rc-current-shop'); assert.match(h.text(current), /ร้านป้าดา/);
  h.unmount();
});
