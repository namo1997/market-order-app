import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { harness } from './receiving-harness.mjs';
import { normalizeNumberEntry, numberError } from '../src/pages/receiving/receiving-validation.js';
import { transitionReview, newReviewState } from '../src/pages/receiving/line-review-state.js';
import { documentReviewSummary, reviewChangeMessage } from '../src/pages/receiving/receiving-review.js';
import { fitSignature } from '../src/pages/receiving/use-review-layout.js';

const line = (id, values = {}) => ({ id, line_no: id, product_id: id, order_item_id: id,
  product_name: `ผัก ${id}`, unit_text: 'กก.', quantity_received: '1', quantity_billed: '1', amount: '10', unit_price: '10',
  match: { source: 'manual' }, ...values });
const document = (values = {}) => ({ id: 5, status: 'draft', kind: 'bill', delivery_date: '2026-10-16',
  has_receiver_signature: true, total: '20', discount: '0', vat: '0', images: [], lines: [line(1), line(2)],
  ocr: { status: 'done' }, warnings: [{ code: 'PRICE_CHANGE', line_no: 1 }], ...values });
const expected = [1, 2].map(id => ({ order_item_id: id, product_id: id, quantity_ordered: '1', received_quantity: '0', unit_name: 'กก.' }));
const editor = (doc = document(), api = {}) => harness('DocumentEditor', { initialDocument: doc,
  user: { id: 1, name: 'ผู้รับ', role: 'receiver' }, onBack() {}, onChanged() {} },
{ expected: async () => [{ items: expected }], ...api }, {}, {}, { setTimeout: done => { done(); return 1; }, clearTimeout() {} });
const field = (h, id = 'line-0-inline') => h.find(node => node.props.id === id);
const visibleCopy = h => h.visible().flatMap(node => [node.props.children].flat(Infinity).filter(value => typeof value === 'string' || typeof value === 'number')).join('');
const buttons = h => h.visible().filter(node => node.type === 'button').map(node => h.text(node));
const focus = async (h, id) => { field(h, id).props.onFocus(); await h.settle(); };

test('UX062 #1/#4: signing shows one compact summary/disclosure, short pending-price context and no warning badge stack', async () => {
  const h = await editor(document({ lines: [line(1), line(2, { amount: null, unit_price: null })], total: '10' }));
  await h.radio('sign');
  assert.equal(h.visible().filter(node => node.props.className === 'rc-sign-summary').length, 1);
  assert.equal(buttons(h).filter(text => text === 'ดูข้อเตือน').length, 1);
  assert.ok(visibleCopy(h).includes('ตรวจครบ 2 รายการ / ยอดบิล 10.00 บาท'));
  assert.ok(visibleCopy(h).includes('ยังไม่มีราคา 1 รายการ'));
  assert.ok(!visibleCopy(h).includes('ข้อเตือนสินค้า'));
  await h.click('ดูข้อเตือน');
  assert.ok(visibleCopy(h).includes('ข้อเตือนสินค้า 1 รายการ'));
  assert.ok(visibleCopy(h).includes('ราคาเปลี่ยน')); h.unmount();
});

test('UX062 #1: signature scrolling clears measured bars for 360/390/412dp and changes with wrapped bars', () => {
  for (const width of [360, 390, 412]) for (const barHeight of [80, 128]) {
    let shift = 0;
    const frameTop = 350 + (412 - width);
    const frameBottom = frameTop + 350;
    const root = { querySelector: selector => ({ getBoundingClientRect: () => selector.includes('sg-bar')
      ? { top: 720 - barHeight } : { top: frameTop - shift, bottom: frameBottom - shift } }) };
    const view = { innerHeight: 720, scrollBy: options => { shift += options.top; } };
    fitSignature(root, view);
    assert.ok(frameBottom - shift <= 720 - barHeight - 8, `${width}: full frame above bar`);
    assert.ok(frameTop - shift >= 8, `${width}: top of frame visible`);
  }
});

test('UX062 #2: inline 20. stays neutral while focused, 20.5 types normally and blur normalizes 20.', async () => {
  const h = await editor(); await h.radio('lines'); await h.click('ทั้งหมด');
  await focus(h, 'line-0-inline'); await h.select('รับจริง ผัก 1', '20.');
  assert.equal(field(h).props.value, '20.'); assert.equal(field(h).props['aria-invalid'], false);
  assert.ok(!visibleCopy(h).includes('กรอกตัวเลขตั้งแต่ 0 ขึ้นไป'));
  await h.select('รับจริง ผัก 1', '20-'); assert.equal(field(h).props.value, '20.'); assert.equal(field(h).props['aria-invalid'], true);
  await h.select('รับจริง ผัก 1', '20.5'); assert.equal(field(h).props.value, '20.5');
  await h.select('รับจริง ผัก 1', '20.'); field(h).props.onBlur(); await h.settle();
  assert.equal(field(h).props.value, '20');
  await h.click('บันทึกและตรวจถัดไป'); assert.equal(field(h).props.value, '20'); h.unmount();
});

test('UX062 #2: full edit allows unfinished decimals, rejects 20- and normalizes blur', async () => {
  const h = await editor(); await h.radio('lines'); await h.click('ทั้งหมด'); await h.click('แก้ ผัก 1');
  const id = 'line-0-quantity_received'; await focus(h, id); await h.select('รับจริง', '20.');
  assert.equal(field(h, id).props.value, '20.'); assert.equal(field(h, id).props['aria-invalid'], undefined);
  await h.select('รับจริง', '20-'); assert.equal(field(h, id).props.value, '20.');
  assert.equal(field(h, id).props['aria-invalid'], true);
  await h.select('รับจริง', '20.'); field(h, id).props.onBlur(); await h.settle();
  assert.equal(field(h, id).props.value, '20'); h.unmount();
});

test('UX062 #2: save without blur normalizes only trailing integer dot and keeps strict limits/malformed rejection', () => {
  const state = { ...newReviewState(), lines: [line(1)], editing: { index: 0, line: line(1, { quantity_received: '20.' }) } };
  const saved = transitionReview(state, { type: 'save' });
  assert.equal(saved.lines[0].quantity_received, '20'); assert.equal(saved.editing, null);
  for (const value of ['20-', '.', '1..2', '-2', '100000000.']) {
    const bad = transitionReview({ ...state, editing: { index: 0, line: line(1, { quantity_received: value }) } }, { type: 'save' });
    assert.ok(bad.error); assert.equal(bad.lines[0].quantity_received, '1');
  }
  assert.equal(normalizeNumberEntry('20-'), '20-'); assert.ok(numberError('20-', 'quantity_received'));
});

test('UX062 #3: summary change describes 9→1 and equal-count reason changes', () => {
  const before = documentReviewSummary(document({ lines: Array.from({ length: 9 }, (_, i) => line(i + 1)), warnings: Array.from({ length: 9 }, (_, i) => ({ code: 'PRICE_CHANGE', line_no: i + 1 })) }), Array.from({ length: 9 }, (_, i) => ({ ...expected[0], order_item_id: i + 1, product_id: i + 1 })));
  const after = documentReviewSummary(document(), expected);
  assert.match(reviewChangeMessage(before, after), /ข้อเตือนสินค้า 9→1 รายการ/);
  const reasons = documentReviewSummary(document({ warnings: [{ code: 'LOW_CONFIDENCE', line_no: 1 }] }), expected);
  assert.match(reviewChangeMessage(after, reasons), /รายละเอียดข้อเตือนเปลี่ยน/);
});

test('UX062 #3: changed summary is amber, acknowledgement goes to sign once and clears across steps', async () => {
  const initial = document();
  const h = await editor(initial, { update: async (id, body) => ({ ...initial, ...body, warnings: [] }) });
  await h.radio('lines'); await h.click('ทั้งหมด'); await h.select('รับจริง ผัก 1', '1'); await h.click('บันทึกและตรวจถัดไป');
  await h.click('เพิ่มเติม'); await h.select('ทำรายการ', 'save'); await h.click('เลือก');
  assert.ok(h.visible().some(node => node.props['data-status'] === 'review' && h.text(node).includes('ข้อเตือนสินค้า 1→0')));
  await h.click('ไปเซ็น'); assert.ok(buttons(h).includes('ตรวจสรุปแล้ว ไปเซ็น'));
  await h.click('ตรวจสรุปแล้ว ไปเซ็น');
  assert.equal(h.find(node => node.props['data-step']).props['data-step'], 'sign');
  assert.ok(!visibleCopy(h).includes('สรุปเปลี่ยน'));
  await h.radio('lines'); await h.click('ไปเซ็น'); assert.ok(!buttons(h).includes('ตรวจสรุปแล้ว ไปเซ็น'));
  assert.ok(!visibleCopy(h).includes('สรุปเปลี่ยน')); h.unmount();
});

test('UX062 #4: one warning summary on review and confirmation; confirmation footer stays short', async () => {
  const h = await editor(); await h.radio('lines');
  assert.equal(visibleCopy(h).split('ดูข้อเตือน').length - 1, 1);
  assert.equal(buttons(h).filter(text => text === 'ดูข้อเตือน').length, 1);
  await h.click('ไปเซ็น'); await h.click('ตรวจรับ');
  assert.equal(visibleCopy(h).split('ข้อเตือนสินค้า 1 รายการ').length - 1, 1);
  assert.equal(h.text(h.find(node => node.props.className === 'rc-confirm-caution')), 'ยืนยันแล้วเข้าคลัง แก้ไม่ได้'); h.unmount();
});

test('UX062 #5: pending zero replaces table header/list; all rows remain reachable, undo restores pending row', async () => {
  const h = await editor(); await h.radio('lines');
  assert.ok(visibleCopy(h).includes('ตรวจครบแล้ว')); assert.ok(buttons(h).includes('ดูทั้งหมด 2 รายการ'));
  assert.equal(h.visible().filter(node => ['rc-compact-head', 'rc-compact-list'].includes(node.props.className)).length, 0);
  await h.click('ดูทั้งหมด 2 รายการ'); assert.equal(h.visible().filter(node => node.props.className === 'rc-compact-item').length, 2);
  await h.select('รับจริง ผัก 1', '2'); await h.click('บันทึกและตรวจถัดไป');
  await h.click('เลิกทำรายการล่าสุด'); assert.equal(field(h).props.value, '1'); h.unmount();
});

test('UX062 #6: row feedback belongs to sticky toolbar; dismiss preserves separate undo action', async () => {
  const h = await editor(document({ lines: [line(1, { match: { source: 'order' } }), line(2, { match: { source: 'order' } })] }));
  await h.radio('lines'); await h.select('รับจริง ผัก 1', '1'); await h.click('บันทึกและตรวจถัดไป');
  const toolbar = h.find(node => node.props.className === 'rc-review-toolbar');
  assert.ok(h.all(toolbar).some(node => node.props.className === 'rc-undo'));
  assert.ok(buttons(h).includes('เลิกทำรายการล่าสุด'));
  await h.click('ปิดข้อความ'); assert.ok(buttons(h).includes('เลิกทำรายการล่าสุด'));
  await h.click('เลิกทำรายการล่าสุด'); assert.ok(buttons(h).includes('ยังไม่ตรวจ 2')); h.unmount();
});

test('UX062 #1/#5/#6: compact mobile signature, full-width filter grid and feedback CSS retain touch targets', async () => {
  const css = postcss.parse(await readFile(new URL('../src/pages/receiving/receiving.css', import.meta.url), 'utf8'));
  const value = (selector, prop) => { let result; css.walkRules(selector, rule => rule.walkDecls(prop, decl => { result = decl.value; })); return result; };
  assert.equal(value('.solao .rc-sign-summary', 'grid-template-columns'), 'minmax(0,1fr) auto');
  assert.equal(value(".solao .rc-document[data-step='sign'] .rc-signature canvas", 'height'), 'clamp(120px, 22dvh, 176px)');
  assert.equal(value('.solao .rc-review-filters', 'grid-template-columns'), 'repeat(2,minmax(0,1fr))');
  assert.equal(value('.solao .rc-review-toolbar .rc-undo', 'position'), 'relative');
});
