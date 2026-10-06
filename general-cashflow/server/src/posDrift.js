import { fetchExpectedSalesRange } from './clickhouse.js';
import { findPosDrift } from './domain/posDrift.js';

export const POS_DRIFT_LOOKBACK_DAYS = 62;
const isoDate = (date) => date.toISOString().slice(0, 10);

// Record the latest POS totals for recent receipts and refresh every receipt
// that is still open, so cashier over/short is never computed from a stale POS
// snapshot. Closed receipts keep their snapshot and are only flagged.
export async function checkPosDrift({ pool, today, refreshReceipt, fetchRange = fetchExpectedSalesRange, lookbackDays = POS_DRIFT_LOOKBACK_DAYS }) {
  const end = new Date(`${today}T00:00:00Z`);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - lookbackDays);
  // Today's POS is still growing; the cashier screen syncs it when opened.
  const last = new Date(end); last.setUTCDate(last.getUTCDate() - 1);
  const from = isoDate(start); const to = isoDate(last);
  const [branches] = await pool.query("SELECT id, code, clickhouse_branch_id FROM branches WHERE is_active = TRUE AND COALESCE(clickhouse_branch_id, '') <> ''");
  if (!branches.length) return { from, to, checked: 0, changed: [], refreshed: [], failed: [] };
  const current = await fetchRange({ from, to, branches });
  const [receipts] = await pool.query(
    `SELECT dr.id, DATE_FORMAT(dr.receipt_date, '%Y-%m-%d') AS receipt_date, dr.branch_id, b.code AS branch_code,
            dr.status, dr.gross_sales_expected, dr.bill_count, dr.clickhouse_synced_at
     FROM daily_receipts dr JOIN branches b ON b.id = dr.branch_id
     WHERE dr.receipt_date BETWEEN ? AND ? AND dr.branch_id IN (?)`,
    [from, to, branches.map((b) => b.id)]
  );
  const results = findPosDrift(receipts, current);
  for (const r of results) {
    await pool.query(
      'UPDATE daily_receipts SET pos_latest_gross = ?, pos_latest_bill_count = ?, pos_checked_at = NOW() WHERE id = ?',
      [r.latest_gross, r.latest_bill_count, r.receipt_id]
    );
  }
  const changed = results.filter((r) => r.changed);
  const refreshed = []; const failed = [];
  for (const r of changed.filter((item) => item.status !== 'CLOSED')) {
    try {
      await refreshReceipt({ receiptDate: r.receipt_date, branch: branches.find((b) => b.id === r.branch_id) });
      refreshed.push(r);
    } catch (error) {
      failed.push({ ...r, error: String(error?.message || error) });
    }
  }
  return { from, to, checked: results.length, changed, refreshed, failed };
}
