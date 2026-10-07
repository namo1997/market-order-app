import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadConfig, clientForBearer, requireScope} from '../src/config.mjs';
import {createService, date, range} from '../src/service.mjs';

const token = 'a'.repeat(48);
const config = loadConfig({
  BUSINESS_MCP_CLIENTS_JSON: JSON.stringify([{name: 'owner', token_sha256: createHash('sha256').update(token).digest('hex'), branches: ['KK'], min_date: '2026-01-01', max_date: '2026-12-31', allow_person_details: false, employee_ids: []}]),
  BUSINESS_BRANCH_MAP_JSON: JSON.stringify([{code: 'KK', market_order_id: 1, hrms_id: 'BR02', cashflow_code: 'KK', line_source_id: 'G_KK'}, {code: 'SK', market_order_id: 2, hrms_id: 'BR03', cashflow_code: 'SK', line_source_id: 'G_SK'}])
});
const client = config.clients[0];
const readers = {
  readMarket: async () => ({period: {kind: 'SALE_DATE', from: '2026-10-05', to: '2026-10-05'}, basis: 'AS_REPORTED', summary: {bill_count: 5, revenue_thb: 500, menu_count: 3}, freshness: null, limitations: [], detail: {daily: []}}),
  callHrms: async () => ({year: 2026, generated_at: '2026-10-06T00:00:00Z', employee_status: [{status: 'ACTIVE', count: 4}], leave_requests_by_status: [{status: 'PENDING', count: 1}], attendance_needs_review_last_7_days: 0}),
  readLineRounds: async () => ({data: [{id: 'G_KK:2026-10-05', source_id: 'G_KK', business_date: '2026-10-05', status: 'open'}], pagination: {next_offset: null}}),
  readCashflow: async () => ({source: 'GENERAL_CASHFLOW', day: '2026-10-05', rows: [{receipt_id: 1, branch_code: 'KK', business_date: '2026-10-05', exceeds_100_thb: true}, {receipt_id: 2, branch_code: 'SK', business_date: '2026-10-05', exceeds_100_thb: true}], pagination: {complete: false, next_cursor: '2'}, coverage: {refunds: 'UNAVAILABLE'}, generated_at: '2026-10-06T00:00:00Z'})
};

test('auth and branch scope are enforced', () => {
  assert.equal(clientForBearer(config, `Bearer ${token}`), client);
  assert.equal(clientForBearer(config, 'Bearer wrong'), null);
  assert.throws(() => requireScope(config, client, ['SK']), /outside/);
  assert.throws(() => range('2026-02-30', '2026-03-01'), /Invalid/);
  assert.equal(date('2026-10-05'), '2026-10-05');
});

test('overview is bounded and reports incomplete coverage', async () => {
  const service = createService(config, client, readers);
  const result = await service.overview({branches: ['KK'], from: '2026-10-05', to: '2026-10-05'});
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.sources.length, 4);
  assert.equal(result.sources.find(x => x.source === 'GENERAL_CASHFLOW').variance_candidates_on_page, 1);
  assert.equal(result.sources.find(x => x.source === 'LINE_BILL').rounds[0].status, 'open');
  assert.equal(result.missing_coverage.length, 1);
  await assert.rejects(service.overview({branches: ['SK'], from: '2026-10-05', to: '2026-10-05'}), /outside/);
  await assert.rejects(service.overview({branches: ['KK'], from: '2025-10-05', to: '2025-10-05'}), /Date outside/);
});

test('person details require an explicit allowlist', async () => {
  const service = createService(config, client, readers);
  await assert.rejects(service.person({branch: 'KK', from: '2026-10-05', to: '2026-10-05', employee_id: 'E1', section: 'employees'}), /outside/);
});

test('analysis reads only its relevant source', async () => {
  const service = createService(config, client, {...readers, readMarket: () => {throw new Error('Unexpected market read');}, readLineRounds: () => {throw new Error('Unexpected line read');}});
  const result = await service.analyze({goal: 'compare_current_headcount', branches: ['KK'], from: '2026-10-05', to: '2026-10-05'});
  assert.equal(result.status, 'OK');
  assert.equal(result.observations[0].active_headcount, 4);
});

test('closed LINE snapshot removes raw transaction fields and paginates', async () => {
  const service = createService(config, client, {...readers, readLineSnapshot: async () => ({business_date: '2026-10-05', revision: 'r1', fingerprint: 'f1', summary: {confirmed_count: 1, transactions: [{account_number: '1234567890'}]}, items: [{id: '1', description: 'โอน 1234567890', amount_incl_vat: 100, raw_transaction: {account_number: 'sensitive'}}]})});
  const result = await service.lineSnapshot({branch: 'KK', round_id: 'G_KK:2026-10-05'});
  assert.equal(result.items[0].amount_incl_vat, 100);
  assert.equal(JSON.stringify(result).includes('account_number'), false);
  assert.equal(JSON.stringify(result).includes('1234567890'), false);
  assert.equal(result.summary.confirmed_count, 1);
});

test('receipt pages reject duplicates and only return authorized branch', async () => {
  const service = createService(config, client, readers);
  const first = await service.receipts({branch: 'KK', from: '2026-10-05', to: '2026-10-05', limit: 1});
  assert.deepEqual(first.rows.map(row => row.receipt_id), [1]);
  assert.ok(first.next_cursor);
  await assert.rejects(service.receipts({branch: 'KK', from: '2026-10-05', to: '2026-10-05', limit: 1, cursor: first.next_cursor}), /Duplicate/);
});

test('findings have stable IDs and reread evidence without claiming resolution', async () => {
  const service = createService(config, client, readers);
  const result = await service.findings({branches: ['KK'], from: '2026-10-05', to: '2026-10-05'});
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.findings[0].id, 'cashflow:KK:2026-10-05:1:VARIANCE_CANDIDATE');
  const detail = await service.finding({finding_id: result.findings[0].id});
  assert.equal(detail.status, 'REQUIRES_REVIEW');
  assert.equal(detail.evidence.receipt_id, 1);
});
