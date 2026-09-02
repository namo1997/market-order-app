import test from 'node:test';
import assert from 'node:assert/strict';
import { planReceiptRecalculation } from '../src/recalculateReceipts.js';

const line = (id, code, cashier, actual, gross = cashier, fee = 0, source = 'BANK_SETTLEMENT') => ({
  id, reconciliation_id: id, channel_code: code, cashier_amount: cashier, statement_amount: actual,
  expected_gross_amount: gross, fee_amount: fee, expected_net_amount: gross - fee,
  settlement_source: source, settlement_status: 'MATCHED_AUTO', variance_amount: 0,
  cashier_reference_variance_amount: 0, settlement_variance_amount: 0
});
const receipt = () => ({
  id: 66, branch_code: 'KK', receipt_date: '2026-08-04', status: 'SUBMITTED',
  gross_sales_expected: 74768.50, morning_change_amount: 7000,
  misc_items: [{ amount: 9 }, { amount: 109 }],
  lines: [
    { ...line(1, 'CASH', 21686, 0, 17427.50, 0, 'NONE'), settlement_status: 'READY_FOR_STATEMENT' },
    line(2, 'CREDIT_CARD_SCB', 0, 0, 5533, 0, 'NONE'),
    line(3, 'CREDIT_CARD_KTC', 5533, 5384.92, 5533, 148.08),
    { ...line(4, 'QR_KPLUS', 29221.90, 29221.90), expected_amount: 44751.90 },
    line(5, 'GRAB', 7518, 6570.66, 7518, 947.34, 'GRAB_REPORT'),
    line(6, 'QR_KRUNGSRI', 16714, 16714, 0, 0, 'BANK_STATEMENT'),
    line(7, 'OTHER_UNKNOWN', 1000, 1000, 14067.20, 0, 'NONE')
  ]
});

test('recalculation uses corrected K SHOP reference in totals without importing a POS split', () => {
  const data = receipt();
  const before = structuredClone(data);
  const result = planReceiptRecalculation(data);
  assert.equal(result.summary.before_deductions_total, 81672.90);
  assert.equal(result.summary.cashier_total, 81790.90);
  assert.equal(result.summary.pos_with_change_total, 81768.50);
  assert.equal(result.summary.cashier_vs_pos_variance, 22.40);
  assert.equal(result.summary.actual_money_total, 58891.48);
  assert.equal(result.summary.deduction_total, 1095.42);
  assert.equal(result.summary.reconciled_total, 60104.90);
  assert.equal(result.summary.variance_total, -21663.60);
  assert.equal(result.summary.settlement_vs_cashier_variance, -21686);
  assert.deepEqual(result.pending_channels, [{ line_id: 1, channel_code: 'CASH', cashier_amount: 21686, actual_amount: 0 }]);
  assert.deepEqual(result.changes.map((change) => change.line_id), [1]);
  assert.equal(result.status_after, 'SUBMITTED');
  assert.deepEqual(data, before);
});

test('recalculation preserves both evidence variances instead of netting them together', () => {
  const result = planReceiptRecalculation({ ...receipt(), lines: [line(1, 'QR_KPLUS', 100, 120, 110)] });
  assert.equal(result.changes[0].after.cashier_reference_variance_amount, -10);
  assert.equal(result.changes[0].after.settlement_variance_amount, 10);
  assert.equal(result.changes[0].after.variance_amount, 10);
});

test('KTC batch allocation is not recalculated against the deposit of just one day', () => {
  const result = planReceiptRecalculation({ ...receipt(), lines: [{
    ...line(1, 'CREDIT_CARD_KTC', 23617, 14275.09), settlement_batch_key: 'KTC-combined',
    settlement_batch_allocated_net_amount: 23022.23, settlement_batch_allocated_fee_amount: 594.77,
    settlement_batch_variance_amount: 0
  }] });
  assert.equal(result.changes.length, 0);
  assert.equal(result.summary.actual_money_total, 23022.23);
  assert.equal(result.summary.deduction_total, 594.77);
});

test('closed receipt confirmation is immutable while retrospective evidence differences remain visible', () => {
  const data = { ...receipt(), status: 'CLOSED',
    closed_reconciliation_snapshot: { version: 1, variance_total: 2, reconciled_total: 81770.50 },
    lines: [line(1, 'QR_KPLUS', 100, 80, 100)] };
  const before = structuredClone(data);
  const result = planReceiptRecalculation(data);
  assert.equal(result.closed_read_only, true);
  assert.deepEqual(result.changes, []);
  assert.equal(result.status_after, 'CLOSED');
  assert.equal(result.summary.confirmed_variance_total, 2);
  assert.equal(result.summary.confirmed_reconciled_total, 81770.50);
  assert.equal(result.historical_evidence_warning, true);
  assert.deepEqual(data, before);
});

test('only previously checked receipts can change checked variance status', () => {
  for (const status of ['DRAFT', 'SUBMITTED', 'NEEDS_CORRECTION']) {
    assert.equal(planReceiptRecalculation({ ...receipt(), status }).status_after, status);
  }
  assert.equal(planReceiptRecalculation({ ...receipt(), status: 'CHECKED_OK' }).status_after, 'CHECKED_VARIANCE');
  assert.equal(planReceiptRecalculation({ ...receipt(), status: 'CHECKED_VARIANCE', lines: [line(1, 'QR_KPLUS', 100, 100)] }).status_after, 'CHECKED_OK');
});

test('recalculation excludes unsupported branch channels and retains signed adjustments', () => {
  const result = planReceiptRecalculation({ ...receipt(), branch_code: 'SK',
    lines: [line(1, 'CREDIT_CARD_KTC', 9000, 0), {
      ...line(2, 'QR_KPLUS', 100, 90), reconciliation_adjustment_amount: 10
    }] });
  assert.deepEqual(result.changes.map((change) => change.line_id), [2]);
  assert.equal(result.summary.actual_money_total, 90);
  assert.equal(result.summary.line_adjustment_total, 10);
  assert.equal(result.summary.cashier_total, 218);
  assert.equal(result.summary.reconciled_total, 218);
});
