import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';

// Bug hunt 2026-10-24: a line received as 2 ลัง linked to a product counted in กก. used to post 2 กก.
// The accounting panel now asks how much that was in the product's unit before linking.
const doc = { id: 5, status: 'confirmed', supplier_master_id: 8, lines: [{ id: 9, bill_text: 'สามชั้นแพ็คลัง', review_decision: 'receive_unmatched', product_id: null,
  quantity_received: '2.00', unit_text: 'ลัง', unit_price: '0.25' }] };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function panel(products) {
  const calls = [];
  const h = await harness('LateProductLink', { doc, onLinked: () => calls.push('linked') }, {
    lateLinkProducts: async () => products,
    linkLineProduct: async (...args) => { calls.push(args); return {}; }
  }, {}, {}, { AbortController }, null, '../src/pages/admin/receiving/LateProductLink.jsx');
  await wait(350); await h.settle();
  return { h, calls };
}

test('a product in another unit asks for the received quantity in that unit', async () => {
  const { h, calls } = await panel([{ id: 7, name: 'หมูสามชั้น', unit_id: 2, unit_name: 'กก.' }]);
  await h.click('หมูสามชั้นกก.');
  assert.match(h.text(h.all()), /นับได้ 2 ลัง · คิดเป็น กก\./);
  const button = () => h.find(n => n.type === 'button' && n.props.className === 'ra-primary');
  assert.equal(button().props.disabled, true); assert.equal(h.text(button()), 'ใส่จำนวนเป็น กก.');
  await h.select('นับได้ 2 ลัง · คิดเป็น กก.', '20');
  assert.equal(button().props.disabled, false);
  await h.click('ผูกกับ หมูสามชั้น และลงคลัง');
  assert.equal(JSON.stringify(calls[0]), JSON.stringify([5, 9, { product_id: 7, remember_alias: true, quantity_received: '20' }]));
});

test('a product in the bill unit links with the staff count', async () => {
  const { h, calls } = await panel([{ id: 11, name: 'สามชั้นลัง', unit_id: 3, unit_name: 'ลัง' }]);
  await h.click('สามชั้นลังลัง');
  assert.doesNotMatch(h.text(h.all()), /คิดเป็น/);
  await h.click('ผูกกับ สามชั้นลัง และลงคลัง');
  assert.equal(JSON.stringify(calls[0]), JSON.stringify([5, 9, { product_id: 11, remember_alias: true }]));
});

test('a linked line no longer says it waits for accounting', async () => {
  const { receiptDecisionText } = await import('../src/pages/receiving/review-a.js');
  assert.equal(receiptDecisionText({ review_decision: 'receive_unmatched', quantity_received: '2', unit_text: 'กิโลกรัม' }), 'รับ 2 กิโลกรัม · รอบัญชีผูกสินค้า');
  assert.equal(receiptDecisionText({ review_decision: 'receive_unmatched', product_id: 35, quantity_received: '4', unit_text: 'ห่อ' }), 'รับ 4 ห่อ · บัญชีผูกสินค้าแล้ว');
});

test('an issue from a line received before its product names that decision', async () => {
  const { receiptFacts } = await import('../src/receiving-app/issue-labels.mjs');
  const facts = Object.fromEntries(receiptFacts({ unit_text: 'กิโลกรัม', receipt_line: { review_decision: 'receive_unmatched', counted_quantity: '2', quantity_received: '2', quantity_billed: '21' } }));
  assert.equal(facts['การรับของ'], 'รับไปก่อน · บัญชีผูกสินค้าภายหลัง');
});
