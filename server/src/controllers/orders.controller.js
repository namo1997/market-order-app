import * as orderModel from '../models/order.model.js';
import * as settingsModel from '../models/settings.model.js';
import * as userModel from '../models/user.model.js';
import { sendLineOrderNotification } from '../utils/line.js';
import { sendDiscordOrderNotification, sendDiscordTextNotification } from '../utils/discord.js';
import { sendDirectOrderAfterCutoff } from '../utils/direct-order.js';
import { withProductGroupAliases } from '../utils/product-group.js';

const getNotificationOptions = async () => {
  const lineEnabled =
    (await settingsModel.getSetting('line_notifications_enabled', 'true')) === 'true';
  if (!lineEnabled) {
    return null;
  }

  const providerRaw = await settingsModel.getSetting('notification_provider', 'line');
  const provider = String(providerRaw || '').trim().toLowerCase() === 'discord' ? 'discord' : 'line';

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

  const groupsRaw = await settingsModel.getSetting(
    provider === 'discord' ? 'discord_notification_groups' : 'line_notification_groups',
    ''
  );
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

  if (provider === 'discord') {
    const webhookUrl = await settingsModel.getSetting(
      'discord_webhook_url',
      process.env.DISCORD_WEBHOOK_URL || ''
    );
    const receivingWebhookUrl = await settingsModel.getSetting(
      'discord_receiving_webhook_url',
      process.env.DISCORD_RECEIVING_WEBHOOK_URL || ''
    );
    if (groups.length === 0 && webhookUrl) {
      groups = [
        {
          id: '',
          name: 'กลุ่ม Discord',
          enabled: true,
          fields,
          accessTokens: [{ name: 'Webhook หลัก', token: webhookUrl }]
        }
      ];
    }

    return {
      provider,
      webhookUrl,
      receivingWebhookUrl,
      defaultFields: fields,
      groups
    };
  }

  const accessToken = await settingsModel.getSetting(
    'line_channel_access_token',
    process.env.LINE_CHANNEL_ACCESS_TOKEN || ''
  );
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
    provider,
    accessToken,
    defaultFields: fields,
    groups
  };
};

const sendOrderNotificationByProvider = async (orderDetail, options = {}) => {
  if (!options) return;
  if (options.provider === 'discord') {
    await sendDiscordOrderNotification(orderDetail, options);
    return;
  }
  await sendLineOrderNotification(orderDetail, options);
};

const sendDirectOrderAfterCutoffSafe = async (orderDetail, eventType) => {
  try {
    if (!orderDetail?.id) return;
    await sendDirectOrderAfterCutoff({
      orderDetail,
      eventType
    });
  } catch (error) {
    console.error('Direct order after cutoff error:', error);
  }
};

const getUserBranchName = (user) =>
  user?.branch || user?.branch_name || user?.branchName || '-';

const getUserDepartmentName = (user) =>
  user?.department || user?.department_name || user?.departmentName || '-';

const toSafeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeSupplierKey = (value) => {
  if (value === null || value === undefined || value === '') return 'none';
  return String(value);
};

const formatNumber = (value) => {
  const parsed = toSafeNumber(value);
  if (Math.abs(parsed % 1) < 0.000001) return String(Math.trunc(parsed));
  return parsed.toFixed(2).replace(/\.?0+$/, '');
};

const getThaiDateTimeText = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  const dateText = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
  const timeText = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
  return { dateText, timeText };
};

const getResolvedUserLocation = async (user = {}) => {
  let branchName = getUserBranchName(user);
  let departmentName = getUserDepartmentName(user);

  if (
    (branchName === '-' || departmentName === '-') &&
    Number.isFinite(Number(user?.branch_id)) &&
    Number.isFinite(Number(user?.department_id))
  ) {
    const location = await orderModel.getBranchDepartmentInfo({
      branchId: Number(user.branch_id),
      departmentId: Number(user.department_id)
    });
    if (location) {
      if (branchName === '-') branchName = location.branch_name || branchName;
      if (departmentName === '-') departmentName = location.department_name || departmentName;
    }
  }

  if ((branchName === '-' || departmentName === '-') && Number.isFinite(Number(user?.id))) {
    try {
      const dbUser = await userModel.getUserById(Number(user.id));
      if (dbUser) {
        if (branchName === '-') branchName = getUserBranchName(dbUser);
        if (departmentName === '-') departmentName = getUserDepartmentName(dbUser);
      }
    } catch (error) {
      // keep fallback '-'
    }
  }

  return { branchName, departmentName };
};

const buildReceivingVarianceItems = (items = []) => {
  const variances = [];
  for (const item of items) {
    if (!item || !item.product_name) continue;
    const orderedQty = toSafeNumber(item.quantity);
    const receivedRaw = item.received_quantity;
    const receivedQty =
      receivedRaw === '' || receivedRaw === null || receivedRaw === undefined
        ? 0
        : toSafeNumber(receivedRaw);
    const diff = receivedQty - orderedQty;
    if (Math.abs(diff) < 0.000001) continue;

    const status = diff > 0 ? 'เกิน' : 'ขาด';
    const varianceQty = Math.abs(diff);
    variances.push({
      product_name: `${item.product_name} (${status})`,
      quantity: varianceQty,
      unit_abbr: item.unit_abbr || item.unit_name || ''
    });
  }
  return variances;
};

const sendReceivingSavedNotification = async ({ req, items }) => {
  try {
    const notifyOptions = await getNotificationOptions();
    if (!notifyOptions) return;
    const safeItems = Array.isArray(items) ? items.filter((item) => item && item.product_name) : [];
    if (safeItems.length === 0) {
      return;
    }
    const varianceItems = buildReceivingVarianceItems(safeItems);
    const { dateText, timeText } = getThaiDateTimeText(new Date());
    const { branchName, departmentName } = await getResolvedUserLocation(req?.user || {});

    const lines = [
      `วันที่ ${dateText} เวลา ${timeText}`,
      `สาขา ${branchName} รับสินค้าทั้งหมด ${safeItems.length} รายการ`,
      varianceItems.length === 0 ? '✅ ครบทุกรายการ' : '⚠️ ขาด/เกิน'
    ];

    if (varianceItems.length > 0) {
      let lineNo = 1;
      safeItems.forEach((item) => {
        const orderedQty = toSafeNumber(item.quantity);
        const receivedRaw = item.received_quantity;
        const receivedQty =
          receivedRaw === '' || receivedRaw === null || receivedRaw === undefined
            ? 0
            : toSafeNumber(receivedRaw);
        const diff = receivedQty - orderedQty;
        if (Math.abs(diff) < 0.000001) return;
        const unit = item.unit_abbr || item.unit_name || '';
        const reason = String(item?.receive_notes || '').trim();
        lines.push(
          `${lineNo}. ${item.product_name} ${diff > 0 ? '+' : ''}${formatNumber(diff)}${unit ? ` ${unit}` : ''}${reason ? ` เหตุผล: ${reason}` : ''}`
        );
        lineNo += 1;
      });
    }

    const messageText = lines.join('\n');
    if (notifyOptions.provider === 'discord') {
      const receivingWebhook = String(notifyOptions.receivingWebhookUrl || '').trim();
      if (!receivingWebhook) return;
      await sendDiscordTextNotification({
        webhookUrl: receivingWebhook,
        message: messageText,
        eventType: 'order_receiving_saved_variance',
        orderId: null,
        groupName: `${branchName} / ${departmentName}`
      });
      return;
    }

    await sendOrderNotificationByProvider(
      {
        order_date: new Date().toISOString(),
        branch_name: branchName,
        department_name: departmentName,
        items: []
      },
      {
        ...notifyOptions,
        defaultFields: ['_text_only_'],
        groups: (notifyOptions.groups || []).map((group) => ({
          ...group,
          fields: ['_text_only_']
        })),
        title: messageText,
        eventType: 'order_receiving_saved_variance',
        orderId: null
      }
    );
  } catch (notifyError) {
    console.error('Receiving saved notification error:', notifyError);
  }
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
      const notifyOptions = await getNotificationOptions();
      if (notifyOptions) {
        await sendOrderNotificationByProvider(orderDetail, {
          ...notifyOptions,
          title: '🟢 สั่งซื้อใหม่',
          eventType: 'order_created',
          orderId: orderDetail?.id
        });
      }
      await sendDirectOrderAfterCutoffSafe(orderDetail, 'direct_order_after_cutoff_created');
    } catch (notifyError) {
      console.error('Notification error:', notifyError);
    }

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: withProductGroupAliases(order)
    });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
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

    const autoReceiveResult = await orderModel.autoReceivePendingItemsForNextDay({
      date,
      scope,
      userId: req.user.id,
      branchId: req.user.branch_id
    });

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

    if (Number(result?.updated || 0) > 0) {
      const targetDate = String(req.query.date || '').trim() || new Date().toISOString().split('T')[0];
      const supplierKeys = Array.from(
        new Set((items || []).map((item) => normalizeSupplierKey(item?.supplier_id)))
      );
      if (supplierKeys.length === 1) {
        const allItems = scope === 'branch'
          ? await orderModel.getReceivingItemsByBranch({
            date: targetDate,
            branchId: req.user.branch_id
          })
          : await orderModel.getReceivingItemsByUser({
            date: targetDate,
            userId: req.user.id
          });
        const targetSupplierKey = supplierKeys[0];
        const supplierItems = (allItems || []).filter(
          (item) => normalizeSupplierKey(item?.supplier_id) === targetSupplierKey
        );
        const isSupplierFullyProcessed =
          supplierItems.length > 0 &&
          supplierItems.every(
            (item) =>
              item.received_quantity !== null &&
              item.received_quantity !== undefined &&
              item.received_quantity !== ''
          );

        if (isSupplierFullyProcessed) {
          await sendReceivingSavedNotification({
            req,
            items: supplierItems
          });
        }
      }
    }

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
      source_product_group_id: sourceProductGroupRaw,
      product_group_id: productGroupRaw,
      supplier_id: supplierIdRaw,
      receive_notes: receiveNotes
    } = req.body || {};

    const productId = Number(productIdRaw);
    const receivedQuantity = Number(receivedQtyRaw);
    const sourceGroupCandidate =
      sourceProductGroupRaw ?? productGroupRaw ?? supplierIdRaw;
    const parsedSourceGroupId = Number(sourceGroupCandidate);
    const sourceProductGroupId =
      Number.isFinite(parsedSourceGroupId) && parsedSourceGroupId > 0
        ? Math.trunc(parsedSourceGroupId)
        : null;

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
      sourceProductGroupId,
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
      const notifyOptions = await getNotificationOptions();
      if (notifyOptions) {
        await sendOrderNotificationByProvider(orderDetail, {
          ...notifyOptions,
          title: '🟡 แก้ไขคำสั่งซื้อ',
          eventType: 'order_updated',
          orderId: orderDetail?.id
        });
      }
      await sendDirectOrderAfterCutoffSafe(orderDetail, 'direct_order_after_cutoff_updated');
    } catch (notifyError) {
      console.error('Notification error:', notifyError);
    }

    res.json({
      success: true,
      message: 'Order updated successfully',
      data: withProductGroupAliases(result)
    });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
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

    try {
      const orderDetail = await orderModel.getOrderById(id);
      await sendDirectOrderAfterCutoffSafe(orderDetail, 'direct_order_after_cutoff_submitted');
    } catch (notifyError) {
      console.error('Submit direct order notification error:', notifyError);
    }

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
      const notifyOptions = await getNotificationOptions();
      if (notifyOptions) {
        await sendOrderNotificationByProvider(order, {
          ...notifyOptions,
          title: '🔴 ลบคำสั่งซื้อ',
          eventType: 'order_deleted',
          orderId: order?.id
        });
      }
    } catch (notifyError) {
      console.error('Notification error:', notifyError);
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
