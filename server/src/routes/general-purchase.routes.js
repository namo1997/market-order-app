import express from 'express';
import * as controller from '../controllers/general-purchase.controller.js';
import {
  requireGeneralPurchaseHead,
  requireGeneralPurchaseOperator,
  verifyGeneralPurchaseSession
} from './general-purchase-auth.routes.js';

const router = express.Router();

router.use(verifyGeneralPurchaseSession);

router.get('/', controller.listGeneralPurchaseOrders);
router.post('/', requireGeneralPurchaseHead, controller.createGeneralPurchaseOrder);
router.get('/:id', controller.getGeneralPurchaseOrder);
router.post('/:id/approve', requireGeneralPurchaseOperator, controller.approveGeneralPurchaseOrder);
router.post('/:id/reject', requireGeneralPurchaseOperator, controller.rejectGeneralPurchaseOrder);
router.post('/:id/issue-po', requireGeneralPurchaseOperator, controller.issueGeneralPurchasePO);
router.post('/:id/receive', requireGeneralPurchaseOperator, controller.receiveGeneralPurchaseOrder);

export default router;
