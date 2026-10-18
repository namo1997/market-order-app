import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { canViewReceivingAdmin, ledgerNumber, ledgerDate, relatedFollowups } from '../src/pages/admin/receiving/receiving-ledger.js';
const retained = [];
async function views(file) {
  const code = await build({ entryPoints: [fileURLToPath(new URL(`../src/pages/admin/receiving/${file}.jsx`, import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', external: ['react', 'react/jsx-runtime'],
    plugins: [{ name: 'surfaces', setup(b) {
      b.onResolve({ filter: /react-router-dom|\/api\// }, args => ({ path: args.path, namespace: 'mock' }));
      b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path === 'react-router-dom'
        ? 'export const Link = ({to, children, ...rest}) => globalThis.React.createElement("a", {href: to, ...rest}, children);'
        : 'export const receivingDocumentsAPI = {};' }));
    } }] });
  const context = vm.createContext({ React, Intl, Date });
  const mod = new vm.SourceTextModule(code.outputFiles[0].text, { context });
  retained.push(mod);
  await mod.link(name => { const exports = name === 'react' ? React : jsx;
    const child = new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
    retained.push(child); return child; });
  await mod.evaluate(); return mod.namespace;
}
const fixture = { id: 7, supplier_name_text: '<script>bad</script>', branch_id: 2, department_id: 20,
  branch_name: 'สาขาสอง', department_name: 'ครัว', scope: 'branch', status: 'confirmed', doc_ref: 'INV-7', delivery_date: '2026-10-18', total: '1234567.30',
  has_discrepancy: true, images: [], lines: [{ id: 3, order_item_id: 5, product_name: 'ผัก', quantity_received: '2.00', counted_quantity: '1.50', quantity_billed: '3.00', quantity_ordered: '4.00', unit_price: '20.00', amount: '40.00' }],
  audits: [{ id: 1, action: 'create', actor_name: 'ผู้รับ', created_at: '2026-10-18 12:30:00' }], receiver_name: 'ผู้รับ' };
const data = { items: [fixture], pagination: { page: 1, total_pages: 2, page_size: 25, total: 26 },
  summary: { today: '2026-10-18', today_count: 1, draft_count: 5, confirmed_total: '1234567.30', unknown_total_count: 1 } };
test('ledger formats exact decimal strings, unknown counts and Thai Bangkok dates; four role guard', () => {
  assert.equal(ledgerNumber('123456789012345.30', ' บาท'), '123,456,789,012,345.30 บาท');
  assert.equal(ledgerNumber('0'), '0.00'); assert.equal(ledgerNumber(null), '—');
  assert.equal(ledgerNumber('0.123456'), '0.123456');
  for (const role of ['admin', 'super_admin', 'accounting', 'accountant']) assert.equal(canViewReceivingAdmin({ role }), true);
  for (const role of ['user', 'production', '', undefined]) assert.equal(canViewReceivingAdmin({ role }), false);
  assert.match(ledgerDate('2026-10-17T17:00:00Z'), /18/);
  assert.equal(ledgerDate('2026-10-18 12:30:00', true), ledgerDate('2026-10-18T05:30:00Z', true));
});
test('ledger actual JSX render: Thai filters, summary, branch scope, escaped values, right-aligned baht ledger, pagination', async () => {
  const { ReceivingLedgerView, emptyFilters } = await views('ReceivingLedgerView');
  const html = renderToStaticMarkup(React.createElement(ReceivingLedgerView, { filters: emptyFilters, options: { branches: [], departments: [] }, data, followups: { pending_count: 8 } }));
  for (const text of ['ใบวันนี้', 'ร่างค้าง', 'ยอดรวมที่ยืนยัน', 'เรื่องตามของค้าง', 'สาขา', 'แผนก', 'ขาด / เกิน', 'ทั้งสาขา', '1,234,567.30', 'ยังไม่ระบุยอด 1 ใบ', '/admin/receiving/7', 'หน้าถัดไป']) assert.ok(html.includes(text), text);
  assert.ok(html.includes('class="ra-number"')); assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>bad'));
  assert.match(html, /disabled=""[^>]*>หน้าก่อน/);
});
test('ledger actual JSX render: loading, error, empty, failed followup independent from valid ledger', async () => {
  const { ReceivingLedgerView, emptyFilters } = await views('ReceivingLedgerView');
  const render = props => renderToStaticMarkup(React.createElement(ReceivingLedgerView, { filters: emptyFilters, options: { branches: [], departments: [] }, ...props }));
  assert.match(render({ loading: true }), /กำลังโหลดใบรับสินค้า/);
  assert.match(render({ error: 'ไม่มีสิทธิ์' }), /role="alert"/);
  assert.match(render({ data: { ...data, items: [] } }), /ไม่พบใบรับสินค้า/);
  const html = render({ data, followupError: true }); assert.match(html, /โหลดเรื่องตามของไม่สำเร็จ/); assert.match(html, /INV-7/);
});
test('detail actual JSX render: counted/billed/ordered/price/amount, signature absence, audit and related pending link; no mutations', async () => {
  const { ReceivingDocumentView } = await views('ReceivingDocumentView');
  const related = { id: 90, branch_id: 2, department_id: 99, supplier_name: 'ร้าน', pending_items: [{ order_item_id: 5 }] };
  const html = renderToStaticMarkup(React.createElement(ReceivingDocumentView, { doc: fixture, followups: { items: [related] } }));
  for (const text of ['นับได้', 'บิล', 'สั่ง', 'ราคา (บาท)', 'ยอด (บาท)', '1.50', '2.00', '3.00', '4.00', 'ยังไม่มีลายเซ็น', 'สร้างใบรับ', 'ยังไม่มีรูปบิล', '/admin/receiving/issues?followup_id=90']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('>ยืนยันรับสินค้า<')); assert.ok(!html.includes('>ยกเลิกใบรับ<'));
  assert.equal(relatedFollowups({ ...fixture, scope: 'department' }, [related]).length, 0);
  assert.equal(relatedFollowups(fixture, [{ ...related, branch_id: 1 }]).length, 0);
  assert.equal(relatedFollowups(fixture, [{ ...related, pending_items: [{ order_item_id: 6 }] }]).length, 0);
});

test('ledger real JSX handlers reset dependent department filters, submit, clear and navigate pages', async () => {
  const { ReceivingLedgerView, emptyFilters } = await views('ReceivingLedgerView');
  let filters = { ...emptyFilters, department_id: '20' }, searches = 0;
  const pages = [];
  const walk = node => node == null || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk)
    : [node, ...walk(node.props?.children)];
  const render = () => ReceivingLedgerView({ filters, setFilters: updater => { filters = typeof updater === 'function' ? updater(filters) : updater; },
    options: { branches: [{ id: 2, name: 'สอง' }], departments: [{ id: 20, branch_id: 2, name: 'ครัว' }] }, data,
    onSearch: event => { event.preventDefault(); searches++; }, onPage: page => pages.push(page) });
  const nodes = () => walk(render());
  const select = key => nodes().filter(n => n.type === 'select')[key];
  select(0).props.onChange({ target: { value: '2' } });
  assert.equal(filters.branch_id, '2'); assert.equal(filters.department_id, '');
  filters.department_id = '20'; select(1).props.onChange({ target: { value: 'branch' } });
  assert.equal(filters.department_id, ''); assert.equal(select(2).props.disabled, true);
  nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); assert.equal(searches, 1);
  nodes().find(n => n.type === 'button' && n.props.children === 'หน้าถัดไป').props.onClick(); assert.deepEqual(pages, [2]);
  nodes().find(n => n.type === 'button' && n.props.children === 'ล้างตัวกรอง').props.onClick();
  assert.equal(JSON.stringify(filters), JSON.stringify(emptyFilters));
});
