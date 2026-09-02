export const EVIDENCE_PENDING_LABEL = 'รอยืนยันหลักฐาน';

export const isManualReviewAwaitingEvidence = (line = {}) => {
  if (['CASH', 'OTHER_UNKNOWN'].includes(line.channel_code)) return false;
  if (Number(line.manual_checked_without_reference) !== 1) return false;

  // Imported evidence takes precedence over a leftover manual-review flag.
  const source = String(line.settlement_source || 'NONE').toUpperCase();
  if (!['NONE', 'MANUAL'].includes(source)
    || Number(line.evidence_attachment_id) > 0
    || line.settlement_status === 'MATCHED_AUTO'
    || line.settlement_batch_key) return false;

  return [line.cashier_amount, line.statement_amount, line.fee_amount,
    line.reconciliation_adjustment_amount, line.post_close_adjustment_amount]
    .some((amount) => Math.abs(Number(amount || 0)) >= 0.01);
};
