import * as inventoryModel from '../models/inventory.model.js';
import { withProductGroupAliases } from '../utils/product-group.js';
import pool from '../config/database.js';
import { getBranchById } from '../models/branch.model.js';
import { queryClickHouse } from '../services/clickhouse.service.js';

const PRODUCTION_BRANCH_ID = 4;
const CLICKHOUSE_SHOP_ID =
  process.env.CLICKHOUSE_SHOP_ID || '2OJMVIo1Qi81NqYos3oDPoASziy';
const CLICKHOUSE_TZ_OFFSET = Number(process.env.CLICKHOUSE_TZ_OFFSET || 7);

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
    const lowStockResult = await inventoryModel.getAllBalances({
      ...filters,
      lowStock: true
    });
    const lowStockItems = Array.isArray(lowStockResult?.data)
      ? lowStockResult.data
      : [];

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
      high_value_only,
      recipe_linked_only,
      search,
      page,
      limit
    } = req.query;

    const filters = {};
    if (department_id) filters.departmentId = Number(department_id);
    if (branch_id) filters.branchId = Number(branch_id);
    if (product_id) filters.productId = Number(product_id);
    if (supplier_id || product_group_id) {
      filters.supplierId = Number(product_group_id ?? supplier_id);
    }
    if (low_stock === 'true') filters.lowStock = true;
    if (high_value_only === 'true') filters.highValueOnly = true;
    if (recipe_linked_only === 'true') filters.recipeLinkedOnly = true;
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

    const filters = {};
    if (product_id) filters.productId = Number(product_id);
    if (department_id) filters.departmentId = Number(department_id);
    if (branch_id) filters.branchId = Number(branch_id);
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

/**
 * DELETE /api/inventory/movements/sale
 * ลบ transaction ประเภท sale ในช่วงวันที่ที่ระบุ + ย้อน inventory_balance
 * Body: start_date, end_date (YYYY-MM-DD)
 * ต้องเป็น admin เท่านั้น
 */
export const deleteSaleMovements = async (req, res, next) => {
  try {
    const { start_date, end_date, department_id } = req.body;

    if (!start_date || !end_date) {
      return res.status(400).json({
        success: false,
        message: 'กรุณาระบุ start_date และ end_date (YYYY-MM-DD)'
      });
    }

    // ดึง transactions ที่จะลบมาก่อนเพื่อย้อน balance
    let selectQuery = `
      SELECT id, product_id, department_id, quantity, balance_before, balance_after
      FROM inventory_transactions
      WHERE transaction_type = 'sale'
        AND DATE(created_at) BETWEEN ? AND ?
    `;
    const selectParams = [start_date, end_date];

    if (department_id) {
      selectQuery += ' AND department_id = ?';
      selectParams.push(Number(department_id));
    }

    const [transactions] = await pool.query(selectQuery, selectParams);

    if (transactions.length === 0) {
      return res.json({
        success: true,
        message: 'ไม่พบรายการขายในช่วงวันที่ที่ระบุ',
        deleted: 0
      });
    }

    // จัดกลุ่ม: หา balance ที่ต้องย้อนกลับต่อ product+department
    // balance_before ของ transaction แรกสุด (เรียง created_at ASC) ของแต่ละ product+dept
    // คือยอดก่อนเริ่มขายในวันนั้น → ใช้เป็นฐานคำนวณ net
    // วิธีง่ายกว่า: รวม quantity ที่ถูกลบออก (ค่าลบอยู่แล้ว) แล้วบวกกลับเข้า balance
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // รวม qty per product+dept (quantity ของ sale จะเป็นค่าลบ เช่น -3)
      const netByKey = new Map();
      for (const tx of transactions) {
        const key = `${tx.product_id}_${tx.department_id}`;
        const prev = netByKey.get(key) || { product_id: tx.product_id, department_id: tx.department_id, net: 0 };
        prev.net += Number(tx.quantity); // quantity เป็นค่าลบ → รวมแล้วได้ผลลบ
        netByKey.set(key, prev);
      }

      // ย้อน balance: ลบ qty กลับ (บวก abs ของ net เพราะ net เป็นลบ)
      for (const { product_id, department_id: deptId, net } of netByKey.values()) {
        if (net === 0) continue;
        // net เป็นลบ (ขายออก) → ย้อนกลับ = ลบ net (เป็นบวก)
        await connection.query(
          `UPDATE inventory_balance
           SET quantity = quantity - ?,
               last_updated = CURRENT_TIMESTAMP
           WHERE product_id = ? AND department_id = ?`,
          [net, product_id, deptId]
        );
      }

      // ลบ transactions
      let deleteQuery = `
        DELETE FROM inventory_transactions
        WHERE transaction_type = 'sale'
          AND DATE(created_at) BETWEEN ? AND ?
      `;
      const deleteParams = [start_date, end_date];
      if (department_id) {
        deleteQuery += ' AND department_id = ?';
        deleteParams.push(Number(department_id));
      }
      const [deleteResult] = await connection.query(deleteQuery, deleteParams);

      await connection.commit();

      res.json({
        success: true,
        message: `ลบรายการขายออกเรียบร้อย และย้อนยอดสต็อกแล้ว`,
        deleted: deleteResult.affectedRows,
        affected_keys: netByKey.size
      });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
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
    const { date, department_id, product_ids, force_apply } = req.body;

    if (!date || !department_id) {
      return res.status(400).json({
        success: false,
        message: 'Date and Department ID are required'
      });
    }

    const departmentId = Number(department_id);
    const forceApply = toBoolean(force_apply);

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
      { productIds: normalizedProductIds }
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

    const result = await inventoryModel.createProductionTransform({
      transformDate: String(transform_date),
      departmentId: normalizedDepartmentId,
      outputProductId: Number(output_product_id),
      outputQuantity: Number(output_quantity),
      ingredients: Array.isArray(ingredients) ? ingredients : [],
      notes: notes ? String(notes) : '',
      createdBy: req.user?.id || null,
      allowedOutputGroupIds: Array.isArray(
        req.user?.allowed_product_group_ids ?? req.user?.allowed_supplier_ids
      )
        ? (req.user?.allowed_product_group_ids ?? req.user?.allowed_supplier_ids)
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id))
        : []
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
    const departmentId = Number(req.query.department_id);
    if (!departmentId) {
      return res.status(400).json({ success: false, message: 'department_id is required' });
    }

    // ── 1. ยอดคงเหลือปัจจุบันจาก MySQL ──────────────────────────────────────
    const balanceResult = await inventoryModel.getAllBalances({
      departmentId,
      highValueOnly: true,
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
        estimated_qty: Math.max(estimated, 0),   // ไม่ให้ต่ำกว่า 0
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
