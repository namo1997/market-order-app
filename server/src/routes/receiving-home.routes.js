import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { getSetting, setSetting } from '../models/settings.model.js';

// Owner 2026-10-23: version one hides the order queue from staff. The home mode is one system setting the
// administrator can switch at any time: 'new_first' (staff press "รับของใหม่"; the queue runs in the background
// and shows only to administrators) or 'queue' (staff see the queue cards as before).
export const HOME_MODES = ['queue', 'new_first'];
export const HOME_MODE_KEY = 'receiving_home_mode';
export const DEFAULT_HOME_MODE = 'new_first';
export const normalizeHomeMode = value => HOME_MODES.includes(value) ? value : DEFAULT_HOME_MODE;

const router = express.Router();
router.use(authenticate);
router.use(express.json({ limit: '16kb' }));

router.get('/mode', async (req, res, next) => {
  try { res.json({ success: true, data: { mode: normalizeHomeMode(await getSetting(HOME_MODE_KEY, DEFAULT_HOME_MODE)) } }); }
  catch (error) { next(error); }
});

router.put('/mode', async (req, res, next) => {
  try {
    if (!['admin', 'super_admin'].includes(req.user?.role)) return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'เฉพาะผู้ดูแล' });
    const mode = req.body?.mode;
    if (!HOME_MODES.includes(mode)) return res.status(422).json({ success: false, code: 'VALIDATION_FAILED', message: 'โหมดหน้าแรกไม่ถูกต้อง' });
    await setSetting(HOME_MODE_KEY, mode);
    return res.json({ success: true, data: { mode } });
  } catch (error) { return next(error); }
});

export default router;
