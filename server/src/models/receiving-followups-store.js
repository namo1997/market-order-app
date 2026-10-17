import { createHash } from 'node:crypto';
import { createReceivingError } from '../services/receiving-ocr.service.js';

export const canManageFollowups = user => ['admin', 'super_admin', 'accounting', 'accountant'].includes(user?.role);
export const assertFollowupManager = user => {
  if (!canManageFollowups(user)) throw createReceivingError('FORBIDDEN', 'เฉพาะบัญชีหรือผู้ดูแล');
};
const timestamp = date => date.toISOString().replace('T', ' ').replace('Z', '');
const mapRow = row => ({ ...row, pending_items: JSON.parse(row.pending_items_json),
  pending_items_json: undefined, created_at: `${String(row.created_at).replace(' ', 'T')}Z`,
  updated_at: `${String(row.updated_at).replace(' ', 'T')}Z` });
const select = `SELECT *, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s.%f') AS created_at,
  DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s.%f') AS updated_at FROM receiving_followups`;

// The lock row survives requests; a real InnoDB row lock serializes multiple workers/devices.
// All timestamps are stored explicitly in UTC; API always emits an offset.
export async function saveFollowup(db, { group, actor, note = '', source = 'manual', now = new Date() }) {
  const items = group.items.filter(item => source !== 'overdue' || item.due_status === 'overdue');
  if (!items.length) return null;
  const autoKey = source === 'overdue' ? createHash('sha256').update(JSON.stringify([
    group.branch_id, group.department_id, group.supplier_key, items.map(item => item.order_item_id).sort((a,b) => a-b)
  ])).digest('hex') : null;
  const scopeKey = `${group.branch_id}:${group.department_id}:${group.supplier_key}`;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`INSERT INTO receiving_followup_locks (scope_key) VALUES (?)
      ON DUPLICATE KEY UPDATE scope_key = scope_key`, [scopeKey]);
    await conn.query(`SELECT scope_key FROM receiving_followup_locks WHERE scope_key = ? FOR UPDATE`, [scopeKey]);
    const [recent] = await conn.query(`${select} WHERE branch_id = ? AND department_id = ? AND supplier_key = ?
      AND created_at > ? ORDER BY id DESC LIMIT 1`,
    [group.branch_id, group.department_id, group.supplier_key, timestamp(new Date(now.getTime() - 3600000))]);
    let existing = recent[0];
    if (autoKey) {
      const [automatic] = await conn.query(`${select} WHERE auto_key = ? LIMIT 1`, [autoKey]);
      // Do not lose the automatic marker when a recent manual request already exists.
      existing = automatic[0] || existing;
      if (existing && !automatic.length && !existing.auto_key) {
        await conn.query('UPDATE receiving_followups SET auto_key = ? WHERE id = ?', [autoKey, existing.id]);
      }
    }
    if (existing) { await conn.commit(); return { followup: mapRow(existing), created: false }; }
    const time = timestamp(now);
    const [result] = await conn.query(`INSERT INTO receiving_followups
      (supplier_key,supplier_name,branch_id,department_id,pending_items_json,actor_user_id,actor_name,note,source,auto_key,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [group.supplier_key, group.supplier_name,
      group.branch_id, group.department_id, JSON.stringify(items), actor?.userId || null,
      actor?.userName || 'ระบบ', note, source, autoKey, time, time]);
    const [rows] = await conn.query(`${select} WHERE id = ?`, [result.insertId]);
    await conn.commit();
    return { followup: mapRow(rows[0]), created: true };
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}

export async function listFollowups(db, { user, status = 'open' }) {
  assertFollowupManager(user);
  if (!['open', 'acknowledged', 'resolved', 'pending'].includes(status)) {
    throw createReceivingError('VALIDATION_FAILED', 'สถานะไม่ถูกต้อง');
  }
  const statuses = status === 'pending' ? ['open', 'acknowledged'] : [status];
  const [rows] = await db.query(`${select} WHERE status IN (${statuses.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 200`, statuses);
  const [counts] = await db.query(`SELECT COUNT(*) AS pending_count FROM receiving_followups WHERE status IN ('open','acknowledged')`);
  return { items: rows.map(mapRow), pending_count: Number(counts[0].pending_count),
    notification: { channel: 'in_app', version: 1 } };
}
export async function updateFollowup(db, { user, id, status, now = new Date() }) {
  assertFollowupManager(user);
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0 || !['acknowledged', 'resolved'].includes(status)) {
    throw createReceivingError('VALIDATION_FAILED', 'ข้อมูลไม่ถูกต้อง');
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(`${select} WHERE id = ? FOR UPDATE`, [Number(id)]);
    if (!rows.length) throw createReceivingError('NOT_FOUND', 'ไม่พบเรื่องตามของ');
    const row = rows[0];
    if (row.status === 'resolved' && status !== 'resolved') {
      throw createReceivingError('NOT_DRAFT', 'เรื่องนี้ปิดแล้ว');
    }
    if (row.status !== status) await conn.query(`UPDATE receiving_followups
      SET status = ?, updated_at = ?, updated_by_user_id = ? WHERE id = ?`,
    [status, timestamp(now), user.id, row.id]);
    await conn.commit();
    return { id: Number(row.id), status };
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}
