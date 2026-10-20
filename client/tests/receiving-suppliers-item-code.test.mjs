import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';
import { aliasBody, aliasChanges, aliasDraftFrom, aliasProblem, auditSummary, cleanItemCode, emptyAliasDraft, filterAliases,
  itemCodeProblem } from '../src/pages/admin/receiving/receiving-suppliers.js';

// SYNTHETIC data only. Accounting adds/edits the supplier's printed item code ("รหัสสินค้าในบิล") on an alias.
const plain = value => JSON.parse(JSON.stringify(value));
const alias = (patch = {}) => ({ id: 1, bill_text: 'ไข่เบอร์ 1', unit_text: 'ฟอง', item_code: '5002', product_id: 10, product_name: 'ไข่ไก่ เบอร์ 1', unit_name: 'ฟอง',
  confirm_count: 3, is_active: true, updated_at: '2026-10-18T05:00:00Z', updated_by_name: 'บัญชีทดสอบ', ...patch });
const detail = (patch = {}) => ({ supplier_key: 'sm:1', kind: 'master', code: 'SYN-SM-1', name: 'ร้านทดสอบ A', is_active: true, ordering_mode: 'system', branches_note: null,
  bill_format_note: null, ordering_note: null, branches_seen: [], branch_codes: [], audits: [],
  aliases: [alias(), alias({ id: 2, bill_text: 'ทB', item_code: null, product_name: 'ขา B', is_active: false }), alias({ id: 3, bill_text: 'เบคอน', item_code: '2010', product_name: 'เบคอนรมควัน' })],
  ...patch });
const Detail = '../src/pages/admin/receiving/ReceivingSupplierDetail.jsx';
const mount = async (actions, props = {}) => {
  const h = await harness('ReceivingSupplierDetail', { detail: detail(), actions, onChanged: () => {}, ...props }, {}, {}, {}, {}, null, Detail);
  await new Promise(resolve => setTimeout(resolve, 20)); await h.settle(); return h;
};
const input = (h, placeholderPart) => h.all().find(node => node.type === 'input' && String(node.props.placeholder || '').includes(placeholderPart));
const form = (h, className) => h.all().find(node => node.type === 'form' && String(node.props.className || '').includes(className));

test('helpers: item code is cleaned, validated like the server and sent only when present; clearing sends null', () => {
  assert.equal(cleanItemCode(' ab 12-3 '), 'AB12-3');
  assert.equal(itemCodeProblem(''), ''); assert.equal(itemCodeProblem('5002'), ''); assert.equal(itemCodeProblem('A-1/2'), '');
  for (const bad of ['0812345678', '1-2345-67890-12-3', '0105555123456', 'x'.repeat(41), 'ไข่', '<b>', '-1']) assert.match(itemCodeProblem(bad), /รหัสสินค้าในบิล/, bad);
  assert.equal(emptyAliasDraft.item_code, '');
  assert.equal(aliasDraftFrom(alias()).item_code, '5002'); assert.equal(aliasDraftFrom(alias({ item_code: null })).item_code, '');
  const draft = { ...aliasDraftFrom(alias()), item_code: ' 5002 ' };
  assert.deepEqual(plain(aliasBody(draft)), { bill_text: 'ไข่เบอร์ 1', unit_text: 'ฟอง', product_id: 10, item_code: '5002' });
  assert.deepEqual(plain(aliasBody({ ...draft, item_code: '' })), { bill_text: 'ไข่เบอร์ 1', unit_text: 'ฟอง', product_id: 10 }, 'no code, no field');
  assert.deepEqual(plain(aliasChanges(draft, alias())), {}, 'unchanged code is not sent');
  assert.deepEqual(plain(aliasChanges({ ...draft, item_code: '5003' }, alias())), { item_code: '5003' });
  assert.deepEqual(plain(aliasChanges({ ...draft, item_code: '' }, alias())), { item_code: null }, 'blank field clears the code');
  assert.deepEqual(plain(aliasChanges({ ...draft, item_code: '77' }, alias({ item_code: null }))), { item_code: '77' });
  assert.match(aliasProblem({ ...draft, item_code: '0812345678' }), /เบอร์โทร/); assert.equal(aliasProblem(draft), '');
  assert.match(auditSummary({ action: 'alias_create', after: { bill_text: 'ไข่เบอร์ 1', item_code: '5002', product_name: 'ไข่' } }), /\[5002\] ไข่เบอร์ 1/);
});

test('helpers: alias search matches bill text, printed code, unit and product, and never reorders rows', () => {
  const rows = detail().aliases;
  assert.deepEqual(filterAliases(rows, '').map(row => row.id), [1, 2, 3]);
  assert.deepEqual(filterAliases(rows, '5002').map(row => row.id), [1]);
  assert.deepEqual(filterAliases(rows, ' 20 10 ').map(row => row.id), [3], 'spaces inside a code are ignored');
  assert.deepEqual(filterAliases(rows, 'เบคอน').map(row => row.id), [3]);
  assert.deepEqual(filterAliases(rows, 'ขา b').map(row => row.id), [2]);
  assert.deepEqual(filterAliases(rows, 'ฟอง').map(row => row.id), [1, 2, 3], 'unit text, original order kept');
  assert.deepEqual(filterAliases(rows, 'ไม่มีคำนี้'), []);
});

test('detail page shows the item code column and field, searches the table, and keeps the stable row order', async () => {
  const h = await mount({ searchProducts: async () => ({ items: [] }) });
  const text = () => h.text(h.visible());
  assert.match(text(), /รหัสสินค้าในบิล/); assert.match(text(), /5002/); assert.match(text(), /2010/);
  const field = input(h, 'เช่น 5002');
  assert.ok(field, 'form field exists'); assert.equal(field.props.maxLength, 40);
  const order = () => h.all().filter(node => node.type === 'tr' && node.key != null).map(node => node.key);
  assert.deepEqual(order(), [1, 2, 3]);
  input(h, 'ข้อความตามบิล รหัส').props.onChange({ target: { value: '2010' } }); await h.settle();
  assert.deepEqual(order(), [3]);
  assert.match(text(), /1 จาก 3 รายการ/);
  input(h, 'ข้อความตามบิล รหัส').props.onChange({ target: { value: 'ไม่เจอ' } }); await h.settle();
  assert.match(text(), /ไม่พบชื่อย่อที่ตรงกับคำค้น/);
  input(h, 'ข้อความตามบิล รหัส').props.onChange({ target: { value: '' } }); await h.settle();
  assert.deepEqual(order(), [1, 2, 3], 'clearing the search restores the same order');
  h.unmount();
});

test('adding an alias with an item code sends it; a phone-like code is blocked before any request', async () => {
  const calls = [];
  const actions = { searchProducts: async () => ({ items: [{ id: 10, name: 'ไข่ไก่ เบอร์ 1', unit_name: 'ฟอง' }] }),
    createAlias: async body => { calls.push(plain(body)); }, updateAlias: async (id, body) => { calls.push([id, plain(body)]); } };
  const h = await mount(actions);
  const submit = () => form(h, 'ra-alias-form').props.onSubmit({ preventDefault() {} });
  input(h, 'เช่น ทB').props.onChange({ target: { value: 'ไข่เบอร์ 1' } });
  h.all().find(node => node.type === 'select' && node.props.required).props.onChange({ target: { value: '10' } }); await h.settle();
  input(h, 'เช่น 5002').props.onChange({ target: { value: '0812345678' } }); await h.settle();
  await submit(); await h.settle();
  assert.match(h.text(h.visible()), /ห้ามใส่เลขบัญชี เลขภาษี หรือเบอร์โทร/); assert.equal(calls.length, 0);
  input(h, 'เช่น 5002').props.onChange({ target: { value: ' 5002 ' } }); await h.settle();
  await submit(); await h.settle();
  assert.deepEqual(calls, [{ bill_text: 'ไข่เบอร์ 1', unit_text: '', product_id: 10, item_code: '5002' }]);
  h.unmount();
});

test('editing an alias sends only a changed code, and the server conflict message is shown', async () => {
  const calls = []; let fail = false;
  const actions = { searchProducts: async () => ({ items: [] }),
    updateAlias: async (id, body) => { calls.push([id, plain(body)]); if (fail) throw { response: { status: 409, data: { message: 'มีรหัสสินค้าในบิลนี้ของร้านนี้อยู่แล้ว' } } }; } };
  const h = await mount(actions);
  await h.click('แก้ชื่อย่อ ไข่เบอร์ 1'); await h.settle();
  assert.equal(input(h, 'เช่น 5002').props.value, '5002', 'the form is filled with the current code');
  await form(h, 'ra-alias-form').props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.equal(calls.length, 0, 'nothing changed, nothing sent');
  assert.match(h.text(h.visible()), /ไม่มีการเปลี่ยนแปลง/);
  fail = true;
  input(h, 'เช่น 5002').props.onChange({ target: { value: '2010' } }); await h.settle();
  await form(h, 'ra-alias-form').props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.deepEqual(calls, [[1, { item_code: '2010' }]]);
  assert.match(h.text(h.visible()), /มีรหัสสินค้าในบิลนี้ของร้านนี้อยู่แล้ว/);
  h.unmount();
});

test('double-click guard on the alias toggle still sends one request when item codes are shown', async () => {
  const calls = []; let release;
  const actions = { searchProducts: async () => ({ items: [] }), setActive: (id, active) => { calls.push([id, active]); return new Promise(resolve => { release = resolve; }); } };
  const h = await mount(actions);
  const button = h.find(node => node.type === 'button' && node.props['aria-label'] === 'ปิดใช้ชื่อย่อ ไข่เบอร์ 1');
  button.props.onClick(); button.props.onClick(); await h.settle();
  assert.deepEqual(calls, [[1, false]]);
  release({}); await h.settle();
  h.unmount();
});
