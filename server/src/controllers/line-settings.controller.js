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

export const getLineNotificationSettings = async (req, res, next) => {
  try {
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
    } catch (error) {
      // fallback to default fields
    }

    const groupsRaw = await settingsModel.getSetting('line_notification_groups', '');
    let groups = [];
    if (groupsRaw) {
      try {
        const parsedGroups = JSON.parse(groupsRaw);
        if (Array.isArray(parsedGroups)) {
          groups = parsedGroups.map((group) => {
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
              fields: Array.isArray(group?.fields) && group.fields.length > 0
                ? group.fields
                : defaultFields
            };
          });
        }
      } catch (error) {
        groups = [];
      }
    }

    if (groups.length === 0 && groupId) {
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

    const hasAccessToken =
      Boolean(accessToken) ||
      groups.some(
        (group) =>
          Boolean(group?.accessToken) ||
          (Array.isArray(group?.accessTokens) &&
            group.accessTokens.some((entry) =>
              typeof entry === 'string' ? Boolean(entry) : Boolean(entry?.token)
            ))
      );
    const hasGroupId = groups.some((group) => Boolean(group?.id));

    res.json({
      success: true,
      data: {
        enabled,
        configured: hasAccessToken && hasGroupId,
        hasAccessToken,
        hasGroupId,
        accessToken,
        groupId,
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
    const { enabled, accessToken, groupId, fields, groups } = req.body;
    const normalized = Boolean(enabled);
    const setting = await settingsModel.setSetting(
      'line_notifications_enabled',
      normalized ? 'true' : 'false'
    );
    if (accessToken !== undefined) {
      await settingsModel.setSetting('line_channel_access_token', accessToken || '');
    }
    if (groupId !== undefined) {
      await settingsModel.setSetting('line_group_id', groupId || '');
    }
    if (fields !== undefined) {
      const safeFields = Array.isArray(fields) ? fields : [];
      await settingsModel.setSetting(
        'line_notification_fields',
        JSON.stringify(safeFields)
      );
    }
    if (groups !== undefined) {
      const safeGroups = Array.isArray(groups) ? groups : [];
      await settingsModel.setSetting(
        'line_notification_groups',
        JSON.stringify(safeGroups)
      );
    }

    res.json({
      success: true,
      data: {
        enabled: setting.setting_value === 'true'
      }
    });
  } catch (error) {
    next(error);
  }
};
