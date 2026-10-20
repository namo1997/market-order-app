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
import { aliasSourceLabel, branchCodesBody, branchCodesChanged, branchCodesDraft, branchCodesProblem, branchCodesText, auditSummary,
  TOGGLE_LOCK_MS } from '../src/pages/admin/receiving/receiving-suppliers.js';

// Round N2 (SYNTHETIC data only): one row per shop, stable alias rows, per-branch AP codes, single navigation.
const plain = value => JSON.parse(JSON.stringify(value));
const retained = [];
let shared = null; // pages and the navigation bar are loaded into one realm so the mocked layout can render the real bar
async function load(file, mocks = {}) {
  const code = await build({ entryPoints: [fileURLToPath(new URL(`../src/${file}`, import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node',
    jsx: 'automatic', external: ['react', 'react/jsx-runtime'], plugins: [{ name: 'mocks', setup(b) {
      b.onResolve({ filter: /react-router-dom|AuthContext|components\/layout\/(Layout|Header)|\.css$/ }, args => ({ path: args.path, namespace: 'mock' }));
      b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path.includes('react-router-dom')
        ? `const h = globalThis.React.createElement;
           export const Link = ({ to, children, ...rest }) => h('a', { href: to, ...rest }, children);
           export const NavLink = ({ to, end, children, className }) => { const p = globalThis.__nav.path; const on = end ? p === to : p === to || p.startsWith(to + '/');
             return h('a', { href: to, className: typeof className === 'function' ? className({ isActive: on }) : className, 'aria-current': on ? 'page' : undefined }, children); };
           export const useLocation = () => ({ pathname: globalThis.__nav.path }); export const useNavigate = () => () => {};`
        : args.path.includes('AuthContext') ? `export const useAuth = () => globalThis.__nav.auth;`
          : args.path.includes('layout/Layout') ? `export const Layout = ({ children }) => globalThis.React.createElement('div', { 'data-layout': true }, globalThis.React.createElement(globalThis.__nav.Navigation), children);`
            : 'export default {};', loader: 'js' }));
    } }] });
  const context = (shared ||= vm.createContext({ React, Intl, Date, setTimeout, clearTimeout, __nav: { path: '/', auth: {} } }));
  const mod = new vm.SourceTextModule(code.outputFiles[0].text, { context }); retained.push(mod);
  await mod.link(name => { const exports = name === 'react' ? React : jsx;
    const child = new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
    retained.push(child); return child; });
  await mod.evaluate(); return { ns: mod.namespace, context };
}

const alias = (patch = {}) => ({ id: 1, bill_text: 'ต.ไก่', unit_text: 'กก.', product_id: 10, product_name: 'อกไก่', unit_name: 'กก.', confirm_count: 3, is_active: true,
  updated_at: '2026-10-18T05:00:00Z', updated_by_name: 'บัญชีทดสอบ', source_keys: ['sm:1', 'pg:4'], alias_ids: [1, 4], ...patch });
const detail = (patch = {}) => ({ supplier_key: 'sm:1', kind: 'master', code: 'SYN-SM-1', name: 'ร้านทดสอบ A', is_active: true, ordering_mode: 'system', branches_note: null,
  bill_format_note: null, ordering_note: null, branches_seen: [], branch_codes: [{ code: 'AP-049', branch_note: 'สันกำแพง' }], merged_keys: ['sm:1', 'pg:4'], audits: [],
  aliases: [alias(), alias({ id: 2, bill_text: 'ทB', source_keys: ['sm:1', 'pg:4'], alias_ids: [2, 5], is_active: false }), alias({ id: 6, bill_text: 'ปีก', source_keys: ['pg:4'], alias_ids: [6] })],
  ordering_modes: ['system', 'walk_in_phone', 'mixed'], ...patch });
const Detail = '../src/pages/admin/receiving/ReceivingSupplierDetail.jsx';
const mount = async (props, actions) => {
  const h = await harness('ReceivingSupplierDetail', { detail: detail(), actions, onChanged: () => {}, ...props }, {}, {}, {}, {}, null, Detail);
  await new Promise(resolve => setTimeout(resolve, 20)); await h.settle(); return h;
};
const toggleButton = (h, label) => h.find(node => node.type === 'button' && node.props['aria-label'] === label);

test('helpers: branch codes draft/body/changed/problem mirror the server rules and reject phone, bank and tax-like numbers', () => {
  assert.deepEqual(branchCodesDraft(null), []);
  const draft = branchCodesDraft({ branch_codes: [{ code: 'AP-049', branch_note: 'สันกำแพง' }, { code: 'AP-003', branch_note: null }] });
  assert.deepEqual(draft, [{ code: 'AP-049', branch_note: 'สันกำแพง' }, { code: 'AP-003', branch_note: '' }]);
  assert.deepEqual(branchCodesBody([...draft, { code: ' ', branch_note: '' }, { code: ' AP-9 ', branch_note: ' บ้านแจ้ ' }]),
    [{ code: 'AP-049', branch_note: 'สันกำแพง' }, { code: 'AP-003' }, { code: 'AP-9', branch_note: 'บ้านแจ้' }]);
  assert.equal(branchCodesChanged(draft, { branch_codes: [{ code: 'AP-049', branch_note: 'สันกำแพง' }, { code: 'AP-003', branch_note: null }] }), false);
  assert.equal(branchCodesChanged([...draft, { code: '', branch_note: '' }], { branch_codes: [{ code: 'AP-049', branch_note: 'สันกำแพง' }, { code: 'AP-003' }] }), false, 'blank rows are ignored');
  assert.equal(branchCodesChanged(draft.slice(0, 1), { branch_codes: [{ code: 'AP-049', branch_note: 'สันกำแพง' }, { code: 'AP-003' }] }), true);
  assert.equal(branchCodesProblem(draft), '');
  for (const code of ['0812345678', '1234567890123', '081-234-5678', 'AP 049', '', 'A'.repeat(31)]) assert.match(branchCodesProblem([{ code, branch_note: 'x' }]), /รหัส/, code);
  assert.match(branchCodesProblem([{ code: 'AP-1', branch_note: '081-234-5678' }]), /เบอร์โทร/);
  assert.match(branchCodesProblem([{ code: 'AP-1', branch_note: 'ก'.repeat(101) }]), /100/);
  assert.match(branchCodesProblem([{ code: 'AP-1' }, { code: 'ap-1' }]), /ซ้ำ/);
  assert.match(branchCodesProblem(Array.from({ length: 21 }, (_, i) => ({ code: `AP-${i}` }))), /20/);
  assert.equal(branchCodesText([{ code: 'AP-049', branch_note: 'สันกำแพง' }, { code: 'AP-003', branch_note: null }]), 'AP-049 (สันกำแพง), AP-003');
  assert.equal(aliasSourceLabel(['sm:1', 'pg:4']), 'ทั้งทะเบียนซัพพลายเออร์และกลุ่มสินค้า');
  assert.equal(aliasSourceLabel(['pg:4']), 'เฉพาะกลุ่มสินค้าเดิม'); assert.equal(aliasSourceLabel(['sm:1']), 'เฉพาะทะเบียนซัพพลายเออร์'); assert.equal(aliasSourceLabel(), '');
  assert.match(auditSummary({ action: 'profile_update', before: { ordering_mode: null, branch_codes: [] }, after: { ordering_mode: null, branch_codes: [{ code: 'AP-049', branch_note: 'สันกำแพง' }] } }),
    /รหัสเจ้าหนี้ตามสาขา: AP-049 \(สันกำแพง\)/);
  assert.doesNotMatch(auditSummary({ action: 'profile_update', before: { ordering_mode: 'system' }, after: { ordering_mode: 'mixed' } }), /รหัสเจ้าหนี้/);
});

test('list shows each shop once with its per-branch AP codes and the search hint', async () => {
  const { ns } = await load('pages/admin/receiving/ReceivingSuppliersView.jsx');
  const item = { supplier_key: 'sm:1', kind: 'master', code: 'SYN-SM-1', name: 'ร้านทดสอบ A', is_active: true, ordering_mode: 'mixed', branches_note: null, bill_format_note: null,
    branches_seen: [], branch_codes: [{ code: 'AP-049', branch_note: 'สันกำแพง' }, { code: 'AP-053' }], alias_active_count: 2, alias_disabled_count: 0 };
  const html = renderToStaticMarkup(React.createElement(ns.ReceivingSuppliersView, { data: { items: [item], truncated: false, limit: 300 }, filters: { q: '', kind: '' } }));
  for (const text of ['รหัสตามสาขา: AP-049 (สันกำแพง), AP-053', 'ร้านทดสอบ A', 'ค้นหาชื่อหรือรหัสร้าน', 'รหัสตามสาขา"']) assert.ok(html.includes(text), text);
  assert.equal(html.match(/href="\/admin\/receiving\/suppliers\//g).length, 1);
  assert.ok(!renderToStaticMarkup(React.createElement(ns.ReceivingSuppliersView, { data: { items: [{ ...item, branch_codes: [] }], truncated: false, limit: 300 }, filters: { q: '', kind: '' } })).includes('รหัสตามสาขา:'));
});

test('detail: merged shop explains the merge, labels where each alias lives, and shows editable branch codes', async () => {
  const { ns } = await load('pages/admin/receiving/ReceivingSupplierDetail.jsx');
  const render = props => renderToStaticMarkup(React.createElement(ns.ReceivingSupplierDetail, props));
  const html = render({ detail: detail() });
  for (const text of ['ร้านนี้รวมทะเบียนซัพพลายเออร์กับกลุ่มสินค้าเดิม', 'ทั้งทะเบียนซัพพลายเออร์และกลุ่มสินค้า', 'เฉพาะกลุ่มสินค้าเดิม', 'รหัสเจ้าหนี้ตามสาขา', 'value="AP-049"', 'value="สันกำแพง"',
    '+ เพิ่มรหัสตามสาขา', 'ห้ามใส่เลขบัญชีธนาคาร เลขภาษี หรือเบอร์โทรในหมายเหตุและรหัสเจ้าหนี้']) assert.ok(html.includes(text), text);
  const plainHtml = render({ detail: detail({ merged_keys: undefined, branch_codes: [], aliases: [alias({ source_keys: undefined })] }) });
  assert.ok(!plainHtml.includes('ร้านนี้รวมทะเบียน') && !plainHtml.includes('เฉพาะกลุ่มสินค้าเดิม')); assert.ok(plainHtml.includes('ยังไม่มีรหัสตามสาขา'));
});

test('alias toggle: row stays in place with an inline state, the button locks while saving and right after, and a double click sends one request', async () => {
  const calls = []; let release; let reloads = 0;
  const actions = { searchProducts: async () => ({ items: [] }), setActive: (id, active) => { calls.push([id, active]); return new Promise(resolve => { release = resolve; }); } };
  const h = await mount({ onChanged: () => { reloads++; } }, actions);
  const order = () => h.all().filter(node => node.type === 'tr' && node.key != null).map(node => node.key);
  const before = order(); assert.deepEqual(before, [1, 2, 6]);
  const button = toggleButton(h, 'ปิดใช้ชื่อย่อ ต.ไก่');
  button.props.onClick(); button.props.onClick(); button.props.onClick(); // rapid double/triple click
  await h.settle();
  assert.deepEqual(plain(calls), [[1, false]], 'only the first click reaches the server');
  assert.equal(toggleButton(h, 'ปิดใช้ชื่อย่อ ต.ไก่').props.disabled, true, 'locked while the request is pending');
  assert.match(h.text(h.visible()), /กำลังบันทึก…/);
  release({}); await h.settle(); await new Promise(resolve => setTimeout(resolve, 5)); await h.settle();
  assert.deepEqual(order(), before, 'row order does not change after the status change');
  const after = toggleButton(h, 'เปิดใช้ชื่อย่อ ต.ไก่');
  assert.equal(after.props.disabled, true, 'the opposite action is locked right after the change, so a second click cannot undo it');
  assert.match(h.text(h.visible()), /ปิดใช้แล้วเมื่อสักครู่/);
  after.props.onClick(); await h.settle(); assert.equal(calls.length, 1, 'click during the lock is ignored even if the DOM were enabled');
  assert.equal(reloads, 1);
  // Other rows are not blocked.
  assert.equal(toggleButton(h, 'เปิดใช้ชื่อย่อ ทB').props.disabled, false);
  await new Promise(resolve => setTimeout(resolve, TOGGLE_LOCK_MS + 80)); await h.settle();
  assert.equal(toggleButton(h, 'เปิดใช้ชื่อย่อ ต.ไก่').props.disabled, false, 'unlocked after the short pause');
  h.unmount();
});

test('alias toggle: a failed request unlocks the row, keeps its state and shows a Thai message', async () => {
  const actions = { searchProducts: async () => ({ items: [] }), setActive: async () => { throw { response: { status: 404 } }; } };
  const h = await mount({}, actions);
  await h.click('ปิดใช้ชื่อย่อ ต.ไก่');
  assert.match(h.text(h.visible()), /ไม่พบข้อมูล/);
  assert.equal(toggleButton(h, 'ปิดใช้ชื่อย่อ ต.ไก่').props.disabled, false);
  h.unmount();
});

test('branch codes: edits send branch_codes only when changed; invalid numbers are blocked before any request', async () => {
  const calls = [];
  const actions = { searchProducts: async () => ({ items: [] }), saveProfile: async body => { calls.push(body); } };
  const h = await mount({}, actions);
  const form = () => h.all().filter(node => node.type === 'form')[0];
  await form().props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.equal('branch_codes' in plain(calls[0]), false, 'unchanged codes are not sent');
  await h.click('+ เพิ่มรหัสตามสาขา');
  const inputs = () => h.all().filter(node => node.type === 'input' && node.props.placeholder === 'เช่น AP-049' || node.props.placeholder === 'เช่น สันกำแพง');
  const [, , newCode, newNote] = inputs();
  newCode.props.onChange({ target: { value: '0812345678' } }); await h.settle();
  await form().props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.match(h.text(h.visible()), /ห้ามใส่เลขบัญชี เลขภาษี หรือเบอร์โทร/); assert.equal(calls.length, 1);
  inputs()[2].props.onChange({ target: { value: ' AP-053 ' } }); inputs()[3].props.onChange({ target: { value: 'บ้านแจ้' } }); await h.settle();
  await form().props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.deepEqual(plain(calls[1].branch_codes), [{ code: 'AP-049', branch_note: 'สันกำแพง' }, { code: 'AP-053', branch_note: 'บ้านแจ้' }]);
  await h.click('ลบรหัส AP-049'); await h.settle();
  await form().props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.deepEqual(plain(calls[2].branch_codes), [{ code: 'AP-053', branch_note: 'บ้านแจ้' }]);
  void newNote; h.unmount();
});

test('navigation: inside the receiving workspace the top bar keeps one entry and the shell tabs are the single tab row, on every page', async () => {
  const { ns: nav, context } = await load('components/layout/Navigation.jsx');
  const { ns: shell } = await load('pages/admin/receiving/ReceivingAdminShell.jsx');
  const tabLabels = ['ใบรับสินค้า', 'ปัญหารับของ', 'ร้านค้าและชื่อย่อ'], topLabels = ['จัดการใบรับสินค้า', 'ปัญหารับของ', 'ร้านค้าและชื่อย่อ'];
  const links = html => [...html.matchAll(/<a [^>]*>([^<]*)<\/a>/g)].map(match => match[1]);
  const topBar = (path, user) => { context.__nav.path = path; context.__nav.auth = { user, isAdmin: ['admin', 'super_admin'].includes(user.role), isSuperAdmin: user.role === 'super_admin' };
    return renderToStaticMarkup(React.createElement(nav.Navigation)); };
  const accountant = { role: 'accounting' };
  for (const path of ['/admin/receiving', '/admin/receiving/issues', '/admin/receiving/suppliers', '/admin/receiving/suppliers/sm%3A1', '/admin/receiving/12']) {
    assert.deepEqual(links(topBar(path, accountant)), ['จัดการใบรับสินค้า'], path);
  }
  assert.deepEqual(links(topBar('/', accountant)), topLabels, 'outside the workspace the top bar still reaches all three pages');
  assert.ok(topBar('/admin/receiving/issues', accountant).includes('flex-wrap'), 'wraps on a 375px phone');
  // Every shell page renders exactly one tab row with the current page marked, and the top bar adds no second copy of the tab names.
  context.__nav.Navigation = nav.Navigation;
  for (const [props, path, current] of [[{}, '/admin/receiving', 'ใบรับสินค้า'], [{ issues: true }, '/admin/receiving/issues', 'ปัญหารับของ'], [{ suppliers: true }, '/admin/receiving/suppliers/sm%3A1', 'ร้านค้าและชื่อย่อ']]) {
    for (const user of [accountant, { role: 'accountant' }, { role: 'admin' }]) {
      context.__nav.path = path; context.__nav.auth = { user, isAdmin: user.role === 'admin' };
      const html = renderToStaticMarkup(React.createElement(shell.ReceivingAdminShell, props, React.createElement('p', null, 'เนื้อหา')));
      assert.equal(html.match(/aria-label="งานรับสินค้า"/g).length, 1, path);
      const row = /<nav[^>]*aria-label="งานรับสินค้า"[^>]*>([\s\S]*?)<\/nav>/.exec(html)[1], outside = html.replace(row, '');
      assert.deepEqual(links(row), tabLabels, `${path} ${user.role}`);
      assert.deepEqual(links(outside).filter(text => ['ปัญหารับของ', 'ร้านค้าและชื่อย่อ'].includes(text)), [], 'the top bar does not repeat the tab names');
      assert.match(html, new RegExp(`aria-current="page"[^>]*>${current}<`));
    }
  }
  const source = await readFile(new URL('../src/pages/admin/receiving/ReceivingAdminShell.jsx', import.meta.url), 'utf8');
  assert.match(source, /aria-label="งานรับสินค้า"/);
});

test('list layout: shop name leads with a kind chip, branch codes are chips, bill note is clamped with a title and the action never wraps', async () => {
  const { ns } = await load('pages/admin/receiving/ReceivingSuppliersView.jsx');
  const item = { supplier_key: 'sm:1', kind: 'master', code: 'SYN-SM-1', name: 'บริษัท ทดสอบค้าหมู จำกัด', is_active: true, ordering_mode: 'system', branches_note: null,
    bill_format_note: 'บิลพิมพ์ 2 ชั้น ลายเซ็นอยู่มุมขวาล่าง', branches_seen: [], branch_codes: [{ code: 'AP-049', branch_note: 'สันกำแพง' }, { code: 'AP-053' }], alias_active_count: 1, alias_disabled_count: 0 };
  const html = renderToStaticMarkup(React.createElement(ns.ReceivingSuppliersView, { data: { items: [item], truncated: false, limit: 300 }, filters: { q: '', kind: '' } }));
  assert.match(html, /<th class="ra-col-shop">ร้าน<\/th><th class="ra-col-code">รหัส<\/th>/, 'shop column comes first');
  assert.match(html, /class="ra-shop-name">บริษัท ทดสอบค้าหมู จำกัด<\/span><span class="ra-chip ra-chip-kind">/);
  assert.ok(html.includes('<span class="ra-chip">AP-049 · สันกำแพง</span>')); assert.ok(html.includes('<span class="ra-chip">AP-053</span>'));
  assert.match(html, /class="ra-clamp" title="บิลพิมพ์ 2 ชั้น/);
  assert.match(html, /class="ra-manage-link"/);
  for (const label of ['ร้าน', 'รหัส', 'ส่งให้สาขา', 'การสั่ง', 'รูปแบบบิล', 'ชื่อย่อที่ใช้งาน', 'จัดการ']) assert.ok(html.includes(`data-label="${label}"`), label);
  assert.ok(html.includes('<table>') && html.includes('<caption>') && html.includes('<thead>'), 'table semantics are kept on desktop');
});

test('list CSS: shop column has a minimum width, action link is nowrap with a 44px target, bill note clamps to 2 lines, cards below 768px', async () => {
  const css = await readFile(new URL('../src/pages/admin/receiving/receiving-admin.css', import.meta.url), 'utf8');
  assert.match(css, /\.ra-col-shop \{[^}]*min-width: 15rem/);
  assert.match(css, /\.ra-manage-link \{[^}]*min-height: 44px[^}]*white-space: nowrap/);
  assert.match(css, /\.ra-clamp \{[^}]*-webkit-line-clamp: 2/);
  const mobile = css.slice(css.indexOf('@media (max-width: 768px) {\n  .ra-supplier-table'));
  assert.match(mobile, /display: block; width: 100%/); assert.doesNotMatch(mobile, /grid-template-columns/); assert.match(mobile, /tr \{ box-sizing: border-box/); assert.match(mobile, /attr\(data-label\)/); assert.match(mobile, /overflow-x: visible/);
});
