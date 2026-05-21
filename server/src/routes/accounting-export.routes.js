import express from 'express';
import {
  authenticateAccountingExport,
  health,
  listGeneralPurchases
} from '../controllers/accounting-export.controller.js';

const router = express.Router();

router.use(authenticateAccountingExport);

router.get('/health', health);
router.get('/general-purchases', listGeneralPurchases);

export default router;
