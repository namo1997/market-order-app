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
    assert.equal(heads.length, 1);
    assert.equal(h.all().filter(node => node.props.className === 'rc-topbar').length, chrome === 'embedded' ? 0 : 1);
    const context = h.all().find(node => node.props.className === 'rc-morning');
    assert.match(h.text(context), /รอรับ 1 ร้าน/);
    assert.match(h.text(context), /25\d{2}/);
    assert.equal(h.text(context).includes('สาขาชื่อยาวมาก'), false);
    await h.click('ตัวเลือก'); assert.ok(h.text(h.visible()).includes('สาขาชื่อยาวมาก / ครัว')); await h.click('ปิด');
    const options = h.find(node => node.type === 'button' && node.props['aria-label'] === 'ตัวเลือก');
    assert.equal(h.text(options), 'ตัวเลือก');
    assert.ok(h.all(options).some(node => node.props.href?.endsWith('#options')));
    await h.click('เลือกร้าน ตลาด');
    assert.ok(h.text(h.visible()).includes('รอรับ 2 กก.'));
    h.unmount();
  }
});

test('device UX: selected supplier has context and a clear receiving action; free receipt remains reachable', async () => {
  const h = await harness('Receiving');
  await h.click('เลือกร้าน ตลาด');
  assert.ok(h.text(h.visible()).includes('ร้านที่กำลังรับ'));
  assert.equal(h.text(h.find(node => node.type === 'button' && node.props.className?.includes('sg-primary'))), 'รับของจากร้านอื่น'); assert.ok(h.find(n => n.props.className === 'rc-queue-scan' && n.props['aria-label'] === 'สแกนบิล ตลาด'));
  // The manual setup sheet (free receipt: item choice, shop name) moved to Options.
  await h.click('ตัวเลือก'); await h.click('ตั้งค่าใบรับเอง');
  assert.ok(h.find(node => node.type === 'input' && node.props.value === 'ตลาด'));
});









test('device UX: create form edits and create-in-flight propagate through Receiving to the shell', async () => {
  const changes = [], request = deferred();
  const h = await harness('Receiving', { onDirtyChange: value => changes.push(value), chrome: 'embedded' }, { create: () => request.promise });
  assert.equal(changes.at(-1), false);
  await h.click('ตัวเลือก'); await h.click('ตั้งค่าใบรับเอง'); await h.select('ผู้ส่งของ', 'ร้านใหม่'); assert.equal(changes.at(-1), true);
  const submitting = h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.equal(changes.at(-1), true);
  request.resolve(doc()); await submitting; await h.settle(); assert.equal(changes.at(-1), false);
  await h.click('นับ'); await h.select('นับได้ ผัก', '1'); assert.equal(changes.at(-1), true);
  await h.click('กลับคิว'); await h.click('ออกโดยไม่บันทึก'); assert.equal(changes.at(-1), false);
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
