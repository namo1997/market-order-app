import express from 'express';
import * as suppliersController from '../controllers/suppliers.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

router.get('/', suppliersController.getAllSuppliers);

// Admin only
router.post('/', requireAdmin, suppliersController.createSupplier);
router.put('/:id', requireAdmin, suppliersController.updateSupplier);
router.delete('/:id', requireAdmin, suppliersController.deleteSupplier);

export default router;
