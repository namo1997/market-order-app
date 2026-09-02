import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveLineAdjustment, postCloseAdjustmentPreview } from '../src/postCloseAdjustmentAmounts.js';
import { buildReconciliationSummary } from '../src/reconciliationSummary.js';

test('post-close amounts add once to the existing adjustment, not to bank or cashier inputs', () => {
  const line = { cashier_amount: 1000, statement_amount: 940, reconciliation_adjustment_amount: '10.00', post_close_adjustment_amount: '24.50' };
  const before = structuredClone(line);
  const adjustment = effectiveLineAdjustment(line);
  assert.equal(adjustment, 34.5);
  const summary = buildReconciliationSummary({ grossSalesExpected: 1000, morningChange: 0, cashierLineTotal: line.cashier_amount,
    miscAdjustmentTotal: 0, lineAdjustmentTotal: adjustment, actualMoneyTotal: line.statement_amount, deductionTotal: 0 });
  assert.equal(summary.recoveredTotal, 974.5);
  assert.equal(summary.endToEndVariance, -25.5);
  assert.deepEqual(line, before);
  assert.equal(effectiveLineAdjustment({ reconciliation_adjustment_amount: 0.1, post_close_adjustment_amount: 0.2 }), 0.3);
});

test('inline preview separates the channel adjustment from the whole-day variance', () => {
  const receipt = { confirmed_variance_total: -50, confirmed_reconciled_total: 950 };
  const line = { reconciliation_adjustment_amount: 10, post_close_adjustment_amount: 20 };
  assert.deepEqual(postCloseAdjustmentPreview({ receipt, line, amount: '50.00', direction: 1 }), {
    valid: true, delta: 50, currentAdjustment: 30, nextAdjustment: 80, currentVariance: -50, nextVariance: 0
  });
  assert.deepEqual(postCloseAdjustmentPreview({ receipt, line, amount: '1,000.25', direction: -1 }), {
    valid: true, delta: -1000.25, currentAdjustment: 30, nextAdjustment: -970.25, currentVariance: -50, nextVariance: -1050.25
  });
  for (const amount of ['', '.', '0', 'hello', 'NaN', '0.001', '-50', '1e3']) {
    const result = postCloseAdjustmentPreview({ receipt, line, amount, direction: 1 });
    assert.equal(result.valid, false);
    assert.equal(result.delta, 0);
    assert.equal(result.nextVariance, -50);
  }
  assert.equal(postCloseAdjustmentPreview({ receipt, line, amount: '100', direction: 0 }).valid, false);
});
