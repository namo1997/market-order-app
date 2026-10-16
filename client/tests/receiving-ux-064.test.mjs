import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';
import { documentReviewSummary, reviewAttention, reviewChangeMessage } from '../src/pages/receiving/receiving-review.js';

const line = (id, values = {}) => ({ id, line_no: id, product_id: id, order_item_id: id,
  product_name: `ผัก ${id}`, unit_text: 'กก.', quantity_received: '1', quantity_billed: '1',
  amount: '10', unit_price: '10', match: { source: 'manual' }, ...values });
const doc = (values = {}) => ({ id: 5, status: 'draft', kind: 'bill', delivery_date: '2026-10-16',
  product_group_id: 1, supplier_name_text: 'ร้าน 1', has_receiver_signature: true,
  total: '20', discount: '0', vat: '0', images: [], lines: [line(1), line(2)],
  ocr: { status: 'done' }, warnings: [], ...values });
const group = (id, received = false) => ({ supplier_key: `pg:${id}`, supplier_name: `ร้าน ${id}`,
  items: [{ order_item_id: id, product_id: id, product_name: `ผัก ${id}`, quantity_ordered: '1',
    received_quantity: received ? '1' : '0', is_received: received, unit_name: 'กก.' }] });
const text = h => h.text(h.visible()[0]);
const primary = h => h.find(node => node.type === 'button' && node.props.className?.includes('sg-primary'));
const editor = (initial = doc(), overrides = {}, props = {}) => harness('DocumentEditor', {
  initialDocument: initial, user: { id: 1, name: 'ผู้รับ', role: 'receiver' }, onBack() {}, onChanged() {}, ...props,
}, { expected: async () => [{ items: [group(1).items[0], group(2).items[0]] }], ...overrides }, {}, {},
{ setTimeout: done => { done(); return 1; }, clearTimeout() {} });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

// Use real Receiving -> DocumentEditor -> confirm handlers; only HTTP/timers are mocked.
async function confirmWithQueue(before, overrides = {}, failList = false) {
  const queue = deferred();
  let confirmed = false, confirmations = 0;
  const initial = doc();
  const h = await harness('Receiving', {}, {
    expected: async () => confirmed ? queue.promise : before,
    list: async () => { if (confirmed && failList) { await queue.promise; throw new Error('โหลดเอกสารไม่ได้'); } return [initial]; },
    get: async () => initial,
    confirm: async () => { confirmed = true; confirmations++; return { ...initial, status: 'confirmed' }; },
    ...overrides,
  }, {}, {}, { setTimeout: done => { done(); return 1; }, clearTimeout() {} });
  await h.radio('documents'); await h.click('เปิดเอกสาร #5 ร้าน 1 ร่าง');
  await h.radio('sign'); await h.click('ตรวจรับ'); await h.click('ยืนยัน');
  assert.equal(confirmations, 1);
  assert.equal(h.text(primary(h)), 'กำลังโหลดคิว…'); assert.equal(primary(h).props.disabled, true);
  assert.ok(!text(h).includes('รับร้านถัดไป')); assert.ok(!text(h).includes('กลับหน้ารับสินค้า'));
  assert.ok(h.visible().some(node => node.type === 'button' && h.text(node) === 'ดูเอกสาร'));
  h.budget();
  return { h, queue, confirmations: () => confirmations };
}

test('UX064 #1: last confirmation waits for fresh queue, then returns home without suggesting a next shop', async () => {
  const { h, queue, confirmations } = await confirmWithQueue([group(1), group(2)]);
  queue.resolve([group(1, true), group(2, true)]); await h.settle();
  assert.equal(h.text(primary(h)), 'กลับหน้ารับสินค้า'); assert.equal(primary(h).props.disabled, false);
  h.budget(); await h.click('กลับหน้ารับสินค้า');
  assert.match(text(h), /รอรับ 0 ร้าน/); assert.match(text(h), /รับครบทุกร้านแล้ว/);
  assert.equal(h.text(primary(h)), 'ดูเอกสาร'); assert.equal(confirmations(), 1); h.unmount();
});

test('UX064 #1: fresh queue can add a pending shop absent from stale queue; next action selects it', async () => {
  const { h, queue, confirmations } = await confirmWithQueue([group(1)]);
  queue.resolve([group(1, true), group(2), group(3, true)]); await h.settle();
  assert.equal(h.text(primary(h)), 'รับร้านถัดไป'); assert.equal(primary(h).props.disabled, false);
  await h.click('รับร้านถัดไป'); assert.match(text(h), /รอรับ 1 ร้าน/);
  assert.match(h.text(h.find(node => node.props.className === 'rc-current-shop')), /ร้าน 2/);
  assert.equal(confirmations(), 1); h.unmount();
});

test('UX064 #1: queue failure offers one retry, keeps receipt accessible, never guesses from old groups or reconfirms', async () => {
  const { h, queue, confirmations } = await confirmWithQueue([group(1), group(2)]);
  queue.reject(new Error('โหลดคิวไม่ได้')); await h.settle();
  assert.equal(h.text(primary(h)), 'ลองโหลดคิวใหม่'); assert.equal(primary(h).props.disabled, false);
  assert.ok(!text(h).includes('รับร้านถัดไป')); h.budget();
  h.api.expected = async () => [group(1, true), group(2, true)];
  await h.click('ลองโหลดคิวใหม่'); assert.equal(h.text(primary(h)), 'กลับหน้ารับสินค้า');
  await h.click('ดูเอกสาร'); assert.match(text(h), /ผู้ส่ง ไม่ระบุชื่อผู้ส่ง/);
  assert.equal(confirmations(), 1); h.unmount();
});

test('UX064 #1: list refresh failure also prevents stale queue labels until successful retry', async () => {
  const { h, queue, confirmations } = await confirmWithQueue([group(1)], {}, true);
  queue.resolve([group(1, true)]); await h.settle();
  assert.equal(h.text(primary(h)), 'ลองโหลดคิวใหม่');
  h.api.list = async () => [doc({ status: 'confirmed' })];
  await h.click('ลองโหลดคิวใหม่'); assert.equal(h.text(primary(h)), 'กลับหน้ารับสินค้า');
  assert.equal(confirmations(), 1); h.unmount();
});

test('UX064 #1: receipt remains accessible while the queue is still loading', async () => {
  const { h, queue, confirmations } = await confirmWithQueue([group(1)]);
  await h.click('ดูเอกสาร'); assert.match(text(h), /ผู้ส่ง ไม่ระบุชื่อผู้ส่ง/);
  queue.resolve([group(1, true)]); await h.settle();
  assert.equal(confirmations(), 1); h.unmount();
});

test('UX064 #2: lead includes only product/bill warnings; one price notice and all warning details remain', async () => {
  const initial = doc({ lines: [line(1, { quantity_received: '2' }), line(2, { amount: null, unit_price: null })],
    total: '10', warnings: [{ code: 'PRICE_CHANGE' }] });
  const h = await editor(initial); await h.click('ดูข้อเตือน');
  assert.equal(h.text(h.find(node => node.type === 'p' && node.props.className === 'rc-muted')),
    'สินค้าเกิน 1 รายการ / ข้อสังเกตบิล 1 ข้อ');
  assert.equal(text(h).split('ยังไม่มีราคา').length - 1, 1);
  assert.equal(h.visible().filter(node => node.props.className === 'rc-price-notice').length, 1);
  assert.match(h.text(h.find(node => node.props.className === 'rc-price-notice')), /ยังไม่มีราคา 1 รายการ/);
  assert.equal(h.visible().filter(node => node.props.className === 'rc-check-row').length, 1);
  assert.match(text(h), /ราคาเปลี่ยนจากครั้งก่อน/);
  assert.match(h.text(h.find(node => node.type === 'details')), /ยังไม่ตรวจ 0 รายการ · ข้อเตือนสินค้า 1 รายการ · ข้อสังเกตบิล 1 ข้อ/);
  await h.click('รายการ 1: ผัก 1เกิน 1 กก.ไปตรวจรายการนี้');
  assert.equal(h.all().find(node => node.props['data-step']).props['data-step'], 'lines');
  assert.equal(h.text(h.find(node => node.type === 'h2')), 'แก้ ผัก 1');
  assert.equal(h.find(node => node.props.id === 'line-0-quantity_received').props.value, '2'); h.unmount();
});

test('UX064 #2: price-only attention is shown solely by PriceNotice; explicit zero needs no price warning', async () => {
  for (const amount of [null, '0']) {
    const h = await editor(doc({ total: '10', lines: [line(1), line(2, { amount, unit_price: null })] }));
    await h.click('ดูข้อเตือน');
    assert.equal(h.visible().filter(node => node.type === 'p' && node.props.className === 'rc-muted').length, 0);
    assert.equal(text(h).split('ยังไม่มีราคา').length - 1, amount === null ? 1 : 0); h.unmount();
  }
});

test('UX064 #2: unchanged net total is inside closed summary details; bill and item totals stay prominent', async () => {
  for (const values of [{}, { discount: null, vat: '' }, { total: '25' }, { total: null }]) {
    const h = await editor(doc(values)); await h.click('ดูข้อเตือน');
    const totals = h.find(node => node.props.className === 'rc-totals');
    assert.match(h.text(totals), /ยอดตามบิล/); assert.match(h.text(totals), /รวมรายการ 20\.00 บาท/);
    assert.ok(!h.text(totals).includes('รวมรายการสุทธิ'));
    const details = h.find(node => node.type === 'details'); assert.ok(!details.props.open);
    assert.match(h.text(details), /รายละเอียดสรุป/); assert.match(h.text(details), /รวมรายการสุทธิ 20\.00 บาท/);
    assert.match(h.text(details), /ส่วนลด 0\.00 บาท/); assert.match(h.text(details), /ภาษี 0\.00 บาท/);
    assert.equal(text(h).split('รวมรายการสุทธิ').length - 1, 1); h.unmount();
  }
});

test('UX064 #2: discount/tax retain prominent net, including adjustments that cancel; all amounts stay exact', async () => {
  for (const [discount, vat, total] of [['1.25', '0', '18.75'], ['0', '1.40', '21.40'], ['1', '1', '20.00']]) {
    const h = await editor(doc({ discount, vat, total })); await h.click('ดูข้อเตือน');
    const totals = h.text(h.find(node => node.props.className === 'rc-totals'));
    assert.match(totals, /รวมรายการ 20\.00 บาท/); assert.ok(totals.includes(`รวมรายการสุทธิ ${total} บาท`));
    assert.ok(totals.includes('ผลรวมตรงยอดบิล'));
    const details = h.text(h.find(node => node.type === 'details'));
    assert.ok(!details.includes('รวมรายการสุทธิ')); assert.match(details, /ส่วนลด/); assert.match(details, /ภาษี/);
    assert.equal(text(h).split('รวมรายการสุทธิ').length - 1, 1); h.unmount();
  }
});

test('UX064 #2: invalid money keeps visible net placeholder and validation feedback', async () => {
  const h = await editor(doc({ discount: 'invalid' })); await h.click('ดูข้อเตือน');
  assert.match(h.text(h.find(node => node.props.className === 'rc-totals')), /รวมรายการสุทธิ — บาทตรวจตัวเลข/);
  assert.ok(!h.text(h.find(node => node.type === 'details')).includes('รวมรายการสุทธิ')); h.unmount();
});

test('UX064 #2: missing-price changes retain acknowledgement message without repeating the price notice copy', async () => {
  const before = documentReviewSummary(doc(), [group(1).items[0], group(2).items[0]]);
  const after = documentReviewSummary(doc({ lines: [line(1), line(2, { amount: null, unit_price: null })], total: '10' }),
    [group(1).items[0], group(2).items[0]]);
  assert.equal(reviewAttention({ ...after, unreviewedCount: 2 }), '');
  assert.equal(reviewChangeMessage(before, after), 'สรุปเปลี่ยน: ข้อมูลราคาเปลี่ยน');
  assert.equal(after.pricing.label, 'ยังไม่มีราคา 1 รายการ');
});

test('UX064 #2: summary after saving signature shows pending price only once, keeps acknowledgement and net details', async () => {
  const initial = doc({ has_receiver_signature: false });
  const saved = doc({ total: '10', lines: [line(1), line(2, { amount: null, unit_price: null })] });
  const h = await editor(initial, { signature: async () => {}, get: async () => saved });
  await h.radio('sign');
  const canvas = h.find(node => node.type === 'canvas');
  canvas.props.onPointerDown({ pointerType: 'mouse', button: 0, pointerId: 1, clientX: 30, clientY: 30, preventDefault() {} });
  canvas.props.onPointerUp(); await h.settle(); await h.click('บันทึกเซ็น');
  assert.equal(h.text(h.find(node => node.type === 'h2')), 'ตรวจสรุป');
  assert.match(text(h), /บันทึกลายเซ็นแล้ว/); assert.match(text(h), /สรุปเปลี่ยน: ข้อมูลราคาเปลี่ยน/);
  assert.equal(text(h).split('ยังไม่มีราคา').length - 1, 1);
  assert.equal(h.text(primary(h)), 'รับทราบ');
  assert.match(h.text(h.find(node => node.type === 'details')), /รวมรายการสุทธิ 10\.00 บาท/);
  await h.click('รับทราบ'); assert.match(text(h), /เซ็นแล้ว/); assert.equal(h.text(primary(h)), 'ตรวจรับ'); h.unmount();
});
