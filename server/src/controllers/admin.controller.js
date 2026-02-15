import * as adminModel from '../models/admin.model.js';
import * as purchaseWalkModel from '../models/purchase-walk.model.js';
import * as orderModel from '../models/order.model.js';
import {
  resolveSupplierId,
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

const getScopedSupplierIds = (req) => {
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

// ดึงคำสั่งซื้อทั้งหมด
export const getAllOrders = async (req, res, next) => {
  try {
    const { status, date, branchId, departmentId } = req.query;

    const filters = {};
    if (status) filters.status = status;
    if (date) filters.date = date;
    if (branchId) filters.branchId = branchId;
    if (departmentId) filters.departmentId = departmentId;
    const scopedSupplierIds = getScopedSupplierIds(req);
    if (scopedSupplierIds.length > 0) {
      filters.supplierIds = scopedSupplierIds;
    }

    const orders = await adminModel.getAllOrders(filters);

    res.json({
      success: true,
      data: orders,
      count: orders.length
    });
  } catch (error) {
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
    next(error);
  }
};

export const getOrdersByProductGroup = getOrdersBySupplier;

// ดึงรายการสินค้าตามวัน (สำหรับ print/purchase)
export const getOrderItemsByDate = async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const statuses = req.query.status ? req.query.status.split(',') : [];
    const scopedSupplierIds = getScopedSupplierIds(req);
    const items = await adminModel.getOrderItemsByDate(
      date,
      statuses,
      scopedSupplierIds
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
    const { start, end, groupBy, status } = req.query;
    const startDate = start || new Date().toISOString().split('T')[0];
    const endDate = end || startDate;
    const statuses = status ? String(status).split(',').map((value) => value.trim()) : [];
    const view = groupBy || 'branch';

    const report = await adminModel.getPurchaseReport({
      startDate,
      endDate,
      groupBy: view,
      statuses
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

    const result = await adminModel.recordPurchaseByProduct(
      date,
      product_id,
      actual_price ?? null,
      actual_quantity ?? null,
      is_purchased ?? true,
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

// ตั้งค่าการเดินซื้อของ: ดึงรายการสินค้าเพื่อจัดเรียง
export const getPurchaseWalkProducts = async (req, res, next) => {
  try {
    const supplierId = resolveSupplierId(req.query);
    const products = await purchaseWalkModel.getPurchaseWalkProducts(supplierId);

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
    const supplier_id = resolveSupplierId(req.body);

    if (!supplier_id) {
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
      supplier_id,
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
    const supplier_id = resolveSupplierId(req.body);

    if (!date || !supplier_id) {
      return res.status(400).json({
        success: false,
        message: 'date and product_group_id are required'
      });
    }

    const result = await adminModel.completeOrdersBySupplier(date, supplier_id);

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
