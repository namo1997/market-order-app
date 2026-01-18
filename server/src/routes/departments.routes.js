import express from 'express';
import * as departmentsController from '../controllers/departments.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

router.get('/', departmentsController.getAllDepartments);

// Admin only
router.post('/', requireAdmin, departmentsController.createDepartment);
router.put('/:id', requireAdmin, departmentsController.updateDepartment);
router.put('/:id/status', requireAdmin, departmentsController.updateDepartmentStatus);
router.delete('/:id', requireAdmin, departmentsController.deleteDepartment);

export default router;
