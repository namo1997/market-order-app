import express from 'express';
import { chatSalesReport, getBranchDailySales } from '../controllers/ai.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.post('/sales-report', authenticate, requireAdmin, chatSalesReport);
router.get('/branch-sales-daily', getBranchDailySales);

export default router;
