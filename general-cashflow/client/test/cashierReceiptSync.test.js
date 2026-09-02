import test from 'node:test';
import assert from 'node:assert/strict';
import { cashierPosWarningRequired, shouldAutoSyncCashierReceipt, thailandBusinessDate } from '../src/cashierReceiptSync.js';

test('Thailand business date does not roll over at UTC midnight incorrectly', () => {
  assert.equal(thailandBusinessDate(new Date('2026-08-28T17:30:00.000Z')), '2026-08-29');
});

test('cashier automatically syncs current and past drafts but never future dates', () => {
  const currentDate = '2026-08-29';
  assert.equal(shouldAutoSyncCashierReceipt({ date: '2026-08-29', receipt: null, currentDate }), true);
  assert.equal(shouldAutoSyncCashierReceipt({ date: '2026-08-28', receipt: { status: 'DRAFT' }, currentDate }), true);
  assert.equal(shouldAutoSyncCashierReceipt({ date: '2026-08-30', receipt: null, currentDate }), false);
});

test('opening a submitted or closed receipt never refreshes it implicitly', () => {
  for (const status of ['SUBMITTED', 'CHECKED_OK', 'CHECKED_VARIANCE', 'NEEDS_CORRECTION', 'CLOSED']) {
    assert.equal(shouldAutoSyncCashierReceipt({
      date: '2026-08-28', receipt: { status }, currentDate: '2026-08-29'
    }), false);
  }
});

test('cashier gets a warning when declared money exists while POS is still empty', () => {
  assert.equal(cashierPosWarningRequired({
    billCount: 0, grossSalesExpected: 0, declaredAmounts: [0, '100.00']
  }), true);
  assert.equal(cashierPosWarningRequired({
    billCount: 1, grossSalesExpected: 100, declaredAmounts: ['100.00']
  }), false);
  assert.equal(cashierPosWarningRequired({
    billCount: 0, grossSalesExpected: 0, declaredAmounts: ['0.00']
  }), false);
});
