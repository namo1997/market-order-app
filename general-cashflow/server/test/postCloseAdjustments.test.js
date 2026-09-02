import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePostCloseAdjustment } from '../src/postCloseAdjustments.js';
import { hasPermission } from '../src/domain/permissions.js';
import { receiptConfirmationFields } from '../src/domain/receiptClosing.js';

const input = () => ({ receipt_line_id: 1, amount: '-50.25', reason: 'คืนเงินตามหลักฐาน', expected_revision: 0, request_id: 'a1234567-1234-1234-1234-123456789abc' });
test('post-close adjustments require signed nonzero cents, a reason, a line and retry/revision keys', () => {
  assert.equal(validatePostCloseAdjustment(input()).amount, -50.25);
  for (const amount of ['', 0, 'NaN', 'Infinity', '1e3', '1.001', '1,000', '1000000000000', true]) {
    assert.throws(() => validatePostCloseAdjustment({ ...input(), amount }));
  }
  for (const patch of [{ reason: '' }, { reason: 'x'.repeat(1001) }, { receipt_line_id: 0 }, { expected_revision: -1 }, { expected_revision: undefined }, { request_id: 'bad' }]) {
    assert.throws(() => validatePostCloseAdjustment({ ...input(), ...patch }));
  }
});
test('cashiers cannot adjust closed documents; auditor recorder and admin can', () => {
  assert.equal(hasPermission('cashier', 'receipt:adjust-closed'), false);
  for (const role of ['auditor', 'recorder', 'admin']) assert.equal(hasPermission(role, 'receipt:adjust-closed'), true);
});
test('adjusted confirmation uses the immutable note chain, retains original confirmation, and permits reversals', () => {
  const receipt = { status: 'CLOSED', closed_reconciliation_snapshot: { version: 1, reconciled_total: 950, variance_total: -50 },
    post_close_adjustments: [
      { amount: '50.00', reconciled_total_before: '950.00', reconciled_total_after: '1000.00', variance_total_before: '-50.00', variance_total_after: '0.00' },
      { amount: '-20.00', reconciled_total_before: '1000.00', reconciled_total_after: '980.00', variance_total_before: '0.00', variance_total_after: '-20.00' }
    ] };
  const before = structuredClone(receipt);
  assert.deepEqual(receiptConfirmationFields(receipt), {
    confirmed_reconciled_total: 980, confirmed_variance_total: -20, confirmed_variance_source: 'POST_CLOSE_ADJUSTMENT',
    original_confirmed_reconciled_total: 950, original_confirmed_variance_total: -50,
    post_close_adjustment_total: 30, post_close_adjustment_count: 2
  });
  assert.deepEqual(receipt, before);
  assert.equal(receiptConfirmationFields({ ...receipt, closed_reconciliation_snapshot: null }).confirmed_reconciled_total, 980);
});
