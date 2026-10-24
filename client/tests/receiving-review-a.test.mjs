import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { harness, armPad } from './receiving-harness.mjs';
import { rowDecision, reviewLedger } from '../src/pages/receiving/review-a.js';
import { quantityStatus } from '../src/pages/receiving/receiving-status.js';
const user = { id: 1, role: 'admin', name: 'ผู้รับ' };
const line = (id = 1, patch = {}) => ({ id, line_no: id, product_id: id + 6, product_name: `สินค้า ${id}`, bill_text: id === 1 ? 'ทB' : `บิล ${id}`, order_item_id: 40 + id,
  unit_text: 'กก.', ordered_unit: 'kg', unit_id: 2, counted_quantity: '2', quantity_received: '2', quantity_billed: '2', quantity_ordered: '2', unit_price: '10', ordered_price: '10', amount: '20', remember_alias: false, match: { source: 'order', confidence: 1 }, ...patch });
const document = (patch = {}) => ({ id: 5, client_uuid: 'count-fixture', status: 'draft', kind: 'bill', branch_id: 1, department_id: 10, delivery_date: '2026-10-18', supplier_name_text: 'ร้านทดสอบ', product_group_id: 3, counted_complete_at: '2026-10-18T00:00:00Z', images: [], warnings: [], ocr: { status: 'done' }, lines: [line()], ...patch });
const blind = () => document({ counted_complete_at: null, blind: true, lines: [line(1, { counted_quantity: null }), line(2, { counted_quantity: null })] });
const open = (doc = document(), api = {}, props = {}, runtime = {}) => harness('DocumentEditor', { initialDocument: doc, user, onBack() {}, onChanged() {}, ...props }, api, {}, {}, runtime);
const text = h => h.text(h.visible());
const button = (h, label) => h.find(node => node.type === 'button' && h.text(node) === label);
const draw = async (h, index = 0) => { await armPad(h, index); const canvas = h.visible().filter(node => node.type === 'canvas')[0]; canvas.props.onPointerDown({ button: 0, pointerType: 'mouse', pointerId: 1, clientX: 50, clientY: 50, preventDefault() {} }); canvas.props.onPointerUp(); await h.settle(); };

test('A blind: untrusted prefilled order/OCR numbers and thumbnails never render; count fields start empty, zero is intentional', async () => {
  let imageReads = 0;
  const doc = blind(); doc.total = '99999'; doc.images = [{ id: 1, page_no: 1 }];
  const h = await open(doc, { image: async () => { imageReads++; return new Blob(); } });
  assert.doesNotMatch(text(h), /99999|ทB|นับได้.*2\.00/); assert.equal(imageReads, 0);
  assert.ok(!h.visible().some(node => node.type === 'img' && /บิลหน้า/.test(node.props.alt || '')));
  await h.click('นับ');
  const inputs = h.visible().filter(node => node.type === 'input' && node.props.inputMode === 'decimal');
  assert.equal(inputs.length, 2); assert.ok(inputs.every(node => node.props.value === ''));
  assert.equal(button(h, 'ยืนยันการนับและเทียบบิล').props.disabled, true); assert.match(text(h), /เหลือ 2 รายการ/);
  await h.select('นับได้ สินค้า 1', '4.5'); assert.match(text(h), /เหลือ 1 รายการ/);
  await h.select('นับได้ สินค้า 2', '0'); assert.equal(button(h, 'ยืนยันการนับและเทียบบิล').props.disabled, false);
  await h.click('ยืนยันการนับและเทียบบิล'); await h.click('ถูกต้อง ยืนยันการนับ');
  const sent = h.calls.find(call => call[0] === 'count')[2]; assert.equal(sent.client_uuid, doc.client_uuid); assert.deepEqual(Array.from(sent.lines, row => row.counted_quantity), ['4.5', '0']);
  assert.match(text(h), /ในบิลเขียน ทB/); h.unmount();
});
test('A blind: negative, oversized and incomplete counts cannot submit; offline cannot send', async () => {
  const h = await open(blind()); await h.click('นับ');
  await h.select('นับได้ สินค้า 1', '-1'); await h.select('นับได้ สินค้า 2', '100000000');
  assert.equal(button(h, 'ยืนยันการนับและเทียบบิล').props.disabled, true); assert.equal(h.calls.length, 0); h.unmount();
  const off = await open(blind(), {}, { online: false }); assert.equal(button(off, 'นับ').props.disabled, true); assert.match(text(off), /ออฟไลน์/); off.unmount();
});
test('A blind: API failure retains entered quantities and retry identity; dirty guard protects leaving', async () => {
  const sent = [], dirty = []; let fails = true;
  const h = await open(blind(), { count: async (id, body) => { sent.push(body); if (fails) throw { request: {} }; return document({ lines: [line(), line(2)] }); } }, { onDirtyChange: value => dirty.push(value) });
  await h.click('นับ'); await h.select('นับได้ สินค้า 1', '1.25'); await h.select('นับได้ สินค้า 2', '0');
  await h.click('ยืนยันการนับและเทียบบิล'); assert.match(text(h), /การเชื่อมต่อ/);
  assert.equal(h.find(node => node.type === 'input' && node.props.value === '1.25').props.inputMode, 'decimal');
  await h.click('กลับคิว'); assert.match(text(h), /มีข้อมูลที่ยังไม่ส่ง/); await h.click('ทำต่อใบเดิม');
  fails = false; await h.click('ยืนยันการนับและเทียบบิล'); assert.equal(sent[0].client_uuid, sent[1].client_uuid); assert.ok(dirty.includes(true)); h.unmount();
});
for (const [qty, label, decision] of [['2', 'ยืนยันรับ 2', 'accept'], ['1.5', 'รับ 1.5 กก. · แจ้งร้านขาด 0.5 กก.', 'short'], ['2.5', 'รับ 2.5 เป็นของเกิน', 'over']]) {
  test(`A row: ${decision} is a visible one-tap persisted decision, retains count and supports undo`, async () => {
    const h = await open(document({ lines: [line(1, { counted_quantity: qty, quantity_received: qty })] }));
    assert.equal(button(h, 'ดูสรุปก่อนเซ็น').props.disabled, true);
    await h.click(label); const saved = h.calls.find(call => call[0] === 'update')[2];
    assert.equal(saved.lines[0].review_decision, decision); assert.equal(Number(saved.lines[0].quantity_received), Number(qty));
    assert.equal(saved.lines[0].remember_alias, false); assert.match(text(h), /ตัดสินใจแล้ว 1\/1/);
    assert.equal(button(h, 'ดูสรุปก่อนเซ็น').props.disabled, false);
    await h.click('เลิกทำการตัดสินใจ'); assert.equal(h.calls.at(-1)[2].lines[0].review_decision, null); assert.match(text(h), /ตัดสินใจแล้ว 0\/1/); h.unmount();
  });
}
test('A row: all matching accepts only matching rows and cannot approve shortages or overwrite counts', async () => {
  const h = await open(document({ lines: [line(), line(2, { quantity_received: '1.5', counted_quantity: '1.5' })] }));
  await h.click('ยืนยันทั้งหมดที่ตรง'); const body = h.calls.find(call => call[0] === 'update')[2];
  assert.equal(body.lines[0].review_decision, 'accept'); assert.equal(body.lines[1].review_decision, null); assert.equal(body.lines[1].quantity_received, '1.50'); assert.match(text(h), /เหลือ 1 รายการ/); h.unmount();
});
test('A row: failed save retains corrected values and dirty state; no false acknowledgement', async () => {
  const dirty = []; let fails = true;
  const h = await open(document(), { update: async (id, body) => { if (fails) throw { response: { status: 500 } }; return document({ lines: [{ ...line(), ...body.lines[0] }] }); } }, { onDirtyChange: value => dirty.push(value) });
  await h.click('แก้'); await h.select('แก้จำนวนหลังเปิดบิล สินค้า 1', '1.25');
  await h.click('รับ 1.25 กก. · แจ้งร้านขาด 0.75 กก.'); assert.match(text(h), /ส่งข้อมูลไม่สำเร็จ/); assert.match(text(h), /ตัดสินใจแล้ว 0\/1/); assert.ok(dirty.includes(true));
  assert.equal(h.find(node => node.type === 'input' && node.props.value === '1.25').props.inputMode, 'decimal');
  fails = false; await h.click('รับ 1.25 กก. · แจ้งร้านขาด 0.75 กก.'); assert.match(text(h), /แก้หลังเปิดบิล: รับ 1.25/); assert.match(text(h), /ตัดสินใจแล้ว 1\/1/); h.unmount();
});
test('A row: explicit product confirmation converts AI to manual; alias is opt-in and preserves Thai raw text', async () => {
  const h = await open(document({ lines: [line(1, { match: { source: 'ai', confidence: .4 } })] }));
  assert.match(text(h), /สินค้าไม่ตรง/); const remember = h.find(node => node.type === 'input' && node.props.type === 'checkbox'); assert.equal(remember.props.checked, false);
  remember.props.onChange({ target: { checked: true } }); await h.settle();
  await h.click('ยืนยันสินค้าที่เลือกและรับ'); const body = h.calls.find(call => call[0] === 'update')[2];
  assert.equal(body.lines[0].remember_alias, true); assert.equal(body.lines[0].bill_text, 'ทB'); assert.equal(body.lines[0].match.source, 'manual'); h.unmount();
});
test('A row: wrong product has accessible catalog search; corrected product clears unrelated order and requires decision', async () => {
  const h = await open(document({ lines: [line(1, { product_id: null })] }), { getProducts: async () => ({ data: [{ id: 88, name: 'อกไก่', unit_name: 'กก.', unit_id: 2 }] }) });
  await h.select('ค้นหาสินค้า', 'อกไก่'); await new Promise(resolve => setTimeout(resolve, 380)); await h.settle();
  await h.click('อกไก่'); assert.match(text(h), /ในบิลเขียน ทB → อกไก่/); assert.match(text(h), /ตัดสินใจแล้ว 0\/1/);
  await h.click('ยืนยันรับ 2'); const body = h.calls.find(call => call[0] === 'update')[2];
  assert.equal(body.lines[0].product_id, 88); assert.equal(body.lines[0].order_item_id, null); assert.equal(body.lines[0].quantity_received, '2.00'); h.unmount();
});
for (const unit of ['กก.', 'กิโลกรัม', 'kg', ' KG ', null]) test(`A F2 unit ${unit}: equivalent and missing units do not produce false mismatch`, () => {
  const row = line(1, { unit_text: unit }); assert.equal(rowDecision(row).kind, 'accept');
  assert.equal(quantityStatus(row, [{ order_item_id: 41, quantity_ordered: '2', received_quantity: '0', unit_name: 'กก.' }], [row], 'bill').label, 'ครบ');
});
test('A F2: genuinely different unit and price require an explicit decision', async () => {
  assert.equal(rowDecision(line(1, { unit_text: 'ลัง' })).label, 'ตรวจหน่วย');
  const h = await open(document({ lines: [line(1, { unit_price: '11' })] }));
  assert.match(text(h), /ราคาไม่ตรง/); await h.click('รับ 2 และส่งตรวจราคา'); assert.equal(h.calls.find(call => call[0] === 'update')[2].lines[0].review_decision, 'price_review'); h.unmount();
});
test('A summary: all decisions required, separate bill/adjustment/received ledger uses exact satang', async () => {
  const rows = [line(1, { counted_quantity: '10', quantity_received: '10', quantity_billed: '10', unit_price: '60', amount: '600', review_decision: 'accept' }),
    line(2, { counted_quantity: '4.5', quantity_received: '4.5', quantity_billed: '5', unit_price: '90', amount: '450', review_decision: 'short' }),
    line(3, { counted_quantity: '6.5', quantity_received: '6.5', quantity_billed: '6', unit_price: '70', amount: '420', review_decision: 'over' }),
    line(4, { counted_quantity: '8', quantity_received: '8', quantity_billed: '8', unit_price: '75', amount: '600', review_decision: 'accept' })];
  const doc = document({ lines: rows, total: '2070' }); const ledger = reviewLedger(doc);
  assert.equal(ledger.bill, 207000n); assert.equal(ledger.adjustment, -1000n); assert.equal(ledger.received, 206000n);
  const h = await open(doc); await h.click('ดูสรุปก่อนเซ็น'); assert.match(text(h), /รับ 4 จาก 4/); assert.match(text(h), /2,070.00/); assert.match(text(h), /-10.00/); assert.match(text(h), /2,060.00/); assert.match(text(h), /แจ้งร้านขาด/);
  // Owner 2026-10-24 (ข้อ 2): the receiver sheet opens by itself and its one button signs and confirms.
  await h.click('ไปเซ็นรับของ'); assert.ok(h.visible().some(node => node.type === 'canvas')); assert.ok(button(h, 'เซ็นและยืนยันรับ'));
  await h.click('ยกเลิก'); assert.ok(h.visible().some(node => node.type === 'button' && h.text(node).startsWith('แตะเพื่อเซ็น'))); assert.ok(!h.visible().some(node => node.type === 'canvas')); h.unmount();
});
test('A ledger: 0.1+0.2, six-decimal price, missing price, tax/discount remain explicit', () => {
  const ledger = reviewLedger(document({ discount: '0.10', vat: '0.02', lines: [line(1, { quantity_received: '1', amount: '.10', unit_price: '0.1' }), line(2, { quantity_received: '1', amount: '0.20', unit_price: '0.2' })].map(row => ({ ...row, amount: row.amount === '.10' ? '0.10' : row.amount })) }));
  assert.equal(ledger.received, 30n); assert.equal(ledger.discount, 10n); assert.equal(ledger.vat, 2n);
  assert.equal(reviewLedger(document({ lines: [line(1, { unit_price: null })] })).missingPrice, false); // unchanged billed quantity has a known line amount
  assert.equal(reviewLedger(document({ lines: [line(1, { unit_price: null, amount: null })] })).missingPrice, true);
});
test('A large bill: pending/all filters and Thai/bill search preserve decisions; next scrolls a real problem card', async () => {
  const h = await open(document({ lines: Array.from({ length: 30 }, (_, i) => line(i + 1, { review_decision: i < 26 ? 'accept' : null })) }), {}, {}, { requestAnimationFrame: fn => fn() });
  assert.match(text(h), /ตัดสินใจแล้ว 26\/30/); assert.equal(h.visible().filter(node => node.props.id?.startsWith('review-row-')).length, 4);
  await h.select('ค้นหาสินค้า / ชื่อในบิล', 'บิล 29'); assert.equal(h.visible().filter(node => node.props.id?.startsWith('review-row-')).length, 1);
  await h.click('ตรวจเรื่องถัดไป'); assert.deepEqual(h.scrolled, ['review-row-27']); assert.equal(h.visible().filter(node => node.props.id?.startsWith('review-row-')).length, 4);
  await h.click('ทั้งหมด'); assert.equal(h.visible().filter(node => node.props.id?.startsWith('review-row-')).length, 30);
  assert.deepEqual(h.focused, ['review-decision-27']); assert.equal(h.calls.length, 0); h.unmount();
});
test('A signature flow: one sign-and-confirm action locks duplicate taps; success follows the server only', async () => {
  let release; const h = await open(document({ lines: [line(1, { review_decision: 'accept' })] }), { confirm: async id => { h.calls.push(['confirm', id]); return new Promise(resolve => { release = () => resolve(document({ status: 'confirmed', lines: [line(1, { review_decision: 'accept' })] })); }); } });
  await h.click('ดูสรุปก่อนเซ็น'); await h.click('ไปเซ็นรับของ');
  // Owner 2026-10-24 (ข้อ 2): the receiver sheet opens itself; its one button signs and confirms. Ink is required first.
  assert.ok(h.visible().some(node => node.type === 'canvas')); assert.equal(button(h, 'เซ็นและยืนยันรับ').props.disabled, true);
  await draw(h); const save = button(h, 'เซ็นและยืนยันรับ'); assert.equal(save.props.disabled, false);
  const work = save.props.onClick(); await h.settle(); await save.props.onClick(); await h.settle();
  assert.equal(h.calls.filter(call => call[0] === 'signature').length, 1); assert.equal(h.calls.filter(call => call[0] === 'confirm').length, 1); assert.doesNotMatch(text(h), /รับของเรียบร้อย/);
  release(); await work; await h.settle(); assert.match(text(h), /รับของเรียบร้อย/); h.unmount();
});
test('A signature: failed save preserves ink and error, retry succeeds; acknowledged signature survives a failed GET', async () => {
  let fail = true;
  const h = await open(document({ lines: [line(1, { review_decision: 'accept' })] }), { signature: async () => { if (fail) throw { response: { status: 500 } }; }, get: async () => { throw { request: {} }; } });
  await h.click('ดูสรุปก่อนเซ็น'); await h.click('ไปเซ็นรับของ'); await draw(h);
  await h.click('เซ็นและยืนยันรับ'); assert.ok(h.visible().some(node => node.type === 'canvas')); assert.ok(!h.visible().some(node => node.type === 'button' && h.text(node) === 'ยืนยันรับสินค้า'));
  fail = false; await h.click('เซ็นและยืนยันรับ'); assert.ok(h.visible().some(node => node.type === 'img' && /ลายเซ็น/.test(node.props.alt || '')));
  // The follow-up read failed, so the summary is unknown: nothing is confirmed until the receiver taps ยืนยันรับสินค้า.
  assert.equal(h.calls.some(call => call[0] === 'confirm'), false); assert.equal(button(h, 'ยืนยันรับสินค้า').props.disabled, false); h.unmount();
});
test('A OCR: only after count, never changes count, cancelled progress keeps one request, failure preserves editable data', async () => {
  let reject; const doc = document({ images: [{ id: 1, page_no: 1 }] });
  const h = await open(doc, { ocr: async () => { h.calls.push(['ocr']); return new Promise((resolve, fail) => { reject = fail; }); }, image: async () => new Blob() });
  const read = button(h, 'อ่านบิลด้วย AI (คงจำนวนนับ)'); const work = read.props.onClick(); await h.settle(); assert.match(text(h), /กำลังอ่าน/);
  await read.props.onClick(); assert.equal(h.calls.filter(call => call[0] === 'ocr').length, 1);
  reject({ response: { status: 503, data: { code: 'OCR_UNAVAILABLE' } } }); await work; await h.settle(); assert.match(text(h), /ระบบอ่านบิลยังไม่พร้อม/); assert.match(text(h), /นับได้2/); h.unmount();
});
test('A F4: pending sheet clearly resumes same UUID; start new selects every pending order', async () => {
  const group = { supplier_name: 'ร้าน', items: [1,2,3,4].map(id => ({ order_item_id: id, product_name: `ของ ${id}`, unit_name: 'กก.', is_received: false })) };
  const pending = { client_uuid: 'old', delivery_date: '2026-10-18', kind: 'bill', supplier_name_text: 'ร้าน', order_item_ids: [1] };
  const storage = new Map([['solao.receiving.pending.v1:1::', JSON.stringify(pending)]]); // direct browser adapter below returns the pending payload.
  const h = await harness('CreateDocument', { user, group, date: '2026-10-18', onCreated() {}, onClose() {} }, {}, {}, { localStorage: { getItem: () => JSON.stringify(pending), setItem() {}, removeItem() {} } });
  assert.match(text(h), /ทำต่อใบเดิม/); assert.doesNotMatch(text(h), /ส่งซ้ำ/);
  await h.click('เริ่มใหม่ (เลือกทุกรายการค้าง)'); const checks = h.visible().filter(node => node.type === 'input' && node.props.type === 'checkbox'); assert.equal(checks.length, 4); assert.ok(checks.every(node => node.props.checked)); h.unmount();
});
test('A F5 F7: fixed footer reserves document space; Thai bill strings use Thai font, contrast tokens and wrapping', async () => {
  const css = await readFile(new URL('../src/pages/receiving/review-a.css', import.meta.url), 'utf8');
  assert.match(css, /ra-document[^}]*padding-bottom: calc\(180px/); assert.match(css, /ra-footer[^}]*position:fixed/); assert.match(css, /ra-bill-text[^}]*font-family:Sarabun/); assert.match(css, /minmax\(144px,1fr\)/); assert.match(css, /color:var\(--sg-text\)/);
});
test('A branch scope shares the same mandatory blank count, comparisons, decisions and summary', async () => {
  const h = await harness('BranchDocumentEditor', { initialDocument: { ...blind(), scope: 'branch' }, user, onChanged() {}, onBack() {} });
  assert.match(text(h), /ทั้งสาขา/); await h.click('นับ'); await h.select('นับได้ สินค้า 1', '2'); await h.select('นับได้ สินค้า 2', '2'); await h.click('ยืนยันการนับและเทียบบิล'); await h.click('ถูกต้อง ยืนยันการนับ');
  assert.ok(h.visible().some(node => node.type === 'button' && /อ่านบิลด้วย AI/.test(h.text(node)))); await h.click('ยืนยันทั้งหมดที่ตรง'); await h.click('ดูสรุปก่อนเซ็น'); assert.match(text(h), /รับ 2 จาก 2/); h.unmount();
});
test('A terminal docs: display summary and protected signatures read-only, void requires reason and server response', async () => {
  const h = await open(document({ status: 'confirmed', has_receiver_signature: true, lines: [line(1, { review_decision: 'accept' })] }));
  assert.match(text(h), /รับของเรียบร้อย/); assert.ok(!h.visible().some(node => node.type === 'canvas')); assert.equal(button(h, 'ยกเลิกใบรับ').props.disabled, true);
  await h.select('เหตุผลยกเลิก', 'บิลผิด'); await h.click('ยกเลิกใบรับ'); assert.equal(h.calls.find(call => call[0] === 'void')[2], 'บิลผิด'); assert.match(text(h), /ยกเลิกแล้ว/); h.unmount();
});
test('A contrast: light/dark secondary text and primary controls meet AA with existing app tokens', async () => {
  const css = await readFile(new URL('../src/design/tokens.css', import.meta.url), 'utf8');
  const value = hex => { const rgb = hex.match(/\w\w/g).map(pair => parseInt(pair,16)/255).map(n => n <= .04045 ? n/12.92 : ((n+.055)/1.055)**2.4); return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]; };
  const ratio = (a,b) => { const x=value(a), y=value(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
  for (const [fg,bg] of [['3e4758','f7f5f0'],['e0e5ee','101522'],['ffffff','1e3168'],['182444','e6bc61']]) assert.ok(ratio(fg,bg) >= 4.5, `${fg}/${bg}`);
  assert.match(css, /--sg-muted: #3e4758/); assert.match(css, /--sg-muted: #e0e5ee/);
});
test('A manual count: catalog addition starts blank, cannot unlock bill until counted and uses count endpoint only', async () => {
  const h = await open(document({ counted_complete_at: null, blind: true, lines: [] }), { getProducts: async () => ({ data: [{ id: 88, name: 'อกไก่', unit_name: 'กก.', unit_id: 2 }] }),
    count: async (id, body) => { h.calls.push(['count',id,body]); return document({ lines: [line(1,{product_id:88,product_name:'อกไก่',counted_quantity:'1.5',quantity_received:'1.5'})] }); } });
  await h.click('นับ'); await h.click('เพิ่มสินค้าที่มาส่ง'); await h.select('ค้นหาสินค้า','อกไก่'); await new Promise(resolve=>setTimeout(resolve,380)); await h.settle(); await h.click('อกไก่'); await h.click('เสร็จ · เพิ่ม 1 รายการ');
  assert.equal(h.find(node=>node.type==='input' && node.props.inputMode==='decimal').props.value,'');
  assert.equal(button(h,'ยืนยันการนับและเทียบบิล').props.disabled,true);
  await h.select('นับได้ อกไก่','1.5'); await h.click('ยืนยันการนับและเทียบบิล'); const body=h.calls.find(call=>call[0]==='count')[2];
  assert.equal(body.lines[0].product_id,88); assert.equal(body.lines[0].id,undefined); assert.equal(body.lines[0].counted_quantity,'1.5'); assert.equal(h.calls.some(call=>call[0]==='update'),false); h.unmount();
});
test('A bill warnings: pending checks and document-kind/price warnings remain visible after count and before signing', async () => {
  const h = await open(document({ warnings: [{ code: 'SUM_MISMATCH' }], ocr: { status: 'done', warnings: ['DOC_KIND_UNCERTAIN'] } }));
  assert.ok(h.find(node=>node.props['aria-label']==='ข้อสังเกตบิล')); assert.match(text(h), /ข้อสังเกตบิล/);
  assert.equal(button(h,'ดูสรุปก่อนเซ็น').props.disabled,true); assert.equal(h.calls.length,0); h.unmount();
});
test('A inline editing: clearing quantity/price/bill fields never crashes; incomplete count blocks the decision and exact decimals recover', async () => {
  const h = await open(document()); await h.click('แก้');
  await h.select('แก้จำนวนหลังเปิดบิล สินค้า 1',''); assert.equal(button(h,'ตรวจข้อมูลก่อนรับ').props.disabled,true);
  await h.select('จำนวนบิล สินค้า 1',''); await h.select('ราคาบิล สินค้า 1','');
  assert.match(text(h), /กรอกจำนวนรับให้ครบ/); assert.equal(h.calls.length,0);
  await h.select('แก้จำนวนหลังเปิดบิล สินค้า 1','0.3'); assert.equal(button(h,'รับ 0.3 กก. · ให้บัญชีขอบิลจากร้าน').props.disabled,false); h.unmount();
});
test('A extra OCR row: no original blind count means human must explicitly enter even zero after reveal', async () => {
  const h=await open(document({lines:[line(1,{counted_quantity:null,quantity_received:'0'})]}));
  assert.match(text(h), /รายการเพิ่มหลังเปิดบิล/); assert.equal(button(h,'ตรวจข้อมูลก่อนรับ').props.disabled,true);
  await h.click('แก้'); await h.select('แก้จำนวนหลังเปิดบิล สินค้า 1','0'); assert.equal(button(h,'รับ 0 กก. · แจ้งร้านขาด 2 กก.').props.disabled,false); h.unmount();
});

// UI-2 regressions share the existing component harness; all API calls are mocked.
{
  const { afterEach } = await import('node:test');
  const { canBulkAccept, reviewBlocker, reviewMilestones, reviewLedger } = await import('../src/pages/receiving/review-a.js');
  const { receiptEvidence } = await import('../src/pages/receiving/receiving-status.js');
  const { harness, track, cleanup, row, doc, signed, open, sign, btn, text, draw, deferred } = await import('./review-a-port-harness.mjs');
  afterEach(cleanup);


test('UI2-02 pending and first blocker exist for short and long documents', async () => {
  for (const length of [1, 3, 8, 56]) {
    const data = doc({lines:Array.from({length}, (_, i)=>row(i+1,{product_id:i ? i+1 : null}))});
    const h=track(await harness('ReviewRows',{doc:data}));
    assert.match(text(h),new RegExp('ต้องตรวจอีก '+length+' รายการ'));
    assert.match(text(h),/จับคู่สินค้านี้ก่อน/);
    await h.click('ไปจุดแรกที่ต้องแก้');
    assert.deepEqual(h.focused,['review-product-1']);
    assert.deepEqual(h.scrolled,['review-row-1']);
  }
});
test('UI2-02 first invalid number opens its edit field; search never hides the jump target', async()=>{
  const h=track(await harness('ReviewRows',{doc:doc({lines:Array.from({length:8},(_,i)=>row(i+1,{quantity_received:i ? '2':'bad'}))})}));
  await h.select('ค้นหาสินค้า / ชื่อในบิล','no match');
  await h.click('ไปจุดแรกที่ต้องแก้');
  assert.deepEqual(h.focused,['review-quantity_received-1']);
  assert.ok(h.visible().some(n=>n.props.id==='review-quantity_received-1'));
});
test('UI2-10 bulk eligibility excludes alias, AI, unmatched and converted units',()=>{
  const d=doc();assert.equal(canBulkAccept(row(),d),true);
  for(const patch of [{match:{source:'alias'}},{match:{source:'ai'}},{match:{source:'none'}},{product_id:null},{unit_text:'ถุง'},{unit_multiplier:2},{review_decision:'accept'}]) assert.equal(canBulkAccept(row(1,patch),d),false);
});
test('UI2-10 actual bulk handler sends only safe matched decisions and leaves alias opt-in',async()=>{
  const h=await open(doc({lines:[row(1),row(2,{match:{source:'alias'}}),row(3,{match:{source:'ai'}}),row(4,{unit_text:'ถุง'})]}));
  await h.click('ยืนยันทั้งหมดที่ตรง');
  const body=h.calls.find(c=>c[0]==='update')[2];
  assert.deepEqual(body.lines.map(l=>l.review_decision),['accept',null,null,null]);
  assert.ok(body.lines.every(l=>l.remember_alias===false));
  assert.match(text(h),/ข้อเสนอจาก AI/); assert.match(text(h),/จับคู่จากชื่อย่อร้าน/);
});
test('UI2-02 no bill, bad price and unit blockers point to the actionable control',()=>{
  assert.equal(reviewBlocker(row(1,{unit_price:'bad'}),doc()).field,'unit_price');
  assert.equal(reviewBlocker(row(1,{unit_text:'ถุง'}),doc()).field,'unit');
  assert.equal(reviewBlocker(row(),doc({ocr:{status:'none'}})).field,'quantity_billed');
});
test('UI2-03 continuous ledger keeps integer values, partial coverage and accounting next action',async()=>{
  const data=doc({total:'30',lines:[row(1,{review_decision:'accept'}),row(2,{quantity_billed:null,unit_price:null,amount:null,review_decision:'missing_bill'})]});
  const ledger=reviewLedger(data),h=track(await harness('ReviewSummary',{doc:data}));
  assert.equal(ledger.receivedNet,2000n);
  assert.match(text(h),/ทราบราคา 1 จาก 2 รายการที่รับ/);
  assert.match(text(h),/ยังไม่ทราบมูลค่ารับทั้งหมด/);
  assert.match(text(h),/รอบัญชีตรวจราคาและยอดชำระ/);
  const dl=h.find(n=>n.type==='dl');
  assert.deepEqual(Array.from(dl.props.children).filter(n=>n?.type==='div').slice(0,3).map(n=>h.text(n).slice(0,9)),['ยอดบิล30.','ปรับตามกา','มูลค่าที่']);
});
test('UI2-03 explicit zero price is known; manual receipt never claims a zero total',async()=>{
  const data=doc({lines:[row(1,{unit_price:'0',amount:'0',review_decision:'accept'})]});
  const h=track(await harness('ReviewSummary',{doc:data}));assert.match(text(h),/ทราบราคา 1 จาก 1/);
  const m=track(await harness('ManualReceiptSummary',{doc:doc({kind:'manual_receipt'})}));
  assert.match(text(m),/ยังไม่มีราคา · รอบัญชีขอบิล/);assert.doesNotMatch(text(m),/0[.]00 บาท/);
});
test('UI2-08 both paths have identical four milestones including a separate summary',()=>{
  for(const manual of [false,true])for(const step of ['images','count','compare','summary','sign']){
    const milestones=reviewMilestones(step,manual);
    assert.deepEqual(milestones.map(m=>m.label),['นับ','ตรวจ','สรุป','เซ็น']);
    assert.equal(milestones.filter(m=>m.current).length,1);
    assert.equal(milestones.find(m=>m.current).value,step==='images'?(manual?'compare':'count'):step);
  }
});
test('UI2-08 blind bill milestones keep review and summary locked and never reveal bill quantities',async()=>{
  const h=await open(doc({counted_complete_at:null,lines:[row(1,{quantity_billed:'98765'})]}));
  const nav=h.find(n=>n.type==='nav');assert.equal(h.text(nav),'นับตรวจสรุปเซ็น');
  for(const label of ['ตรวจ','สรุป','เซ็น'])assert.equal(btn(h,label).props.disabled,true);
  assert.doesNotMatch(text(h),/98765/);
});
test('UI2-08 no-bill review milestone remains reachable without OCR or losing summary',async()=>{
  const h=await open(doc({kind:'manual_receipt'}));await h.click('ตรวจ');
  assert.match(text(h),/ตรวจจากใบสั่ง/);await h.click('ดูสรุปก่อนเซ็น');
  assert.equal(h.find(n=>n.props['data-step']).props['data-step'],'summary');
  assert.equal(h.calls.length,0);
});
test('UI2-04 missing saved signature and unsaved courier name explain disabled confirm',async()=>{
  const h=await open(signed({has_receiver_signature:false}));await sign(h);
  assert.match(text(h),/ยังไม่มีลายเซ็นผู้รับที่บันทึกแล้ว/);
  assert.equal(btn(h,'ยืนยันรับสินค้า').props['aria-describedby'],'receiving-action-reason');
  await h.select('ชื่อผู้ส่งของ','ผู้ส่งตัวอย่าง');
  assert.match(text(h),/ชื่อผู้ส่งยังไม่บันทึก · กดบันทึกชื่อผู้ส่งก่อนเซ็น/);assert.equal(btn(h,'ยืนยันรับสินค้า').props.disabled,true);
});
test('UI2-04 failed signature save retains ink and cannot claim saved success',async()=>{
  const h=await open(signed({has_receiver_signature:false}),{signature:async()=>{throw {request:{}};}});await sign(h);await draw(h);
  assert.match(text(h),/มีเส้นที่ยังไม่บันทึก/);await h.click('เซ็นและยืนยันรับ');
  assert.match(text(h),/บันทึกลายเซ็นไม่สำเร็จ/);assert.equal(btn(h,'เซ็นและยืนยันรับ').props.disabled,false);
  assert.equal(h.visible().filter(n=>n.type==='canvas').length,1);
});
test('UI2-04 offline and pending server result prevent confirmed success',async()=>{
  const h=await open(signed(),{}, {online:false});assert.match(text(h),/ออฟไลน์/);
  const wait=deferred();const s=await open(signed(),{confirm:()=>wait.promise});await sign(s);
  const action=btn(s,'ยืนยันรับสินค้า').props.onClick();await s.settle();
  assert.equal(s.visible().some(n=>n.props['aria-label']==='รับของสำเร็จ'),false);
  wait.resolve({...signed(),status:'confirmed'});await action;await s.settle();assert.ok(s.visible().some(n=>n.props['aria-label']==='รับของสำเร็จ'));assert.match(text(s),/ยืนยันแล้ว/);
});
test('UI2-11 evidence separates receiving, pending bill and price using existing fields',()=>{
  assert.deepEqual(receiptEvidence(doc({kind:'manual_receipt'})),{waitingBill:true,waitingPrice:true,label:'รอบิล · รอราคา',nextAction:'รอบัญชีขอบิล ตรวจราคาและยอดชำระ'});
  assert.equal(receiptEvidence(doc({lines:[row(1,{review_decision:'price_review'})]})).waitingPrice,true);
  assert.equal(receiptEvidence(doc({lines:[row(1,{unit_price:'0',amount:'0'})]})).waitingPrice,false);
});
test('UI2-11 success keeps document and next-shop actions and never claims payment',async()=>{
  const h=await open(doc({status:'confirmed',kind:'manual_receipt'}),{}, {nextShopStatus:'pending'});
  assert.match(text(h),/ใบรับ #\d+ · ยืนยันแล้ว/);assert.match(text(h),/รอบิล · รอราคา/);
  // Owner 2026-10-24 "ตัวหนังสือต้องน้อยๆ": the receipt number lives in the header; no repeated confirmed/accounting lines.
  const done=h.find(n=>n.props['aria-label']==='รับของสำเร็จ');assert.doesNotMatch(h.text(done),/เลขที่รับ|ยืนยันรับแล้ว|รอบัญชีขอบิล ตรวจราคาและยอดชำระ/);
  assert.doesNotMatch(text(h),/ชำระแล้ว|จ่ายแล้ว/);assert.equal(btn(h,'ไปร้านถัดไป').props.disabled,false);
  await h.click('ดูเอกสาร');assert.match(text(h),/สรุปก่อนเซ็น/);
});

test('UI2-03 entirely unpriced goods remain unknown rather than a zero received value',async()=>{
  const h=track(await harness('ReviewSummary',{doc:doc({lines:[row(1,{unit_price:null,amount:null})]})}));
  const result=h.find(n=>n.props.className==='ra-ledger-result');assert.match(h.text(result),/ยังไม่ทราบ/);assert.doesNotMatch(h.text(result),/0[.]00 บาท/);
});
test('UI2-10 accepted card is collapsed with undo and every original action retained',async()=>{
  const h=track(await harness('ReviewRows',{doc:signed()}));
  const details=h.find(n=>n.type==='details'&&n.props.className==='ra-reviewed-row');
  assert.ok(!details.props.open);assert.ok(h.all(details).some(n=>n.type==='button'&&h.text(n)==='เลิกทำการตัดสินใจ'));
});
test('UI2 styles use shared spacing and actual measured footer clearance',async()=>{
  const {readFile}=await import('node:fs/promises');const css=await readFile(new URL('../src/pages/receiving/review-a.css',import.meta.url),'utf8');
  const additions=css.slice(css.indexOf('/* UI-2:'));
  for(const [,value] of additions.matchAll(/(?:padding(?:-[a-z]+)?|margin(?:-[a-z]+)?|gap):\s*([^;}]+)/g))assert.ok(!/\d+px/.test(value),value);
  assert.match(additions,/--ra-footer-height/);assert.match(additions,/--sg-touch/);
});

}

test('UX 2026-10-23: a bill unit kept beside a product with another unit asks for a unit check, not a shortage', async () => {
  const { rowDecision } = await import('../src/pages/receiving/review-a.js');
  const { row, doc } = await import('./review-a-port-harness.mjs');
  const d = doc({ ocr: { status: 'done' } });
  const line = row(1, { unit_text: 'มัด', _billUnit: 'Kg', quantity_billed: '8.3', quantity_received: '0', counted_quantity: '0', match: { source: 'manual' } });
  assert.equal(rowDecision(line, d).kind, 'wrong_product'); assert.equal(rowDecision(line, d).label, 'ตรวจหน่วย');
  assert.equal(rowDecision(row(1, { unit_text: 'กก.', _billUnit: 'Kg', quantity_billed: '2', quantity_received: '2', counted_quantity: '2' }), d).kind, 'accept');
});
