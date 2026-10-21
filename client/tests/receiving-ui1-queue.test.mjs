import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';
import { queueDisplayState } from '../src/pages/receiving/receiving-illustration-state.js';

const shop = id => ({ supplier_key: `pg:${id}`, supplier_name: `ร้านตัวอย่าง ${id}`, items: [{ order_item_id: id, product_id: id, product_name: 'สินค้า', has_pending: true, unit_name: 'กก.' }] });
const primary = h => h.find(n => n.type === 'button' && n.props.className?.includes('sg-primary'));
const text = h => h.text(h.visible());
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const blindDoc = () => ({ id: 91, client_uuid: 'ui1-count', status: 'draft', kind: 'manual_receipt', supplier_name_text: 'ร้านตัวอย่าง', counted_complete_at: null, lines: [{ id: 1, product_id: 1, product_name: 'สินค้า', unit_text: 'กิโลกรัม', quantity_ordered: '789', quantity_billed: '876', counted_quantity: null }], images: [], warnings: [], ocr: { status: 'none' } });

for (const [patch, expected] of [[{ error: 'failed' }, 'error'], [{ online: false }, 'offline'], [{ loading: true }, 'loading'], [{ loaded: false }, 'loading'], [{ scopeReady: false }, 'scope'], [{}, 'ready']]) {
  test(`UI1 queue state keeps ${expected} distinct`, () => {
    assert.equal(queueDisplayState({ loading: false, error: '', online: true, loaded: true, scopeReady: true, ...patch }), expected);
  });
}

test('UI1 failed initial load is unknown with an inline retry; only successful empty becomes zero', async () => {
  let fail = true, calls = 0;
  const h = await harness('Receiving', {}, { expected: async () => { calls++; if (fail) throw { request: {} }; return []; } });
  assert.match(text(h), /รอรับ — ร้าน/); assert.doesNotMatch(text(h), /รอรับ 0 ร้าน|วันนี้ไม่มีคิวรับของ|รับครบทุกร้านแล้ว/);
  assert.match(text(h), /โหลดคิวไม่สำเร็จ|ยังไม่ทราบจำนวน/);
  fail = false; await h.click('ลองโหลดอีกครั้ง');
  assert.equal(calls, 2); assert.match(text(h), /รอรับ 0 ร้าน/); assert.match(text(h), /วันนี้ไม่มีคิวรับของ/);
  assert.doesNotMatch(text(h), /รับครบทุกร้านแล้ว/);
});

test('UI1 loading and failed refresh hide stale counts and prevent starting a shop', async () => {
  const gate = defer(); let refresh = false;
  const h = await harness('Receiving', {}, { expected: () => refresh ? gate.promise : Promise.resolve([shop(1)]) });
  assert.match(text(h), /รอรับ 1 ร้าน/); refresh = true;
  const request = h.find(n => n.props['aria-label'] === 'โหลดใหม่').props.onClick(); await h.settle(); assert.match(text(h), /รอรับ — ร้าน/); assert.equal(primary(h).props.disabled, true);
  assert.equal(h.visible().some(n => n.props.className === 'rc-queue-shop'), false);
  gate.reject({ request: {} }); await request; await h.settle();
  assert.match(text(h), /รอรับ — ร้าน/); assert.doesNotMatch(text(h), /รอรับ 1 ร้าน|รอรับ 0 ร้าน/);
});

test('UI1 offline retains unknown queue coverage and blocks stale shop actions', async () => {
  const h = await harness('Receiving', {}, { expected: async () => [shop(1)] }, {}, {}, { navigator: { onLine: false } });
  assert.match(text(h), /รอรับ — ร้าน/); assert.match(text(h), /ยังเชื่อมต่อไม่ได้/);
  assert.equal(h.visible().some(n => n.props.className === 'rc-queue-shop'), false);
  assert.equal(h.calls.length, 0);
});

test('UI1 footer names the selected shop, keeps navigation; only the manual setup sheet waits for submit', async () => {
  const h = await harness('Receiving', {}, { expected: async () => [shop(1), shop(2)] });
  assert.equal(h.text(primary(h)), 'สแกนบิล ร้านตัวอย่าง 1');
  await h.click('เลือกร้าน ร้านตัวอย่าง 2');
  assert.equal(h.text(primary(h)), 'สแกนบิล ร้านตัวอย่าง 2');
  assert.equal(h.find(n => n.props['aria-label'] === 'เลือกร้าน ร้านตัวอย่าง 2').props['aria-pressed'], true);
  await h.click('เลือกร้าน ร้านตัวอย่าง 2');
  assert.equal(h.find(n => n.props['aria-label'] === 'เลือกร้าน ร้านตัวอย่าง 2').props['aria-expanded'], false);
  assert.equal(h.text(primary(h)), 'สแกนบิล ร้านตัวอย่าง 2', 'collapsing details must not silently switch the receiving shop');
  assert.equal(h.calls.length, 0);
  // Scan-first: the footer writes at once with the shop defaults; the setup sheet is only in Options.
  await h.click('ตัวเลือก'); await h.click('ตั้งค่าใบรับเอง');
  assert.ok(h.find(n => n.type === 'input' && n.props.value === 'ร้านตัวอย่าง 2'));
  assert.equal(h.calls.length, 0, 'the manual sheet writes nothing before submit');
});

test('UI1 pending queue preserves documents navigation and the status filter', async () => {
  const h = await harness('Receiving', {}, { expected: async () => [shop(1)] });
  await h.radio('documents'); await h.radio('draft'); await h.click('ดูคิวรอรับ'); await h.radio('documents');
  assert.equal(h.find(n => n.type === 'input' && n.props.value === 'draft').props.checked, true);
});

test('UI1 blind count blank differs from intentional zero; invalid values stay visible and cannot submit', async () => {
  const h = await harness('DocumentEditor', { initialDocument: blindDoc(), user: { id: 1 }, onBack() {} });
  const input = () => h.find(n => n.type === 'input' && n.props.id === 'count-1');
  assert.equal(input().props.value, ''); assert.equal(primary(h).props.disabled, true);
  assert.match(text(h), /ว่าง = ยังไม่นับ/); assert.doesNotMatch(text(h), /789|876/);
  await h.click('ไม่ได้ส่ง สินค้า'); assert.equal(input().props.value, '0'); assert.equal(primary(h).props.disabled, false);
  assert.match(text(h), /ไม่มีของจริง/); assert.equal(primary(h).props['aria-describedby'], 'count-progress');
  input().props.onChange({ target: { value: '999999999999' } }); await h.settle();
  assert.equal(input().props.value, '999999999999'); assert.equal(input().props['aria-invalid'], true); assert.equal(primary(h).props.disabled, true);
  input().props.onChange({ target: { value: '' } }); await h.settle();
  assert.equal(input().props.value, ''); assert.equal(primary(h).props.disabled, true);
  assert.equal(h.calls.length, 0);
});

test('UI1 decimal IME retains composition text until commit and retains the previous number on invalid composition', async () => {
  const values = [], focus = [], blur = [];
  const h = await harness('ReceivingNumberField', { value: '1', onValueChange: value => values.push(value), onFocus: () => focus.push(true), onBlur: () => blur.push(true) });
  const input = () => h.find(n => n.type === 'input');
  input().props.onFocus({}); input().props.onCompositionStart({ target: { value: '1' } }); await h.settle();
  const event = { target: { value: '1.25' }, nativeEvent: { isComposing: true }, stopPropagation: () => assert.fail('IME must not be rejected mid-composition') };
  input().props.onChangeCapture(event); input().props.onChange(event); await h.settle();
  assert.equal(input().props.value, '1.25'); assert.deepEqual(values, []);
  input().props.onCompositionEnd(event); await h.settle(); assert.deepEqual(values, ['1.25']);
  input().props.onCompositionStart({ target: { value: '1' } }); await h.settle();
  input().props.onChange({ target: { value: 'ก' } }); await h.settle(); assert.equal(input().props.value, 'ก');
  input().props.onCompositionEnd({ target: { value: 'ก' } }); await h.settle();
  assert.equal(input().props.value, '1'); assert.equal(input().props['aria-invalid'], true); assert.deepEqual(values, ['1.25']);
  input().props.onBlur({}); assert.deepEqual(focus, [true]); assert.deepEqual(blur, [true]);
});
