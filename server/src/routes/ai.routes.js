import express from 'express';
import { chatSalesReport, getBranchDailySales } from '../controllers/ai.controller.js';

const router = express.Router();

router.post('/sales-report', chatSalesReport);
router.get('/branch-sales-daily', getBranchDailySales);

export default router;
