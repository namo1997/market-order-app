import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { clock } from './review-a-port-harness.mjs';
import { harness, armPad } from './receiving-harness.mjs';
import { rowDecision } from '../src/pages/receiving/review-a.js';
const user = { id: 12, name: 'ผู้รับ', role: 'user', branch_id: 1, department_id: 10 };
const row = { id: 1, line_no: 1, product_id: 7, product_name: 'อกไก่', order_item_id: 50, unit_text: 'กก.', quantity_ordered: '10', counted_quantity: null, quantity_billed: null, unit_price: null, match: { source: 'order' } };
const doc = patch => ({ id: 5, client_uuid: 'round-j', status: 'draft', kind: 'manual_receipt', images: [], warnings: [], ocr: { status: 'none' }, counted_complete_at: null, lines: [row], ...patch });
const open = (data, api = {}, runtime = {}) => harness('DocumentEditor', { initialDocument: data, user, onBack() {} }, api, {}, {}, runtime);
const text = h => h.text(h.visible());
const button = (h, label) => h.find(n => n.type === 'button' && h.text(n) === label);
async function draw(h) { await armPad(h); const c = h.find(n => n.type === 'canvas'); c.props.onPointerDown({ button: 0, pointerType: 'mouse', pointerId: 1, clientX: 50, clientY: 50, preventDefault() {} }); c.props.onPointerUp(); await h.settle(); }

test('J1 new and duplicate followup acknowledgements are sticky above the queue, outside the fixed bottom bar', async () => {
  for (const created of [true, false]) {
    const h = await harness('Receiving', {}, { followup: async () => ({ created, followup: { created_at: '2026-10-19T08:10:00Z' } }) }, { user });
    await h.click('ตามของ ตลาด'); await h.click('แจ้งบัญชี');
    const feedback = h.find(n => n.props.className === 'rc-followup-feedback');
    assert.match(h.text(feedback), created ? /ตลาด · แจ้งบัญชีแล้ว/ : /ตลาด · แจ้งไปแล้ว เวลา/);
    const all = h.all(); assert.ok(all.indexOf(feedback) < all.findIndex(n => n.props.className === 'rc-shop-workspace rc-stack'));
    assert.equal(h.all(feedback).some(n => n.props.role === 'status'), true);
    await h.click('ตามของ ตลาด'); await h.click('ปิด');
    assert.equal(h.all().some(n => n.props.className === 'rc-followup-feedback'), false);
  }
  const css = await readFile(new URL('../src/pages/receiving/receiving.css', import.meta.url), 'utf8');
  assert.match(css, /\.rc-followup-feedback\s*\{[^}]*position: sticky;[^}]*top:[^}]*safe-area-inset-top/s);
});

test('J2 manual receipt requires blank physical counts, then summary/order comparison, signature and confirmation without image/OCR', async () => {
  let current = doc({});
  const h = await open(current, {
    count: async (id, body) => { current = { ...current, counted_complete_at: '2026-10-19T00:00:00Z', lines: current.lines.map(line => ({ ...line, counted_quantity: body.lines[0].counted_quantity, quantity_received: body.lines[0].counted_quantity, review_decision: 'missing_bill' })) }; return current; },
    get: async () => current,
    signature: async () => { current = { ...current, has_receiver_signature: true }; },
    confirm: async () => { current = { ...current, status: 'confirmed' }; return current; },
    ocr: async () => assert.fail('manual receipt must never call OCR'), uploadImage: async () => assert.fail('no image is required'),
  });
  const nav = h.find(n => n.type === 'nav'); assert.equal(h.text(nav), 'นับของสรุปเซ็นรับ');
  assert.doesNotMatch(text(h), /ถ่ายบิล|เทียบบิล|อ่านบิลด้วย AI/);
  assert.equal(button(h, 'ยืนยันการนับ').props.disabled, true); assert.equal(button(h, 'สรุป').props.disabled, true);
  await h.select('นับได้ อกไก่', '4.5'); await h.click('ยืนยันการนับ');
  assert.equal(h.find(n => n.props['data-step']).props['data-step'], 'summary');
  assert.match(text(h), /นับได้ 4.5 กก. · รับ 4.5 กก.*สั่ง 10 กก.*จำนวนรับต่างจากใบสั่ง/);
  assert.match(text(h), /รูปของ \(ไม่บังคับ\)/); assert.doesNotMatch(text(h), /ยอดบิล|เทียบบิล|ถ่ายบิล/);
  await h.click('ไปเซ็นรับของ'); await draw(h); await h.click('บันทึกเซ็น'); await h.click('ยืนยันรับสินค้า');
  assert.match(text(h), /รับของเรียบร้อย/);
});

test('J2 counted manual draft resumes at summary; legacy undecided rows save missing-bill acknowledgement before signing', async () => {
  const h = await open(doc({ counted_complete_at: '2026-10-19T00:00:00Z', lines: [{ ...row, counted_quantity: '0', quantity_received: '0' }] }));
  assert.match(text(h), /สรุปก่อนเซ็น/); await h.click('ไปเซ็นรับของ');
  assert.equal(h.calls.find(c => c[0] === 'update')[2].lines[0].review_decision, 'missing_bill');
  assert.equal(h.find(n => n.props['data-step']).props['data-step'], 'sign');
  assert.equal(rowDecision({ ...row, counted_quantity: '2', quantity_received: '2' }, doc({})).kind, 'missing_bill');
  assert.equal(rowDecision({ ...row, counted_quantity: '2', quantity_received: '2' }, doc({ kind: 'bill' })).kind, 'waiting_bill');
});

test('J2 failed count retains input and keeps summary locked; bill flow keeps bill stage and OCR gate', async () => {
  const h = await open(doc({}), { count: async () => { throw { response: { status: 500 } }; } });
  await h.select('นับได้ อกไก่', '0'); await h.click('ยืนยันการนับ');
  assert.equal(h.find(n => n.props.id === 'count-1').props.value, '0'); assert.equal(button(h, 'สรุป').props.disabled, true);
  const bill = await open(doc({ kind: 'bill' })); assert.match(text(bill), /ถ่ายบิลไว้ก่อน/); assert.match(h.text(bill.find(n => n.type === 'nav')), /เทียบบิล/);
});

test('J3 adding existing catalog product returns to original count, preserves values and does not append; new product adds once', async () => {
  const timers = clock();
  const h = await open(doc({ kind: 'bill' }), { getProducts: async () => ({ data: [{ id: 7, name: 'อกไก่', unit_name: 'กก.' }, { id: 8, name: 'ขา B', unit_name: 'กก.' }] }) }, timers.runtime);
  await h.click('นับของ'); await h.select('นับได้ อกไก่', '1.25'); await h.click('เพิ่มสินค้าที่มาส่ง');
  await h.select('ค้นหาสินค้า', 'ไก่'); await timers.tick(350); await h.settle();
  assert.match(text(h), /มีในใบแล้ว · ไปช่องนับเดิม/);
  await h.click('อกไก่ · มีในใบแล้ว · ไปช่องนับเดิม');
  assert.equal(h.all().filter(n => n.props.className === 'ra-count-row').length, 1); assert.ok(h.focused.includes('count-1'));
  assert.equal(h.find(n => n.props.id === 'count-1').props.value, '1.25'); assert.equal(h.calls.length, 0);
  await h.click('เพิ่มสินค้าที่มาส่ง'); await h.select('ค้นหาสินค้า', 'ไก่'); await timers.tick(350); await h.settle(); await h.click('ขา B');
  assert.equal(h.all().filter(n => n.props.className === 'ra-count-row').length, 2);
  assert.equal(button(h, 'ยืนยันการนับและเทียบบิล').props.disabled, true);
});

test('J2 saved optional goods images never trigger OCR; reload returns to manual summary and blank order reference stays unknown', async () => {
  const current = doc({ counted_complete_at: '2026-10-19T00:00:00Z', images: [{ id: 1, page_no: 1 }], lines: [{ ...row, quantity_ordered: null, counted_quantity: '2', quantity_received: '2', review_decision: 'missing_bill' }] });
  const h = await open(current, { image: async () => new Blob(['synthetic']), ocr: async () => assert.fail('goods evidence must not trigger OCR') });
  assert.match(text(h), /ไม่มีจำนวนใบสั่งอ้างอิง/); assert.doesNotMatch(text(h), /ตรงตามใบสั่ง|ยอดบิล/);
  await h.click('โหลดเอกสารล่าสุด'); assert.equal(h.find(n => n.props['data-step']).props['data-step'], 'summary');
  assert.equal(h.calls.some(c => c[0] === 'ocr'), false);
});
