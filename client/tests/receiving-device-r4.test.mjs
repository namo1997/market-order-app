import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, armPad } from './receiving-harness.mjs';

const user = { id: 1, name: 'ผู้รับทดสอบ', role: 'receiver' };
const line = (id, manual = false, quantity = '1') => ({ id, line_no: id, product_id: id, order_item_id: id,
  product_name: `สินค้า ${id}`, unit_text: 'กก.', quantity_received: quantity, quantity_billed: '1', unit_price: '10', amount: '10',
  match: { source: manual ? 'manual' : 'order', confidence: .9 } });
const document = (values = {}) => ({ id: 5, status: 'draft', kind: 'bill', delivery_date: '2026-10-16',
  receiver_name: user.name, total: '30', discount: '0', vat: '0', has_receiver_signature: false,
  images: [], lines: [line(1, true), line(2, true), line(3, true)], ocr: { status: 'done' }, warnings: [], ...values });
const editor = (doc = document(), api = {}, props = {}) => harness('DocumentEditor', {
  initialDocument: doc, user, onBack() {}, onChanged() {}, ...props,
}, { expected: async () => [{ items: Array.from({ length: 10 }, (_, i) => ({ order_item_id: i + 1, product_id: i + 1,
  quantity_ordered: '1', received_quantity: '0', unit_name: 'กก.' })) }], ...api }, {}, {}, {
  setTimeout: done => { done(); return 1; }, clearTimeout() {},
});
const primary = h => h.find(node => node.type === 'button' && node.props.className?.includes('sg-primary'));
const art = (h, state) => h.visible().some(node => node.props['data-illustration'] === state);
const preview = h => h.find(node => node.type === 'img' && node.props.className === 'rc-saved-signature');
const noCanvas = h => assert.equal(h.visible().some(node => node.type === 'canvas'), false);
const ink = async h => {
  await armPad(h);
  const pad = h.find(node => node.type === 'canvas');
  pad.props.onPointerDown({ button: 0, pointerType: 'mouse', pointerId: 1, clientX: 40, clientY: 40, preventDefault() {} });
  pad.props.onPointerUp(); await h.settle();
};
const open = async (h, action) => { await h.click('เพิ่มเติม'); await h.select('ทำรายการ', action); await h.click('เลือก'); };
const rowIndices = h => h.visible().filter(node => node.props.className === 'rc-compact-item').map(node => node.props['data-line-index']);
