import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';

const user = { id: 1, name: 'ผู้รับทดสอบ', role: 'receiver' };
const line = (id, manual = false, quantity = '1') => ({ id, line_no: id, product_id: id, order_item_id: id,
  product_name: `สินค้า ${id}`, unit_text: 'กก.', quantity_received: quantity, quantity_billed: '1', unit_price: '10', amount: '10',
  match: { source: manual ? 'manual' : 'order', confidence: .9 } });
const document = (values = {}) => ({ id: 5, status: 'draft', kind: 'bill', delivery_date: '2026-10-16',
  receiver_name: user.name, total: '30', discount: '0', vat: '0', has_receiver_signature: false,
  images: [], lines: [line(1, true), line(2, true), line(3, true)], ocr: { status: 'done' }, warnings: [], ...values });
const editor = (doc = document(), api = {}, props = {}) => harness('DocumentEditor', {
  initialDocument: doc, user, onBack() {}, onChanged() {}, ...props,
}, { expected: async () => [{ items: Array.from({ length: 10 }, (_, i) => ({ order_item_id: i + 1, product_id: i + 1,
  quantity_ordered: '1', received_quantity: '0', unit_name: 'กก.' })) }], ...api }, {}, {}, {
  setTimeout: done => { done(); return 1; }, clearTimeout() {},
});
const primary = h => h.find(node => node.type === 'button' && node.props.className?.includes('sg-primary'));
const art = (h, state) => h.visible().some(node => node.props['data-illustration'] === state);
const preview = h => h.find(node => node.type === 'img' && node.props.className === 'rc-saved-signature');
const noCanvas = h => assert.equal(h.visible().some(node => node.type === 'canvas'), false);
const ink = async h => {
  const pad = h.find(node => node.type === 'canvas');
  pad.props.onPointerDown({ button: 0, pointerType: 'mouse', pointerId: 1, clientX: 40, clientY: 40, preventDefault() {} });
  pad.props.onPointerUp(); await h.settle();
};
const open = async (h, action) => { await h.click('รายละเอียด'); await h.select('ทำรายการ', action); await h.click('เลือก'); };
const rowIndices = h => h.visible().filter(node => node.props.className === 'rc-compact-item').map(node => node.props['data-line-index']);

test('device r4: acknowledged receiver image equals the submitted image; tabs retain proof; redraw requires a new save', async () => {
  const dirty = [];
  const h = await editor(document(), {}, { onDirtyChange: value => dirty.push(value) });
  await h.radio('sign'); assert.equal(primary(h).props.disabled, true);
  await ink(h); await h.click('บันทึกเซ็น');
  const submitted = h.calls.find(call => call[0] === 'signature')[3];
  assert.equal(preview(h).props.src, submitted); noCanvas(h);
  assert.ok(h.text(h.visible()).includes('เซ็นแล้ว')); assert.equal(dirty.at(-1), false); h.budget();
  await h.radio('lines'); await h.radio('sign'); assert.equal(preview(h).props.src, submitted);
  await h.click('ล้างแล้วเซ็นใหม่');
  assert.equal(h.text(primary(h)), 'บันทึกเซ็น'); assert.equal(primary(h).props.disabled, true);
  assert.ok(h.text(h.visible()).includes('เซ็นใหม่ยังไม่บันทึก'));
  assert.equal(h.calls.filter(call => call[0] === 'signature').length, 1);
  await ink(h); assert.equal(dirty.at(-1), true);
  await h.click('บันทึกเซ็น'); noCanvas(h); assert.equal(preview(h).props.src, submitted);
  assert.equal(h.calls.filter(call => call[0] === 'signature').length, 2); h.unmount();
});

test('device r4: courier signature has its own acknowledged image across closing and reopening the sheet', async () => {
  const h = await editor(); await open(h, 'courier'); await h.select('ชื่อ', 'ผู้ส่งทดสอบ');
  await ink(h); await h.click('บันทึกเซ็น');
  const sent = h.calls.find(call => call[0] === 'signature');
  assert.equal(sent[2], 'courier'); assert.equal(sent[4], 'ผู้ส่งทดสอบ');
  assert.equal(preview(h).props.src, sent[3]); noCanvas(h); h.budget();
  await h.click('ปิด'); await open(h, 'courier'); assert.equal(preview(h).props.src, sent[3]);
  await h.click('ปิด'); await h.radio('sign');
  assert.ok(h.visible().some(node => node.type === 'canvas')); assert.equal(h.text(primary(h)), 'บันทึกเซ็น'); h.unmount();
});

test('device r4: reopened saved flag fetches a protected image, never an empty signing canvas', async () => {
  const h = await editor(document({ has_receiver_signature: true })); await h.radio('sign'); noCanvas(h);
  assert.match(preview(h).props.src, /^blob:/);
  assert.equal(h.text(primary(h)), 'ตรวจรับ');
  await h.click('ล้างแล้วเซ็นใหม่'); assert.ok(h.visible().some(node => node.type === 'canvas'));
  assert.equal(primary(h).props.disabled, true); assert.equal(h.calls.length, 0); h.unmount();
});

test('device r4: image decode failure has an explicit retry and never reverts to a blank canvas', async () => {
  const h = await editor(); await h.radio('sign'); await ink(h); await h.click('บันทึกเซ็น');
  const src = preview(h).props.src;
  preview(h).props.onError(); await h.settle(); noCanvas(h);
  assert.ok(h.text(h.visible()).includes('แสดงภาพลายเซ็นไม่ได้'));
  await h.click('ลองโหลดใหม่'); assert.equal(preview(h).props.src, src); noCanvas(h);
  assert.equal(h.calls.filter(call => call[0] === 'signature').length, 1); h.unmount();
});

test('device r4: failed signature save preserves ink, reports a real error and only shows proof after retry succeeds', async () => {
  let fail = true;
  const h = await editor(document(), { signature: async (...args) => {
    if (fail) throw { response: { status: 503 } };
    h.calls.push(['signature', ...args]);
  }, get: async () => document({ has_receiver_signature: true }) });
  await h.radio('sign'); await ink(h); await h.click('บันทึกเซ็น');
  assert.equal(art(h, 'error'), true); assert.equal(h.text(primary(h)), 'บันทึกเซ็น');
  assert.equal(primary(h).props.disabled, false); assert.ok(h.visible().some(node => node.type === 'canvas'));
  assert.equal(h.visible().some(node => node.props.className === 'rc-saved-signature'), false);
  fail = false; await h.click('บันทึกเซ็น'); noCanvas(h); assert.equal(art(h, 'error'), false);
  assert.equal(preview(h).props.src, h.calls[0][3]); h.unmount();
});

test('device r4: seven pending decisions share one count across filter and both CTAs; warnings and variance do not inflate it', async () => {
  const h = await editor(document({ has_receiver_signature: true, total: '100', lines: Array.from({ length: 10 }, (_, i) => line(i + 1, false, '0.5')),
    warnings: Array.from({ length: 10 }, (_, i) => ({ code: 'LOW_CONFIDENCE', line_no: i + 1 })) }));
  await h.radio('lines');
  for (let i = 1; i <= 3; i++) await h.click(`ใช้ AI สินค้า ${i}`);
  assert.deepEqual(rowIndices(h), [3, 4, 5, 6, 7, 8, 9]);
  assert.ok(h.find(node => node.type === 'button' && h.text(node) === 'ค้างตรวจ 7'));
  assert.equal(h.text(primary(h)), 'ตรวจรายการก่อน (ค้าง 7)');
  assert.ok(h.text(h.visible()).includes('ขาด 10 · เกิน 0'));
  await h.click('ทั้งหมด'); assert.equal(rowIndices(h).length, 10);
  await h.radio('sign'); assert.equal(h.text(primary(h)), 'ตรวจรายการก่อน (ค้าง 7)');
  assert.equal(art(h, 'review-lines'), true); assert.equal(art(h, 'sign'), false);
  await h.click('ตรวจรายการก่อน (ค้าง 7)');
  assert.equal(h.focused.at(-1), 'line-3-review'); assert.deepEqual(rowIndices(h), [3, 4, 5, 6, 7, 8, 9]);
  assert.equal(art(h, 'review-lines'), true); assert.equal(art(h, 'error'), false);
  assert.equal(h.calls.length, 0); assert.ok(!h.text(h.visible()).includes('ลองใหม่อีกครั้ง')); h.unmount();
});

test('device r4: acknowledged signature survives a failed follow-up read; explicit reload fetches saved proof', async () => {
  let failRead = true;
  const h = await editor(document(), { get: async () => {
    if (failRead) throw { request: {} };
    return document({ has_receiver_signature: true });
  } });
  await h.radio('sign'); await ink(h); await h.click('บันทึกเซ็น');
  noCanvas(h); assert.equal(preview(h).props.src, h.calls.find(call => call[0] === 'signature')[3]);
  assert.equal(art(h, 'error'), true); assert.equal(h.text(primary(h)), 'ตรวจผลล่าสุด');
  failRead = false; await h.click('ตรวจผลล่าสุด'); noCanvas(h);
  assert.match(preview(h).props.src, /^blob:/);
  assert.equal(h.calls.filter(call => call[0] === 'signature').length, 1); h.unmount();
});

test('device r4: save removes a reviewed row even with warnings, undo restores it, and shortages/overages stay separate', async () => {
  const h = await editor(document({ lines: [line(1), line(2), line(3)], warnings: [{ code: 'LOW_CONFIDENCE', line_no: 1 }] }));
  await h.radio('lines'); await h.select('รับจริง', '0.5'); await h.click('บันทึกรายการ');
  assert.deepEqual(rowIndices(h), [1, 2]); assert.equal(h.text(primary(h)), 'ตรวจรายการก่อน (ค้าง 2)');
  assert.ok(h.text(h.visible()).includes('ขาด 1 · เกิน 0'));
  await h.click('ย้อนกลับ'); assert.deepEqual(rowIndices(h), [0, 1, 2]);
  await h.click('ใช้ AI สินค้า 1'); await h.click('ใช้ AI สินค้า 2'); await h.click('ใช้ AI สินค้า 3');
  assert.deepEqual(rowIndices(h), []); assert.ok(h.find(node => node.type === 'button' && h.text(node) === 'ค้างตรวจ 0'));
  assert.equal(h.text(primary(h)), 'ไปเซ็น');
  await h.click('ทั้งหมด'); assert.equal(rowIndices(h).length, 3);
  assert.ok(!/ข้อมูล \d+ รายการ/.test(h.text(h.visible()))); h.unmount();
});

test('device r4: quantities and unmapped products guide to the exact field without the error illustration', async () => {
  for (const [values, label, target] of [
    [{ quantity_received: '0' }, 'ระบุจำนวนรับจริงก่อน', 'line-0-quantity_received'],
    [{ quantity_received: '-1' }, 'ตรวจข้อมูลก่อน', 'line-0-quantity_received'],
    [{ product_id: null }, 'ตรวจข้อมูลก่อน', 'line-0-product_id'],
  ]) {
    const h = await editor(document({ has_receiver_signature: true, total: '10', lines: [{ ...line(1, true), ...values }] }));
    await h.radio('sign'); assert.equal(h.text(primary(h)), label); await h.click(label);
    assert.equal(h.focused.at(-1), target); assert.equal(art(h, 'error'), false);
    assert.equal(art(h, 'review-lines'), true); assert.equal(h.calls.length, 0); h.unmount();
  }
});

test('device r4: empty document CTA creates an editable row instead of reporting an error', async () => {
  const h = await editor(document({ lines: [], total: '0' })); await h.radio('sign');
  assert.equal(h.text(primary(h)), 'เพิ่มรายการ'); await h.click('เพิ่มรายการ');
  assert.ok(h.find(node => node.props.id === 'line-0-product_id')); assert.equal(art(h, 'error'), false);
  assert.equal(h.calls.length, 0); h.unmount();
});

test('device r4: validation responses use neutral review feedback while server faults retain retry error feedback', async () => {
  for (const status of [422, 503]) {
    const h = await editor(document({ has_receiver_signature: true }), { confirm: async () => { throw { response: { status, data: { code: status === 422 ? 'VALIDATION_FAILED' : 'INTERNAL_ERROR' } } }; } });
    await h.radio('sign'); await h.click('ตรวจรับ'); await h.click('ยืนยัน');
    assert.equal(art(h, 'error'), status === 503); assert.equal(art(h, 'review-lines'), status === 422);
    assert.equal(h.text(primary(h)), 'ยืนยัน'); h.unmount();
  }
});

test('device r4: pending uploads in the sign step route to uploading with neutral feedback', async () => {
  const h = await editor(document({ has_receiver_signature: true }));
  const input = h.find(node => node.type === 'input' && node.props.type === 'file');
  await input.props.onChange({ target: { files: [{ size: 20, type: 'image/jpeg', name: 'bill.jpg', slice: () => new Blob([new Uint8Array([255, 216, 255])]) }], value: 'bill.jpg' } });
  await h.settle(); await h.radio('sign'); assert.equal(h.text(primary(h)), 'ส่งรูปก่อน (ค้าง 1)');
  await h.click('ส่งรูปก่อน (ค้าง 1)'); assert.equal(h.text(primary(h)), 'ส่งรูป');
  assert.equal(art(h, 'review-lines'), true); assert.equal(art(h, 'error'), false); assert.equal(h.calls.length, 0); h.unmount();
});
