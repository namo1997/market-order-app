import express from 'express';
import * as inventoryController from '../controllers/inventory.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// ใช้ authentication สำหรับทุก route
router.use(authenticate);

// ====================================
// Dashboard
// ====================================

/**
 * GET /api/inventory/dashboard
 * สรุปภาพรวมคลังสินค้า
 * Query: department_id, branch_id
 */
router.get('/dashboard', inventoryController.getDashboard);

// ====================================
// Inventory Balance
// ====================================

/**
 * GET /api/inventory/balance
 * ดึงยอดคงเหลือทั้งหมด
 * Query: department_id, branch_id, product_id, product_group_id, low_stock, search
 */
router.get('/balance', inventoryController.getBalances);

/**
 * GET /api/inventory/realtime-balance
 * ยอดคงเหลือ + ประมาณการหักยอดขายวันนี้จาก ClickHouse
 * Query: department_id (required)
 */
router.get('/realtime-balance', inventoryController.getRealtimeBalance);

/**
 * GET /api/inventory/balance/:productId/:departmentId
 * ดึงยอดคงเหลือของสินค้าในแผนก
 */
router.get('/balance/:productId/:departmentId', inventoryController.getBalance);

// ====================================
// Stock Movements
// ====================================

/**
 * GET /api/inventory/movements
 * ดึงประวัติการเคลื่อนไหว
 * Query: product_id, department_id, branch_id, transaction_type, start_date, end_date, limit, offset
 */
router.get('/movements', inventoryController.getMovements);

/**
 * POST /api/inventory/movements
 * บันทึกการเคลื่อนไหวสต็อก (Manual)
 * Body: product_id, department_id, transaction_type, quantity, reference_type, reference_id, notes
 */
router.post('/movements', inventoryController.createMovement);

/**
 * DELETE /api/inventory/movements/sale
 * ลบ transaction ประเภท sale ในช่วงวันที่ + ย้อน inventory_balance (admin only)
 * Body: start_date, end_date (YYYY-MM-DD), department_id (optional)
 */
router.delete('/movements/sale', requireAdmin, inventoryController.deleteSaleMovements);

// ====================================
// Stock Card
// ====================================

/**
 * GET /api/inventory/stock-card/:productId/:departmentId
 * ดูประวัติรายสินค้า (บัตรคุมสต็อก)
 * Query: start_date, end_date
 */
router.get('/stock-card/:productId/:departmentId', inventoryController.getStockCard);

// ====================================
// Stock Variance Report
// ====================================

/**
 * GET /api/inventory/variance-report
 * รายงานเปรียบเทียบยอดระบบ vs ยอดนับจริง
 * Query: date (required), department_id, branch_id, variance_only
 */
router.get('/variance-report', inventoryController.getVarianceReport);

/**
 * POST /api/inventory/apply-adjustment
 * ปรับปรุงยอดคงเหลือตามการนับจริง
 * Body: date, department_id
 */
router.post('/apply-adjustment', inventoryController.applyAdjustment);

// ====================================
// Utilities
// ====================================

/**
 * POST /api/inventory/init-balance
 * ตั้งยอดเริ่มต้น
 * Body: product_id, department_id, quantity
 */
router.post('/init-balance', inventoryController.initializeBalance);

/**
 * POST /api/inventory/production/transform
 * แปรรูปวัตถุดิบเป็นสินค้าสำเร็จ
 */
router.post('/production/transform', inventoryController.createProductionTransform);

/**
 * GET /api/inventory/production/transform/history
 * ประวัติการแปรรูปสินค้า
 */
router.get('/production/transform/history', inventoryController.getProductionTransformHistory);

export default router;
