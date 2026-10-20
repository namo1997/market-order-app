import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProductSheet, IMPORT_COLUMNS } from '../src/pages/admin/receiving/supplier-product-import.js';
import { harness } from './receiving-harness.mjs';
const plain = value => JSON.parse(JSON.stringify(value));
const header = IMPORT_COLUMNS.join(',');
const options = { default_group_id: 1, groups: [{ id: 1, name: 'ร้าน SYNTHETIC' }], units: [{ id: 1, name: 'แผง' }], departments: [{ id: 1, name: 'ครัว', branch_name: 'สาขาทดสอบ' }] };
const entryPath = '../src/pages/admin/receiving/SupplierProductCreate.jsx';
const preview = { valid: true, preview_hash: 'a'.repeat(64), items: [{ row: 1, name: 'ไข่', unit: 'แผง', price: '139.00', bill_text: 'ไข่', item_code: 'SYN-5002', group: 'ร้าน SYNTHETIC', errors: [] }] };
const rows = [{ name: 'ไข่', unit: 'แผง', price: '139', bill_text: '', item_code: 'SYN-5002', group: '' }];
async function setup(overrides = {}) {
  const calls = [];
  const actions = { productOptions: async () => options, previewProducts: async body => { calls.push(['preview', plain(body)]); return preview; },
    createProducts: async body => { calls.push(['create', plain(body)]); return { count: 1 }; }, ...overrides };
  const h = await harness('SupplierProductCreate', { actions, onChanged: () => calls.push(['reload']) }, {}, {}, {}, {}, null, entryPath);
  await h.click('+ เพิ่มสินค้าใหม่ให้ร้านนี้');
  return { h, calls };
}
async function fill(h) {
  for (const [label, value] of [['ชื่อสินค้า', 'ไข่'], ['หน่วย', 'แผง'], ['ราคาเริ่มต้น', '139'], ['รหัสสินค้าในบิล', 'SYN-5002']]) await h.select(label, value);
  h.find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } }); await h.settle();
}
const submit = async h => { await h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await h.settle(); };

test('CSV/Excel parser: exact headers, BOM, quoted comma and escaped quote, TSV, blank rows; rejects malformed or oversize input', () => {
  assert.deepEqual(parseProductSheet(`\uFEFF${header}\r\nไข่,แผง,139,ไข่,SYN-5002,\r\n`), [{ ...rows[0], bill_text: 'ไข่' }]);
  assert.equal(parseProductSheet(`${header}\n"ข้าว, ใหม่",ถุง,410,"ข้าว ""ดี""",SYN-2010,`)[0].bill_text, 'ข้าว "ดี"');
  assert.equal(parseProductSheet(`${IMPORT_COLUMNS.join('\t')}\nไข่\tแผง\t139\tไข่\tSYN-5002\t\n\n`)[0].name, 'ไข่');
  for (const value of ['', `${header}\n`, `ชื่อ,หน่วย\nไข่,แผง`, `${header}\nไข่,แผง,139`, `${header}\n"ไข่,แผง,139,ไข่,X,`, `${header}\n"ไข่"oops,แผง,139,ไข่,X,`, 'x'.repeat(100001), `${header}\n${'ไข่,แผง,139,ไข่,X,\n'.repeat(101)}`]) assert.throws(() => parseProductSheet(value));
});

test('single product flow: required department, preview before commit, canonical rows and options, reload and success', async () => {
  const { h, calls } = await setup();
  assert.equal(h.find(node => node.type === 'button' && h.text(node) === 'ตรวจตัวอย่างก่อนเพิ่ม').props.disabled, true);
  await fill(h); await submit(h);
  assert.match(h.text(h.visible()), /ตัวอย่างก่อนยืนยัน/); assert.equal(calls[0][0], 'preview');
  assert.deepEqual(calls[0][1], { rows, department_ids: [1], default_group_id: 1, is_countable: true, allow_pending_carryover: false });
  await h.click('ยืนยันเพิ่ม 1 รายการ');
  assert.equal(calls[1][1].preview_hash, preview.preview_hash); assert.ok(calls[1][1].request_id);
  assert.equal(calls[2][0], 'reload'); assert.match(h.text(h.visible()), /เพิ่มสินค้า 1 รายการ และผูกชื่อย่อ/);
  h.unmount();
});

test('edited data invalidates preview; server row errors disable commit; Excel mode sends parsed rows', async () => {
  const { h, calls } = await setup(); await fill(h); await submit(h);
  await h.select('ชื่อสินค้า', 'ไข่ใหม่'); assert.doesNotMatch(h.text(h.visible()), /ตัวอย่างก่อนยืนยัน/);
  await h.select('วิธีเพิ่ม', 'sheet');
  await h.select('วางตารางจาก Excel', `${header}\nไข่,แผง,139,ไข่,SYN-5002,`); await submit(h);
  assert.equal(calls.at(-1)[1].rows[0].name, 'ไข่'); h.unmount();
  const bad = await setup({ previewProducts: async () => ({ ...preview, valid: false, items: [{ row: 1, errors: ['รหัสสินค้าในบิลซ้ำ'] }] }) });
  await fill(bad.h); await submit(bad.h);
  assert.match(bad.h.text(bad.h.visible()), /รหัสสินค้าในบิลซ้ำ/);
  assert.equal(bad.h.find(n => n.type === 'button' && bad.h.text(n) === 'ยืนยันเพิ่ม 1 รายการ').props.disabled, true); bad.h.unmount();
});

test('network retry keeps request id; 409 and 403 are visible; double submit creates once', async () => {
  let attempts = 0; const sent = [];
  const { h } = await setup({ createProducts: async body => { sent.push(plain(body)); if (++attempts === 1) throw { response: { status: 409, data: { message: 'ข้อมูลเปลี่ยนแล้ว กรุณาตรวจใหม่' } } }; return { count: 1 }; } });
  await fill(h); await submit(h); await h.click('ยืนยันเพิ่ม 1 รายการ'); assert.match(h.text(h.visible()), /ข้อมูลเปลี่ยนแล้ว/);
  await h.click('ยืนยันเพิ่ม 1 รายการ'); assert.equal(sent[0].request_id, sent[1].request_id); h.unmount();
  const denied = await setup({ productOptions: async () => { throw { response: { status: 403 } }; } });
  assert.match(denied.h.text(denied.h.visible()), /ไม่มีสิทธิ์/); denied.h.unmount();
});
