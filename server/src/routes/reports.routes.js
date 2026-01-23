import express from 'express';
import { getSalesReport } from '../controllers/reports.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);
router.use(requireAdmin);

router.get('/sales', getSalesReport);

export default router;
