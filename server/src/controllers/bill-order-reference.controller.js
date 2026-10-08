import { createHash, timingSafeEqual } from 'node:crypto';

const allowedBranches = value => {
  const entries = String(value || '').split(',').map(v => v.trim()).filter(Boolean);
  if (!entries.length || entries.some(v => !/^[1-9]\d*$/.test(v) || !Number.isSafeInteger(Number(v)))) return null;
  return new Set(entries.map(Number));
};
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const digest = value => createHash('sha256').update(value).digest();

export const createBillOrderReferenceController = ({ model, env = process.env }) => ({
  authenticate(req, res, next) {
    const expected = String(env.BILL_ORDER_REFERENCE_TOKEN || '').trim();
    const branches = allowedBranches(env.BILL_ORDER_REFERENCE_ALLOWED_BRANCH_IDS);
    if (!expected || !branches) return res.status(503).json({ success: false, error: 'bill_order_reference_disabled' });
    const supplied = req.get('x-bill-order-reference-token');
    if (typeof supplied !== 'string' || !timingSafeEqual(digest(expected), digest(supplied))) {
      return res.status(401).json({ success: false, error: 'unauthorized' });
    }
    req.billOrderAllowedBranches = branches;
    next();
  },
  async listLines(req, res) {
    const { date, branch_id } = req.query;
    if (Object.keys(req.query).some(key => !['date', 'branch_id'].includes(key)) || !validDate(date)
      || typeof branch_id !== 'string' || !/^[1-9]\d*$/.test(branch_id) || !Number.isSafeInteger(Number(branch_id))) {
      return res.status(400).json({ success: false, error: 'invalid_scope' });
    }
    const branchId = Number(branch_id);
    if (!req.billOrderAllowedBranches?.has(branchId)) return res.status(403).json({ success: false, error: 'branch_not_allowed' });
    try {
      const data = await model.listLines({ date, branch_id: branchId });
      return res.json({ success: true, data });
    } catch {
      // Schema drift is an unavailable reference, never a reason to run DDL from this read.
      return res.status(503).json({ success: false, error: 'bill_order_reference_unavailable' });
    }
  }
});
