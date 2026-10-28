import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';
import { packTotal, countedForSave, switchCountUnit } from '../src/pages/receiving/count-unit.js';

// Owner 2026-10-26 "ทำตามแนวทางที่เสนอ" (Thai Namthip: the bill prints 4 ลัง of cans, the product counts กระป๋อง):
// a line with a known pack is counted in the bill unit and saved in counting units.
const user = { id: 1, name: 'ผู้รับ', role: 'staff', branch_id: 1, department_id: 1 };
// Owner 2026-10-28: staff count and sign; the per-row review, summary and read-back stay for accounting/admin.
const reviewer = { ...user, role: 'accounting' };
const doc = () => ({ id: 302, client_uuid: 'tnt-302', status: 'draft', kind: 'bill', branch_id: 1, department_id: 1, supplier_name_text: 'ไทยน้ำทิพย์',
  images: [{ id: 1 }], early_read: 'done', ocr: { status: 'none' }, counted_complete_at: null, lines: [
    { id: 1, line_no: 1, product_id: 7, product_name: 'โค้กกระป๋อง', unit_text: 'กระป๋อง', order_item_id: null, count_unit: { unit: 'ลัง', size: 24 } },
    { id: 2, line_no: 2, product_id: 8, product_name: 'โค้กขวด', unit_text: 'ขวด', order_item_id: null }] });
const row = (h, id) => h.text(h.find(n => n.type === 'article' && n.props.className === 'ra-count-row' && h.all(n).some(c => c.props.id === `count-${id}`)));

test('a pack line is counted in ลัง, shows the can total, and saves cans', async () => {
  const h = await harness('DocumentEditor', { initialDocument: doc(), user, onBack() {}, scanFirst: true });
  assert.match(row(h, 1), /ลัง/); assert.match(row(h, 1), /นับเป็นกระป๋อง/);
  assert.doesNotMatch(row(h, 2), /นับเป็น/);
  await h.select('นับได้ โค้กกระป๋อง', '4'); await h.select('นับได้ โค้กขวด', '6');
  assert.match(row(h, 1), /= 96 กระป๋อง/);
  await h.click('ยืนยันการนับและเทียบบิล');
  const body = h.calls.find(call => call[0] === 'count')[2];
  assert.equal(JSON.stringify(body.lines.map(line => [line.id, line.counted_quantity])), JSON.stringify([[1, '96'], [2, '6']]));
});

test('accounting read-back names the pack and its can total', async () => {
  const h = await harness('DocumentEditor', { initialDocument: doc(), user: reviewer, onBack() {}, scanFirst: true });
  await h.select('นับได้ โค้กกระป๋อง', '4'); await h.select('นับได้ โค้กขวด', '6');
  await h.click('ยืนยันการนับและเทียบบิล');
  assert.match(h.text(h.find(n => n.props.className === 'ra-count-review-list')), /4 ลัง = 96 กระป๋อง/);
});

test('an opened case: switching the line to cans converts what was typed and saves it as is', async () => {
  const h = await harness('DocumentEditor', { initialDocument: doc(), user, onBack() {}, scanFirst: true });
  await h.select('นับได้ โค้กกระป๋อง', '2');
  await h.click('นับเป็นกระป๋อง');
  assert.equal(h.find(n => n.props.id === 'count-1').props.value, '48');
  assert.match(row(h, 1), /นับเป็นลัง/); assert.doesNotMatch(row(h, 1), /= 48/);
  await h.select('นับได้ โค้กกระป๋อง', '53'); await h.select('นับได้ โค้กขวด', '0');
  await h.click('ยืนยันการนับและเทียบบิล');
  assert.equal(h.calls.find(call => call[0] === 'count')[2].lines[0].counted_quantity, '53');
});

test('pack helpers: totals to 2 decimals, untouched lines, exact switch back only', () => {
  assert.equal(packTotal('4', 24), '96'); assert.equal(packTotal('1.5', 24), '36'); assert.equal(packTotal('0.25', 10), '2.5');
  const line = { count_unit: { unit: 'ลัง', size: 24 } };
  assert.equal(countedForSave(line, '4'), '96'); assert.equal(countedForSave(line, '4', 'item'), '4');
  assert.equal(countedForSave({}, '4'), '4'); assert.equal(countedForSave(line, ''), '');
  assert.equal(switchCountUnit(line, '2'), '48'); assert.equal(switchCountUnit(line, '48', 'item'), '2'); assert.equal(switchCountUnit(line, '53', 'item'), '');
});

// Owner 2026-10-26 "ทำให้อ่าน 1x24 บนบิลเดาขนาดแพ็คเองด้วย": a first bill (no shortcut yet) — the row was counted in
// ลัง; picking a can product converts it instead of asking to check the unit.
const firstBill = () => ({ id: 303, client_uuid: 'tnt-303', status: 'draft', kind: 'bill', branch_id: 1, department_id: 1, supplier_name_text: 'ไทยน้ำทิพย์',
  images: [{ id: 1 }], ocr: { status: 'done', confidence: 0.95 }, counted_complete_at: '2026-10-26T04:00:00Z', total: '1300.92', warnings: [], lines: [
    { id: 5, line_no: 1, product_id: null, product_name: null, bill_text: 'โคคาโคลา กระป๋อง325มล. 1x24', unit_text: 'ลัง', order_item_id: null,
      quantity_billed: '4', quantity_received: '4', counted_quantity: '4.00', unit_price: '325.23', amount: '1300.92',
      bill_read: { quantity_billed: 4, unit_price: 325.23, amount: 1300.92 } }] });

test('picking a can product for a 1x24 ลัง row converts it to cans and sends the pack once', async () => {
  const h = await harness('DocumentEditor', { initialDocument: firstBill(), user: reviewer, onBack() {} },
    { getProducts: async () => ({ data: [{ id: 34, name: 'โค้กกระป๋อง', unit_name: 'กระป๋อง', unit_id: 7 }] }) });
  await h.settle(); await h.settle();
  await h.click('โค้กกระป๋อง');
  const card = h.text(h.find(n => n.props.id === 'review-row-5'));
  assert.doesNotMatch(card, /ตรวจหน่วย|บิลคิดเป็น/);
  assert.match(card, /บิลเขียน 4 × 325.23 · คิดเป็น 96 กระป๋อง/);
  await h.click('ยืนยันรับ 96');
  const body = h.calls.filter(call => call[0] === 'update').at(-1)[2];
  const sent = body.lines.find(line => line.id === 5);
  assert.equal(Number(sent.quantity_received), 96); assert.equal(Number(sent.quantity_billed), 96); assert.equal(sent.unit_text, 'กระป๋อง');
  assert.equal(JSON.stringify(sent.count_unit), JSON.stringify({ unit: 'ลัง', size: 24 }));
});

test('a bag size is not a pack: the unit check stays', async () => {
  const doc = firstBill(); doc.lines[0] = { ...doc.lines[0], bill_text: 'ถุงร้อน 6x14', unit_text: 'มัด' };
  const h = await harness('DocumentEditor', { initialDocument: doc, user: reviewer, onBack() {} },
    { getProducts: async () => ({ data: [{ id: 40, name: 'ถุงร้อน 6x14', unit_name: 'แพ็ค', unit_id: 3 }] }) });
  await h.settle(); await h.settle();
  await h.click('ถุงร้อน 6x14แพ็ค');
  assert.match(h.text(h.find(n => n.props.id === 'review-row-5')), /บิลคิดเป็น มัด แต่สินค้านี้นับเป็น แพ็ค/);
});
