import * as settingsModel from '../models/settings.model.js';

const normalizeAccessTokens = (tokens = []) =>
  tokens
    .map((entry) => {
      if (typeof entry === 'string') {
        return { name: '', token: entry };
      }
      if (entry && typeof entry === 'object') {
        return { name: entry.name || '', token: entry.token || '' };
      }
      return null;
    })
    .filter(Boolean);

const DEFAULT_FIELDS = ['date', 'branch', 'department', 'count', 'items'];

const normalizeProvider = (value) =>
  String(value || '').trim().toLowerCase() === 'discord' ? 'discord' : 'line';

const normalizeLineGroup = (group = {}, fallbackFields = DEFAULT_FIELDS) => {
  const accessTokens = Array.isArray(group?.accessTokens)
    ? normalizeAccessTokens(group.accessTokens)
    : [];
  const legacyTokens = group?.accessToken
    ? normalizeAccessTokens([group.accessToken])
    : [];

  return {
    id: group?.id || '',
    name: group?.name || '',
    enabled: group?.enabled !== false,
    accessTokens: accessTokens.length > 0 ? accessTokens : legacyTokens,
    accessToken: group?.accessToken || '',
    quotaMode: group?.quotaMode === 'auto' ? 'auto' : 'manual',
    fields:
      Array.isArray(group?.fields) && group.fields.length > 0
        ? group.fields
        : fallbackFields
  };
};

const normalizeDiscordGroup = (group = {}, fallbackFields = DEFAULT_FIELDS) => {
  const webhooks = Array.isArray(group?.accessTokens)
    ? normalizeAccessTokens(group.accessTokens)
    : Array.isArray(group?.webhooks)
      ? normalizeAccessTokens(
        group.webhooks.map((entry) =>
          typeof entry === 'string' ? { name: '', token: entry } : { name: entry?.name || '', token: entry?.url || '' }
        )
      )
      : [];
  const legacyWebhook = group?.accessToken
    ? normalizeAccessTokens([group.accessToken])
    : group?.webhookUrl
      ? normalizeAccessTokens([group.webhookUrl])
      : [];

  return {
    id: '',
    name: group?.name || '',
    enabled: group?.enabled !== false,
    accessTokens: webhooks.length > 0 ? webhooks : legacyWebhook,
    accessToken: '',
    quotaMode: 'manual',
    fields:
      Array.isArray(group?.fields) && group.fields.length > 0
        ? group.fields
        : fallbackFields
  };
};

export const getLineNotificationSettings = async (req, res, next) => {
  try {
    const provider = normalizeProvider(
      await settingsModel.getSetting('notification_provider', 'line')
    );
    const enabledValue = await settingsModel.getSetting('line_notifications_enabled', 'true');
    const enabled = String(enabledValue) === 'true';

    const accessToken = await settingsModel.getSetting(
      'line_channel_access_token',
      process.env.LINE_CHANNEL_ACCESS_TOKEN || ''
    );
    const groupId = await settingsModel.getSetting(
      'line_group_id',
      process.env.LINE_GROUP_ID || ''
    );
    const discordWebhookUrl = await settingsModel.getSetting(
      'discord_webhook_url',
      process.env.DISCORD_WEBHOOK_URL || ''
    );
    const discordReceivingWebhookUrl = await settingsModel.getSetting(
      'discord_receiving_webhook_url',
      process.env.DISCORD_RECEIVING_WEBHOOK_URL || ''
    );

    const fieldsRaw = await settingsModel.getSetting(
      'line_notification_fields',
      JSON.stringify(DEFAULT_FIELDS)
    );
    let fields = DEFAULT_FIELDS;
    try {
      const parsed = JSON.parse(fieldsRaw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        fields = parsed;
      }
    } catch (error) {
      // fallback to default fields
    }

    const groupsSettingKey =
      provider === 'discord' ? 'discord_notification_groups' : 'line_notification_groups';
    const groupsRaw = await settingsModel.getSetting(groupsSettingKey, '');
    let groups = [];
    if (groupsRaw) {
      try {
        const parsedGroups = JSON.parse(groupsRaw);
        if (Array.isArray(parsedGroups)) {
          groups = parsedGroups.map((group) =>
            provider === 'discord'
              ? normalizeDiscordGroup(group, fields)
              : normalizeLineGroup(group, fields)
          );
        }
      } catch (error) {
        groups = [];
      }
    }

    if (provider === 'discord') {
      if (groups.length === 0 && discordWebhookUrl) {
        groups = [
          {
            id: '',
            name: 'กลุ่ม Discord',
            enabled: true,
            fields,
            accessTokens: [{ name: 'Webhook หลัก', token: discordWebhookUrl }],
            accessToken: '',
            quotaMode: 'manual'
          }
        ];
      }
    } else if (groups.length === 0 && groupId) {
      groups = [
        {
          id: groupId,
          name: 'กลุ่ม LINE',
          enabled: true,
          fields,
          accessTokens: [],
          accessToken: '',
          quotaMode: 'manual'
        }
      ];
    }

    const hasAccessTokenBase =
      provider === 'discord' ? Boolean(discordWebhookUrl) : Boolean(accessToken);
    const hasAccessToken =
      hasAccessTokenBase ||
      groups.some(
        (group) =>
          Boolean(group?.accessToken) ||
          (Array.isArray(group?.accessTokens) &&
            group.accessTokens.some((entry) =>
              typeof entry === 'string' ? Boolean(entry) : Boolean(entry?.token)
            ))
      );
    const hasGroupId =
      provider === 'discord'
        ? groups.some((group) => group?.enabled !== false)
        : groups.some((group) => Boolean(group?.id));

    res.json({
      success: true,
      data: {
        provider,
        enabled,
        configured: hasAccessToken && hasGroupId,
        hasAccessToken,
        hasGroupId,
        accessToken,
        groupId,
        discordWebhookUrl,
        discordReceivingWebhookUrl,
        fields,
        groups
      }
    });
  } catch (error) {
    next(error);
  }
};

export const updateLineNotificationSettings = async (req, res, next) => {
  try {
    const {
      enabled,
      accessToken,
      groupId,
      fields,
      groups,
      provider,
      discordWebhookUrl,
      discordReceivingWebhookUrl
    } = req.body;
    const normalizedProvider = normalizeProvider(provider);
    const normalized = Boolean(enabled);
    await settingsModel.setSetting('notification_provider', normalizedProvider);
    const setting = await settingsModel.setSetting(
      'line_notifications_enabled',
      normalized ? 'true' : 'false'
    );
    if (fields !== undefined) {
      const safeFields = Array.isArray(fields) ? fields : [];
      await settingsModel.setSetting(
        'line_notification_fields',
        JSON.stringify(safeFields)
      );
    }
    if (groups !== undefined) {
      const safeGroups = Array.isArray(groups) ? groups : [];
      const groupsKey =
        normalizedProvider === 'discord'
          ? 'discord_notification_groups'
          : 'line_notification_groups';
      await settingsModel.setSetting(
        groupsKey,
        JSON.stringify(safeGroups)
      );
    }
    if (normalizedProvider === 'discord') {
      if (discordWebhookUrl !== undefined) {
        await settingsModel.setSetting('discord_webhook_url', discordWebhookUrl || '');
      }
      if (discordReceivingWebhookUrl !== undefined) {
        await settingsModel.setSetting(
          'discord_receiving_webhook_url',
          discordReceivingWebhookUrl || ''
        );
      }
    } else {
      if (accessToken !== undefined) {
        await settingsModel.setSetting('line_channel_access_token', accessToken || '');
      }
      if (groupId !== undefined) {
        await settingsModel.setSetting('line_group_id', groupId || '');
      }
    }

    res.json({
      success: true,
      data: {
        enabled: setting.setting_value === 'true',
        provider: normalizedProvider
      }
    });
  } catch (error) {
    next(error);
  }
};
