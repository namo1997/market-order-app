import express from 'express';
import { loadReceiving, receivingConfigured } from './receiving.js';
import { createReceivingSync } from './receivingSync.js';
import { monthRange } from './domain.js';
import { buildApReport, loadApBundle } from './report.js';
export function createApRouter({ getPool, authenticate, requirePermission, receivingConfig = {}, fetchImpl, logAudit, requireHumanDecision, decisionReasonRequired = false }) {
  const router = express.Router();
  // Existing financial permission is admin-only. No new identity or role bypass.
  router.use(authenticate, requirePermission('report:pnl'));
  router.get('/receiving/status', (req, res) => res.json({ success: true, data: { configured: receivingConfigured(receivingConfig) } }));
  router.get('/receiving/documents', async (req, res) => {
    let connection;
    try {
      monthRange(req.query.month);
      if (req.query.branch != null && (typeof req.query.branch !== 'string' || req.query.branch.length > 20)) throw Object.assign(new Error('INVALID_BRANCH'), { statusCode: 422 });
      connection = await getPool().getConnection();
      res.json({ success: true, data: await loadReceiving(connection, { month: req.query.month, branch: req.query.branch || '', config: receivingConfig }) });
    } catch (error) {
      const code = ['INVALID_MONTH','INVALID_BRANCH'].includes(error.message) ? error.message : 'RECEIVING_UNAVAILABLE';
      res.status(code === 'RECEIVING_UNAVAILABLE' ? 503 : 422).json({ success: false, code });
    } finally { connection?.release(); }
  });
  router.post('/receiving/sync', (req, res, next) => {
    if (!receivingConfigured(receivingConfig)) return res.status(503).json({ success: false, code: 'RECEIVING_DISABLED' });
    if (!decisionReasonRequired) return next();
    if (!requireHumanDecision) return res.status(503).json({ success: false, code: 'RECEIVING_DECISION_REQUIRED' });
    return requireHumanDecision('cashflow.post.ap.receiving.sync')(req, res, next);
  }, async (req, res) => {
    try {
      const sync = createReceivingSync({ getPool, config: receivingConfig, fetchImpl, audit: logAudit });
      res.json({ success: true, data: await sync({ actor: req.user }) });
    } catch (error) {
      const code = /^RECEIVING_[A-Z_]+$/.test(error.message) ? error.message : 'RECEIVING_SYNC_FAILED';
      res.status(error.statusCode || 503).json({ success: false, code });
    }
  });
  router.use((req, res, next) => ['GET', 'HEAD'].includes(req.method) ? next() : res.status(405).json({ success: false, code: 'AP_READ_ONLY' }));
  router.get('/report', async (req, res) => {
    let connection;
    try {
      monthRange(req.query.month);
      if (req.query.branch != null && typeof req.query.branch !== 'string') throw Object.assign(new Error('INVALID_BRANCH'), { statusCode: 422 });
      connection = await getPool().getConnection();
      const report = buildApReport(await loadApBundle(connection, req.query.month), { month: req.query.month, branch: req.query.branch || '' });
      res.json({ success: true, data: report });
    } catch (error) {
      const publicCode = ['INVALID_MONTH', 'INVALID_BRANCH', 'AP_NOT_IMPORTED'].includes(error.message) ? error.message : 'AP_UNAVAILABLE';
      res.status(publicCode === 'AP_UNAVAILABLE' ? 503 : error.statusCode || 422).json({ success: false, code: publicCode, message: publicCode });
    } finally { connection?.release(); }
  });
  return router;
}
