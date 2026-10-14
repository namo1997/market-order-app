import express from 'express';
import * as controller from '../controllers/general-purchase.controller.js';
import {
  requireGeneralPurchaseHead,
  requireGeneralPurchaseReviewer,
  verifyGeneralPurchaseSession
} from './general-purchase-auth.routes.js';

const router = express.Router();

router.use(verifyGeneralPurchaseSession);

router.get('/', controller.listGeneralPurchaseOrders);
router.post('/', requireGeneralPurchaseHead, controller.createGeneralPurchaseOrder);
router.get('/:id', controller.getGeneralPurchaseOrder);
router.post('/:id/approve', requireGeneralPurchaseReviewer, controller.approveGeneralPurchaseOrder);
router.post('/:id/reject', requireGeneralPurchaseReviewer, controller.rejectGeneralPurchaseOrder);
router.post('/:id/issue-po', controller.issueGeneralPurchasePO);
router.post('/:id/receive', controller.receiveGeneralPurchaseOrder);

export default router;
