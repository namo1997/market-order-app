import express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import pool from '../config/database.js';
import { exportFilters, listApDocuments } from '../models/receiving-ap-export.model.js';

// Hash both inputs to equal-length buffers before constant-time comparison.
// Dedicated service authorization: employee JWTs grant no export access.
export function createReceivingApExportRouter({ db = pool, env = () => process.env, now = () => new Date() } = {}) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  router.use((req, res, next) => {
    const expected = env().RECEIVING_EXPORT_TOKEN;
    if (typeof expected !== 'string' || !expected.trim()) {
      return res.status(503).json({ success: false, code: 'EXPORT_DISABLED', message: 'ยังไม่เปิดการส่งออกใบรับของ' });
    }
    const header = req.headers.authorization;
    const match = typeof header === 'string' && /^Bearer ([^\s]+)$/i.exec(header);
    const digest = value => createHash('sha256').update(value).digest();
    const valid = timingSafeEqual(digest(match ? match[1] : ''), digest(expected));
    if (!match || !valid) return res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'ไม่มีสิทธิ์ส่งออกใบรับของ' });
    next();
  });
  router.get('/ap/v1/documents', async (req, res) => {
    try { return res.json(await listApDocuments(db, exportFilters(req.query), now())); }
    catch (error) {
      if (error.code === 'VALIDATION_FAILED') return res.status(422).json({ success: false, code: error.code, message: 'พารามิเตอร์ส่งออกไม่ถูกต้อง' });
      const notReady = ['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(error.code);
      return res.status(notReady ? 503 : 500).json({ success: false,
        code: notReady ? 'RECEIVING_NOT_READY' : 'EXPORT_FAILED', message: 'ไม่สามารถส่งออกใบรับของได้' });
    }
  });
  return router;
}
export default createReceivingApExportRouter();
