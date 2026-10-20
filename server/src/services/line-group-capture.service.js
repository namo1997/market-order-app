const DEFAULT_GROUP_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MEMBER_CACHE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_MEDIA_BYTES = 50 * 1024 * 1024;

const normalizeGroupName = (value) => String(value || '')
  .normalize('NFKC')
  .replace(/\s+/g, ' ')
  .trim()
  .toLocaleLowerCase('th-TH');

export const parseLineCaptureGroupNames = (value) => new Set(
  String(value || '')
    .split(/[,\n]/)
    .map(normalizeGroupName)
    .filter(Boolean)
);

const toEventDate = (timestamp) => {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric) || numeric <= 0) return new Date();
  return new Date(numeric);
};

const toSafeJson = (value) => {
  try {
    return JSON.stringify(value || {});
  } catch (error) {
    return '{}';
  }
};

export const createLineGroupCaptureProcessor = ({
  channelAccessToken,
  allowedGroupNames,
  archiveStore,
  fetchImpl = globalThis.fetch,
  maxMediaBytes = DEFAULT_MAX_MEDIA_BYTES,
  logger = console
}) => {
  const token = String(channelAccessToken || '').trim();
  const allowedNames = allowedGroupNames instanceof Set
    ? allowedGroupNames
    : parseLineCaptureGroupNames(allowedGroupNames);
  const groupCache = new Map();
  const memberCache = new Map();

  const fetchLineJson = async (url) => {
    if (!token || typeof fetchImpl !== 'function') return null;
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new Error(`LINE API ${response.status}`);
    }
    return response.json();
  };

  const getGroupName = async (groupId) => {
    const safeGroupId = String(groupId || '').trim();
    if (!safeGroupId) return null;
    const cached = groupCache.get(safeGroupId);
    if (cached && Date.now() - cached.cachedAt < DEFAULT_GROUP_CACHE_TTL_MS) {
      return cached.groupName;
    }

    const summary = await fetchLineJson(
      `https://api.line.me/v2/bot/group/${encodeURIComponent(safeGroupId)}/summary`
    );
    const groupName = String(summary?.groupName || '').trim() || null;
    if (groupName) groupCache.set(safeGroupId, { groupName, cachedAt: Date.now() });
    return groupName;
  };

  const getMemberDisplayName = async ({ groupId, userId }) => {
    const safeUserId = String(userId || '').trim();
    if (!safeUserId) return null;
    const cacheKey = `${groupId}:${safeUserId}`;
    const cached = memberCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < DEFAULT_MEMBER_CACHE_TTL_MS) {
      return cached.displayName;
    }

    const profile = await fetchLineJson(
      `https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(safeUserId)}`
    );
    const displayName = String(profile?.displayName || '').trim() || null;
    if (displayName) memberCache.set(cacheKey, { displayName, cachedAt: Date.now() });
    return displayName;
  };

  const downloadImage = async (messageId) => {
    if (!token || typeof fetchImpl !== 'function') {
      throw new Error('LINE channel access token is not configured');
    }
    const response = await fetchImpl(
      `https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!response.ok) throw new Error(`LINE content API ${response.status}`);

    const contentLength = Number(response.headers?.get?.('content-length') || 0);
    if (contentLength > maxMediaBytes) {
      throw new Error(`LINE image exceeds ${maxMediaBytes} bytes`);
    }
    const content = Buffer.from(await response.arrayBuffer());
    if (content.length > maxMediaBytes) {
      throw new Error(`LINE image exceeds ${maxMediaBytes} bytes`);
    }
    return {
      content,
      contentType: String(response.headers?.get?.('content-type') || 'application/octet-stream'),
      sizeBytes: content.length
    };
  };

  const captureEvent = async (event) => {
    if (event?.type !== 'message') return { captured: false, reason: 'not_message' };
    if (event?.source?.type !== 'group') return { captured: false, reason: 'not_group' };

    const groupId = String(event?.source?.groupId || '').trim();
    const messageId = String(event?.message?.id || '').trim();
    if (!groupId || !messageId) return { captured: false, reason: 'missing_identity' };

    let groupName = null;
    try {
      groupName = await getGroupName(groupId);
    } catch (error) {
      logger.warn('[LINE CAPTURE] group lookup failed:', error?.message || error);
      return { captured: false, reason: 'group_lookup_failed' };
    }

    if (!allowedNames.has(normalizeGroupName(groupName))) {
      return { captured: false, reason: 'group_not_allowed', groupName };
    }

    let senderDisplayName = null;
    try {
      senderDisplayName = await getMemberDisplayName({
        groupId,
        userId: event?.source?.userId
      });
    } catch (error) {
      logger.warn('[LINE CAPTURE] member lookup failed:', error?.message || error);
    }

    const messageType = String(event?.message?.type || 'unknown').trim() || 'unknown';
    await archiveStore.upsertMessage({
      messageId,
      groupId,
      groupName,
      senderUserId: String(event?.source?.userId || '').trim() || null,
      senderDisplayName,
      messageType,
      textContent: messageType === 'text' ? String(event?.message?.text || '') : null,
      eventTimestamp: toEventDate(event?.timestamp),
      eventJson: toSafeJson(event),
      contentStatus: messageType === 'image' ? 'pending' : 'not_applicable'
    });

    if (messageType === 'image') {
      try {
        const image = await downloadImage(messageId);
        await archiveStore.storeContent({ messageId, ...image });
      } catch (error) {
        await archiveStore.markContentError({
          messageId,
          errorMessage: error?.message || 'unknown image capture error'
        });
        logger.error('[LINE CAPTURE] image capture failed:', error?.message || error);
      }
    }

    return { captured: true, groupName, messageType };
  };

  const processEvents = async (events) => {
    const safeEvents = Array.isArray(events) ? events : [];
    const results = [];
    for (const event of safeEvents) {
      try {
        results.push(await captureEvent(event));
      } catch (error) {
        logger.error('[LINE CAPTURE] event archive failed:', error?.message || error);
        results.push({ captured: false, reason: 'archive_failed' });
      }
    }
    return results;
  };

  return { processEvents };
};

