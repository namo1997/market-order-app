import * as orderModel from '../models/order.model.js';
import * as settingsModel from '../models/settings.model.js';
import * as userModel from '../models/user.model.js';
import { sendLineOrderNotification } from '../utils/line.js';
import { withProductGroupAliases } from '../utils/product-group.js';

const getLineNotificationOptions = async () => {
  const lineEnabled =
    (await settingsModel.getSetting('line_notifications_enabled', 'true')) === 'true';
  if (!lineEnabled) {
    return null;
  }

  const accessToken = await settingsModel.getSetting(
    'line_channel_access_token',
    process.env.LINE_CHANNEL_ACCESS_TOKEN || ''
  );
  const defaultFields = ['date', 'branch', 'department', 'count', 'items'];
  const fieldsRaw = await settingsModel.getSetting(
    'line_notification_fields',
    JSON.stringify(defaultFields)
  );
  let fields = defaultFields;
  try {
    const parsed = JSON.parse(fieldsRaw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      fields = parsed;
    }
  } catch (parseError) {
    // fallback to default fields
  }

  const groupsRaw = await settingsModel.getSetting('line_notification_groups', '');
  let groups = [];
  if (groupsRaw) {
    try {
      const parsedGroups = JSON.parse(groupsRaw);
      if (Array.isArray(parsedGroups)) {
        groups = parsedGroups;
      }
    } catch (parseError) {
      groups = [];
    }
  }
  if (groups.length === 0) {
    const groupId = await settingsModel.getSetting(
      'line_group_id',
      process.env.LINE_GROUP_ID || ''
    );
    if (groupId) {
      groups = [
        {
          id: groupId,
          name: 'กลุ่ม LINE',
          enabled: true,
          fields
        }
      ];
    }
  }

  return {
    accessToken,
    defaultFields: fields,
    groups
  };
};

const PRODUCTION_SUPPLIER_CODE = 'SUP003';

const getProductionUser = async (userId) => {
  const user = await userModel.getUserById(userId);
  if (!user) return null;
  if (!Boolean(user.is_production)) return null;
  return user;
};

// ตรวจสอบสถานะการเปิด/ปิดรับออเดอร์
export const getOrderStatus = async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const status = await orderModel.getOrderStatus(date);

    res.json({
      success: true,
      data: withProductGroupAliases(status)
    });
  } catch (error) {
    next(error);
  }
};

// สร้างคำสั่งซื้อใหม่
export const createOrder = async (req, res, next) => {
  try {
    const { items, order_date } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one item is required'
      });
    }
    if (!order_date) {
      return res.status(400).json({
        success: false,
        message: 'Order date is required'
      });
    }

    const orderData = {
      user_id: req.user.id,
      items,
      order_date
    };

    const order = await orderModel.createOrder(orderData);
    try {
      const orderDetail = await orderModel.getOrderById(order.id);
      const lineOptions = await getLineNotificationOptions();
      if (lineOptions) {
        await sendLineOrderNotification(orderDetail, {
          ...lineOptions,
          title: '🟢 สั่งซื้อใหม่',
          eventType: 'order_created',
          orderId: orderDetail?.id
        });
      }
    } catch (notifyError) {
      console.error('Line notification error:', notifyError);
    }

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: withProductGroupAliases(order)
    });
  } catch (error) {
    if (error.message === 'Order receiving is closed for selected date') {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

// ดึงคำสั่งซื้อของผู้ใช้
export const getMyOrders = async (req, res, next) => {
  try {
    const { status, date } = req.query;

    const filters = {};
    if (status) filters.status = status;
    if (date) filters.date = date;

    const orders = await orderModel.getUserOrders(req.user.id, filters, {
      departmentId: req.user.department_id
    });

    res.json({
      success: true,
      data: withProductGroupAliases(orders),
      count: orders.length
    });
  } catch (error) {
    next(error);
  }
};

// ดึงรายละเอียดคำสั่งซื้อ
export const getOrderById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await orderModel.getOrderById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // ตรวจสอบว่า order เป็นของผู้ใช้หรือไม่ (ยกเว้น admin)
    const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
    const isProduction = Boolean(req.user.is_production_department);
    const sameDepartment =
      order.department_id &&
      req.user.department_id &&
      String(order.department_id) === String(req.user.department_id);
    if (!isAdmin && !isProduction && order.user_id !== req.user.id && !sameDepartment) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: withProductGroupAliases(order)
    });
  } catch (error) {
    next(error);
  }
};

// ดึงรายการรับของของแผนกตัวเอง
export const getReceivingItems = async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const scope = String(req.query.scope || 'mine');

    console.log('🔍 getReceivingItems called:');
    console.log('  - Date:', date);
    console.log('  - Scope:', scope);
    console.log('  - User ID:', req.user.id);
    console.log('  - Branch ID:', req.user.branch_id);
    console.log('  - Department ID:', req.user.department_id);

    const items = scope === 'branch'
      ? await orderModel.getReceivingItemsByBranch({
        date,
        branchId: req.user.branch_id
      })
      : await orderModel.getReceivingItemsByUser({
        date,
        userId: req.user.id
      });

    console.log('  - Items found:', items.length);

    res.json({
      success: true,
      data: withProductGroupAliases(items),
      count: items.length
    });
  } catch (error) {
    next(error);
  }
};

export const getReceivingHistory = async (req, res, next) => {
  try {
    const scope = String(req.query.scope || 'mine');
    const date = req.query.date || '';
    const today = new Date().toISOString().split('T')[0];
    const fromDate = req.query.from_date || date || today;
    const toDate = req.query.to_date || date || today;
    const limit = Number(req.query.limit || (scope === 'branch' ? 300 : 200));

    const items = scope === 'branch'
      ? await orderModel.getReceivingHistoryByBranch({
        branchId: req.user.branch_id,
        fromDate,
        toDate,
        limit
      })
      : await orderModel.getReceivingHistoryByUser({
        userId: req.user.id,
        fromDate,
        toDate,
        limit
      });

    res.json({
      success: true,
      data: withProductGroupAliases(items),
      count: items.length
    });
  } catch (error) {
    next(error);
  }
};

// บันทึกรับของของแผนกตัวเอง
export const updateReceivingItems = async (req, res, next) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'items is required'
      });
    }

    const scope = String(req.query.scope || 'mine');
    const options = {
      scope,
      ...(scope === 'branch'
        ? { branchId: req.user.branch_id }
        : { userId: req.user.id })
    };

    console.log('💾 updateReceivingItems:');
    console.log('  - Scope:', scope);
    console.log('  - Items count:', items.length);
    console.log('  - Sample item:', items[0]);

    const result = await orderModel.updateReceivingItems(items, req.user.id, options);

    res.json({
      success: true,
      message: 'Receiving updated',
      data: withProductGroupAliases(result)
    });
  } catch (error) {
    next(error);
  }
};

export const createManualReceivingItem = async (req, res, next) => {
  try {
    const {
      date,
      product_id: productIdRaw,
      received_quantity: receivedQtyRaw,
      receive_notes: receiveNotes
    } = req.body || {};

    const productId = Number(productIdRaw);
    const receivedQuantity = Number(receivedQtyRaw);

    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'date is required'
      });
    }
    if (!Number.isFinite(productId)) {
      return res.status(400).json({
        success: false,
        message: 'product_id is required'
      });
    }
    if (!Number.isFinite(receivedQuantity) || receivedQuantity <= 0) {
      return res.status(400).json({
        success: false,
        message: 'received_quantity must be greater than 0'
      });
    }

    const result = await orderModel.createManualReceivingItem({
      date,
      userId: req.user.id,
      productId,
      receivedQuantity,
      receiveNotes: String(receiveNotes || '').trim() || 'รับสินค้าเพิ่มนอกใบสั่ง'
    });

    return res.status(201).json({
      success: true,
      message: 'เพิ่มสินค้ารับนอกใบสั่งเรียบร้อยแล้ว',
      data: withProductGroupAliases(result)
    });
  } catch (error) {
    if (error.message === 'Product not found') {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบสินค้า'
      });
    }
    next(error);
  }
};

export const getProductionPrintItems = async (req, res, next) => {
  try {
    const date = req.query.date;
    const branchId = Number(req.query.branch_id);
    const departmentId = Number(req.query.department_id);

    if (!date || !Number.isFinite(branchId) || !Number.isFinite(departmentId)) {
      return res.status(400).json({
        success: false,
        message: 'date, branch_id, and department_id are required'
      });
    }

    const productionUser = await getProductionUser(req.user.id);
    if (!productionUser) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    let target = null;
    if (branchId === 0 && departmentId === 0) {
      target = {
        branch_id: 0,
        branch_name: 'ทุกสาขา',
        department_id: 0,
        department_name: 'ทุกแผนก'
      };
    } else {
      target = await orderModel.getBranchDepartmentInfo({
        branchId,
        departmentId
      });

      if (!target) {
        return res.status(404).json({
          success: false,
          message: 'Branch or department not found'
        });
      }
    }

    const items = await orderModel.getProductionPrintItems({
      date,
      branchId,
      departmentId
    });

    res.json({
      success: true,
      data: withProductGroupAliases(items),
      meta: {
        date,
        branch: {
          id: target.branch_id,
          name: target.branch_name
        },
        department: {
          id: target.department_id,
          name: target.department_name
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

export const logProductionPrint = async (req, res, next) => {
  try {
    const { date, branch_id, department_id } = req.body;
    const branchId = Number(branch_id);
    const departmentId = Number(department_id);

    if (!date || !Number.isFinite(branchId) || !Number.isFinite(departmentId)) {
      return res.status(400).json({
        success: false,
        message: 'date, branch_id, and department_id are required'
      });
    }

    const productionUser = await getProductionUser(req.user.id);
    if (!productionUser) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const target = await orderModel.getBranchDepartmentInfo({
      branchId,
      departmentId
    });

    if (!target) {
      return res.status(404).json({
        success: false,
        message: 'Branch or department not found'
      });
    }

    await orderModel.logProductionPrint({
      user: productionUser,
      target,
      orderDate: date,
      supplierCode: PRODUCTION_SUPPLIER_CODE
    });

    res.json({
      success: true,
      message: 'Logged'
    });
  } catch (error) {
    next(error);
  }
};

// อัพเดทคำสั่งซื้อ
export const updateOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { items } = req.body;

    // ดึงข้อมูล order เพื่อตรวจสอบ ownership
    const order = await orderModel.getOrderById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
    const sameDepartment =
      order.department_id &&
      req.user.department_id &&
      String(order.department_id) === String(req.user.department_id);
    if (!isAdmin && order.user_id !== req.user.id && !sameDepartment) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const orderData = { items };
    const result = await orderModel.updateOrder(id, orderData, {
      isAdmin
    });

    try {
      const orderDetail = await orderModel.getOrderById(id);
      const lineOptions = await getLineNotificationOptions();
      if (lineOptions) {
        await sendLineOrderNotification(orderDetail, {
          ...lineOptions,
          title: '🟡 แก้ไขคำสั่งซื้อ',
          eventType: 'order_updated',
          orderId: orderDetail?.id
        });
      }
    } catch (notifyError) {
      console.error('Line notification error:', notifyError);
    }

    res.json({
      success: true,
      message: 'Order updated successfully',
      data: withProductGroupAliases(result)
    });
  } catch (error) {
    if (error.message.includes('Only draft')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    if (error.message === 'Order receiving is closed') {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

// ส่งคำสั่งซื้อ
export const submitOrder = async (req, res, next) => {
  try {
    const { id } = req.params;

    // ดึงข้อมูล order เพื่อตรวจสอบ ownership
    const order = await orderModel.getOrderById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const result = await orderModel.submitOrder(id);

    res.json({
      success: true,
      message: 'Order submitted successfully',
      data: withProductGroupAliases(result)
    });
  } catch (error) {
    if (error.message.includes('Only draft orders')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    if (error.message === 'Order receiving is closed') {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

// ลบคำสั่งซื้อ
export const deleteOrder = async (req, res, next) => {
  try {
    const { id } = req.params;

    // ดึงข้อมูล order เพื่อตรวจสอบ ownership
    const order = await orderModel.getOrderById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
    const sameDepartment =
      order.department_id &&
      req.user.department_id &&
      String(order.department_id) === String(req.user.department_id);
    if (!isAdmin && order.user_id !== req.user.id && !sameDepartment) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    await orderModel.deleteOrder(id);

    try {
      const lineOptions = await getLineNotificationOptions();
      if (lineOptions) {
        await sendLineOrderNotification(order, {
          ...lineOptions,
          title: '🔴 ลบคำสั่งซื้อ',
          eventType: 'order_deleted',
          orderId: order?.id
        });
      }
    } catch (notifyError) {
      console.error('Line notification error:', notifyError);
    }

    res.json({
      success: true,
      message: 'Order deleted successfully'
    });
  } catch (error) {
    if (error.message.includes('Only draft') || error.message.includes('Only draft or submitted')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    if (error.message === 'Order receiving is closed') {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};
