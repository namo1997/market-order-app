import { parseOverviewQuery, buildReceiptsOverview } from './domain/receiptsOverview.js';

// A consistent read-only snapshot: no existing receipt serializers, refreshes,
// migration hooks or POS backfills run while opening this report.
export async function loadOverviewData(pool, q) {
  const c = await pool.getConnection();
  try {
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await c.query('START TRANSACTION READ ONLY');
    const select = async (sql, params = []) => (await c.query(sql, params))[0];
    const branches = await select('SELECT id, code, name, is_active FROM branches ORDER BY id');
    const channels = await select('SELECT id, code, label, kind, sort_order FROM payment_channels ORDER BY sort_order, id');
    const accounts = await select("SELECT id, branch_id, label, bank_name, RIGHT(account_number, 4) AS last4 FROM receiving_accounts ORDER BY id");
    const params = [q.from, q.to, q.from, q.to];
    let scope = `(dr.receipt_date BETWEEN ? AND ? OR EXISTS (
      SELECT 1 FROM statement_transactions st WHERE st.receipt_id = dr.id AND st.transaction_date BETWEEN ? AND ?))`;
    // Load all branches before batch validation: a shared account or batch may
    // contain another branch even when the output filter selects only one.
    if (q.receipt_id) { scope = 'dr.id = ?'; params.splice(0, params.length, q.receipt_id); }
    const selected = await select(`SELECT dr.id FROM daily_receipts dr WHERE ${scope}`, params);
    const ids = selected.map(r => r.id);
    if (!ids.length) { await c.commit(); return { branches, channels, accounts, receipts: [], lines: [], transactions: [] }; }
    const siblings = await select(`SELECT DISTINCT drl.receipt_id AS id FROM daily_receipt_lines drl
      JOIN receipt_line_reconciliations r ON r.receipt_line_id = drl.id
      WHERE r.settlement_batch_key IN (SELECT r2.settlement_batch_key FROM receipt_line_reconciliations r2
      JOIN daily_receipt_lines l2 ON l2.id = r2.receipt_line_id WHERE l2.receipt_id IN (?) AND r2.settlement_batch_key IS NOT NULL)`, [ids]);
    const allIds = [...new Set([...ids, ...siblings.map(r => r.id)])];
    const receipts = await select(`SELECT dr.*, b.code AS branch_code, b.name AS branch_name,
      su.full_name AS submitted_by_name, cu.full_name AS checked_by_name, ru.full_name AS closed_by_name,
      (SELECT COALESCE(SUM(amount),0) FROM receipt_misc_items WHERE receipt_id = dr.id) AS misc_total
      FROM daily_receipts dr JOIN branches b ON b.id = dr.branch_id
      LEFT JOIN users su ON su.id = dr.submitted_by LEFT JOIN users cu ON cu.id = dr.checked_by
      LEFT JOIN users ru ON ru.id = dr.closed_by WHERE dr.id IN (?)`, [allIds]);
    const lines = await select(`SELECT l.*, pc.code AS channel_code, pc.label AS channel_label, pc.kind AS channel_kind,
      r.receiving_account_id, a.label AS account_label, r.expected_gross_amount, r.fee_amount,
      r.expected_net_amount, r.matched_amount, r.settlement_date, r.settlement_source, r.settlement_status,
      r.manual_checked_without_reference, r.evidence_attachment_id, r.exception_note,
      r.settlement_batch_key, r.settlement_batch_allocated_net_amount, r.settlement_batch_allocated_fee_amount
      FROM daily_receipt_lines l JOIN payment_channels pc ON pc.id = l.payment_channel_id
      LEFT JOIN receipt_line_reconciliations r ON r.receipt_line_id = l.id
      LEFT JOIN receiving_accounts a ON a.id = r.receiving_account_id WHERE l.receipt_id IN (?) ORDER BY pc.sort_order, l.id`, [allIds]);
    const transactions = await select(`SELECT st.id, st.receipt_id, st.receipt_line_id, st.transaction_date,
      st.description, st.reference_no, st.amount, st.unique_hash, st.raw_payload, st.match_status,
      COALESCE(st.receiving_account_id, si.receiving_account_id, r.receiving_account_id) AS account_id,
      si.original_name AS import_name FROM statement_transactions st
      JOIN statement_imports si ON si.id = st.import_id
      LEFT JOIN receipt_line_reconciliations r ON r.receipt_line_id = st.receipt_line_id
      WHERE st.receipt_id IN (?) ORDER BY st.id`, [allIds]);
    const adjustments = await select(`SELECT a.*, u.full_name AS actor_name FROM receipt_post_close_adjustments a
      LEFT JOIN users u ON u.id = a.created_by WHERE a.receipt_id IN (?) ORDER BY a.revision`, [allIds]);
    const attachments = await select(`SELECT id, receipt_id, original_name, attachment_type, mime_type, document_status FROM attachments WHERE receipt_id IN (?) ORDER BY id`, [allIds]);
    const audit = await select(`SELECT a.id, a.entity_id, a.action, a.note, a.created_at, u.full_name AS actor_name
      FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.entity_type = 'daily_receipt' AND a.entity_id IN (?) ORDER BY a.created_at DESC, a.id DESC`, [allIds]);
    const misc = await select('SELECT id, receipt_id, label, amount FROM receipt_misc_items WHERE receipt_id IN (?) ORDER BY id', [allIds]);
    await c.commit();
    return { branches, channels, accounts, receipts, lines, transactions, adjustments, attachments, audit, misc };
  } catch (error) { await c.rollback(); throw error; }
  finally { c.release(); }
}

export function createOverviewHandler(pool) {
  return async (req, res, next) => {
    try {
      const q = parseOverviewQuery(req.query);
      const data = await loadOverviewData(pool, q);
      const report = buildReceiptsOverview(data, q);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: { ...report, all_channels: data.channels, branches: data.branches, accounts: data.accounts } });
    } catch (error) { next(error); }
  };
}
