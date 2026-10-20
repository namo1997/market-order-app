import express from 'express';
import * as ordersController from '../controllers/orders.controller.js';
import { authenticate } from '../middleware/auth.js';
import { legacyReceivingWriteGuard } from '../middleware/legacy-receiving.js';

const router = express.Router();

// ทุก routes ต้อง authenticate
router.use(authenticate);

// Order status
router.get('/status', ordersController.getOrderStatus);

// Receiving (department) -- LEGACY: writes are deprecated (see config/legacy-receiving.js)
router.get('/receiving', ordersController.getReceivingItems);
router.get('/receiving/history', ordersController.getReceivingHistory);
router.get('/receiving/bill-photos', ordersController.getReceivingBillPhotos);
router.post('/receiving/bill-photos', legacyReceivingWriteGuard, ordersController.createReceivingBillPhoto);
router.put('/receiving', legacyReceivingWriteGuard, ordersController.updateReceivingItems);
router.post('/receiving/manual-item', legacyReceivingWriteGuard, ordersController.createManualReceivingItem);

// Production print (SUP003)
router.get('/production/print-items', ordersController.getProductionPrintItems);
router.post('/production/print-log', ordersController.logProductionPrint);

// My orders
router.get('/my-orders', ordersController.getMyOrders);
router.get('/:id', ordersController.getOrderById);

// Create, update, delete
router.post('/', ordersController.createOrder);
router.put('/:id', ordersController.updateOrder);
router.delete('/:id', ordersController.deleteOrder);

// Submit order
router.post('/:id/submit', ordersController.submitOrder);

export default router;
