import express from 'express';
import * as withdrawController from '../controllers/withdraw.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

router.get('/targets', withdrawController.getWithdrawTargets);
router.get('/history/:id', withdrawController.getWithdrawById);
router.put('/history/:id', withdrawController.updateWithdrawal);
router.get('/products', withdrawController.getWithdrawProducts);
router.get('/history', withdrawController.getWithdrawHistory);
router.post('/', withdrawController.createWithdrawal);
router.get('/source-mappings', requireAdmin, withdrawController.getWithdrawSourceMappings);
router.put('/source-mappings', requireAdmin, withdrawController.saveWithdrawSourceMappings);

export default router;
