import express from 'express';
import * as inventoryController from '../controllers/inventory.controller.js';
import * as ropController from '../controllers/rop.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// ใช้ authentication สำหรับทุก route
router.use(authenticate);

// ตรวจรูปแบบ query ที่ใช้ร่วมกันก่อนถึง controller (ค่าผิดต้องได้ 400 ไม่ใช่ 500)
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const isValidIsoDateValue = (value) => {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};
const badRequest = (res, message) => res.status(400).json({ success: false, message });

router.use((req, res, next) => {
  for (const key of ['date', 'start_date', 'end_date']) {
    const value = req.query[key];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string' || !isValidIsoDateValue(value)) {
      return badRequest(res, `รูปแบบวันที่ ${key} ไม่ถูกต้อง (YYYY-MM-DD)`);
    }
  }
  for (const key of ['limit', 'offset', 'product_id', 'department_id', 'branch_id']) {
    const value = req.query[key];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
      return badRequest(res, `ค่า ${key} ไม่ถูกต้อง`);
    }
  }
  next();
});

const validatePositiveIdParam = (req, res, next, value, name) => {
  if (!/^\d+$/.test(String(value)) || Number(value) <= 0) {
    return badRequest(res, `ค่า ${name} ไม่ถูกต้อง`);
  }
  next();
};
router.param('productId', validatePositiveIdParam);
router.param('departmentId', validatePositiveIdParam);

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
 * บันทึกการเคลื่อนไหวสต็อก (Manual) — admin ทุกแผนก / ผู้ใช้อื่นเฉพาะแผนกตัวเอง
 * Body: product_id, department_id, transaction_type, quantity, reference_type, reference_id, notes
 */
router.post('/movements', inventoryController.createMovement);

/**
 * DELETE /api/inventory/movements/sale
 * ลบ transaction ประเภท sale ตามตัวกรองเดียวกับหน้ารายการ แล้วคำนวณ ledger/ยอดคงเหลือใหม่ (admin only)
 * Body: start_date, end_date (YYYY-MM-DD),
 *       department_id, branch_id, product_id, search, transaction_type (optional)
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
 * ตั้งยอดเริ่มต้น (admin only)
 * Body: product_id, department_id, quantity
 */
router.post('/init-balance', requireAdmin, inventoryController.initializeBalance);

/**
 * POST /api/inventory/production/transform
 * แปรรูปวัตถุดิบเป็นสินค้าสำเร็จ
 */
router.post('/production/transform', inventoryController.createProductionTransform);

/**
 * GET /api/inventory/production/configs
 * ดูการตั้งค่าแปรรูปสินค้า (วัตถุดิบหลักต่อสินค้าปลายทาง)
 * Query: department_id, search
 */
router.get('/production/configs', inventoryController.getProductionTransformConfigs);

/**
 * PUT /api/inventory/production/configs
 * บันทึกการตั้งค่าแปรรูปสินค้า (admin only)
 */
router.put('/production/configs', requireAdmin, inventoryController.upsertProductionTransformConfig);

/**
 * GET /api/inventory/production/transform/history
 * ประวัติการแปรรูปสินค้า
 */
router.get('/production/transform/history', inventoryController.getProductionTransformHistory);

/**
 * PUT /api/inventory/production/transform/:transactionId
 * แก้ไขประวัติการแปรรูปสินค้า
 */
router.put('/production/transform/:transactionId', inventoryController.updateProductionTransform);

// ====================================
// Reorder Point (ROP)
// ====================================

/**
 * GET /api/inventory/rop/overview
 * ภาพรวม ROP สำหรับแผนกฝ่ายผลิต
 * Query: department_id, window_days (7|14|28)
 */
router.get('/rop/overview', requireAdmin, ropController.getOverview);

/**
 * PUT /api/inventory/rop/settings
 * บันทึกค่า lead_time_days / safety_stock_days / min_quantity / max_quantity
 */
router.put('/rop/settings', requireAdmin, ropController.saveSetting);

export default router;
