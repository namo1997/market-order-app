import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';

const doc = () => ({ id: 5, status: 'draft', kind: 'bill', delivery_date: '2026-10-15', receiver_user_id: 1, receiver_name: 'ผู้รับ', has_receiver_signature: false,
  images: [], ocr: { status: 'none' }, warnings: [], total: '20', discount: '0', vat: '0', lines: [{ id: 3, product_id: 7, product_name: 'ผัก', order_item_id: 42, unit_text: 'กก.', quantity_received: '2', unit_price: '10' }] });
const user = { id: 1, role: 'admin' };

test('UI: overview and create use one primary/two secondary actions; retry keeps client UUID', async () => {
  let attempts = 0;
  const h = await harness('Receiving', {}, { create: async (body) => { h.calls.push(['create', JSON.parse(JSON.stringify(body))]); attempts++; throw { request: {} }; } });
  h.budget();
  await h.click('ตัวเลือก'); h.budget(); await h.click('ใช้ข้อมูล');
  await h.click('ถ่ายบิลร้านนี้'); h.budget();
  const form = h.find((node) => node.type === 'form');
  await form.props.onSubmit({ preventDefault() {} }); await h.settle(); h.budget();
  await form.props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.equal(attempts, 2); assert.deepEqual(h.calls[0][1], h.calls[1][1]); assert.equal(h.calls[0][1].client_uuid, 'stable-client-uuid');
});

test('UI: photo OCR -> edit -> receiver signature -> confirm -> void preserves API flow and action budget', async () => {
  const document = doc(); document.images = [{ id: 1, page_no: 1 }];
  const h = await harness('DocumentEditor', { initialDocument: document, user, onBack() {}, onChanged() {} }, { image: async () => new Blob(['image']) });
  h.budget(); await h.click('อ่านบิล'); h.budget();
  await h.select('รับจริง', '1.5'); await h.click('บันทึกรายการ');
  assert.ok(!h.visible().some(node => node.props.className === 'rc-compact-item'));
  await h.click('ทั้งหมด');
  assert.ok(h.all().some((node) => h.text(node) === 'ขาด 0.5 กก.'));
  await h.click('ไปเซ็น'); h.budget();
  const canvas = h.find((node) => node.type === 'canvas');
  canvas.props.onPointerDown({ button: 0, pointerType: 'mouse', pointerId: 1, clientX: 50, clientY: 50, preventDefault() {} });
  canvas.props.onPointerUp(); await h.settle(); h.budget();
  await h.click('บันทึกเซ็น'); h.budget(); await h.click('ตรวจรับ'); h.budget();
  await h.click('ยืนยัน'); h.budget();
  assert.deepEqual(h.calls.filter((call) => call[0] === 'confirm'), [['confirm', 5, false]]);
  assert.equal(h.calls.find((call) => call[0] === 'update')[2].lines[0].quantity_received, '1.50');
  assert.equal(h.calls.find((call) => call[0] === 'signature')[2], 'receiver');
  await h.click('ดูเอกสาร'); await h.click('เพิ่มเติม'); h.budget(); await h.select('ทำรายการ', 'void'); await h.click('เลือก'); h.budget();
  await h.select('เหตุผล', 'ส่งผิด'); await h.click('ยกเลิกใบรับ'); h.budget();
  assert.deepEqual(h.calls.filter((call) => call[0] === 'void'), [['void', 5, 'ส่งผิด']]);
});

test('UI: manual additions, header editing, deletion and courier signature remain reachable', async () => {
  const h = await harness('DocumentEditor', { initialDocument: doc(), user, onBack() {}, onChanged() {} });
  for (const action of ['header', 'add', 'delete', 'courier']) {
    await h.click('เพิ่มเติม'); await h.select('ทำรายการ', action); await h.click('เลือก'); h.budget();
    if (action === 'add') await h.click('ปิด');
    if (action === 'header') { await h.select('เลขบิล', 'B-7'); await h.click('ใช้ข้อมูล'); }
    if (action === 'delete') await h.click('ลบรายการ');
    if (action === 'courier') {
      await h.select('ชื่อ', 'ผู้ส่ง');
      h.find((node) => node.type === 'canvas').props.onPointerDown({ button: 0, pointerType: 'mouse', pointerId: 1, clientX: 20, clientY: 20, preventDefault() {} });
      await h.settle(); await h.click('บันทึกเซ็น');
      assert.equal(h.calls.find((call) => call[0] === 'signature')[2], 'courier');
      await h.click('ปิด');
    }
  }
  assert.ok(h.calls.find((call) => call[0] === 'update')[2].doc_ref === 'B-7');
});

test('UI: ambiguous confirm switches to a single recovery action and never retries the write', async () => {
  const document = doc(); document.has_receiver_signature = true;
  const h = await harness('DocumentEditor', { initialDocument: document, user, onBack() {}, onChanged() {} }, { confirm: async () => { h.calls.push(['confirm']); throw { request: {} }; } });
  await h.radio('sign'); await h.click('ตรวจรับ'); await h.click('ยืนยัน'); h.budget();
  assert.equal(h.calls.filter((call) => call[0] === 'confirm').length, 1);
  await h.click('ตรวจผลล่าสุด'); h.budget();
});

test('UI: camera selection and failed upload retain identical page number on retry before OCR', async () => {
  let uploads = 0;
  const h = await harness('DocumentEditor', { initialDocument: doc(), user, onBack() {}, onChanged() {} }, {
    uploadImage: async (...args) => { h.calls.push(['upload', ...args]); if (++uploads === 1) throw { request: {} }; return { image_id: 9 }; },
    image: async () => new Blob(['mock']),
  });
  h.budget(); await h.click('ถ่ายบิล');
  const input = h.find((node) => node.type === 'input' && node.props.type === 'file');
  await input.props.onChange({ target: { files: [{ size: 20, type: 'image/jpeg', name: 'bill.jpg', slice: () => new Blob([new Uint8Array([255, 216, 255])]) }], value: 'bill.jpg' } });
  await h.settle(); h.budget(); await h.click('ส่งอ่านบิล'); h.budget(); await h.click('ส่งอ่านบิล'); h.budget();
  const sent = h.calls.filter((call) => call[0] === 'upload');
  assert.equal(sent.length, 2); assert.deepEqual(sent[0], sent[1]); assert.equal(sent[0][2], 1);
  assert.equal(h.calls.filter((call) => call[0] === 'ocr').length, 1); h.budget();
});

test('UI: corrected quantities clear stale quantity warnings and invalid input turns red', async () => {
  const document = doc(); document.warnings = [{ code: 'QTY_SHORT', line_no: 1 }];
  const h = await harness('DocumentEditor', { initialDocument: document, user, onBack() {}, onChanged() {} });
  await h.radio('lines'); await h.click('ทั้งหมด');
  assert.ok(h.all().some((node) => node.props['data-status'] === 'ok' && h.text(node) === 'ครบ'));
  await h.select('รับจริง', '-1');
  assert.ok(h.all().some((node) => node.props['data-status'] === 'error' && h.text(node) === 'ตรวจตัวเลข'));
  await h.select('รับจริง', '2');
  assert.ok(h.all().some((node) => node.props['data-status'] === 'ok' && h.text(node) === 'ครบ'));
  h.budget();
});


test('UI r3: closing bill/courier sheets discards edits; apply alone adopts bill fields', async () => {
  const h = await harness('DocumentEditor', { initialDocument: { ...doc(), doc_ref: 'ORIGINAL', courier_name: 'เดิม' }, user, onBack() {}, onChanged() {} });
  const open = async (action) => { await h.click('เพิ่มเติม'); await h.select('ทำรายการ', action); await h.click('เลือก'); };
  await open('header'); await h.select('เลขบิล', 'DISCARD'); await h.click('ปิด');
  await open('header');
  assert.ok(h.all().some(node => node.type === 'input' && node.props.value === 'ORIGINAL'));
  await h.select('เลขบิล', 'SAVED'); await h.click('ใช้ข้อมูล');
  await open('header'); assert.ok(h.all().some(node => node.type === 'input' && node.props.value === 'SAVED')); await h.click('ปิด');
  await open('courier'); await h.select('ชื่อ', 'ทิ้ง'); await h.click('ปิด');
  await open('courier'); assert.ok(h.all().some(node => node.type === 'input' && node.props.value === 'เดิม'));
  assert.equal(h.calls.filter(call => call[0] === 'update' || call[0] === 'signature').length, 0);
});

test('UI r3: overview options apply only on save; close discards date', async () => {
  const h = await harness('Receiving');
  await h.click('ตัวเลือก');
  const original = h.find(node => node.type === 'input' && node.props.type === 'date').props.value;
  await h.select('วันที่', '2026-01-01'); await h.click('ปิด'); await h.click('ตัวเลือก');
  assert.equal(h.find(node => node.type === 'input' && node.props.type === 'date').props.value, original);
  await h.select('วันที่', '2026-01-01'); await h.click('ใช้ข้อมูล'); await h.click('ตัวเลือก');
  assert.equal(h.find(node => node.type === 'input' && node.props.type === 'date').props.value, '2026-01-01');
});


test('UI r3: motion switch defaults to OS, tracks OS changes, then preserves explicit user override', async () => {
  const media = { matches: true, addEventListener(_, callback) { this.update = callback; }, removeEventListener() {} };
  const h = await harness('Receiving', {}, {}, {}, { matchMedia: () => media });
  const root = () => h.all().find(node => node.props.className?.includes('rc-app'));
  await h.click('ตัวเลือก');
  const toggle = () => h.find(node => node.type === 'input' && node.props.role === 'switch');
  assert.equal(root().props['data-motion'], 'reduce');
  media.matches = false; media.update(); await h.settle(); assert.equal(root().props['data-motion'], 'full');
  toggle().props.onChange({ target: { checked: true } }); await h.settle();
  assert.equal(root().props['data-motion'], 'reduce');
  media.matches = false; media.update(); await h.settle(); assert.equal(root().props['data-motion'], 'reduce');
});


test('UI r3: confirm and void keep saving visible and locked until the controlled 400ms gate', async () => {
  for (const action of ['confirm', 'void']) {
    let release;
    const changed = [], dirty = [];
    const document = { ...doc(), status: action === 'void' ? 'confirmed' : 'draft', has_receiver_signature: true };
    const h = await harness('DocumentEditor', { initialDocument: document, user, onBack() {}, onChanged: next => changed.push(next), onDirtyChange: value => dirty.push(value) }, {}, {}, {}, {
      setTimeout: (done, ms) => { assert.equal(ms, 400); release = done; return 1; }, clearTimeout() {},
    });
    if (action === 'confirm') { await h.radio('sign'); await h.click('ตรวจรับ'); }
    else { await h.click('เพิ่มเติม'); await h.select('ทำรายการ', 'void'); await h.click('เลือก'); await h.select('เหตุผล', 'ตัวอย่าง'); }
    const button = h.find(node => node.type === 'button' && h.text(node) === (action === 'confirm' ? 'ยืนยัน' : 'ยกเลิกใบรับ'));
    const pending = button.props.onClick(); await h.settle();
    assert.ok(h.find(node => node.type === 'button' && h.text(node) === 'กำลังบันทึก…').props.disabled);
    assert.equal(changed.length, 0);
    assert.equal(dirty.at(-1), true);
    assert.ok(h.events.get('beforeunload').size > 0);
    assert.equal(h.calls.filter(call => call[0] === action).length, 1);
    release(); await pending; await h.settle();
    assert.equal(changed.length, 1);
    assert.equal(dirty.at(-1), false);
    assert.equal(h.events.get('beforeunload').size, 0);
    assert.equal(changed[0].status, action === 'confirm' ? 'confirmed' : 'void');
  }
});
