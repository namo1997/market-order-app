import test from 'node:test';
import assert from 'node:assert/strict';
import { quantityStatus, moneyStatus, thaiDate } from '../src/pages/receiving/receiving-status.js';

const line = { product_id: 7, order_item_id: 42, quantity_received: '0.3', unit_text: 'กก.', unit_price: '1' };
const expected = [{ order_item_id: 42, quantity_ordered: '0.3', received_quantity: '0', unit_name: 'กก.' }];

test('status: exact, short, over and changed input immediately recompute from integer quantities', () => {
  assert.deepEqual(quantityStatus(line, expected), { status: 'ok', label: 'ตรงใบสั่ง' });
  assert.deepEqual(quantityStatus({ ...line, quantity_received: '0.2' }, expected), { status: 'review', label: 'ต่าง 0.1 กก.' });
  assert.deepEqual(quantityStatus({ ...line, quantity_received: '1.3' }, expected), { status: 'review', label: 'ต่าง 1 กก.' });
  assert.equal(quantityStatus(line, expected).status, 'ok');
});
test('status: partial prior receipt, split lines and commas compare the summed remaining order', () => {
  const items = [{ ...expected[0], quantity_ordered: '1,000.30', received_quantity: '1,000' }];
  const lines = [{ ...line, quantity_received: '0.1' }, { ...line, quantity_received: '0.2' }];
  assert.equal(quantityStatus(lines[0], items, lines).status, 'ok');
  assert.equal(quantityStatus(lines[1], items, lines).status, 'ok');
  assert.match(quantityStatus(lines[0], items, [{ ...line, quantity_received: '0.4' }]).label, /ต่าง 0.1/);
});
test('status: missing order, unknown units and alias multiplier never show green', () => {
  assert.equal(quantityStatus(line, null).status, 'review');
  assert.equal(quantityStatus({ ...line, order_item_id: null }, expected).status, 'review');
  assert.equal(quantityStatus({ ...line, unit_text: 'ลัง' }, expected).status, 'review');
  assert.equal(quantityStatus({ ...line, unit_text: '' }, expected).status, 'review');
  assert.equal(quantityStatus({ ...line, unit_multiplier: 10 }, expected).status, 'review');
});
test('status: invalid, negative, huge values and unmapped bill product are red; manual receipt requires review', () => {
  for (const value of ['-1', 'NaN', 'Infinity', '1e9', '', '100000000']) assert.equal(quantityStatus({ ...line, quantity_received: value }, expected).status, 'error');
  for (const patch of [{ unit_price: '-1' }, { amount: '1000000000' }, { unit_price: '1000000' }, { quantity_billed: '100000000' }]) {
    assert.equal(quantityStatus({ ...line, ...patch }, expected).status, 'error');
  }
  assert.equal(quantityStatus({ ...line, product_id: null }, expected).status, 'error');
  assert.equal(quantityStatus({ ...line, product_id: null }, expected, [line], 'manual_receipt').status, 'review');
});
test('status: money is exact, editable, supports discount/VAT and missing total never shows green', () => {
  const lines = [{ amount: '0.1' }, { amount: '0.2' }];
  const matched = moneyStatus(lines, '0', '0', '0.3');
  assert.equal(matched.total, 30n); assert.equal(matched.adjusted, 30n); assert.equal(matched.status, 'ok');
  assert.equal(moneyStatus(lines, '0', '0', '0.4').status, 'review');
  assert.equal(moneyStatus(lines, '0', '0', '').status, 'review');
  assert.equal(moneyStatus(lines, '0', '0', null).status, 'review');
  assert.equal(moneyStatus([{ amount: '100' }], '10', '7', '97').status, 'ok');
  assert.equal(moneyStatus(lines, '1', '0', '0.3').status, 'error');
  assert.equal(moneyStatus([{ amount: '-1' }], '0', '0', '0').status, 'error');
});
test('date: Thai display uses Buddhist year, including year boundary, while API ISO date remains intact', () => {
  assert.match(thaiDate('2026-10-15'), /2569/);
  assert.match(thaiDate('2027-01-01'), /2570/);
  assert.equal(thaiDate(''), 'ไม่ระบุวันที่');
});
test('status: header subtotal equation is recomputed instead of trusting stored OCR warning', () => {
  const lines = [{ amount: '100' }];
  assert.equal(moneyStatus(lines, '10', '7', '97', '99').status, 'review');
  assert.equal(moneyStatus(lines, '10', '7', '97', '100').status, 'ok');
});
test('status: mismatched product and invalid multiplier are red; unknown alias conversion requires review', () => {
  assert.equal(quantityStatus(line, [{ ...expected[0], product_id: 99 }]).status, 'error');
  for (const unit_multiplier of [0, -1, 10001, 'NaN']) assert.equal(quantityStatus({ ...line, unit_multiplier }, expected).status, 'error');
  assert.equal(quantityStatus({ ...line, match: { source: 'alias' } }, expected).status, 'review');
  assert.equal(quantityStatus({ ...line, match: { source: 'alias' }, unit_multiplier: 1 }, expected).status, 'ok');
});
