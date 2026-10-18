import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { harness } from './receiving-harness.mjs';
import { ocrReadSummary, matchLabel } from '../src/pages/receiving/review-card.js';
import { documentBody } from '../src/pages/receiving/receiving-utils.js';

const line = { id: 1, line_no: 1, bill_text: 'ทB', product_id: 8, product_name: 'ขา B', order_item_id: 51,
  unit_text: 'กก.', unit_id: 2, quantity_billed: '10', quantity_received: '10', unit_price: '60', amount: '600',
  bill_read: { quantity_billed: 10, unit_price: 60, amount: 600 }, match: { source: 'alias', confidence: .99 } };
const expected = [ { order_item_id: 50, product_id: 7, product_name: 'อกไก่', quantity_ordered: '10', unit_name: 'กก.', unit_id: 2 },
  { order_item_id: 51, product_id: 8, product_name: 'ขา B', quantity_ordered: '10', unit_name: 'กก.', unit_id: 2 } ];
const doc = values => ({ id: 5, kind: 'bill', status: 'draft', delivery_date: '2026-10-17', supplier_name_text: 'เจ๊แวว',
  lines: [line], images: [], warnings: [], total: '600', ocr: { status: 'done', raw_read: { doc_date: '2026-10-17', total: 600, line_count: 1 } }, ...values });
const editor = (values = {}, api = {}, runtime = {}) => harness('DocumentEditor', { initialDocument: doc(values), user: { id: 1, role: 'receiver' }, onBack() {}, onChanged() {} },
  { expected: async () => [{ items: expected }], ...api }, {}, {}, runtime);
const text = h => h.text(h.visible());

 test('review v2: cards separate raw bill, product provenance, billed numbers and ordered/received values', async () => {
  const h = await editor(); await h.radio('lines');
  await h.click('เพิ่มเติม'); await h.select('ทำรายการ', 'ocr-result'); await h.click('เลือก');
  assert.match(text(h), /AI อ่าน: .*2569.*ยอด 600\.00 บาท.*1 บรรทัด.*ต้องยืนยัน 1 บรรทัด/);
  await h.click('ปิด');
  const card = h.find(node => node.props['data-line-index'] === 0);
  assert.match(h.text(card), /ในบิลเขียนทB/); assert.match(h.text(card), /สินค้าขา B/);
  assert.match(h.text(card), /จำชื่อย่อร้านนี้/); assert.match(h.text(card), /ตัวเลขในบิล10 × 60 = 600 บาท/);
  assert.match(h.text(card), /สั่ง 10 กก\./); assert.equal(h.find(node => node.props.id === 'line-0-inline').props.value, '10');
  assert.equal(h.find(node => node.props.id === 'line-0-inline').props.inputMode, 'decimal');
  assert.equal(h.calls.length, 0); h.budget(); h.unmount();
});

test('review v2: AI suggestion never silently advances; explicit accept clears pending and undo restores it', async () => {
  const h = await editor({ lines: [{ ...line, product_id: 7, product_name: 'อกไก่', order_item_id: 50,
    match: { source: 'ai', confidence: .4 }, suggestion_reason: 'คล้ายรายการที่สั่ง' }] });
  await h.radio('lines'); assert.match(text(h), /AI เดา — ยืนยัน/); assert.match(text(h), /คล้ายรายการที่สั่ง/);
  await h.click('ตรวจรายการถัดไป'); assert.match(text(h), /ยังไม่ตรวจ 1/);
  await h.click('ใช้ค่า'); assert.match(text(h), /ตรวจครบ 1 รายการ/);
  await h.click('เลิกทำรายการล่าสุด'); assert.match(text(h), /AI เดา — ยืนยัน/); assert.match(text(h), /ยังไม่ตรวจ 1/);
  assert.equal(h.calls.length, 0); h.unmount();
});

test('review v2: one-tap picker orders first, asks remember by default, cancel changes nothing; undo restores whole row', async () => {
  const h = await editor(); await h.radio('lines'); await h.click('เปลี่ยนสินค้า ขา B');
  assert.match(text(h), /รายการที่สั่ง/); await h.click('อกไก่');
  const remember = h.find(node => node.type === 'input' && node.props.type === 'checkbox'); assert.equal(remember.props.checked, true);
  assert.match(text(h), /จำ ‘ทB’ = อกไก่ สำหรับร้านนี้/);
  await h.click('ปิด'); assert.match(text(h), /จำชื่อย่อร้านนี้/);
  await h.click('เปลี่ยนสินค้า ขา B'); await h.click('อกไก่');
  h.find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: false } }); await h.settle();
  await h.click('ใช้สินค้านี้'); assert.match(text(h), /เลือกแล้ว — ตรวจตัวเลข/); assert.match(text(h), /ยังไม่ตรวจ 1/);
  await h.click('ใช้ค่า'); await h.click('เพิ่มเติม'); await h.select('ทำรายการ', 'save');
  await h.click('เลือก');
  const saved = h.calls.find(call => call[0] === 'update');
  assert.ok(saved); assert.equal(saved[2].lines[0].remember_alias, false);
  assert.equal(saved[2].lines[0].bill_text, 'ทB'); assert.equal(saved[2].lines[0].order_item_id, 50);
  assert.equal(saved[2].lines[0].match.source, 'manual'); h.unmount();
});

test('review v2: search whole catalog clears unrelated order link and keeps raw text and decimals', async () => {
  let searched;
  const h = await editor({}, { getProducts: async params => { searched = params.search; return { data: [{ id: 99, name: 'สินค้านอกใบสั่ง', unit_name: 'ถุง', unit_id: 3 }] }; } },
    { setTimeout: fn => { fn(); return 1; }, clearTimeout() {} });
  await h.radio('lines'); await h.click('เปลี่ยนสินค้า ขา B'); await h.select('ค้นหาสินค้า', 'นอกใบสั่ง');
  assert.equal(searched, 'นอกใบสั่ง'); await h.click('สินค้านอกใบสั่งถุง'); await h.click('ใช้สินค้านี้');
  await h.click('แก้ สินค้านอกใบสั่ง'); await h.select('รับจริง', '1.25'); await h.click('บันทึกและถัดไป');
  await h.click('ทั้งหมด'); assert.equal(h.find(node => node.props.id === 'line-0-inline').props.value, '1.25');
  assert.match(text(h), /ในบิลเขียนทB/); assert.match(text(h), /ไม่มีใบสั่ง/);
  await h.click('เลิกทำรายการล่าสุด'); await h.click('เลิกทำรายการล่าสุด');
  assert.match(text(h), /จำชื่อย่อร้านนี้/); assert.equal(h.calls.length, 0); h.unmount();
});

test('review v2: raw missing values remain unknown while derived amount is explicitly labelled', async () => {
  const h = await editor({ lines: [{ ...line, amount: null, bill_read: { quantity_billed: 10, unit_price: 60, amount: null } }] });
  await h.radio('lines'); assert.match(text(h), /ตัวเลขในบิล10 × 60 = — บาท/);
  assert.match(text(h), /คำนวณจากจำนวนในบิล600\.00 บาท/); h.unmount();
  const summary = ocrReadSummary({ ...doc(), total: '900', lines: [], ocr: { raw_read: { doc_date: null, total: null, line_count: 0 } } });
  assert.match(summary, /ไม่พบวันที่.*ไม่พบยอดรวม.*0 บรรทัด/); assert.ok(!summary.includes('900'));
  assert.match(ocrReadSummary({ ocr: {}, lines: [] }), /ตรวจรายการกับบิลอีกครั้ง/);
});

test('review v2: full-screen authenticated bill view zooms without navigation and closes to review', async () => {
  let imageCalls = 0;
  const h = await editor({ images: [{ id: 2, page_no: 1 }] }, { image: async (id, imageId) => { assert.equal(id, 5); assert.equal(imageId, 2); imageCalls++; return new Blob(['synthetic-bill']); } });
  await h.radio('lines'); await h.click('ดูรูปบิล รายการ 1'); await h.click('เปิดรูปหน้า 1');
  assert.ok(h.find(node => node.type === 'dialog').props.className.includes('rc-image-fullscreen'));
  assert.match(text(h), /100%/); await h.click('ขยาย'); assert.match(text(h), /150%/);
  assert.equal(h.find(node => node.type === 'img' && node.props.alt === 'บิลหน้า 1 ขยาย').props.style.width, '150%');
  await h.click('ย่อ'); assert.match(text(h), /100%/); await h.click('ปิด'); await h.click('ปิด');
  assert.match(text(h), /ในบิลเขียนทB/); assert.ok(imageCalls > 0); assert.equal(h.calls.length, 0); h.unmount();
});

test('review v2: all source labels are Thai and remembering only adds an optional API field', () => {
  for (const [source, label] of [['alias', 'จำชื่อย่อร้านนี้'], ['order', 'ตรงกับที่สั่ง'], ['ai', 'AI เดา — ยืนยัน'], ['manual', 'เลือกเอง'], ['none', 'เลือกแล้ว — ตรวจตัวเลข']]) assert.equal(matchLabel({ ...line, match: { source } }), label);
  assert.equal(matchLabel({ product_id: null, match: { source: 'none' } }), 'ยังไม่จับคู่');
  const body = documentBody(doc({ lines: [{ ...line, remember_alias: false }] }));
  assert.equal(body.lines[0].remember_alias, false); assert.ok(!JSON.stringify(body).includes('bill_read'));
  assert.equal(body.lines[0].amount, '600.00');
});

test('review v2: cards use opaque design tokens, wrapping grid and fullscreen safe areas', async () => {
  const css = await readFile(new URL('../src/pages/receiving/receiving.css', import.meta.url), 'utf8');
  assert.match(css, /rc-review-cards \.rc-compact-item \{[^}]*background: var\(--sg-surface\)/);
  assert.match(css, /rc-receipt-numbers \{[^}]*minmax\(0,1fr\)/);
  assert.match(css, /rc-image-fullscreen[^}]*--sg-safe-top/);
  assert.match(css, /rc-image-fullscreen[^}]*--sg-safe-bottom/);
  assert.match(css, /rc-image-pan \{ overflow: auto/);
  assert.match(css, /rc-image-pan img \{[^}]*height: auto; max-height: none/);
});
