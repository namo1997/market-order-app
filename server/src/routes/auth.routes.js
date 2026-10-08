import express from 'express';
import * as authController from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Public routes (ไม่ต้อง login)
router.get('/branches', authController.getBranches);
router.get('/departments/:branchId', authController.getDepartments);
router.get('/users/:departmentId', authController.getUsers);
router.post('/login', authController.login);
router.post('/super-admin', authController.loginSuperAdmin);
router.get('/line/super-admin/status', authController.getSuperAdminLineStatus);
router.get('/line/super-admin/start', authController.startSuperAdminLineLogin);
router.get('/line/callback', authController.superAdminLineCallback);
router.post('/line/super-admin/exchange', authController.exchangeSuperAdminLineCode);

// Sync railway data (local only)
if (process.env.NODE_ENV !== 'production') {
  router.post('/sync-railway', authController.syncRailwayDatabase);
  router.get('/sync-railway/progress', authController.getSyncRailwayProgress);
}

// Protected routes (ต้อง login)
router.get('/me', authenticate, authController.getCurrentUser);

export default router;
