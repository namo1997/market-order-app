import crypto from 'crypto';
import * as settingsModel from '../models/settings.model.js';
import * as directOrderRuleModel from '../models/direct-order-rule.model.js';
import { sendLineOrderNotification } from './line.js';

const DEFAULT_FIELDS = ['date', 'branch', 'department', 'count', 'items'];

const toSafeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getBangkokTimeText = (value = new Date()) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(value);

const parseLineGroups = (raw) => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
};

const getGroupTokens = (group = {}) => {
  const tokens = [];
  if (Array.isArray(group?.accessTokens)) {
    for (const entry of group.accessTokens) {
      const token =
        typeof entry === 'string'
          ? String(entry || '').trim()
          : String(entry?.token || '').trim();
      if (token) tokens.push(token);
    }
  }
  const legacyToken = String(group?.accessToken || '').trim();
  if (legacyToken) tokens.push(legacyToken);
  return tokens;
};

const getTokenByLineGroupId = ({ groups = [], lineGroupId, fallbackToken }) => {
  const target = String(lineGroupId || '').trim();
  if (!target) return '';

  const matched = groups.find((group) => String(group?.id || '').trim() === target);
  if (matched) {
    const [token] = getGroupTokens(matched);
    if (token) return token;
  }

  return String(fallbackToken || '').trim();
};

const buildPayloadHash = ({ orderId, lineGroupId, mergeMode, items }) => {
  const normalized = {
    order_id: Number(orderId || 0),
    line_group_id: String(lineGroupId || ''),
    merge_mode: String(mergeMode || 'group_daily'),
    items: (items || [])
      .map((item) => ({
        product_id: Number(item.product_id || 0),
        quantity: Number(item.quantity || 0)
      }))
      .sort((a, b) => a.product_id - b.product_id)
  };
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex');
};

const shouldPassCutoff = ({ currentTimeText, cutoffTime }) => {
  const current = String(currentTimeText || '').slice(0, 8);
  const cutoff = String(cutoffTime || '').slice(0, 8);
  if (!current || !cutoff) return false;
  return current > cutoff;
};

export const sendDirectOrderAfterCutoff = async ({
  orderDetail,
  title = '🟠 สั่งตรงผู้ขาย (หลังเวลา)',
  eventType = 'direct_order_after_cutoff'
}) => {
  const orderId = Number(orderDetail?.id);
  const items = Array.isArray(orderDetail?.items) ? orderDetail.items : [];
  if (!Number.isFinite(orderId) || orderId <= 0 || items.length === 0) {
    return { skipped: true, reason: 'missing_order_or_items' };
  }

  const productIds = Array.from(
    new Set(
      items
        .map((item) => Number(item?.product_id))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  );
  if (productIds.length === 0) {
    return { skipped: true, reason: 'missing_product_ids' };
  }

  const [rules, fallbackToken, groupsRaw] = await Promise.all([
    directOrderRuleModel.getEnabledDirectOrderRulesByProductIds(productIds),
    settingsModel.getSetting(
      'line_channel_access_token',
      process.env.LINE_CHANNEL_ACCESS_TOKEN || ''
    ),
    settingsModel.getSetting('line_notification_groups', '')
  ]);

  if (!Array.isArray(rules) || rules.length === 0) {
    return { skipped: true, reason: 'no_enabled_rules' };
  }

  const ruleByProductId = new Map(rules.map((row) => [Number(row.product_id), row]));
  const currentTimeText = getBangkokTimeText(new Date());

  const grouped = new Map();
  for (const item of items) {
    const productId = Number(item?.product_id);
    if (!Number.isFinite(productId) || productId <= 0) continue;
    const rule = ruleByProductId.get(productId);
    if (!rule) continue;
    if (!shouldPassCutoff({ currentTimeText, cutoffTime: rule.cutoff_time })) continue;

    const qty = toSafeNumber(item.quantity);
    if (qty <= 0) continue;

    const lineGroupId = String(rule.line_group_id || '').trim();
    if (!lineGroupId) continue;

    const key = `${lineGroupId}|${rule.merge_mode || 'group_daily'}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        line_group_id: lineGroupId,
        merge_mode: rule.merge_mode || 'group_daily',
        itemsMap: new Map()
      });
    }

    const group = grouped.get(key);
    const itemKey = String(productId);
    if (!group.itemsMap.has(itemKey)) {
      group.itemsMap.set(itemKey, {
        product_id: productId,
        product_name: item.product_name || '',
        quantity: 0,
        unit_abbr: item.unit_abbr || item.unit_name || '',
        supplier_name: item.supplier_name || item.product_group_name || ''
      });
    }

    const current = group.itemsMap.get(itemKey);
    current.quantity = toSafeNumber(current.quantity) + qty;
  }

  if (grouped.size === 0) {
    return { skipped: true, reason: 'none_pass_cutoff' };
  }

  const lineGroups = parseLineGroups(groupsRaw);
  const summary = {
    total_groups: grouped.size,
    sent_groups: 0,
    skipped_groups: 0,
    failed_groups: 0
  };

  for (const group of grouped.values()) {
    const mergedItems = Array.from(group.itemsMap.values())
      .filter((item) => toSafeNumber(item.quantity) > 0)
      .sort((a, b) => String(a.product_name).localeCompare(String(b.product_name), 'th'));

    if (mergedItems.length === 0) {
      summary.skipped_groups += 1;
      continue;
    }

    const payloadHash = buildPayloadHash({
      orderId,
      lineGroupId: group.line_group_id,
      mergeMode: group.merge_mode,
      items: mergedItems
    });

    const existing = await directOrderRuleModel.getDirectOrderDispatchLogByPayload({
      orderId,
      lineGroupId: group.line_group_id,
      payloadHash
    });
    if (existing && existing.status === 'sent') {
      summary.skipped_groups += 1;
      continue;
    }

    const token = getTokenByLineGroupId({
      groups: lineGroups,
      lineGroupId: group.line_group_id,
      fallbackToken
    });

    if (!token) {
      await directOrderRuleModel.upsertDirectOrderDispatchLog({
        orderId,
        lineGroupId: group.line_group_id,
        payloadHash,
        status: 'skipped',
        eventType,
        messageText: '',
        errorMessage: 'missing line access token'
      });
      summary.skipped_groups += 1;
      continue;
    }

    const directOrderDetail = {
      id: orderId,
      order_date: orderDetail?.order_date || null,
      branch_name: orderDetail?.branch_name || '-',
      department_name: orderDetail?.department_name || '-',
      items: mergedItems
    };

    try {
      const notifyResult = await sendLineOrderNotification(directOrderDetail, {
        accessToken: token,
        groups: [
          {
            id: group.line_group_id,
            name: `Direct Group ${group.line_group_id}`,
            enabled: true,
            accessTokens: [{ name: 'Direct Order Token', token }],
            quotaMode: 'manual',
            fields: DEFAULT_FIELDS
          }
        ],
        defaultFields: DEFAULT_FIELDS,
        title,
        eventType,
        orderId
      });

      const successGroups = Number(notifyResult?.success_groups || 0);
      const failedGroups = Number(notifyResult?.failed_groups || 0);
      const skippedGroups = Number(notifyResult?.skipped_groups || 0);
      const messageText = JSON.stringify({
        line_group_id: group.line_group_id,
        merge_mode: group.merge_mode,
        item_count: mergedItems.length
      });

      if (successGroups <= 0 || failedGroups > 0 || skippedGroups > 0) {
        await directOrderRuleModel.upsertDirectOrderDispatchLog({
          orderId,
          lineGroupId: group.line_group_id,
          payloadHash,
          status: failedGroups > 0 ? 'failed' : 'skipped',
          eventType,
          messageText,
          errorMessage:
            failedGroups > 0
              ? 'line notification failed'
              : 'line notification skipped'
        });
        if (failedGroups > 0) {
          summary.failed_groups += 1;
        } else {
          summary.skipped_groups += 1;
        }
        continue;
      }

      await directOrderRuleModel.upsertDirectOrderDispatchLog({
        orderId,
        lineGroupId: group.line_group_id,
        payloadHash,
        status: 'sent',
        eventType,
        messageText,
        errorMessage: null
      });
      summary.sent_groups += 1;
    } catch (error) {
      await directOrderRuleModel.upsertDirectOrderDispatchLog({
        orderId,
        lineGroupId: group.line_group_id,
        payloadHash,
        status: 'failed',
        eventType,
        messageText: JSON.stringify({
          line_group_id: group.line_group_id,
          merge_mode: group.merge_mode,
          item_count: mergedItems.length
        }),
        errorMessage: error?.message || 'direct order line send failed'
      });
      summary.failed_groups += 1;
    }
  }

  return { success: true, ...summary };
};
