import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { harness } from './receiving-harness.mjs';

// Owner 2026-10-26 "กำลังอ่าน ขอเป็นอนิเมชั่นเล็กๆ": while the early read runs, the count step shows a small animated
// reading indicator (tiny bill + scan line + dots) with one short line of text, and the static status comes back after.
const user = { id: 1, name: 'ผู้รับ', role: 'staff', branch_id: 1, department_id: 1 };
const doc = (early_read) => ({ id: 5, client_uuid: 'c-5', status: 'draft', kind: 'bill', branch_id: 1, department_id: 1, supplier_name_text: 'ร้าน', images: [{ id: 1 }], early_read, ocr: { status: 'locked' }, counted_complete_at: null, warnings: [],
  lines: [{ id: 1, line_no: 1, product_id: 7, product_name: 'ปลาทับทิม', unit_text: 'ตัว', order_item_id: null, quantity_received: '0' }] });

test('early read in flight shows the small reading animation, not a paragraph', async () => {
  const h = await harness('DocumentEditor', { initialDocument: doc('pending'), user, onBack() {}, scanFirst: true });
  const mini = h.find(n => n.props.className === 'ra-reading-mini');
  assert.equal(mini.props['aria-busy'], 'true'); assert.equal(mini.props.role, 'status');
  assert.match(h.text(mini), /^กำลังอ่านบิล$/);
  assert.ok(h.all(mini).some(n => n.props.className === 'ra-reading-mini-scan'), 'scan line');
  assert.equal(h.all(mini).filter(n => n.type === 'i').length, 3, 'three dots');
  assert.doesNotMatch(h.text(h.visible()), /กำลังอ่านรายการจากบิล/);
  h.unmount();
});

test('after the read the animation goes; accounting gets the static line, staff nothing (rows show it); CSS keeps the animation still under reduced motion', async () => {
  const h = await harness('DocumentEditor', { initialDocument: doc('done'), user, onBack() {}, scanFirst: true });
  assert.equal(h.visible().some(n => n.props.className === 'ra-reading-mini'), false);
  assert.doesNotMatch(h.text(h.visible()), /อ่านบิลแล้ว/, 'staff: owner 2026-10-28 "ตัวหนังสือมันเยอะเกิน"');
  h.unmount();
  const reviewer = await harness('DocumentEditor', { initialDocument: doc('done'), user: { ...user, role: 'accounting' }, onBack() {}, scanFirst: true });
  assert.match(reviewer.text(reviewer.visible()), /อ่านบิลแล้ว/);
  reviewer.unmount();
  const css = await readFile(new URL('../src/pages/receiving/review-a.css', import.meta.url), 'utf8');
  assert.match(css, /@keyframes ra-mini-scan/);
  assert.match(css, /\.solao\[data-motion='reduce'\] \.ra-reading-mini-scan[^{]*\{ animation: none; \}/);
});
