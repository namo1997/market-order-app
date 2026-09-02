import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { recalculateReceipts } from '../src/recalculateReceipts.js';

const pool = mysql.createPool({ host: '127.0.0.1', port: 3317, user: 'cashflow_preview',
  password: 'cashflow-preview', database: 'general_cashflow_preview', dateStrings: true });
const branchCode = `RECALC_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
let branchId;
const ids = [];
try {
  const [[qr]] = await pool.query("SELECT id FROM payment_channels WHERE code='QR_KPLUS'");
  const [[cash]] = await pool.query("SELECT id FROM payment_channels WHERE code='CASH'");
  const [branch] = await pool.query('INSERT INTO branches (code,name,clickhouse_branch_id) VALUES (?,?,?)', [branchCode, branchCode, branchCode]);
  branchId = branch.insertId;
  for (const [index, status] of ['SUBMITTED', 'CLOSED', 'CHECKED_OK', 'SUBMITTED'].entries()) {
    const [receipt] = await pool.query('INSERT INTO daily_receipts (branch_id,receipt_date,status,gross_sales_expected) VALUES (?,?,?,100)',
      [branchId, `2026-08-0${index + 1}`, status]);
    ids.push(receipt.insertId);
    const [line] = await pool.query('INSERT INTO daily_receipt_lines (receipt_id,payment_channel_id,expected_amount,cashier_amount,statement_amount) VALUES (?,?,999,100,80)', [receipt.insertId, qr.id]);
    await pool.query("INSERT INTO receipt_line_reconciliations (receipt_line_id,expected_gross_amount,expected_net_amount,settlement_source,settlement_status) VALUES (?,100,100,'BANK_SETTLEMENT','MATCHED_AUTO')", [line.insertId]);
    if (index === 3) await pool.query('INSERT INTO daily_receipt_lines (receipt_id,payment_channel_id,cashier_amount,statement_amount) VALUES (?,?,100,50)', [receipt.insertId, cash.id]);
  }
  const read = async () => {
    const [receipts] = await pool.query('SELECT * FROM daily_receipts WHERE branch_id=? ORDER BY id', [branchId]);
    const [lines] = await pool.query('SELECT drl.* FROM daily_receipt_lines drl JOIN daily_receipts dr ON dr.id=drl.receipt_id WHERE dr.branch_id=? ORDER BY drl.id', [branchId]);
    const [reconciliations] = await pool.query('SELECT rlr.* FROM receipt_line_reconciliations rlr JOIN daily_receipt_lines drl ON drl.id=rlr.receipt_line_id JOIN daily_receipts dr ON dr.id=drl.receipt_id WHERE dr.branch_id=? ORDER BY rlr.id', [branchId]);
    return { receipts, lines, reconciliations };
  };
  const before = await read();
  const dry = await recalculateReceipts(pool, { branchCodes: [branchCode] });
  assert.equal(dry.receipts, 4);
  assert.equal(dry.closed_read_only, 1);
  assert.equal(dry.changed_receipts, 3);
  assert.deepEqual(await read(), before);
  const applied = await recalculateReceipts(pool, { branchCodes: [branchCode], apply: true });
  assert.equal(applied.receipts, 3);
  assert.equal(applied.closed_read_only, 1);
  assert.equal(applied.changed_receipts, 2);
  assert.equal(applied.status_changes, 1);
  assert.equal(applied.failed, 1);
  assert.match(applied.results.find((item) => item.error).error, /Missing reconciliation/);
  const after = await read();
  assert.equal(after.lines[0].variance_amount, '-20.00');
  assert.equal(after.receipts[2].status, 'CHECKED_VARIANCE');
  for (const receiptId of [ids[1], ids[3]]) {
    assert.deepEqual(after.receipts.find((row) => row.id === receiptId), before.receipts.find((row) => row.id === receiptId));
    const lineIds = before.lines.filter((row) => row.receipt_id === receiptId).map((row) => row.id);
    assert.deepEqual(after.lines.filter((row) => lineIds.includes(row.id)), before.lines.filter((row) => lineIds.includes(row.id)));
    assert.deepEqual(after.reconciliations.filter((row) => lineIds.includes(row.receipt_line_id)), before.reconciliations.filter((row) => lineIds.includes(row.receipt_line_id)));
  }
  const protectedFields = (data) => ({
    receipts: data.receipts.map(({ updated_at, status, ...row }) => ({ ...row, status: status.startsWith('CHECKED_') ? 'CHECKED' : status })),
    lines: data.lines.map(({ updated_at, variance_amount, ...row }) => row),
    reconciliations: data.reconciliations.map(({ updated_at, cashier_reference_variance_amount, settlement_variance_amount, ...row }) => row)
  });
  assert.deepEqual(protectedFields(after), protectedFields(before));
  const second = await recalculateReceipts(pool, { branchCodes: [branchCode], apply: true, receiptIds: ids.slice(0, 3) });
  assert.equal(second.changed_receipts, 0);
  assert.equal(second.failed, 0);
  const [[{ count }]] = await pool.query("SELECT COUNT(*) AS count FROM audit_logs WHERE action='recalculate_evidence_variances' AND entity_type='daily_receipt' AND entity_id IN (?,?,?,?)", ids);
  assert.equal(count, 2);
  console.log(JSON.stringify({ result: 'PASS', dryRunReadOnly: true, closedPreserved: true,
    inputAmountsPreserved: true, idempotent: true, deliberateFailureRolledBack: true, auditCount: count }));
} finally {
  if (branchId) {
    await pool.query('DELETE FROM daily_receipts WHERE branch_id=?', [branchId]);
    await pool.query('DELETE FROM branches WHERE id=?', [branchId]);
  }
  for (const id of ids) await pool.query("DELETE FROM audit_logs WHERE entity_type='daily_receipt' AND entity_id=?", [id]);
  await pool.end();
}
