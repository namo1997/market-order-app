import express from 'express';
import * as controller from '../controllers/purchase-order.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

router.get('/',            controller.getPurchaseOrders);
router.post('/',           controller.createPurchaseOrder);
router.get('/:id',         controller.getPurchaseOrderById);
router.post('/:id/receive', controller.receivePurchaseOrder);
router.put('/:id/cancel',  controller.cancelPurchaseOrder);

export default router;
