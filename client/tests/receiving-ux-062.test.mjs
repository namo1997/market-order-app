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









test('UX062 #1/#5/#6: compact mobile signature, full-width filter grid and feedback CSS retain touch targets', async () => {
  const css = postcss.parse(await readFile(new URL('../src/pages/receiving/receiving.css', import.meta.url), 'utf8'));
  const value = (selector, prop) => { let result; css.walkRules(selector, rule => rule.walkDecls(prop, decl => { result = decl.value; })); return result; };
  assert.equal(value('.solao .rc-sign-summary', 'grid-template-columns'), 'minmax(0,1fr) auto');
  assert.equal(value(".solao .rc-document[data-step='sign'] .rc-signature canvas", 'height'), 'clamp(120px, 22dvh, 176px)');
  assert.equal(value('.solao .rc-review-filters', 'grid-template-columns'), 'repeat(2,minmax(0,1fr))');
  assert.equal(value('.solao .rc-review-toolbar .rc-undo', 'position'), 'relative');
});
