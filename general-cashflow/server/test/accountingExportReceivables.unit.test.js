import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  canonicalRevision,
  createAccountingExportHandler,
  filterPaginate,
  serializeAccountingRow,
  validateExportQuery
} from '../src/accountingExportReceivables.js';

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../management-accounting/docs/contracts/general-cashflow/fixtures/source');
const readFixture = (name) => JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
const query = validateExportQuery({ from: '2026-08-01', to: '2026-08-31', branch: 'SK' });

test('query validation enforces pilot scope, strict dates and bounded pagination', () => {
  assert.deepEqual(query, { from: '2026-08-01', to: '2026-08-31', branch: 'SK', updatedSince: null, limit: 100, offset: 0, closedOnly: true });
  assert.throws(() => validateExportQuery({ from: '2026-07-31', to: '2026-08-31', branch: 'SK' }), (error) => error.code === 'INVALID_DATE_RANGE');
  assert.throws(() => validateExportQuery({ from: '2026-08-01', to: '2026-08-31', branch: 'KK' }), (error) => error.code === 'INVALID_BRANCH');
  assert.throws(() => validateExportQuery({ from: '2026-08-01', to: '2026-08-31', branch: 'SK', limit: '0' }), (error) => error.code === 'INVALID_PAGINATION');
  assert.throws(() => validateExportQuery({ from: '2026-08-01', to: '2026-08-31', branch: 'SK', updated_since: '2026-08-01' }), (error) => error.code === 'INVALID_UPDATED_SINCE');
});

test('CLOSED source rows retain decimal strings and OPEN rows expose status only', () => {
  const closed = readFixture('daily-sale-closed.json').data[0];
  const result = serializeAccountingRow('pos_daily_sale', closed);
  assert.equal(result.record_status, 'CLOSED_READY');
  assert.equal(result.gross_amount_incl_vat, '12500.00');
  assert.equal(typeof result.revision, 'string');
  const open = serializeAccountingRow('receipt_day', readFixture('open-status-only.json').data[0]);
  assert.equal(open.record_status, 'OPEN_STATUS_ONLY');
  assert.equal(open.gross_sales_expected, null);
  assert.equal(open.morning_change_amount, null);
  assert.deepEqual(open.issues, ['OPEN_STATUS_ONLY']);
});

test('quarantined mapping/account rows never become financial facts', () => {
  const mapping = serializeAccountingRow('receipt_expectation', readFixture('unknown-mapping.json').data[0]);
  assert.equal(mapping.record_status, 'QUARANTINED');
  assert.equal(mapping.expected_gross_amount, '700.00');
  const account = serializeAccountingRow('cash_settlement', readFixture('unknown-account.json').data[0]);
  assert.equal(account.record_status, 'QUARANTINED');
  assert.equal(account.net_amount, '800.00');
  assert.equal(account.receiving_account_ref, 'bank-unmapped-sanitized');
});

test('malformed source rows are rejected without a balancing amount', () => {
  const row = serializeAccountingRow('cash_settlement', readFixture('malformed.json').invalid_rows[0]);
  assert.equal(row.record_status, 'REJECTED');
  assert.equal(row.net_amount, null);
  assert.ok(row.issues.includes('INVALID_DECIMAL_SCALE'));
  assert.ok(row.issues.includes('INVALID_DATE'));
  assert.ok(row.issues.includes('INVALID_UPDATED_AT'));
  assert.ok(row.issues.includes('INVALID_REVISION'));
  assert.ok(row.issues.includes('UNMAPPED_SETTLEMENT_STATUS'));
});

test('account master output has only masked last four digits', () => {
  const row = serializeAccountingRow('receiving_account', readFixture('privacy-masked-account.json').data[0]);
  assert.equal(row.account_last4, '0427');
  for (const forbidden of ['account_number', 'account_name', 'token', 'holder_name', 'raw_statement_payload']) assert.equal(forbidden in row, false);
});

test('filtering is deterministic and updated_since is exclusive', () => {
  const rows = readFixture('cross-day-partial.json').data;
  const result = filterPaginate(rows, { ...query, updatedSince: '2026-08-11T12:00:00+07:00', limit: 1, offset: 0 }, 'cash_settlement');
  assert.equal(result.pagination.total, 1);
  assert.equal(result.data[0].source_id, 'gc:cash-settlement:batch-cross-day-02');
  assert.equal(result.pagination.next_offset, null);
});

test('handler uses injected loader and emits contract envelopes without writes', async () => {
  let calls = 0;
  const handler = createAccountingExportHandler({
    sourceType: 'pos_daily_sale',
    authenticate: async () => {},
    loadRows: async ({ sourceType, from, to, branch }) => {
      calls += 1;
      assert.deepEqual({ sourceType, from, to, branch }, { sourceType: 'pos_daily_sale', from: '2026-08-01', to: '2026-08-31', branch: 'SK' });
      return readFixture('daily-sale-closed.json').data;
    }
  });
  const response = {};
  response.status = (status) => { response.statusCode = status; return response; };
  response.json = (body) => { response.body = body; return response; };
  await handler({ query: { from: '2026-08-01', to: '2026-08-31', branch: 'SK' } }, response);
  assert.equal(calls, 1);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.source_type, 'pos_daily_sale');
  assert.equal(response.body.data[0].gross_amount_incl_vat, '12500.00');
});

test('canonical revision is stable and excludes volatile timestamps', () => {
  const row = { source_id: 'gc:test', value: 'x', updated_at: '2026-08-01T01:00:00+07:00' };
  assert.equal(canonicalRevision(row), canonicalRevision({ ...row, updated_at: '2026-08-02T01:00:00+07:00' }));
});
