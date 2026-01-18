import express from 'express';
import * as branchesController from '../controllers/branches.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

router.get('/', branchesController.getAllBranches);

// Admin only
router.post('/', requireAdmin, branchesController.createBranch);
router.put('/:id', requireAdmin, branchesController.updateBranch);
router.delete('/:id', requireAdmin, branchesController.deleteBranch);

export default router;
