import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCompanyMonthlySummary,
  buildMonthlySalesCloseSnapshot,
  parseMonthlyCloseMonth
} from '../src/domain/monthlySalesClose.js';
import {
  closeMonthlySales,
  exportMonthlySalesCloseData,
  exportMonthlySalesCloses
} from '../src/monthlySalesClose.js';

const sha = (character) => character.repeat(64);
const updatedAt = '2026-09-01 08:00:00';
const dates = Array.from({ length: 31 }, (_, index) => `2026-08-${String(index + 1).padStart(2, '0')}`);

const closedMonth = () => ({
  pos_daily_sale: dates.map((business_date, index) => ({
    source_id: `sale-${business_date}`, revision: sha('a'), updated_at: updatedAt,
    business_date, branch_code: 'SK', gross_amount_incl_vat: '100.00', bill_count: 2,
    receipt_status: 'CLOSED', closed_at: updatedAt, is_finalized: true, currency: 'THB'
  })),
  receipt_day: dates.map((business_date) => ({
    source_id: `receipt-${business_date}`, source_receipt_id: `receipt-${business_date}`,
    revision: sha('b'), updated_at: updatedAt, business_date, branch_code: 'SK',
    receipt_status: 'CLOSED', source_receipt_status: 'CLOSED', gross_sales_expected: '100.00',
    cash_expected: '0.00', non_cash_expected: '100.00', morning_change_amount: '0.00', bill_count: 2,
    closed_at: updatedAt, closing_snapshot_version: 1, actual_money_total: '0.00', deduction_total: '20.00',
    line_adjustment_total: '0.00', misc_adjustment_total: '0.00', pos_with_change_total: '100.00',
    reconciled_total: '20.00', variance_total: '-80.00', currency: 'THB'
  })),
  receipt_expectation: dates.map((business_date, index) => ({
    source_id: `expectation-${business_date}`, source_receipt_line_id: `line-${index + 1}`,
    source_receipt_id: `receipt-${business_date}`, revision: sha('c'), updated_at: updatedAt,
    business_date, branch_code: 'SK', receipt_status: 'CLOSED', source_receipt_status: 'CLOSED',
    channel_code: 'GRAB', channel_label: 'GRAB food', channel_kind: 'ewallet', provider: 'GRAB',
    pos_amount: '100.00', cashier_confirmed_amount: '100.00', expected_gross_amount: '100.00',
    expected_fee_amount: '20.00', expected_net_amount: '80.00', source_settlement_status: 'PENDING_EVIDENCE',
    settlement_status: 'PENDING_EVIDENCE', source_settlement_source: 'GRAB_REPORT', settlement_date: null,
    currency: 'THB'
  })),
  cash_settlement: dates.map((business_date, index) => ({
    source_id: `settlement-${business_date}`, source_settlement_id: `settlement-${index + 1}`,
    source_receipt_line_id: `line-${index + 1}`, source_batch_id: null, revision: sha('d'), updated_at: updatedAt,
    business_date, settlement_date: null, branch_code: 'SK', channel_code: 'GRAB',
    receiving_account_ref: null, gross_amount: '100.00', fee_amount: '20.00', net_amount: '80.00',
    actual_money_amount: null, matched_amount: null, allocated_net_amount: null, allocated_fee_amount: null,
    allocation_method: 'EXPLICIT_LINE', source_settlement_status: 'PENDING_EVIDENCE',
    settlement_status: 'PENDING_EVIDENCE', source_settlement_source: 'GRAB_REPORT',
    settlement_source: 'GRAB_REPORT', evidence_ref: null, receipt_status: 'CLOSED', currency: 'THB'
  })),
  receivable_adjustment: [], payment_channel: [], receiving_account: []
});

test('month parser returns an exact calendar range', () => {
  assert.deepEqual(parseMonthlyCloseMonth('2026-02'), { month: '2026-02', from: '2026-02-01', to: '2026-02-28', days: 28 });
  assert.deepEqual(parseMonthlyCloseMonth('2028-02'), { month: '2028-02', from: '2028-02-01', to: '2028-02-29', days: 29 });
  assert.throws(() => parseMonthlyCloseMonth('2026-13'), (error) => error.code === 'INVALID_MONTH');
});

test('a fully closed sales month is ready even while Grab money is pending', () => {
  const result = buildMonthlySalesCloseSnapshot({
    month: '2026-08', branch: { id: 2, code: 'SK', name: 'สาขาสันกำแพง' },
    datasets: closedMonth(), today: '2026-09-10'
  });
  assert.equal(result.ready_to_close, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.summary.recognized_sales, '3100.00');
  assert.equal(result.summary.bill_count, 62);
  assert.equal(result.summary.confirmed_received, '0.00');
  assert.equal(result.summary.pending_receipts, '2480.00');
  assert.equal(result.summary.pending_line_count, 31);
  assert.ok(result.warnings.some((warning) => warning.code === 'RECEIPTS_PENDING'));
});

test('removed fallback payment channel never enters monthly receipt totals', () => {
  const datasets = closedMonth();
  datasets.receipt_expectation.push({
    ...datasets.receipt_expectation[0], source_id: 'fallback-expectation',
    source_receipt_line_id: 'fallback-line', channel_code: 'OTHER_UNKNOWN',
    expected_gross_amount: '44544.70', expected_fee_amount: '0.00', expected_net_amount: '44544.70'
  });
  const result = buildMonthlySalesCloseSnapshot({
    month: '2026-08', branch: { id: 2, code: 'SK', name: 'สาขาสันกำแพง' },
    datasets, today: '2026-09-10'
  });
  assert.equal(result.summary.pending_receipts, '2480.00');
  assert.equal(result.channels.some((row) => row.channel_code === 'OTHER_UNKNOWN'), false);
});

test('missing, open and current-month days block close without inventing money', () => {
  const datasets = closedMonth();
  datasets.receipt_day.pop();
  datasets.pos_daily_sale.pop();
  datasets.receipt_day[0].receipt_status = 'SUBMITTED';
  datasets.receipt_day[0].source_receipt_status = 'SUBMITTED';
  const result = buildMonthlySalesCloseSnapshot({
    month: '2026-08', branch: { id: 2, code: 'SK', name: 'สาขาสันกำแพง' },
    datasets, today: '2026-08-15'
  });
  assert.equal(result.ready_to_close, false);
  assert.ok(result.blockers.some((item) => item.code === 'PERIOD_NOT_ENDED'));
  assert.ok(result.blockers.some((item) => item.code === 'MISSING_DAILY_RECEIPTS'));
  assert.ok(result.blockers.some((item) => item.code === 'MISSING_DAILY_SALES'));
  assert.ok(result.blockers.some((item) => item.code === 'DAILY_RECEIPTS_NOT_CLOSED'));
  assert.equal(result.summary.pending_receipts, '2480.00');
});

test('bank evidence becomes confirmed receipt and post-close correction remains a separate revision fact', () => {
  const datasets = closedMonth();
  datasets.cash_settlement[0] = {
    ...datasets.cash_settlement[0], settlement_date: '2026-08-18', receiving_account_ref: 'gc-account:1',
    actual_money_amount: '80.00', matched_amount: '80.00', source_settlement_status: 'MATCHED_AUTO',
    settlement_status: 'SETTLED', source_settlement_source: 'BANK_STATEMENT', settlement_source: 'BANK_STATEMENT',
    evidence_ref: 'gc-evidence:1'
  };
  datasets.receivable_adjustment.push({
    source_id: 'adjustment-1', adjustment_type: 'POST_CLOSE_CORRECTION', business_date: '2026-08-01',
    settlement_date: null, branch_code: 'SK', channel_code: 'GRAB', amount: '5.00', reason: 'แก้ไขหลังปิด',
    source_external_id: 'adjustment-1', revision: sha('e'), revision_of: null, updated_at: updatedAt, currency: 'THB'
  });
  const result = buildMonthlySalesCloseSnapshot({ month: '2026-08', branch: { id: 2, code: 'SK', name: 'สาขาสันกำแพง' }, datasets, today: '2026-09-10' });
  assert.equal(result.summary.confirmed_received, '80.00');
  assert.equal(result.summary.pending_receipts, '2400.00');
  assert.equal(result.summary.post_close_adjustment_total, '5.00');
  assert.equal(result.summary.acknowledged_daily_variance, '-2475.00');
  assert.ok(result.warnings.some((warning) => warning.code === 'POST_CLOSE_ADJUSTMENTS_INCLUDED'));
});

test('company close is ready only when every operational branch has a close', () => {
  const summary = { recognized_sales: '100.00', expected_fees: '5.00', confirmed_received: '80.00', pending_receipts: '15.00', acknowledged_daily_variance: '0.00' };
  const partial = buildCompanyMonthlySummary({ month: '2026-08', branches: [
    { branch: { code: 'KK' }, latest_close: { summary } }, { branch: { code: 'SK' }, latest_close: null }
  ] });
  assert.equal(partial.status, 'INCOMPLETE');
  assert.deepEqual(partial.missing_branches, ['SK']);
  const complete = buildCompanyMonthlySummary({ month: '2026-08', branches: [
    { branch: { code: 'KK' }, latest_close: { summary } }, { branch: { code: 'SK' }, latest_close: { summary } }
  ] });
  assert.equal(complete.status, 'CLOSED_READY');
  assert.equal(complete.summary.recognized_sales, '200.00');
  assert.equal(complete.summary.pending_receipts, '30.00');
});

const storedClose = (branch, revision = 1) => ({
  id: branch === 'KK' ? 1 : 2,
  close_id: `gc-month-close:${branch}:2026-08:r${revision}`,
  schema_version: '1.0', month_start: '2026-08-01', month_end: '2026-08-31',
  branch_id: branch === 'KK' ? 1 : 2, branch_code: branch,
  branch_name: branch === 'KK' ? 'สาขาคันคลอง' : 'สาขาสันกำแพง', revision_number: revision,
  close_revision: branch === 'KK' ? sha('1') : sha('2'), revision_of: null,
  source_snapshot_sha256: branch === 'KK' ? sha('3') : sha('4'),
  summary_snapshot: JSON.stringify({ recognized_sales: '100.00', expected_fees: '5.00', confirmed_received: '80.00', pending_receipts: '15.00', acknowledged_daily_variance: '0.00' }),
  readiness_snapshot: JSON.stringify({ blockers: [], warnings: [] }),
  section_manifest: JSON.stringify({ pos_daily_sale: { count: 2, sha256: sha('5') } }),
  export_snapshot: JSON.stringify({ pos_daily_sale: [{ source_id: `${branch}-1` }, { source_id: `${branch}-2` }] }),
  note: null, closed_at: '2026-09-01 10:00:00'
});

const readPool = (closeRows) => ({
  getConnection: async () => ({
    query: async (sql) => {
      if (sql.includes('FROM branches') && !sql.includes('monthly_sales_closes')) return [[
        { id: 1, code: 'KK', name: 'สาขาคันคลอง' }, { id: 2, code: 'SK', name: 'สาขาสันกำแพง' }
      ]];
      if (sql.includes('FROM monthly_sales_closes')) return [closeRows];
      throw new Error(`unexpected SQL: ${sql}`);
    },
    release: () => {}
  })
});

test('machine manifest exports the latest immutable close for every operational branch', async () => {
  const result = await exportMonthlySalesCloses(readPool([storedClose('KK'), storedClose('SK')]), { month: '2026-08', branch: 'ALL' });
  assert.equal(result.data.length, 2);
  assert.equal(result.company.status, 'CLOSED_READY');
  assert.equal(result.company.summary.recognized_sales, '200.00');
  assert.equal(result.data[0].revision_number, 1);
  assert.equal(result.data[0].sections.pos_daily_sale.count, 2);
});

test('machine detail export reads only the stored snapshot and paginates it', async () => {
  const result = await exportMonthlySalesCloseData(readPool([storedClose('SK')]), { month: '2026-08', branch: 'SK', revision: '1', section: 'daily_sales', limit: '1', offset: '1' });
  assert.deepEqual(result.data, [{ source_id: 'SK-2' }]);
  assert.deepEqual(result.pagination, { limit: 1, offset: 1, total: 2, next_offset: null });
  assert.equal(result.monthly_close.close_id, 'gc-month-close:SK:2026-08:r1');
});

test('settlement detail marks only receipts already confirmed by the closing engine', async () => {
  const row = storedClose('SK');
  row.export_snapshot = JSON.stringify({ cash_settlement: [
    { settlement_status:'SETTLED', settlement_source:'BANK_STATEMENT', evidence_ref:'proof-1', actual_money_amount:'80.00', source_batch_id:null },
    { settlement_status:'SETTLED', settlement_source:'GRAB_REPORT', evidence_ref:null, actual_money_amount:'80.00', source_batch_id:null }
  ] });
  const result = await exportMonthlySalesCloseData(readPool([row]), { month:'2026-08', branch:'SK', revision:'1', section:'settlements', limit:'10', offset:'0' });
  assert.equal(result.data[0].confirmed_received_amount, '80.00');
  assert.equal(result.data[1].confirmed_received_amount, null);
});

test('monthly close rejects a stale preview before inserting or auditing', async () => {
  const datasets = closedMonth();
  const current = buildMonthlySalesCloseSnapshot({ month: '2026-08', branch: { id: 2, code: 'SK', name: 'สาขาสันกำแพง' }, datasets, today: '2026-09-10' });
  const calls = [];
  const connection = {
    beginTransaction: async () => calls.push('begin'), commit: async () => calls.push('commit'), rollback: async () => calls.push('rollback'), release: () => calls.push('release'),
    query: async (sql) => {
      calls.push(sql);
      if (sql.includes('FROM branches') && sql.includes('clickhouse_branch_id')) return [[{ id: 2, code: 'SK', name: 'สาขาสันกำแพง' }]];
      if (sql.includes('SELECT id FROM branches')) return [[]];
      if (sql.includes('FROM monthly_sales_closes')) return [[]];
      throw new Error(`unexpected SQL: ${sql}`);
    }
  };
  const pool = { getConnection: async () => connection };
  await assert.rejects(() => closeMonthlySales(pool, {
    month: '2026-08', branchCode: 'SK', previewRevision: sha('f'), actor: { id: 1, role: 'recorder' },
    clock: new Date('2026-09-10T00:00:00Z'), loadRows: async ({ sourceType }) => datasets[sourceType]
  }), (error) => error.code === 'STALE_PREVIEW' && error.details.current_revision === current.source_snapshot_sha256);
  assert.ok(calls.includes('rollback'));
  assert.equal(calls.some((sql) => String(sql).includes('INSERT INTO monthly_sales_closes')), false);
});

test('monthly close persists one immutable revision and one audit record', async () => {
  const datasets = closedMonth();
  const current = buildMonthlySalesCloseSnapshot({ month: '2026-08', branch: { id: 2, code: 'SK', name: 'สาขาสันกำแพง' }, datasets, today: '2026-09-10' });
  const calls = [];
  let inserted;
  const connection = {
    beginTransaction: async () => calls.push('begin'), commit: async () => calls.push('commit'), rollback: async () => calls.push('rollback'), release: () => calls.push('release'),
    query: async (sql, params = []) => {
      calls.push(sql);
      if (sql.includes('FROM branches') && sql.includes('clickhouse_branch_id')) return [[{ id: 2, code: 'SK', name: 'สาขาสันกำแพง' }]];
      if (sql.includes('SELECT id FROM branches')) return [[]];
      if (sql.includes('ORDER BY revision_number DESC LIMIT 1 FOR UPDATE')) return [[]];
      if (sql.includes('INSERT INTO monthly_sales_closes')) {
        inserted = {
          id: 9, close_id: params[0], schema_version: params[1], month_start: params[2], month_end: params[3],
          branch_id: params[4], branch_code: 'SK', branch_name: 'สาขาสันกำแพง', revision_number: params[5],
          close_revision: params[6], revision_of: params[7], source_snapshot_sha256: params[8],
          summary_snapshot: params[9], readiness_snapshot: params[10], section_manifest: params[11],
          export_snapshot: params[12], note: params[13], closed_at: '2026-09-10 12:00:00'
        };
        return [{ insertId: 9 }];
      }
      if (sql.includes('INSERT INTO audit_logs')) return [{ insertId: 22 }];
      if (sql.includes('WHERE msc.id = ?')) return [[inserted]];
      throw new Error(`unexpected SQL: ${sql}`);
    }
  };
  const result = await closeMonthlySales({ getConnection: async () => connection }, {
    month: '2026-08', branchCode: 'SK', previewRevision: current.source_snapshot_sha256,
    note: 'ตรวจยอดขายครบแล้ว', actor: { id: 7, role: 'recorder' },
    clock: new Date('2026-09-10T00:00:00Z'), loadRows: async ({ sourceType }) => datasets[sourceType]
  });
  assert.equal(result.duplicate, false);
  assert.equal(result.close.revision_number, 1);
  assert.equal(result.close.source_snapshot_sha256, current.source_snapshot_sha256);
  assert.equal(calls.filter((sql) => String(sql).includes('INSERT INTO monthly_sales_closes')).length, 1);
  assert.equal(calls.filter((sql) => String(sql).includes('INSERT INTO audit_logs')).length, 1);
  assert.ok(calls.includes('commit'));
  assert.equal(calls.includes('rollback'), false);
});
