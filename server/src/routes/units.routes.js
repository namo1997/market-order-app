import express from 'express';
import * as unitsController from '../controllers/units.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

router.get('/', unitsController.getAllUnits);

// เฉพาะผู้ดูแลระบบเท่านั้นที่แก้ไขและกู้คืนหน่วยได้
router.post('/', requireAdmin, unitsController.createUnit);
router.post('/:id/restore', requireAdmin, unitsController.restoreUnit);
router.put('/:id', requireAdmin, unitsController.updateUnit);
router.delete('/:id', requireAdmin, unitsController.deleteUnit);

export default router;
