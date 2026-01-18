import express from 'express';
import * as authController from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Public routes (ไม่ต้อง login)
router.get('/branches', authController.getBranches);
router.get('/departments/:branchId', authController.getDepartments);
router.get('/users/:departmentId', authController.getUsers);
router.post('/login', authController.login);

// Protected routes (ต้อง login)
router.get('/me', authenticate, authController.getCurrentUser);

export default router;
