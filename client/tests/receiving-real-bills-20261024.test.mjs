import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';

// Real-bill test 2026-10-24 (pilot + Codex OCR, Bababacon bill on the pork supplier's order): bill lines
// that are not matched to a product yet have no product name; every label must fall back to the bill text.
const user = { id: 1, name: 'ผู้รับ', role: 'staff', branch_id: 1, department_id: 1 };
const text = h => h.text(h.visible());
const blindDoc = () => ({ id: 1, client_uuid: 'rb-1', status: 'draft', kind: 'bill', branch_id: 1, department_id: 1, supplier_name_text: 'บริษัท สุพรค้าหมูเจริญ จำกัด',
  images: [{ id: 1 }], early_read: 'done', ocr: { status: 'none' }, counted_complete_at: null,
  lines: [
    { id: 1, line_no: 1, product_id: 14, product_name: 'ตับหมู', unit_text: 'กิโลกรัม', order_item_id: 8, quantity_received: '0' },
    { id: 3, line_no: 3, product_id: null, product_name: null, bill_name: 'สามชั้นลอกหนังแผ่น', unit_text: 'กก.', order_item_id: null, quantity_received: '0' },
  ] });

test('the count review sheet names a bill-only line by its bill wording', async () => {
  const h = await harness('DocumentEditor', { initialDocument: blindDoc(), user, onBack() {}, scanFirst: true });
  await h.select('นับได้ ตับหมู', '0'); await h.select('นับได้ สามชั้นลอกหนังแผ่น', '9.4');
  await h.click('ยืนยันการนับและเทียบบิล');
  const sheet = h.text(h.find(n => n.props.className === 'ra-count-review-list'));
  assert.match(sheet, /สามชั้นลอกหนังแผ่น9\.4 กก\./);
  assert.match(sheet, /ตับหมูไม่มา/);
});

const reviewDoc = () => ({ id: 1, client_uuid: 'rb-1', status: 'draft', kind: 'bill', branch_id: 1, department_id: 1, supplier_name_text: 'บริษัท สุพรค้าหมูเจริญ จำกัด',
  images: [{ id: 1 }], ocr: { status: 'done', confidence: 0.64 }, counted_complete_at: '2026-10-24T09:50:00Z', doc_ref: 'INV2026100089', total: '3244.75', warnings: [],
  lines: [
    { id: 3, line_no: 3, product_id: null, product_name: null, bill_text: 'สามชั้นลอกหนังแผ่น', unit_text: 'กก.', order_item_id: null,
      quantity_billed: '9.4', quantity_received: '9.4', counted_quantity: '9.40', unit_price: '188.00', amount: '1767.20' },
  ] });

test('review labels of an unmatched bill line never print null', async () => {
  const h = await harness('DocumentEditor', { initialDocument: reviewDoc(), user, onBack() {} });
  await h.settle();
  const all = h.text(h.all());
  assert.doesNotMatch(all, /null/);
  assert.ok(h.all().some(n => n.props['aria-label'] === 'แก้ข้อมูล สามชั้นลอกหนังแผ่น'), 'edit button is named after the bill line');
});

// Bill #4106 on a new shop: confirm failed with the server's "กรุณากำหนดกลุ่มสินค้า…" but the receiver saw
// only the generic validation line.
test('a validation failure shows the server\'s own message when it has one', async () => {
  const { errorText } = await import('../src/pages/receiving/receiving-utils.js');
  const specific = { response: { status: 422, data: { code: 'VALIDATION_FAILED', message: 'กรุณากำหนดกลุ่มสินค้าเพื่อบันทึกรายการเดินซื้อ' } } };
  assert.equal(errorText(specific), 'กรุณากำหนดกลุ่มสินค้าเพื่อบันทึกรายการเดินซื้อ');
  const bare = { response: { status: 422, data: { code: 'VALIDATION_FAILED' } } };
  assert.match(errorText(bare), /ข้อมูลยังไม่ถูกต้อง/);
  const other = { response: { status: 403, data: { code: 'FORBIDDEN', message: 'ignored' } } };
  assert.equal(errorText(other), 'คุณไม่มีสิทธิ์ใช้งานเอกสารนี้');
});
