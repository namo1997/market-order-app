import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculateLineVariance,
  canTransitionReceipt,
  computeExpectedTotals,
  resolveCheckedStatus,
  validateVarianceReasons
} from '../src/domain/receipts.js';
import { hasPermission } from '../src/domain/permissions.js';

test('computeExpectedTotals rounds gross, cash, and non-cash totals', () => {
  const totals = computeExpectedTotals({
    grossSales: 1000.129,
    cashSales: 250.125,
    nonCashLines: [{ expectedAmount: 500.111 }, { expectedAmount: 249.894 }]
  });
  assert.deepEqual(totals, {
    grossSalesExpected: 1000.13,
    cashExpected: 250.13,
    nonCashExpected: 750.01
  });
});

test('calculateLineVariance compares verified amount against expected amount', () => {
  const line = calculateLineVariance({
    channelCode: 'QR_KPLUS',
    expectedAmount: 1000,
    cashierAmount: 990,
    verifiedAmount: 980.456
  });
  assert.equal(line.expectedAmount, 1000);
  assert.equal(line.cashierAmount, 990);
  assert.equal(line.verifiedAmount, 980.46);
  assert.equal(line.varianceAmount, -19.54);
});

test('cash line uses cashier amount as verified amount when no verified amount is supplied', () => {
  const line = calculateLineVariance({
    channelCode: 'CASH',
    expectedAmount: 500,
    cashierAmount: 510
  });
  assert.equal(line.verifiedAmount, 510);
  assert.equal(line.varianceAmount, 10);
});

test('receipt workflow transitions are constrained', () => {
  assert.equal(canTransitionReceipt('DRAFT', 'SUBMITTED'), true);
  assert.equal(canTransitionReceipt('SUBMITTED', 'CHECKED_OK'), true);
  assert.equal(canTransitionReceipt('CHECKED_VARIANCE', 'CLOSED'), true);
  assert.equal(canTransitionReceipt('CLOSED', 'SUBMITTED'), false);
  assert.equal(canTransitionReceipt('DRAFT', 'CLOSED'), false);
});

test('checked status reflects any non-zero variance', () => {
  assert.equal(resolveCheckedStatus([{ variance_amount: 0 }, { variance_amount: 0 }]), 'CHECKED_OK');
  assert.equal(resolveCheckedStatus([{ variance_amount: 0 }, { variance_amount: 0.01 }]), 'CHECKED_VARIANCE');
});

test('variance reasons are required for every non-zero variance line', () => {
  assert.doesNotThrow(() => validateVarianceReasons([{ variance_amount: 2, variance_reason: 'รอธนาคารเคลียร์' }]));
  assert.throws(
    () => validateVarianceReasons([{ id: 10, variance_amount: -5, variance_reason: '' }]),
    /Variance reason is required/
  );
});

test('role permissions keep cashier, auditor, and recorder duties separate', () => {
  assert.equal(hasPermission('cashier', 'receipt:submit'), true);
  assert.equal(hasPermission('cashier', 'receipt:check'), false);
  assert.equal(hasPermission('auditor', 'statement:import'), true);
  assert.equal(hasPermission('auditor', 'receipt:close'), false);
  assert.equal(hasPermission('recorder', 'receipt:close'), true);
  assert.equal(hasPermission('admin', 'settings:manage'), true);
});
