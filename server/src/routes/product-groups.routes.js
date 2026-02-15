import express from 'express';
import * as suppliersController from '../controllers/suppliers.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

router.get('/', suppliersController.getAllProductGroups);

router.post('/', requireAdmin, suppliersController.createProductGroup);
router.put('/:id', requireAdmin, suppliersController.updateProductGroup);
router.delete('/:id', requireAdmin, suppliersController.deleteProductGroup);

export default router;
