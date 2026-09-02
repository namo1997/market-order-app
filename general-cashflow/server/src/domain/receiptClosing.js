import { roundMoney, sumMoney } from './money.js';
import { branchSupportsPaymentChannel } from './paymentChannels.js';

export const buildReceiptClosingSummary = (receipt) => {
  const lines = (receipt.lines || []).filter((line) =>
    branchSupportsPaymentChannel(receipt.branch_code, line.channel_code)
  );
  const actualMoneyTotal = sumMoney(lines.map((line) => line.settlement_batch_key
    ? line.settlement_batch_allocated_net_amount
    : line.statement_amount));
  const deductionTotal = sumMoney(lines.map((line) => line.channel_code === 'CASH'
    ? 0
    : line.settlement_batch_key ? line.settlement_batch_allocated_fee_amount : line.fee_amount));
  const lineAdjustmentTotal = sumMoney(lines.map((line) => line.reconciliation_adjustment_amount));
  const miscTotal = Array.isArray(receipt.misc_items)
    ? sumMoney(receipt.misc_items.map((item) => item.amount))
    : roundMoney(receipt.misc_total);
  const posWithChangeTotal = sumMoney([receipt.gross_sales_expected, receipt.morning_change_amount]);
  const reconciledTotal = sumMoney([actualMoneyTotal, deductionTotal, lineAdjustmentTotal, miscTotal]);

  return {
    version: 1,
    actual_money_total: actualMoneyTotal,
    deduction_total: deductionTotal,
    line_adjustment_total: lineAdjustmentTotal,
    misc_adjustment_total: miscTotal,
    pos_with_change_total: posWithChangeTotal,
    reconciled_total: reconciledTotal,
    variance_total: roundMoney(reconciledTotal - posWithChangeTotal)
  };
};

export const receiptConfirmationFields = (receipt) => {
  if (receipt.status !== 'CLOSED') {
    return { confirmed_variance_total: null, confirmed_reconciled_total: null, confirmed_variance_source: null };
  }
  let snapshot = receipt.closed_reconciliation_snapshot;
  if (typeof snapshot === 'string') {
    try { snapshot = JSON.parse(snapshot); } catch { snapshot = null; }
  }
  const hasSnapshot = snapshot?.version === 1 &&
    Number.isFinite(snapshot.variance_total) && Number.isFinite(snapshot.reconciled_total);
  const summary = hasSnapshot ? snapshot : buildReceiptClosingSummary(receipt);
  const notes = receipt.post_close_adjustments || [];
  if (notes.length) {
    const first = notes[0];
    const latest = notes[notes.length - 1];
    return {
      confirmed_variance_total: Number(latest.variance_total_after),
      confirmed_reconciled_total: Number(latest.reconciled_total_after),
      confirmed_variance_source: 'POST_CLOSE_ADJUSTMENT',
      original_confirmed_variance_total: Number(first.variance_total_before),
      original_confirmed_reconciled_total: Number(first.reconciled_total_before),
      post_close_adjustment_total: sumMoney(notes.map((note) => note.amount)),
      post_close_adjustment_count: notes.length
    };
  }
  return {
    confirmed_variance_total: summary.variance_total,
    confirmed_reconciled_total: summary.reconciled_total,
    confirmed_variance_source: hasSnapshot ? 'CLOSING_SNAPSHOT' : 'SAVED_RECONCILIATION'
  };
};
