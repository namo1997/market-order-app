import express from 'express';
import * as adminController from '../controllers/admin.controller.js';
import * as lineSettingsController from '../controllers/line-settings.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// ทุก routes ต้อง authenticate และเป็น admin
router.use(authenticate);
router.use(requireAdmin);

// Order management
router.get('/orders', adminController.getAllOrders);
router.get('/orders/by-branch', adminController.getOrdersByBranch);
router.get('/orders/by-supplier', adminController.getOrdersBySupplier);
router.get('/orders/items', adminController.getOrderItemsByDate);
router.put('/orders/:orderId/transfer', adminController.transferOrder);
router.get('/reports/purchases', adminController.getPurchaseReport);

// Open/close orders
router.post('/orders/close', adminController.closeOrders);
router.post('/orders/open', adminController.openOrders);

// Line notification settings
router.get('/line-notifications', lineSettingsController.getLineNotificationSettings);
router.put('/line-notifications', lineSettingsController.updateLineNotificationSettings);

// Purchase recording
router.put('/order-items/:itemId/purchase', adminController.recordPurchase);
router.put('/purchases/by-product', adminController.recordPurchaseByProduct);
router.post('/purchases/complete', adminController.completePurchasesByDate);
router.post('/purchases/complete-by-supplier', adminController.completePurchasesBySupplier);

// Purchase walk settings
router.get('/purchase-walk/products', adminController.getPurchaseWalkProducts);
router.put('/purchase-walk/order', adminController.updatePurchaseWalkOrder);

// Debug/Test
router.post('/orders/reset', adminController.resetOrderDay);

// Reset order
router.post('/orders/:orderId/reset', adminController.resetOrder);
router.post('/orders/reset-all', adminController.resetAllOrders);

// Order status
router.put('/orders/:orderId/status', adminController.updateOrderStatus);

export default router;
