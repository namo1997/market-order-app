import crypto from 'node:crypto';
import fs from 'node:fs';
import { parseGrabDailyReport } from './domain/grab.js';
import { roundMoney } from './domain/money.js';
import { withGrabInboxImport } from './grabInboxImport.js';
import { recalculateStatementAmount } from './receiptStatementAmount.js';

export const grabReportFinancialPayload = (report) => ({
  store_id: report.storeId,
  gross_amount: report.grossAmount,
  vat_amount: report.vatAmount,
  merchant_service_amount: report.merchantServiceAmount,
  merchant_promotion_amount: report.merchantPromotionAmount,
  cashier_amount: report.cashierAmount,
  commission_and_tax_amount: report.commissionAndTaxAmount,
  additional_commission_amount: report.additionalCommissionAmount,
  marketing_fee_amount: report.marketingFeeAmount,
  merchant_delivery_discount_amount: report.merchantDeliveryDiscountAmount,
  income_adjustment_amount: report.incomeAdjustmentAmount,
  outstanding_amount: report.outstandingAmount,
  fee_amount: report.feeAmount,
  net_amount: report.netAmount
});


export const createGrabInboxImportHandler = ({ getPool, logAudit }) => async (req, res) => {
  if (!req.file || !String(req.file.originalname || '').toLowerCase().endsWith('.pdf')) {
    return res.status(400).json({ success: false, message: 'กรุณาแนบรายงาน Grab รูปแบบ PDF' });
  }
  const messageId = String(req.body.message_id || '').trim();
  if (!messageId || messageId.length > 160) {
    return res.status(400).json({ success: false, message: 'message_id จาก Gmail ไม่ถูกต้อง' });
  }
  const fileData = await fs.promises.readFile(req.file.path);
  const checksum = crypto.createHash('sha256').update(fileData).digest('hex');
  const result = await withGrabInboxImport({ pool: getPool(), messageId, checksum }, async (connection, attachmentMessageId) => {
    const report = await parseGrabDailyReport(fileData, req.file.originalname);
    const reportPayload = { ...grabReportFinancialPayload(report), source_message_id: messageId };
    const [lineRows] = report.storeId
      ? await connection.query(
        `SELECT dr.id AS receipt_id, drl.id AS receipt_line_id, dr.branch_id,
                drl.cashier_amount, drl.statement_amount
         FROM branch_grab_stores bgs
         JOIN daily_receipts dr ON dr.branch_id = bgs.branch_id AND dr.receipt_date = ? AND dr.status <> 'CLOSED'
         JOIN daily_receipt_lines drl ON drl.receipt_id = dr.id
         JOIN payment_channels pc ON pc.id = drl.payment_channel_id AND pc.code = 'GRAB'
         WHERE bgs.grab_store_id = ? FOR UPDATE`,
        [report.salesDate, report.storeId]
      )
      : [[]];
    const line = lineRows[0];
    const [importResult] = await connection.query(
      `INSERT INTO bank_inbox_imports
        (provider, source_message_id, source_date, sender_email, subject, original_name, stored_path, mime_type,
         archive_checksum, file_data, file_count, transaction_count, total_amount)
       VALUES ('GRAB_DAILY', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`,
      [
        attachmentMessageId, report.salesDate, String(req.body.sender_email || '').trim() || null,
        String(req.body.subject || '').trim() || null, req.file.originalname, req.file.path, req.file.mimetype,
        checksum, fileData, report.netAmount
      ]
    );
    const inboxImportId = importResult.insertId;
    let attachmentId = null;
    if (line) {
      const [attachmentResult] = await connection.query(
        `INSERT INTO attachments
          (receipt_id, attachment_type, original_name, stored_path, document_path, mime_type, document_mime_type,
           size_bytes, document_size_bytes, file_data, document_data, document_status)
         VALUES (?, 'other', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')`,
        [
          line.receipt_id, req.file.originalname, req.file.path, req.file.path, req.file.mimetype,
          req.file.mimetype, req.file.size, req.file.size, fileData, fileData
        ]
      );
      attachmentId = attachmentResult.insertId;
      const [accountRows] = await connection.query(
        `SELECT ra.id FROM receiving_accounts ra
         JOIN receiving_account_channels rac ON rac.receiving_account_id = ra.id
         JOIN payment_channels pc ON pc.id = rac.payment_channel_id AND pc.code = 'GRAB'
         WHERE ra.account_number = '0308663108' LIMIT 1`
      );
      await connection.query(
        `UPDATE receipt_line_reconciliations
         SET evidence_attachment_id = ?, receiving_account_id = ?, expected_gross_amount = ?, fee_amount = ?,
             expected_net_amount = ?
         WHERE receipt_line_id = ?`,
        [attachmentId, accountRows[0]?.id || null, report.cashierAmount, report.feeAmount, report.netAmount, line.receipt_line_id]
      );
      await connection.query('UPDATE daily_receipt_lines SET expected_amount = ? WHERE id = ?', [report.cashierAmount, line.receipt_line_id]);
      const matchedAmount = await recalculateStatementAmount(connection, line.receipt_line_id);
      const settlementVariance = matchedAmount > 0 ? roundMoney(matchedAmount - report.netAmount) : 0;
      await connection.query(
        `UPDATE receipt_line_reconciliations
         SET settlement_source = ?, settlement_date = CASE WHEN ? > 0 THEN settlement_date ELSE NULL END,
             settlement_status = ?, settlement_variance_amount = ?
         WHERE receipt_line_id = ?`,
        [matchedAmount > 0 ? 'BANK_STATEMENT' : 'GRAB_REPORT', matchedAmount,
          matchedAmount > 0 ? settlementVariance === 0 ? 'MATCHED_AUTO' : 'EXCEPTION' : 'READY_FOR_STATEMENT',
          settlementVariance, line.receipt_line_id]
      );
      await connection.query('UPDATE daily_receipts SET updated_at = NOW() WHERE id = ?', [line.receipt_id]);
      await connection.query(
        `INSERT INTO bank_inbox_transactions
          (inbox_import_id, receipt_line_id, auto_match_status, source_file_name, transaction_date, description,
           amount, unique_hash, raw_payload)
         VALUES (?, ?, 'LINKED', ?, ?, ?, ?, ?, ?)`,
        [
          inboxImportId, line.receipt_line_id, req.file.originalname, report.salesDate, 'Grab daily settlement report',
          report.netAmount, crypto.createHash('sha256').update(`${checksum}:${line.receipt_line_id}`).digest('hex'),
          JSON.stringify(reportPayload)
        ]
      );
    } else {
      await connection.query(
        `INSERT INTO bank_inbox_transactions
          (inbox_import_id, auto_match_status, source_file_name, transaction_date, description, amount, unique_hash, raw_payload)
         VALUES (?, 'PENDING', ?, ?, ?, ?, ?, ?)`,
        [
          inboxImportId, req.file.originalname, report.salesDate, 'Grab daily settlement report', report.netAmount,
          crypto.createHash('sha256').update(checksum).digest('hex'),
          JSON.stringify(reportPayload)
        ]
      );
    }
    await logAudit({
      connection,
      entityType: 'bank_inbox_import',
      entityId: inboxImportId,
      action: 'import_grab_gmail_pdf',
      afterPayload: { ...report, source_message_id: messageId, receipt_line_id: line?.receipt_line_id || null, attachment_id: attachmentId }
    });
    await connection.query(
      'UPDATE bank_inbox_imports SET status = ? WHERE id = ?',
      [line ? 'AUTO_LINKED' : 'PENDING_REVIEW', inboxImportId]
    );
    return { id: inboxImportId, linked: Boolean(line), receipt_line_id: line?.receipt_line_id || null, ...report };
  });
  if (result.duplicate) await fs.promises.unlink(req.file.path).catch(() => {});
  res.status(result.duplicate ? 200 : 201).json({ success: true, duplicate: result.duplicate, data: result.data });
};
