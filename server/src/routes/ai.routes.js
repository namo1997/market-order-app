import express from 'express';
import { chatSalesReport, getBranchDailySales } from '../controllers/ai.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// เรียก OpenAI (มีค่าใช้จ่าย) ใช้จากหน้ารายงานยอดขายของแอดมินเท่านั้น
router.post('/sales-report', authenticate, requireAdmin, chatSalesReport);
// ป้องกันด้วย AI_BRANCH_SALES_TOKEN ใน controller
router.get('/branch-sales-daily', getBranchDailySales);

export default router;
