import crypto from 'node:crypto';
import { getPool } from '../db.js';

const json = (value) => JSON.stringify(value ?? null);

// Keep a durable audit record for financial mutations. This is deliberately
// local-only: no model, background job, or external service receives it.
export const createDecisionContext = async ({ user, actionKey, entityType, entityId, pageUrl, contextSnapshot }) => {
  const id = crypto.randomUUID();
  const frozen = {
    captured_at: new Date().toISOString(),
    action_key: String(actionKey || '').trim(),
    entity_type: String(entityType || '').trim() || null,
    entity_id: entityId == null ? null : String(entityId),
    page_url: String(pageUrl || '').slice(0, 500) || null,
    context: contextSnapshot && typeof contextSnapshot === 'object' ? contextSnapshot : {}
  };
  await getPool().query(
    `INSERT INTO decision_events
       (id, action_key, entity_type, entity_id, actor_user_id, actor_role, page_url, context_snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, frozen.action_key, frozen.entity_type, frozen.entity_id, user?.id || null, user?.role || null, frozen.page_url, json(frozen)]
  );
  return { id, status: 'created' };
};

export const cancelDecision = async ({ decisionId, userId } = {}) => {
  const [result] = await getPool().query(
    `UPDATE decision_events
     SET status = 'cancelled', result_summary = ?, completed_at = NOW(), updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND actor_user_id = ? AND status = 'created'`,
    [json({ cancelled_before_commit: true }), decisionId, userId]
  );
  return { id: decisionId, cancelled: Number(result.affectedRows || 0) > 0 };
};

export const requireHumanDecision = (actionKey) => async (req, res, next) => {
  try {
    const decisionId = String(req.headers['x-decision-id'] || req.body?.decision_id || '').trim();
    const reasonCode = String(req.headers['x-decision-reason-code'] || req.body?.reason_code || '').trim();
    const encodedReasonText = String(req.headers['x-decision-reason-text'] || req.body?.reason_text || '').trim();
    let reasonText = encodedReasonText;
    try { reasonText = decodeURIComponent(encodedReasonText); } catch {}
    if (!decisionId || !reasonCode || (reasonCode === 'other' && !reasonText)) {
      return res.status(422).json({
        success: false,
        message: 'ต้องระบุเหตุผลก่อนบันทึกการตัดสินใจ',
        details: { code: 'decision_reason_required', action_key: actionKey }
      });
    }
    const [rows] = await getPool().query(
      `SELECT id, actor_user_id, status FROM decision_events WHERE id = ? LIMIT 1`,
      [decisionId]
    );
    const decision = rows[0];
    if (!decision || (decision.actor_user_id && Number(decision.actor_user_id) !== Number(req.user?.id))) {
      return res.status(409).json({ success: false, message: 'decision_id ไม่ถูกต้องหรือไม่ใช่ของผู้ใช้นี้' });
    }
    if (!['created', 'committed'].includes(decision.status)) {
      return res.status(409).json({ success: false, message: 'decision_id นี้ถูกใช้ไปแล้ว' });
    }
    await getPool().query(
      `UPDATE decision_events
       SET action_key = ?, route = ?, method = ?, reason_code = ?, reason_text = ?, request_payload = ?,
           status = 'committed', committed_at = NOW(), updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [actionKey, req.originalUrl, req.method, reasonCode, reasonText || null, json(req.body || {}), decisionId]
    );
    req.decisionId = decisionId;
    res.on('finish', async () => {
      const ok = res.statusCode < 400;
      await getPool().query(
        `UPDATE decision_events SET status = ?, result_summary = ?, completed_at = NOW(), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [ok ? 'completed' : 'failed', json({ http_status: res.statusCode }), decisionId]
      ).catch(() => {});
    });
    return next();
  } catch (error) {
    return next(error);
  }
};
