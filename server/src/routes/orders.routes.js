import express from 'express';
import * as ordersController from '../controllers/orders.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// ทุก routes ต้อง authenticate
router.use(authenticate);

// Order status
router.get('/status', ordersController.getOrderStatus);

// Receiving (department)
router.get('/receiving', ordersController.getReceivingItems);
router.get('/receiving/history', ordersController.getReceivingHistory);
router.put('/receiving', ordersController.updateReceivingItems);
router.post('/receiving/manual-item', ordersController.createManualReceivingItem);

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
