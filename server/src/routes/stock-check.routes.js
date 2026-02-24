import express from 'express';
import * as stockCheckController from '../controllers/stock-check.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// ทุก routes ต้อง authenticate
router.use(authenticate);

// ============================================
// User Routes - เช็คสต็อกตามรายการของ Department
// ============================================

// User: ดึงรายการของประจำของ department ของตัวเอง
router.get('/my-template', stockCheckController.getMyDepartmentTemplate);
// User: ดึง/บันทึกสต็อกตามวันที่
router.get('/my-check', stockCheckController.getMyDepartmentStockCheck);
router.get('/my-check/history', stockCheckController.getMyDepartmentStockCheckHistory);
router.post('/my-check', stockCheckController.saveMyDepartmentStockCheck);
router.delete('/my-check', stockCheckController.clearMyDepartmentStockCheck);
// User: เช็คทั้งสาขาแบบแบ่งแผนก
router.get('/my-branch/departments', stockCheckController.getMyBranchStockCheckDepartments);
router.post('/my-branch/check-bulk', stockCheckController.bulkCheckMyBranchStockByDepartments);

// ============================================
// Admin Routes - จัดการรายการของประจำให้แต่ละ Department
// ============================================

// Admin: จัดการหมวดสินค้า
router.get('/admin/status', requireAdmin, stockCheckController.getStockCheckStatus);
router.put('/admin/status', requireAdmin, stockCheckController.updateStockCheckStatus);
router.get('/admin/categories/:departmentId', requireAdmin, stockCheckController.getCategoriesByDepartment);
router.post('/admin/categories', requireAdmin, stockCheckController.addCategory);
router.put('/admin/categories/:id', requireAdmin, stockCheckController.updateCategory);
router.delete('/admin/categories/:id', requireAdmin, stockCheckController.deleteCategory);

// Admin: ดึงรายการของประจำทั้งหมด
router.get('/admin/templates', requireAdmin, stockCheckController.getAllTemplates);

// Admin: ดึงรายการของประจำของ department
router.get('/admin/templates/:departmentId', requireAdmin, stockCheckController.getTemplateByDepartment);

// Admin: เพิ่ม/แก้ไข/ลบสินค้าในรายการของประจำ
router.post('/admin/templates', requireAdmin, stockCheckController.addToTemplate);
router.put('/admin/templates/:id', requireAdmin, stockCheckController.updateTemplate);
router.delete('/admin/templates/batch', requireAdmin, stockCheckController.deleteTemplates);
router.delete('/admin/templates/:id', requireAdmin, stockCheckController.deleteFromTemplate);

// Admin: ดึงรายการสินค้าที่ยังไม่ได้อยู่ใน template ของ department
router.get('/admin/available-products/:departmentId', requireAdmin, stockCheckController.getAvailableProducts);

export default router;
