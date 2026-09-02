import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createAccountingExportHandler,
  createAccountingExportHandlers,
} from '../src/accountingExportReceivables.js';
import { normalizeReceivables } from '../../../management-accounting/server/src/receivables-normalization.js';

// This is an independent consumer-side contract suite. It imports only the
// pure source adapter and pure target normalizer; no server, DB, token, or
// network module is loaded.
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const sourceDir = path.join(repo, 'management-accounting/docs/contracts/general-cashflow/fixtures/source');
const normalizedDir = path.join(repo, 'management-accounting/server/test/fixtures/receivables/normalized');
const sourceFiles = fs.readdirSync(sourceDir).filter((name) => name.endsWith('.json')).sort();

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const fixtures = new Map(sourceFiles.map((name) => [name, readJson(path.join(sourceDir, name))]));
const normalized = new Map(sourceFiles.map((name) => [name, readJson(path.join(normalizedDir, name))]));
const query = { from: '2026-08-01', to: '2026-08-31', branch: 'SK', closed_only: 'false' };
const token = 'local-contract-token';

function auth(req) {
  const authorization = String(req.headers?.authorization || '');
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const alternate = String(req.headers?.['x-accounting-sync-token'] || '');
  if (bearer !== token && alternate !== token) {
    const error = new Error('Unauthorized');
    error.code = 'ACCOUNTING_EXPORT_UNAUTHORIZED';
    error.statusCode = 401;
    throw error;
  }
}

async function invoke(sourceType, rows, options = {}) {
  let calls = 0;
  let status = 200;
  let body;
  const handler = createAccountingExportHandler({
    sourceType,
    loadRows: async () => {
      calls += 1;
      return rows;
    },
    authenticate: auth,
  });
  const req = {
    method: options.method || 'GET',
    headers: options.headers || { authorization: `Bearer ${token}` },
    query: { ...query, ...(options.query || {}) },
  };
  const res = {
    status(code) { status = code; return this; },
    json(value) { body = value; return this; },
  };
  await handler(req, res);
  return { status, body, calls };
}

function cents(value) {
  if (value == null) return null;
  const [whole, fraction] = String(value).split('.');
  return Number(whole) * 100 + Number((fraction || '').padEnd(2, '0'));
}

test('all six source types expose the fixed envelope through local mocked GET handlers', async () => {
  const handlers = createAccountingExportHandlers({ loadRows: async () => [], authenticate: auth });
  assert.deepEqual(Object.keys(handlers).sort(), [
    'cash_settlement', 'payment_channel', 'pos_daily_sale', 'receipt_day',
    'receipt_expectation', 'receiving_account',
  ]);
  const sourceTypes = [...new Set([...fixtures.values()].map((fixture) => fixture.source_type))];
  for (const sourceType of sourceTypes) {
    const rows = [...fixtures.values()]
      .filter((fixture) => fixture.source_type === sourceType)
      .flatMap((fixture) => fixture.data);
    const result = await invoke(sourceType, rows);
    assert.equal(result.status, 200, sourceType);
    assert.equal(result.body.schema_version, '1.0');
    assert.equal(result.body.source, 'GENERAL_CASHFLOW');
    assert.equal(result.body.source_type, sourceType);
    assert.ok(Array.isArray(result.body.data));
    assert.equal(result.body.pagination.offset, 0);
  }
});

test('authentication accepts either configured header and rejects missing or wrong credentials before loading rows', async () => {
  const rows = fixtures.get('daily-sale-closed.json').data;
  for (const headers of [{}, { authorization: 'Bearer wrong' }, { 'x-accounting-sync-token': 'wrong' }]) {
    const result = await invoke('pos_daily_sale', rows, { headers });
    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'ACCOUNTING_EXPORT_UNAUTHORIZED');
    assert.equal(result.calls, 0);
    assert.doesNotMatch(JSON.stringify(result.body), /local-contract-token/);
  }
  for (const headers of [{ authorization: `Bearer ${token}` }, { 'x-accounting-sync-token': token }]) {
    const result = await invoke('pos_daily_sale', rows, { headers });
    assert.equal(result.status, 200);
    assert.equal(result.calls, 1);
  }
});

test('query scope, strict pagination and updated_since errors use stable request envelopes', async () => {
  const cases = [
    [{ ...query, from: '2026-07-31' }, 'INVALID_DATE_RANGE'],
    [{ ...query, branch: 'KK' }, 'INVALID_BRANCH'],
    [{ ...query, updated_since: 'not-a-date' }, 'INVALID_UPDATED_SINCE'],
    [{ ...query, limit: '0' }, 'INVALID_PAGINATION'],
    [{ ...query, limit: '501' }, 'INVALID_PAGINATION'],
    [{ ...query, offset: '-1' }, 'INVALID_PAGINATION'],
    [{ ...query, closed_only: 'maybe' }, 'INVALID_PAGINATION'],
  ];
  for (const [badQuery, code] of cases) {
    const result = await invoke('pos_daily_sale', fixtures.get('daily-sale-closed.json').data, { query: badQuery });
    assert.equal(result.status, 400, code);
    assert.equal(result.body.error.code, code);
    assert.doesNotMatch(JSON.stringify(result.body), /account_number|token|authorization/i);
  }
});

test('filters and deterministic pagination are replayable and updated_since is exclusive', async () => {
  const rows = [
    { ...fixtures.get('daily-sale-closed.json').data[0], source_id: 'gc:pos-daily-sale:sk-2026-08-03', business_date: '2026-08-03' },
    { ...fixtures.get('daily-sale-closed.json').data[0], source_id: 'gc:pos-daily-sale:sk-2026-08-04b', business_date: '2026-08-04', updated_at: '2026-08-05T00:00:00+07:00' },
    { ...fixtures.get('daily-sale-closed.json').data[0], source_id: 'gc:pos-daily-sale:sk-2026-08-05', business_date: '2026-08-05', updated_at: '2026-08-06T00:00:00+07:00' },
  ];
  const first = await invoke('pos_daily_sale', rows, { query: { ...query, limit: 2 } });
  const second = await invoke('pos_daily_sale', rows, { query: { ...query, limit: 2, offset: 2 } });
  assert.deepEqual(first.body.data.map((row) => row.source_id), [rows[0].source_id, rows[1].source_id]);
  assert.deepEqual(second.body.data.map((row) => row.source_id), [rows[2].source_id]);
  assert.equal(first.body.pagination.total, 3);
  assert.equal(first.body.pagination.next_offset, 2);
  assert.equal(second.body.pagination.next_offset, null);
  assert.equal(new Set([...first.body.data, ...second.body.data].map((row) => row.source_id)).size, 3);
  const since = await invoke('pos_daily_sale', rows, { query: { ...query, updated_since: rows[1].updated_at } });
  assert.deepEqual(since.body.data.map((row) => row.source_id), [rows[2].source_id]);
});

test('closed_only excludes OPEN financial rows while false exposes status-only metadata with null amounts', async () => {
  const rows = fixtures.get('open-status-only.json').data;
  const closed = await invoke('receipt_day', rows, { query: { ...query, closed_only: 'true' } });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.data.length, 0);
  const all = await invoke('receipt_day', rows, { query });
  assert.equal(all.body.data.length, 1);
  assert.equal(all.body.data[0].record_status, 'OPEN_STATUS_ONLY');
  for (const key of ['gross_sales_expected', 'cash_expected', 'non_cash_expected', 'actual_money_total', 'settlement_date']) {
    assert.equal(key in all.body.data[0] ? all.body.data[0][key] : null, null, key);
  }
});

test('receiving-account and unknown mappings preserve masked/status evidence under local replay', async () => {
  const account = fixtures.get('privacy-masked-account.json').data;
  const accountResult = await invoke('receiving_account', account);
  // Masters are not receipt facts; they remain available when closed_only is false.
  assert.equal(accountResult.body.data.length, 1);
  assert.equal(accountResult.body.data[0].account_last4, '0427');
  assert.equal(accountResult.body.data[0].account_number, undefined);
  assert.doesNotMatch(JSON.stringify(accountResult.body), /\b\d{10,16}\b/);
  const unknown = await invoke('receipt_expectation', fixtures.get('unknown-mapping.json').data);
  assert.equal(unknown.body.data.length, 1);
  assert.equal(unknown.body.data[0].channel_code, 'UNKNOWN_PROVIDER_X');
  assert.equal(unknown.body.data[0].expected_net_amount, null);
});

test('source output and target normalizer remain parity-compatible across approved fixture scenarios', async () => {
  for (const name of sourceFiles) {
    const source = fixtures.get(name);
    if (!source.data.length) continue;
    const sourceResult = await invoke(source.source_type, source.data);
    assert.equal(sourceResult.status, 200, name);
    const consumed = normalizeReceivables({ ...source, data: sourceResult.body.data }, { source_fixture: name });
    const expected = normalized.get(name);
    assert.equal(consumed.source_refs.length, source.data.length, `${name} source refs`);
    assert.equal(consumed.financial_facts.length, expected.financial_facts.length, `${name} financial parity`);
    assert.equal(consumed.status_only.length, expected.status_only.length, `${name} status parity`);
    for (const bucket of Object.keys(expected.preview)) {
      assert.equal(consumed.preview[bucket], expected.preview[bucket], `${name} preview.${bucket}`);
    }
    for (const key of ['source_total', 'imported_total', 'rejected_total', 'excluded_open_total', 'recognized_sales', 'expected_net_receipts', 'allocated_net', 'actual_cash_in', 'receivable_in_transit', 'recognized_fees']) {
      assert.equal(consumed.totals[key], expected.totals[key], `${name} totals.${key}`);
    }
  }
});

test('normalizer black-box replay covers revision no-op, stale replacement, CLOSED/open, and no write side effect', () => {
  const closed = fixtures.get('closed-receipt.json');
  const first = normalizeReceivables(closed, { source_fixture: 'closed-receipt.json' });
  const replay = normalizeReceivables(closed, { replay: true, existing: first.source_refs });
  assert.equal(replay.preview.duplicate_noop, 1);
  assert.equal(replay.financial_facts.length, 0);

  const oldRow = { ...closed.data[0] };
  const newRow = { ...oldRow, revision: 'b'.repeat(64), revision_of: oldRow.revision, gross_sales_expected: '12600.00' };
  const revision = normalizeReceivables({ ...closed, data: [oldRow, newRow] });
  assert.equal(revision.preview.created, 1);
  assert.equal(revision.preview.stale, 1);
  assert.equal(revision.status_only[0].record_status, 'STALE');
  assert.equal(revision.invariants.old_snapshot_overwritten, false);

  const open = normalizeReceivables(fixtures.get('open-status-only.json'));
  assert.equal(open.financial_facts.length, 0);
  assert.equal(open.preview.open_skipped, 1);
  assert.equal(open.totals.recognized_sales, '0.00');
});

test('export route wiring is GET-only and source implementation has no mutation SQL path', () => {
  const server = fs.readFileSync(path.join(repo, 'general-cashflow/server/src/server.js'), 'utf8');
  for (const route of [
    'daily-sales', 'daily-receipts', 'daily-receipt-lines', 'settlements',
    'payment-channels', 'receiving-accounts',
  ]) {
    assert.match(server, new RegExp(`app\\.get\\('/accounting-export/${route}'`));
    assert.doesNotMatch(server, new RegExp(`app\\.(post|put|patch|delete)\\('/accounting-export/${route}'`));
  }
  const source = fs.readFileSync(path.join(repo, 'general-cashflow/server/src/accountingExportReceivables.js'), 'utf8')
    .replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(source, /\b(INSERT|UPDATE|REPLACE|ALTER|DROP)\b\s+(?:INTO|FROM|TABLE|SET)/i);
});

test('network is denied for this suite and no fetch is used', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('NETWORK_DISABLED_FOR_AR_P2_C'); };
  try {
    await assert.rejects(() => globalThis.fetch('https://network-disabled.invalid'), /NETWORK_DISABLED_FOR_AR_P2_C/);
    const result = await invoke('pos_daily_sale', fixtures.get('daily-sale-closed.json').data);
    assert.equal(result.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
