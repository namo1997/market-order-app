import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import jwt from 'jsonwebtoken';

async function load(relativePath, dependencies = {}, globals = {}) {
  const context = vm.createContext({ console, process: { env: {} }, Buffer, AbortSignal, ...globals });
  const mod = new vm.SourceTextModule(await readFile(new URL(relativePath, import.meta.url), 'utf8'), { context });
  await mod.link((specifier) => {
    assert.ok(Object.hasOwn(dependencies, specifier), `Unexpected dependency: ${specifier}`);
    const exports = dependencies[specifier];
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await mod.evaluate();
  return mod.namespace;
}

test('paid AI endpoint rejects anonymous and ordinary users before calling AI; admin and service-token route remain usable', async () => {
  const auth = await load('../src/middleware/auth.js', {
    '../utils/jwt.js': { verifyToken: (token) => ({ id: 1, role: token }) }
  });
  let paidCalls = 0;
  const routes = await load('../src/routes/ai.routes.js', {
    express: { default: express },
    '../middleware/auth.js': auth,
    '../controllers/ai.controller.js': {
      chatSalesReport: (_req, res) => { paidCalls++; res.json({ success: true }); },
      getBranchDailySales: (_req, res) => res.status(503).end()
    }
  });
  const app = express();
  app.use('/api/ai', routes.default);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/ai`;
  try {
    for (const [role, status] of [[null, 401], ['user', 403], ['admin', 200], ['super_admin', 200]]) {
      const result = await fetch(`${base}/sales-report`, { method: 'POST', headers: role ? { Authorization: `Bearer ${role}` } : {} });
      assert.equal(result.status, status);
      await result.text();
    }
    assert.equal(paidCalls, 2);
    const service = await fetch(`${base}/branch-sales-daily`);
    assert.equal(service.status, 503, 'service endpoint keeps its own token authentication');
    await service.text();
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

const clickhouseEnv = { CLICKHOUSE_HOST: 'example.invalid', CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture' };

test('ClickHouse applies read-only mode, strips trailing semicolon, and detects FORMAT only at query end', async () => {
  const calls = [];
  const service = await load('../src/services/clickhouse.service.js', {}, {
    process: { env: clickhouseEnv },
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ data: [{ value: 1 }] }) }; }
  });
  await service.queryClickHouse("SELECT 'format text' AS label;");
  await service.queryClickHouse('SELECT 1 FORMAT JSON;');
  assert.equal(new URL(calls[0].url).searchParams.get('readonly'), '1');
  assert.equal(calls[0].options.body, "SELECT 'format text' AS label\nFORMAT JSON");
  assert.equal(calls[1].options.body, 'SELECT 1 FORMAT JSON');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test('ClickHouse stalled response body is aborted within configured deadline', async () => {
  const service = await load('../src/services/clickhouse.service.js', {}, {
    process: { env: { ...clickhouseEnv, CLICKHOUSE_TIMEOUT_MS: '20' } },
    fetch: async (_url, { signal }) => ({ ok: true, json: () => new Promise((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }) })
  });
  await Promise.race([
    assert.rejects(service.queryClickHouse('SELECT 1'), (error) => error.name === 'TimeoutError'),
    delay(300).then(() => { throw new Error('query did not honor timeout'); })
  ]);
});

test('daily sales rejects impossible or malformed dates instead of querying another day', async () => {
  let queries = 0;
  const controller = await load('../src/controllers/ai.controller.js', {
    '../models/branch.model.js': { getAllBranches: async () => [] },
    '../services/clickhouse.service.js': { queryClickHouse: async () => { queries++; return []; } }
  }, { process: { env: { AI_BRANCH_SALES_TOKEN: 'fixture-token' } } });
  for (const start of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-01', 'not-a-date', '']) {
    const res = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(body) { this.body = body; } };
    await controller.getBranchDailySales({ query: { start, end: '2026-12-31' }, headers: { 'x-api-key': 'fixture-token' } }, res, (error) => { throw error; });
    assert.equal(res.statusCode, 400, start);
  }
  assert.equal(queries, 0);
  const res = { status() { return this; }, json(body) { this.body = body; } };
  await controller.getBranchDailySales({ query: { start: '2024-02-29', end: '2024-02-29' }, headers: { 'x-api-key': 'fixture-token' } }, res, (error) => { throw error; });
  assert.equal(queries, 1);
  assert.equal(res.body.data.start, '2024-02-29');
});

test('AI requests carry a finite response deadline', async () => {
  let signal;
  const controller = await load('../src/controllers/ai.controller.js', {
    '../models/branch.model.js': { getAllBranches: async () => [] },
    '../services/clickhouse.service.js': { queryClickHouse: async () => [] }
  }, {
    process: { env: { OPENAI_API_KEY: 'fixture' } },
    fetch: async (_url, options) => { signal = options.signal; return { ok: true, json: async () => ({ choices: [{ message: { content: 'fixture answer' } }] }) }; }
  });
  const res = { json(body) { this.body = body; } };
  await controller.chatSalesReport({ body: { question: 'fixture question', report: {} } }, res, (error) => { throw error; });
  assert.ok(signal instanceof AbortSignal);
  assert.equal(res.body.data.answer, 'fixture answer');
});

test('readonly PR/PO sessions cannot issue or receive, and unauthenticated callers cannot read employees or run internal chatbot tests', async () => {
  const gpAuth = await load('../src/routes/general-purchase-auth.routes.js', {
    express: { default: express },
    jsonwebtoken: { default: { verify: (token) => ({ scope: 'general_purchase', mode: token }), sign: () => 'fixture' } },
    '../models/employee-ref.model.js': { findActiveHeadEmployeeRef: async () => null }
  });
  const auth = await load('../src/middleware/auth.js', {
    '../utils/jwt.js': { verifyToken: (token) => ({ id: 1, role: token }) }
  });
  let mutations = 0;
  const ok = (_req, res) => res.json({ success: true });
  const mutate = (_req, res) => { mutations++; res.json({ success: true }); };
  const gp = await load('../src/routes/general-purchase.routes.js', {
    express: { default: express },
    './general-purchase-auth.routes.js': gpAuth,
    '../controllers/general-purchase.controller.js': {
      listGeneralPurchaseOrders: ok, createGeneralPurchaseOrder: mutate,
      getGeneralPurchaseOrder: ok, approveGeneralPurchaseOrder: mutate,
      rejectGeneralPurchaseOrder: mutate, issueGeneralPurchasePO: mutate,
      receiveGeneralPurchaseOrder: mutate
    }
  });
  const employees = await load('../src/routes/employee-refs.routes.js', {
    express: { default: express }, '../middleware/auth.js': auth,
    './general-purchase-auth.routes.js': gpAuth,
    '../controllers/employee-ref.controller.js': { listEmployeeRefs: ok, getEmployeeRefStats: ok, syncEmployeeRefs: mutate }
  });
  const line = await load('../src/routes/line-chatbot.routes.js', {
    express: { default: express }, '../middleware/auth.js': auth,
    '../controllers/line-chatbot.controller.js': { handleWebhook: ok, handleDisabledWebhook: ok, testCommand: mutate }
  });
  const app = express();
  app.use('/gp', gp.default); app.use('/employees', employees.default); app.use('/line', line.default);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method, headers, expected) => {
    const result = await fetch(base + path, { method, headers });
    assert.equal(result.status, expected, `${method} ${path}`); await result.text();
  };
  try {
    for (const path of ['/gp/1/issue-po', '/gp/1/receive']) {
      await request(path, 'POST', {}, 401);
      await request(path, 'POST', { 'x-general-purchase-token': 'readonly' }, 403);
      await request(path, 'POST', { 'x-general-purchase-token': 'employee_head' }, 200);
    }
    assert.equal(mutations, 2);
    await request('/employees', 'GET', {}, 401);
    await request('/employees', 'GET', { 'x-general-purchase-token': 'employee_head' }, 200);
    await request('/employees/sync', 'POST', { 'x-general-purchase-token': 'readonly' }, 401);
    await request('/employees/sync', 'POST', { Authorization: 'Bearer user' }, 403);
    await request('/employees/sync', 'POST', { Authorization: 'Bearer admin' }, 200);
    for (const method of ['GET', 'POST']) {
      await request('/line/test-command', method, {}, 401);
      await request('/line/test-command', method, { Authorization: 'Bearer user' }, 403);
      await request('/line/test-command', method, { Authorization: 'Bearer admin' }, 200);
    }
    await request('/line/webhook', 'POST', {}, 200, 'webhook retains controller signature validation');
    assert.equal(mutations, 5);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

for (const configuredPin of ['', '1997']) test(`production PR/PO disables ${configuredPin ? 'default' : 'missing'} PIN and refuses employee tokens signed with the development key`, async () => {
  const routes = await load('../src/routes/general-purchase-auth.routes.js', {
    express: { default: express }, jsonwebtoken: { default: jwt },
    '../models/employee-ref.model.js': { findActiveHeadEmployeeRef: () => assert.fail('unverified token reached employee lookup') }
  }, {
    process: { env: { NODE_ENV: 'production', JWT_SECRET: 'fixture-production-signing-secret-32-characters', GENERAL_PURCHASE_READONLY_PIN: configuredPin } },
    AbortController, setTimeout, clearTimeout,
    fetch: async () => ({ ok: false })
  });
  const app = express(); app.use(express.json()); app.use(routes.default);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const pin = await fetch(`${base}/pin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '1997' }) });
    assert.equal(pin.status, 503); await pin.text();
    const exchange = await fetch(`${base}/employee/exchange`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: jwt.sign({ id: 1, employee_code: '1' }, 'solao-leave-secret-2025') })
    });
    assert.equal(exchange.status, 401); await exchange.text();
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
