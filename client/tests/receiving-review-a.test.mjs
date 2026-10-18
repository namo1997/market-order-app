import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { harness } from './receiving-harness.mjs';
import { rowDecision, reviewLedger } from '../src/pages/receiving/review-a.js';
import { quantityStatus } from '../src/pages/receiving/receiving-status.js';
const user = { id: 1, role: 'admin', name: 'ผู้รับ' };
const line = (id = 1, patch = {}) => ({ id, line_no: id, product_id: id + 6, product_name: `สินค้า ${id}`, bill_text: id === 1 ? 'ทB' : `บิล ${id}`, order_item_id: 40 + id,
  unit_text: 'กก.', ordered_unit: 'kg', unit_id: 2, counted_quantity: '2', quantity_received: '2', quantity_billed: '2', quantity_ordered: '2', unit_price: '10', ordered_price: '10', amount: '20', remember_alias: false, match: { source: 'order', confidence: 1 }, ...patch });
const document = (patch = {}) => ({ id: 5, client_uuid: 'count-fixture', status: 'draft', kind: 'bill', branch_id: 1, department_id: 10, delivery_date: '2026-10-18', supplier_name_text: 'ร้านทดสอบ', counted_complete_at: '2026-10-18T00:00:00Z', images: [], warnings: [], ocr: { status: 'done' }, lines: [line()], ...patch });
const blind = () => document({ counted_complete_at: null, blind: true, lines: [line(1, { counted_quantity: null }), line(2, { counted_quantity: null })] });
const open = (doc = document(), api = {}, props = {}, runtime = {}) => harness('DocumentEditor', { initialDocument: doc, user, onBack() {}, onChanged() {}, ...props }, api, {}, {}, runtime);
const text = h => h.text(h.visible());
const button = (h, label) => h.find(node => node.type === 'button' && h.text(node) === label);
const draw = async (h, index = 0) => { const canvas = h.visible().filter(node => node.type === 'canvas')[index]; canvas.props.onPointerDown({ button: 0, pointerType: 'mouse', pointerId: 1, clientX: 50, clientY: 50, preventDefault() {} }); canvas.props.onPointerUp(); await h.settle(); };

test('A blind: untrusted prefilled order/OCR numbers and thumbnails never render; count fields start empty, zero is intentional', async () => {
  let imageReads = 0;
  const doc = blind(); doc.total = '99999'; doc.images = [{ id: 1, page_no: 1 }];
  const h = await open(doc, { image: async () => { imageReads++; return new Blob(); } });
  assert.doesNotMatch(text(h), /99999|ทB|นับได้.*2\.00/); assert.equal(imageReads, 0);
  assert.ok(!h.visible().some(node => node.type === 'img' && /บิลหน้า/.test(node.props.alt || '')));
  await h.click('นับของ');
  const inputs = h.visible().filter(node => node.type === 'input' && node.props.inputMode === 'decimal');
  assert.equal(inputs.length, 2); assert.ok(inputs.every(node => node.props.value === ''));
  assert.equal(button(h, 'ยืนยันการนับและเทียบบิล').props.disabled, true); assert.match(text(h), /เหลือ 2 รายการ/);
  await h.select('นับได้ สินค้า 1', '4.5'); assert.match(text(h), /เหลือ 1 รายการ/);
  await h.select('นับได้ สินค้า 2', '0'); assert.equal(button(h, 'ยืนยันการนับและเทียบบิล').props.disabled, false);
  await h.click('ยืนยันการนับและเทียบบิล');
  const sent = h.calls.find(call => call[0] === 'count')[2]; assert.equal(sent.client_uuid, doc.client_uuid); assert.deepEqual(Array.from(sent.lines, row => row.counted_quantity), ['4.5', '0']);
  assert.match(text(h), /ในบิลเขียน ทB/); h.unmount();
});
test('A blind: negative, oversized and incomplete counts cannot submit; offline cannot send', async () => {
  const h = await open(blind()); await h.click('นับของ');
  await h.select('นับได้ สินค้า 1', '-1'); await h.select('นับได้ สินค้า 2', '100000000');
  assert.equal(button(h, 'ยืนยันการนับและเทียบบิล').props.disabled, true); assert.equal(h.calls.length, 0); h.unmount();
  const off = await open(blind(), {}, { online: false }); assert.equal(button(off, 'นับของ').props.disabled, true); assert.match(text(off), /ออฟไลน์/); off.unmount();
});
test('A blind: API failure retains entered quantities and retry identity; dirty guard protects leaving', async () => {
  const sent = [], dirty = []; let fails = true;
  const h = await open(blind(), { count: async (id, body) => { sent.push(body); if (fails) throw { request: {} }; return document({ lines: [line(), line(2)] }); } }, { onDirtyChange: value => dirty.push(value) });
  await h.click('นับของ'); await h.select('นับได้ สินค้า 1', '1.25'); await h.select('นับได้ สินค้า 2', '0');
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
  await h.click('ไปเซ็นรับของ'); assert.ok(h.visible().some(node => node.type === 'canvas')); h.unmount();
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
  assert.equal(h.focused.length, 0); assert.equal(h.calls.length, 0); h.unmount();
});
test('A signature flow: locks duplicate saves, keeps acknowledged proof, requires all ink saved before confirm, success follows server only', async () => {
  let release; const h = await open(document({ lines: [line(1, { review_decision: 'accept' })] }), { confirm: async id => { h.calls.push(['confirm', id]); return new Promise(resolve => { release = () => resolve(document({ status: 'confirmed', lines: [line(1, { review_decision: 'accept' })] })); }); } });
  await h.click('ดูสรุปก่อนเซ็น'); await h.click('ไปเซ็นรับของ'); assert.equal(button(h, 'ยืนยันรับสินค้า').props.disabled, true);
  await draw(h); const save = h.visible().find(node => node.type === 'button' && h.text(node) === 'บันทึกเซ็น'); await save.props.onClick(); await h.settle();
  assert.ok(h.calls.some(call => call[0] === 'signature')); assert.equal(button(h, 'ยืนยันรับสินค้า').props.disabled, false);
  await draw(h, 0); // remaining canvas is optional courier; unsaved ink blocks confirmation.
  assert.equal(button(h, 'ยืนยันรับสินค้า').props.disabled, true);
  const courierSave = h.visible().find(node => node.type === 'button' && h.text(node) === 'บันทึกเซ็น'); await courierSave.props.onClick(); await h.settle();
  const confirm = button(h, 'ยืนยันรับสินค้า'); const work = confirm.props.onClick(); await h.settle(); await confirm.props.onClick(); assert.equal(h.calls.filter(call => call[0] === 'confirm').length, 1); assert.doesNotMatch(text(h), /รับของเรียบร้อย/);
  release(); await work; await h.settle(); assert.match(text(h), /รับของเรียบร้อย/); h.unmount();
});
test('A signature: failed save preserves ink and error, retry succeeds; acknowledged signature survives a failed GET', async () => {
  let fail = true;
  const h = await open(document({ lines: [line(1, { review_decision: 'accept' })] }), { signature: async () => { if (fail) throw { response: { status: 500 } }; }, get: async () => { throw { request: {} }; } });
  await h.click('ดูสรุปก่อนเซ็น'); await h.click('ไปเซ็นรับของ'); await draw(h);
  await h.click('บันทึกเซ็น'); assert.ok(h.visible().some(node => node.type === 'canvas')); assert.equal(button(h, 'ยืนยันรับสินค้า').props.disabled, true);
  fail = false; await h.click('บันทึกเซ็น'); assert.ok(h.visible().some(node => node.type === 'img' && /ลายเซ็น/.test(node.props.alt || ''))); h.unmount();
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
  assert.match(text(h), /ทั้งสาขา/); await h.click('นับของ'); await h.select('นับได้ สินค้า 1', '2'); await h.select('นับได้ สินค้า 2', '2'); await h.click('ยืนยันการนับและเทียบบิล');
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
  await h.click('นับของ'); await h.click('เพิ่มสินค้าที่มาส่ง'); await h.select('ค้นหาสินค้า','อกไก่'); await new Promise(resolve=>setTimeout(resolve,380)); await h.settle(); await h.click('อกไก่');
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
