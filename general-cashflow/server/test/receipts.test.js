import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildCashierVarianceCheck,
  calculateEvidenceVariances,
  calculateCreditCardGroupVarianceByLine,
  calculateLineVariance,
  canTransitionReceipt,
  computeExpectedTotals,
  hasDeclaredMoneyWithoutPos,
  resolveManualCheckAmounts,
  resolveCheckedStatus,
  statementAmountForManualCheck,
  thailandBusinessDate,
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

test('Thailand business date follows UTC+7 at the day boundary', () => {
  assert.equal(thailandBusinessDate(new Date('2026-08-28T16:59:59.000Z')), '2026-08-28');
  assert.equal(thailandBusinessDate(new Date('2026-08-28T17:00:00.000Z')), '2026-08-29');
});

test('submission detects a warning when money is declared but refreshed POS is still empty', () => {
  assert.equal(hasDeclaredMoneyWithoutPos({
    billCount: 0,
    grossSalesExpected: 0,
    declaredAmounts: [0, '42287.00']
  }), true);
  assert.equal(hasDeclaredMoneyWithoutPos({
    billCount: 105,
    grossSalesExpected: 77688.40,
    declaredAmounts: ['75273.00']
  }), false);
  assert.equal(hasDeclaredMoneyWithoutPos({
    billCount: 0,
    grossSalesExpected: 0,
    declaredAmounts: [0, '0.00']
  }), false);
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

test('cashier variance confirmation triggers only above 100 baht absolute variance', () => {
  const baseLines = [
    { id: 1, payment_channel_id: 10, expected_amount: 1000, cashier_amount: 1000 },
    { id: 2, payment_channel_id: 20, expected_amount: 500, cashier_amount: 500 }
  ];

  assert.equal(
    buildCashierVarianceCheck({
      lines: baseLines,
      inputLines: [{ payment_channel_id: 10, cashier_amount: 920 }, { payment_channel_id: 20, cashier_amount: 500 }],
      morningChangeAmount: 0
    }).requires_confirmation,
    false
  );

  const short = buildCashierVarianceCheck({
    lines: baseLines,
    inputLines: [{ payment_channel_id: 10, cashier_amount: 899 }, { payment_channel_id: 20, cashier_amount: 500 }],
    morningChangeAmount: 0
  });
  assert.equal(short.variance_amount, -101);
  assert.equal(short.direction, 'short');
  assert.equal(short.requires_confirmation, true);

  const over = buildCashierVarianceCheck({
    lines: baseLines,
    inputLines: [{ payment_channel_id: 10, cashier_amount: 1000 }, { payment_channel_id: 20, cashier_amount: 602 }],
    miscItems: [{ amount: 0 }],
    morningChangeAmount: 0
  });
  assert.equal(over.variance_amount, 102);
  assert.equal(over.direction, 'over');
  assert.equal(over.requires_confirmation, true);
});

test('cashier variance uses POS gross instead of ClickHouse payment splits', () => {
  const result = buildCashierVarianceCheck({
    lines: [
      { id: 1, payment_channel_id: 10, expected_amount: 850, cashier_amount: 600 },
      { id: 2, payment_channel_id: 20, expected_amount: 50, cashier_amount: 400 }
    ],
    grossSalesExpected: 1000,
    morningChangeAmount: 100
  });

  assert.equal(result.entered_total, 1000);
  assert.equal(result.expected_total, 1100);
  assert.equal(result.variance_amount, -100);
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

test('manual cash check stores only counted cash and does not duplicate change or misc amounts', () => {
  assert.equal(statementAmountForManualCheck({
    channelCode: 'CASH',
    cashierAmount: 44333,
    verificationAmount: 51339
  }), 44333);
  assert.equal(statementAmountForManualCheck({
    channelCode: 'QR_KPLUS',
    cashierAmount: 10000,
    verificationAmount: 9950
  }), 9950);
});

test('manual cash check preserves cashier and counted amounts entered on the current screen', () => {
  assert.deepEqual(resolveManualCheckAmounts({
    channelCode: 'CASH',
    currentCashierAmount: 44333,
    requestedCashierAmount: 44400,
    requestedStatementAmount: 44390,
    verificationAmount: 51400
  }), {
    cashierAmount: 44400,
    statementAmount: 44390,
    varianceAmount: -10
  });
});

test('manual cash check keeps the legacy cashier amount when the row has no pending edits', () => {
  assert.deepEqual(resolveManualCheckAmounts({
    channelCode: 'CASH',
    currentCashierAmount: 44333,
    verificationAmount: 51339
  }), {
    cashierAmount: 44333,
    statementAmount: 44333,
    varianceAmount: 0
  });
});

test('credit card variance is calculated as one SCB and KTC group', () => {
  const varianceByLineId = calculateCreditCardGroupVarianceByLine([
    {
      id: 1,
      channel_kind: 'credit_card',
      expectedAmount: 1000,
      statementAmount: 600
    },
    {
      id: 2,
      channel_kind: 'credit_card',
      expectedAmount: 0,
      statementAmount: 400
    }
  ]);

  assert.equal(varianceByLineId.get(1), 0);
  assert.equal(varianceByLineId.get(2), 0);
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
  assert.equal(resolveCheckedStatus([{ variance_amount: 0, cashier_reference_variance_amount: -5 }]), 'CHECKED_VARIANCE');
  assert.equal(resolveCheckedStatus([{ variance_amount: 0, settlement_variance_amount: 5 }]), 'CHECKED_VARIANCE');
  assert.equal(resolveCheckedStatus([{ variance_amount: 0, reconciliation_adjustment_amount: -25 }]), 'CHECKED_VARIANCE');
});

test('bank evidence variances are independent and cannot cancel each other', () => {
  const result = calculateEvidenceVariances({
    channelCode: 'QR_KPLUS',
    cashierAmount: 29221.90,
    statementAmount: 29221.90,
    expectedGrossAmount: 44751.90,
    expectedNetAmount: 44751.90,
    settlementSource: 'BANK_SETTLEMENT'
  });
  assert.equal(result.cashierReferenceVariance, -15530);
  assert.equal(result.settlementVariance, -15530);
  assert.equal(result.hasEvidenceVariance, true);
});

test('variance reasons are required for every non-zero variance line', () => {
  assert.doesNotThrow(() => validateVarianceReasons([{ variance_amount: 2, variance_reason: 'รอธนาคารเคลียร์' }]));
  assert.throws(
    () => validateVarianceReasons([{ id: 10, channel_label: 'QR กสิกร', variance_amount: -5, variance_reason: '' }]),
    (error) => {
      assert.match(error.message, /กรุณาระบุเหตุผลส่วนต่าง/);
      assert.equal(error.statusCode, 400);
      assert.equal(error.details[0].channel_label, 'QR กสิกร');
      return true;
    }
  );
  assert.throws(
    () => validateVarianceReasons([{ id: 11, cashier_reference_variance_amount: 5, settlement_variance_amount: -5, variance_reason: '' }]),
    /กรุณาระบุเหตุผลส่วนต่าง/
  );
  assert.throws(
    () => validateVarianceReasons([{ id: 11, channel_label: 'เงินสด', reconciliation_adjustment_amount: 20, variance_reason: '' }]),
    (error) => {
      assert.equal(error.details[0].reconciliation_adjustment_amount, 20);
      return true;
    }
  );
});

test('role permissions keep cashier, auditor, and recorder duties separate', () => {
  assert.equal(hasPermission('cashier', 'receipt:submit'), true);
  assert.equal(hasPermission('cashier', 'receipt:check'), false);
  assert.equal(hasPermission('auditor', 'statement:import'), true);
  assert.equal(hasPermission('auditor', 'receipt:note'), true);
  assert.equal(hasPermission('auditor', 'receipt:close'), false);
  assert.equal(hasPermission('recorder', 'receipt:note'), true);
  assert.equal(hasPermission('recorder', 'receipt:close'), true);
  assert.equal(hasPermission('cashier', 'receipt:note'), false);
  assert.equal(hasPermission('admin', 'settings:manage'), true);
});
