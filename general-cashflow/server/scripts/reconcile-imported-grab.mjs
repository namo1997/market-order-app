import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  snapshot: { type: 'string' }, 'message-id': { type: 'string' },
  apply: { type: 'boolean', default: false }
} });
assert.ok(values.snapshot);
assert.match(values['message-id'] || '', /^[a-f0-9]+$/);
const before = JSON.parse(await fs.readFile(values.snapshot, 'utf8'));
const { getPool, logAudit } = await import(pathToFileURL(path.resolve('src/db.js')));
const { calculateStoredLineEvidence } = await import(pathToFileURL(path.resolve('src/domain/receipts.js')));
const pool = getPool();
const connection = await pool.getConnection();
try {
  await connection.beginTransaction();
  const [receipts] = await connection.query('SELECT * FROM daily_receipts ORDER BY id FOR UPDATE');
  const [lines] = await connection.query('SELECT * FROM daily_receipt_lines ORDER BY id');
  const [recons] = await connection.query('SELECT * FROM receipt_line_reconciliations ORDER BY id');
  assert.deepEqual(receipts, before.receipts, 'Receipt changed since the backup; stop and review');
  const target = new Set(before.ids);
  const omit = (row, keys) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
  const protectedLines = rows => rows.map(row => target.has(row.id)
    ? omit(row, ['expected_amount', 'variance_amount', 'updated_at']) : row);
  assert.deepEqual(protectedLines(lines), protectedLines(before.lines), 'Cashier, bank, or another channel changed');
  const protectedRecons = rows => rows.map(row => target.has(row.receipt_line_id)
    ? omit(row, ['receiving_account_id', 'expected_gross_amount', 'fee_amount', 'expected_net_amount',
      'settlement_source', 'settlement_date', 'settlement_status', 'evidence_attachment_id',
      'cashier_reference_variance_amount', 'settlement_variance_amount', 'updated_at']) : row);
  assert.deepEqual(protectedRecons(recons), protectedRecons(before.recons), 'Unrelated reconciliation fields changed');
  const [reports] = await connection.query(
    `SELECT bi.id import_id, bi.source_date, bi.source_message_id, bit.receipt_line_id, bit.raw_payload,
            dr.id receipt_id, dr.status, b.code branch_code, pc.code channel_code
     FROM bank_inbox_imports bi JOIN bank_inbox_transactions bit ON bit.inbox_import_id = bi.id
     JOIN daily_receipt_lines l ON l.id = bit.receipt_line_id
     JOIN daily_receipts dr ON dr.id = l.receipt_id JOIN branches b ON b.id = dr.branch_id
     JOIN payment_channels pc ON pc.id = l.payment_channel_id
     WHERE bi.provider = 'GRAB_DAILY' AND bi.source_message_id LIKE ? ORDER BY bi.source_date`,
    [`${values['message-id']}:%`]);
  assert.equal(reports.length, target.size);
  assert.equal(new Set(reports.map(row => row.receipt_line_id)).size, target.size);
  const results = [];
  for (const report of reports) {
    assert.equal(report.branch_code, 'KK');
    assert.equal(report.channel_code, 'GRAB');
    assert.notEqual(report.status, 'CLOSED');
    assert.ok(target.has(report.receipt_line_id));
    const line = lines.find(row => row.id === report.receipt_line_id);
    const reconciliation = recons.find(row => row.receipt_line_id === line.id);
    assert.ok(reconciliation);
    assert.equal(reconciliation.settlement_source, 'GRAB_REPORT');
    const payload = typeof report.raw_payload === 'string' ? JSON.parse(report.raw_payload) : report.raw_payload;
    assert.equal(Number(reconciliation.expected_gross_amount), Number(payload.cashier_amount));
    assert.equal(Number(reconciliation.expected_net_amount), Number(payload.net_amount));
    const [bankRows] = await connection.query(
      `SELECT id, amount FROM statement_transactions WHERE receipt_line_id = ?
       AND match_status IN ('matched_auto', 'matched_manual')
       AND JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.source')) = 'kbank_monthly_grab_statement'`, [line.id]);
    const bankCents = bankRows.reduce((total, row) => total + Math.round(Number(row.amount) * 100), 0);
    assert.ok(bankRows.length > 0);
    assert.equal(bankCents, Math.round(Number(line.statement_amount) * 100));
    assert.equal(bankCents, Math.round(Number(payload.net_amount) * 100));
    const evidence = calculateStoredLineEvidence({ ...line, ...reconciliation, channel_code: 'GRAB' });
    assert.equal(evidence.settlementVariance, 0);
    const next = { variance_amount: evidence.settlementVariance,
      cashier_reference_variance_amount: evidence.cashierReferenceVariance,
      settlement_variance_amount: evidence.settlementVariance, settlement_status: 'MATCHED_AUTO' };
    if (values.apply) {
      await connection.query('UPDATE daily_receipt_lines SET variance_amount = ? WHERE id = ?', [next.variance_amount, line.id]);
      await connection.query(
        `UPDATE receipt_line_reconciliations SET cashier_reference_variance_amount = ?,
         settlement_variance_amount = ?, settlement_status = ? WHERE receipt_line_id = ?`,
        [next.cashier_reference_variance_amount, next.settlement_variance_amount, next.settlement_status, line.id]);
      await logAudit({ connection, entityType: 'daily_receipt', entityId: report.receipt_id,
        action: 'recalculate_grab_email_backfill',
        beforePayload: { line: before.lines.find(row => row.id === line.id),
          reconciliation: before.recons.find(row => row.receipt_line_id === line.id) },
        afterPayload: { ...next, source_message_id: report.source_message_id, import_id: report.import_id,
          bank_transaction_ids: bankRows.map(row => row.id), cashier_amount: Number(line.cashier_amount),
          report_reference_amount: Number(payload.cashier_amount), fee_amount: Number(payload.fee_amount),
          statement_amount: Number(line.statement_amount), evidence_attachment_id: reconciliation.evidence_attachment_id },
        note: 'Recalculate KK Grab from the forwarded PDF and existing bank statement; preserve cashier and bank amounts.' });
    }
    results.push({ date: report.source_date, receiptId: report.receipt_id, lineId: line.id,
      cashier: Number(line.cashier_amount), reference: Number(payload.cashier_amount),
      deductions: Number(payload.fee_amount), bankNet: Number(line.statement_amount),
      cashierVariance: evidence.cashierReferenceVariance, bankVariance: evidence.settlementVariance });
  }
  if (values.apply) await connection.commit(); else await connection.rollback();
  console.log(JSON.stringify({ apply: values.apply, rows: results.length, originalAmountsPreserved: true, results }));
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  connection.release();
  await pool.end();
}
