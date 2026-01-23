import express from 'express';
import { chatSalesReport } from '../controllers/ai.controller.js';

const router = express.Router();

router.post('/sales-report', chatSalesReport);

export default router;
