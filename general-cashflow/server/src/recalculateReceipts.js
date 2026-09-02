import { logAudit } from './db.js';
import { roundMoney, sumMoney } from './domain/money.js';
import { branchSupportsPaymentChannel } from './domain/paymentChannels.js';
import { buildReceiptClosingSummary, receiptConfirmationFields } from './domain/receiptClosing.js';
import { calculateStoredLineEvidence, resolveCheckedStatus } from './domain/receipts.js';

export const planReceiptRecalculation = (receipt) => {
  const lines = receipt.lines.filter((line) => branchSupportsPaymentChannel(receipt.branch_code, line.channel_code));
  const calculated = lines.map((line) => {
    const evidence = calculateStoredLineEvidence(line);
    return { ...line, evidence,
      variance_amount: evidence.settlementVariance,
      cashier_reference_variance_amount: evidence.cashierReferenceVariance,
      settlement_variance_amount: evidence.settlementVariance };
  });
  const fields = ['variance_amount', 'cashier_reference_variance_amount', 'settlement_variance_amount'];
  const changes = calculated.flatMap((line, index) => {
    const before = lines[index];
    if (!fields.some((key) => roundMoney(before[key]) !== line[key])) return [];
    return [{ line_id: line.id, reconciliation_id: line.reconciliation_id,
      before: Object.fromEntries(fields.map((key) => [key, roundMoney(before[key])])),
      after: Object.fromEntries(fields.map((key) => [key, line[key]])) }];
  });
  const closing = buildReceiptClosingSummary({ ...receipt, lines });
  const cashierTotal = sumMoney([...lines.map((line) => line.cashier_amount), closing.misc_adjustment_total]);
  const pending = calculated.filter((line) => !Number(line.manual_checked_without_reference)
    && !['MATCHED_AUTO', 'MATCHED_MANUAL'].includes(line.settlement_status)
    && [line.cashier_amount, line.statement_amount, line.evidence.referenceGross, line.reconciliation_adjustment_amount]
      .some((amount) => Math.abs(Number(amount || 0)) >= 0.01))
    .map((line) => ({ line_id: line.id, channel_code: line.channel_code,
      cashier_amount: roundMoney(line.cashier_amount), actual_amount: roundMoney(line.statement_amount) }));
  const closed = receipt.status === 'CLOSED';
  return {
    receipt_id: receipt.id, receipt_date: receipt.receipt_date, branch_code: receipt.branch_code,
    status_before: receipt.status,
    status_after: ['CHECKED_OK', 'CHECKED_VARIANCE'].includes(receipt.status)
      ? resolveCheckedStatus(calculated) : receipt.status,
    closed_read_only: closed,
    changes: closed ? [] : changes,
    summary: { ...closing, cashier_total: cashierTotal,
      before_deductions_total: sumMoney(calculated.map((line) => line.evidence.referenceGross)),
      cashier_vs_pos_variance: roundMoney(cashierTotal - closing.pos_with_change_total),
      settlement_vs_cashier_variance: roundMoney(closing.reconciled_total - cashierTotal),
      ...receiptConfirmationFields(receipt) },
    pending_channels: pending,
    historical_evidence_warning: closed && calculated.some((line) => line.evidence.settlementSource !== 'NONE'
      && line.evidence.hasEvidenceVariance)
  };
};

export const recalculateReceipts = async (pool, { apply = false, branchCodes = ['KK', 'SK'], receiptIds } = {}) => {
  if (!branchCodes.length || branchCodes.some((code) => !/^[A-Z0-9_]+$/.test(code))) throw new Error('Invalid branch codes');
  if (receiptIds && (!receiptIds.length || receiptIds.some((id) => !Number.isSafeInteger(id) || id <= 0))) throw new Error('Invalid receipt IDs');
  const connection = await pool.getConnection();
  const output = { apply, receipts: 0, closed_read_only: 0, changed_receipts: 0, changed_lines: 0,
    status_changes: 0, pending_receipts: 0, failed: 0, results: [] };
  try {
    const [receipts] = await connection.query(
      `SELECT dr.id FROM daily_receipts dr JOIN branches b ON b.id = dr.branch_id
       WHERE b.code IN (${branchCodes.map(() => '?').join(',')})
       ${receiptIds ? `AND dr.id IN (${receiptIds.map(() => '?').join(',')})` : ''}
       ORDER BY dr.receipt_date, b.code, dr.id`, [...branchCodes, ...(receiptIds || [])]
    );
    for (const { id } of receipts) {
      try {
        await connection.beginTransaction();
        const [[receipt]] = await connection.query(
          `SELECT dr.*, b.code AS branch_code FROM daily_receipts dr JOIN branches b ON b.id = dr.branch_id
           WHERE dr.id = ? ${apply ? 'FOR UPDATE' : ''}`, [id]
        );
        const [lines] = await connection.query(
          `SELECT drl.*, pc.code AS channel_code, rlr.id AS reconciliation_id,
                  rlr.expected_gross_amount, rlr.expected_net_amount, rlr.fee_amount, rlr.settlement_source,
                  rlr.cashier_reference_variance_amount, rlr.settlement_variance_amount,
                  rlr.settlement_status, rlr.manual_checked_without_reference,
                  rlr.settlement_batch_key, rlr.settlement_batch_allocated_net_amount,
                  rlr.settlement_batch_allocated_fee_amount, rlr.settlement_batch_variance_amount
           FROM daily_receipt_lines drl JOIN payment_channels pc ON pc.id = drl.payment_channel_id
           LEFT JOIN receipt_line_reconciliations rlr ON rlr.receipt_line_id = drl.id
           WHERE drl.receipt_id = ? ORDER BY drl.id ${apply ? 'FOR UPDATE' : ''}`, [id]
        );
        const [misc_items] = await connection.query(
          `SELECT id, amount FROM receipt_misc_items WHERE receipt_id = ? ORDER BY id ${apply ? 'FOR UPDATE' : ''}`, [id]
        );
        const result = planReceiptRecalculation({ ...receipt, lines, misc_items });
        const statusChanged = result.status_after !== result.status_before;
        if (apply && !result.closed_read_only && (result.changes.length || statusChanged)) {
          for (const change of result.changes) {
            if (!change.reconciliation_id) throw new Error(`Missing reconciliation row for line ${change.line_id}`);
            await connection.query('UPDATE daily_receipt_lines SET variance_amount = ? WHERE id = ?',
              [change.after.variance_amount, change.line_id]);
            await connection.query(
              `UPDATE receipt_line_reconciliations SET cashier_reference_variance_amount = ?, settlement_variance_amount = ? WHERE id = ?`,
              [change.after.cashier_reference_variance_amount, change.after.settlement_variance_amount, change.reconciliation_id]
            );
          }
          if (statusChanged) await connection.query('UPDATE daily_receipts SET status = ? WHERE id = ?', [result.status_after, id]);
          await logAudit({ connection, entityType: 'daily_receipt', entityId: id, action: 'recalculate_evidence_variances',
            beforePayload: { status: result.status_before, lines: result.changes.map((change) => ({ id: change.line_id, ...change.before })) },
            afterPayload: { status: result.status_after, lines: result.changes.map((change) => ({ id: change.line_id, ...change.after })),
              summary: result.summary, pending_channels: result.pending_channels },
            note: 'คำนวณผลต่างใหม่จากยอดและหลักฐานที่บันทึกไว้ ไม่แก้ยอด POS แคชเชียร์ เงินเข้าจริง ค่าธรรมเนียม หรือยอดปรับปรุง'
          });
        }
        if (apply) await connection.commit(); else await connection.rollback();
        output.receipts++;
        output.closed_read_only += Number(result.closed_read_only);
        output.changed_receipts += Number(result.changes.length > 0 || statusChanged);
        output.changed_lines += result.changes.length;
        output.status_changes += Number(statusChanged);
        output.pending_receipts += Number(result.pending_channels.length > 0 && !result.closed_read_only);
        output.results.push(result);
      } catch (error) {
        await connection.rollback();
        output.failed++;
        output.results.push({ receipt_id: id, error: error.message });
      }
    }
    return output;
  } finally {
    connection.release();
  }
};
