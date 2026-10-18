import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';

const doc = () => ({ id: 5, status: 'draft', kind: 'bill', delivery_date: '2026-10-15', receiver_user_id: 1, receiver_name: 'ผู้รับ', has_receiver_signature: false,
  images: [], ocr: { status: 'none' }, warnings: [], total: '20', discount: '0', vat: '0', lines: [{ id: 3, product_id: 7, product_name: 'ผัก', order_item_id: 42, unit_text: 'กก.', quantity_received: '2', unit_price: '10' }] });
const user = { id: 1, role: 'admin' };

test('UI: overview and create use one primary/two secondary actions; retry keeps client UUID', async () => {
  let attempts = 0;
  const h = await harness('Receiving', {}, { create: async (body) => { h.calls.push(['create', JSON.parse(JSON.stringify(body))]); attempts++; throw { request: {} }; } });
  h.budget();
  await h.click('ตัวเลือก'); h.budget(); await h.click('ใช้ข้อมูล');
  await h.click('รับของ ตลาด'); h.budget();
  const form = h.find((node) => node.type === 'form');
  await form.props.onSubmit({ preventDefault() {} }); await h.settle(); h.budget();
  await form.props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.equal(attempts, 2); assert.deepEqual(h.calls[0][1], h.calls[1][1]); assert.equal(h.calls[0][1].client_uuid, 'stable-client-uuid');
});




















test('UI r3: overview options apply only on save; close discards date', async () => {
  const h = await harness('Receiving');
  await h.click('ตัวเลือก');
  const original = h.find(node => node.type === 'input' && node.props.type === 'date').props.value;
  await h.select('วันที่', '2026-01-01'); await h.click('ปิด'); await h.click('ตัวเลือก');
  assert.equal(h.find(node => node.type === 'input' && node.props.type === 'date').props.value, original);
  await h.select('วันที่', '2026-01-01'); await h.click('ใช้ข้อมูล'); await h.click('ตัวเลือก');
  assert.equal(h.find(node => node.type === 'input' && node.props.type === 'date').props.value, '2026-01-01');
});


test('UI r3: motion switch defaults to OS, tracks OS changes, then preserves explicit user override', async () => {
  const media = { matches: true, addEventListener(_, callback) { this.update = callback; }, removeEventListener() {} };
  const h = await harness('Receiving', {}, {}, {}, { matchMedia: () => media });
  const root = () => h.all().find(node => node.props.className?.includes('rc-app'));
  await h.click('ตัวเลือก');
  const toggle = () => h.find(node => node.type === 'input' && node.props.role === 'switch');
  assert.equal(root().props['data-motion'], 'reduce');
  media.matches = false; media.update(); await h.settle(); assert.equal(root().props['data-motion'], 'full');
  toggle().props.onChange({ target: { checked: true } }); await h.settle();
  assert.equal(root().props['data-motion'], 'reduce');
  media.matches = false; media.update(); await h.settle(); assert.equal(root().props['data-motion'], 'reduce');
});
