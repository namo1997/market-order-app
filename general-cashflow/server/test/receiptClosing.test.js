import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReceiptClosingSummary, receiptConfirmationFields } from '../src/domain/receiptClosing.js';
import { buildLineEvidenceReconciliation, buildReconciliationSummary } from '../../client/src/reconciliationSummary.js';

const receipt = () => ({
  status: 'CLOSED', branch_code: 'KK', gross_sales_expected: '10000.00', morning_change_amount: '1000.00',
  misc_items: [{ amount: '5.00' }],
  lines: [
    { channel_code: 'CASH', cashier_amount: '5000.00', statement_amount: '5000.00', fee_amount: 99 },
    { channel_code: 'QR_KPLUS', cashier_amount: '6000.00', statement_amount: '5900.00', fee_amount: '20.00', reconciliation_adjustment_amount: '75.00' }
  ]
});

test('closing summary includes saved money, fees, signed adjustments and misc against POS plus change', () => {
  assert.deepEqual(buildReceiptClosingSummary(receipt()), {
    version: 1, actual_money_total: 10900, deduction_total: 20, line_adjustment_total: 75,
    misc_adjustment_total: 5, pos_with_change_total: 11000, reconciled_total: 11000, variance_total: 0
  });
  const adjusted = receipt();
  adjusted.lines[1].reconciliation_adjustment_amount = '-25.00';
  assert.equal(buildReceiptClosingSummary(adjusted).variance_total, -100);
});

test('closing summary matches the displayed net and fees, including Grab and a multi-day KTC allocation', () => {
  const value = receipt();
  value.lines.push(
    { channel_code: 'GRAB', cashier_amount: 10503, expected_gross_amount: 10503, statement_amount: '8163.16', fee_amount: '2339.84', settlement_source: 'GRAB_REPORT' },
    { channel_code: 'CREDIT_CARD_KTC', cashier_amount: 1841, statement_amount: 8000, fee_amount: 200, settlement_batch_key: 'multi-day-deposit', settlement_batch_allocated_net_amount: '1795.64', settlement_batch_allocated_fee_amount: '45.36' }
  );
  const displayed = value.lines.map(buildLineEvidenceReconciliation);
  const ui = buildReconciliationSummary({
    grossSalesExpected: Number(value.gross_sales_expected), morningChange: Number(value.morning_change_amount),
    cashierLineTotal: value.lines.reduce((sum, line) => sum + Number(line.cashier_amount), 0),
    miscAdjustmentTotal: 5, lineAdjustmentTotal: 75,
    actualMoneyTotal: displayed.reduce((sum, line) => sum + line.actual, 0),
    deductionTotal: displayed.reduce((sum, line) => sum + line.fee, 0)
  });
  const closing = buildReceiptClosingSummary(value);
  assert.equal(closing.actual_money_total, 20858.8);
  assert.equal(closing.deduction_total, 2405.2);
  assert.equal(closing.reconciled_total, ui.recoveredTotal);
  assert.equal(closing.variance_total, ui.endToEndVariance);
});

test('closing summary excludes unsupported branch channels and accepts aggregate misc amounts', () => {
  const value = { ...receipt(), branch_code: 'SK', misc_items: undefined, misc_total: '5.00' };
  value.lines.push({ channel_code: 'CREDIT_CARD_KTC', statement_amount: 9999, fee_amount: 50, reconciliation_adjustment_amount: 100 });
  assert.equal(buildReceiptClosingSummary(value).reconciled_total, 11000);
});

test('closed snapshots remain unchanged when source data changes later', () => {
  const value = receipt();
  const snapshot = buildReceiptClosingSummary(value);
  value.lines[1].statement_amount = 9000;
  value.gross_sales_expected = 1;
  for (const stored of [snapshot, JSON.stringify(snapshot)]) {
    assert.deepEqual(receiptConfirmationFields({ ...value, closed_reconciliation_snapshot: stored }), {
      confirmed_variance_total: 0, confirmed_reconciled_total: 11000, confirmed_variance_source: 'CLOSING_SNAPSHOT'
    });
  }
});

test('legacy closed receipts derive confirmation from saved reconciliation without changing history', () => {
  const value = receipt();
  const original = structuredClone(value);
  for (const snapshot of [undefined, null, 'invalid json', { version: 99 }]) {
    assert.deepEqual(receiptConfirmationFields({ ...value, closed_reconciliation_snapshot: snapshot }), {
      confirmed_variance_total: 0, confirmed_reconciled_total: 11000, confirmed_variance_source: 'SAVED_RECONCILIATION'
    });
  }
  assert.deepEqual(value, original);
});

test('open receipts do not report closing confirmation even with a stale snapshot', () => {
  const value = receipt();
  assert.deepEqual(receiptConfirmationFields({ ...value, status: 'CHECKED_OK', closed_reconciliation_snapshot: buildReceiptClosingSummary(value) }), {
    confirmed_variance_total: null, confirmed_reconciled_total: null, confirmed_variance_source: null
  });
});
