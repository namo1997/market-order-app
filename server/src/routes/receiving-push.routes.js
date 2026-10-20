import express from 'express';
import pool from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { currentPushUser, registerDevice } from '../services/receiving-push.js';
import { ensurePushTables } from '../models/receiving-push-schema.js';
import { createFcm } from '../services/receiving-fcm.js';
import { createReceivingError } from '../services/receiving-ocr.service.js';
const router = express.Router();
// This boundary must never forward SQL/provider/parser errors containing device tokens.
const safeError = (error, res) => {
  const known = { FORBIDDEN: 403, VALIDATION_FAILED: 422, NOT_FOUND: 404 };
  const status = error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 422 :
    error.code === 'ER_NO_SUCH_TABLE' ? 503 : known[error.code] || 500;
  const code = status === 413 ? 'REQUEST_TOO_LARGE' : status === 503 ? 'RECEIVING_NOT_READY' :
    status === 422 ? 'VALIDATION_FAILED' : status === 500 ? 'INTERNAL_ERROR' : error.code;
  return res.status(status).json({ success: false, code, message: 'ไม่สามารถดำเนินการแจ้งเตือนได้' });
};
const endpoint = action => async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try { return res.json({ success: true, data: await action(req) }); }
  catch (error) { return safeError(error, res); }
};
router.use(authenticate);
router.use(express.json({ limit: '8kb' }));
router.get('/capabilities', endpoint(async req => {
  await currentPushUser(pool, req.user.id);
  return { fcm: createFcm().configured() };
}));
for (const method of ['post', 'delete']) router[method]('/devices', endpoint(async req => {
  const user = await currentPushUser(pool, req.user.id);
  await ensurePushTables(pool);
  return registerDevice(pool, user, req.body?.token, method === 'delete');
}));
router.get('/followups/:id', endpoint(async req => {
  const user = await currentPushUser(pool, req.user.id);
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw createReceivingError('VALIDATION_FAILED', 'รหัสเรื่องไม่ถูกต้อง');
  const [rows] = await pool.query('SELECT id,supplier_name,note,pending_items_json,status,branch_id FROM receiving_followups WHERE id=? AND branch_id=?', [id, user.branch_id]);
  if (!rows.length) throw createReceivingError('NOT_FOUND', 'ไม่พบเรื่องตามของ');
  const { pending_items_json, ...row } = rows[0];
  return { ...row, pending_items: JSON.parse(pending_items_json) };
}));
router.use((error, req, res, next) => {
  return safeError(error, res);
});
export default router;
