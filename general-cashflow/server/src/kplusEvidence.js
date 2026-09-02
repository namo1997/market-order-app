import { logAudit } from './db.js';
import { parseKplusShopEmail } from './domain/kplusShop.js';
import { roundMoney } from './domain/money.js';
import { calculateEvidenceVariances } from './domain/receipts.js';

export const resolveLegacyKplusReference = (line, evidenceRows) => {
  if (line.channel_code !== 'QR_KPLUS'
    || !['DRAFT', 'SUBMITTED', 'NEEDS_CORRECTION'].includes(line.receipt_status)
    || line.settlement_source !== 'LEGACY_EVIDENCE'
    || line.settlement_status !== 'MATCHED_AUTO'
    || Number(line.manual_checked_without_reference)
    || Number(line.fee_amount) !== 0
    || Number(line.expected_amount) <= 0
    || Number(line.expected_gross_amount) !== Number(line.expected_amount)
    || Number(line.expected_net_amount) !== Number(line.expected_amount)
    || evidenceRows.length !== 1) return null;

  const row = evidenceRows[0];
  const raw = typeof row.raw_payload === 'string' ? JSON.parse(row.raw_payload) : row.raw_payload;
  const email = parseKplusShopEmail(raw?.body);
  const attachment = parseKplusShopEmail(Buffer.from(line.evidence_file_data || '').toString('utf8'));
  const amount = roundMoney(row.amount);
  if (email.merchantId !== row.reference_no || attachment.merchantId !== email.merchantId
    || email.amount !== amount || attachment.amount !== amount
    || amount === Number(line.expected_gross_amount)) return null;

  // Never copy the editable actual/cashier fields into the reference to hide a variance.
  const comparison = calculateEvidenceVariances({
    channelCode: line.channel_code, cashierAmount: line.cashier_amount,
    statementAmount: line.statement_amount, expectedGrossAmount: amount,
    expectedNetAmount: amount, feeAmount: 0, settlementSource: 'BANK_SETTLEMENT'
  });
  return {
    expected_gross_amount: amount,
    expected_net_amount: amount,
    settlement_source: 'BANK_SETTLEMENT',
    cashier_reference_variance_amount: comparison.cashierReferenceVariance,
    settlement_variance_amount: comparison.settlementVariance,
    settlement_status: comparison.hasEvidenceVariance ? 'EXCEPTION' : 'MATCHED_AUTO',
    inbox_import_id: row.inbox_import_id,
    bank_transaction_id: row.bank_transaction_id,
    statement_transaction_id: row.statement_transaction_id
  };
};

export const repairLegacyKplusReferences = async (pool) => {
  const connection = await pool.getConnection();
  const result = { updated: 0, skipped: 0, failed: 0 };
  try {
    const [candidates] = await connection.query(
      `SELECT drl.id FROM daily_receipt_lines drl
       JOIN daily_receipts dr ON dr.id = drl.receipt_id
       JOIN payment_channels pc ON pc.id = drl.payment_channel_id
       JOIN receipt_line_reconciliations rlr ON rlr.receipt_line_id = drl.id
       WHERE pc.code = 'QR_KPLUS' AND rlr.settlement_source = 'LEGACY_EVIDENCE'
         AND dr.status IN ('DRAFT', 'SUBMITTED', 'NEEDS_CORRECTION')
       ORDER BY drl.id`
    );
    for (const candidate of candidates) {
      try {
        await connection.beginTransaction();
        const [lines] = await connection.query(
          `SELECT drl.id, drl.receipt_id, drl.expected_amount, drl.cashier_amount, drl.statement_amount,
                  dr.branch_id, dr.receipt_date, dr.status AS receipt_status,
                  pc.code AS channel_code, rlr.expected_gross_amount, rlr.expected_net_amount,
                  rlr.fee_amount, rlr.settlement_source, rlr.settlement_status,
                  rlr.cashier_reference_variance_amount, rlr.settlement_variance_amount,
                  rlr.manual_checked_without_reference, rlr.evidence_attachment_id,
                  a.file_data AS evidence_file_data
           FROM daily_receipt_lines drl JOIN daily_receipts dr ON dr.id = drl.receipt_id
           JOIN payment_channels pc ON pc.id = drl.payment_channel_id
           JOIN receipt_line_reconciliations rlr ON rlr.receipt_line_id = drl.id
           JOIN attachments a ON a.id = rlr.evidence_attachment_id AND a.receipt_id = dr.id
           WHERE drl.id = ? FOR UPDATE`, [candidate.id]
        );
        const line = lines[0];
        if (!line) {
          await connection.rollback();
          result.skipped++;
          continue;
        }
        const [evidence] = await connection.query(
          `SELECT bit.id AS bank_transaction_id, bi.id AS inbox_import_id,
                  st.id AS statement_transaction_id, bit.amount, bit.reference_no, bit.raw_payload
           FROM bank_inbox_transactions bit
           JOIN bank_inbox_imports bi ON bi.id = bit.inbox_import_id AND bi.provider = 'KPLUSSHOP'
           JOIN statement_transactions st ON st.unique_hash = bit.unique_hash
             AND st.receipt_line_id = bit.receipt_line_id AND st.receipt_id = ?
           JOIN bank_merchant_mappings bmm ON bmm.provider = bi.provider
             AND bmm.merchant_id = bit.reference_no AND bmm.branch_id = ?
             AND bmm.payment_channel_id = st.payment_channel_id AND bmm.is_primary = TRUE
           WHERE bit.receipt_line_id = ? AND bit.transaction_date = ? AND bi.source_date = ?
             AND st.transaction_date = ? AND bit.auto_match_status = 'LINKED'
             AND st.match_status = 'matched_auto'`,
          [line.receipt_id, line.branch_id, line.id, line.receipt_date, line.receipt_date, line.receipt_date]
        );
        const repair = resolveLegacyKplusReference(line, evidence);
        if (!repair) {
          await connection.rollback();
          result.skipped++;
          continue;
        }
        const fields = ['expected_gross_amount', 'expected_net_amount', 'settlement_source',
          'cashier_reference_variance_amount', 'settlement_variance_amount', 'settlement_status'];
        await connection.query(
          `UPDATE receipt_line_reconciliations SET ${fields.map((field) => `${field} = ?`).join(', ')}
           WHERE receipt_line_id = ?`, [...fields.map((field) => repair[field]), line.id]
        );
        await logAudit({
          connection, entityType: 'daily_receipt', entityId: line.receipt_id,
          action: 'repair_kplus_pos_reference',
          beforePayload: Object.fromEntries(fields.map((field) => [field, line[field]])),
          afterPayload: { receipt_line_id: line.id, evidence_attachment_id: line.evidence_attachment_id, ...repair },
          note: 'แก้ฐานก่อนหัก QR กสิกรจาก POS เก่าเป็นยอดอีเมล K SHOP โดยไม่เปลี่ยนแคชเชียร์หรือเงินเข้าจริง'
        });
        await connection.commit();
        result.updated++;
      } catch (error) {
        await connection.rollback();
        result.failed++;
        console.error('Unable to repair K SHOP reference', candidate.id, error.message);
      }
    }
    return result;
  } finally {
    connection.release();
  }
};
