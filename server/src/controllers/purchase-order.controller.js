import * as model from '../models/purchase-order.model.js';
import * as settingsModel from '../models/settings.model.js';
import { sendDiscordTextNotification } from '../utils/discord.js';

const isAdminUser = (req) => ['admin', 'super_admin'].includes(req.user?.role);

const httpError = (message, statusCode) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const parsePoId = (value) => {
  const text = String(value ?? '').trim();
  const id = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw httpError('รหัสใบสั่งซื้อไม่ถูกต้อง', 400);
  }
  return id;
};

// ผู้ใช้ทั่วไปเข้าถึงได้เฉพาะ PO ของแผนกตัวเอง (แอดมินเข้าถึงได้ทั้งหมด)
const assertCanAccessPurchaseOrder = async (req, id) => {
  const info = await model.getPurchaseOrderAccessInfo(id);
  if (!info) throw httpError('Purchase order not found', 404);
  if (isAdminUser(req)) return info;
  const userDepartmentId = Number(req.user?.department_id);
  if (!userDepartmentId || Number(info.department_id) !== userDepartmentId) {
    throw httpError('ไม่มีสิทธิ์เข้าถึงใบสั่งซื้อของแผนกอื่น', 403);
  }
  return info;
};

// กติกาเดียวกับเมนู "สั่งซื้อจากซัพ" ฝั่ง client (FunctionSelect): แอดมิน หรือสาขาสโตร์
const STORE_BRANCH_NAME_PATTERN = /สโตร์|store/i;
const canCreatePurchaseOrder = async (req) => {
  if (isAdminUser(req)) return true;
  const branch = await model.getBranchInfo(req.user?.branch_id);
  return Boolean(branch && STORE_BRANCH_NAME_PATTERN.test(String(branch.name || '')));
};

const toSafeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatNumber = (value) => {
  const parsed = toSafeNumber(value);
  if (Math.abs(parsed % 1) < 0.000001) return String(Math.trunc(parsed));
  return parsed.toFixed(2).replace(/\.?0+$/, '');
};

const formatDateOnly = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
};

const sendPurchaseOrderCreatedDiscordNotification = async (po) => {
  const webhookFromSettings = await settingsModel.getSetting(
    'discord_po_webhook_url',
    process.env.DISCORD_PO_WEBHOOK_URL || ''
  );
  const fallbackWebhook = await settingsModel.getSetting(
    'discord_webhook_url',
    process.env.DISCORD_WEBHOOK_URL || ''
  );
  const webhookUrl = String(webhookFromSettings || fallbackWebhook || '').trim();
  if (!webhookUrl) return;

  const items = Array.isArray(po?.items) ? po.items : [];
  const lines = [
    '🟢 สั่งซื้อ PO ตลาด',
    `เลขที่: ${po?.po_number || '-'}`,
    `วันที่สั่ง: ${formatDateOnly(po?.po_date)}`,
    `คาดว่าจะรับ: ${formatDateOnly(po?.expected_date)}`,
    `ซัพพลายเออร์: ${po?.supplier_name || '-'}`,
    `สาขา: ${po?.branch_name || '-'}`,
    `แผนก: ${po?.department_name || '-'}`,
    `จำนวนรายการ: ${items.length} รายการ`,
    'รายละเอียด:'
  ];

  items.slice(0, 60).forEach((item, index) => {
    const qty = formatNumber(item?.quantity_ordered);
    const unit = item?.purchase_unit_abbr || item?.unit_abbr || '';
    const productName = item?.product_name || '-';
    lines.push(`${index + 1}. ${productName} ${qty}${unit ? ` ${unit}` : ''}`);
  });

  if (po?.notes) {
    lines.push(`หมายเหตุ: ${String(po.notes).trim()}`);
  }

  await sendDiscordTextNotification({
    webhookUrl,
    message: lines.join('\n'),
    eventType: 'purchase_order_created',
    orderId: po?.id || null,
    groupName: 'PO ตลาด'
  });
};

export const getPurchaseOrders = async (req, res, next) => {
  try {
    const { status, supplier_master_id, start_date, end_date, branch_id, department_id, limit } = req.query;
    const filters = {};
    const isAdmin = ['admin', 'super_admin'].includes(req.user?.role);
    if (status) filters.status = status;
    if (supplier_master_id) filters.supplierMasterId = supplier_master_id;
    if (start_date) filters.startDate = start_date;
    if (end_date) filters.endDate = end_date;

    // Non-admin users must always see only their own branch/department orders.
    if (isAdmin) {
      if (branch_id) filters.branchId = branch_id;
      if (department_id) filters.departmentId = department_id;
    } else {
      if (req.user?.branch_id) filters.branchId = req.user.branch_id;
      if (req.user?.department_id) filters.departmentId = req.user.department_id;
    }

    if (limit) filters.limit = limit;

    const rows = await model.getPurchaseOrders(filters);
    res.json({ success: true, data: rows, count: rows.length });
  } catch (err) {
    next(err);
  }
};

export const getPurchaseOrderById = async (req, res, next) => {
  try {
    const poId = parsePoId(req.params.id);
    await assertCanAccessPurchaseOrder(req, poId);
    const po = await model.getPurchaseOrderById(poId);
    res.json({ success: true, data: po });
  } catch (err) {
    next(err);
  }
};

export const createPurchaseOrder = async (req, res, next) => {
  try {
    const {
      supplier_master_id,
      po_date,
      expected_date,
      notes,
      items
    } = req.body || {};

    if (!(await canCreatePurchaseOrder(req))) {
      return res.status(403).json({
        success: false,
        message: 'แผนกนี้ไม่มีสิทธิ์สร้างใบสั่งซื้อจากซัพ (เฉพาะสาขาสโตร์หรือแอดมิน)'
      });
    }

    const po = await model.createPurchaseOrder({
      supplierMasterId: supplier_master_id,
      departmentId: req.user?.department_id || null,
      branchId: req.user?.branch_id || null,
      createdBy: req.user?.id,
      poDate: po_date,
      expectedDate: expected_date || null,
      notes: notes || null,
      items: Array.isArray(items) ? items : []
    });

    try {
      await sendPurchaseOrderCreatedDiscordNotification(po);
    } catch (notifyError) {
      console.error('Purchase order discord notification error:', notifyError);
    }

    res.status(201).json({ success: true, data: po, message: `สร้างใบสั่งซื้อ ${po.po_number} เรียบร้อย` });
  } catch (err) {
    next(err);
  }
};

export const receivePurchaseOrder = async (req, res, next) => {
  try {
    const poId = parsePoId(req.params.id);
    await assertCanAccessPurchaseOrder(req, poId);
    const { items, supplier_master_id } = req.body || {};

    const po = await model.receivePurchaseOrder({
      poId,
      items: Array.isArray(items) ? items : [],
      receivedBy: req.user?.id,
      supplierMasterId: supplier_master_id
    });

    res.json({ success: true, data: po, message: 'บันทึกการรับสินค้าเรียบร้อย' });
  } catch (err) {
    next(err);
  }
};

export const cancelPurchaseOrder = async (req, res, next) => {
  try {
    const poId = parsePoId(req.params.id);
    await assertCanAccessPurchaseOrder(req, poId);
    const po = await model.cancelPurchaseOrder(poId);
    res.json({ success: true, data: po, message: 'ยกเลิกใบสั่งซื้อเรียบร้อย' });
  } catch (err) {
    next(err);
  }
};
