import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';
import { expectedQuantityStatus, quantityStatus } from '../src/pages/receiving/receiving-status.js';

const item = { order_item_id: 42, product_id: 7, product_name: 'ผัก', quantity_ordered: '20', received_quantity: '0', unit_name: 'กิโลกรัม' };
const doc = () => ({ id: 5, status: 'draft', kind: 'bill', delivery_date: '2026-10-15', images: [], ocr: { status: 'none' }, warnings: [], total: '20', discount: '0', vat: '0',
  lines: [{ id: 3, product_id: 7, product_name: 'ผัก', order_item_id: 42, unit_text: 'กก.', quantity_received: '2', unit_price: '10' }] });
const user = { id: 1, role: 'admin' };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const editor = (onDirtyChange, overrides = {}) => harness('DocumentEditor', { initialDocument: doc(), user, onBack() {}, onChanged() {}, onDirtyChange }, overrides);

test('device UX: waiting is neutral; actual receipts alone show exact short/over quantities', () => {
  assert.deepEqual(expectedQuantityStatus(item), { status: 'waiting', label: 'รอรับ 20 กก.', summary: 'รับแล้ว 0 / สั่ง 20 กก.' });
  for (const [received, label, status] of [['18', 'ขาด 2 กก.', 'review'], ['21', 'เกิน 1 กก.', 'review'], ['20', 'ครบแล้ว', 'ok']]) {
    assert.equal(expectedQuantityStatus({ ...item, received_quantity: received }).label, label);
    assert.equal(expectedQuantityStatus({ ...item, received_quantity: received }).status, status);
  }
  assert.equal(expectedQuantityStatus({ ...item, is_received: true }).label, 'ขาด 20 กก.');
  assert.equal(expectedQuantityStatus({ ...item, quantity_ordered: '0.30', received_quantity: '0.10' }).label, 'ขาด 0.2 กก.');
  assert.equal(expectedQuantityStatus({ ...item, received_quantity: '-1' }).status, 'error');
  assert.equal(quantityStatus({ ...item, unit_text: item.unit_name, quantity_received: '18' }, [item]).label, 'ขาด 2 กิโลกรัม');
});

test('device UX: embedded omits page chrome; standalone has one app heading and scope', async () => {
  for (const chrome of ['embedded', 'standalone']) {
    const h = await harness('Receiving', { chrome }, {}, { user: { ...user, branch: 'สาขาชื่อยาวมาก', department: 'ครัว' } });
    const heads = h.all().filter(node => node.type === 'h1');
    assert.equal(heads.length, chrome === 'embedded' ? 0 : 1);
    assert.equal(h.all().filter(node => node.props.className === 'rc-topbar').length, chrome === 'embedded' ? 0 : 1);
    const context = h.all().find(node => node.props.className === 'rc-list-context');
    assert.match(h.text(context), /รอรับ 1 รายการ/);
    assert.match(h.text(context), /25\d{2}/);
    const options = h.find(node => node.type === 'button' && node.props['aria-label'] === 'ตัวเลือก');
    assert.equal(h.text(options), 'ตัวเลือก');
    assert.ok(h.all(options).some(node => node.props.href?.endsWith('#options')));
    assert.ok(!h.all().some(node => node.props['data-status'] === 'review'));
    h.unmount();
  }
});

test('device UX: selected supplier has context and a clear receiving action; free receipt remains reachable', async () => {
  const h = await harness('Receiving');
  assert.ok(h.find(node => node.type === 'button' && h.text(node) === 'สร้างใบรับอิสระ'));
  h.find(node => node.type === 'input' && node.props.name === 'supplier').props.onChange(); await h.settle();
  assert.ok(h.all().some(node => node.type === 'p' && h.text(node).includes('เลือกร้านแล้ว')));
  await h.click('รับจากร้านนี้');
  assert.ok(h.find(node => node.type === 'input' && node.props.value === 'ตลาด'));
});

test('device UX: edits report dirty, save stays protected in flight, success clears both guards', async () => {
  const changes = [], request = deferred();
  const h = await editor(value => changes.push(value), { update: () => request.promise });
  assert.equal(changes.at(-1), false);
  await h.radio('lines'); await h.click('ทั้งหมด'); await h.select('รับจริง', '1.5'); await h.click('บันทึกรายการ');
  assert.equal(changes.at(-1), true);
  const event = { type: 'beforeunload', preventDefault() { this.prevented = true; } }; h.dispatch(event);
  assert.equal(event.prevented, true);
  await h.click('รายละเอียด'); await h.select('ทำรายการ', 'save');
  const saving = h.find(node => node.type === 'button' && h.text(node) === 'เลือก').props.onClick(); await h.settle();
  assert.equal(changes.at(-1), true);
  assert.ok(h.events.get('beforeunload').size > 0);
  request.resolve(doc()); await saving; await h.settle();
  assert.equal(changes.at(-1), false); assert.equal(h.events.get('beforeunload').size, 0);
});

test('device UX: failed save preserves dirty and unmount resets shell callback and unload listener', async () => {
  const changes = [];
  const h = await editor(value => changes.push(value), { update: async () => { throw { response: { status: 422 } }; } });
  await h.radio('lines'); await h.click('ทั้งหมด'); await h.select('รับจริง', '1'); await h.click('บันทึกรายการ');
  await h.click('รายละเอียด'); await h.select('ทำรายการ', 'save'); await h.click('เลือก');
  assert.equal(changes.at(-1), true); h.unmount();
  assert.equal(changes.at(-1), false); assert.equal(h.events.get('beforeunload').size, 0);
});

test('device UX: sheet edits and unsaved signatures are reported; closing/clearing resets them', async () => {
  const changes = [];
  const h = await editor(value => changes.push(value));
  await h.click('รายละเอียด'); await h.select('ทำรายการ', 'header'); await h.click('เลือก');
  await h.select('เลขบิล', 'NEW'); assert.equal(changes.at(-1), true);
  await h.click('ปิด'); assert.equal(changes.at(-1), false);
  await h.radio('sign');
  const canvas = h.find(node => node.type === 'canvas');
  canvas.props.onPointerDown({ button: 0, pointerType: 'mouse', pointerId: 1, clientX: 20, clientY: 20, preventDefault() {} });
  canvas.props.onPointerUp(); await h.settle(); assert.equal(changes.at(-1), true);
  await h.click('ล้างเส้น'); assert.equal(changes.at(-1), false);
  await h.click('รายละเอียด'); await h.select('ทำรายการ', 'courier'); await h.click('เลือก');
  await h.select('ชื่อ', 'ใหม่'); assert.equal(changes.at(-1), true);
  await h.click('ปิด'); assert.equal(changes.at(-1), false);
});

test('device UX: image processing and failed pending upload stay protected until retry succeeds', async () => {
  const changes = [], resizing = deferred(); let attempts = 0;
  const h = await harness('DocumentEditor', { initialDocument: doc(), user, onBack() {}, onChanged() {}, onDirtyChange: value => changes.push(value) }, {
    uploadImage: async () => { if (++attempts === 1) throw { request: {} }; return { image_id: 9 }; }, image: async () => new Blob(['mock']),
  }, {}, {}, { createImageBitmap: () => resizing.promise });
  const input = h.find(node => node.type === 'input' && node.props.type === 'file');
  const processing = input.props.onChange({ target: { files: [{ size: 20, type: 'image/jpeg', name: 'bill.jpg', slice: () => new Blob([new Uint8Array([255, 216, 255])]) }], value: 'bill.jpg' } });
  await h.settle(); assert.equal(changes.at(-1), true);
  resizing.resolve({ width: 100, height: 100, close() {} }); await processing; await h.settle();
  assert.equal(changes.at(-1), true); await h.click('ส่งรูป'); assert.equal(changes.at(-1), true);
  await h.click('ส่งรูป'); assert.equal(changes.at(-1), false);
});

test('device UX: create form edits and create-in-flight propagate through Receiving to the shell', async () => {
  const changes = [], request = deferred();
  const h = await harness('Receiving', { onDirtyChange: value => changes.push(value), chrome: 'embedded' }, { create: () => request.promise });
  assert.equal(changes.at(-1), false);
  await h.click('สร้างใบรับอิสระ'); await h.select('ผู้ส่งของ', 'ร้านใหม่'); assert.equal(changes.at(-1), true);
  const submitting = h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.equal(changes.at(-1), true);
  request.resolve(doc()); await submitting; await h.settle(); assert.equal(changes.at(-1), false);
  await h.radio('lines'); await h.click('ทั้งหมด'); await h.select('รับจริง', '1'); await h.click('บันทึกรายการ'); assert.equal(changes.at(-1), true);
  await h.click('กลับรายการ'); await h.click('ทิ้งและกลับ'); assert.equal(changes.at(-1), false);
});

test('device UX: root theme is shared, no nested override, external preferences update page options', async () => {
  const h = await harness('Receiving');
  await h.click('ตัวเลือก'); await h.radio('dark');
  assert.equal(h.document.documentElement.dataset.theme, 'dark');
  assert.ok(!h.all().find(node => node.props.className?.includes('rc-app')).props['data-theme']);
  h.dispatch({ type: 'solao:theme-change', detail: 'light' }); await h.settle();
  assert.equal(h.document.documentElement.dataset.theme, 'light');
  assert.equal(h.find(node => node.type === 'input' && node.props.value === 'light').props.checked, true);
  h.storage.set('solao.receiving.theme.v1', 'auto'); h.dispatch({ type: 'storage' }); await h.settle();
  assert.equal(h.document.documentElement.dataset.theme, 'auto');
});


test('device UX: an existing root preference wins over storage when mounting standalone or embedded', async () => {
  for (const chrome of ['embedded', 'standalone']) {
    const h = await harness('Receiving', { chrome }, {}, {}, { localStorage: { getItem: () => 'dark' } }, {}, 'light');
    assert.equal(h.document.documentElement.dataset.theme, 'light');
    await h.click('ตัวเลือก'); assert.equal(h.find(node => node.type === 'input' && node.props.value === 'light').props.checked, true);
  }
});
