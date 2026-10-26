import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';

// Owner 2026-10-26 "ยังไม่เสร็จ เรากดยกเลิกไม่ได้หรอ": an unfinished receipt can be cancelled from the list and from
// inside the receipt, always after one confirmation. Confirmed receipts have no such button.
const user = { id: 1, name: 'ผู้รับ', role: 'staff', branch_id: 1, department_id: 1 };
const draft = { id: 312, status: 'draft', kind: 'bill', supplier_name_text: 'พิสมัยปลาสด ตลาดเมืองใหม่', total: '2280', branch_id: 1, department_id: 1 };
const done = { ...draft, id: 300, status: 'confirmed', supplier_name_text: 'ไทยน้ำทิพย์' };

test('staff home: ยกเลิก on an unfinished receipt asks first, then cancels and reloads', async () => {
  let lists = 0;
  const h = await harness('Receiving', {}, { homeMode: async () => ({ mode: 'new_first' }), list: async () => { lists++; return [draft, done]; } }, { isAdmin: false, user });
  const cancels = h.visible().filter(n => n.type === 'button' && /^ยกเลิกใบรับ #/.test(n.props['aria-label'] || '')).map(n => n.props['aria-label']);
  assert.deepEqual(cancels, ['ยกเลิกใบรับ #312'], 'only the unfinished receipt');
  await h.click('ยกเลิกใบรับ #312');
  assert.match(h.text(h.visible()), /ยกเลิกใบรับ #312\?/);
  await h.click('ไม่ยกเลิก');
  assert.equal(h.calls.some(c => c[0] === 'void'), false);
  const before = lists;
  await h.click('ยกเลิกใบรับ #312'); await h.click('ยกเลิกใบรับ');
  assert.deepEqual(h.calls.filter(c => c[0] === 'void').map(c => [c[1], c[2]]), [[312, 'ยกเลิกก่อนรับ']]);
  assert.ok(lists > before, 'the list reloads');
  h.unmount();
});

test('a refused cancel keeps the sheet open with the reason', async () => {
  const h = await harness('Receiving', {}, { homeMode: async () => ({ mode: 'new_first' }), list: async () => [draft],
    void: async () => { throw { response: { status: 403, data: { message: 'แก้ข้ามวันให้ฝ่ายบัญชีหรือแอดมิน' } } }; } }, { isAdmin: false, user });
  await h.click('ยกเลิกใบรับ #312'); await h.click('ยกเลิกใบรับ');
  assert.match(h.text(h.visible()), /ยกเลิกใบรับ #312\?/);
  assert.ok(h.visible().some(n => n.props.role === 'alert'));
  h.unmount();
});

test('inside an unfinished receipt: เพิ่มเติม → ยกเลิกใบรับนี้ → confirm cancels and leaves', async () => {
  let backs = 0;
  const doc = { id: 312, client_uuid: 'c', status: 'draft', kind: 'bill', branch_id: 1, department_id: 1, supplier_name_text: 'พิสมัยปลาสด', images: [], warnings: [], ocr: { status: 'none' }, counted_complete_at: null,
    lines: [{ id: 1, line_no: 1, product_id: 60, product_name: 'ปลาทับทิม #ตัว', unit_text: 'ตัว', quantity_received: '0' }] };
  const h = await harness('DocumentEditor', { initialDocument: doc, user, onBack() { backs++; } });
  await h.click('ยกเลิกใบรับนี้');
  await h.click('ยกเลิกใบรับ');
  assert.deepEqual(h.calls.filter(c => c[0] === 'void').map(c => [c[1], c[2]]), [[312, 'ยกเลิกก่อนรับ']]);
  assert.equal(backs, 1);
  h.unmount();
});
