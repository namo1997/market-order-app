import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLineEvidenceReconciliation, buildLineSettlementAmounts, buildReconciliationSummary } from '../src/reconciliationSummary.js';

test('three-way reconciliation counts morning change only on the POS benchmark', () => {
  const result = buildReconciliationSummary({
    grossSalesExpected: 150468,
    morningChange: 7000,
    cashierLineTotal: 157469.10,
    miscAdjustmentTotal: 6,
    actualMoneyTotal: 154765.29,
    deductionTotal: 2703.81
  });

  assert.deepEqual(result, {
    cashierTotal: 157475.10,
    posWithChangeTotal: 157468,
    recoveredTotal: 157475.10,
    cashierVsPosVariance: 7.10,
    settlementVsCashierVariance: 0,
    endToEndVariance: 7.10
  });
});

test('settlement variance identifies money missing after cashier submission', () => {
  const result = buildReconciliationSummary({
    grossSalesExpected: 100,
    morningChange: 20,
    cashierLineTotal: 120,
    miscAdjustmentTotal: 0,
    actualMoneyTotal: 105,
    deductionTotal: 5
  });

  assert.equal(result.cashierVsPosVariance, 0);
  assert.equal(result.settlementVsCashierVariance, -10);
  assert.equal(result.endToEndVariance, -10);
});

test('misc adjustments reconcile value without being counted as actual money', () => {
  const result = buildReconciliationSummary({
    grossSalesExpected: 100,
    morningChange: 0,
    cashierLineTotal: 90,
    miscAdjustmentTotal: 10,
    actualMoneyTotal: 90,
    deductionTotal: 0
  });

  assert.equal(result.cashierTotal, 100);
  assert.equal(result.recoveredTotal, 100);
  assert.equal(result.endToEndVariance, 0);
});

test('signed line adjustments change only the recoverable money total', () => {
  const incomingAdjustment = buildReconciliationSummary({
    grossSalesExpected: 100,
    morningChange: 0,
    cashierLineTotal: 100,
    miscAdjustmentTotal: 0,
    lineAdjustmentTotal: 10,
    actualMoneyTotal: 90,
    deductionTotal: 0
  });
  assert.equal(incomingAdjustment.cashierTotal, 100);
  assert.equal(incomingAdjustment.recoveredTotal, 100);
  assert.equal(incomingAdjustment.endToEndVariance, 0);

  const outgoingAdjustment = buildReconciliationSummary({
    grossSalesExpected: 100,
    morningChange: 0,
    cashierLineTotal: 100,
    miscAdjustmentTotal: 0,
    lineAdjustmentTotal: -10,
    actualMoneyTotal: 110,
    deductionTotal: 0
  });
  assert.equal(outgoingAdjustment.recoveredTotal, 100);
  assert.equal(outgoingAdjustment.endToEndVariance, 0);
});

test('generic POS credit total is not duplicated into SCB when cashier classified it elsewhere', () => {
  assert.deepEqual(buildLineSettlementAmounts({
    channelCode: 'CREDIT_CARD_SCB',
    cashierAmount: 0,
    expectedGrossAmount: 5533,
    feeAmount: 0,
    expectedNetAmount: 5533
  }), {
    gross: 0,
    fee: 0,
    net: 0
  });
});

test('bank evidence does not restore a ClickHouse-only channel amount', () => {
  assert.deepEqual(buildLineSettlementAmounts({
    channelCode: 'QR_KPLUS',
    cashierAmount: 0,
    expectedGrossAmount: 5533,
    feeAmount: 0,
    expectedNetAmount: 5533,
    statementAmount: 5000,
    matchedAmount: 5000,
    evidenceAttachmentId: 20
  }), {
    gross: 0,
    fee: 0,
    net: 0
  });
});

test('line comparison uses the net amount after credit-card fees', () => {
  assert.deepEqual(buildLineSettlementAmounts({
    channelCode: 'CREDIT_CARD_KTC',
    cashierAmount: 5533,
    expectedGrossAmount: 5533,
    feeAmount: 148.08,
    expectedNetAmount: 5384.92,
    statementAmount: 5384.92,
    matchedAmount: 5384.92,
    evidenceAttachmentId: 12
  }), {
    gross: 5533,
    fee: 148.08,
    net: 5384.92
  });
});

test('bank settlement keeps cashier-reference and incoming-money variances separate', () => {
  assert.deepEqual(buildLineEvidenceReconciliation({
    channel_code: 'QR_KPLUS',
    cashier_amount: 29221.90,
    expected_gross_amount: 44751.90,
    expected_net_amount: 44751.90,
    statement_amount: 29221.90,
    settlement_source: 'BANK_SETTLEMENT'
  }), {
    gross: 44751.90,
    fee: 0,
    net: 44751.90,
    actual: 29221.90,
    bankActual: 29221.90,
    cashierVariance: -15530,
    settlementVariance: -15530,
    hasVariance: true
  });
});

test('corrected K SHOP proof uses the bank amount in the before-deductions column', () => {
  const line = {
    channel_code: 'QR_KPLUS', expected_amount: 44751.90, cashier_amount: 29221.90,
    expected_gross_amount: 29221.90, expected_net_amount: 29221.90, fee_amount: 0,
    statement_amount: 29221.90, settlement_source: 'BANK_SETTLEMENT'
  };
  const result = buildLineEvidenceReconciliation(line);
  assert.equal(result.gross, 29221.90);
  assert.equal(result.net, 29221.90);
  assert.equal(result.actual, 29221.90);
  assert.equal(result.hasVariance, false);
  assert.deepEqual(buildLineEvidenceReconciliation({ ...line, expected_amount: 99999 }), result);
});

test('KTC batch settlement keeps daily bank money visible but reconciles with its allocated share', () => {
  assert.deepEqual(buildLineEvidenceReconciliation({
    channel_code: 'CREDIT_CARD_KTC',
    cashier_amount: 23617,
    statement_amount: 14275.09,
    settlement_source: 'BANK_SETTLEMENT',
    settlement_batch_key: 'KTC-KK-2026-07-25-2026-07-26',
    settlement_batch_allocated_fee_amount: 594.77,
    settlement_batch_allocated_net_amount: 23022.23
  }), {
    gross: 23617,
    fee: 594.77,
    net: 23022.23,
    actual: 23022.23,
    bankActual: 14275.09,
    cashierVariance: 0,
    settlementVariance: 0,
    hasVariance: false
  });
});
