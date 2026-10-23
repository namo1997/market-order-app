import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';

// Owner 2026-10-23 "เลื่อนสินค้าให้ลบสินค้าได้": during the blind count a row that is not from an order can be removed;
// the removal travels with the count as deleted_line_ids. Order rows keep "ไม่มา".
const user = { id: 1, name: 'ผู้รับ', role: 'staff', branch_id: 1, department_id: 1 };
const doc = () => ({ id: 5, client_uuid: 'c-5', status: 'draft', kind: 'bill', branch_id: 1, department_id: 1, supplier_name_text: 'ร้าน', images: [{ id: 1 }], early_read: 'done', ocr: { status: 'none' }, counted_complete_at: null, warnings: [],
  lines: [
    { id: 1, line_no: 1, product_id: 7, product_name: 'โค้กกระป๋อง', unit_text: 'กระป๋อง', order_item_id: 42, quantity_received: '0' },
    { id: 2, line_no: 2, product_id: null, product_name: null, bill_name: 'กะเพราไช้', unit_text: 'กก.', order_item_id: null, quantity_received: '0' },
  ] });
const text = h => h.text(h.visible());

test('a bill-read row can be removed during the count and the removal is sent with the count', async () => {
  const h = await harness('DocumentEditor', { initialDocument: doc(), user, onBack() {}, scanFirst: true });
  assert.match(text(h), /ปัดซ้ายเพื่อลบ/);
  assert.equal(h.visible().some(n => n.type === 'button' && n.props['aria-label'] === 'ลบ โค้กกระป๋อง'), false, 'order rows cannot be removed');
  await h.click('ลบ กะเพราไช้');
  assert.doesNotMatch(text(h), /กะเพราไช้/);
  assert.match(text(h), /เหลือ 1 รายการที่ต้องนับ/);
  await h.select('นับได้ โค้กกระป๋อง', '24');
  await h.click('ยืนยันการนับและเทียบบิล');
  await h.click('ถูกต้อง ยืนยันการนับ');
  const body = h.calls.find(c => c[0] === 'count')[2];
  assert.deepEqual(Array.from(body.deleted_line_ids), [2]);
  assert.deepEqual(Array.from(body.lines, line => line.id), [1]);
  h.unmount();
});

test('a locally added row is removed without a server id', async () => {
  const h = await harness('DocumentEditor', { initialDocument: { ...doc(), lines: [doc().lines[0]] }, user, onBack() {}, scanFirst: true }, { getProducts: async () => ({ data: [{ id: 99, name: 'เพิ่มเอง', unit_name: 'ถุง' }] }) });
  await h.click('เพิ่มสินค้าที่มาส่ง');
  await h.select('ค้นหาสินค้า', 'เพิ่ม'); await new Promise(resolve => setTimeout(resolve, 380)); await h.settle();
  await h.click('เพิ่มเอง');
  assert.match(text(h), /เพิ่มเอง/);
  await h.click('ลบ เพิ่มเอง');
  assert.doesNotMatch(text(h), /ลบ เพิ่มเอง/);
  await h.select('นับได้ โค้กกระป๋อง', '24');
  await h.click('ยืนยันการนับและเทียบบิล');
  await h.click('ถูกต้อง ยืนยันการนับ');
  assert.equal(h.calls.find(c => c[0] === 'count')[2].deleted_line_ids, undefined);
  h.unmount();
});
