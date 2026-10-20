import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { RECEIVING_SUPPLIERS_PATH, SUPPLIER_MASTER_PATH, PRODUCT_GROUP_PATH, RECEIVING_LINK_TEXT, CONTACT_LINK_TEXT, receivingSupplierPath, legacySupplierPath,
  initialSupplierQuery } from '../src/pages/admin/receiving/receiving-supplier-links.js';

// Cross-links between the old supplier pages and the receiving supplier pages (SYNTHETIC data only).
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

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const detail = (patch = {}) => ({ supplier_key: 'sm:3', kind: 'master', code: 'SYN-SM-3', name: 'ร้านทดสอบ & ลิงก์', is_active: true, ordering_mode: 'system', branches_note: null,
  bill_format_note: null, ordering_note: null, branches_seen: [], branch_codes: [], merged_keys: ['sm:3'], audits: [], aliases: [], ordering_modes: ['system'], ...patch });
const item = { supplier_key: 'sm:3', kind: 'master', code: 'SYN-SM-3', name: 'ร้านทดสอบ', is_active: true, ordering_mode: 'system', branches_note: null,
  bill_format_note: null, branches_seen: [], branch_codes: [], alias_active_count: 1, alias_disabled_count: 0 };
const roles = { admin: true, super_admin: true, accounting: false, accountant: false, user: false, undefined: false };
const asRole = (context, role) => { context.__nav.auth = { user: { role }, isAdmin: ['admin', 'super_admin'].includes(role) }; };
const detailHtml = async (role, patch) => {
  const { ns, context } = await load('pages/admin/receiving/ReceivingSupplierDetail.jsx'); asRole(context, role);
  return renderToStaticMarkup(React.createElement(ns.ReceivingSupplierDetail, { detail: detail(patch) }));
};
const listHtml = async role => {
  const { ns, context } = await load('pages/admin/receiving/ReceivingSuppliersView.jsx'); asRole(context, role);
  return renderToStaticMarkup(React.createElement(ns.ReceivingSuppliersView, { data: { items: [item], truncated: false, limit: 300 }, filters: { q: '', kind: '' } }));
};

test('helpers: receiving paths encode the key; the legacy path is pre-filtered for masters and plain for product groups', () => {
  assert.equal(receivingSupplierPath('master', 3), '/admin/receiving/suppliers/sm%3A3');
  assert.equal(receivingSupplierPath('group', 4), '/admin/receiving/suppliers/pg%3A4');
  assert.equal(RECEIVING_SUPPLIERS_PATH, '/admin/receiving/suppliers');
  assert.equal(legacySupplierPath(detail()), '/admin/settings/suppliers?q=SYN-SM-3');
  assert.equal(legacySupplierPath(detail({ code: null, name: 'ร้าน & ก' })), `/admin/settings/suppliers?q=${encodeURIComponent('ร้าน & ก')}`);
  assert.equal(legacySupplierPath(detail({ code: '', name: '' })), SUPPLIER_MASTER_PATH);
  assert.equal(legacySupplierPath(detail({ kind: 'group', supplier_key: 'pg:4' })), PRODUCT_GROUP_PATH);
  assert.equal(initialSupplierQuery('?q=SYN-SM-3'), 'SYN-SM-3'); assert.equal(initialSupplierQuery(`?q=${encodeURIComponent('ร้าน & ก')}`), 'ร้าน & ก');
  assert.equal(initialSupplierQuery(''), ''); assert.equal(initialSupplierQuery('?x=1'), ''); assert.equal(initialSupplierQuery(undefined), '');
  assert.equal(initialSupplierQuery(`?q=${'a'.repeat(300)}`).length, 100);
});

test('detail page: only admin and super_admin see the link to the old supplier page, with the pre-filtered href', async () => {
  for (const [role, allowed] of Object.entries(roles)) {
    const html = await detailHtml(role === 'undefined' ? undefined : role);
    assert.equal(html.includes(CONTACT_LINK_TEXT), allowed, role);
    assert.equal(html.includes('/admin/settings/'), allowed, `${role} gets no hint of the admin-only page`);
    if (allowed) assert.ok(html.includes('href="/admin/settings/suppliers?q=SYN-SM-3"'), role);
  }
  const group = await detailHtml('admin', { kind: 'group', supplier_key: 'pg:4', code: null });
  assert.ok(group.includes('href="/admin/settings/product-groups"'));
  assert.match(await detailHtml('admin'), /class="ra-manage-link"[^>]*>ข้อมูลผู้ติดต่อ \/ บัญชี \(หน้าซัพพลายเออร์\) →</);
});

test('list page: the admin hint links to the old supplier page; accounting sees nothing about it', async () => {
  for (const [role, allowed] of Object.entries(roles)) {
    const html = await listHtml(role === 'undefined' ? undefined : role);
    assert.equal(html.includes('href="/admin/settings/suppliers"'), allowed, role);
    assert.equal(html.includes('/admin/settings/'), allowed, role);
    assert.ok(html.includes('จัดการชื่อย่อ →'), 'the row action stays for everyone');
  }
});

test('old supplier-master page: each row links to its receiving key and ?q= pre-fills the search', async () => {
  const source = await read('../src/pages/admin/masters/SupplierMasterManagement.jsx');
  assert.match(source, /to=\{receivingSupplierPath\('master', row\.id\)\}/);
  assert.ok(source.includes('{RECEIVING_LINK_TEXT}'));
  assert.match(source, /useState\(\(\) => initialSupplierQuery\(location\.search\)\)/);
  assert.match(source, /min-h-\[44px\][^"]*min-w-\[44px\]/);
  assert.equal(RECEIVING_LINK_TEXT, 'ชื่อย่อในบิล / การรับของ →');
});

test('old product-group page: each row links to its pg key with a 44px target', async () => {
  const source = await read('../src/pages/admin/masters/SupplierManagement.jsx');
  assert.match(source, /to=\{receivingSupplierPath\('group', row\.id\)\}/);
  assert.ok(source.includes('{RECEIVING_LINK_TEXT}'));
  assert.match(source, /min-h-\[44px\][^"]*min-w-\[44px\]/);
});

test('wiring: the old pages stay admin-only and the receiving pages stay open to accounting', async () => {
  const app = await read('../src/App.jsx');
  for (const path of ['/admin/settings/suppliers', '/admin/settings/product-groups']) {
    assert.match(app, new RegExp(`path="${path}" element=\\{\\s*<ProtectedRoute requireAdmin>`), path);
  }
  for (const path of ['/admin/receiving/suppliers', '/admin/receiving/suppliers/:key']) {
    assert.match(app, new RegExp(`path="${path}" element=\\{<ProtectedRoute requireReceivingLedger>`), path);
  }
  const detailSource = await read('../src/pages/admin/receiving/ReceivingSupplierDetail.jsx');
  assert.match(detailSource, /\{isAdmin && <Link/);
  const css = await read('../src/pages/admin/receiving/receiving-admin.css');
  assert.match(css, /\.ra-manage-link \{[^}]*min-height: var\(--sg-touch\)/);
});
