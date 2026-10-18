import { createHash } from 'node:crypto';
import { assertFollowupManager } from '../models/receiving-followups-store.js';
import { createReceivingError } from './receiving-ocr.service.js';

export const tokenHash = token => createHash('sha256').update(token).digest('hex');
const roles = ['admin', 'super_admin', 'accounting', 'accountant'];
export async function currentPushUser(db, id) {
  const [rows] = await db.query(`SELECT u.id,u.role,d.branch_id FROM users u
    JOIN departments d ON d.id=u.department_id JOIN branches b ON b.id=d.branch_id
    WHERE u.id=? AND u.is_active=true AND d.is_active=true AND b.is_active=true LIMIT 1`, [id]);
  const user = rows[0];
  assertFollowupManager(user);
  return user;
}
export async function registerDevice(db, user, token, remove = false) {
  assertFollowupManager(user);
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096 || !/^[A-Za-z0-9_:.-]+$/.test(token)) {
    throw createReceivingError('VALIDATION_FAILED', 'ข้อมูลอุปกรณ์ไม่ถูกต้อง');
  }
  const hash = tokenHash(token);
  if (remove) await db.query('DELETE FROM receiving_push_devices WHERE token_hash=? AND user_id=?', [hash, user.id]);
  else await db.query(`INSERT INTO receiving_push_devices (token_hash,token,user_id,updated_at) VALUES (?,?,?,UTC_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE token=VALUES(token),user_id=VALUES(user_id),updated_at=VALUES(updated_at)`, [hash, token, user.id]);
  return { registered: !remove };
}

// An atomic lease plus a durable PK deduplicates across restarts and server replicas.
// Delivery is at-least-once if the process dies after FCM accepts; Android also deduplicates.
export function createPushDispatcher({ db, fcm, discoverOverdue = async () => {} }) {
  let busy = false;
  return { async tick() {
    if (busy) return;
    busy = true;
    try {
      await discoverOverdue(); // Also generates overdue followups for keyless polling.
      if (!fcm.configured()) return;
      const [jobs] = await db.query(`SELECT f.id,f.branch_id,p.token_hash,p.token,p.user_id
        FROM receiving_followups f JOIN receiving_push_devices p
        JOIN users u ON u.id=p.user_id JOIN departments d ON d.id=u.department_id
        JOIN branches b ON b.id=d.branch_id
        LEFT JOIN receiving_push_deliveries x ON x.followup_id=f.id AND x.token_hash=p.token_hash
        WHERE f.status='open' AND d.branch_id=f.branch_id AND d.is_active=true AND b.is_active=true
        AND u.is_active=true AND u.role IN (?,?,?,?) AND p.updated_at > UTC_TIMESTAMP(3) - INTERVAL 30 DAY
        AND (x.followup_id IS NULL OR (x.state IN ('pending','sending') AND x.attempts < 3 AND x.next_at<=UTC_TIMESTAMP(3)))
        ORDER BY f.id ASC LIMIT 100`, roles);
      for (const job of jobs) {
        await db.query(`INSERT IGNORE INTO receiving_push_deliveries (followup_id,token_hash,next_at)
          VALUES (?,?,UTC_TIMESTAMP(3))`, [job.id, job.token_hash]);
        const [claim] = await db.query(`UPDATE receiving_push_deliveries SET state='sending',attempts=attempts+1,
          next_at=UTC_TIMESTAMP(3)+INTERVAL 2 MINUTE WHERE followup_id=? AND token_hash=?
          AND state IN ('pending','sending') AND attempts<3 AND next_at<=UTC_TIMESTAMP(3)`, [job.id, job.token_hash]);
        if (!claim.affectedRows) continue;
        // Recheck recipient ownership, role, branch, and open status after claiming.
        const [valid] = await db.query(`SELECT f.id FROM receiving_followups f JOIN receiving_push_devices p
          JOIN users u ON u.id=p.user_id JOIN departments d ON d.id=u.department_id
          JOIN branches b ON b.id=d.branch_id
          WHERE f.id=? AND p.token_hash=? AND p.user_id=? AND f.status='open'
          AND d.branch_id=f.branch_id AND u.is_active=true AND d.is_active=true AND b.is_active=true AND u.role IN (?,?,?,?)`, [job.id, job.token_hash, job.user_id, ...roles]);
        const result = valid.length ? await fcm.send(job.token, { kind: 'followup', followup_id: String(job.id),
          user_id: String(job.user_id), branch_id: String(job.branch_id), channel: 'receiving_urgent_question003_v1' }) : {};
        const state = result.sent ? 'sent' : result.retry || result.disabled ? 'pending' : 'failed';
        await db.query(`UPDATE receiving_push_deliveries SET state=? WHERE followup_id=? AND token_hash=?`, [state, job.id, job.token_hash]);
        if (result.invalid) await db.query('DELETE FROM receiving_push_devices WHERE token_hash=? AND token=?', [job.token_hash, job.token]);
      }
    } finally { busy = false; }
  } };
}
