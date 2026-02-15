import express from 'express';
import * as supplierMastersController from '../controllers/supplier-masters.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

router.get('/', supplierMastersController.getAllSupplierMasters);
router.post('/', requireAdmin, supplierMastersController.createSupplierMaster);
router.put('/:id', requireAdmin, supplierMastersController.updateSupplierMaster);
router.delete('/:id', requireAdmin, supplierMastersController.deleteSupplierMaster);

export default router;
