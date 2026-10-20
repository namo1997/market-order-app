import { getNotificationOptions } from '../services/order-notification-options.js';
import { sendReceivingSavedNotification } from '../services/receiving-notify.js';
import * as orderModel from '../models/order.model.js';
import * as settingsModel from '../models/settings.model.js';
import * as userModel from '../models/user.model.js';
import * as supplierModel from '../models/supplier.model.js';
import { sendLineOrderNotification } from '../utils/line.js';
import { sendDiscordOrderNotification } from '../utils/discord.js';
import { sendDirectOrderAfterCutoff } from '../utils/direct-order.js';
import { withProductGroupAliases } from '../utils/product-group.js';
import {
  isDiscordWebhookUrl,
  parseGroupCodes,
  pickItemsByGroupIds
} from '../utils/other-suppliers-notification.js';

const sendOrderNotificationByProvider = async (orderDetail, options = {}) => {
  if (!options) return;
  if (options.provider === 'discord') {
    await sendDiscordOrderNotification(orderDetail, options);
    return;
  }
  await sendLineOrderNotification(orderDetail, options);
};

// แยกห้อง: รายการของกลุ่ม "ซัพอื่นๆ" ไปห้องซัพอื่นๆ เท่านั้น ที่เหลือไปห้องหลัก
// ถ้ายังไม่มี webhook ซัพอื่นๆ ที่ถูกต้อง ทุกรายการไปห้องหลักเหมือนเดิม (ไม่ให้แจ้งเตือนหาย)
const resolveOtherSuppliersGroupIds = async (notifyOptions) => {
  if (notifyOptions?.provider !== 'discord') return null;
  const webhookUrl = String(notifyOptions.otherSuppliersWebhookUrl || '').trim();
  if (!isDiscordWebhookUrl(webhookUrl)) return null;

  const codes = parseGroupCodes(
    await settingsModel.getSetting('discord_other_suppliers_group_codes', '')
  );
  const groups = await Promise.all(codes.map((code) => supplierModel.getSupplierByCode(code)));
  return { webhookUrl, groupIds: groups.filter(Boolean).map((group) => group.id) };
};

const partitionItems = (items, groupIds) => {
  const all = Array.isArray(items) ? items : [];
  const other = new Set(pickItemsByGroupIds(all, groupIds));
  return {
    main: all.filter((item) => !other.has(item)),
    other: all.filter((item) => other.has(item))
  };
};

// kind: created | updated | deleted; updated ต้องส่ง beforeItems (รายการก่อนแก้) มาด้วย
const sendOrderNotifications = async (
  orderDetail,
  notifyOptions,
  { title, eventType, kind = 'created', beforeItems = [], actorName = '' }
) => {
  const extra = { kind, actorName };
  let split = null;
  try {
    split = await resolveOtherSuppliersGroupIds(notifyOptions);
  } catch (error) {
    console.error('Other suppliers split error:', error);
  }

  if (!split) {
    await sendOrderNotificationByProvider(orderDetail, {
      ...notifyOptions,
      ...extra,
      beforeItems,
      title,
      eventType,
      orderId: orderDetail?.id
    });
    return;
  }

  const after = partitionItems(orderDetail?.items, split.groupIds);
  const before = partitionItems(beforeItems, split.groupIds);

  if (after.main.length > 0 || before.main.length > 0) {
    await sendOrderNotificationByProvider(
      { ...orderDetail, items: after.main },
      { ...notifyOptions, ...extra, beforeItems: before.main, title, eventType, orderId: orderDetail?.id }
    );
  }

  if (after.other.length > 0 || before.other.length > 0) {
    await sendDiscordOrderNotification(
      { ...orderDetail, items: after.other },
      {
        ...extra,
        beforeItems: before.other,
        defaultFields: notifyOptions.defaultFields,
        groups: [
          {
            id: '',
            name: 'ซัพอื่นๆ',
            enabled: true,
            fields: notifyOptions.defaultFields,
            accessTokens: [{ name: 'Webhook ซัพอื่นๆ', token: split.webhookUrl }]
          }
        ],
        title: `${title} - ซัพอื่นๆ`,
        eventType: `${eventType}_other_suppliers`,
        orderId: orderDetail?.id
      }
    );
  }
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

const normalizeSupplierKey = (value) => {
  if (value === null || value === undefined || value === '') return 'none';
  return String(value);
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

const PRODUCTION_SUPPLIER_CODE = 'SUP003';
const RECEIVING_BILL_TARGET_GROUP_CODE = 'SUP008';
const RECEIVING_BILL_TARGET_GROUP_NAME = 'ซัพอื่น(ผลิตสันกำแพง)';
const MAX_RECEIVING_BILL_IMAGE_BYTES = 500 * 1024;
const MAX_RECEIVING_BILL_PHOTOS = 10;

const normalizeProductGroupName = (value) =>
  String(value || '').trim().replace(/\s+/g, '').toLowerCase();

const isSupportedReceivingBillImage = (buffer, mimeType) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (mimeType === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === 'image/webp') {
    return buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
};

const getReceivingBillTargetGroup = async (productGroupId) => {
  const group = await orderModel.getReceivingBillProductGroup(productGroupId);
  const isTarget = group && (
    String(group.code || '').trim().toUpperCase() === RECEIVING_BILL_TARGET_GROUP_CODE ||
    normalizeProductGroupName(group.name) === normalizeProductGroupName(RECEIVING_BILL_TARGET_GROUP_NAME)
  );
  return isTarget ? group : null;
};

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
        await sendOrderNotifications(orderDetail, notifyOptions, {
          title: '🟢 สั่งซื้อใหม่',
          eventType: 'order_created'
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

    // Automatic receiving runs server-side; opening this view is read-only.
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

export const getReceivingBillPhotos = async (req, res, next) => {
  try {
    const date = String(req.query.date || '').trim();
    const productGroupIdRaw = req.query.supplier_id || req.query.product_group_id;
    const productGroupId = productGroupIdRaw === undefined
      ? null
      : Number(productGroupIdRaw);
    const scope = String(req.query.scope || 'mine') === 'branch' ? 'branch' : 'mine';

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      (productGroupId !== null && (!Number.isFinite(productGroupId) || productGroupId <= 0))
    ) {
      return res.status(400).json({
        success: false,
        message: 'กรุณาระบุวันที่ให้ถูกต้อง'
      });
    }

    // When no group is supplied, return every bill photo saved for the selected
    // date within the caller's permitted branch/department scope. This lets the
    // bill archive work even when there are no remaining receiving items today.
    const targetGroup = productGroupId !== null
      ? await getReceivingBillTargetGroup(productGroupId)
      : null;
    if (productGroupId !== null && !targetGroup) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบกลุ่มสินค้าที่เปิดให้ถ่ายบิลรับสินค้า'
      });
    }

    const photos = await orderModel.listReceivingBillPhotos({
      date,
      productGroupId,
      branchId: Number(req.user.branch_id),
      departmentId: Number(req.user.department_id),
      scope
    });

    return res.json({
      success: true,
      data: photos,
      count: photos.length
    });
  } catch (error) {
    next(error);
  }
};

export const createReceivingBillPhoto = async (req, res, next) => {
  try {
    const date = String(req.body?.date || '').trim();
    const productGroupId = Number(req.body?.supplier_id || req.body?.product_group_id);
    const productId = Number(req.body?.product_id);
    const orderItemIdRaw = Number(req.body?.order_item_id);
    const orderItemId = Number.isFinite(orderItemIdRaw) && orderItemIdRaw > 0
      ? Math.trunc(orderItemIdRaw)
      : null;
    const orderItemIds = String(req.body?.order_item_ids || '').trim().slice(0, 2000);
    const productName = String(req.body?.product_name || '').trim().slice(0, 255);
    const scope = String(req.body?.scope || 'mine') === 'branch' ? 'branch' : 'mine';
    const imageDataUrl = String(req.body?.image_data_url || '');
    const fileName = String(req.body?.file_name || 'receiving-bill.jpg')
      .trim()
      .slice(0, 255);

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(productGroupId) ||
      !Number.isFinite(productId) ||
      productId <= 0 ||
      !productName
    ) {
      return res.status(400).json({
        success: false,
        message: 'กรุณาระบุวันที่ กลุ่มสินค้า และรายการสินค้าให้ถูกต้อง'
      });
    }

    const targetGroup = await getReceivingBillTargetGroup(productGroupId);
    if (!targetGroup) {
      return res.status(404).json({
        success: false,
        message: 'กลุ่มสินค้านี้ไม่ได้เปิดให้ถ่ายบิลรับสินค้า'
      });
    }

    const match = imageDataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) {
      return res.status(400).json({
        success: false,
        message: 'รองรับเฉพาะรูปภาพ JPEG, PNG หรือ WebP'
      });
    }

    const mimeType = match[1];
    const imageBuffer = Buffer.from(match[2], 'base64');
    if (!isSupportedReceivingBillImage(imageBuffer, mimeType)) {
      return res.status(400).json({
        success: false,
        message: 'ไฟล์ที่เลือกไม่ใช่รูปภาพที่ถูกต้อง'
      });
    }
    if (imageBuffer.length > MAX_RECEIVING_BILL_IMAGE_BYTES) {
      return res.status(413).json({
        success: false,
        message: 'รูปบิลมีขนาดใหญ่เกิน 500KB กรุณาถ่ายใหม่'
      });
    }

    const photoCount = await orderModel.countReceivingBillPhotos({
      date,
      productGroupId,
      productId,
      orderItemId,
      branchId: Number(req.user.branch_id),
      departmentId: Number(req.user.department_id),
      scope
    });
    if (photoCount >= MAX_RECEIVING_BILL_PHOTOS) {
      return res.status(400).json({
        success: false,
        message: `วันที่นี้บันทึกรูปบิลครบ ${MAX_RECEIVING_BILL_PHOTOS} รูปแล้ว`
      });
    }

    const photo = await orderModel.createReceivingBillPhoto({
      date,
      productGroupId,
      productId,
      orderItemId,
      orderItemIds,
      productName,
      branchId: Number(req.user.branch_id),
      departmentId: Number(req.user.department_id),
      userId: Number(req.user.id),
      scope,
      fileName: fileName || 'receiving-bill.jpg',
      mimeType,
      imageBuffer
    });

    return res.status(201).json({
      success: true,
      message: 'บันทึกรูปบิลรับสินค้าแล้ว',
      data: photo
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
            location: () => getResolvedUserLocation(req.user),
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
      if (notifyOptions && orderDetail) {
        await sendOrderNotifications(orderDetail, notifyOptions, {
          title: '🟡 แก้ไขคำสั่งซื้อ',
          eventType: 'order_updated',
          kind: 'updated',
          beforeItems: order.items
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
        await sendOrderNotifications(order, notifyOptions, {
          title: '🔴 ยกเลิกคำสั่งซื้อ',
          eventType: 'order_deleted',
          kind: 'deleted',
          actorName: req.user?.name || ''
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
