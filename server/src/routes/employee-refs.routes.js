import express from 'express';
import * as controller from '../controllers/employee-ref.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { verifyGeneralPurchaseSession } from './general-purchase-auth.routes.js';

const router = express.Router();

// รายชื่อพนักงาน: แอดมินระบบหลัก หรือ session หัวหน้าของระบบ PR/PO (ใช้เลือกผู้ขอในหน้าสร้าง PR)
const requireAdminOrGeneralPurchaseHead = (req, res, next) => {
  const hasMainToken = String(req.headers.authorization || '').startsWith('Bearer ');
  const hasGeneralPurchaseToken = Boolean(String(req.headers['x-general-purchase-token'] || '').trim());

  if (!hasMainToken && hasGeneralPurchaseToken) {
    return verifyGeneralPurchaseSession(req, res, () => {
      if (req.generalPurchaseAccess?.mode !== 'employee_head') {
        return res.status(403).json({ success: false, message: 'Access denied.' });
      }
      next();
    });
  }

  return authenticate(req, res, () => requireAdmin(req, res, next));
};

router.get('/', requireAdminOrGeneralPurchaseHead, controller.listEmployeeRefs);
router.get('/stats', authenticate, requireAdmin, controller.getEmployeeRefStats);
router.post('/sync', authenticate, requireAdmin, controller.syncEmployeeRefs);

export default router;
