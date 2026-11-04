import express from 'express';
import * as controller from '../controllers/employee-ref.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { verifyGeneralPurchaseSession } from './general-purchase-auth.routes.js';

const router = express.Router();

const requireReader = (req, res, next) => req.headers.authorization
  ? authenticate(req, res, next)
  : verifyGeneralPurchaseSession(req, res, next);
router.get('/', requireReader, controller.listEmployeeRefs);
router.get('/stats', requireReader, controller.getEmployeeRefStats);
router.post('/sync', authenticate, requireAdmin, controller.syncEmployeeRefs);

export default router;
