import * as adminModel from '../models/admin.model.js';
import * as purchaseWalkModel from '../models/purchase-walk.model.js';
import * as purchaseWalkManualModel from '../models/purchase-walk-manual.model.js';
import * as orderModel from '../models/order.model.js';
import {
  resolveProductGroupId,
  withProductGroupAliases
} from '../utils/product-group.js';

const parseDateOnly = (value) => {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
};

const getToday = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

const toDateOnlyString = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getScopedProductGroupIds = (req) => {
  const isAdmin = ['admin', 'super_admin'].includes(req.user?.role);
  if (isAdmin) return [];
  const canViewProductGroups =
    req.user?.can_view_product_group_orders ?? req.user?.can_view_supplier_orders;
  if (!canViewProductGroups) return [];
  const allowedIds = req.user?.allowed_product_group_ids ?? req.user?.allowed_supplier_ids;
  return Array.isArray(allowedIds)
    ? allowedIds
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
    : [];
};

const DEPARTMENT_ACTIVITY_TYPES = ['stock_check', 'receiving', 'production_transform'];

const isValidDepartmentActivityType = (type) => DEPARTMENT_ACTIVITY_TYPES.includes(type);

// ดึงคำสั่งซื้อทั้งหมด
export const getAllOrders = async (req, res, next) => {
  try {
    const { status, date, branchId, departmentId } = req.query;

    const filters = {};
    if (status) filters.status = status;
    if (date) filters.date = date;
    if (branchId) filters.branchId = branchId;
    if (departmentId) filters.departmentId = departmentId;
    const scopedProductGroupIds = getScopedProductGroupIds(req);
    if (scopedProductGroupIds.length > 0) {
      filters.supplierIds = scopedProductGroupIds;
    }

    const orders = await adminModel.getAllOrders(filters);

    res.json({
      success: true,
      data: orders,
      count: orders.length
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

// ดึงคำสั่งซื้อแยกตามสาขา/แผนก
export const getOrdersByBranch = async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];

    const branches = await adminModel.getOrdersByBranch(date);

    res.json({
      success: true,
      data: branches,
      date
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

// ดึงคำสั่งซื้อแยกตาม supplier
export const getOrdersBySupplier = async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];

    const suppliers = await adminModel.getOrdersBySupplier(date);

    res.json({
      success: true,
      data: withProductGroupAliases(suppliers),
      date
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

export const getOrdersByProductGroup = getOrdersBySupplier;

export const getPriceReportByRange = async (req, res, next) => {
  try {
    const endDateObj = parseDateOnly(req.query.end || req.query.date) || getToday();
    const startDateObj = parseDateOnly(req.query.start) || (() => {
      const fallback = new Date(endDateObj);
      fallback.setDate(fallback.getDate() - 29);
      return fallback;
    })();

    const start = startDateObj <= endDateObj ? startDateObj : endDateObj;
    const end = startDateObj <= endDateObj ? endDateObj : startDateObj;
    const startDate = toDateOnlyString(start);
    const endDate = toDateOnlyString(end);

    const scopedProductGroupIds = getScopedProductGroupIds(req);
    const items = await adminModel.getPriceReportByRange({
      startDate,
      endDate,
      supplierIds: scopedProductGroupIds
    });

    res.json({
      success: true,
      data: withProductGroupAliases(items),
      start_date: startDate,
      end_date: endDate,
      count: items.length
    });
  } catch (error) {
    next(error);
  }
};

// ดึงรายการสินค้าตามวัน (สำหรับ print/purchase)
export const getOrderItemsByDate = async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const statuses = req.query.status ? req.query.status.split(',') : [];
    const scopedProductGroupIds = getScopedProductGroupIds(req);
    const items = await adminModel.getOrderItemsByDate(
      date,
      statuses,
      scopedProductGroupIds
    );

    res.json({
      success: true,
      data: withProductGroupAliases(items),
      date
    });
  } catch (error) {
    next(error);
  }
};

// ดึงรายการรับของตามแผนก (สำหรับ admin)
export const getReceivingItems = async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const rawDepartmentIds = req.query.departmentIds || req.query.department_ids || '';
    const departmentIds = rawDepartmentIds
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));

    if (departmentIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'departmentIds is required'
      });
    }

    const items = await orderModel.getReceivingItemsByDepartments({
      date,
      departmentIds
    });

    res.json({
      success: true,
      data: items,
      count: items.length,
      date
    });
  } catch (error) {
    next(error);
  }
};

// บันทึกรับของ (admin)
export const updateReceivingItems = async (req, res, next) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'items is required'
      });
    }

    const result = await orderModel.updateReceivingItems(items, req.user.id);

    res.json({
      success: true,
      message: 'Receiving updated',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

// รับของครบตามที่สั่ง (bulk)
export const bulkReceiveDepartments = async (req, res, next) => {
  try {
    const date = req.body.date || new Date().toISOString().split('T')[0];
    const departmentIds = Array.isArray(req.body.department_ids)
      ? req.body.department_ids
      : Array.isArray(req.body.departmentIds)
        ? req.body.departmentIds
        : [];

    if (departmentIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'department_ids is required'
      });
    }

    const result = await orderModel.bulkReceiveByDepartments(
      date,
      departmentIds,
      req.user.id
    );

    res.json({
      success: true,
      message: 'Receiving confirmed',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

export const transferOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { department_id } = req.body;

    if (!department_id) {
      return res.status(400).json({
        success: false,
        message: 'department_id is required'
      });
    }

    await adminModel.transferOrderDepartment(orderId, department_id);
    const updated = await orderModel.getOrderById(orderId);

    res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    if (error.message === 'Order not found' || error.message === 'Department not found') {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    if (error.message === 'No active user in target department') {
      return res.status(400).json({
        success: false,
        message: 'ไม่มีผู้ใช้งานในแผนกที่เลือก'
      });
    }
    next(error);
  }
};

// รายงานการซื้อของ (แยกตามมุมมอง)
export const getPurchaseReport = async (req, res, next) => {
  try {
    const { start, end, groupBy, status, product_group_id } = req.query;
    const startDate = start || new Date().toISOString().split('T')[0];
    const endDate = end || startDate;
    const statuses = status ? String(status).split(',').map((value) => value.trim()) : [];
    const view = groupBy || 'branch';
    const productGroupId = Number(product_group_id);

    const report = await adminModel.getPurchaseReport({
      startDate,
      endDate,
      groupBy: view,
      statuses,
      productGroupId: Number.isFinite(productGroupId) && productGroupId > 0 ? productGroupId : null
    });

    res.json({
      success: true,
      data: withProductGroupAliases(report),
      count: report.length
    });
  } catch (error) {
    next(error);
  }
};

export const getPurchaseWalkValueReport = async (req, res, next) => {
  try {
    const {
      start,
      end,
      view,
      product_group_id,
      branch_id,
      department_id,
      status,
      price_mode,
      use_received
    } = req.query;
    const startDate = start || new Date().toISOString().split('T')[0];
    const endDate = end || startDate;
    const viewMode = ['branch', 'branch_department', 'total'].includes(String(view))
      ? String(view)
      : 'branch';
    const priceMode = ['default', 'latest', 'day'].includes(String(price_mode))
      ? String(price_mode)
      : 'day';
    const statuses = status ? String(status).split(',').map((value) => value.trim()) : [];
    const productGroupId = Number(product_group_id);
    const branchId = Number(branch_id);
    const departmentId = Number(department_id);
    const useReceived = ['1', 'true', 'yes', 'on'].includes(String(use_received).toLowerCase());

    const rows = await adminModel.getPurchaseWalkValueByDay({
      startDate,
      endDate,
      viewMode,
      priceMode,
      useReceived,
      branchId: Number.isFinite(branchId) && branchId > 0 ? branchId : null,
      departmentId: Number.isFinite(departmentId) && departmentId > 0 ? departmentId : null,
      productGroupId: Number.isFinite(productGroupId) && productGroupId > 0 ? productGroupId : null,
      statuses
    });

    res.json({
      success: true,
      data: rows,
      count: rows.length,
      start_date: startDate,
      end_date: endDate,
      view: viewMode,
      price_mode: priceMode,
      use_received: useReceived
    });
  } catch (error) {
    next(error);
  }
};

export const getPurchaseWalkValueDetailReport = async (req, res, next) => {
  try {
    const {
      start,
      end,
      product_group_id,
      branch_id,
      department_id,
      status,
      price_mode,
      use_received
    } = req.query;
    const startDate = start || new Date().toISOString().split('T')[0];
    const endDate = end || startDate;
    const priceMode = ['default', 'latest', 'day'].includes(String(price_mode))
      ? String(price_mode)
      : 'day';
    const statuses = status ? String(status).split(',').map((value) => value.trim()) : [];
    const productGroupId = Number(product_group_id);
    const branchId = Number(branch_id);
    const departmentId = Number(department_id);
    const useReceived = ['1', 'true', 'yes', 'on'].includes(String(use_received).toLowerCase());

    const rows = await adminModel.getPurchaseWalkValueDetail({
      startDate,
      endDate,
      priceMode,
      useReceived,
      branchId: Number.isFinite(branchId) && branchId > 0 ? branchId : null,
      departmentId: Number.isFinite(departmentId) && departmentId > 0 ? departmentId : null,
      productGroupId: Number.isFinite(productGroupId) && productGroupId > 0 ? productGroupId : null,
      statuses
    });

    res.json({
      success: true,
      data: rows,
      count: rows.length,
      start_date: startDate,
      end_date: endDate,
      price_mode: priceMode,
      use_received: useReceived
    });
  } catch (error) {
    next(error);
  }
};

export const getPurchaseWalkValueProductDetailByDateReport = async (req, res, next) => {
  try {
    const {
      start,
      end,
      product_id,
      product_group_id,
      branch_id,
      department_id,
      status,
      price_mode,
      use_received
    } = req.query;
    const startDate = start || new Date().toISOString().split('T')[0];
    const endDate = end || startDate;
    const priceMode = ['default', 'latest', 'day'].includes(String(price_mode))
      ? String(price_mode)
      : 'day';
    const statuses = status ? String(status).split(',').map((value) => value.trim()) : [];
    const productId = Number(product_id);
    const productGroupId = Number(product_group_id);
    const branchId = Number(branch_id);
    const departmentId = Number(department_id);
    const useReceived = ['1', 'true', 'yes', 'on'].includes(String(use_received).toLowerCase());

    const rows = await adminModel.getPurchaseWalkValueProductDetailByDate({
      startDate,
      endDate,
      productId: Number.isFinite(productId) && productId > 0 ? productId : null,
      priceMode,
      useReceived,
      branchId: Number.isFinite(branchId) && branchId > 0 ? branchId : null,
      departmentId: Number.isFinite(departmentId) && departmentId > 0 ? departmentId : null,
      productGroupId: Number.isFinite(productGroupId) && productGroupId > 0 ? productGroupId : null,
      statuses
    });

    res.json({
      success: true,
      data: rows,
      count: rows.length,
      start_date: startDate,
      end_date: endDate,
      price_mode: priceMode,
      use_received: useReceived
    });
  } catch (error) {
    next(error);
  }
};

export const getPurchaseReceiveReconcileReport = async (req, res, next) => {
  try {
    const { start, end, product_group_id, status } = req.query;
    const startDate = start || new Date().toISOString().split('T')[0];
    const endDate = end || startDate;
    const statuses = status ? String(status).split(',').map((value) => value.trim()) : [];
    const productGroupId = Number(product_group_id);

    const rows = await adminModel.getPurchaseReceiveReconcileReport({
      startDate,
      endDate,
      productGroupId: Number.isFinite(productGroupId) && productGroupId > 0 ? productGroupId : null,
      statuses
    });

    res.json({
      success: true,
      data: rows,
      count: rows.length,
      start_date: startDate,
      end_date: endDate
    });
  } catch (error) {
    next(error);
  }
};

export const getPurchaseOrderStatusLedger = async (req, res, next) => {
  try {
    const { date, product_group_id, branch_id, department_id, central_status, status } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];
    const statuses = status ? String(status).split(',').map((value) => value.trim()) : [];
    const productGroupId = Number(product_group_id);
    const branchId = Number(branch_id);
    const departmentId = Number(department_id);
    const allowedStatus = new Set([
      'all',
      'not_purchased',
      'missing_price',
      'not_received',
      'short_received',
      'over_received',
      'complete'
    ]);
    const statusFilter = allowedStatus.has(String(central_status))
      ? String(central_status)
      : 'all';

    const rows = await adminModel.getPurchaseOrderStatusLedger({
      date: targetDate,
      productGroupId: Number.isFinite(productGroupId) && productGroupId > 0 ? productGroupId : null,
      branchId: Number.isFinite(branchId) && branchId > 0 ? branchId : null,
      departmentId: Number.isFinite(departmentId) && departmentId > 0 ? departmentId : null,
      statusFilter,
      statuses
    });

    const summary = rows.reduce(
      (acc, row) => {
        const key = row.central_status || 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        acc.total += 1;
        return acc;
      },
      { total: 0 }
    );

    res.json({
      success: true,
      data: rows,
      count: rows.length,
      date: targetDate,
      summary
    });
  } catch (error) {
    next(error);
  }
};

export const getPurchaseReceivingSummaryReport = async (req, res, next) => {
  try {
    const { start, end, view, product_group_id, status } = req.query;
    const startDate = start || new Date().toISOString().split('T')[0];
    const endDate = end || startDate;
    const viewMode = ['branch', 'branch_department'].includes(String(view))
      ? String(view)
      : 'branch_department';
    const statuses = status ? String(status).split(',').map((value) => value.trim()) : [];
    const productGroupId = Number(product_group_id);

    const rows = await adminModel.getPurchaseReceivingSummaryReport({
      startDate,
      endDate,
      viewMode,
      productGroupId: Number.isFinite(productGroupId) && productGroupId > 0 ? productGroupId : null,
      statuses
    });

    const data = rows.map((row) => {
      const incompleteCount = Number(row.incomplete_line_count || 0);
      const unpurchasedCount = Number(row.unpurchased_line_count || 0);
      const missingPriceCount = Number(row.missing_price_line_count || 0);
      const pricingReady = incompleteCount === 0;

      let warningMessage = null;
      if (!pricingReady) {
        const parts = [];
        if (unpurchasedCount > 0) {
          parts.push(`ยังไม่บันทึกเดินซื้อ ${unpurchasedCount} รายการ`);
        }
        if (missingPriceCount > 0) {
          parts.push(`ยังไม่ใส่จำนวน/ราคา ${missingPriceCount} รายการ`);
        }
        warningMessage = `กรุณาไปใส่จำนวนและราคาในหน้าเดินซื้อก่อน (${parts.join(' • ')})`;
      }

      return {
        ...row,
        pricing_ready: pricingReady,
        warning_message: warningMessage
      };
    });

    res.json({
      success: true,
      data,
      count: data.length,
      start_date: startDate,
      end_date: endDate,
      view: viewMode
    });
  } catch (error) {
    next(error);
  }
};

export const getPurchaseReceivingSummaryDetail = async (req, res, next) => {
  try {
    const { start, end, product_group_id, branch_id, department_id, status } = req.query;
    const startDate = start || new Date().toISOString().split('T')[0];
    const endDate = end || startDate;
    const statuses = status ? String(status).split(',').map((v) => v.trim()) : [];

    const rows = await adminModel.getPurchaseReceivingSummaryDetail({
      startDate,
      endDate,
      productGroupId: Number(product_group_id) || null,
      branchId: Number(branch_id) || null,
      departmentId: Number(department_id) || null,
      statuses
    });

    res.json({ success: true, data: rows, count: rows.length });
  } catch (error) {
    next(error);
  }
};

export const getPurchaseReceiveReconcileDetail = async (req, res, next) => {
  try {
    const { date, product_id, product_group_id, status } = req.query;
    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'date is required'
      });
    }
    const productId = Number(product_id);
    const productGroupId = Number(product_group_id);
    if (!Number.isFinite(productId) || productId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'product_id is required'
      });
    }
    if (!Number.isFinite(productGroupId) || productGroupId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'product_group_id is required'
      });
    }

    const statuses = status ? String(status).split(',').map((value) => value.trim()) : [];
    const rows = await adminModel.getPurchaseReceiveReconcileDetail({
      date,
      productId,
      productGroupId,
      statuses
    });

    res.json({
      success: true,
      data: rows,
      count: rows.length,
      date
    });
  } catch (error) {
    next(error);
  }
};

export const getDepartmentActivitySummary = async (req, res, next) => {
  try {
    const type = String(req.query.type || '').trim();
    if (!isValidDepartmentActivityType(type)) {
      return res.status(400).json({
        success: false,
        message: 'type must be one of stock_check, receiving, production_transform'
      });
    }

    let rows = [];
    if (type === 'stock_check') {
      rows = await adminModel.getDepartmentStockCheckActivitySummary();
    } else if (type === 'receiving') {
      rows = await adminModel.getDepartmentReceivingActivitySummary();
    } else if (type === 'production_transform') {
      rows = await adminModel.getDepartmentProductionTransformActivitySummary();
    }

    return res.json({
      success: true,
      data: rows,
      count: rows.length,
      type
    });
  } catch (error) {
    next(error);
  }
};

export const getDepartmentActivityDetail = async (req, res, next) => {
  try {
    const type = String(req.query.type || '').trim();
    const departmentId = Number(req.params.departmentId);
    const limit = Number(req.query.limit || 120);

    if (!isValidDepartmentActivityType(type)) {
      return res.status(400).json({
        success: false,
        message: 'type must be one of stock_check, receiving, production_transform'
      });
    }

    if (!Number.isFinite(departmentId)) {
      return res.status(400).json({
        success: false,
        message: 'departmentId is required'
      });
    }

    let rows = [];
    if (type === 'stock_check') {
      rows = await adminModel.getDepartmentStockCheckActivityDetail(departmentId, limit);
    } else if (type === 'receiving') {
      rows = await adminModel.getDepartmentReceivingActivityDetail(departmentId, limit);
    } else if (type === 'production_transform') {
      rows = await adminModel.getDepartmentProductionTransformActivityDetail(departmentId, limit);
    }

    return res.json({
      success: true,
      data: rows,
      count: rows.length,
      department_id: departmentId,
      type
    });
  } catch (error) {
    next(error);
  }
};

// ปิดรับคำสั่งซื้อ
export const closeOrders = async (req, res, next) => {
  try {
    const date = req.body.date || new Date().toISOString().split('T')[0];

    const result = await adminModel.toggleOrderReceiving(date, false, req.user.id);

    res.json({
      success: true,
      message: 'Order receiving closed successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

// เปิดรับคำสั่งซื้อ
export const openOrders = async (req, res, next) => {
  try {
    const date = req.body.date || new Date().toISOString().split('T')[0];
    const parsedDate = parseDateOnly(date);
    const today = getToday();

    if (!parsedDate) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date'
      });
    }

    const diffDays = Math.floor((parsedDate - today) / (1000 * 60 * 60 * 24));
    if (diffDays < 0 || diffDays > 7) {
      return res.status(400).json({
        success: false,
        message: 'Order date must be within 7 days from today'
      });
    }

    const result = await adminModel.toggleOrderReceiving(date, true, req.user.id);

    res.json({
      success: true,
      message: 'Order receiving opened successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

// บันทึกการซื้อจริง
export const recordPurchase = async (req, res, next) => {
  try {
    const { itemId } = req.params;
    const { actual_price, is_purchased, purchase_reason } = req.body;

    if (actual_price === undefined || is_purchased === undefined) {
      return res.status(400).json({
        success: false,
        message: 'actual_price and is_purchased are required'
      });
    }

    const result = await adminModel.recordPurchase(
      itemId,
      actual_price,
      is_purchased,
      purchase_reason ?? null
    );

    res.json({
      success: true,
      message: 'Purchase recorded successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

// บันทึกการซื้อจริงแบบรวมตามสินค้า
export const recordPurchaseByProduct = async (req, res, next) => {
  try {
    const {
      product_id,
      date,
      order_item_ids,
      actual_price,
      actual_quantity,
      is_purchased,
      purchase_reason
    } = req.body;

    if (!product_id || !date) {
      return res.status(400).json({
        success: false,
        message: 'product_id and date are required'
      });
    }

    const scopedOrderItemIds = Array.isArray(order_item_ids)
      ? order_item_ids
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
      : [];

    const result = await adminModel.recordPurchaseByProduct(
      date,
      product_id,
      actual_price ?? null,
      actual_quantity ?? null,
      is_purchased ?? true,
      purchase_reason ?? null,
      scopedOrderItemIds
    );

    res.json({
      success: true,
      message: 'Purchase recorded successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

// ตั้งค่าการเดินซื้อของ: ดึงรายการสินค้าเพื่อจัดเรียง
export const getPurchaseWalkProducts = async (req, res, next) => {
  try {
    const productGroupId = resolveProductGroupId(req.query);
    const products = await purchaseWalkModel.getPurchaseWalkProducts(productGroupId);

    res.json({
      success: true,
      data: withProductGroupAliases(products),
      count: products.length
    });
  } catch (error) {
    next(error);
  }
};

// ตั้งค่าการเดินซื้อของ: บันทึกการจัดเรียงสินค้า
export const updatePurchaseWalkOrder = async (req, res, next) => {
  try {
    const { product_ids } = req.body;
    const product_group_id = resolveProductGroupId(req.body);

    if (!product_group_id) {
      return res.status(400).json({
        success: false,
        message: 'product_group_id is required'
      });
    }

    if (!Array.isArray(product_ids) || product_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'product_ids is required'
      });
    }

    const normalizedIds = product_ids.map((id) => Number(id)).filter(Boolean);

    const result = await purchaseWalkModel.updatePurchaseWalkOrder(
      product_group_id,
      normalizedIds
    );

    res.json({
      success: true,
      data: result,
      message: 'Purchase walk order updated'
    });
  } catch (error) {
    next(error);
  }
};

export const getPurchaseWalkManualItems = async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const rows = await purchaseWalkManualModel.getPurchaseWalkManualItems(date);
    res.json({
      success: true,
      data: rows,
      date
    });
  } catch (error) {
    next(error);
  }
};

export const createPurchaseWalkManualItem = async (req, res, next) => {
  try {
    const payload = req.body || {};
    const created = await purchaseWalkManualModel.createPurchaseWalkManualItem(
      payload,
      req.user?.id
    );
    res.status(201).json({
      success: true,
      data: created
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

export const updatePurchaseWalkManualItem = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: 'invalid id'
      });
    }

    const payload = req.body || {};
    const updated = await purchaseWalkManualModel.updatePurchaseWalkManualItem(
      id,
      payload,
      req.user?.id
    );
    res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

export const deletePurchaseWalkManualItem = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: 'invalid id'
      });
    }

    const result = await purchaseWalkManualModel.deletePurchaseWalkManualItem(
      id,
      req.user?.id
    );
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

// รีเซ็ตวันสั่งซื้อ (ใช้สำหรับทดสอบ)
export const resetOrderDay = async (req, res, next) => {
  try {
    const date = req.body.date || new Date().toISOString().split('T')[0];
    const parsedDate = parseDateOnly(date);

    if (!parsedDate) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date'
      });
    }

    const result = await adminModel.resetOrderDay(date);

    res.json({
      success: true,
      message: 'Order day reset successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

// รีเซ็ตคำสั่งซื้อรายบุคคล
export const resetOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'Order ID is required'
      });
    }

    const result = await adminModel.resetOrder(orderId);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    res.json({
      success: true,
      message: 'Order reset successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

// รีเซ็ตคำสั่งซื้อทั้งหมด
export const resetAllOrders = async (req, res, next) => {
  try {
    const result = await adminModel.resetAllOrders();

    res.json({
      success: true,
      message: 'All orders reset successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

// เปลี่ยนสถานะคำสั่งซื้อ
export const updateOrderStatus = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }

    const validStatuses = ['draft', 'submitted', 'confirmed', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    const result = await adminModel.updateOrderStatus(orderId, status);

    res.json({
      success: true,
      message: 'Order status updated successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

// ยืนยันการซื้อของเสร็จ (อัปเดตคำสั่งซื้อที่ซื้อครบเป็น completed)
export const completePurchasesByDate = async (req, res, next) => {
  try {
    const { date } = req.body;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Date is required'
      });
    }

    const result = await adminModel.completeOrdersByDate(date);

    res.json({
      success: true,
      message: 'Orders updated successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

export const completePurchasesBySupplier = async (req, res, next) => {
  try {
    const { date } = req.body;
    const product_group_id = resolveProductGroupId(req.body);

    if (!date || !product_group_id) {
      return res.status(400).json({
        success: false,
        message: 'date and product_group_id are required'
      });
    }

    const result = await adminModel.completeOrdersBySupplier(date, product_group_id);

    res.json({
      success: true,
      message: 'Orders updated successfully',
      data: withProductGroupAliases(result)
    });
  } catch (error) {
    next(error);
  }
};

export const completePurchasesByProductGroup = completePurchasesBySupplier;
