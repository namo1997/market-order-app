import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { harness } from './receiving-harness.mjs';
import { focusField } from '../src/pages/receiving/receiving-validation.js';
import { decimalEntryValid, rejectDecimalEntry } from '../src/pages/receiving/decimal-entry.js';

const user = { id: 1, name: 'ผู้รับทดสอบ', role: 'receiver' };
const line = (id, values = {}) => ({ id, line_no: id, product_id: id, order_item_id: id,
  product_name: `ผัก ${id}`, unit_text: 'กก.', quantity_received: '1', quantity_billed: '1', unit_price: '10', amount: '10',
  match: { source: 'order' }, ...values });
const doc = (values = {}) => ({ id: 5, status: 'draft', kind: 'bill', delivery_date: '2026-10-16',
  receiver_name: user.name, has_receiver_signature: true, total: '20', discount: '0', vat: '0', images: [],
  lines: [line(1), line(2)], ocr: { status: 'done' }, warnings: [], ...values });
const editor = (values, props = {}) => harness('DocumentEditor', { initialDocument: doc(values), user,
  onBack() {}, onChanged() {}, ...props }, { expected: async () => [{ items: [1, 2].map(id => ({ order_item_id: id, product_id: id, quantity_ordered: '1', received_quantity: '0', unit_name: 'กก.' })) }] }, {}, {}, { setTimeout: done => { done(); return 1; }, clearTimeout() {} });
const primary = h => h.find(node => node.type === 'button' && node.props.className?.includes('sg-primary'));
const field = (h, id = 'line-0-inline') => h.find(node => node.props.id === id);







test('UX060 #1/#8: focus clears measured sticky header and complete row actions above keyboard/bar', () => {
  const scrolled = [];
  const row = { scrollIntoView() {}, getBoundingClientRect: () => ({ top: 80, bottom: 240, height: 160 }) };
  const input = { closest: selector => selector === '.rc-compact-item' ? row : null, focus() {}, getBoundingClientRect: () => ({ top: 80, bottom: 128 }) };
  focusField('test', { getElementById: () => input, defaultView: { innerHeight: 800, visualViewport: { height: 420 }, scrollBy: options => scrolled.push(options.top) },
    querySelector: selector => ({ getBoundingClientRect: () => selector.includes('toolbar') ? { bottom: 140 } : selector.includes('shell') ? { bottom: 64 } : { top: 360 } }) });
  assert.deepEqual(scrolled, [-68]);
});









test('UX060 #10: rejects misplaced signs on type/paste, preserves text/caret and accepts intermediate decimals', () => {
  for (const value of ['', '.', '20.', '.5', '0', '20.5']) assert.equal(decimalEntryValid(value), true);
  for (const value of ['20-', '-1', '1e3', '1.2.3', 'abc']) assert.equal(decimalEntryValid(value), false);
  let caret, stopped = false;
  const target = { value: '20-5', selectionStart: 3, setSelectionRange: (a, b) => { caret = [a, b]; } };
  assert.equal(rejectDecimalEntry({ target, stopPropagation: () => { stopped = true; } }, '205'), true);
  assert.equal(target.value, '205'); assert.deepEqual(caret, [2, 2]); assert.equal(stopped, true);
});
