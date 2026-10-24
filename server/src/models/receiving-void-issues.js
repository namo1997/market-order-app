// Bug hunt 2026-10-24 (pilot, real NewStar bill): voiding a confirmed receipt left its auto-opened shortage
// issue open, so accounting would chase the shop for a receipt that no longer counts, its overdue reminder
// still fired, and a redo of the receipt opened a second issue for the same goods.
// Runs inside the void transaction (connection passed in; no pool import).
import { stamp } from './receiving-issues-policy.js';

export async function settleVoidedReceiptIssues(conn, { docId, reason, actorUserId = null, now = new Date() }) {
  const [rows] = await conn.query(
    `SELECT id, status, auto_key FROM receiving_issues
     WHERE document_id = ? AND status IN ('open','waiting_supplier') ORDER BY id FOR UPDATE`, [docId]);
  const settled = { cancelled: [], kept: [] };
  const at = stamp(now);
  const note = `ใบรับ #${docId} ถูกยกเลิก: ${reason}`.slice(0, 1000);
  for (const row of rows || []) {
    const [proof] = await conn.query('SELECT id FROM receiving_issue_evidence WHERE issue_id = ? LIMIT 1', [row.id]);
    // Only what the system opened by itself and nobody has worked on yet is withdrawn. Anything with evidence,
    // already with the shop (waiting_supplier) or opened by a person stays open for accounting to decide.
    if (row.auto_key && row.status === 'open' && !proof.length) {
      await conn.query(`UPDATE receiving_issues SET status = 'cancelled', version = version + 1, updated_at = ?, closed_at = ? WHERE id = ?`,
        [at, at, row.id]);
      await conn.query(`UPDATE receiving_followups f JOIN receiving_issue_reminders r ON r.followup_id = f.id
        SET f.status = 'resolved', f.updated_at = ? WHERE r.issue_id = ? AND f.status <> 'resolved'`, [at, row.id]);
      await conn.query('INSERT INTO receiving_issue_history (issue_id,action,actor_user_id,details_json,created_at) VALUES (?,?,?,?,?)',
        [row.id, 'updated', actorUserId, JSON.stringify({ from: row.status, to: 'cancelled', note }), at]);
      settled.cancelled.push(Number(row.id));
    } else {
      await conn.query('INSERT INTO receiving_issue_history (issue_id,action,actor_user_id,details_json,created_at) VALUES (?,?,?,?,?)',
        [row.id, 'document_voided', actorUserId, JSON.stringify({ note: `${note} · ตรวจเรื่องนี้ก่อนปิด` }), at]);
      settled.kept.push(Number(row.id));
    }
  }
  return settled;
}
