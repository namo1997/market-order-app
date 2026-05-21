import express from 'express';
import {
  authenticateAccountingExport,
  health,
  listFreshMarketPurchaseWalk,
  listGeneralPurchases
} from '../controllers/accounting-export.controller.js';

const router = express.Router();

router.use(authenticateAccountingExport);

router.get('/health', health);
router.get('/general-purchases', listGeneralPurchases);
router.get('/purchase-walk/fresh-market', listFreshMarketPurchaseWalk);

export default router;
