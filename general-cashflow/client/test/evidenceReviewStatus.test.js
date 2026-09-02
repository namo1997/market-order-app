import assert from 'node:assert/strict';
import test from 'node:test';
import { isManualReviewAwaitingEvidence } from '../src/evidenceReviewStatus.js';
import { buildLineEvidenceReconciliation } from '../src/reconciliationSummary.js';

const manualKtc = Object.freeze({
  channel_code: 'CREDIT_CARD_KTC',
  cashier_amount: '812.00',
  statement_amount: '812.00',
  fee_amount: '0.00',
  expected_gross_amount: '0.00',
  expected_net_amount: '0.00',
  settlement_source: 'NONE',
  settlement_status: 'MATCHED_MANUAL',
  evidence_attachment_id: null,
  manual_checked_without_reference: 1,
  receipt_status: 'CLOSED'
});

test('manual KTC confirmation without proof awaits evidence even on a closed receipt', () => {
  assert.equal(isManualReviewAwaitingEvidence(manualKtc), true);
  assert.equal(isManualReviewAwaitingEvidence({ ...manualKtc, receipt_status: 'SUBMITTED' }), true);
  assert.equal(isManualReviewAwaitingEvidence({ ...manualKtc, manual_checked_without_reference: '1' }), true);
});

test('status presentation never changes money or reconciliation calculations', () => {
  const before = buildLineEvidenceReconciliation(manualKtc);
  isManualReviewAwaitingEvidence(manualKtc);
  assert.equal(manualKtc.statement_amount, '812.00');
  assert.equal(manualKtc.receipt_status, 'CLOSED');
  assert.deepEqual(buildLineEvidenceReconciliation(manualKtc), before);
});

test('existing bank, Grab and legacy imports are unchanged even with stale manual flags', () => {
  for (const source of ['BANK_SETTLEMENT', 'BANK_STATEMENT', 'GRAB_REPORT', 'LEGACY_EVIDENCE']) {
    assert.equal(isManualReviewAwaitingEvidence({ ...manualKtc, settlement_source: source }), false, source);
  }
  assert.equal(isManualReviewAwaitingEvidence({ ...manualKtc, settlement_status: 'MATCHED_AUTO' }), false);
  assert.equal(isManualReviewAwaitingEvidence({ ...manualKtc, evidence_attachment_id: '680' }), false);
  assert.equal(isManualReviewAwaitingEvidence({ ...manualKtc, settlement_batch_key: 'KTC-KK-25-26' }), false);
});

test('pending status disappears when evidence is linked without editing original amounts', () => {
  assert.equal(isManualReviewAwaitingEvidence(manualKtc), true);
  assert.equal(isManualReviewAwaitingEvidence({ ...manualKtc, evidence_attachment_id: 680 }), false);
});

test('cash, miscellaneous, empty and unchecked rows keep their existing status', () => {
  for (const channel of ['CASH', 'OTHER_UNKNOWN']) {
    assert.equal(isManualReviewAwaitingEvidence({ ...manualKtc, channel_code: channel }), false);
  }
  assert.equal(isManualReviewAwaitingEvidence({ ...manualKtc, cashier_amount: 0, statement_amount: 0 }), false);
  assert.equal(isManualReviewAwaitingEvidence({ ...manualKtc, manual_checked_without_reference: '0' }), false);
  assert.equal(isManualReviewAwaitingEvidence({}), false);
});

test('other manual noncash channels without evidence use the same pending label', () => {
  for (const channel of ['CREDIT_CARD_SCB', 'QR_KPLUS', 'QR_KRUNGSRI', 'PROMPTPAY', 'GRAB']) {
    assert.equal(isManualReviewAwaitingEvidence({ ...manualKtc, channel_code: channel }), true, channel);
  }
  assert.equal(isManualReviewAwaitingEvidence({ ...manualKtc, settlement_source: 'MANUAL' }), true);
});
