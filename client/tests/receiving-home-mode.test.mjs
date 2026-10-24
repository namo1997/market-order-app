import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';

// Owner 2026-10-23: version one hides the order queue from staff; they always start with "รับของใหม่".
// The mode is a system setting the administrator switches in the options sheet.
const text = h => h.text(h.visible());
const primary = h => h.find(n => n.type === 'button' && n.props.className?.includes('sg-primary'));
const todayDoc = { id: 31, status: 'draft', kind: 'bill', supplier_name_text: 'บจก.ไทยน้ำทิพย์ คอร์เปอเรชั่น จำกัด (มหาชัน)', total: null, delivery_date: '2026-10-23' };

test('staff in new_first mode see no queue cards, one start button and today\'s receipts', async () => {
  const h = await harness('Receiving', {}, { homeMode: async () => ({ mode: 'new_first' }), list: async () => [todayDoc] }, { isAdmin: false, user: { id: 2, role: 'staff', branch_id: 1, department_id: 1, name: 'พนักงาน' } });
  assert.doesNotMatch(text(h), /รอรับ \d+ ร้าน|เลือกร้าน ตลาด/);
  assert.equal(h.visible().some(n => n.props.className === 'rc-queue-scan'), false, 'no per-shop scan buttons');
  assert.equal(h.visible().some(n => n.props['aria-label'] === 'รายการรับสินค้า'), false, 'no รอรับ/เอกสาร tabs');
  assert.match(text(h), /ใบรับวันนี้ · 1 ใบ/); assert.match(text(h), /ไทยน้ำทิพย์ คอร์เปอเรชั่น/); assert.match(text(h), /ยังไม่เสร็จ/);
  assert.equal(h.text(primary(h)), 'รับของใหม่');
  assert.equal(h.visible().filter(n => n.type === 'button' && h.text(n).includes('รับของใหม่')).length, 1, 'one start button: the bottom bar');
  await primary(h).props.onClick(); await h.settle();
  assert.ok(h.visible().some(n => n.props.id === 'rc-create'), 'the shop picker sheet opens');
  h.unmount();
});

test('queue mode and administrators keep the queue; the administrator switch saves the mode', async () => {
  const staff = await harness('Receiving', {}, { homeMode: async () => ({ mode: 'queue' }) }, { isAdmin: false, user: { id: 2, role: 'staff', branch_id: 1, department_id: 1, name: 'พนักงาน' } });
  assert.match(text(staff), /รอรับ 1 ร้าน/); assert.equal(text(staff).includes('รับของใหม่'), false); staff.unmount();
  const admin = await harness('Receiving', {}, { homeMode: async () => ({ mode: 'new_first' }) }, { isAdmin: true });
  assert.match(text(admin), /รอรับ 1 ร้าน/, 'administrators still see the queue');
  await admin.click('ตัวเลือก');
  await admin.radio('queue');
  assert.deepEqual(admin.calls.filter(c => c[0] === 'setHomeMode'), [['setHomeMode', 'queue']]);
  assert.match(text(admin), /บันทึกแล้ว/);
  admin.unmount();
});

test('a failed mode lookup keeps the queue view', async () => {
  const h = await harness('Receiving', {}, { homeMode: async () => { throw new Error('offline'); } }, { isAdmin: false, user: { id: 2, role: 'staff', branch_id: 1, department_id: 1, name: 'พนักงาน' } });
  assert.match(text(h), /รอรับ 1 ร้าน/); h.unmount();
});

// Owner 2026-10-24 "ตัวหนังสือต้องน้อยๆ": no how-to card, a two-word empty line, and a shorter options sheet.
test('new_first home and options keep only the controls', async () => {
  const staffUser = { id: 2, role: 'staff', branch_id: 1, department_id: 1, name: 'แผนกครัว' };
  const h = await harness('Receiving', {}, { homeMode: async () => ({ mode: 'new_first' }), list: async () => [] }, { isAdmin: false, user: staffUser });
  assert.doesNotMatch(text(h), /ของมาส่ง|เริ่มได้ที่ปุ่ม/);
  assert.equal(h.visible().some(n => n.props.className === 'rc-home-hint'), false);
  assert.ok(h.visible().some(n => n.type === 'p' && h.text(n) === 'ยังไม่มีใบรับ'));
  await h.click('ตัวเลือก');
  assert.ok(h.find(n => n.type === 'button' && h.text(n) === 'ตกลง'));
  assert.equal(h.visible().some(n => n.type === 'button' && h.text(n) === 'ใช้ข้อมูล'), false);
  assert.equal(h.visible().some(n => n.type === 'button' && h.text(n) === 'รับสินค้าเพิ่ม (ไม่อ้างอิงใบสั่ง)'), false, 'the bottom bar already starts a receipt');
  assert.equal(h.visible().some(n => n.type === 'p' && h.text(n) === 'แผนกครัว'), false, 'no loose account-name line');
  await h.click('ตกลง');
  h.unmount();
  const queue = await harness('Receiving', {}, { homeMode: async () => ({ mode: 'queue' }) }, { isAdmin: false, user: staffUser });
  await queue.click('ตัวเลือก');
  assert.ok(queue.find(n => n.type === 'button' && queue.text(n) === 'รับสินค้าเพิ่ม (ไม่อ้างอิงใบสั่ง)'), 'queue mode keeps the no-order start');
  queue.unmount();
});
