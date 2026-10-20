import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { doc, row, open, text, btn, chooseFile } from './review-a-port-harness.mjs';
import { harness } from './receiving-harness.mjs';
import { countedBillTargets, matchBillToCount } from '../src/pages/receiving/counted-bill-match.js';
const counts = () => [row(1, { product_name: 'น้ำแข็งบด (ใช้ครัว)', order_item_id: null, quantity_ordered: null, ordered_price: null, ordered_unit: null, unit_text: 'ถุง', counted_quantity: '4', quantity_received: '4', bill_text: '', quantity_billed: null }),
  row(2, { product_name: 'น้ำแข็งหลอดใหญ่', order_item_id: null, quantity_ordered: null, ordered_price: null, ordered_unit: null, unit_text: 'ถุง', counted_quantity: '10', quantity_received: '10', bill_text: '', quantity_billed: null })];
const unknown = () => row(3, { product_id: null, product_name: null, order_item_id: null, bill_text: 'หลอดเล็ก', unit_text: 'ถุง', counted_quantity: null, quantity_received: '0', quantity_billed: '4', unit_price: '25', amount: '100' });

test('N2 supplier and recommended products render explicit option cards; product name and unit share one identity row', async () => {
  const changes = [];
  const supplier = { supplier_key: 'sm:1', supplier_master_id: 1, name: 'ร้านน้ำแข็ง vic', code: 'SYN-VIC' };
  const h = await harness('SupplierPicker', { name: 'vic', user: { branch_id: 1, department_id: 10 }, onChange: (...v) => changes.push(v) }, { suppliers: async () => [supplier] });
  await new Promise(resolve => setTimeout(resolve, 280)); await h.settle();
  const option = h.find(n => n.type === 'button' && h.text(n).includes('SYN-VIC'));
  assert.equal(option.props.className, 'rc-option-card'); await h.click(h.text(option)); assert.equal(changes[0][1].supplier_key, 'sm:1');
  const added = [];
  const p = await harness('SupplierProductSuggestions', { doc: doc({ supplier_master_id: 1, lines: [] }), user: {}, online: true, onAdd: v => added.push(v) }, { supplierProducts: async () => [{ id: 7, name: 'น้ำแข็งบด (ใช้ครัว)', unit_name: 'ถุง' }] });
  assert.match(p.find(n => n.type === 'button').props.className, /rc-option-card/);
  const identity = p.find(n => n.props.className === 'rc-product-identity'); assert.equal(p.text(identity), 'น้ำแข็งบด (ใช้ครัว)ถุง');
  await p.click('น้ำแข็งบด (ใช้ครัว)ถุง'); assert.equal(added[0].product_id, 7);
  const css = await readFile(new URL('../src/pages/receiving/receiving.css', import.meta.url), 'utf8');
  assert.match(css, /\.rc-option-card \{[^}]*min-height:var\(--sg-space-14\)/); assert.match(css, /\.rc-product-identity \{[^}]*display:flex/);
});

test('N3 selecting a bill after counting immediately uploads every page and reads once, even after previous OCR done', async () => {
  for (const previous of ['none', 'done']) {
    let saved = doc({ ocr: { status: previous }, lines: counts() }); const actions = [];
    const h = await open(saved, { uploadImage: async (_id, page) => { actions.push(`upload:${page}`); saved = { ...saved, images: [...saved.images, { id: page, page_no: page }] }; },
      get: async () => { actions.push('get'); return saved; }, ocr: async () => { actions.push('ocr'); saved = { ...saved, ocr: { status: 'done' } }; return saved; } });
    await h.click('ดู / เพิ่มรูปบิล'); await chooseFile(h); await h.settle();
    assert.deepEqual(actions, ['upload:1','get','ocr']); assert.match(text(h), /ตัดสินใจแล้ว/);
    await h.settle(); assert.equal(actions.filter(a => a === 'ocr').length, 1);
    assert.equal(saved.lines[0].counted_quantity, '4'); h.unmount();
  }
});

test('N3 failed upload remains retryable with identical page number and no automatic retry/OCR', async () => {
  const uploads = []; let fail = true; let saved = doc({ lines: counts() }); let reads = 0;
  const h = await open(saved, { uploadImage: async (...args) => { uploads.push(args); if (fail) throw { request: {} }; saved = { ...saved, images: [{ id: 1, page_no: 1 }] }; },
    get: async () => saved, ocr: async () => { reads++; return saved; } });
  await h.click('ดู / เพิ่มรูปบิล'); await chooseFile(h); await h.settle();
  assert.equal(uploads.length, 1); assert.equal(reads, 0); assert.match(text(h), /รอส่ง 1 หน้า/);
  await h.settle(); assert.equal(uploads.length, 1);
  fail = false; await h.click('กลับเทียบบิล'); assert.deepEqual(uploads[0], uploads[1]); assert.equal(reads, 1);
});

test('N3 ambiguous automatic OCR requires read-only recovery and never repeats a paid write', async () => {
  let saved = doc({ lines: counts() }); let reads = 0;
  const h = await open(saved, { uploadImage: async () => { saved = { ...saved, images: [{ id: 1, page_no: 1 }] }; }, get: async () => saved,
    ocr: async () => { reads++; throw { request: {} }; } });
  await h.click('ดู / เพิ่มรูปบิล'); await chooseFile(h); await h.settle();
  assert.equal(reads, 1); assert.match(text(h), /ตรวจผลล่าสุดก่อนส่งอีกครั้ง/);
  await h.settle(); assert.equal(reads, 1);
  await h.click('ตรวจผลล่าสุด'); assert.equal(reads, 1);
});

test('N3 blind capture stays local and never opens bill/OCR before confirmed counts', async () => {
  const h = await open(doc({ counted_complete_at: null, lines: counts(), ocr: { status: 'locked' } }));
  await chooseFile(h); await h.settle(); assert.match(text(h), /ซ่อนรูปบิลไว้ระหว่างนับของ/);
  assert.equal(h.calls.some(c => ['upload', 'ocr'].includes(c[0])), false);
});

test('N4 one tap maps unknown bill into original counted row, alias opt-in stays accessible and PUT deletes only the OCR extra', async () => {
  const initial = doc({ scope: 'department', lines: [...counts(), unknown()] });
  const h = await open(initial);
  await h.click('หลอดเล็ก → น้ำแข็งบด (ใช้ครัว) · นับได้ 4 ถุง');
  assert.match(text(h), /ในบิลเขียน หลอดเล็ก → น้ำแข็งบด \(ใช้ครัว\)/);
  const remember = h.find(n => n.type === 'input' && n.props.type === 'checkbox');
  assert.equal(remember.props.checked, false); remember.props.onChange({ target: { checked: true } }); await h.settle();
  await h.click('ยืนยันรับ 4'); const body = h.calls.find(c => c[0] === 'update')[2];
  assert.deepEqual(Array.from(body.deleted_line_ids), [3]); assert.equal(body.lines.length, 2);
  assert.equal(body.lines[0].id, 1); assert.equal(body.lines[0].quantity_received, '4.00'); assert.equal(body.lines[0].quantity_billed, '4.00');
  assert.equal(body.lines[0].bill_text, 'หลอดเล็ก'); assert.equal(body.lines[0].remember_alias, true);
  assert.equal(body.lines[0].match.source, 'manual'); assert.equal(body.lines[0].order_item_id, null);
  assert.equal(initial.lines[0].counted_quantity, '4');
});

test('N4 no silent overwrite: rejects filled/decided/wrong-unit targets and branch scope, preserves count evidence on valid match', () => {
  const initial = doc({ lines: [...counts(), unknown()] });
  const next = matchBillToCount(initial, 3, 1); assert.equal(next.lines.length, 2);
  for (const key of ['id','counted_quantity','quantity_received','product_id','unit_text','order_item_id']) assert.equal(next.lines[0][key], initial.lines[0][key]);
  assert.equal(next.lines[0].remember_alias, false); assert.equal(initial.lines.length, 3);
  for (const patch of [{ bill_text: 'already', quantity_billed: '4' }, { review_decision: 'missing_bill' }, { unit_text: 'ลัง' }]) {
    const d = doc({ lines: [{ ...counts()[0], ...patch }, unknown()] }); assert.equal(countedBillTargets(d, d.lines[1]).length, 0); assert.equal(matchBillToCount(d, 3, 1), null);
  }
  assert.equal(matchBillToCount({ ...initial, scope: 'branch' }, 3, 1), null);
});

test('N3 partial multipage upload stops after one failure; OCR waits for explicit retry and all acknowledgements', async () => {
  const uploads = [], reads = []; let sequence = 0; let fail = true, saved = doc({ lines: counts() });
  const h = await open(saved, { uploadImage: async (_id, pageNo) => { uploads.push(pageNo); if (pageNo === 2 && fail) throw { request: {} }; saved = { ...saved, images: [...saved.images.filter(p => p.page_no !== pageNo), { id: pageNo, page_no: pageNo }] }; },
    get: async () => saved, ocr: async () => { reads.push(saved.images.length); return saved; } }, {}, { crypto: { randomUUID: () => `n-page-${++sequence}` } });
  await h.click('ดู / เพิ่มรูปบิล');
  const { fakeFile } = await import('./review-a-port-harness.mjs');
  const input = h.find(n => n.type === 'input' && n.props.type === 'file');
  await input.props.onChange({ target: { files: [fakeFile(), fakeFile()], value: '' } }); await h.settle();
  assert.deepEqual(uploads, [1,2]); assert.deepEqual(reads, []); await h.settle(); assert.deepEqual(uploads, [1,2]);
  fail = false; await h.click('กลับเทียบบิล'); assert.deepEqual(uploads, [1,2,2]); assert.deepEqual(reads, [2]);
});

test('N4 failed merge save retains count mapping, alias opt-in and deleted OCR ID for identical retry', async () => {
  let fail = true;const sent = [];
  const h = await open(doc({ lines: [...counts(), unknown()] }), { update: async (_id, body) => { sent.push(body); if (fail) throw { response: { status: 500 } };return doc({ lines: body.lines }); } });
  await h.click('หลอดเล็ก → น้ำแข็งบด (ใช้ครัว) · นับได้ 4 ถุง');
  const checkbox = h.find(n => n.type === 'input' && n.props.type === 'checkbox');checkbox.props.onChange({ target: { checked: true } });await h.settle();
  await h.click('ยืนยันรับ 4');assert.match(text(h), /ส่งข้อมูลไม่สำเร็จ/);assert.match(text(h), /นับได้/);
  fail = false;await h.click('ยืนยันรับ 4');assert.deepEqual(sent[0], sent[1]);assert.deepEqual(Array.from(sent[1].deleted_line_ids), [3]);assert.equal(sent[1].lines[0].remember_alias, true);
});

test('N3 acknowledged upload followed by failed refresh requires read-only recovery, retaining server images without a duplicate upload', async () => {
  let saved = doc({ lines: counts() }), fail = true, uploads = 0, reads = 0;
  const h = await open(saved, { uploadImage: async () => { uploads++;saved = { ...saved, images: [{ id: 1, page_no: 1 }] }; },
    get: async () => { if (fail) throw { request: {} };return saved; }, ocr: async () => { reads++;return saved; } });
  await h.click('ดู / เพิ่มรูปบิล');await chooseFile(h);await h.settle();
  assert.equal(uploads, 1);assert.equal(reads, 0);assert.match(text(h), /โหลดรูปที่บันทึก.*ตรวจผลล่าสุด/);
  fail = false;await h.click('ตรวจผลล่าสุด');assert.equal(uploads, 1);assert.equal(reads, 0);
  await h.click('อ่านบิลด้วย AI (คงจำนวนนับ)');assert.equal(reads, 1);assert.equal(uploads, 1);
});
