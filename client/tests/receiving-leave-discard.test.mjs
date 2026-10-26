import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';

// Owner 2026-10-26 "พอกดออกโดยไม่บันทึก แล้วกดซัพเดิมมันมีรายการเดิมอยู่": leaving without saving cancels a receipt
// whose count was never confirmed (the server would otherwise resume it); a confirmed count is kept.
const user = { id: 1, name: 'ผู้รับ', role: 'staff', branch_id: 1, department_id: 1 };
const line = { id: 1, line_no: 1, product_id: 59, product_name: 'ปลากะพง #ตัว', unit_text: 'ตัว', order_item_id: null, quantity_received: '0' };
const blind = { id: 313, client_uuid: 'c-313', status: 'draft', kind: 'bill', branch_id: 1, department_id: 1, supplier_name_text: 'แพปลาภูเก็ต', images: [{ id: 294, page_no: 1 }], early_read: 'done', ocr: { status: 'locked' }, counted_complete_at: null, warnings: [], lines: [line] };

test('uncounted receipt: leave without saving cancels it, then goes back', async () => {
  let backs = 0;
  const h = await harness('DocumentEditor', { initialDocument: blind, user, onBack() { backs++; }, scanFirst: true });
  await h.select('นับได้ ปลากะพง #ตัว', '6');
  const backButton = h.find(n => n.type === 'button' && h.text(n) === 'กลับคิว');
  await backButton.props.onClick(); await h.settle();
  assert.match(h.text(h.visible()), /ใบนี้จะถูกยกเลิก/);
  await h.click('ออกโดยไม่บันทึก');
  assert.deepEqual(h.calls.filter(c => c[0] === 'void').map(c => [c[1], c[2]]), [[313, 'ออกโดยไม่บันทึก']]);
  assert.equal(backs, 1);
  h.unmount();
});

test('counted receipt: leave without saving drops only the unsent edits', async () => {
  let backs = 0;
  const counted = { ...blind, counted_complete_at: '2026-10-26T14:30:00Z', ocr: { status: 'done' }, lines: [{ ...line, counted_quantity: '6', quantity_received: '6', quantity_billed: '6', unit_price: '145', amount: '870', match: { source: 'manual', confidence: 1 } }] };
  const h = await harness('DocumentEditor', { initialDocument: counted, user, onBack() { backs++; } });
  await h.click('แก้ข้อมูล ปลากะพง #ตัว');
  await h.select('แก้จำนวนหลังเปิดบิล ปลากะพง #ตัว', '5');
  const backButton = h.find(n => n.type === 'button' && h.text(n) === 'กลับคิว');
  await backButton.props.onClick(); await h.settle();
  assert.match(h.text(h.visible()), /จำนวนที่ยังไม่ส่งจะหาย/);
  await h.click('ออกโดยไม่บันทึก');
  assert.equal(h.calls.some(c => c[0] === 'void'), false);
  assert.equal(backs, 1);
  h.unmount();
});

test('staff home does not list a cancelled receipt', async () => {
  const list = async () => [{ ...blind, status: 'void' }, { ...blind, id: 314, status: 'draft', supplier_name_text: 'ไทยน้ำทิพย์' }];
  const h = await harness('Receiving', {}, { homeMode: async () => ({ mode: 'new_first' }), list }, { isAdmin: false, user: { ...user, role: 'staff' } });
  const shown = h.visible().filter(n => n.type === 'button' && /^เปิดเอกสาร #/.test(n.props['aria-label'] || '')).map(n => n.props['aria-label']);
  assert.deepEqual(shown.map(label => label.split(' ')[1]), ['#314']);
  assert.match(h.text(h.visible()), /ใบรับวันนี้ · 1 ใบ/);
  h.unmount();
});
