import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { repairLegacyKplusReferences } from '../src/kplusEvidence.js';

// Explicit local-only integration check. No production credentials are read.
const pool = mysql.createPool({ host: '127.0.0.1', port: 3317, user: 'cashflow_preview',
  password: 'cashflow-preview', database: 'general_cashflow_preview', dateStrings: true });
const marker = `KPLUS_${crypto.randomBytes(5).toString('hex')}`;
const fixtureIds = [];
const imports = [];
let branchId;
try {
  const [[channel]] = await pool.query("SELECT id FROM payment_channels WHERE code='QR_KPLUS'");
  const [branch] = await pool.query('INSERT INTO branches (code,name,clickhouse_branch_id) VALUES (?,?,?)', [marker, marker, marker]);
  branchId = branch.insertId;
  for (const [index, kind] of ['valid', 'closed', 'wrong_date', 'secondary', 'unmatched'].entries()) {
    const date = `2026-08-${String(index + 4).padStart(2, '0')}`;
    const merchant = `KB${index}${marker.replace('KPLUS_', '').toUpperCase()}`;
    const body = `รหัสร้านค้า : ${merchant} ยอดเงินจำนวน(บาท) : 29,221.90`;
    const hash = crypto.createHash('sha256').update(`${marker}-${index}`).digest('hex');
    await pool.query('INSERT INTO bank_merchant_mappings (provider,merchant_id,branch_id,payment_channel_id,is_primary) VALUES (?,?,?,?,?)',
      ['KPLUSSHOP', merchant, branchId, channel.id, kind === 'secondary' ? 0 : 1]);
    const [receipt] = await pool.query('INSERT INTO daily_receipts (branch_id,receipt_date,status,gross_sales_expected) VALUES (?,?,?,74768.50)',
      [branchId, date, kind === 'closed' ? 'CLOSED' : 'SUBMITTED']);
    fixtureIds.push(receipt.insertId);
    const [line] = await pool.query('INSERT INTO daily_receipt_lines (receipt_id,payment_channel_id,expected_amount,cashier_amount,statement_amount) VALUES (?,?,44751.90,29221.90,29221.90)',
      [receipt.insertId, channel.id]);
    const [attachment] = await pool.query("INSERT INTO attachments (receipt_id,attachment_type,original_name,stored_path,mime_type,size_bytes,file_data) VALUES (?,'statement',?,'/test/kshop.html','text/html',?,?)",
      [receipt.insertId, `KSHOP-${date}.html`, Buffer.byteLength(body), Buffer.from(body)]);
    await pool.query("INSERT INTO receipt_line_reconciliations (receipt_line_id,expected_gross_amount,expected_net_amount,matched_amount,settlement_source,settlement_status,evidence_attachment_id,cashier_reference_variance_amount,settlement_variance_amount) VALUES (?,44751.90,44751.90,29221.90,'LEGACY_EVIDENCE','MATCHED_AUTO',?,-15530,-15530)",
      [line.insertId, attachment.insertId]);
    const [inbox] = await pool.query("INSERT INTO bank_inbox_imports (provider,source_message_id,source_date,original_name,stored_path,archive_checksum,total_amount) VALUES ('KPLUSSHOP',?,?,'KSHOP daily email','/test/email',?,29221.90)",
      [`${marker}-${index}`, date, hash]);
    imports.push(inbox.insertId);
    const raw = JSON.stringify({ merchant_id: merchant, body });
    await pool.query("INSERT INTO bank_inbox_transactions (inbox_import_id,receipt_line_id,auto_match_status,source_file_name,transaction_date,reference_no,amount,unique_hash,raw_payload) VALUES (?,?,'LINKED','KSHOP daily email',?,?,29221.90,?,?)",
      [inbox.insertId, line.insertId, kind === 'wrong_date' ? '2026-08-30' : date, merchant, hash, raw]);
    const [statement] = await pool.query("INSERT INTO statement_imports (receipt_id,payment_channel_id,original_name,stored_path,mime_type) VALUES (?,?,'KSHOP','/test/email','message/rfc822')", [receipt.insertId, channel.id]);
    await pool.query('INSERT INTO statement_transactions (import_id,receipt_id,receipt_line_id,payment_channel_id,transaction_date,reference_no,amount,unique_hash,raw_payload,match_status) VALUES (?,?,?,?,?,?,29221.90,?,?,?)',
      [statement.insertId, receipt.insertId, line.insertId, channel.id, date, merchant, hash, raw, kind === 'unmatched' ? 'unmatched' : 'matched_auto']);
  }
  const [[{ outsiders }]] = await pool.query("SELECT COUNT(*) AS outsiders FROM receipt_line_reconciliations rlr JOIN daily_receipt_lines drl ON drl.id=rlr.receipt_line_id JOIN daily_receipts dr ON dr.id=drl.receipt_id JOIN payment_channels pc ON pc.id=drl.payment_channel_id WHERE pc.code='QR_KPLUS' AND rlr.settlement_source='LEGACY_EVIDENCE' AND dr.status IN ('DRAFT','SUBMITTED','NEEDS_CORRECTION') AND dr.branch_id<>?", [branchId]);
  assert.equal(outsiders, 0, 'Do not repair unrelated preview data');
  const read = async () => {
    const [lines] = await pool.query('SELECT drl.*,dr.status,rlr.expected_gross_amount,rlr.expected_net_amount,rlr.settlement_source,rlr.cashier_reference_variance_amount,rlr.settlement_variance_amount FROM daily_receipt_lines drl JOIN daily_receipts dr ON dr.id=drl.receipt_id JOIN receipt_line_reconciliations rlr ON rlr.receipt_line_id=drl.id WHERE dr.branch_id=? ORDER BY dr.receipt_date', [branchId]);
    return lines;
  };
  const before = await read();
  assert.deepEqual(await repairLegacyKplusReferences(pool), { updated: 1, skipped: 3, failed: 0 });
  const after = await read();
  assert.deepEqual(after.slice(1), before.slice(1));
  const allowed = ['expected_gross_amount','expected_net_amount','settlement_source','cashier_reference_variance_amount','settlement_variance_amount'];
  for (const key of Object.keys(before[0]).filter((key) => !allowed.includes(key))) assert.deepEqual(after[0][key], before[0][key], key);
  assert.equal(after[0].expected_gross_amount, '29221.90');
  assert.equal(after[0].expected_net_amount, '29221.90');
  assert.equal(after[0].cashier_reference_variance_amount, '0.00');
  assert.equal(after[0].settlement_variance_amount, '0.00');
  assert.deepEqual(await repairLegacyKplusReferences(pool), { updated: 0, skipped: 3, failed: 0 });
  const [[{ count }]] = await pool.query("SELECT COUNT(*) AS count FROM audit_logs WHERE entity_type='daily_receipt' AND entity_id=? AND action='repair_kplus_pos_reference'", [fixtureIds[0]]);
  assert.equal(count, 1);
  console.log(JSON.stringify({ result: 'PASS', repaired: 1, unchanged: 4, idempotent: true, auditCount: count }));
} finally {
  if (branchId) {
    await pool.query('DELETE FROM daily_receipts WHERE branch_id=?', [branchId]);
    await pool.query('DELETE FROM branches WHERE id=?', [branchId]);
  }
  for (const id of imports) await pool.query('DELETE FROM bank_inbox_imports WHERE id=?', [id]);
  for (const id of fixtureIds) await pool.query("DELETE FROM audit_logs WHERE entity_type='daily_receipt' AND entity_id=?", [id]);
  await pool.end();
}
