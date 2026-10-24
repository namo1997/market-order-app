import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';
const user = { id: 12, name: 'ผู้รับ', role: 'user', branch_id: 1, department_id: 10 };
const supplier = { supplier_key: 'sm:1', name: 'ร้านน้ำแข็ง vic', code: 'SYN-VIC', supplier_master_id: 1, product_group_id: null };
const waitSearch = async h => { await new Promise(r => setTimeout(r, 280)); await h.settle(); };
const submit = async h => { await h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await h.settle(); };
const button = (h, label) => h.find(n => n.type === 'button' && h.text(n) === label);
const doc = patch => ({ id: 5, client_uuid: 'round-m', supplier_master_id: 1, supplier_name_text: supplier.name, branch_id: 1, department_id: 10,
  delivery_date: '2026-10-20', status: 'draft', kind: 'manual_receipt', scope: 'department', counted_complete_at: null,
  lines: [], images: [], warnings: [], ocr: { status: 'locked' }, ...patch });

test('M1 unlinked receipt searches scoped supplier master and submits canonical identity; typing/changing selection cannot keep old ID', async () => {
  const queries = [];
  const h = await harness('CreateDocument', { user, date: '2026-10-20', onClose() {}, onCreated() {} }, { suppliers: async q => { queries.push(q); return [supplier]; } });
  assert.equal(button(h, 'สร้างใบรับ').props.disabled, true);
  await h.select('ผู้ส่งของ', 'vic'); await waitSearch(h);
  assert.equal(queries.at(-1).q, 'vic'); assert.equal(queries.at(-1).branch_id, 1); assert.equal(queries.at(-1).department_id, 10);
  await h.click('ร้านน้ำแข็ง vic');
  assert.equal(button(h, 'สร้างใบรับ').props.disabled, false);
  await h.select('ผู้ส่งของ', 'ร้านอื่น'); assert.equal(button(h, 'สร้างใบรับ').props.disabled, true);
  await submit(h); assert.equal(h.calls.some(c => c[0] === 'create'), false);
  await waitSearch(h); await h.click('ร้านน้ำแข็ง vic'); await submit(h);
  const body = h.calls.find(c => c[0] === 'create')[1]; assert.equal(body.supplier_master_id, 1); assert.equal(body.supplier_name_text, supplier.name);
  assert.equal(body.order_item_ids.length, 0); assert.equal('product_group_id' in body, false);
});

// Owner 2026-10-24 "ตัวหนังสือต้องน้อยๆ": shop cards show the name only, choosing one leaves just "เปลี่ยนร้าน", no "วิธีใช้" fold.
test('supplier sheet shows shop names only; the code still finds the shop', async () => {
  const queries = [];
  const h = await harness('CreateDocument', { user, date: '2026-10-20', onClose() {}, onCreated() {} }, { suppliers: async q => { queries.push(q); return [supplier]; } });
  await h.select('ผู้ส่งของ', 'SYN-VIC'); await waitSearch(h);
  assert.equal(queries.at(-1).q, 'SYN-VIC', 'the code is still sent to the shop search');
  assert.doesNotMatch(h.text(h.visible()), /ทะเบียนซัพ ·|· ทะเบียนซัพ|กลุ่มสินค้าเดิม|วิธีใช้|คำขอค้าง/);
  assert.equal(h.text(h.find(n => n.type === 'button' && n.props.className === 'rc-option-card')), 'ร้านน้ำแข็ง vic');
  await h.click('ร้านน้ำแข็ง vic');
  assert.doesNotMatch(h.text(h.visible()), /เลือกร้านจากทะเบียนแล้ว/);
  assert.ok(button(h, 'เปลี่ยนร้าน'));
  h.unmount();
});

test('M1 unmatched new supplier requires explicit use-name action, is labeled for accounting, never creates a master', async () => {
  const h = await harness('CreateDocument', { user, date: '2026-10-20', onClose() {}, onCreated() {} });
  await h.select('ผู้ส่งของ', 'ร้านใหม่ทดสอบ'); await waitSearch(h);
  assert.match(h.text(h.all()), /ไม่พบร้านในทะเบียน/);
  assert.equal(button(h, 'สร้างใบรับ').props.disabled, true);
  await h.click('ใช้ชื่อ “ร้านใหม่ทดสอบ” · ร้านใหม่ รอบัญชีตรวจ');
  assert.match(h.text(h.all()), /ยังไม่เพิ่มเข้าทะเบียนซัพ/); await submit(h);
  const body = h.calls.find(c => c[0] === 'create')[1]; assert.equal(body.supplier_name_text, 'ร้านใหม่ทดสอบ');
  assert.equal('supplier_master_id' in body, false); assert.equal('product_group_id' in body, false);
});

test('M1 search failure offers retry and cannot silently create an unverified supplier', async () => {
  let attempts = 0;
  const h = await harness('CreateDocument', { user, date: '2026-10-20', onClose() {}, onCreated() {} }, { suppliers: async () => { if (!attempts++) throw Error('offline'); return [supplier]; } });
  await h.select('ผู้ส่งของ', 'vic'); await waitSearch(h);
  assert.match(h.text(h.all()), /ค้นหาร้านไม่ได้/); assert.equal(button(h, 'สร้างใบรับ').props.disabled, true);
  await h.click('ค้นหาร้านอีกครั้ง'); await waitSearch(h); assert.ok(button(h, 'ร้านน้ำแข็ง vic'), 'the retry lists the shop');
});

test('M2/M3 empty receipt has correct context and disabled count; quick add is identity-only, blank until counted, and duplicate focuses original', async () => {
  const h = await harness('DocumentEditor', { initialDocument: doc(), user, onBack() {} }, { supplierProducts: async key => { assert.equal(key, 'sm:1'); return [{ id: 7, name: 'น้ำแข็งหลอดใหญ่', unit_id: 2, unit_name: 'ถุง', quantity_billed: 999, unit_price: 35 }]; } });
  // Search-ux: the three stacked helper lines are gone; the footer already says there is nothing to count.
  assert.doesNotMatch(h.text(h.all()), /ยังไม่มีสินค้า · กด เพิ่มสินค้าที่มาส่ง|แตะเพิ่มแล้วนับเอง|ยังไม่มีประวัติสินค้า/); assert.match(h.text(h.all()), /ยังไม่มีสินค้าให้นับ/);
  assert.doesNotMatch(h.text(h.all()), /กรุณากลับคิวแล้วเลือกใบสั่ง|เทียบใบสั่งก่อนเซ็นรับ|นับครบทุกสินค้าแล้ว|999|35/);
  assert.equal(button(h, 'ยืนยันการนับ').props.disabled, true);
  await h.click('เพิ่มสินค้าที่มาส่ง'); assert.match(h.text(h.visible()), /ค้นหาหรือเลือกจากสินค้าที่ร้านนี้เคยส่ง/); assert.doesNotMatch(h.text(h.visible()), /999|35\b/);
  await h.click('น้ำแข็งหลอดใหญ่ถุง');
  const field = () => h.find(n => n.props.id === 'count--1'); assert.equal(field().props.value, '');
  assert.equal(h.focused.at(-1), 'count--1');
  assert.equal(button(h, 'ยืนยันการนับ').props.disabled, true);
  await h.click('เพิ่มสินค้าที่มาส่ง'); await h.click('น้ำแข็งหลอดใหญ่ถุงมีในใบแล้ว · ไปช่องนับเดิม'); assert.equal(h.focused.at(-1), 'count--1');
  assert.deepEqual(h.focused.filter(id => id.startsWith('count-')), ['count--1', 'count--1']);
  assert.equal(h.all().filter(n => n.props.id === 'count--1').length, 1);
  field().props.onChange({ target: { value: '0.3' } }); await h.settle(); assert.equal(button(h, 'ยืนยันการนับ').props.disabled, false);
});

test('M2 suggestions error/empty state permits manual search; no automatic count or OCR', async () => {
  for (const fails of [true, false]) {
    const h = await harness('DocumentEditor', { initialDocument: doc(), user, onBack() {} }, { supplierProducts: async () => { if (fails) throw Error('offline'); return []; } });
    await h.click('เพิ่มสินค้าที่มาส่ง'); assert.ok(h.find(n => n.props.id === 'blind-add-product'));
    if (fails) { assert.match(h.text(h.visible()), /โหลดสินค้าที่เคยส่งไม่ได้/); await h.click('โหลดสินค้าที่เคยส่งอีกครั้ง'); }
    assert.ok(h.visible().some(n => n.props?.type === 'search'), 'search field stays usable'); assert.doesNotMatch(h.text(h.visible()), /ยังไม่มีประวัติสินค้า|ค้นหาสินค้าที่มาส่ง/);
    assert.equal(h.calls.some(c => ['count', 'ocr'].includes(c[0])), false);
  }
});

test('M4 native date control retains ISO editing and renders Thai Buddhist date independently of device locale', async () => {
  const changes = [];
  const h = await harness('ThaiDateField', { value: '2026-10-20', onChange: value => changes.push(value) });
  assert.match(h.text(h.all()), /20 ต.ค. 2569/); assert.doesNotMatch(h.text(h.all()), /10\/20\/2026/);
  const input = h.find(n => n.type === 'input'); assert.equal(input.props.type, 'date'); assert.equal(input.props.value, '2026-10-20');
  input.props.onChange({ target: { value: '2026-10-21' } }); assert.deepEqual(changes, ['2026-10-21']);
});

test('M5 existing and pending drafts use a continuation arrow, new receipts retain plus', async () => {
  const props = { user, group: { supplier_key: 'pg:3', supplier_name: 'ร้านไก่', items: [] }, date: '2026-10-20', onClose() {}, onCreated() {} };
  for (const pending of [false, true]) {
    const browser = pending ? { localStorage: { getItem: () => JSON.stringify({ client_uuid: 'pending-m', kind: 'bill', delivery_date: props.date, supplier_name_text: 'ร้านไก่', product_group_id: 3 }), setItem() {}, removeItem() {} } } : {};
    const h = await harness('CreateDocument', { ...props, existingDocument: pending ? null : doc() }, {}, {}, browser);
    const resume = button(h, pending ? 'ทำต่อใบเดิม' : 'ทำต่อใบ #5');
    assert.match(resume.props.className, /rc-resume-primary/);
    assert.ok(h.all(resume).some(n => n.type === 'use' && n.props.href.endsWith('#back')));
    assert.equal(h.all(resume).some(n => n.type === 'use' && n.props.href.endsWith('#plus')), false);
  }
  const h = await harness('CreateDocument', props);
  assert.ok(h.all(button(h, 'สร้างใบรับ')).some(n => n.type === 'use' && n.props.href.endsWith('#plus')));
});

test('M1 pending create retry retains selected master and UUID after uncertain response; no new identity can replace it', async () => {
  const bodies = [], opened = [];
  const h = await harness('CreateDocument', { user, date: '2026-10-20', onClose() {}, onCreated: value => opened.push(value) }, {
    suppliers: async () => [supplier], create: async body => {
      bodies.push(body); if (bodies.length === 1) throw { request: {} };
      return { ...body, id: 7 };
    },
  });
  await h.select('ผู้ส่งของ', 'vic'); await waitSearch(h); await h.click('ร้านน้ำแข็ง vic');
  await submit(h); assert.match(h.text(h.all()), /ใบรับที่ยังส่งไม่สำเร็จ/);
  assert.ok(h.find(n => n.type === 'fieldset').props.disabled);
  await submit(h); assert.equal(bodies.length, 2); assert.equal(bodies[0].client_uuid, bodies[1].client_uuid);
  assert.equal(bodies[1].supplier_master_id, 1); assert.equal(bodies[1].supplier_name_text, supplier.name); assert.equal(opened.length, 1);
});
