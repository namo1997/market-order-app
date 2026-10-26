import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';

// Owner 2026-10-26 "เรายกเลิกไม่ได้หรอ ถ้าอยากยกเลิกการถ่าย": a saved page can be removed from a draft; the bill is read
// again from the pages that remain. Confirmed receipts show no delete.
const user = { id: 1, name: 'ผู้รับ', role: 'staff', branch_id: 1, department_id: 1 };
const base = { id: 5, client_uuid: 'c-5', status: 'draft', kind: 'bill', branch_id: 1, department_id: 1, supplier_name_text: 'ร้าน', warnings: [], ocr: { status: 'done' },
  counted_complete_at: '2026-10-26T08:00:00Z', images: [{ id: 1, page_no: 1 }, { id: 2, page_no: 2 }],
  lines: [{ id: 1, line_no: 1, product_id: 7, product_name: 'ปลาทับทิม', unit_text: 'ตัว', counted_quantity: '20', quantity_received: '20', quantity_billed: '20', unit_price: '120', amount: '2400', match: { source: 'manual', confidence: 1 } }] };

test('after the count: deleting a page calls the API, reloads and reads the remaining page again', async () => {
  const h = await harness('DocumentEditor', { initialDocument: { ...base }, user, onBack() {} });
  await h.click('ดู / เพิ่มรูปบิล');
  await h.click('ลบรูปหน้า 1');
  assert.deepEqual(h.calls.filter(c => c[0] === 'deleteImage').map(c => [c[1], c[2]]), [[5, 1]]);
  assert.ok(h.calls.some(c => c[0] === 'ocr'), 'the remaining page is read again');
  assert.equal(h.visible().filter(n => n.type === 'button' && /^ลบรูปหน้า/.test(h.text(n))).length, 1, 'one page left to delete');
  h.unmount();
});

test('blind count: each page lists its own delete; a confirmed receipt offers none', async () => {
  const blind = { ...base, counted_complete_at: null, early_read: 'done', ocr: { status: 'locked' } };
  const h = await harness('DocumentEditor', { initialDocument: blind, user, onBack() {}, scanFirst: false });
  assert.deepEqual(h.visible().filter(n => n.type === 'button' && /^ลบรูปหน้า/.test(h.text(n))).map(n => h.text(n)), ['ลบรูปหน้า 1', 'ลบรูปหน้า 2']);
  await h.click('ลบรูปหน้า 2');
  assert.deepEqual(h.calls.filter(c => c[0] === 'deleteImage').map(c => c[2]), [2]);
  assert.equal(h.calls.filter(c => c[0] === 'ocr').length, 1, 'the early read restarts on the page that is left');
  h.unmount();
  const done = await harness('DocumentEditor', { initialDocument: { ...base, status: 'confirmed' }, user, onBack() {} });
  assert.equal(done.visible().some(n => n.type === 'button' && /^ลบรูปหน้า/.test(done.text(n))), false);
  done.unmount();
});
