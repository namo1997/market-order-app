import * as adminModel from '../models/admin.model.js';

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

// ดึงคำสั่งซื้อทั้งหมด
export const getAllOrders = async (req, res, next) => {
  try {
    const { status, date, branchId, departmentId } = req.query;

    const filters = {};
    if (status) filters.status = status;
    if (date) filters.date = date;
    if (branchId) filters.branchId = branchId;
    if (departmentId) filters.departmentId = departmentId;

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
      data: suppliers,
      date
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

    const items = await adminModel.getOrderItemsByDate(date, statuses);

    res.json({
      success: true,
      data: items,
      date
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
    const { actual_price, is_purchased } = req.body;

    if (actual_price === undefined || is_purchased === undefined) {
      return res.status(400).json({
        success: false,
        message: 'actual_price and is_purchased are required'
      });
    }

    const result = await adminModel.recordPurchase(
      itemId,
      actual_price,
      is_purchased
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
    const { product_id, date, actual_price, actual_quantity, is_purchased } = req.body;

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
      is_purchased ?? true
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
