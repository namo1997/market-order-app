import * as settingsModel from '../models/settings.model.js';

export const getNotificationOptions = async () => {
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
    const freshMarketWebhookUrl = await settingsModel.getSetting(
      'discord_fresh_market_webhook_url',
      process.env.DISCORD_FRESH_MARKET_WEBHOOK_URL || ''
    );
    const otherSuppliersWebhookUrl = await settingsModel.getSetting(
      'discord_other_suppliers_webhook_url',
      process.env.DISCORD_OTHER_SUPPLIERS_WEBHOOK_URL || ''
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
      freshMarketWebhookUrl,
      otherSuppliersWebhookUrl,
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

