import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBillOrderReferenceModel, BILL_ORDER_REFERENCE_SQL } from '../src/models/bill-order-reference.model.js';
import { createBillOrderReferenceController } from '../src/controllers/bill-order-reference.controller.js';
import express from 'express';
import { createBillOrderReferenceRoutes } from '../src/routes/bill-order-reference.routes.js';

const calls = [];
let rows = [{ order_id: 12, order_item_id: 44, order_number: 'ORD-12', order_date: '2026-10-08', branch_id: 3,
  product_id: 27, product_name: 'ปลา', ordered_quantity: '2.50', unit: 'กก.', supplier_id: null,
  product_group_id: 5, product_group_name: 'ตลาดสด', supplier_item_id: '00125', barcode: '00000125' }];
const database = { async query(sql, params) { calls.push({ sql, params }); return [rows]; } };
const model = createBillOrderReferenceModel(database);
let result = await model.listLines({ date: '2026-10-08', branch_id: 3 });
assert.equal(calls.length, 1);
assert.match(calls[0].sql.trim(), /^SELECT\b/);
assert.doesNotMatch(calls[0].sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|CALL)\b/i);
assert.deepEqual(calls[0].params, ['2026-10-08', 3, 1001]);
assert.match(BILL_ORDER_REFERENCE_SQL, /o\.order_date = \? AND b\.id = \?/);
assert.match(BILL_ORDER_REFERENCE_SQL, /o\.status IN \('submitted', 'confirmed', 'completed'\)/);
assert.match(BILL_ORDER_REFERENCE_SQL, /COALESCE\(oi\.source_product_group_id, p\.product_group_id\)/);
assert.equal(result.lines[0].ordered_quantity, 2.5);
assert.equal(result.lines[0].delivery_date, null);
assert.equal(result.lines[0].supplier_id, null);
assert.equal(result.lines[0].supplier_item_id, '00125');
assert.equal(result.lines[0].barcode, '00000125');
assert.equal(result.lines[0].order_source, 'orders');
assert.equal(result.date_basis, 'order_date');
assert.equal(result.complete, true);
rows = Array.from({ length: 1001 }, (_, i) => ({ order_item_id: i + 1 }));
result = await model.listLines({ date: '2026-10-08', branch_id: 3 });
assert.equal(result.lines.length, 1000);
assert.equal(result.complete, false);
assert.equal(result.truncated, true);
assert.equal(result.lines[0].ordered_quantity, null);

const env = { BILL_ORDER_REFERENCE_TOKEN: 'dedicated-test-token', BILL_ORDER_REFERENCE_ALLOWED_BRANCH_IDS: '1,3' };
const controller = createBillOrderReferenceController({ model, env });
const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const request = (query = { date: '2026-10-08', branch_id: '3' }, token = env.BILL_ORDER_REFERENCE_TOKEN) => ({ query, get: () => token });
const auth = (handler, req) => { const res = response(); let advanced = false; handler.authenticate(req, res, () => { advanced = true; }); return { res, advanced }; };
assert.equal(auth(controller, request(undefined, '')).res.statusCode, 401);
assert.equal(auth(controller, request(undefined, 'short')).res.statusCode, 401);
assert.equal(auth(controller, request()).advanced, true);
assert.equal(auth(createBillOrderReferenceController({ model, env: {} }), request()).res.statusCode, 503);
assert.equal(auth(createBillOrderReferenceController({ model, env: { ...env, BILL_ORDER_REFERENCE_ALLOWED_BRANCH_IDS: '1,all' } }), request()).res.statusCode, 503);
for (const query of [{ date: '2026-02-30', branch_id: '3' }, { date: '2026-10-08', branch_id: '1.5' }, { date: ['2026-10-08'], branch_id: '3' }, { date: '2026-10-08', branch_id: '3', limit: '5000' }, { date: '2026-10-08' }]) {
  const req = request(query), res = response(), before = calls.length;
  auth(controller, req); await controller.listLines(req, res);
  assert.equal(res.statusCode, 400); assert.equal(calls.length, before);
}
const denied = request({ date: '2026-10-08', branch_id: '2' }), deniedRes = response(), before = calls.length;
auth(controller, denied); await controller.listLines(denied, deniedRes);
assert.equal(deniedRes.statusCode, 403); assert.equal(calls.length, before);
const valid = request(), validRes = response(); auth(controller, valid); await controller.listLines(valid, validRes);
assert.equal(validRes.body.success, true);
const failure = createBillOrderReferenceController({ model: { async listLines() { throw new Error('unknown column'); } }, env });
const unavailable = request(), unavailableRes = response(); auth(failure, unavailable); await failure.listLines(unavailable, unavailableRes);
assert.equal(unavailableRes.statusCode, 503); assert.equal(unavailableRes.body.error, 'bill_order_reference_unavailable');
for (const path of ['../src/models/bill-order-reference.model.js', '../src/controllers/bill-order-reference.controller.js', '../src/routes/bill-order-reference.routes.js']) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /import.*(?:order\.model|product\.model|config\/database)/);
}
const app = express();
app.use('/api/bill-order-reference', createBillOrderReferenceRoutes(database, env));
const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
try {
  const url = `http://127.0.0.1:${server.address().port}/api/bill-order-reference/lines?date=2026-10-08&branch_id=3`;
  const headers = { 'x-bill-order-reference-token': env.BILL_ORDER_REFERENCE_TOKEN };
  assert.equal((await fetch(url)).status, 401);
  const beforeHttp = calls.length;
  const http = await fetch(url, { headers });
  assert.equal(http.status, 200);
  const body = await http.json();
  assert.equal(body.data.lines.length, 1000);
  assert.equal(body.data.complete, false);
  assert.equal(calls.length, beforeHttp + 1);
  const afterHttp = calls.length;
  assert.equal((await fetch(url, { method: 'POST', headers })).status, 404);
  assert.equal((await fetch(url.replace('branch_id=3', 'branch_id=2'), { headers })).status, 403);
  assert.equal((await fetch(`${url}&branch_id=1`, { headers })).status, 400);
  assert.equal(calls.length, afterHttp);
} finally {
  await new Promise(resolve => server.close(resolve));
}
console.log('bill-order-reference: SELECT-only query, exact scope, dedicated auth, branch allowlist, cap, unknown values and schema failure passed');
