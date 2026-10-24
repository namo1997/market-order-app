import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { doc, row, text, cleanup, harness, track } from './review-a-port-harness.mjs';
import { partialDelivery, partialDeliveryText, orderDifference, lineDiffersFromOrder, signSummaryText } from '../src/pages/receiving/review-a.js';

afterEach(cleanup);
const line = (patch = {}) => row(1, { quantity_ordered: '10', previously_received_quantity: '3', quantity_received: '2', counted_quantity: '2', review_decision: 'missing_bill', ...patch });
const manual = lines => doc({ kind: 'manual_receipt', lines });
const render = async lines => track(await harness('ReviewSummary', { doc: manual(lines) }));

test('P8: partial delivery text states ordered, previous, this time and what is still missing', () => {
  assert.equal(partialDeliveryText(line()), 'สั่ง 10 · รับก่อนหน้า 3 · ครั้งนี้ 2 · ยังขาด 5 kg');
  assert.equal(partialDeliveryText(line({ quantity_received: '7', counted_quantity: '7' })), 'สั่ง 10 · รับก่อนหน้า 3 · ครั้งนี้ 7 · ครบแล้ว');
  assert.equal(partialDeliveryText(line({ quantity_received: '9.5', counted_quantity: '9.5' })), 'สั่ง 10 · รับก่อนหน้า 3 · ครั้งนี้ 9.5 · เกิน 2.5 kg');
  assert.equal(partialDelivery(line()).remainingText, '7.00');
});

test('P8: without a previous receipt (first delivery, blind or unknown) nothing changes', () => {
  for (const previously_received_quantity of [undefined, null, '', '0', '0.00']) {
    const first = line({ previously_received_quantity });
    assert.equal(partialDelivery(first), null); assert.equal(partialDeliveryText(first), '');
  }
  assert.equal(lineDiffersFromOrder(line({ previously_received_quantity: undefined, quantity_received: '10' })), false);
  assert.equal(orderDifference(line({ previously_received_quantity: undefined })), 'ขาดจากใบสั่ง 8 kg');
});

test('P8: the difference compares with the remaining quantity, not the full order', () => {
  assert.equal(lineDiffersFromOrder(line({ quantity_received: '7' })), false, '10 - 3 = 7 matches the outstanding quantity');
  assert.equal(lineDiffersFromOrder(line({ quantity_received: '10' })), true);
  assert.equal(orderDifference(line({ quantity_received: '7' })), '');
  assert.equal(orderDifference(line()), 'ขาดจากยอดค้างรับ 5 kg');
  assert.equal(signSummaryText(manual([line({ quantity_received: '7' })])), 'รับ 1 จาก 1 รายการ');
  // Previous receipts above the order leave nothing outstanding: any new quantity is over.
  assert.equal(partialDelivery(line({ previously_received_quantity: '12' })).remaining, 0n);
});

test('P8: the no-bill summary card shows the outstanding line and compares with the remainder', async () => {
  const h = await render([line()]);
  assert.match(text(h), /นับได้ 2 กก\. · รับ 2 กก\./);
  assert.match(text(h), /สั่ง 10 · รับก่อนหน้า 3 · ครั้งนี้ 2 · ยังขาด 5 kg/);
  assert.match(text(h), /จำนวนรับต่างจากยอดค้างรับ/); assert.doesNotMatch(text(h), /ต่างจากใบสั่ง/);
  h.unmount();
  const done = await render([line({ quantity_received: '7', counted_quantity: '7' })]);
  assert.match(text(done), /ครบแล้ว/); assert.match(text(done), /ตรงตามยอดค้างรับ/);
});

test('P8: a summary of a first delivery keeps the original wording', async () => {
  const h = await render([line({ previously_received_quantity: undefined })]);
  assert.match(text(h), /สั่ง 10 kg/); assert.match(text(h), /จำนวนรับต่างจากใบสั่ง/); assert.doesNotMatch(text(h), /รับก่อนหน้า/);
});

test('P8: branch lines (aggregated across departments) show the summed previous quantity', async () => {
  const branch = line({ quantity_ordered: '10', previously_received_quantity: '3.5', quantity_received: '2',
    departments: [{ order_item_id: 41, department_id: 1, department_name: 'ครัว', quantity_ordered: '6', quantity_received: '1' },
      { order_item_id: 42, department_id: 2, department_name: 'สโตร์', quantity_ordered: '4', quantity_received: '1' }] });
  assert.match(partialDeliveryText(branch), /รับก่อนหน้า 3.5 · ครั้งนี้ 2 · ยังขาด 4.5/);
});
