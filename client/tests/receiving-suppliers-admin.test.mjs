import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { harness } from './receiving-harness.mjs';
import { canViewReceivingAdmin } from '../src/pages/admin/receiving/receiving-ledger.js';
import { orderingLabel, profileBody, profileDraft, profileProblem, aliasProblem, aliasBody, aliasChanges, aliasDraftFrom,
  supplierErrorMessage, auditSummary, emptyAliasDraft } from '../src/pages/admin/receiving/receiving-suppliers.js';

// Values built inside the component's vm realm have a different Object prototype.
const plain = value => JSON.parse(JSON.stringify(value));
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const retained = [];
async function views(file) {
  const code = await build({ entryPoints: [fileURLToPath(new URL(`../src/pages/admin/receiving/${file}.jsx`, import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', external: ['react', 'react/jsx-runtime'],
    plugins: [{ name: 'surfaces', setup(b) {
      b.onResolve({ filter: /react-router-dom|AuthContext/ }, args => ({ path: args.path, namespace: 'mock' }));
      b.onLoad({ filter: /.*/, namespace: 'mock' }, args => args.path.includes('AuthContext') ? ({ contents: 'export const useAuth = () => globalThis.__auth;' }) : ({ contents: 'export const Link = ({to, children, ...rest}) => globalThis.React.createElement("a", {href: to, ...rest}, children);' }));
    } }] });
  const context = vm.createContext({ React, Intl, Date, setTimeout, clearTimeout, __auth: {} });
  const mod = new vm.SourceTextModule(code.outputFiles[0].text, { context });
  retained.push(mod);
  await mod.link(name => { const exports = name === 'react' ? React : jsx;
    const child = new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
    retained.push(child); return child; });
  await mod.evaluate(); return mod.namespace;
}

// SYNTHETIC rows shaped like the server response; no real supplier contact data.
const supplier = (patch = {}) => ({ supplier_key: 'sm:1', kind: 'master', code: 'SYN-SM-1', name: 'ร้านทดสอบ A', is_active: true, ordering_mode: 'system',
  branches_note: 'ทุกสาขา', bill_format_note: 'ใบส่งของเขียนมือ 1–2 รายการ/ใบ', ordering_note: null, branches_seen: ['สาขาสอง'], alias_active_count: 4, alias_disabled_count: 1, ...patch });
const listData = { items: [supplier(), supplier({ supplier_key: 'pg:2', kind: 'group', code: null, name: 'กลุ่ม <script>bad</script>', ordering_mode: 'walk_in_phone', branches_note: null,
  branches_seen: [], bill_format_note: null, alias_active_count: 0, alias_disabled_count: 0 }),
  supplier({ supplier_key: 'sm:3', name: 'ร้านผสม', ordering_mode: 'mixed', branches_note: null }), supplier({ supplier_key: 'sm:4', name: 'ร้านยังไม่ทราบ', ordering_mode: null, is_active: false })],
  truncated: false, limit: 300, ordering_modes: ['system', 'walk_in_phone', 'mixed'] };
const alias = (patch = {}) => ({ id: 1, bill_text: 'ต.ไก่', unit_text: 'กก.', product_id: 10, product_name: 'อกไก่', unit_name: 'กก.', unit_multiplier: '1.0000',
  last_unit_price: '80.000000', confirm_count: 3, is_active: true, updated_at: '2026-10-18T05:00:00Z', updated_by_name: 'บัญชีทดสอบ', ...patch });
const detail = (patch = {}) => ({ ...supplier(), branches_seen: ['สาขาสอง', 'สาขาหนึ่ง'], aliases: [alias(), alias({ id: 2, bill_text: 'ทB', unit_text: '', product_id: 11, product_name: 'ขา B', is_active: false, confirm_count: 1, updated_by_name: null }),
  alias({ id: 3, bill_text: '<img src=x onerror=alert(1)>', product_name: 'สินค้า <b>x</b>' })],
audits: [{ id: 9, alias_id: 1, action: 'alias_update', actor_name: 'บัญชีทดสอบ', actor_role: 'accounting', created_at: '2026-10-19T03:00:00Z',
  before: { bill_text: 'ต.ไก่', unit_text: 'กก.', product_id: 11, product_name: 'ขา B' }, after: { bill_text: 'ต.ไก่', unit_text: 'กก.', product_id: 10, product_name: 'อกไก่' } },
{ id: 8, alias_id: null, action: 'profile_update', actor_name: 'ผู้ดูแล', actor_role: 'admin', created_at: '2026-10-18T03:00:00Z', before: { ordering_mode: null }, after: { ordering_mode: 'system' } }],
ordering_modes: ['system', 'walk_in_phone', 'mixed'], ...patch });

test('permission guard and pure helpers: four roles only, labels, drafts and error messages', () => {
  for (const role of ['admin', 'super_admin', 'accounting', 'accountant']) assert.equal(canViewReceivingAdmin({ role }), true);
  for (const role of ['user', 'production', undefined]) assert.equal(canViewReceivingAdmin({ role }), false);
  assert.deepEqual(['system', 'walk_in_phone', 'mixed', null, 'x'].map(orderingLabel), ['ผ่านระบบ', 'สั่งหน้าร้าน / โทรสั่ง', 'ผสม', 'ยังไม่ระบุ', 'ยังไม่ระบุ']);
  assert.deepEqual(profileBody({ ordering_mode: '', branches_note: '  ', bill_format_note: ' บิลมือ ', ordering_note: '' }),
    { ordering_mode: null, branches_note: null, bill_format_note: 'บิลมือ', ordering_note: null });
  assert.deepEqual(profileDraft(null), { ordering_mode: '', branches_note: '', bill_format_note: '', ordering_note: '' });
  assert.match(profileProblem({ branches_note: 'ก'.repeat(501) }), /500/); assert.equal(profileProblem({ branches_note: 'ok' }), '');
  assert.match(aliasProblem({ bill_text: '  ', product_id: '10' }), /ข้อความตามที่เขียนในบิล/);
  assert.match(aliasProblem({ bill_text: 'ก'.repeat(256), product_id: '10' }), /255/);
  assert.match(aliasProblem({ bill_text: 'a\u0000b', product_id: '10' }), /อักขระ/);
  assert.match(aliasProblem({ bill_text: 'x', unit_text: 'ก'.repeat(101), product_id: '10' }), /100/);
  for (const bad of ['', '0', '1.5', 'abc', '-3', '1e3']) assert.match(aliasProblem({ bill_text: 'x', product_id: bad }), /เลือกสินค้า/, bad);
  assert.equal(aliasProblem({ bill_text: 'ทB', unit_text: '', product_id: '11' }), '');
  assert.deepEqual(aliasBody({ bill_text: ' ทB ', unit_text: ' กก. ', product_id: '11' }), { bill_text: 'ทB', unit_text: 'กก.', product_id: 11 });
  const original = alias();
  assert.deepEqual(aliasChanges(aliasDraftFrom(original), original), {});
  assert.deepEqual(aliasChanges({ ...aliasDraftFrom(original), product_id: '11', unit_text: '' }, original), { unit_text: '', product_id: 11 });
  assert.deepEqual(aliasDraftFrom(null), emptyAliasDraft);
  const error = (status, message) => ({ response: { status, data: { message } } });
  assert.match(supplierErrorMessage(error(403)), /ไม่มีสิทธิ์/); assert.match(supplierErrorMessage(error(409, 'มีชื่อย่อนี้')), /มีชื่อย่อ/);
  assert.equal(supplierErrorMessage(error(422, 'ข้อมูลผิด')), 'ข้อมูลผิด'); assert.match(supplierErrorMessage(error(503)), /ยังไม่พร้อม/);
  assert.match(supplierErrorMessage(new Error('boom')), /บันทึกไม่สำเร็จ/); assert.ok(!supplierErrorMessage(error(500, 'SQL secret')).includes('SQL'));
  assert.match(auditSummary(detail().audits[0]), /ขา B.*⇒.*อกไก่/); assert.match(auditSummary(detail().audits[1]), /ยังไม่ระบุ → ผ่านระบบ/);
});

test('supplier list renders code, name, branches, ordering mode, bill note and alias counts; escapes text and links to the encoded key', async () => {
  const { ReceivingSuppliersView } = await views('ReceivingSuppliersView');
  const html = renderToStaticMarkup(React.createElement(ReceivingSuppliersView, { data: listData, filters: { q: '', kind: '' } }));
  for (const text of ['ร้านค้าและชื่อย่อในบิล · 4 ร้าน', 'SYN-SM-1', 'ร้านทดสอบ A', 'ทุกสาขา', 'เคยรับของแล้ว: สาขาสอง', 'ผ่านระบบ', 'สั่งหน้าร้าน / โทรสั่ง', 'ผสม', 'ยังไม่ระบุ',
    'ใบส่งของเขียนมือ 1–2 รายการ/ใบ', 'ปิดใช้ 1', 'ปิดใช้งาน', 'จัดการชื่อย่อ →', 'ค้นหาชื่อหรือรหัสร้าน', 'ประเภท']) assert.ok(html.includes(text), text);
  assert.ok(html.includes('href="/admin/receiving/suppliers/sm%3A1"')); assert.ok(html.includes('href="/admin/receiving/suppliers/pg%3A2"'));
  assert.ok(html.includes('&lt;script&gt;bad')); assert.ok(!html.includes('<script>bad'));
  assert.ok(html.includes('class="ra-number"'));
});

test('supplier list states: loading, error, empty and truncated notice', async () => {
  const { ReceivingSuppliersView } = await views('ReceivingSuppliersView');
  const render = props => renderToStaticMarkup(React.createElement(ReceivingSuppliersView, props));
  assert.match(render({ loading: true }), /กำลังโหลดรายชื่อร้าน/);
  assert.match(render({ error: 'บัญชีนี้ไม่มีสิทธิ์จัดการชื่อย่อร้านค้า' }), /role="alert"[^>]*>บัญชีนี้ไม่มีสิทธิ์/);
  assert.match(render({ data: { ...listData, items: [] } }), /ไม่พบร้านตามตัวกรอง/);
  assert.match(render({ data: { ...listData, truncated: true } }), /แสดงเฉพาะ 300 ร้านแรก/);
});

test('supplier detail renders profile form, alias table with disabled state, audit history and escapes bill text', async () => {
  const { ReceivingSupplierDetail } = await views('ReceivingSupplierDetail');
  const html = renderToStaticMarkup(React.createElement(ReceivingSupplierDetail, { detail: detail() }));
  for (const text of ['ร้านทดสอบ A', 'รูปแบบการสั่งและบิล', 'ยังไม่ระบุ', 'สั่งหน้าร้าน / โทรสั่ง', 'ผสม', 'สาขาที่เคยรับของจริง: สาขาสอง, สาขาหนึ่ง', 'ห้ามใส่เลขบัญชีธนาคาร',
    'ชื่อย่อในบิล → สินค้าในระบบ', 'เพิ่มชื่อย่อใหม่', 'ข้อความตามบิล', 'สินค้าในระบบ', 'ต.ไก่', 'อกไก่', 'ใช้งาน', 'ปิดใช้', 'เปิดใช้', 'แก้ไข', 'ประวัติการแก้ไขล่าสุด',
    'แก้ชื่อย่อ', 'ผู้ดูแล', 'บันทึกรูปแบบการสั่ง', 'ชื่อย่อที่ยืนยันแล้ว · 3 รายการ']) assert.ok(html.includes(text), text);
  assert.ok(html.includes('aria-label="เปิดใช้ชื่อย่อ ทB"')); assert.ok(html.includes('aria-label="ปิดใช้ชื่อย่อ ต.ไก่"'));
  assert.ok(html.includes('class="ra-alias-off"'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;')); assert.ok(!html.includes('<img src=x')); assert.ok(!html.includes('<b>x</b>'));
  assert.match(renderToStaticMarkup(React.createElement(ReceivingSupplierDetail, { detail: detail({ aliases: [], audits: [] }) })), /ยังไม่มีการแก้ไขผ่านหน้านี้[\s\S]*ร้านนี้ยังไม่มีชื่อย่อ/);
});

test('detail interaction: add alias validates, posts the exact body and reloads; failures keep the form and show a Thai message', async () => {
  const calls = []; let reloads = 0; let failure = null;
  const actions = { searchProducts: async q => ({ items: [{ id: 10, name: 'อกไก่', unit_name: 'กก.', is_supplier_product: true }, { id: 11, name: 'ขา B', unit_name: 'กก.', is_supplier_product: false }].filter(p => p.name.includes(q)) }),
    saveProfile: async body => { calls.push(['profile', body]); if (failure) throw failure; return {}; },
    createAlias: async body => { calls.push(['create', body]); if (failure) throw failure; return {}; },
    updateAlias: async (id, body) => { calls.push(['update', id, body]); return {}; },
    setActive: async (id, active) => { calls.push(['active', id, active]); return {}; } };
  const h = await harness('ReceivingSupplierDetail', { detail: detail(), actions, onChanged: () => { reloads++; } }, {}, {}, {}, {}, null, '../src/pages/admin/receiving/ReceivingSupplierDetail.jsx');
  await new Promise(resolve => setTimeout(resolve, 20)); await h.settle();
  const submit = form => form.props.onSubmit({ preventDefault() {} });
  const forms = () => h.all().filter(node => node.type === 'form');
  await submit(forms()[1]); await h.settle();
  assert.match(h.text(h.visible()), /กรุณากรอกข้อความตามที่เขียนในบิล/); assert.equal(calls.length, 0);
  await h.select('ข้อความตามบิล', ' ป.บน '); await submit(forms()[1]); await h.settle();
  assert.match(h.text(h.visible()), /กรุณาเลือกสินค้าในระบบ/); assert.equal(calls.length, 0);
  await h.select('สินค้าในระบบ', '11'); await h.select('หน่วยตามบิล', 'กก.');
  await submit(forms()[1]); await h.settle();
  assert.deepEqual(plain(calls), [['create', { bill_text: 'ป.บน', unit_text: 'กก.', product_id: 11 }]]); assert.equal(reloads, 1);
  assert.match(h.text(h.visible()), /เพิ่มชื่อย่อแล้ว/);
  failure = { response: { status: 409, data: { message: 'มีชื่อย่อและหน่วยนี้ของร้านนี้อยู่แล้ว' } } };
  await h.select('ข้อความตามบิล', 'ต.ไก่'); await h.select('สินค้าในระบบ', '10');
  await submit(forms()[1]); await h.settle();
  assert.match(h.text(h.visible()), /มีชื่อย่อและหน่วยนี้ของร้านนี้อยู่แล้ว/); assert.equal(reloads, 1);
  assert.equal(h.find(node => node.type === 'input' && node.props.placeholder === 'เช่น ทB').props.value, 'ต.ไก่', 'form keeps the typed value after a rejected save');
  for (const button of h.all().filter(node => node.type === 'button')) assert.ok(['button', 'submit'].includes(button.props.type), h.text(button));
  h.unmount();
});

test('detail interaction: edit sends only changed fields, unchanged edit is a no-op, toggle calls enable/disable, profile saves nullable body', async () => {
  const calls = []; let reloads = 0;
  const actions = { searchProducts: async () => ({ items: [{ id: 11, name: 'ขา B', unit_name: 'กก.' }] }),
    saveProfile: async body => { calls.push(['profile', body]); }, createAlias: async () => { calls.push(['create']); },
    updateAlias: async (id, body) => { calls.push(['update', id, body]); }, setActive: async (id, active) => { calls.push(['active', id, active]); } };
  const h = await harness('ReceivingSupplierDetail', { detail: detail(), actions, onChanged: () => { reloads++; } }, {}, {}, {}, {}, null, '../src/pages/admin/receiving/ReceivingSupplierDetail.jsx');
  await new Promise(resolve => setTimeout(resolve, 20)); await h.settle();
  await h.click('แก้ชื่อย่อ ต.ไก่');
  assert.match(h.text(h.visible()), /แก้ชื่อย่อ #1/);
  const form = () => h.all().filter(node => node.type === 'form')[1];
  await form().props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.match(h.text(h.visible()), /ไม่มีการเปลี่ยนแปลง/); assert.equal(calls.length, 0);
  await h.select('สินค้าในระบบ', '11'); await form().props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.deepEqual(plain(calls), [['update', 1, { product_id: 11 }]]); assert.equal(reloads, 1);
  assert.doesNotMatch(h.text(h.visible()), /แก้ชื่อย่อ #1/, 'edit mode ends after save');
  await h.click('ปิดใช้ชื่อย่อ ต.ไก่'); await h.click('เปิดใช้ชื่อย่อ ทB');
  assert.deepEqual(plain(calls.slice(1)), [['active', 1, false], ['active', 2, true]]);
  await h.select('รูปแบบการสั่ง', 'mixed'); await h.select('รูปแบบบิล', 'บิลพิมพ์');
  await h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.deepEqual(plain(calls.at(-1)), ['profile', { ordering_mode: 'mixed', branches_note: 'ทุกสาขา', bill_format_note: 'บิลพิมพ์', ordering_note: null }]);
  h.unmount();
});

test('wiring: suppliers route precedes the :id ledger route, is limited to receiving-ledger roles, and the shared shell gains the third tab', async () => {
  const [app, shell, page, api, nav, css] = await Promise.all(['../src/App.jsx', '../src/pages/admin/receiving/ReceivingAdminShell.jsx', '../src/pages/admin/receiving/AdminReceivingSuppliers.jsx',
    '../src/api/receiving-admin.js', '../src/components/layout/Navigation.jsx', '../src/pages/admin/receiving/receiving-admin.css'].map(read));
  const list = app.indexOf('path="/admin/receiving/suppliers"'), item = app.indexOf('path="/admin/receiving/suppliers/:key"'), ledger = app.indexOf('path="/admin/receiving/:id"');
  assert.ok(list > 0 && item > list && ledger > item);
  assert.match(app.slice(list, ledger), /requireReceivingLedger[\s\S]*requireReceivingLedger/);
  assert.match(shell, /ร้านค้าและชื่อย่อ/); assert.match(shell, /\/admin\/receiving\/suppliers/); assert.match(shell, /ใบรับสินค้า/); assert.match(shell, /ปัญหารับของ/);
  assert.match(page, /<ReceivingAdminShell suppliers>/);
  for (const endpoint of ['/suppliers`', 'product-search', '/profile', '/aliases', 'enable', 'disable']) assert.ok(api.includes(endpoint), endpoint);
  assert.match(api, /encodeURIComponent\(key\)/);
  assert.match(nav, /\/admin\/receiving\/suppliers/);
  assert.match(css, /--ra-navy: #1E3168/); assert.match(css, /--ra-gold: #C8941C/); assert.match(css, /#F7F5F0/); assert.match(css, /Sarabun/);
});
