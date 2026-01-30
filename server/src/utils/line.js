import https from 'https';
import crypto from 'crypto';
import {
  countTokenUsageThisMonth,
  logLineNotification
} from '../models/line-notification-log.model.js';

const QUOTA_LIMIT = 250;

const getTokenHash = (token) =>
  token ? crypto.createHash('sha256').update(token).digest('hex') : '';

const getGroupTokens = (group, fallbackToken) => {
  const tokens = Array.isArray(group?.accessTokens)
    ? group.accessTokens
        .map((entry) => (typeof entry === 'string' ? entry : entry?.token))
        .filter(Boolean)
    : [];
  if (tokens.length === 0 && group?.accessToken) {
    tokens.push(group.accessToken);
  }
  if (tokens.length === 0 && fallbackToken) {
    tokens.push(fallbackToken);
  }
  return tokens;
};

const selectTokenForGroup = async (group, fallbackToken) => {
  const tokens = getGroupTokens(group, fallbackToken);
  if (tokens.length === 0) {
    return { token: '', tokenHash: '' };
  }
  if (group?.quotaMode !== 'auto') {
    return { token: tokens[0], tokenHash: getTokenHash(tokens[0]) };
  }

  let maxUsed = 0;
  for (const token of tokens) {
    const tokenHash = getTokenHash(token);
    const usedCount = await countTokenUsageThisMonth(tokenHash);
    if (usedCount < QUOTA_LIMIT) {
      return { token, tokenHash, usedCount };
    }
    maxUsed = Math.max(maxUsed, usedCount);
  }

  return {
    token: '',
    tokenHash: getTokenHash(tokens[0]),
    usedCount: maxUsed,
    quotaExceeded: true
  };
};

const sendLineRequest = (payload, accessToken) => new Promise((resolve, reject) => {
  const data = JSON.stringify(payload);

  const req = https.request(
    {
      method: 'POST',
      hostname: 'api.line.me',
      path: '/v2/bot/message/push',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        Authorization: `Bearer ${accessToken}`
      }
    },
    (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk.toString();
      });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true });
        } else {
          reject(new Error(`LINE API error ${res.statusCode}: ${body}`));
        }
      });
    }
  );

  req.on('error', reject);
  req.write(data);
  req.end();
});

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

export const sendLineOrderNotification = async (orderDetail, options = {}) => {
  const accessToken = options.accessToken || process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const defaultFields = Array.isArray(options.defaultFields) && options.defaultFields.length > 0
    ? options.defaultFields
    : ['date', 'branch', 'department', 'count', 'items'];
  const groups = Array.isArray(options.groups) ? options.groups : [];
  const title = options.title || 'มีคำสั่งซื้อใหม่';
  const eventType = options.eventType || 'order_notification';
  const orderId = options.orderId || orderDetail?.id || null;
  const hasAnyToken =
    Boolean(accessToken) ||
    groups.some(
      (group) =>
        Boolean(group?.accessToken) ||
        (Array.isArray(group?.accessTokens) &&
          group.accessTokens.some((entry) =>
            typeof entry === 'string' ? Boolean(entry) : Boolean(entry?.token)
          ))
    );

  if (!hasAnyToken || groups.length === 0) {
    await logLineNotification({
      eventType,
      orderId,
      status: 'skipped',
      errorMessage: !hasAnyToken ? 'missing access token' : 'missing group'
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
    return `${index + 1}. ${item.product_name} ${qty}${unit}`;
  });

  for (const group of groups) {
    const groupEnabled = group?.enabled !== false;
    const fields = Array.isArray(group?.fields) && group.fields.length > 0
      ? group.fields
      : defaultFields;
    if (!groupEnabled || !group?.id) {
      await logLineNotification({
        eventType,
        orderId,
        groupId: group?.id || '',
        groupName: group?.name || '',
        accessTokenHash: '',
        status: 'skipped',
        errorMessage: !groupEnabled ? 'group disabled' : 'missing group id'
      });
      continue;
    }

    const selection = await selectTokenForGroup(group, accessToken);
    const groupAccessToken = selection.token;
    const accessTokenHash = selection.tokenHash;
    if (!groupAccessToken) {
      if (selection.quotaExceeded) {
        await logLineNotification({
          eventType,
          orderId,
          groupId: group?.id || '',
          groupName: group?.name || '',
          accessTokenHash,
          status: 'skipped',
          errorMessage: `quota exceeded (${selection.usedCount || 0}/${QUOTA_LIMIT})`
        });
        continue;
      }
      await logLineNotification({
        eventType,
        orderId,
        groupId: group?.id || '',
        groupName: group?.name || '',
        accessTokenHash,
        status: 'skipped',
        errorMessage: 'missing access token'
      });
      continue;
    }

    const messageLines = [title];

    if (fields.includes('date')) {
      messageLines.push(`วันที่สั่ง: ${orderDateText}`);
    }
    if (fields.includes('branch')) {
      messageLines.push(`สาขา: ${branch}`);
    }
    if (fields.includes('department')) {
      messageLines.push(`แผนก: ${department}`);
    }
    if (fields.includes('count')) {
      messageLines.push(`จำนวน: ${itemCount} รายการ`);
    }
    if (fields.includes('items')) {
      messageLines.push('รายละเอียดจำนวนรายการที่สั่งซื้อ:');
      messageLines.push(...itemLines);
    }

    const message = messageLines.filter(Boolean).join('\n');

    try {
      await sendLineRequest(
        {
          to: group.id,
          messages: [{ type: 'text', text: message }]
        },
        groupAccessToken
      );
      await logLineNotification({
        eventType,
        orderId,
        groupId: group.id,
        groupName: group.name || '',
        accessTokenHash,
        status: 'success',
        message
      });
    } catch (error) {
      await logLineNotification({
        eventType,
        orderId,
        groupId: group.id,
        groupName: group.name || '',
        accessTokenHash,
        status: 'failed',
        message,
        errorMessage: error?.message || 'LINE API error'
      });
    }
  }

  return { ok: true };
};
