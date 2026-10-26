import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';
import { packTotal, countedForSave, switchCountUnit } from '../src/pages/receiving/count-unit.js';

// Owner 2026-10-26 "ทำตามแนวทางที่เสนอ" (Thai Namthip: the bill prints 4 ลัง of cans, the product counts กระป๋อง):
// a line with a known pack is counted in the bill unit and saved in counting units.
const user = { id: 1, name: 'ผู้รับ', role: 'staff', branch_id: 1, department_id: 1 };
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
  assert.match(h.text(h.find(n => n.props.className === 'ra-count-review-list')), /4 ลัง = 96 กระป๋อง/);
  await h.click('ถูกต้อง ยืนยันการนับ');
  const body = h.calls.find(call => call[0] === 'count')[2];
  assert.equal(JSON.stringify(body.lines.map(line => [line.id, line.counted_quantity])), JSON.stringify([[1, '96'], [2, '6']]));
});

test('an opened case: switching the line to cans converts what was typed and saves it as is', async () => {
  const h = await harness('DocumentEditor', { initialDocument: doc(), user, onBack() {}, scanFirst: true });
  await h.select('นับได้ โค้กกระป๋อง', '2');
  await h.click('นับเป็นกระป๋อง');
  assert.equal(h.find(n => n.props.id === 'count-1').props.value, '48');
  assert.match(row(h, 1), /นับเป็นลัง/); assert.doesNotMatch(row(h, 1), /= 48/);
  await h.select('นับได้ โค้กกระป๋อง', '53'); await h.select('นับได้ โค้กขวด', '0');
  await h.click('ยืนยันการนับและเทียบบิล'); await h.click('ถูกต้อง ยืนยันการนับ');
  assert.equal(h.calls.find(call => call[0] === 'count')[2].lines[0].counted_quantity, '53');
});

test('pack helpers: totals to 2 decimals, untouched lines, exact switch back only', () => {
  assert.equal(packTotal('4', 24), '96'); assert.equal(packTotal('1.5', 24), '36'); assert.equal(packTotal('0.25', 10), '2.5');
  const line = { count_unit: { unit: 'ลัง', size: 24 } };
  assert.equal(countedForSave(line, '4'), '96'); assert.equal(countedForSave(line, '4', 'item'), '4');
  assert.equal(countedForSave({}, '4'), '4'); assert.equal(countedForSave(line, ''), '');
  assert.equal(switchCountUnit(line, '2'), '48'); assert.equal(switchCountUnit(line, '48', 'item'), '2'); assert.equal(switchCountUnit(line, '53', 'item'), '');
});
