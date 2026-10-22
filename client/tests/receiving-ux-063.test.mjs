import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, armPad } from './receiving-harness.mjs';
import { fitReceipt } from '../src/pages/receiving/use-review-layout.js';
import { documentReviewSummary, reviewAttention } from '../src/pages/receiving/receiving-review.js';

const line = (id, values = {}) => ({ id, line_no: id, product_id: id, order_item_id: id,
  product_name: `ผัก ${id}`, unit_text: 'กก.', quantity_received: '1', quantity_billed: '1',
  amount: '10', unit_price: '10', match: { source: 'manual' }, ...values });
const doc = (values = {}) => ({ id: 5, status: 'draft', kind: 'bill', delivery_date: '2026-10-16',
  supplier_name_text: 'ร้านหนึ่ง', has_receiver_signature: false, total: '20', discount: '0', vat: '0',
  images: [], lines: [line(1), line(2)], ocr: { status: 'done' }, warnings: [], ...values });
const group = (id, received = false) => ({ supplier_key: `pg:${id}`, supplier_name: `ร้าน ${id}`,
  items: [{ order_item_id: id, product_id: id, product_name: `ผัก ${id}`, quantity_ordered: '1',
    received_quantity: received ? '1' : '0', is_received: received, unit_name: 'กก.' }] });
const text = h => h.text(h.visible());
const buttons = h => h.visible().filter(node => node.type === 'button').map(node => h.text(node));
const primary = h => h.find(node => node.type === 'button' && node.props.className?.includes('sg-primary'));
const editor = (initial = doc(), api = {}) => harness('DocumentEditor', { initialDocument: initial,
  user: { id: 1, name: 'ผู้รับ', role: 'receiver' }, onBack() {}, onChanged() {} }, {
  expected: async () => [{ items: [group(1).items[0], group(2).items[0]] }], ...api,
}, {}, {}, { setTimeout: done => { done(); return 1; }, clearTimeout() {} });
const ink = async h => {
  await armPad(h);
  const canvas = h.find(node => node.type === 'canvas');
  canvas.props.onPointerDown({ pointerType: 'mouse', button: 0, pointerId: 1, clientX: 30, clientY: 30, preventDefault() {} });
  canvas.props.onPointerUp(); await h.settle();
};

test('UX063 #1: all completed groups show one empty state, documents CTA and no current/next shops; extra receipt is explicit', async () => {
  const h = await harness('Receiving', {}, { expected: async () => [group(1, true), group(2, true)], list: async () => [doc()] });
  assert.match(text(h), /รอรับ 0 ร้าน/); assert.match(text(h), /รับครบทุกร้านแล้ว/);
  assert.ok(!text(h).includes('ร้านที่กำลังรับ')); assert.ok(!text(h).includes('ร้านถัดไป'));
  // Owner 2026-10-22 (ก.): with no shop chosen the big button receives from any shop; documents are a tab.
  assert.equal(h.text(primary(h)), 'รับของ / สแกนบิล'); assert.equal(h.calls.length, 0);
  await h.radio('documents'); assert.ok(h.find(node => node.props.value === 'documents').props.checked);
  assert.ok(h.find(node => node.type === 'button' && node.props['aria-label'] === 'เปิดเอกสาร #5 ร้านหนึ่ง ร่าง')); assert.equal(h.calls.length, 0);
  await h.click('ตัวเลือก'); await h.click('รับสินค้าเพิ่ม (ไม่อ้างอิงใบสั่ง)');
  assert.ok(h.find(node => node.type === 'form'));
  assert.equal(h.find(node => node.type === 'input' && node.props.maxLength === 255).props.value, '');
  assert.equal(h.calls.length, 0); h.unmount();
});

test('UX063 #1: mixed queue/count/selection share pending groups; stale completed selection disappears after refresh', async () => {
  let groups = [group(1, true), group(2), group(3)];
  const h = await harness('Receiving', {}, { expected: async () => groups });
  assert.match(text(h), /รอรับ 2 ร้าน/); assert.ok(!buttons(h).includes('เลือกร้าน ร้าน 1'));
  assert.equal(h.visible().filter(node => node.props.className === 'rc-current-shop').length, 0);
  await h.click('เลือกร้าน ร้าน 2');
  assert.match(h.text(h.find(node => node.props.className === 'rc-current-shop')), /ร้าน 2/);
  await h.click('เลือกร้าน ร้าน 3'); assert.match(h.text(h.find(node => node.props.className === 'rc-current-shop')), /ร้าน 3/);
  groups = [group(1, true), group(2), group(3, true)]; await h.click('โหลดใหม่');
  assert.match(text(h), /รอรับ 1 ร้าน/); assert.match(h.text(h.find(node => node.props.className === 'rc-current-shop')), /ร้าน 2/);
  assert.ok(!text(h).includes('ร้านถัดไป')); assert.equal(h.calls.length, 0); h.unmount();
});

test('UX063 #1: completed supplier can be chosen explicitly for additional receiving; no completed rows are preselected', async () => {
  const h = await harness('Receiving', {}, { expected: async () => [group(1, true)] });
  await h.click('ตัวเลือก'); await h.select('รับเพิ่มจากร้าน', 'pg:1');
  assert.equal(h.calls.length, 0); await h.click('รับสินค้าเพิ่มจากร้านนี้');
  assert.equal(h.find(node => node.type === 'input' && node.props.maxLength === 255).props.value, 'ร้าน 1');
  const checks = h.visible().filter(node => node.type === 'input' && node.props.type === 'checkbox');
  assert.equal(checks.length, 1); assert.equal(checks[0].props.checked, false);
  assert.equal(h.calls.length, 0); h.unmount();
});

test('UX063 #1: changing options date drops old supplier choices from the additional receipt scope', async () => {
  const h = await harness('Receiving', {}, { expected: async () => [group(1, true)] });
  await h.click('ตัวเลือก'); await h.select('รับเพิ่มจากร้าน', 'pg:1');
  const currentDate = h.find(node => node.type === 'input' && node.props.type === 'date').props.value;
  await h.select('วันที่', currentDate === '2026-10-17' ? '2026-10-18' : '2026-10-17');
  assert.ok(!h.visible().some(node => node.type === 'option' && node.props.value === 'pg:1'));
  await h.click('รับสินค้าเพิ่ม (ไม่อ้างอิงใบสั่ง)');
  assert.equal(h.find(node => node.type === 'input' && node.props.maxLength === 255).props.value, '');
  assert.equal(h.calls.length, 0); h.unmount();
});

test('UX063 #1: ShopWorkspace independently excludes completed next shops', async () => {
  const h = await harness('ShopWorkspace', { groups: [group(1), group(2, true), group(3)], current: group(1), waiting: 2, onChoose() {} });
  assert.ok(buttons(h).includes('ร้าน 31 รายการควรถึงวันนี้')); assert.ok(!text(h).includes('ร้าน 2')); h.unmount();
});







test('UX063 #3: receipt fitting uses actual bar edge and viewport at narrow/wrapped layouts', () => {
  for (const height of [640, 720, 820]) for (const barHeight of [80, 128]) {
    let scroll = 0;
    const root = { classList: { contains: () => true }, querySelector: selector => ({ getBoundingClientRect: () =>
      selector.includes('sg-bar') ? { top: height - barHeight } : { bottom: 710 - scroll } }) };
    const view = { innerHeight: height, scrollBy: ({ top }) => { scroll += top; } };
    fitReceipt(root, view); assert.ok(710 - scroll <= height - barHeight - 8);
    const before = scroll; fitReceipt(root, view); assert.equal(scroll, before, 'second measure is stable');
  }
});
