import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { canOpenLegacyReceiving, LEGACY_RECEIVING_PATH, LEGACY_RECEIVING_PRIMARY, NEW_RECEIVING_PATH } from '../src/pages/user/legacy-receiving.js';

const require_ = createRequire(import.meta.url);

// Renders the real FunctionSelect / LegacyReceivingGate with Layout and auth mocked.
// `primary` overrides the LEGACY_RECEIVING_PRIMARY switch so both modes stay covered.
async function bundle(entry, primary) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))], bundle: true, write: false, format: 'cjs', platform: 'node',
    jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
    external: ['react', 'react-dom', 'react-router-dom', 'react/jsx-runtime'],
    plugins: [{ name: 'mocks', setup(b) {
      b.onResolve({ filter: /AuthContext$|components\/layout\/Layout$/ }, args => ({ path: args.path, namespace: 'mock' }));
      b.onLoad({ filter: /legacy-receiving\.js$/ }, async args => ({
        loader: 'js',
        contents: (await readFile(args.path, 'utf8')).replace(/LEGACY_RECEIVING_PRIMARY = (true|false)/, `LEGACY_RECEIVING_PRIMARY = ${primary}`)
      }));
      b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({
        loader: 'jsx',
        contents: args.path.includes('AuthContext')
          ? 'export const useAuth = () => globalThis.__auth;'
          : 'export const Layout = ({children}) => <main data-layout>{children}</main>;'
      }));
    } }]
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require_, module, module.exports);
  return module.exports;
}

const staffAuth = { user: { id: 5, role: 'user' }, isAdmin: false, isProduction: false, canViewProductGroupOrders: false, canViewSupplierOrders: false, canUseStockCheck: true, canViewStockBalance: true };
const adminAuth = { ...staffAuth, user: { id: 1, role: 'admin' }, isAdmin: true };

async function render(entry, exportName, auth, props = {}, primary = false) {
  const { createElement } = require_('react');
  const { renderToStaticMarkup } = require_('react-dom/server');
  const { MemoryRouter } = require_('react-router-dom');
  const exports = await bundle(entry, primary);
  globalThis.__auth = auth;
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [LEGACY_RECEIVING_PATH] }, createElement(exports[exportName], props)));
}

test('switch: owner moved staff back to the old receiving menu (2026-10-21)', () => {
  assert.equal(LEGACY_RECEIVING_PRIMARY, true);
  for (const user of [{ role: 'user' }, { role: 'admin' }, null]) assert.equal(canOpenLegacyReceiving(user), true);
});

for (const [name, auth] of [['staff', { user: { id: 5, role: 'user' }, isAdmin: false, canUseStockCheck: true, canViewStockBalance: true }], ['admin', { user: { id: 1, role: 'admin' }, isAdmin: true, canUseStockCheck: true, canViewStockBalance: true }]]) {
  test(`old menu primary (${name}): one "รับสินค้า" card to the old page, new-system card hidden`, async () => {
    const html = await render('../src/pages/user/FunctionSelect.jsx', 'FunctionSelect', auth, {}, true);
    assert.ok(html.includes('ตรวจรับสินค้าที่สั่งซื้อไว้'));
    assert.ok(!html.includes('รับสินค้า (ระบบใหม่)'));
    assert.equal(html.split('<h2').filter(part => part.includes('รับสินค้า')).length, 1);
  });
  test(`old menu primary (${name}): /order/receive renders the old page with no warning banner`, async () => {
    const html = await render('../src/pages/user/LegacyReceivingGate.jsx', 'LegacyReceivingGate', auth, { children: '[[OLD-PAGE]]' }, true);
    assert.ok(html.includes('[[OLD-PAGE]]'));
    assert.ok(!html.includes('legacy-receiving-banner'));
    assert.ok(!html.includes('เมนูนี้ย้ายไประบบรับสินค้าใหม่แล้ว'));
  });
}

test('helper (phase 1, switch off): only admin and super_admin may open the old receiving page', async () => {
  const { canOpenLegacyReceiving } = await bundle('../src/pages/user/legacy-receiving.js', false);
  assert.equal(canOpenLegacyReceiving({ role: 'admin' }), true);
  assert.equal(canOpenLegacyReceiving({ role: 'super_admin' }), true);
  for (const user of [{ role: 'user' }, { role: 'production' }, {}, null, undefined]) assert.equal(canOpenLegacyReceiving(user), false);
});

for (const [name, auth] of [['staff', staffAuth], ['admin', adminAuth]]) {
  test(`FunctionSelect (${name}): old "รับสินค้า" card is hidden, one receiving card points to the new system`, async () => {
    const html = await render('../src/pages/user/FunctionSelect.jsx', 'FunctionSelect', auth);
    assert.ok(html.includes('รับสินค้า (ระบบใหม่)'));
    assert.ok(!html.includes('ตรวจรับสินค้าที่สั่งซื้อไว้'), 'old card description still visible');
    assert.ok(!html.includes('>รับสินค้า</h2>'), 'old card title still visible');
    assert.ok(!html.includes('รับสินค้า / อ่านบิล'), 'duplicate second card still visible');
    assert.equal(html.split('<h2').filter(part => part.includes('รับสินค้า')).length, 1);
  });
}

test('FunctionSelect source: both cards use the shared route constants', async () => {
  const source = await readFile(new URL('../src/pages/user/FunctionSelect.jsx', import.meta.url), 'utf8');
  assert.ok(!source.includes(`'${LEGACY_RECEIVING_PATH}'`));
  assert.ok(source.includes('path: LEGACY_RECEIVING_PATH'));
  assert.ok(source.includes('path: NEW_RECEIVING_PATH'));
});

test('old route (staff): friendly "moved" page with link to the new system, old page not rendered', async () => {
  const html = await render('../src/pages/user/LegacyReceivingGate.jsx', 'LegacyReceivingGate', staffAuth, { children: '[[OLD-PAGE]]' });
  assert.ok(html.includes('เมนูนี้ย้ายไประบบรับสินค้าใหม่แล้ว'));
  assert.ok(html.includes(`href="${NEW_RECEIVING_PATH}"`));
  assert.ok(html.includes('เปิดระบบรับสินค้าใหม่'));
  assert.ok(!html.includes('[[OLD-PAGE]]'));
  assert.ok(!html.includes('legacy-receiving-banner'));
});

for (const role of ['admin', 'super_admin']) {
  test(`old route (${role}): old page still opens behind a visible warning banner`, async () => {
    const html = await render('../src/pages/user/LegacyReceivingGate.jsx', 'LegacyReceivingGate', { ...adminAuth, user: { id: 1, role } }, { children: '[[OLD-PAGE]]' });
    assert.ok(html.includes('[[OLD-PAGE]]'));
    assert.ok(html.includes('legacy-receiving-banner'));
    assert.ok(html.includes('role="alert"'));
    assert.ok(html.includes('เมนูรับสินค้าแบบเดิม'));
    assert.ok(html.includes(`href="${NEW_RECEIVING_PATH}"`));
    assert.ok(html.indexOf('legacy-receiving-banner') < html.indexOf('[[OLD-PAGE]]'), 'banner must precede the old page');
    assert.ok(!html.includes('เมนูนี้ย้ายไประบบรับสินค้าใหม่แล้ว'));
  });
}

test('App wiring: /order/receive is wrapped by the gate around the lazily loaded old page', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /path="\/order\/receive"[\s\S]{0,200}<ProtectedRoute>\s*<LegacyReceivingGate>\s*<ReceiveOrders \/>\s*<\/LegacyReceivingGate>/);
});
