import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';

// Device test 2026-10-24 (SM-A075F, staging): the docs-first home ("รับของใหม่") created a
// no-bill receipt for a shop that had an order today without its order lines, so the
// off-order reason and "ต่างจากที่สั่ง" wording never appeared; and an ordered receipt's
// add sheet showed "กำลังโหลดสินค้าของร้านนี้…" forever because the history fetch was disabled.
const user = { id: 23, name: 'แผนกครัว', role: 'user', branch_id: 4, department_id: 20 };
const asiamart = { supplier_key: 'sm:3', name: 'Asiamart', code: 'SUP-ASIA', supplier_master_id: 3, product_group_id: null };
const tonphayom = { supplier_key: 'sm:7', name: 'ต้นพยอมพาณิช', code: 'SUP-TP', supplier_master_id: 7, product_group_id: null };
const group = { supplier_key: 'sm:3', supplier_name: 'Asiamart', items: [
  { order_item_id: 59794, product_id: 357, product_name: 'ถุงหิ้ว 12*20', unit_name: 'แพ็ค', quantity_ordered: '2', received_quantity: '0' },
  { order_item_id: 59795, product_id: 358, product_name: 'ถุงหิ้ว 6*14', unit_name: 'แพ็ค', quantity_ordered: '1', received_quantity: '0' },
] };
const text = h => h.text(h.visible());
const waitSearch = async h => { await new Promise(resolve => setTimeout(resolve, 280)); await h.settle(); };
const submit = async h => { await h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await h.settle(); };
const created = h => h.calls.find(call => call[0] === 'create')?.[1];
const mountSheet = () => harness('CreateDocument', { user, date: '2026-10-24', groups: [group], scanFirst: true, onClose() {}, onCreated() {} },
  { suppliers: async () => [asiamart, tonphayom] });

test('walk-in sheet receives against the chosen shop\'s order of the day', async () => {
  const h = await mountSheet();
  await h.select('ผู้ส่งของ', 'asia'); await waitSearch(h);
  await h.click('Asiamart');
  assert.match(text(h), /มีใบสั่ง · 2 รายการ/);
  assert.match(text(h), /ถุงหิ้ว 12\*20/); assert.match(text(h), /ถุงหิ้ว 6\*14/);
  await submit(h);
  assert.deepEqual(created(h).order_item_ids, [59794, 59795]);
  assert.equal(created(h).supplier_master_id, 3); assert.equal(created(h).supplier_name_text, 'Asiamart');
});

test('an unticked ordered item is left out of the receipt', async () => {
  const h = await mountSheet();
  await h.select('ผู้ส่งของ', 'asia'); await waitSearch(h);
  await h.click('Asiamart');
  const box = h.visible().find(n => n.type === 'input' && n.props.type === 'checkbox');
  await box.props.onChange({ target: { checked: false } }); await h.settle();
  await submit(h);
  assert.deepEqual(created(h).order_item_ids, [59795]);
});

test('a shop without an order today stays a plain walk-in receipt; changing the shop drops the order lines', async () => {
  const h = await mountSheet();
  await h.select('ผู้ส่งของ', 'asia'); await waitSearch(h);
  await h.click('Asiamart'); assert.match(text(h), /มีใบสั่ง/);
  await h.click('เปลี่ยนร้าน'); await waitSearch(h);
  await h.click('ต้นพยอมพาณิช');
  assert.doesNotMatch(text(h), /มีใบสั่ง|ถุงหิ้ว/);
  await submit(h);
  assert.equal(created(h).order_item_ids.length, 0); assert.equal(created(h).supplier_master_id, 7);
});

const orderedDoc = { id: 308, client_uuid: 'walkin-link', supplier_master_id: 3, supplier_name_text: 'Asiamart', branch_id: 4, department_id: 20,
  delivery_date: '2026-10-24', status: 'draft', kind: 'manual_receipt', scope: 'department', counted_complete_at: null, blind: true,
  lines: [{ id: 1, line_no: 1, product_id: 357, product_name: 'ถุงหิ้ว 12*20', order_item_id: 59794, quantity_ordered: '2', quantity_received: null, unit_text: 'แพ็ค', unit_id: 4 }],
  images: [], warnings: [], ocr: { status: 'locked' } };

test('ordered receipt: the add sheet lists the shop\'s goods instead of an endless loading line', async () => {
  const keys = [];
  const h = await harness('DocumentEditor', { initialDocument: orderedDoc, user, onBack() {} },
    { supplierProducts: async key => { keys.push(key); return [{ id: 352, name: 'ถุงร้อน 6*10', unit_id: 4, unit_name: 'แพ็ค' }, { id: 357, name: 'ถุงหิ้ว 12*20', unit_id: 4, unit_name: 'แพ็ค' }]; } });
  await h.click('เพิ่มสินค้าที่มาส่ง'); await h.settle();
  assert.deepEqual(keys, ['sm:3']);
  assert.doesNotMatch(text(h), /กำลังโหลดสินค้าของร้านนี้/);
  assert.match(text(h), /ถุงร้อน 6\*10/); assert.match(text(h), /มีในใบ/);
});

