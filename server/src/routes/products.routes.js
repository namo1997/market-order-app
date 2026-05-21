import express from 'express';
import * as productsController from '../controllers/products.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// ทุก routes ต้อง authenticate
router.use(authenticate);

// Products
router.get('/', productsController.getProducts);

// Meta
router.get('/meta/suppliers', productsController.getSuppliers);
router.get('/meta/product-groups', productsController.getProductGroups);
router.get('/meta/supplier-masters', productsController.getSupplierMasters);
router.get('/meta/units', productsController.getUnits);

router.put(
  '/:id/supplier-masters/:supplierMasterId/unit-config',
  requireAdmin,
  productsController.updateProductSupplierUnitConfig
);
router.post(
  '/:id/force-latest-price-from-default',
  requireAdmin,
  productsController.forceLatestPriceFromDefault
);
router.post('/:id/restore', requireAdmin, productsController.restoreProduct);
router.get('/:id/status-logs', requireAdmin, productsController.getProductStatusLogs);

router.get('/:id', productsController.getProductById);

// Admin only CRUD
router.post('/', requireAdmin, productsController.createProduct);
router.put('/:id', requireAdmin, productsController.updateProduct);
router.delete('/:id', requireAdmin, productsController.deleteProduct);


export default router;
