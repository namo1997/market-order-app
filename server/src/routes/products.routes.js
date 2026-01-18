import express from 'express';
import * as productsController from '../controllers/products.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// ทุก routes ต้อง authenticate
router.use(authenticate);

// Products
router.get('/', productsController.getProducts);
router.get('/:id', productsController.getProductById);

// Admin only CRUD
router.post('/', requireAdmin, productsController.createProduct);
router.put('/:id', requireAdmin, productsController.updateProduct);
router.delete('/:id', requireAdmin, productsController.deleteProduct);

// Suppliers
router.get('/meta/suppliers', productsController.getSuppliers);

// Units
router.get('/meta/units', productsController.getUnits);

export default router;
