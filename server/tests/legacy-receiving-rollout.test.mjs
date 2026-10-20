import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import express from 'express';
import { expressRequest } from './helpers/express-request.mjs';

// Loads the REAL config, middleware and router sources in a vm context. `flag` rewrites only the
// value of the single constant, which proves that the one-line phase-2 change closes the writes.
const read = path => readFile(new URL(path, import.meta.url), 'utf8');

async function loadRouter(routerPath, flag, calls, warnings) {
  const context = vm.createContext({ console: { warn: message => warnings.push(message), log() {}, error() {} } });
  const configSource = (await read('../src/config/legacy-receiving.js'))
    .replace(/LEGACY_RECEIVING_WRITES_ENABLED = true;/, `LEGACY_RECEIVING_WRITES_ENABLED = ${flag};`);
  assert.ok(configSource.includes(`LEGACY_RECEIVING_WRITES_ENABLED = ${flag};`));
  const cache = new Map();
  const controllerNames = [...new Set([...(await read(routerPath)).matchAll(/Controller\.(\w+)/g)].map(match => match[1]))];
  const synthetic = values => new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, { context });
  const handler = name => (req, res) => { calls.push(name); res.json({ success: true, handler: name }); };
  const authenticate = (req, res, next) => { req.user = JSON.parse(req.headers['x-test-user'] || '{"id":7,"role":"user"}'); next(); };
  const requireAdmin = (req, res, next) => (['admin', 'super_admin'].includes(req.user.role) ? next() : res.status(403).json({ success: false }));
  const controller = new Proxy({}, { get: (_t, name) => handler(String(name)) });
  async function module(path) {
    if (cache.has(path)) return cache.get(path);
    const m = new vm.SourceTextModule(await read(path), { context, identifier: path });
    cache.set(path, m);
    await m.link(async specifier => {
      if (specifier === 'express') return synthetic({ default: express });
      if (specifier.endsWith('/middleware/auth.js')) return synthetic({ authenticate, requireAdmin, requireAdminOrProduction: requireAdmin });
      if (specifier.endsWith('.controller.js')) return synthetic(Object.fromEntries(controllerNames.map(name => [name, controller[name]])));
      if (specifier.endsWith('/middleware/legacy-receiving.js')) return module('../src/middleware/legacy-receiving.js');
      if (specifier.endsWith('/config/legacy-receiving.js')) {
        const c = new vm.SourceTextModule(configSource, { context }); await c.link(() => { throw Error('none'); }); return c;
      }
      throw new Error(`Unexpected dependency: ${specifier}`);
    });
    return m;
  }
  const root = await module(routerPath);
  await root.evaluate();
  return root.namespace.default;
}

const user = (role = 'user') => ({ 'x-test-user': JSON.stringify({ id: 7, role, token: 'SECRET-TOKEN' }), 'content-type': 'application/json' });
const body = JSON.stringify({ items: [{ order_item_id: 1, received_quantity: 2 }], note: 'SECRET-NOTE', image: 'data:image/png;base64,AAAA' });

const ordersWrites = [['POST', '/receiving/bill-photos'], ['PUT', '/receiving'], ['POST', '/receiving/manual-item']];
const adminWrites = [['PUT', '/orders/receiving'], ['POST', '/orders/receiving/bulk']];

async function app(routerPath, mount, flag) {
  const calls = [], warnings = [];
  const router = await loadRouter(routerPath, flag, calls, warnings);
  const server = express(); server.use(express.json()); server.use(mount, router);
  return { server, calls, warnings };
}

for (const [routerPath, mount, writes, role] of [
  ['../src/routes/orders.routes.js', '/api/orders', ordersWrites, 'user'],
  ['../src/routes/admin.routes.js', '/api/admin', adminWrites, 'admin']
]) {
  test(`phase 1 (flag true): ${mount} legacy writes still work and log a deprecation warning without secrets`, async () => {
    const { server, calls, warnings } = await app(routerPath, mount, true);
    for (const [method, path] of writes) {
      const res = await expressRequest(server, `${mount}${path}?date=2026-10-20&token=QUERY-SECRET`, { method, headers: user(role), body });
      assert.equal(res.status, 200, `${method} ${path}`);
    }
    assert.equal(calls.length, writes.length);
    assert.equal(warnings.length, writes.length);
    for (const [index, [method, path]] of writes.entries()) {
      assert.match(warnings[index], /DEPRECATED/);
      assert.ok(warnings[index].includes(`${method} ${mount}${path}`));
      assert.match(warnings[index], /user=7 role=/);
    }
    for (const secret of ['SECRET-TOKEN', 'SECRET-NOTE', 'QUERY-SECRET', 'base64', 'received_quantity']) {
      assert.ok(!warnings.join('\n').includes(secret), `log leaked ${secret}`);
    }
  });

  test(`phase 2 (flag false): ${mount} legacy writes answer 410 with Thai message and never reach the controller`, async () => {
    const { server, calls, warnings } = await app(routerPath, mount, false);
    for (const [method, path] of writes) {
      const res = await expressRequest(server, `${mount}${path}`, { method, headers: user(role), body });
      assert.equal(res.status, 410, `${method} ${path}`);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.code, 'LEGACY_RECEIVING_DISABLED');
      assert.match(json.message, /ระบบรับสินค้าใหม่/);
    }
    assert.deepEqual(calls, []);
    assert.equal(warnings.length, writes.length);
    assert.ok(warnings.every(w => w.includes('blocked (410)') && !w.includes('SECRET')));
  });
}

test('reads stay available when the flag is false: GET receiving, history and bill-photos', async () => {
  const { server, calls } = await app('../src/routes/orders.routes.js', '/api/orders', false);
  for (const path of ['/receiving', '/receiving/history', '/receiving/bill-photos']) {
    assert.equal((await expressRequest(server, `/api/orders${path}`, { headers: user() })).status, 200, path);
  }
  assert.deepEqual(calls, ['getReceivingItems', 'getReceivingHistory', 'getReceivingBillPhotos']);
  const admin = await app('../src/routes/admin.routes.js', '/api/admin', false);
  assert.equal((await expressRequest(admin.server, '/api/admin/orders/receiving', { headers: user('admin') })).status, 200);
});

test('non-admin still gets 403 (not 410) on admin legacy writes when flag is false', async () => {
  const { server } = await app('../src/routes/admin.routes.js', '/api/admin', false);
  assert.equal((await expressRequest(server, '/api/admin/orders/receiving', { method: 'PUT', headers: user('user'), body })).status, 403);
});

test('shipped default is phase 1: constant is true in code and not read from environment', async () => {
  const config = await read('../src/config/legacy-receiving.js');
  assert.match(config, /export const LEGACY_RECEIVING_WRITES_ENABLED = true;/);
  assert.ok(!/process\.env/.test(config));
  const { LEGACY_RECEIVING_WRITES_ENABLED } = await import('../src/config/legacy-receiving.js');
  assert.equal(LEGACY_RECEIVING_WRITES_ENABLED, true);
});

test('every legacy write route is wired through the guard in the real route files', async () => {
  const orders = await read('../src/routes/orders.routes.js'), admin = await read('../src/routes/admin.routes.js');
  for (const line of [
    "router.post('/receiving/bill-photos', legacyReceivingWriteGuard,", "router.put('/receiving', legacyReceivingWriteGuard,",
    "router.post('/receiving/manual-item', legacyReceivingWriteGuard,"
  ]) assert.ok(orders.includes(line), line);
  for (const line of ["router.put('/orders/receiving', legacyReceivingWriteGuard,", "router.post('/orders/receiving/bulk', legacyReceivingWriteGuard,"]) assert.ok(admin.includes(line), line);
  assert.ok(/router\.get\('\/receiving\/bill-photos', ordersController/.test(orders), 'GET bill-photos is unguarded');
});
