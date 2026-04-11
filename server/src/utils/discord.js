import crypto from 'crypto';
import { logLineNotification } from '../models/line-notification-log.model.js';

const getWebhookHash = (webhookUrl) =>
  webhookUrl ? crypto.createHash('sha256').update(webhookUrl).digest('hex') : '';

const getGroupWebhooks = (group, fallbackWebhookUrl) => {
  const urls = Array.isArray(group?.accessTokens)
    ? group.accessTokens
      .map((entry) => (typeof entry === 'string' ? entry : entry?.token))
      .filter(Boolean)
    : [];

  if (urls.length === 0 && group?.accessToken) {
    urls.push(group.accessToken);
  }
  if (urls.length === 0 && fallbackWebhookUrl) {
    urls.push(fallbackWebhookUrl);
  }
  return urls;
};

const formatDateOnly = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
};

const sendDiscordRequest = async ({ webhookUrl, content }) => {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord webhook error ${response.status}: ${body}`);
  }
};

export const sendDiscordTextNotification = async ({
  webhookUrl,
  message,
  eventType = 'discord_notification',
  orderId = null,
  groupName = ''
} = {}) => {
  const url = String(webhookUrl || '').trim();
  const text = String(message || '').trim();
  if (!url || !text) {
    await logLineNotification({
      eventType,
      orderId,
      groupName,
      status: 'skipped',
      errorMessage: !url ? 'missing discord webhook' : 'missing message'
    });
    return { skipped: true };
  }

  const webhookHash = getWebhookHash(url);
  try {
    await sendDiscordRequest({ webhookUrl: url, content: text });
    await logLineNotification({
      eventType,
      orderId,
      groupName,
      accessTokenHash: webhookHash,
      status: 'success',
      message: text
    });
    return { ok: true };
  } catch (error) {
    await logLineNotification({
      eventType,
      orderId,
      groupName,
      accessTokenHash: webhookHash,
      status: 'failed',
      message: text,
      errorMessage: error?.message || 'Discord webhook error'
    });
    throw error;
  }
};

export const sendDiscordOrderNotification = async (orderDetail, options = {}) => {
  const fallbackWebhookUrl = options.webhookUrl || process.env.DISCORD_WEBHOOK_URL || '';
  const defaultFields = Array.isArray(options.defaultFields) && options.defaultFields.length > 0
    ? options.defaultFields
    : ['date', 'branch', 'department', 'count', 'items'];
  const groups = Array.isArray(options.groups) ? options.groups : [];
  const title = options.title || 'มีคำสั่งซื้อใหม่';
  const eventType = options.eventType || 'order_notification';
  const orderId = options.orderId || orderDetail?.id || null;

  const effectiveGroups = groups.length > 0
    ? groups
    : [{
      id: '',
      name: 'กลุ่ม Discord',
      enabled: true,
      accessTokens: fallbackWebhookUrl ? [{ name: 'Webhook หลัก', token: fallbackWebhookUrl }] : [],
      fields: defaultFields
    }];

  const hasAnyWebhook =
    Boolean(fallbackWebhookUrl) ||
    effectiveGroups.some((group) =>
      getGroupWebhooks(group, '').length > 0
    );

  if (!hasAnyWebhook || effectiveGroups.length === 0) {
    await logLineNotification({
      eventType,
      orderId,
      status: 'skipped',
      errorMessage: !hasAnyWebhook ? 'missing discord webhook' : 'missing group'
    });
    return { skipped: true };
  }

  const items = Array.isArray(orderDetail?.items) ? orderDetail.items : [];
  const itemCount = items.length;
  const orderDate = orderDetail?.order_date || '-';
  const orderDateText = formatDateOnly(orderDate);
  const branch = orderDetail?.branch_name || '-';
  const department = orderDetail?.department_name || '-';
  const itemLines = items.map((item, index) => {
    const qty = Number(item.quantity || 0);
    const unit = item.unit_abbr ? ` ${item.unit_abbr}` : '';
    const groupName = String(item?.supplier_name || item?.product_group_name || '').trim();
    const groupLabel = groupName ? ` [กลุ่ม: ${groupName}]` : ' [กลุ่ม: ไม่ระบุ]';
    return `${index + 1}. ${item.product_name}${groupLabel} ${qty}${unit}`;
  });

  for (const group of effectiveGroups) {
    const groupEnabled = group?.enabled !== false;
    if (!groupEnabled) {
      await logLineNotification({
        eventType,
        orderId,
        groupName: group?.name || '',
        status: 'skipped',
        errorMessage: 'group disabled'
      });
      continue;
    }

    const fields = Array.isArray(group?.fields) && group.fields.length > 0
      ? group.fields
      : defaultFields;
    const webhooks = getGroupWebhooks(group, fallbackWebhookUrl);
    if (webhooks.length === 0) {
      await logLineNotification({
        eventType,
        orderId,
        groupName: group?.name || '',
        status: 'skipped',
        errorMessage: 'missing discord webhook'
      });
      continue;
    }

    const messageLines = [title];
    if (fields.includes('date')) messageLines.push(`วันที่สั่ง: ${orderDateText}`);
    if (fields.includes('branch')) messageLines.push(`สาขา: ${branch}`);
    if (fields.includes('department')) messageLines.push(`แผนก: ${department}`);
    if (fields.includes('count')) messageLines.push(`จำนวน: ${itemCount} รายการ`);
    if (fields.includes('items')) {
      messageLines.push('รายละเอียดจำนวนรายการที่สั่งซื้อ:');
      messageLines.push(...itemLines);
    }
    const message = messageLines.filter(Boolean).join('\n');

    for (const webhookUrl of webhooks) {
      const webhookHash = getWebhookHash(webhookUrl);
      try {
        await sendDiscordRequest({ webhookUrl, content: message });
        await logLineNotification({
          eventType,
          orderId,
          groupName: group?.name || '',
          accessTokenHash: webhookHash,
          status: 'success',
          message
        });
      } catch (error) {
        await logLineNotification({
          eventType,
          orderId,
          groupName: group?.name || '',
          accessTokenHash: webhookHash,
          status: 'failed',
          message,
          errorMessage: error?.message || 'Discord webhook error'
        });
      }
    }
  }

  return { ok: true };
};
