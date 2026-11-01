import * as inventoryModel from '../models/inventory.model.js';
import * as productionTransformConfigModel from '../models/production-transform-config.model.js';
import * as settingsModel from '../models/settings.model.js';
import * as productGroupModel from '../models/supplier.model.js';
import { withProductGroupAliases } from '../utils/product-group.js';
import pool from '../config/database.js';
import { getBranchById } from '../models/branch.model.js';
import { queryClickHouse } from '../services/clickhouse.service.js';

const PRODUCTION_BRANCH_ID = 4;
const CLICKHOUSE_SHOP_ID =
  process.env.CLICKHOUSE_SHOP_ID || '2OJMVIo1Qi81NqYos3oDPoASziy';
const CLICKHOUSE_TZ_OFFSET = Number(process.env.CLICKHOUSE_TZ_OFFSET || 7);
const STOCK_ADJUSTMENT_PIN = '1997';
const SALES_SYNC_STATUS_KEY = 'sales_sync_retry_status';

const isAdminUser = (user) => ['admin', 'super_admin'].includes(user?.role);

const toPositiveInt = (value) => {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
};

const sendError = (res, status, message) =>
  res.status(status).json({ success: false, message });

/**
 * ขอบเขตการอ่านข้อมูลคลัง
 * - admin / super_admin: ดูได้ทุกแผนก/สาขาตามตัวกรอง
 * - ผู้ใช้อื่น: ดูได้เฉพาะแผนกของตัวเองเท่านั้น (ตัวกรองสาขา/แผนกอื่นถูกปฏิเสธ)
 * คืน null เมื่อส่ง response error ไปแล้ว
 */
const resolveReadScope = (req, res, { departmentId, branchId } = {}) => {
  const hasDepartment = departmentId !== undefined && departmentId !== null && departmentId !== '';
  const hasBranch = branchId !== undefined && branchId !== null && branchId !== '';
  const requestedDepartmentId = hasDepartment ? toPositiveInt(departmentId) : null;
  const requestedBranchId = hasBranch ? toPositiveInt(branchId) : null;

  if (hasDepartment && !requestedDepartmentId) {
    sendError(res, 400, 'department_id ไม่ถูกต้อง');
    return null;
  }
  if (hasBranch && !requestedBranchId) {
    sendError(res, 400, 'branch_id ไม่ถูกต้อง');
    return null;
  }

  if (isAdminUser(req.user)) {
    return { departmentId: requestedDepartmentId, branchId: requestedBranchId };
  }

  const ownDepartmentId = toPositiveInt(req.user?.department_id);
  if (!ownDepartmentId) {
    sendError(res, 403, 'ไม่พบแผนกของผู้ใช้งาน');
    return null;
  }
  if (requestedDepartmentId && requestedDepartmentId !== ownDepartmentId) {
    sendError(res, 403, 'ไม่มีสิทธิ์ดูข้อมูลคลังของแผนกอื่น');
    return null;
  }
  const ownBranchId = toPositiveInt(req.user?.branch_id);
  if (requestedBranchId && ownBranchId && requestedBranchId !== ownBranchId) {
    sendError(res, 403, 'ไม่มีสิทธิ์ดูข้อมูลคลังของสาขาอื่น');
    return null;
  }
  return { departmentId: ownDepartmentId, branchId: null };
};

/**
 * สิทธิ์เขียนข้อมูลคลังของแผนก: admin ได้ทุกแผนก, ผู้ใช้อื่นได้เฉพาะแผนกตัวเอง
 */
const canWriteDepartment = (user, departmentId) => {
  if (isAdminUser(user)) return true;
  const ownDepartmentId = toPositiveInt(user?.department_id);
  return Boolean(ownDepartmentId) && ownDepartmentId === Number(departmentId);
};

/**
 * ตรวจ/ปัดจำนวนให้ตรง scale ของคอลัมน์ (DECIMAL(10,2))
 * คืน { value } หรือ { error }
 */
const parseMovementQuantity = (rawValue, { label = 'จำนวน' } = {}) => {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
    return { error: `กรุณาระบุ${label}` };
  }
  if (typeof rawValue === 'boolean' || typeof rawValue === 'object') {
    return { error: `${label}ต้องเป็นตัวเลข` };
  }
  const num = Number(rawValue);
  if (!Number.isFinite(num)) {
    return { error: `${label}ต้องเป็นตัวเลข` };
  }
  const value = inventoryModel.roundQuantity(num);
  if (value === 0) {
    return { error: `${label}ต้องไม่เป็น 0 (ทศนิยมได้ไม่เกิน ${inventoryModel.QUANTITY_SCALE} ตำแหน่ง)` };
  }
  if (Math.abs(value) > inventoryModel.MAX_MOVEMENT_QUANTITY) {
    return {
      error: `${label}ต้องไม่เกิน ${inventoryModel.MAX_MOVEMENT_QUANTITY.toLocaleString('en-US')}`
    };
  }
  return { value };
};

// เครื่องหมายของจำนวนตามประเภทรายการ (ป้องกันขายแล้วยอดเพิ่ม ฯลฯ)
const MOVEMENT_SIGN_RULES = {
  receive: 1,
  transfer_in: 1,
  sale: -1,
  transfer_out: -1
};

const toBoolean = (value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  return Boolean(value);
};

const escapeValue = (value) => String(value || '').replace(/'/g, "''");

const canUseProductionTransform = (user) => {
  const isAdmin = ['admin', 'super_admin'].includes(user?.role);
  const isProductionDepartment = Boolean(user?.is_production_department);
  const isLegacyProductionBranch = Number(user?.branch_id) === PRODUCTION_BRANCH_ID;
  return isAdmin || isProductionDepartment || isLegacyProductionBranch;
};

const toProductionConfigErrorMessage = (error) => {
  switch (error?.message) {
    case 'DEPARTMENT_NOT_PRODUCTION':
      return 'เลือกได้เฉพาะแผนกฝ่ายผลิต';
    case 'INVALID_OUTPUT_PRODUCT':
      return 'ไม่พบสินค้าปลายทาง';
    case 'OUTPUT_PRODUCT_NOT_ALLOWED':
      return 'สินค้าปลายทางนี้ไม่ได้อยู่ในกลุ่มที่ผูกสำหรับแปรรูปของแผนกนี้';
    case 'BASE_INGREDIENT_REQUIRED':
      return 'กรุณาเลือกวัตถุดิบหลักอย่างน้อย 1 รายการ';
    case 'BASE_INGREDIENT_DUPLICATE_OUTPUT':
      return 'วัตถุดิบหลักต้องไม่ใช่สินค้าปลายทางตัวเดียวกัน';
    case 'BASE_INGREDIENT_NOT_FOUND':
      return 'ไม่พบวัตถุดิบหลักที่เลือก';
    case 'BASE_INGREDIENT_NOT_CONFIGURED':
      return 'สินค้านี้บังคับใช้วัตถุดิบหลัก แต่ยังไม่ได้ตั้งค่าวัตถุดิบหลัก';
    case 'BASE_INGREDIENT_REQUIRED_QTY_MISSING':
      return `กรุณากรอกจำนวนวัตถุดิบหลักให้ครบ: ${(error?.details || []).join(', ')}`;
    default:
      return null;
  }
};

const parseSalesSyncStatus = async () => {
  try {
    const raw = await settingsModel.getSetting(SALES_SYNC_STATUS_KEY, '');
    if (!raw) return null;
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (error) {
    return null;
  }
};

// ====================================
// Dashboard
// ====================================

/**
 * GET /api/inventory/dashboard
 * สรุปภาพรวมคลังสินค้า
 */
export const getDashboard = async (req, res, next) => {
  try {
    const { department_id, branch_id, start_date, end_date } = req.query;

    const scope = resolveReadScope(req, res, { departmentId: department_id, branchId: branch_id });
    if (!scope) return;

    const filters = {};
    if (scope.departmentId) filters.departmentId = scope.departmentId;
    if (scope.branchId) filters.branchId = scope.branchId;
    if (start_date) filters.startDate = String(start_date);
    if (end_date) filters.endDate = String(end_date);

    const stats = await inventoryModel.getDashboardStats(filters);

    // ดึงสินค้าที่ต่ำกว่า Min
    const lowStockResult = await inventoryModel.getAllBalances({
      ...filters,
      lowStock: true
    });
    const lowStockItems = Array.isArray(lowStockResult?.data)
      ? lowStockResult.data
      : [];
    const salesSyncStatus = await parseSalesSyncStatus();

    res.json({
      success: true,
      data: {
        stats,
        low_stock_items: lowStockItems.slice(0, 10), // แสดงแค่ 10 รายการแรก
        sales_sync_status: salesSyncStatus
      }
    });
  } catch (error) {
    next(error);
  }
};

// ====================================
// Inventory Balance (ยอดคงเหลือ)
// ====================================

/**
 * GET /api/inventory/balance
 * ดึงยอดคงเหลือทั้งหมด
 */
export const getBalances = async (req, res, next) => {
  try {
    const {
      department_id,
      branch_id,
      product_id,
      supplier_id,
      product_group_id,
      low_stock,
      high_value_only,
      recipe_linked_only,
      include_pending_transfer,
      search,
      page,
      limit
    } = req.query;

    const scope = resolveReadScope(req, res, { departmentId: department_id, branchId: branch_id });
    if (!scope) return;

    const filters = {};
    if (scope.departmentId) filters.departmentId = scope.departmentId;
    if (scope.branchId) filters.branchId = scope.branchId;
    if (product_id) filters.productId = Number(product_id);
    if (supplier_id || product_group_id) {
      filters.supplierId = Number(product_group_id ?? supplier_id);
    }
    if (low_stock === 'true') filters.lowStock = true;
    if (high_value_only === 'true') filters.highValueOnly = true;
    if (recipe_linked_only === 'true') filters.recipeLinkedOnly = true;
    if (include_pending_transfer === 'true') filters.includePendingTransfer = true;
    if (search) filters.search = search;
    if (page) filters.page = page;
    if (limit) filters.limit = limit;

    const result = await inventoryModel.getAllBalances(filters);

    res.json({
      success: true,
      data: withProductGroupAliases(result.data),
      count: result.data.length,
      pagination: result.pagination
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/inventory/balance/:productId/:departmentId
 * ดึงยอดคงเหลือของสินค้าในแผนก
 */
export const getBalance = async (req, res, next) => {
  try {
    const { productId, departmentId } = req.params;

    const scope = resolveReadScope(req, res, { departmentId });
    if (!scope) return;

    const balance = await inventoryModel.getBalance(
      Number(productId),
      Number(departmentId)
    );

    if (!balance) {
      return res.status(404).json({
        success: false,
        message: 'Balance not found'
      });
    }

    res.json({
      success: true,
      data: withProductGroupAliases(balance)
    });
  } catch (error) {
    next(error);
  }
};

// ====================================
// Stock Movements (การเคลื่อนไหว)
// ====================================

/**
 * GET /api/inventory/movements
 * ดึงประวัติการเคลื่อนไหว
 */
export const getMovements = async (req, res, next) => {
  try {
    const {
      product_id,
      department_id,
      branch_id,
      transaction_type,
      search,
      start_date,
      end_date,
      limit,
      offset
    } = req.query;

    const scope = resolveReadScope(req, res, { departmentId: department_id, branchId: branch_id });
    if (!scope) return;

    const filters = {};
    if (product_id) filters.productId = Number(product_id);
    if (scope.departmentId) filters.departmentId = scope.departmentId;
    if (scope.branchId) filters.branchId = scope.branchId;
    if (transaction_type) filters.transactionType = transaction_type;
    if (search) filters.search = String(search).trim();
    if (start_date) filters.startDate = start_date;
    if (end_date) filters.endDate = end_date;
    if (limit) filters.limit = Number(limit);
    if (offset) filters.offset = Number(offset);

    const movements = await inventoryModel.getTransactions(filters);

    res.json({
      success: true,
      data: withProductGroupAliases(movements),
      count: movements.length
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/inventory/movements
 * บันทึกการเคลื่อนไหวสต็อก (Manual)
 */
export const createMovement = async (req, res, next) => {
  try {
    const {
      product_id,
      department_id,
      transaction_type,
      quantity,
      reference_type,
      reference_id,
      notes
    } = req.body;

    // Validation
    if (!product_id || !department_id || !transaction_type || quantity === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Product ID, Department ID, Transaction Type, and Quantity are required'
      });
    }

    const productId = toPositiveInt(product_id);
    const departmentId = toPositiveInt(department_id);
    if (!productId || !departmentId) {
      return sendError(res, 400, 'product_id และ department_id ต้องเป็นตัวเลขที่ถูกต้อง');
    }

    const validTypes = ['receive', 'sale', 'adjustment', 'transfer_in', 'transfer_out', 'initial'];
    if (!validTypes.includes(transaction_type)) {
      return res.status(400).json({
        success: false,
        message: `Invalid transaction type. Must be one of: ${validTypes.join(', ')}`
      });
    }

    if (transaction_type === 'initial' && !isAdminUser(req.user)) {
      return sendError(res, 403, 'ตั้งยอดเริ่มต้นได้เฉพาะผู้ดูแลระบบ');
    }

    if (!canWriteDepartment(req.user, departmentId)) {
      return sendError(res, 403, 'ไม่มีสิทธิ์บันทึกการเคลื่อนไหวสต็อกของแผนกอื่น');
    }

    const parsedQuantity = parseMovementQuantity(quantity);
    if (parsedQuantity.error) {
      return sendError(res, 400, parsedQuantity.error);
    }

    const requiredSign = MOVEMENT_SIGN_RULES[transaction_type];
    if (requiredSign && Math.sign(parsedQuantity.value) !== requiredSign) {
      return sendError(
        res,
        400,
        requiredSign > 0
          ? `รายการประเภท ${transaction_type} ต้องมีจำนวนเป็นบวก`
          : `รายการประเภท ${transaction_type} ต้องมีจำนวนเป็นลบ (เช่น -3)`
      );
    }

    const [[productRow]] = await pool.query('SELECT id FROM products WHERE id = ? LIMIT 1', [productId]);
    const [[departmentRow]] = await pool.query('SELECT id FROM departments WHERE id = ? LIMIT 1', [departmentId]);
    if (!productRow || !departmentRow) {
      return sendError(res, 404, !productRow ? 'ไม่พบสินค้า' : 'ไม่พบแผนก');
    }

    const result = await inventoryModel.createTransaction({
      product_id: productId,
      department_id: departmentId,
      transaction_type,
      quantity: parsedQuantity.value,
      reference_type: reference_type || null,
      reference_id: reference_id || null,
      notes: notes || null,
      created_by: req.user?.id || null
    });

    res.status(201).json({
      success: true,
      data: withProductGroupAliases(result),
      message: 'Transaction created successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/inventory/movements/sale
 * ลบ transaction ประเภท sale ในช่วงวันที่ที่ระบุ + ย้อน inventory_balance
 * Body: start_date, end_date (YYYY-MM-DD)
 * ต้องเป็น admin เท่านั้น
 */
export const deleteSaleMovements = async (req, res, next) => {
  try {
    const {
      start_date,
      end_date,
      department_id,
      branch_id,
      product_id,
      search,
      transaction_type
    } = req.body || {};

    if (!start_date || !end_date) {
      return res.status(400).json({
        success: false,
        message: 'กรุณาระบุ start_date และ end_date (YYYY-MM-DD)'
      });
    }
    if (!inventoryModel.isValidIsoDate(start_date) || !inventoryModel.isValidIsoDate(end_date)) {
      return sendError(res, 400, 'รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)');
    }
    if (String(start_date) > String(end_date)) {
      return sendError(res, 400, 'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด');
    }

    // ถ้าหน้าจอกรองประเภทอื่นที่ไม่ใช่ "ขาย" อยู่ จะไม่มีรายการขายให้ลบ
    if (transaction_type && transaction_type !== 'sale') {
      return res.json({
        success: true,
        message: 'ตัวกรองประเภทไม่ใช่ "ขาย" จึงไม่มีรายการให้ลบ',
        deleted: 0,
        affected_keys: 0
      });
    }

    const filters = {
      startDate: String(start_date),
      endDate: String(end_date)
    };
    const optionalIds = { departmentId: department_id, branchId: branch_id, productId: product_id };
    for (const [key, raw] of Object.entries(optionalIds)) {
      if (raw === undefined || raw === null || raw === '') continue;
      const id = toPositiveInt(raw);
      if (!id) {
        return sendError(res, 400, `${key} ไม่ถูกต้อง`);
      }
      filters[key] = id;
    }
    const searchText = String(search || '').trim();
    if (searchText) filters.search = searchText;

    const result = await inventoryModel.deleteSaleTransactions(filters);

    if (result.deleted === 0) {
      return res.json({
        success: true,
        message: 'ไม่พบรายการขายตามตัวกรองที่ระบุ',
        deleted: 0,
        affected_keys: 0
      });
    }

    res.json({
      success: true,
      message: 'ลบรายการขายออกเรียบร้อย และคำนวณยอดสต็อกใหม่แล้ว',
      deleted: result.deleted,
      affected_keys: result.affected_keys
    });
  } catch (error) {
    next(error);
  }
};

// ====================================
// Stock Card (บัตรคุมสต็อก)
// ====================================

/**
 * GET /api/inventory/stock-card/:productId/:departmentId
 * ดูประวัติรายสินค้า (บัตรคุมสต็อก)
 */
export const getStockCard = async (req, res, next) => {
  try {
    const { productId, departmentId } = req.params;
    const { start_date, end_date } = req.query;

    const scope = resolveReadScope(req, res, { departmentId });
    if (!scope) return;

    const filters = {};
    if (start_date) filters.startDate = start_date;
    if (end_date) filters.endDate = end_date;

    const transactions = await inventoryModel.getProductStockCard(
      Number(productId),
      Number(departmentId),
      filters
    );

    // ดึงข้อมูลสินค้า
    const balance = await inventoryModel.getBalance(
      Number(productId),
      Number(departmentId)
    );

    const balanceResult = await inventoryModel.getAllBalances({
      productId: Number(productId),
      departmentId: Number(departmentId)
    });
    const productInfo = Array.isArray(balanceResult?.data)
      ? (balanceResult.data[0] || null)
      : null;

    res.json({
      success: true,
      data: {
        product: withProductGroupAliases(productInfo),
        current_balance: balance?.quantity || 0,
        transactions: withProductGroupAliases(transactions)
      }
    });
  } catch (error) {
    next(error);
  }
};

// ====================================
// Stock Variance Report
// ====================================

/**
 * GET /api/inventory/variance-report
 * รายงานเปรียบเทียบยอดระบบ vs ยอดนับจริง
 */
export const getVarianceReport = async (req, res, next) => {
  try {
    const { date, department_id, branch_id, variance_only, high_value_only } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Date is required'
      });
    }

    const scope = resolveReadScope(req, res, { departmentId: department_id, branchId: branch_id });
    if (!scope) return;

    const filters = {};
    if (scope.departmentId) filters.departmentId = scope.departmentId;
    if (scope.branchId) filters.branchId = scope.branchId;
    if (variance_only === 'true') filters.showVarianceOnly = true;
    if (high_value_only === 'true') filters.highValueOnly = true;

    const report = await inventoryModel.getStockVarianceReport(date, filters);

    // คำนวณสรุป
    const summary = {
      total_items: report.length,
      items_with_variance: report.filter(r => r.variance !== 0).length,
      total_variance_value: report.reduce((sum, r) => {
        const variance = parseFloat(r.variance || 0);
        const price = parseFloat(r.default_price || 0);
        return sum + (variance * price);
      }, 0)
    };

    res.json({
      success: true,
      data: {
        date,
        summary,
        items: report
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/inventory/apply-adjustment
 * ปรับปรุงยอดคงเหลือตามการนับจริง
 */
export const applyAdjustment = async (req, res, next) => {
  try {
    const { date, department_id, product_ids, force_apply, pin } = req.body;

    if (!date || !department_id) {
      return res.status(400).json({
        success: false,
        message: 'Date and Department ID are required'
      });
    }

    const departmentId = toPositiveInt(department_id);
    if (!departmentId) {
      return sendError(res, 400, 'department_id ไม่ถูกต้อง');
    }
    if (!inventoryModel.isValidIsoDate(date)) {
      return sendError(res, 400, 'รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)');
    }
    if (!canWriteDepartment(req.user, departmentId)) {
      return sendError(res, 403, 'ไม่มีสิทธิ์ปรับปรุงยอดคงเหลือของแผนกอื่น');
    }
    const forceApply = toBoolean(force_apply);
    const pinValue = String(pin || '').trim();

    if (pinValue !== STOCK_ADJUSTMENT_PIN) {
      return res.status(403).json({
        success: false,
        message: 'PIN สำหรับปรับปรุงยอดไม่ถูกต้อง'
      });
    }

    // Safety gate: ถ้ายังไม่ตัดยอดขายตามสูตรของวันนั้น ห้ามปรับยอดจากการนับจริง (ยกเว้น force_apply)
    const [[departmentRow]] = await pool.query(
      'SELECT id, branch_id FROM departments WHERE id = ? LIMIT 1',
      [departmentId]
    );
    if (!departmentRow) {
      return res.status(404).json({
        success: false,
        message: 'Department not found'
      });
    }

    const branchId = Number(departmentRow.branch_id);

    // ตรวจว่าแผนกนี้มี stock_check วันนั้นไหม
    // ถ้าไม่มีเลย → ไม่ต้อง block (ไม่มีอะไรจะ apply)
    const [[stockCheckCountRow]] = await pool.query(
      `SELECT COUNT(*) AS check_count
       FROM stock_checks
       WHERE department_id = ? AND check_date = ?`,
      [departmentId, date]
    );
    const hasStockCheck = Number(stockCheckCountRow?.check_count || 0) > 0;

    // ตรวจว่า product ในแผนกนี้ที่มี stock_check วันนั้น
    // เคยมี recipe_sale ตัดสต็อกมาแล้วหรือยัง (เฉพาะแผนกนี้)
    const [[localSalesSyncRow]] = await pool.query(
      `SELECT COUNT(*) AS synced_count
       FROM inventory_transactions it
       WHERE it.reference_type = 'recipe_sale'
         AND DATE(it.created_at) = ?
         AND it.department_id = ?
         AND it.product_id IN (
           SELECT product_id FROM stock_checks
           WHERE department_id = ? AND check_date = ?
         )`,
      [date, departmentId, departmentId, date]
    );
    const localSalesSyncedCount = Number(localSalesSyncRow?.synced_count || 0);

    let clickhouseSalesCount = null;
    let clickhouseChecked = false;
    let clickhouseError = null;

    // ตรวจว่าแผนกนี้เคยมี stock_check transaction เคยถูก apply ไปแล้วหรือยัง
    // ถ้าไม่เคยเลย = แผนก/สาขาใหม่ที่เพิ่งเริ่มใช้ระบบ → ผ่าน safety gate ได้เลย
    const [[everAppliedRow]] = await pool.query(
      `SELECT COUNT(*) AS applied_count
       FROM inventory_transactions
       WHERE department_id = ? AND reference_type = 'stock_check'`,
      [departmentId]
    );
    const isFirstEverApply = Number(everAppliedRow?.applied_count || 0) === 0;

    // ตรวจ ClickHouse เฉพาะเมื่อมี stock_check, ยังไม่มี recipe_sale, และไม่ใช่ครั้งแรก
    if (hasStockCheck && localSalesSyncedCount === 0 && !isFirstEverApply) {
      const branch = await getBranchById(branchId);
      const clickhouseBranchId = String(branch?.clickhouse_branch_id || '').trim();

      if (clickhouseBranchId) {
        try {
          const salesSql = `
            SELECT count() AS sales_count
            FROM doc d
            WHERE d.shopid = '${escapeValue(CLICKHOUSE_SHOP_ID)}'
              AND d.transflag = 44
              AND d.iscancel = 0
              AND toDate(addHours(d.docdatetime, ${CLICKHOUSE_TZ_OFFSET})) = toDate('${escapeValue(date)}')
              AND d.branchid = '${escapeValue(clickhouseBranchId)}'
          `;
          const rows = await queryClickHouse(salesSql);
          clickhouseChecked = true;
          clickhouseSalesCount = Number(rows?.[0]?.sales_count || 0);
        } catch (error) {
          clickhouseChecked = true;
          clickhouseError = error?.message || String(error);
        }
      }
    }

    // block เฉพาะเมื่อ:
    // 1. ไม่ใช่ force_apply
    // 2. มี stock_check ในแผนกนี้วันนั้น
    // 3. ไม่ใช่ครั้งแรกที่แผนกนี้จะ apply (ถ้าเป็นครั้งแรก = สาขาใหม่ → ผ่านได้เลย)
    // 4. ยังไม่มี recipe_sale ตัดสต็อกสินค้าในแผนกนี้เลย
    // 5. ClickHouse พบว่ามีบิลขายอยู่จริง (แปลว่า sync ยังไม่ได้ทำ)
    const shouldBlockForSafety =
      !forceApply &&
      hasStockCheck &&
      !isFirstEverApply &&
      localSalesSyncedCount === 0 &&
      (
        (clickhouseChecked && clickhouseError) ||
        (clickhouseChecked && Number(clickhouseSalesCount || 0) > 0)
      );

    if (shouldBlockForSafety) {
      const detail = clickhouseError
        ? 'ตรวจสอบยอดขายจาก ClickHouse ไม่สำเร็จ'
        : `พบยอดขาย ${clickhouseSalesCount} รายการ แต่ยังไม่ตัดสต็อกขายเข้าคลัง`;
      return res.status(409).json({
        success: false,
        message: `ยังไม่ปลอดภัยในการปรับยอด: ${detail}. กรุณากด "ดึงตัดสต็อกขาย" ก่อน หรือส่ง force_apply=true หากยืนยัน`,
        data: {
          date,
          branch_id: branchId,
          local_sales_synced_count: localSalesSyncedCount,
          clickhouse_checked: clickhouseChecked,
          clickhouse_sales_count: clickhouseSalesCount,
          clickhouse_error: clickhouseError
        }
      });
    }

    const normalizedProductIds = Array.isArray(product_ids)
      ? product_ids
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id))
      : [];

    const result = await inventoryModel.applyStockAdjustment(
      date,
      departmentId,
      req.user?.id || null,
      {
        productIds: normalizedProductIds,
        allowReapply: true
      }
    );

    res.json({
      success: true,
      data: {
        ...result,
        sales_sync_check: {
          date,
          branch_id: branchId,
          local_sales_synced_count: localSalesSyncedCount,
          clickhouse_checked: clickhouseChecked,
          clickhouse_sales_count: clickhouseSalesCount,
          clickhouse_error: clickhouseError,
          forced: forceApply
        }
      },
      message:
        `Applied ${result.total_adjustments} adjustments successfully` +
        (Number(result.skipped_already_applied_count || 0) > 0
          ? ` (skipped ${result.skipped_already_applied_count} already applied)`
          : '')
    });
  } catch (error) {
    next(error);
  }
};

// ====================================
// Utilities
// ====================================

/**
 * POST /api/inventory/init-balance
 * ตั้งยอดเริ่มต้น (สำหรับ admin)
 */
export const initializeBalance = async (req, res, next) => {
  try {
    const { product_id, department_id, quantity } = req.body;

    if (!product_id || !department_id || quantity === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Product ID, Department ID, and Quantity are required'
      });
    }

    if (!isAdminUser(req.user)) {
      return sendError(res, 403, 'Access denied. Admin only.');
    }

    const productId = toPositiveInt(product_id);
    const departmentId = toPositiveInt(department_id);
    if (!productId || !departmentId) {
      return sendError(res, 400, 'product_id และ department_id ต้องเป็นตัวเลขที่ถูกต้อง');
    }

    const parsedQuantity = parseMovementQuantity(quantity);
    if (parsedQuantity.error) {
      return sendError(res, 400, parsedQuantity.error);
    }

    // สร้าง initial transaction
    const result = await inventoryModel.createTransaction({
      product_id: productId,
      department_id: departmentId,
      transaction_type: 'initial',
      quantity: parsedQuantity.value,
      reference_type: 'manual',
      reference_id: null,
      notes: 'ตั้งยอดเริ่มต้น',
      created_by: req.user?.id || null
    });

    res.status(201).json({
      success: true,
      data: result,
      message: 'Initial balance set successfully'
    });
  } catch (error) {
    next(error);
  }
};

const toIdList = (values) =>
  Array.isArray(values)
    ? values.map((id) => Number(id)).filter((id) => Number.isFinite(id))
    : [];

/**
 * กลุ่มสินค้าปลายทางที่แผนกนี้แปรรูปได้ — ใช้ลำดับเดียวกับ products.controller (transformOutput):
 * 1) ขอบเขตแปรรูป (product_group_transform_scopes) ของสาขา+แผนกปลายทาง
 * 2) ขอบเขตสั่งภายใน (internal scope)
 * 3) ค่าใน token: allowed_transform_product_group_ids → allowed_product_group_ids
 */
const resolveTransformOutputGroupIds = async (user, departmentId) => {
  const [[departmentRow]] = await pool.query(
    'SELECT id, branch_id FROM departments WHERE id = ? LIMIT 1',
    [departmentId]
  );
  const branchId = departmentRow?.branch_id;

  if (departmentRow) {
    const transformGroups = await productGroupModel.getTransformProductGroupsByScope({
      branchId,
      departmentId
    });
    const transformIds = toIdList((transformGroups || []).map((group) => group.id));
    if (transformIds.length > 0) return transformIds;

    const internalGroups = await productGroupModel.getInternalProductGroupsByScope({
      branchId,
      departmentId
    });
    const internalIds = toIdList((internalGroups || []).map((group) => group.id));
    if (internalIds.length > 0) return internalIds;
  }

  // token ของผู้ใช้ใช้ได้เฉพาะเมื่อแปรรูปในแผนกของตัวเอง
  if (Number(user?.department_id) !== Number(departmentId)) return [];
  const tokenTransformIds = toIdList(user?.allowed_transform_product_group_ids);
  if (tokenTransformIds.length > 0) return tokenTransformIds;
  return toIdList(user?.allowed_product_group_ids ?? user?.allowed_supplier_ids);
};

/**
 * POST /api/inventory/production/transform
 * แปรรูปวัตถุดิบเป็นสินค้าสำเร็จ
 */
export const createProductionTransform = async (req, res, next) => {
  try {
    if (!canUseProductionTransform(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const {
      transform_date,
      department_id,
      output_product_id,
      output_quantity,
      ingredients,
      notes
    } = req.body || {};

    const normalizedDepartmentId = Number(department_id);
    const userDepartmentId = Number(req.user?.department_id);
    const isAdmin = ['admin', 'super_admin'].includes(req.user?.role);

    if (!isAdmin && Number.isFinite(userDepartmentId) && normalizedDepartmentId !== userDepartmentId) {
      return res.status(403).json({
        success: false,
        message: 'ไม่สามารถแปรรูปข้ามแผนกได้'
      });
    }

    if (!transform_date || !department_id || !output_product_id || output_quantity === undefined) {
      return res.status(400).json({
        success: false,
        message: 'transform_date, department_id, output_product_id and output_quantity are required'
      });
    }

    if (!toPositiveInt(department_id) || !toPositiveInt(output_product_id)) {
      return sendError(res, 400, 'department_id และ output_product_id ต้องเป็นตัวเลขที่ถูกต้อง');
    }

    if (!inventoryModel.isValidIsoDate(transform_date)) {
      return sendError(res, 400, 'วันที่แปรรูปไม่ถูกต้อง (YYYY-MM-DD)');
    }

    const parsedOutputQuantity = parseMovementQuantity(output_quantity, { label: 'จำนวนสินค้าที่แปรรูป' });
    if (parsedOutputQuantity.error) {
      return sendError(res, 400, parsedOutputQuantity.error);
    }
    if (parsedOutputQuantity.value <= 0) {
      return sendError(res, 400, 'จำนวนสินค้าที่แปรรูปต้องมากกว่า 0');
    }

    if (ingredients !== undefined && ingredients !== null && !Array.isArray(ingredients)) {
      return sendError(res, 400, 'ingredients ต้องเป็นรายการ');
    }
    for (const ingredient of Array.isArray(ingredients) ? ingredients : []) {
      if (!toPositiveInt(ingredient?.product_id)) {
        return sendError(res, 400, 'รหัสวัตถุดิบไม่ถูกต้อง');
      }
      const parsedIngredientQty = parseMovementQuantity(ingredient?.quantity, { label: 'จำนวนวัตถุดิบ' });
      if (parsedIngredientQty.error) {
        return sendError(res, 400, parsedIngredientQty.error);
      }
      if (parsedIngredientQty.value < 0) {
        return sendError(res, 400, 'จำนวนวัตถุดิบต้องมากกว่า 0');
      }
    }

    const resolvedIngredients = await productionTransformConfigModel.resolveProductionTransformIngredients({
      departmentId: normalizedDepartmentId,
      outputProductId: Number(output_product_id),
      outputQuantity: parsedOutputQuantity.value,
      ingredients: Array.isArray(ingredients) ? ingredients : []
    });

    const allowedOutputGroupIds = await resolveTransformOutputGroupIds(req.user, normalizedDepartmentId);

    const result = await inventoryModel.createProductionTransform({
      transformDate: String(transform_date),
      departmentId: normalizedDepartmentId,
      outputProductId: Number(output_product_id),
      outputQuantity: parsedOutputQuantity.value,
      ingredients: resolvedIngredients,
      notes: notes ? String(notes) : '',
      createdBy: req.user?.id || null,
      allowedOutputGroupIds
    });

    const hasInsufficientIngredients =
      Array.isArray(result?.insufficient_ingredients) &&
      result.insufficient_ingredients.length > 0;

    return res.status(201).json({
      success: true,
      data: result,
      message: hasInsufficientIngredients
        ? 'บันทึกการแปรรูปสินค้าเรียบร้อย (พบวัตถุดิบไม่พอ ระบบตัดติดลบให้แล้ว)'
        : 'บันทึกการแปรรูปสินค้าเรียบร้อย'
    });
  } catch (error) {
    const message = toProductionConfigErrorMessage(error);
    if (message) {
      return res.status(error?.statusCode || 400).json({
        success: false,
        message
      });
    }
    next(error);
  }
};

export const getProductionTransformConfigs = async (req, res, next) => {
  try {
    if (!canUseProductionTransform(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const isAdmin = ['admin', 'super_admin'].includes(req.user?.role);
    const userDepartmentId = Number(req.user?.department_id);
    const requestedDepartmentId = Number(req.query?.department_id);
    const search = String(req.query?.search || '').trim();

    let targetDepartmentId = requestedDepartmentId;
    if (!isAdmin) {
      if (!Number.isFinite(userDepartmentId)) {
        return res.status(400).json({
          success: false,
          message: 'ไม่พบแผนกผู้ใช้งาน'
        });
      }
      if (Number.isFinite(requestedDepartmentId) && requestedDepartmentId !== userDepartmentId) {
        return res.status(403).json({
          success: false,
          message: 'ไม่สามารถดูการตั้งค่าข้ามแผนกได้'
        });
      }
      targetDepartmentId = userDepartmentId;
    }

    if (!Number.isFinite(targetDepartmentId) || targetDepartmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'กรุณาระบุแผนกฝ่ายผลิต'
      });
    }

    const data = await productionTransformConfigModel.getProductionTransformConfigOverview({
      departmentId: targetDepartmentId,
      search
    });

    res.json({
      success: true,
      data
    });
  } catch (error) {
    const message = toProductionConfigErrorMessage(error);
    if (message) {
      return res.status(error?.statusCode || 400).json({
        success: false,
        message
      });
    }
    next(error);
  }
};

export const upsertProductionTransformConfig = async (req, res, next) => {
  try {
    const isAdmin = ['admin', 'super_admin'].includes(req.user?.role);
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin only.'
      });
    }

    const {
      department_id,
      output_product_id,
      requires_base_ingredient,
      required_ingredient_product_ids
    } = req.body || {};

    if (!department_id || !output_product_id) {
      return res.status(400).json({
        success: false,
        message: 'department_id และ output_product_id จำเป็นต้องระบุ'
      });
    }

    const data = await productionTransformConfigModel.upsertProductionTransformProductConfig({
      departmentId: Number(department_id),
      outputProductId: Number(output_product_id),
      requiresBaseIngredient: Boolean(requires_base_ingredient),
      requiredIngredientProductIds: required_ingredient_product_ids,
      userId: req.user?.id || null
    });

    res.json({
      success: true,
      message: 'บันทึกการตั้งค่าสูตรแปรรูปเรียบร้อย',
      data
    });
  } catch (error) {
    const message = toProductionConfigErrorMessage(error);
    if (message) {
      return res.status(error?.statusCode || 400).json({
        success: false,
        message
      });
    }
    next(error);
  }
};

/**
 * GET /api/inventory/production/transform/history
 * ประวัติการแปรรูปสินค้า
 */
export const getProductionTransformHistory = async (req, res, next) => {
  try {
    if (!canUseProductionTransform(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const {
      department_id,
      date,
      start_date,
      end_date,
      limit
    } = req.query || {};

    const userDepartmentId = Number(req.user?.department_id);
    const requestedDepartmentId = department_id ? Number(department_id) : null;
    const isAdmin = ['admin', 'super_admin'].includes(req.user?.role);

    let normalizedDepartmentId = requestedDepartmentId;
    if (!isAdmin && Number.isFinite(userDepartmentId)) {
      if (Number.isFinite(requestedDepartmentId) && requestedDepartmentId !== userDepartmentId) {
        return res.status(403).json({
          success: false,
          message: 'ไม่สามารถดูประวัติข้ามแผนกได้'
        });
      }
      normalizedDepartmentId = userDepartmentId;
    }

    const filters = {};
    if (Number.isFinite(normalizedDepartmentId)) {
      filters.departmentId = normalizedDepartmentId;
    }

    if (date) {
      filters.startDate = String(date);
      filters.endDate = String(date);
    } else {
      if (start_date) filters.startDate = String(start_date);
      if (end_date) filters.endDate = String(end_date);
    }

    if (limit) {
      filters.limit = Number(limit);
    }

    const history = await inventoryModel.getProductionTransformHistory(filters);
    return res.json({
      success: true,
      data: history,
      count: history.length
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/inventory/production/transform/:transactionId
 * แก้ไขประวัติการแปรรูปสินค้า
 */
export const updateProductionTransform = async (req, res, next) => {
  try {
    if (!canUseProductionTransform(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const { transactionId } = req.params;
    const { output_quantity, notes } = req.body || {};

    const isAdmin = ['admin', 'super_admin'].includes(req.user?.role);
    const userDepartmentId = Number(req.user?.department_id);

    const result = await inventoryModel.updateProductionTransform({
      transactionId: Number(transactionId),
      outputQuantity: output_quantity,
      notes,
      userDepartmentId,
      isAdmin
    });

    return res.json({
      success: true,
      data: result,
      message: 'แก้ไขประวัติการแปรรูปเรียบร้อย'
    });
  } catch (error) {
    next(error);
  }
};

// ====================================
// Realtime Balance (ประมาณการ)
// ====================================

/**
 * GET /api/inventory/realtime-balance?department_id=X
 *
 * คืนยอดคงเหลือสินค้ามูลค่าสูงในแผนก พร้อม estimated_qty
 * estimated_qty = inventory_balance - ยอดขายวันนี้จาก ClickHouse ที่ยังไม่ได้ sync
 *
 * Logic:
 *  1. ดึง balances (highValueOnly) ของแผนกจาก MySQL
 *  2. ดึง barcodes ของสินค้าในแผนกจาก menu_recipes (barcode → product_id mapping)
 *  3. Query ClickHouse หายอดขายวันนี้ สำหรับ barcodes นั้น × branch
 *  4. ตรวจว่าแผนกนี้มีการ sync ไปแล้วในวันนี้หรือยัง
 *     - ถ้า sync แล้ว → estimated_qty = quantity (ไม่ต้องหักซ้ำ)
 *     - ถ้ายังไม่ sync → estimated_qty = quantity - deduction จาก ClickHouse
 *  5. Return พร้อม metadata: clickhouse_available, already_synced, as_of_date
 */
export const getRealtimeBalance = async (req, res, next) => {
  try {
    const includePendingTransfer = String(req.query.include_pending_transfer || '').trim() === 'true';
    // ค่าเริ่มต้นแสดงเฉพาะสินค้ามูลค่าสูง (ตั้งค่าเช็คทุกวัน) — ส่ง high_value_only=false เพื่อดูทุกสินค้าในแผนก
    const highValueOnly = String(req.query.high_value_only ?? 'true').trim() !== 'false';
    if (!req.query.department_id && isAdminUser(req.user)) {
      return res.status(400).json({ success: false, message: 'department_id is required' });
    }
    const scope = resolveReadScope(req, res, { departmentId: req.query.department_id });
    if (!scope) return;
    const departmentId = scope.departmentId;

    // ── 1. ยอดคงเหลือปัจจุบันจาก MySQL ──────────────────────────────────────
    const balanceResult = await inventoryModel.getAllBalances({
      departmentId,
      highValueOnly,
      includePendingTransfer,
      limit: 500
    });
    const balances = balanceResult?.data ?? [];

    if (balances.length === 0) {
      return res.json({
        success: true,
        data: [],
        meta: { clickhouse_available: false, already_synced: false, as_of_date: null }
      });
    }

    // ── 2. ดึง branch ของแผนกนี้ ────────────────────────────────────────────
    const branchId = balances[0]?.branch_id;
    const branch = branchId ? await getBranchById(branchId) : null;
    const clickhouseBranchId = String(branch?.clickhouse_branch_id || '').trim();

    // วันปัจจุบัน (TH timezone)
    const now = new Date();
    const todayStr = new Date(now.getTime() + CLICKHOUSE_TZ_OFFSET * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    // ── 3. ตรวจว่าวันนี้ sync แล้วยัง ────────────────────────────────────────
    // ถ้ามี recipe_sale transaction วันนี้ใน department นี้ → sync แล้ว → ไม่ต้องหักซ้ำ
    const [[syncedRow]] = await pool.query(
      `SELECT COUNT(*) AS cnt
       FROM inventory_transactions
       WHERE department_id = ?
         AND transaction_type = 'recipe_sale'
         AND DATE(created_at) = ?`,
      [departmentId, todayStr]
    );
    const alreadySynced = Number(syncedRow?.cnt || 0) > 0;

    // ── 4. ถ้า sync แล้ว หรือไม่มี ClickHouse branch → คืน quantity ตรงๆ ──
    if (alreadySynced || !clickhouseBranchId) {
      const data = balances.map((b) => ({
        ...b,
        estimated_qty: parseFloat(b.quantity ?? 0),
        ch_deduction: 0,
        is_estimated: false
      }));
      return res.json({
        success: true,
        data: withProductGroupAliases(data),
        meta: {
          clickhouse_available: Boolean(clickhouseBranchId),
          already_synced: alreadySynced,
          as_of_date: todayStr
        }
      });
    }

    // ── 5. ดึง product_id → barcodes จาก menu_recipes ──────────────────────
    // หา product_id ทั้งหมดในแผนก
    const productIds = balances.map((b) => b.product_id);
    if (productIds.length === 0) {
      return res.json({ success: true, data: [], meta: { clickhouse_available: true, already_synced: false, as_of_date: todayStr } });
    }

    const placeholders = productIds.map(() => '?').join(',');

    // ดึง recipe items: product_id, barcode, quantity ต่อหน่วย
    // join menu_recipes (barcode) → menu_recipe_items (product_id, quantity, unit_id)
    const [recipeRows] = await pool.query(
      `SELECT
         mri.product_id,
         mr.menu_barcode AS barcode,
         mri.quantity    AS qty_per_sale,
         mri.unit_id,
         p.unit_id       AS product_unit_id
       FROM menu_recipe_items mri
       JOIN menu_recipes mr ON mr.id = mri.recipe_id AND mr.is_active = true
       JOIN products p ON p.id = mri.product_id
       WHERE mri.product_id IN (${placeholders})`,
      productIds
    );

    if (recipeRows.length === 0) {
      // ไม่มี recipe เลย → ไม่รู้จะหักยังไง คืน quantity ตรงๆ
      const data = balances.map((b) => ({
        ...b,
        estimated_qty: parseFloat(b.quantity ?? 0),
        ch_deduction: 0,
        is_estimated: false
      }));
      return res.json({
        success: true,
        data: withProductGroupAliases(data),
        meta: { clickhouse_available: true, already_synced: false, as_of_date: todayStr, note: 'no_recipe_found' }
      });
    }

    // สร้าง map: barcode → [ { product_id, qty_per_sale } ]
    const barcodeToIngredients = new Map();
    const barcodes = [];
    for (const row of recipeRows) {
      const bc = String(row.barcode || '').trim();
      if (!bc) continue;
      if (!barcodeToIngredients.has(bc)) {
        barcodeToIngredients.set(bc, []);
        barcodes.push(bc);
      }
      barcodeToIngredients.get(bc).push({
        product_id: row.product_id,
        qty_per_sale: parseFloat(row.qty_per_sale || 0)
      });
    }

    // ── 6. Query ClickHouse หายอดขายวันนี้ per barcode ─────────────────────
    let clickhouseAvailable = false;
    // map: product_id → total_deduction
    const deductionMap = new Map(); // product_id → number

    if (barcodes.length > 0) {
      try {
        const bcList = barcodes.map((b) => `'${escapeValue(b)}'`).join(', ');
        const salesSql = `
          SELECT dd.barcode,
                 sum(dd.qty) AS total_qty
          FROM doc d
          JOIN docdetail dd ON d.shopid = dd.shopid AND d.docno = dd.docno
          WHERE d.shopid = '${escapeValue(CLICKHOUSE_SHOP_ID)}'
            AND d.transflag = 44
            AND dd.transflag = 44
            AND d.iscancel  = 0
            AND toDate(addHours(d.docdatetime, ${CLICKHOUSE_TZ_OFFSET})) = toDate('${escapeValue(todayStr)}')
            AND d.branchid  = '${escapeValue(clickhouseBranchId)}'
            AND dd.barcode  IN (${bcList})
          GROUP BY dd.barcode
        `;

        const salesRows = await queryClickHouse(salesSql);
        clickhouseAvailable = true;

        // คำนวณ deduction ต่อ product_id
        for (const row of salesRows) {
          const bc = String(row.barcode || '').trim();
          const soldQty = parseFloat(row.total_qty || 0);
          const ingredients = barcodeToIngredients.get(bc) || [];
          for (const ing of ingredients) {
            const prev = deductionMap.get(ing.product_id) || 0;
            deductionMap.set(ing.product_id, prev + soldQty * ing.qty_per_sale);
          }
        }
      } catch (err) {
        // ClickHouse ล้มเหลว → คืน quantity ตรงๆ ไม่ error ทั้งหน้า
        clickhouseAvailable = false;
      }
    }

    // ── 7. Build response ────────────────────────────────────────────────────
    const data = balances.map((b) => {
      const current = parseFloat(b.quantity ?? 0);
      const deduction = deductionMap.get(b.product_id) || 0;
      const estimated = clickhouseAvailable ? current - deduction : current;
      return {
        ...b,
        // ไม่ให้ประมาณการดันยอดบวกให้ต่ำกว่า 0 แต่ถ้ายอดจริงติดลบอยู่แล้วต้องแสดงติดลบตามจริง
        estimated_qty: current < 0 ? estimated : Math.max(estimated, 0),
        ch_deduction: deduction,
        is_estimated: clickhouseAvailable && deduction > 0
      };
    });

    return res.json({
      success: true,
      data: withProductGroupAliases(data),
      meta: {
        clickhouse_available: clickhouseAvailable,
        already_synced: false,
        as_of_date: todayStr
      }
    });
  } catch (error) {
    next(error);
  }
};
