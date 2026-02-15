import * as inventoryModel from '../models/inventory.model.js';
import { withProductGroupAliases } from '../utils/product-group.js';

const PRODUCTION_BRANCH_ID = 4;

const canUseProductionTransform = (user) => {
  const isAdmin = ['admin', 'super_admin'].includes(user?.role);
  const isProductionDepartment = Boolean(user?.is_production_department);
  const isLegacyProductionBranch = Number(user?.branch_id) === PRODUCTION_BRANCH_ID;
  return isAdmin || isProductionDepartment || isLegacyProductionBranch;
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

    const filters = {};
    if (department_id) filters.departmentId = Number(department_id);
    if (branch_id) filters.branchId = Number(branch_id);
    if (start_date) filters.startDate = String(start_date);
    if (end_date) filters.endDate = String(end_date);

    const stats = await inventoryModel.getDashboardStats(filters);

    // ดึงสินค้าที่ต่ำกว่า Min
    const lowStockItems = await inventoryModel.getAllBalances({
      ...filters,
      lowStock: true
    });

    res.json({
      success: true,
      data: {
        stats,
        low_stock_items: lowStockItems.slice(0, 10) // แสดงแค่ 10 รายการแรก
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
      search
    } = req.query;

    const filters = {};
    if (department_id) filters.departmentId = Number(department_id);
    if (branch_id) filters.branchId = Number(branch_id);
    if (product_id) filters.productId = Number(product_id);
    if (supplier_id || product_group_id) {
      filters.supplierId = Number(product_group_id ?? supplier_id);
    }
    if (low_stock === 'true') filters.lowStock = true;
    if (search) filters.search = search;

    const balances = await inventoryModel.getAllBalances(filters);

    res.json({
      success: true,
      data: withProductGroupAliases(balances),
      count: balances.length
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
      start_date,
      end_date,
      limit,
      offset
    } = req.query;

    const filters = {};
    if (product_id) filters.productId = Number(product_id);
    if (department_id) filters.departmentId = Number(department_id);
    if (branch_id) filters.branchId = Number(branch_id);
    if (transaction_type) filters.transactionType = transaction_type;
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

    const validTypes = ['receive', 'sale', 'adjustment', 'transfer_in', 'transfer_out', 'initial'];
    if (!validTypes.includes(transaction_type)) {
      return res.status(400).json({
        success: false,
        message: `Invalid transaction type. Must be one of: ${validTypes.join(', ')}`
      });
    }

    const result = await inventoryModel.createTransaction({
      product_id: Number(product_id),
      department_id: Number(department_id),
      transaction_type,
      quantity: parseFloat(quantity),
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

    const balances = await inventoryModel.getAllBalances({
      productId: Number(productId),
      departmentId: Number(departmentId)
    });

    const productInfo = balances[0] || null;

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
    const { date, department_id, branch_id, variance_only } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Date is required'
      });
    }

    const filters = {};
    if (department_id) filters.departmentId = Number(department_id);
    if (branch_id) filters.branchId = Number(branch_id);
    if (variance_only === 'true') filters.showVarianceOnly = true;

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
    const { date, department_id } = req.body;

    if (!date || !department_id) {
      return res.status(400).json({
        success: false,
        message: 'Date and Department ID are required'
      });
    }

    const result = await inventoryModel.applyStockAdjustment(
      date,
      Number(department_id),
      req.user?.id || null
    );

    res.json({
      success: true,
      data: result,
      message: `Applied ${result.total_adjustments} adjustments successfully`
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

    // สร้าง initial transaction
    const result = await inventoryModel.createTransaction({
      product_id: Number(product_id),
      department_id: Number(department_id),
      transaction_type: 'initial',
      quantity: parseFloat(quantity),
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
      department_id,
      output_product_id,
      output_quantity,
      ingredients,
      notes
    } = req.body || {};

    if (!department_id || !output_product_id || output_quantity === undefined) {
      return res.status(400).json({
        success: false,
        message: 'department_id, output_product_id and output_quantity are required'
      });
    }

    if (!Array.isArray(ingredients) || ingredients.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'ingredients is required'
      });
    }

    const result = await inventoryModel.createProductionTransform({
      departmentId: Number(department_id),
      outputProductId: Number(output_product_id),
      outputQuantity: Number(output_quantity),
      ingredients,
      notes: notes ? String(notes) : '',
      createdBy: req.user?.id || null
    });

    return res.status(201).json({
      success: true,
      data: result,
      message: 'บันทึกการแปรรูปสินค้าเรียบร้อย'
    });
  } catch (error) {
    next(error);
  }
};
