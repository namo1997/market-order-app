import test from 'node:test';
import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { loadApp } from '../../pilot/app.mjs';
import { createReceivingHarness, deltaActor as user, makePngDataUrl } from './helpers/receiving-fake-db.mjs';

const request = (app, url, body, session) => new Promise((resolve, reject) => {
  const req = new IncomingMessage(new Socket()); req.method = body === undefined ? 'GET' : 'POST'; req.url = url;
  const data = body === undefined ? '' : JSON.stringify(body);
  req.headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...(session ? { authorization: `Bearer ${session}` } : {}) };
  const res = new ServerResponse(req); res.end = chunk => { try { resolve({ status: res.statusCode, body: JSON.parse(String(chunk)), headers: res.getHeaders() }); } catch (e) { reject(e); } return res; };
  app.handle(req, res, reject); req.push(data); req.push(null);
});
async function catalog() {
  const calls = []; let now = Date.parse('2026-10-20T01:00:00Z');
  const pool = { async query(sql, params = []) {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT u.id')) return [[{ id: 1, name: 'SYNTHETIC receiver', department_id: 1, branch_id: 1 }]];
    if (sql.includes('SELECT id, branch_id FROM departments')) return [[{ id: 1, branch_id: 1 }]];
    if (sql.startsWith('SELECT supplier_key')) return [[{ supplier_key: 'sm:1', name: 'ร้านน้ำแข็ง vic', code: 'SYN-VIC', supplier_master_id: 1, product_group_id: null, account_number: 'SENSITIVE', phone: 'SENSITIVE' }]];
    if (sql.startsWith('SELECT sm.id, sm.name') || sql.startsWith('SELECT pg.id, pg.name')) return [Number(params[0]) === 1 ? [{ id: 1, name: 'ร้านน้ำแข็ง vic' }] : []];
    if (sql.startsWith('SELECT p.id, p.name')) return [[{ id: 9, name: 'น้ำแข็งหลอดใหญ่', unit_id: 2, unit_name: 'ถุง', quantity_billed: 999, unit_price: 35, bill_text: 'SECRET' }]];
    throw Error('Unexpected fixture query');
  } };
  const { app } = await loadApp(fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, ''), pool, { now: () => now });
  const login = await request(app, '/api/auth/login', { departmentId: 1 }); assert.equal(login.status, 200);
  return { app, calls, session: login.body.data.token, expire: () => { now += 8 * 3600_000; } };
}

test('M1/M2 catalog routes reject missing, invalid and expired sessions before any DB query', async () => {
  const { app, calls, session, expire } = await catalog(); const before = calls.length;
  for (const url of ['/api/receiving-documents/suppliers', '/api/receiving-documents/supplier-products?supplier_key=sm:1']) {
    for (const session of [undefined, 'invalid', 'expired-synthetic-session']) assert.equal((await request(app, url, undefined, session)).status, 401);
  }
  expire();
  for (const url of ['/api/receiving-documents/suppliers', '/api/receiving-documents/supplier-products?supplier_key=sm:1']) assert.equal((await request(app, url, undefined, session)).status, 401);
  assert.equal(calls.length, before);
});

test('M1 catalog returns master identity only, escapes search literally, limits results and binds scope; cross-area spoof rejected', async () => {
  const { app, calls, session } = await catalog();
  const q = "vic%_' OR 1=1 --";
  const result = await request(app, `/api/receiving-documents/suppliers?q=${encodeURIComponent(q)}`, undefined, session);
  assert.equal(result.status, 200); assert.equal(result.headers['cache-control'], 'private, no-store'); assert.deepEqual(result.body.data, [{ supplier_key: 'sm:1', name: 'ร้านน้ำแข็ง vic', code: 'SYN-VIC', supplier_master_id: 1, product_group_id: null }]);
  const query = calls.find(c => c.sql.startsWith('SELECT supplier_key'));
  assert.equal(query.sql.includes(q), false); assert.equal(query.params[0], "%vic!%!_' OR 1=1 --%");
  assert.deepEqual(Array.from(query.params.slice(-2)), [1, 1]); assert.match(query.sql, /LIMIT 30/);
  assert.match(query.sql, /product_group_scopes/); assert.match(query.sql, /product_supplier_master_links/);
  assert.doesNotMatch(JSON.stringify(result.body), /SENSITIVE/);
  for (const suffix of ['branch_id=2', 'department_id=2']) assert.equal((await request(app, `/api/receiving-documents/suppliers?${suffix}`, undefined, session)).status, 403);
  for (const suffix of ['branch_id=bad', `q=${'x'.repeat(101)}`, 'q[]=vic']) assert.equal((await request(app, `/api/receiving-documents/suppliers?${suffix}`, undefined, session)).status, 422);
});

test('M2 recommendations accept only scoped existing master/group IDs, union aliases and confirmed local history, and expose no blind facts', async () => {
  const { app, calls, session } = await catalog();
  for (const key of ['sm:1', 'pg:1']) {
    const result = await request(app, `/api/receiving-documents/supplier-products?supplier_key=${key}`, undefined, session);
    assert.equal(result.status, 200); assert.equal(result.headers['cache-control'], 'private, no-store'); assert.deepEqual(result.body.data, [{ id: 9, name: 'น้ำแข็งหลอดใหญ่', unit_id: 2, unit_name: 'ถุง' }]);
    assert.doesNotMatch(JSON.stringify(result.body), /999|35|SECRET|quantity|price|bill_text/);
  }
  const query = calls.find(c => c.sql.startsWith('SELECT p.id, p.name'));
  assert.match(query.sql, /a.confirm_count >= 1/); assert.match(query.sql, /d.status = 'confirmed'/);
  assert.match(query.sql, /d.branch_id = \? AND d.department_id = \?/); assert.match(query.sql, /LIMIT 20/);
  assert.deepEqual(Array.from(query.params), [1, 1, 'sm:1', 1, 1, 1]);
  for (const key of ['', 'name:vic', 'sm:-1', 'sm:1 OR 1=1', 'sm:9007199254740992']) assert.equal((await request(app, `/api/receiving-documents/supplier-products?supplier_key=${encodeURIComponent(key)}`, undefined, session)).status, 422);
  assert.equal((await request(app, '/api/receiving-documents/supplier-products?supplier_key=sm:999', undefined, session)).status, 404);
  assert.equal((await request(app, '/api/receiving-documents/supplier-products?supplier_key=pg:999', undefined, session)).status, 404);
  assert.equal((await request(app, '/api/receiving-documents/supplier-products?supplier_key=sm:1&department_id=2', undefined, session)).status, 403);
});

test('M1 no-order create takes canonical supplier name and rejects unknown or ambiguous identities', async () => {
  const h = await createReceivingHarness({ prepareCount: false, testDate: '2026-10-20' });
  const body = { client_uuid: 'm-canonical', kind: 'manual_receipt', delivery_date: h.today, supplier_master_id: 8, supplier_name_text: 'vic typo', order_item_ids: [] };
  const created = await h.invoke('createDocument', { user, body }); assert.equal(created.statusCode, 201);
  assert.equal(created.body.data.supplier_master_id, 8); assert.equal(created.body.data.supplier_name_text, 'บจก. ซัพพลายเออร์หลัก');
  for (const patch of [{ supplier_master_id: 999 }, { supplier_master_id: 8, product_group_id: 3 }]) {
    const result = await h.invoke('createDocument', { user, body: { ...body, client_uuid: `m-${JSON.stringify(patch)}`, ...patch } });
    assert.equal(result.statusCode, patch.product_group_id ? 422 : 404);
  }
});

test('M1/M2 no-order manual receiving counts explicitly, retries once, confirms/voids reporting order and inventory while preserving pre-existing orders', async () => {
  const h = await createReceivingHarness({ prepareCount: false, testDate: '2026-10-20' });
  const orders = structuredClone(h.state.orderItems);
  const created = await h.invoke('createDocument', { user, body: { client_uuid: 'm-no-order', kind: 'manual_receipt', delivery_date: h.today, supplier_master_id: 8, order_item_ids: [] } });
  assert.equal(created.statusCode, 201); assert.equal(created.body.data.lines.length, 0);
  const params = { id: String(created.body.data.id) };
  const count = { client_uuid: 'm-no-order', lines: [{ product_id: 7, counted_quantity: '0.30', unit_text: 'กก.' }] };
  assert.equal((await h.invoke('saveCount', { user, params, body: { ...count, lines: [] } })).statusCode, 422);
  const saved = await h.invoke('saveCount', { user, params, body: count }); assert.equal(saved.statusCode, 200);
  assert.equal(saved.body.data.lines[0].counted_quantity, '0.30');
  assert.equal((await h.invoke('saveCount', { user, params, body: count })).statusCode, 200); assert.equal(h.state.lines.length, 1);
  const line = saved.body.data.lines[0];
  assert.equal((await h.invoke('updateDocument', { user, params, body: { lines: [{ id: line.id, review_decision: 'missing_bill' }] } })).statusCode, 200);
  assert.equal((await h.invoke('addSignature', { user, params, body: { role: 'receiver', image_data_url: makePngDataUrl() } })).statusCode, 200);
  assert.equal((await h.invoke('confirmDocument', { user, params })).statusCode, 200);
  assert.equal((await h.invoke('confirmDocument', { user, params })).statusCode, 409);
  assert.equal(Number(h.state.inventoryBalances.get('7:10').quantity), 5.3);
  assert.equal(h.state.orderItems.length, orders.length + 1);
  assert.equal(h.state.orders.length, 1);
  assert.equal(h.state.mirrors[0].receiving_order_item_id, h.state.lines[0].order_item_id);
  assert.equal(h.state.orderItems.at(-1).received_quantity, 0.3);
  assert.deepEqual(h.state.orderItems.filter(row => orders.some(old => old.id === row.id)), orders);
  assert.equal((await h.invoke('voidDocument', { user, params, body: { reason: 'synthetic correction' } })).statusCode, 200);
  assert.equal((await h.invoke('voidDocument', { user, params, body: { reason: 'synthetic correction' } })).statusCode, 409);
  assert.equal(Number(h.state.inventoryBalances.get('7:10').quantity), 5);
  assert.equal(h.state.orders[0].status, 'cancelled');
  assert.equal(h.state.mirrors[0].is_active, false);
  assert.deepEqual(h.state.orderItems.filter(row => orders.some(old => old.id === row.id)), orders);
});


test('M1/M2 administrators select a valid target area; inconsistent areas fail before catalog SQL; database errors stay sanitized', async () => {
  const h = await createReceivingHarness({ prepareCount: false });
  const queries = [];
  const db = { async query(sql, params) {
    queries.push({ sql, params });
    if (sql.includes('FROM departments')) return [[{ id: 20, branch_id: 2 }]];
    if (sql.startsWith('SELECT supplier_key')) return [[]];
    throw Error('unexpected fixture query');
  } };
  const admin = { ...user, role: 'admin' };
  const rows = await h.catalog.searchReceivingSuppliers({ user: admin, filters: { branch_id: 2, department_id: 20 }, db });
  assert.equal(rows.length, 0); assert.deepEqual(Array.from(queries.at(-1).params.slice(-2)), [2, 20]);
  const before = queries.filter(q => q.sql.startsWith('SELECT supplier_key')).length;
  await assert.rejects(h.catalog.searchReceivingSuppliers({ user: admin, filters: { branch_id: 1, department_id: 20 }, db }), e => e.code === 'VALIDATION_FAILED');
  assert.equal(queries.filter(q => q.sql.startsWith('SELECT supplier_key')).length, before);
  const failed = h.invokeErrorMiddleware(new Error('SQL fixture-private internal payload'));
  assert.equal(failed.statusCode, 500); assert.doesNotMatch(JSON.stringify(failed.body), /fixture-private|SQL|stack/);
});
