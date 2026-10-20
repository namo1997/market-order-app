import { getNotificationOptions } from './order-notification-options.js';
import { sendLineOrderNotification } from '../utils/line.js';
import { sendDiscordTextNotification } from '../utils/discord.js';
import { getBranchDepartmentInfo } from '../models/order.model.js';
import { receivingNotificationText } from './receiving-notify-policy.js';

// Shared with the legacy receiving controller. All transport/configuration
// dependencies are injectable; tests never invoke LINE or Discord.
export async function sendReceivingSavedNotification({ items, location, payload }, {
  options = getNotificationOptions, line = sendLineOrderNotification,
  discord = sendDiscordTextNotification, locate = getBranchDepartmentInfo
} = {}) {
  try {
    const config = await options();
    if (!config) return;
    if (!payload) payload = { sections: [{ basis: 'ใบสั่ง', items }], itemCount: items.length };
    if (typeof location === 'function') location = await location();
    if (!location) {
      const row = await locate({ branchId: payload.branchId, departmentId: payload.departmentId });
      location = { branchName: row?.branch_name || '-', departmentName: row?.department_name || '-' };
    }
    const message = receivingNotificationText(payload, location);
    if (config.provider === 'discord') {
      if (config.receivingWebhookUrl) await discord({ webhookUrl: config.receivingWebhookUrl, message,
        eventType: 'order_receiving_saved_variance', orderId: null,
        groupName: `${location.branchName} / ${location.departmentName}` });
    } else {
      await line({ order_date: payload.deliveryDate || new Date().toISOString(),
        branch_name: location.branchName, department_name: location.departmentName, items: [] }, {
        ...config, defaultFields: ['_text_only_'],
        groups: (config.groups || []).map(group => ({ ...group, fields: ['_text_only_'] })),
        title: message, eventType: 'order_receiving_saved_variance', orderId: null
      });
    }
  } catch { console.warn('[receiving-notify] attempt failed'); }
}
