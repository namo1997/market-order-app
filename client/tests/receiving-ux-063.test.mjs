import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';
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
  const canvas = h.find(node => node.type === 'canvas');
  canvas.props.onPointerDown({ pointerType: 'mouse', button: 0, pointerId: 1, clientX: 30, clientY: 30, preventDefault() {} });
  canvas.props.onPointerUp(); await h.settle();
};

test('UX063 #1: all completed groups show one empty state, documents CTA and no current/next shops; extra receipt is explicit', async () => {
  const h = await harness('Receiving', {}, { expected: async () => [group(1, true), group(2, true)], list: async () => [doc()] });
  assert.match(text(h), /รอรับ 0 ร้าน/); assert.match(text(h), /รับครบทุกร้านแล้ว/);
  assert.ok(!text(h).includes('ร้านที่กำลังรับ')); assert.ok(!text(h).includes('ร้านถัดไป'));
  assert.equal(h.text(primary(h)), 'ดูเอกสาร'); assert.equal(h.calls.length, 0);
  await h.click('ดูเอกสาร'); assert.ok(h.find(node => node.props.value === 'documents').props.checked);
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

test('UX063 #2: changed summary after signature acknowledges saved ink once and returns to signed page', async () => {
  const initial = doc({ warnings: [{ code: 'PRICE_CHANGE', line_no: 1 }] });
  let signed = false, signatures = 0;
  const h = await editor(initial, {
    signature: async () => { signed = true; signatures++; },
    get: async () => ({ ...initial, has_receiver_signature: signed, warnings: [] }),
  });
  await h.radio('sign'); await ink(h); await h.click('บันทึกเซ็น');
  assert.equal(h.text(h.find(node => node.type === 'h2')), 'ตรวจสรุป');
  assert.match(text(h), /บันทึกลายเซ็นแล้ว/); assert.equal(h.text(primary(h)), 'รับทราบ');
  assert.ok(!buttons(h).includes('ตรวจสรุปแล้ว ไปเซ็น'));
  await h.click('รับทราบ'); assert.equal(h.find(node => node.props['data-step']).props['data-step'], 'sign');
  assert.match(text(h), /เซ็นแล้ว/); assert.equal(signatures, 1);
  assert.equal(h.visible().filter(node => node.type === 'dialog').length, 0);
  await h.radio('lines'); await h.click('ไปเซ็น'); assert.ok(!text(h).includes('สรุปเปลี่ยน')); assert.equal(signatures, 1); h.unmount();
});

test('UX063 #2: before-sign changes keep explicit signature destination and never claim ink was saved', async () => {
  const initial = doc({ warnings: [{ code: 'PRICE_CHANGE', line_no: 1 }] });
  const h = await editor(initial, { update: async (_id, body) => ({ ...initial, ...body, warnings: [] }) });
  await h.radio('lines'); await h.click('ทั้งหมด'); await h.select('รับจริง ผัก 1', '1'); await h.click('บันทึกและตรวจถัดไป');
  await h.click('เพิ่มเติม'); await h.select('ทำรายการ', 'save'); await h.click('เลือก'); await h.click('ไปเซ็น');
  assert.equal(h.text(primary(h)), 'ตรวจสรุปแล้ว ไปเซ็น'); assert.ok(!text(h).includes('บันทึกลายเซ็นแล้ว'));
  await h.click('ตรวจสรุปแล้ว ไปเซ็น'); assert.equal(h.find(node => node.props['data-step']).props['data-step'], 'sign');
  assert.match(text(h), /รอเซ็น/); assert.equal(h.calls.filter(call => call[0] === 'signature').length, 0); h.unmount();
});

test('UX063 #3: pending-price badge and received status belong to receipt card; explicit zero stays priced', async () => {
  for (const missing of [true, false]) {
    const h = await editor(doc({ status: 'confirmed', lines: [line(1), line(2, { amount: missing ? null : '0', unit_price: null })], total: '10' }));
    await h.radio('sign');
    const receipt = h.find(node => node.type === 'article' && h.text(node).includes('ใบรับสินค้า'));
    assert.match(h.text(receipt), /รวมรายการ10.00 บาท/);
    assert.equal(h.all(receipt).filter(node => node.props.className === 'rc-price-notice').length, missing ? 1 : 0);
    assert.equal(h.text(receipt).includes('ยังไม่มีราคา 1 รายการรับของแล้ว รอราคา'), missing);
    assert.equal(h.text(receipt).includes('รับของแล้ว รอราคา'), missing); h.unmount();
  }
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

test('UX063 #4: short title and nonzero attention; full counts remain accessible in details; review shows one disclosure', async () => {
  const initial = doc({ lines: [line(1, { quantity_received: '2' }), line(2)], warnings: [] });
  const h = await editor(initial); await h.radio('lines');
  assert.equal(buttons(h).filter(label => label === 'ดูข้อเตือน').length, 1);
  assert.equal(h.visible().filter(node => node.type === 'p' && h.text(node).includes('ข้อเตือนสินค้า')).length, 0);
  const ariaLabel = h.find(node => node.props.className === 'rc-review-trigger').props['aria-label'];
  assert.equal(ariaLabel, 'ยังไม่ตรวจ 0 รายการ · ข้อเตือนสินค้า 1 รายการ · ข้อสังเกตบิล 0 ข้อ');
  await h.click('ดูข้อเตือน'); assert.equal(h.text(h.find(node => node.type === 'h2')), 'ตรวจสรุป');
  assert.ok(h.visible().some(node => node.type === 'p' && node.props.className === 'rc-muted' && h.text(node) === 'สินค้าเกิน 1 รายการ'));
  assert.ok(h.text(h.find(node => node.type === 'details')).includes(ariaLabel));
  assert.equal(h.visible().filter(node => node.props.className === 'rc-check-row').length, 1);
  assert.equal(reviewAttention(documentReviewSummary(doc(), [group(1).items[0], group(2).items[0]])), ''); h.unmount();
});

test('UX063 #5: undo stays inside sticky toolbar after feedback appears/dismisses, cancels edits and restores row', async () => {
  const h = await editor(doc({ lines: [line(1, { match: { source: 'order' } }), line(2, { match: { source: 'order' } })] }));
  await h.radio('lines'); await h.select('รับจริง ผัก 1', '1'); await h.click('บันทึกและตรวจถัดไป');
  const toolbar = () => h.find(node => node.props.className === 'rc-review-toolbar');
  assert.ok(h.all(toolbar()).some(node => node.props.className === 'rc-review-history'));
  assert.ok(h.all(toolbar()).some(node => node.props.className === 'rc-undo'));
  await h.click('ปิดข้อความ'); assert.ok(h.all(toolbar()).some(node => h.text(node) === 'เลิกทำรายการล่าสุด'));
  await h.select('รับจริง ผัก 2', '2');
  assert.equal(h.find(node => node.type === 'button' && h.text(node) === 'เลิกทำรายการล่าสุด').props.disabled, true);
  await h.click('ยกเลิกแก้'); await h.click('เลิกทำรายการล่าสุด');
  assert.ok(buttons(h).includes('ยังไม่ตรวจ 2')); assert.equal(h.calls.length, 0); h.unmount();
});
