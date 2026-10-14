import express from 'express';
import * as productGroupsController from '../controllers/suppliers.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

router.get('/', productGroupsController.getAllProductGroups);

router.post('/', requireAdmin, productGroupsController.createProductGroup);
router.put('/:id', requireAdmin, productGroupsController.updateProductGroup);
router.delete('/:id', requireAdmin, productGroupsController.deleteProductGroup);

export default router;
