import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  ACCOUNTING_EXPORT_ENDPOINTS,
  ACCOUNTING_EXPORT_FIXTURE_HOST,
  ACCOUNTING_EXPORT_FIXTURE_TOKEN,
  createAccountingExportFixtureServer,
  startAccountingExportFixtureServer,
} from './helpers/accountingExportFixtureServer.js';

const query = new URLSearchParams({
  from: '2026-08-01',
  to: '2026-08-31',
  branch: 'SK',
});

const request = (fixtureServer, pathname, options = {}) => new Promise((resolve, reject) => {
  const url = new URL(pathname, fixtureServer.baseUrl);
  for (const [key, value] of Object.entries(options.query || {})) url.searchParams.set(key, value);
  const req = http.request(url, {
    method: options.method || 'GET',
    headers: options.headers || { authorization: `Bearer ${fixtureServer.token}` },
  }, (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = body; }
      resolve({ status: res.statusCode, headers: res.headers, body: parsed });
    });
  });
  req.on('error', reject);
  req.end();
});

test('ephemeral loopback fixture server serves all six GET exports from committed fixtures', async (t) => {
  const fixtureServer = await startAccountingExportFixtureServer();
  t.after(() => fixtureServer.stop());
  assert.equal(fixtureServer.address.address, ACCOUNTING_EXPORT_FIXTURE_HOST);
  assert.match(fixtureServer.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);

  const expected = new Map([
    ['daily-sales', 'pos_daily_sale'],
    ['daily-receipts', 'receipt_day'],
    ['daily-receipt-lines', 'receipt_expectation'],
    ['settlements', 'cash_settlement'],
    ['payment-channels', 'payment_channel'],
    ['receiving-accounts', 'receiving_account'],
  ]);
  assert.deepEqual(Object.keys(ACCOUNTING_EXPORT_ENDPOINTS).map((route) => route.split('/').at(-1)), [...expected.keys()]);
  for (const [route, sourceType] of expected) {
    const result = await request(fixtureServer, `/accounting-export/${route}?${query}`);
    assert.equal(result.status, 200, route);
    assert.equal(result.body.schema_version, '1.0');
    assert.equal(result.body.source, 'GENERAL_CASHFLOW');
    assert.equal(result.body.source_type, sourceType);
    assert.ok(Array.isArray(result.body.data));
    assert.equal(result.body.pagination.offset, 0);
  }
});

test('fixture server enforces header auth before fixture loading and never accepts query tokens', async (t) => {
  const fixtureServer = createAccountingExportFixtureServer();
  await fixtureServer.start();
  t.after(() => fixtureServer.stop());
  const route = '/accounting-export/daily-sales';
  for (const headers of [{}, { authorization: 'Bearer wrong' }, { 'x-accounting-sync-token': 'wrong' }]) {
    const result = await request(fixtureServer, `${route}?${query}`, { headers });
    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'ACCOUNTING_EXPORT_UNAUTHORIZED');
    assert.doesNotMatch(JSON.stringify(result.body), /token|authorization/i);
  }
  const queryToken = new URLSearchParams(query);
  queryToken.set('token', ACCOUNTING_EXPORT_FIXTURE_TOKEN);
  const queryResult = await request(fixtureServer, `${route}?${queryToken}`, { headers: {} });
  assert.equal(queryResult.status, 401);
  assert.equal(queryResult.body.error.code, 'ACCOUNTING_EXPORT_UNAUTHORIZED');
  for (const headers of [
    { authorization: `Bearer ${ACCOUNTING_EXPORT_FIXTURE_TOKEN}` },
    { 'x-accounting-sync-token': ACCOUNTING_EXPORT_FIXTURE_TOKEN },
  ]) {
    const result = await request(fixtureServer, `${route}?${query}`, { headers });
    assert.equal(result.status, 200);
  }
});

test('fixture server preserves contract filtering, OPEN status-only rows and deterministic pagination', async (t) => {
  const fixtureServer = await startAccountingExportFixtureServer();
  t.after(() => fixtureServer.stop());
  const route = '/accounting-export/daily-receipts';
  const closed = await request(fixtureServer, `${route}?${query}`, { query: { limit: '1' } });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.pagination.total, 3);
  assert.equal(closed.body.pagination.next_offset, 1);
  const next = await request(fixtureServer, `${route}?${query}`, { query: { limit: '1', offset: '1' } });
  assert.equal(next.status, 200);
  assert.equal(next.body.pagination.next_offset, 2);
  assert.notEqual(closed.body.data[0].source_id, next.body.data[0].source_id);
  const all = await request(fixtureServer, `${route}?${query}`, { query: { closed_only: 'false' } });
  assert.equal(all.status, 200);
  const open = all.body.data.find((row) => row.record_status === 'OPEN_STATUS_ONLY');
  assert.ok(open);
  assert.equal(open.gross_sales_expected, null);
  assert.equal(open.settlement_date, undefined);
  const since = await request(fixtureServer, `${route}?${query}`, {
    query: { updated_since: '2026-08-12T23:00:00+07:00', closed_only: 'false' },
  });
  assert.equal(since.status, 200);
  assert.deepEqual(since.body.data.map((row) => row.source_id), ['gc:receipt-day:sk-2026-08-12']);
});

test('fixture server is GET-only, loopback-bound, and cleanup is deterministic', async (t) => {
  const fixtureServer = await startAccountingExportFixtureServer();
  assert.equal(fixtureServer.server.address().address, '127.0.0.1');
  const post = await request(fixtureServer, `/accounting-export/daily-sales?${query}`, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.body.error.code, 'METHOD_NOT_ALLOWED');
  await fixtureServer.stop();
  assert.equal(fixtureServer.baseUrl, null);
  await fixtureServer.stop();
  await assert.rejects(
    () => request(fixtureServer, `/accounting-export/daily-sales?${query}`),
    /ECONNREFUSED|closed|Invalid URL/,
  );
});
