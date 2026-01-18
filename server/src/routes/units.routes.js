import express from 'express';
import * as unitsController from '../controllers/units.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

router.get('/', unitsController.getAllUnits);

// Admin only for modification
router.post('/', requireAdmin, unitsController.createUnit);
router.put('/:id', requireAdmin, unitsController.updateUnit);
router.delete('/:id', requireAdmin, unitsController.deleteUnit);

export default router;
