import crypto from 'node:crypto';
import { getPool } from '../db.js';
import { parseJsonObject, resolveAgentConfig, runStructuredAgent } from './openai.js';
import { traceAgentRun } from './trace.js';

const SHADOW_INSTRUCTIONS = `You are a shadow reviewer for a Thai finance operations application.
You receive a frozen snapshot captured before a human commits an action.
Predict the safest next action. Never execute tools, never change data, and never invent missing facts.
If the proposed action is supported, copy the snapshot's exact action_key into predicted_action.
Otherwise use "hold_for_review"; if evidence is insufficient use "insufficient_evidence".
If the proposed action can send a message, close a period, delete evidence, or change money, add a risk flag.`;

const SHADOW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['predicted_action', 'confidence', 'rationale', 'risk_flags'],
  properties: {
    predicted_action: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    rationale: { type: 'string' },
    risk_flags: { type: 'array', items: { type: 'string' } }
  }
};

const config = resolveAgentConfig({
  prefix: 'CASHFLOW_SHADOW',
  defaultModel: 'gpt-5.4-mini',
  defaultEffort: 'low',
  defaultMaxOutputTokens: 2200
});

const json = (value) => JSON.stringify(value ?? null);
const parseJson = (value, fallback = null) => {
  if (value == null || typeof value === 'object') return value ?? fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};

const SENSITIVE_KEY = /(password|secret|token|authorization|api[_-]?key|account[_-]?(number|no)?|promptpay|เลขบัญชี)/i;
export const redactForShadow = (value, key = '', depth = 0) => {
  if (depth > 8) return '[MAX_DEPTH]';
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => redactForShadow(entry, key, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactForShadow(entryValue, entryKey, depth + 1)]));
  }
  if (typeof value === 'string') return value.replace(/sk-[A-Za-z0-9_-]{16,}/g, '[REDACTED_API_KEY]').slice(0, 4000);
  return value;
};

export const createDecisionContext = async ({ user, actionKey, entityType, entityId, pageUrl, contextSnapshot }) => {
  const id = crypto.randomUUID();
  const shadowId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const frozen = {
    captured_at: new Date().toISOString(),
    action_key: String(actionKey || '').trim(),
    entity_type: String(entityType || '').trim() || null,
    entity_id: entityId == null ? null : String(entityId),
    page_url: String(pageUrl || '').slice(0, 500) || null,
    context: contextSnapshot && typeof contextSnapshot === 'object' ? contextSnapshot : {}
  };
  const shadowFrozen = { ...frozen, context: redactForShadow(frozen.context) };
  await getPool().query(
    `INSERT INTO decision_events
       (id, action_key, entity_type, entity_id, actor_user_id, actor_role, page_url, context_snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, frozen.action_key, frozen.entity_type, frozen.entity_id, user?.id || null, user?.role || null, frozen.page_url, json(frozen)]
  );
  await getPool().query(
    `INSERT INTO shadow_predictions (id, decision_id, run_id, input_snapshot)
     VALUES (?, ?, ?, ?)`,
    [shadowId, id, runId, json(shadowFrozen)]
  );
  setImmediate(() => runShadowPrediction({ decisionId: id, runId, frozen: shadowFrozen }).catch(() => {}));
  return { id, shadow_run_id: runId, shadow_status: 'queued' };
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

const runShadowPrediction = async ({ decisionId, runId, frozen }) => {
  const pool = getPool();
  const started = new Date();
  await pool.query(
    `UPDATE shadow_predictions SET status = ?, model = ?, started_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE decision_id = ?`,
    [config.enabled ? 'running' : 'skipped', config.model, started, decisionId]
  );
  if (!config.enabled) {
    await pool.query(
      `UPDATE shadow_predictions SET error_message = ?, completed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE decision_id = ?`,
      ['CASHFLOW_SHADOW_API_KEY is not configured', new Date(), decisionId]
    );
    return;
  }
  try {
    const response = await runStructuredAgent({
      config,
      instructions: SHADOW_INSTRUCTIONS,
      input: JSON.stringify(frozen),
      schema: SHADOW_SCHEMA,
      schemaName: 'shadow_decision_prediction',
      maxToolRounds: 0
    });
    const result = response.result || parseJsonObject('{}');
    await pool.query(
      `UPDATE shadow_predictions
       SET status = 'completed', predicted_action = ?, confidence = ?, rationale = ?, risk_flags = ?,
           usage_payload = ?, completed_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE decision_id = ?`,
      [result.predicted_action, Number(result.confidence || 0), result.rationale, json(result.risk_flags || []), json(response.usage), new Date(), decisionId]
    );
    await comparePrediction(decisionId, frozen.action_key);
    traceAgentRun({ agent: 'shadow-decision', run_id: runId, decision_id: decisionId, status: 'completed', summary: result.rationale });
  } catch (error) {
    await pool.query(
      `UPDATE shadow_predictions SET status = 'failed', error_message = ?, completed_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE decision_id = ?`,
      [String(error?.message || error).slice(0, 2000), new Date(), decisionId]
    );
    traceAgentRun({ agent: 'shadow-decision', run_id: runId, decision_id: decisionId, status: 'failed', error: error?.message || error });
  }
};

const comparePrediction = async (decisionId, actionKey) => {
  const [decisionRows] = await getPool().query(`SELECT status FROM decision_events WHERE id = ? LIMIT 1`, [decisionId]);
  if (!['committed', 'completed', 'failed'].includes(String(decisionRows[0]?.status || ''))) return;
  const [rows] = await getPool().query(
    `SELECT predicted_action, status, risk_flags FROM shadow_predictions WHERE decision_id = ?`,
    [decisionId]
  );
  const shadow = rows[0];
  if (!shadow || shadow.status !== 'completed') return;
  const predicted = String(shadow.predicted_action || '').trim();
  const actual = String(actionKey || '').trim();
  const comparison = predicted === 'insufficient_evidence'
    ? 'insufficient'
    : predicted === actual ? 'agree' : 'disagree';
  await getPool().query(
    `UPDATE shadow_predictions SET comparison_status = ?, updated_at = CURRENT_TIMESTAMP WHERE decision_id = ?`,
    [comparison, decisionId]
  );
  const risks = parseJson(shadow.risk_flags, []);
  if (comparison === 'disagree' || risks.length > 0) {
    const question = comparison === 'disagree'
      ? `Shadow AI เสนอ “${predicted}” แต่ผู้ใช้เลือก “${actual}” มีหลักฐานหรือบริบทอะไรที่ AI ยังไม่เห็น?`
      : `รายการนี้มีความเสี่ยง ${risks.join(', ')} โปรดระบุหลักฐานสำคัญที่ใช้ยืนยันเพิ่มเติม`;
    await getPool().query(
      `INSERT INTO decision_followups (id, decision_id, question)
       SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM decision_followups WHERE decision_id = ? AND status = 'open')`,
      [crypto.randomUUID(), decisionId, question, decisionId]
    );
  }
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
      await comparePrediction(decisionId, actionKey).catch(() => {});
    });
    return next();
  } catch (error) {
    return next(error);
  }
};

export const listDecisions = async ({ limit = 100, actionKey = '', comparison = '' } = {}) => {
  const where = [];
  const values = [];
  if (actionKey) { where.push('d.action_key = ?'); values.push(actionKey); }
  if (comparison) { where.push('s.comparison_status = ?'); values.push(comparison); }
  values.push(Math.max(1, Math.min(500, Number(limit) || 100)));
  const [rows] = await getPool().query(
    `SELECT d.*, s.run_id, s.status AS shadow_status, s.model AS shadow_model,
            s.predicted_action, s.confidence, s.rationale, s.risk_flags, s.comparison_status,
            f.id AS followup_id, f.question AS followup_question, f.answer AS followup_answer, f.status AS followup_status
     FROM decision_events d
     LEFT JOIN shadow_predictions s ON s.decision_id = d.id
     LEFT JOIN decision_followups f ON f.decision_id = d.id AND f.status = 'open'
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY d.created_at DESC LIMIT ?`,
    values
  );
  return rows.map((row) => ({ ...row, context_snapshot: parseJson(row.context_snapshot, {}), risk_flags: parseJson(row.risk_flags, []) }));
};

export const answerDecisionFollowup = async ({ decisionId, answer, userId }) => {
  const [rows] = await getPool().query(`SELECT id FROM decision_followups WHERE decision_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`, [decisionId]);
  const id = rows[0]?.id || crypto.randomUUID();
  if (!rows[0]) {
    await getPool().query(
      `INSERT INTO decision_followups (id, decision_id, question, answer, status, answered_by, answered_at)
       VALUES (?, ?, ?, ?, 'answered', ?, NOW())`,
      [id, decisionId, 'เหตุผลเพิ่มเติมจากผู้ใช้งาน', answer, userId || null]
    );
  } else {
    await getPool().query(
      `UPDATE decision_followups SET answer = ?, status = 'answered', answered_by = ?, answered_at = NOW(), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [answer, userId || null, id]
    );
  }
  return { id, decision_id: decisionId, status: 'answered' };
};

export const getAgentHealth = async () => {
  const [[totals], [recent], [agents]] = await Promise.all([
    getPool().query(`SELECT COUNT(*) total, SUM(status='completed') completed, SUM(status='failed') failed,
                            SUM(status='cancelled') cancelled FROM decision_events`),
    getPool().query(`SELECT SUM(status='completed') completed, SUM(status='failed') failed, SUM(status='skipped') skipped,
                            SUM(comparison_status='agree') agreed, SUM(comparison_status='disagree') disagreed
                     FROM shadow_predictions WHERE created_at >= NOW() - INTERVAL 7 DAY`),
    getPool().query(`SELECT run_id, decision_id, status, model, predicted_action, confidence, comparison_status, error_message, created_at, completed_at
                     FROM shadow_predictions ORDER BY created_at DESC LIMIT 30`)
  ]);
  return {
    service: 'general-cashflow',
    shadow_mode: true,
    writes_business_data: false,
    model: config.model,
    configured: config.enabled,
    decisions: totals[0] || {},
    last_7_days: recent[0] || {},
    recent_runs: agents
  };
};

export const getAgentRun = async (runId) => {
  const [rows] = await getPool().query(
    `SELECT s.*, d.action_key, d.entity_type, d.entity_id, d.reason_code, d.reason_text, d.status AS decision_status
     FROM shadow_predictions s JOIN decision_events d ON d.id = s.decision_id WHERE s.run_id = ? LIMIT 1`,
    [runId]
  );
  return rows[0] || null;
};
