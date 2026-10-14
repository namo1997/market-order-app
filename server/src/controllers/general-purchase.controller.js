import * as model from '../models/general-purchase.model.js';
import * as settingsModel from '../models/settings.model.js';
import { sendDiscordTextNotification } from '../utils/discord.js';

const actorFromReq = (req) => ({
  userId: req.user?.id || null,
  name: req.user?.name || req.user?.username || req.body?.actor_name || null
});

const toSafeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatNumber = (value) => {
  const parsed = toSafeNumber(value);
  if (Math.abs(parsed % 1) < 0.000001) return String(Math.trunc(parsed));
  return parsed.toFixed(2).replace(/\.?0+$/, '');
};

const formatMoney = (value) =>
  toSafeNumber(value).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

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

const sendGeneralPurchasePrDiscordNotification = async (order) => {
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

  const items = Array.isArray(order?.items) ? order.items : [];
  const lines = [
    '🟣 PR สั่งซื้อทั่วไปใหม่',
    `เลขที่: ${order?.prNumber || order?.number || '-'}`,
    `วันที่ขอ: ${formatDateOnly(order?.header?.requestDate)}`,
    `สาขา: ${order?.header?.branch || '-'}`,
    `แผนก: ${order?.header?.department || '-'}`,
    `ประเภทค่าใช้จ่าย: ${order?.header?.expenseType || '-'}`,
    `ผู้ขอ: ${order?.requestedBy || '-'}`,
    `จำนวนรายการ: ${items.length} รายการ`,
    `ยอดประมาณ: ฿${formatMoney(order?.subtotalAmount)}`,
    'รายละเอียด:'
  ];

  items.slice(0, 40).forEach((item, index) => {
    const qty = formatNumber(item?.quantity);
    const unit = item?.unit || '';
    const total = formatMoney(item?.totalPrice);
    lines.push(`${index + 1}. ${item?.name || '-'} ${qty}${unit ? ` ${unit}` : ''} — ฿${total}`);
  });

  if (items.length > 40) {
    lines.push(`...และอีก ${items.length - 40} รายการ`);
  }
  if (order?.header?.purpose) {
    lines.push(`เหตุผล/หมายเหตุ: ${String(order.header.purpose).trim()}`);
  }

  await sendDiscordTextNotification({
    webhookUrl,
    message: lines.join('\n'),
    eventType: 'general_purchase_pr_created',
    orderId: order?.id || null,
    groupName: 'PR สั่งซื้อทั่วไป'
  });
};

export const listGeneralPurchaseOrders = async (req, res, next) => {
  try {
    const orders = await model.getGeneralPurchaseOrders({
      status: req.query.status,
      branch: req.query.branch,
      department: req.query.department,
      limit: req.query.limit
    });
    res.json({ success: true, data: orders, count: orders.length });
  } catch (error) {
    next(error);
  }
};

export const getGeneralPurchaseOrder = async (req, res, next) => {
  try {
    const order = await model.getGeneralPurchaseOrderById(Number(req.params.id));
    res.json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

export const createGeneralPurchaseOrder = async (req, res, next) => {
  try {
    const order = await model.createGeneralPurchaseOrder({
      header: req.body?.header || {},
      items: Array.isArray(req.body?.items) ? req.body.items : [],
      requestedBy: req.body?.requestedBy || req.body?.requested_by,
      clientRequestId: req.body?.clientRequestId || req.body?.client_request_id || req.headers['idempotency-key'],
      actor: actorFromReq(req)
    });

    if (!order.idempotentReplay) {
      try {
        await sendGeneralPurchasePrDiscordNotification(order);
      } catch (notifyError) {
        console.error('General purchase PR discord notification error:', notifyError);
      }
    }

    res.status(order.idempotentReplay ? 200 : 201).json({ success: true, data: order, message: `สร้าง ${order.number} เรียบร้อย` });
  } catch (error) {
    next(error);
  }
};

export const approveGeneralPurchaseOrder = async (req, res, next) => {
  try {
    const order = await model.approveGeneralPurchaseOrder({
      id: Number(req.params.id),
      note: req.body?.note || '',
      actor: actorFromReq(req)
    });
    res.json({ success: true, data: order, message: 'อนุมัติ PR เรียบร้อย' });
  } catch (error) {
    next(error);
  }
};

export const rejectGeneralPurchaseOrder = async (req, res, next) => {
  try {
    const order = await model.rejectGeneralPurchaseOrder({
      id: Number(req.params.id),
      reason: req.body?.reason || req.body?.note || '',
      actor: actorFromReq(req)
    });
    res.json({ success: true, data: order, message: 'ไม่อนุมัติ PR เรียบร้อย' });
  } catch (error) {
    next(error);
  }
};

export const issueGeneralPurchasePO = async (req, res, next) => {
  try {
    const order = await model.issueGeneralPurchasePO({
      id: Number(req.params.id),
      poNumber: req.body?.poNumber || req.body?.po_number,
      poDate: req.body?.poDate || req.body?.po_date,
      expectedDate: req.body?.expectedDate || req.body?.expected_date,
      vendorName: req.body?.vendorName || req.body?.vendor_name,
      vendorTaxId: req.body?.vendorTaxId || req.body?.vendor_tax_id,
      documentDate: req.body?.documentDate || req.body?.document_date,
      paymentDueDate: req.body?.paymentDueDate || req.body?.payment_due_date,
      paymentMethod: req.body?.paymentMethod || req.body?.payment_method,
      vatType: req.body?.vatType || req.body?.vat_type,
      withholdingTaxRate: req.body?.withholdingTaxRate || req.body?.withholding_tax_rate,
      note: req.body?.note || '',
      actor: actorFromReq(req)
    });
    res.json({ success: true, data: order, message: `ออก PO ${order.poNumber} เรียบร้อย` });
  } catch (error) {
    next(error);
  }
};

export const receiveGeneralPurchaseOrder = async (req, res, next) => {
  try {
    const order = await model.receiveGeneralPurchaseOrder({
      id: Number(req.params.id),
      items: Array.isArray(req.body?.items) ? req.body.items : [],
      taxInvoiceNo: req.body?.taxInvoiceNo || req.body?.tax_invoice_no || '',
      note: req.body?.note || '',
      actor: actorFromReq(req)
    });
    res.json({ success: true, data: order, message: 'รับของและลงราคาเรียบร้อย' });
  } catch (error) {
    next(error);
  }
};
