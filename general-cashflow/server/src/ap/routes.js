import express from 'express';
import { monthRange } from './domain.js';
import { buildApReport, loadApBundle } from './report.js';
export function createApRouter({ getPool, authenticate, requirePermission }) {
  const router = express.Router();
  // Existing financial permission is admin-only. No new identity or role bypass.
  router.use(authenticate, requirePermission('report:pnl'));
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
