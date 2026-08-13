import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import {
  getDataDir,
  getDbPath,
  getImagesDir,
  closeDay,
  createReceiptSubstitute,
  getDayReport,
  getIngestHealth,
  getItemById,
  getItemContext,
  getSenderProfile,
  initDatabase,
  deduplicateImages,
  listDays,
  listGroups,
  listItems,
  listMatches,
  reopenDay,
  listMessages,
  listPendingImageDownloads,
  listSenders,
  markDownloaded,
  markDownloadFailed,
  markSemanticDuplicateBills,
  markBillsMissingAmount,
  markUnsent,
  recordGroupValidationRequest,
  recordLineTransferRequest,
  recordLineEvent,
  requeueAiItems,
  resetAllAiAnalysis,
  resolveAmountFlag,
  reviewReimbursement,
  setItemMatch,
  setItemMatchGroup,
  splitBatchPaymentSummary,
  upsertSenderProfile,
  updateCategory,
  updateItemMetadata,
  upsertReceivedImage
} from './db.js';
import { renderDayReport } from './day-report.js';
import {
  checkPin,
  clearSessionCookie,
  loginPage,
  lockedFor,
  // requireAuthApi and requireAuthPage stay imported for the flip-the-switch step below
  requireAuthApi,
  requireAuthPage,
  setSessionCookie
} from './auth.js';
import {
  autoMatchAiPairs,
  getAiWorkerStatus,
  rebuildAiMatches,
  runAiWorkerCycle,
  startAiWorker
} from './ai-worker.js';
import { getConfiguredGroupSettings, pushLineGroupMessage, runConfiguredGroupChecks } from './group-check.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || '0.0.0.0';
const CHANNEL_SECRET = String(process.env.LINE_BILL_CAPTURE_CHANNEL_SECRET || '').trim();
const CHANNEL_ACCESS_TOKEN = String(process.env.LINE_BILL_CAPTURE_CHANNEL_ACCESS_TOKEN || '').trim();
const DEFAULT_GROUP_LABELS = {
  C987d13b96371f18f5a0996107d4f6ef5: 'สันกำแพง',
  C92c8a7b4a5099db619f6464e10eefab5: 'คันคลอง'
};
const GROUP_LABELS = (() => {
  const raw = String(process.env.LINE_BILL_CAPTURE_GROUP_LABELS || '').trim();
  if (!raw) return DEFAULT_GROUP_LABELS;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ...DEFAULT_GROUP_LABELS, ...parsed }
      : DEFAULT_GROUP_LABELS;
  } catch {
    console.warn('[LINE CAPTURE] invalid LINE_BILL_CAPTURE_GROUP_LABELS; using source IDs');
    return DEFAULT_GROUP_LABELS;
  }
})();
const ADMIN_ACTOR = 'admin-web';
const LINE_CONTENT_MOCK_DIR = String(process.env.LINE_CONTENT_MOCK_DIR || '').trim();
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const CATEGORY_SET = new Set(['pending', 'bill', 'bill_page', 'transfer', 'transfer_notice', 'incoming_transfer', 'other']);
const STATUS_SET = new Set(['received', 'downloaded', 'download_failed', 'duplicate', 'unsent']);
const MATCH_STATUS_SET = new Set(['pending', 'confirmed', 'rejected', 'manual_review', 'needs_amount']);

const app = express();

const noStore = (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
};

const verifyLineSignature = ({ rawBodyBuffer, signature }) => {
  if (!CHANNEL_SECRET) return false;
  if (!Buffer.isBuffer(rawBodyBuffer) || !signature) return false;

  const expected = crypto
    .createHmac('SHA256', CHANNEL_SECRET)
    .update(rawBodyBuffer)
    .digest('base64');

  const expectedBuffer = Buffer.from(expected);
  const incomingBuffer = Buffer.from(String(signature));
  if (expectedBuffer.length !== incomingBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, incomingBuffer);
};

const toLineSource = (source = {}) => {
  const sourceType = String(source?.type || '').trim().toLowerCase();
  const sourceId = String(source?.groupId || source?.roomId || '').trim();
  if (!['group', 'room'].includes(sourceType) || !sourceId) return null;
  return {
    sourceType,
    sourceId,
    senderUserId: String(source?.userId || '').trim() || null
  };
};

const toBangkokDate = (timestampMs) => {
  const value = Number(timestampMs || Date.now());
  const date = new Date((Number.isFinite(value) ? value : Date.now()) + BANGKOK_OFFSET_MS);
  return date.toISOString().slice(0, 10);
};

const sanitizePathSegment = (value, fallback = 'unknown') => {
  const normalized = String(value || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  return normalized || fallback;
};

const extensionFromContentType = (contentType) => {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (type === 'image/jpeg' || type === 'image/jpg') return '.jpg';
  if (type === 'image/png') return '.png';
  if (type === 'image/gif') return '.gif';
  if (type === 'image/webp') return '.webp';
  if (type === 'image/heic') return '.heic';
  return '.jpg';
};

const contentTypeFromExtension = (extension) => {
  const value = String(extension || '').toLowerCase();
  if (value === '.png') return 'image/png';
  if (value === '.gif') return 'image/gif';
  if (value === '.webp') return 'image/webp';
  if (value === '.heic') return 'image/heic';
  return 'image/jpeg';
};

const buildImagePath = ({ sourceId, messageId, timestampMs, extension }) => {
  const datePart = toBangkokDate(timestampMs);
  const safeSourceId = sanitizePathSegment(sourceId, 'source');
  const safeMessageId = sanitizePathSegment(messageId, 'message');
  const filename = `${safeMessageId}${extension}`;
  const relativePath = [datePart, safeSourceId, filename].join('/');
  return {
    relativePath,
    absolutePath: path.join(getImagesDir(), datePart, safeSourceId, filename)
  };
};

const downloadLineMessageContent = async (messageId) => {
  if (LINE_CONTENT_MOCK_DIR) {
    for (const extension of ['.jpg', '.jpeg', '.png', '.webp', '.gif']) {
      const filePath = path.join(LINE_CONTENT_MOCK_DIR, `${sanitizePathSegment(messageId, 'message')}${extension}`);
      try {
        const buffer = await fs.readFile(filePath);
        return {
          buffer,
          contentType: contentTypeFromExtension(extension),
          extension: extension === '.jpeg' ? '.jpg' : extension
        };
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    throw new Error(`LINE content mock not found for message ${messageId}`);
  }

  if (!CHANNEL_ACCESS_TOKEN) {
    throw new Error('LINE_BILL_CAPTURE_CHANNEL_ACCESS_TOKEN is not configured');
  }

  const response = await fetch(
    `https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`
      }
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`LINE content download failed: ${response.status}${body ? ` ${body.slice(0, 300)}` : ''}`);
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    contentType,
    extension: extensionFromContentType(contentType)
  };
};

const fetchLineSenderProfile = async ({ sourceType, sourceId, userId }) => {
  if (!CHANNEL_ACCESS_TOKEN || !sourceType || !sourceId || !userId) {
    throw new Error('LINE profile lookup is not configured');
  }
  const chatType = sourceType === 'room' ? 'room' : 'group';
  const response = await fetch(
    `https://api.line.me/v2/bot/${chatType}/${encodeURIComponent(sourceId)}/member/${encodeURIComponent(userId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`
      }
    }
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`LINE profile lookup failed: ${response.status}${body ? ` ${body.slice(0, 300)}` : ''}`);
  }
  return response.json();
};

const refreshSenderProfile = async (source, { force = false } = {}) => {
  const userId = String(source?.senderUserId || '').trim();
  if (!userId) return null;

  const current = await getSenderProfile({
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    userId
  });
  const lastFetched = Date.parse(String(current?.last_fetched_at || ''));
  if (!force && current && Number.isFinite(lastFetched) && Date.now() - lastFetched < 24 * 60 * 60 * 1000) {
    return current;
  }

  try {
    const profile = await fetchLineSenderProfile({
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      userId
    });
    return upsertSenderProfile({
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      userId,
      displayName: profile?.displayName,
      pictureUrl: profile?.pictureUrl,
      statusMessage: profile?.statusMessage,
      profileStatus: 'ok'
    });
  } catch (error) {
    await upsertSenderProfile({
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      userId,
      profileStatus: 'error'
    });
    console.warn('[LINE CAPTURE] sender profile lookup failed:', error?.message || error);
    return current;
  }
};

const saveImage = async ({ sourceId, messageId, timestampMs, buffer, extension }) => {
  const paths = buildImagePath({ sourceId, messageId, timestampMs, extension });
  await fs.mkdir(path.dirname(paths.absolutePath), { recursive: true });
  await fs.writeFile(paths.absolutePath, buffer);
  return paths;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const activeImageDownloads = new Set();

const safeDeleteStoredFile = async (storagePath) => {
  const safePath = String(storagePath || '').trim();
  if (!safePath) return;

  const resolvedRoot = path.resolve(getImagesDir());
  const resolvedTarget = path.resolve(safePath);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    console.warn('[LINE CAPTURE] refusing to delete file outside image root:', resolvedTarget);
    return;
  }

  await fs.unlink(resolvedTarget).catch((error) => {
    if (error?.code !== 'ENOENT') {
      console.warn('[LINE CAPTURE] file delete failed:', error?.message || error);
    }
  });
};

const processImageEvent = async (event, source) => {
  const lineMessageId = String(event?.message?.id || '').trim();
  if (!lineMessageId) return;
  if (activeImageDownloads.has(lineMessageId)) return;
  activeImageDownloads.add(lineMessageId);

  try {
    const item = await upsertReceivedImage({ event, source });
    if (['downloaded', 'duplicate', 'unsent'].includes(item?.status)) return;

    let downloaded = null;
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        downloaded = await downloadLineMessageContent(lineMessageId);
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 3) await sleep(250 * (2 ** (attempt - 1)));
      }
    }
    if (!downloaded) throw lastError || new Error('LINE content download failed');
    const paths = await saveImage({
      sourceId: source.sourceId,
      messageId: lineMessageId,
      timestampMs: event?.timestamp,
      buffer: downloaded.buffer,
      extension: downloaded.extension
    });
    const sha256 = crypto.createHash('sha256').update(downloaded.buffer).digest('hex');
    const saved = await markDownloaded({
      lineMessageId,
      contentType: downloaded.contentType,
      fileExtension: downloaded.extension,
      fileSizeBytes: downloaded.buffer.length,
      fileSha256: sha256,
      storagePath: paths.absolutePath,
      storageRelativePath: paths.relativePath
    });
    if (saved?.duplicate) {
      await safeDeleteStoredFile(paths.absolutePath);
      console.log(`[LINE CAPTURE] duplicate image marked: ${lineMessageId} -> item ${saved.duplicateOfItemId}`);
    }
  } catch (error) {
    await markDownloadFailed({
      lineMessageId,
      errorMessage: error?.message || 'unknown error'
    });
    console.warn('[LINE CAPTURE] image download failed:', error?.message || error);
  } finally {
    activeImageDownloads.delete(lineMessageId);
  }
};

const processUnsendEvent = async (event) => {
  const messageId = String(event?.unsend?.messageId || '').trim();
  if (!messageId) return;
  const previous = await markUnsent(messageId);
  if (previous?.storage_path) {
    await safeDeleteStoredFile(previous.storage_path);
  }
};

const persistWebhookEvents = async (events) => {
  const persistedSources = [];
  for (const event of Array.isArray(events) ? events : []) {
    const source = await recordLineEvent(event);
    if (event?.type === 'message' && event?.message?.type === 'image' && source) {
      await upsertReceivedImage({ event, source });
    }
    persistedSources.push(source);
  }
  return persistedSources;
};

const processEvents = async (events, persistedSources = null) => {
  const safeEvents = Array.isArray(events) ? events : [];
  for (let index = 0; index < safeEvents.length; index += 1) {
    const event = safeEvents[index];
    try {
      const source = Array.isArray(persistedSources)
        ? persistedSources[index]
        : await recordLineEvent(event);
      if (event?.type === 'message' && source) {
        await refreshSenderProfile(source);
        if (event?.message?.type === 'text' && String(event.message.text || '').trim() === 'ตรวจบิล'
          && getConfiguredGroupSettings(source.sourceType, source.sourceId)) {
          await recordGroupValidationRequest({
            webhookEventId: event.webhookEventId,
            sourceType: source.sourceType,
            sourceId: source.sourceId,
            requestedByUserId: source.senderUserId,
            commandText: 'ตรวจบิล'
          });
        }
      }
      if (event?.type === 'message' && event?.message?.type === 'image' && source) {
        await processImageEvent(event, source);
      }
      if (event?.type === 'unsend') {
        await processUnsendEvent(event);
      }
    } catch (error) {
      console.error('[LINE CAPTURE] event processing failed:', error?.message || error);
    }
  }
  await runConfiguredGroupChecks().catch((error) => {
    console.error('[LINE CAPTURE] configured group check failed:', error?.message || error);
  });
};

const recoverPendingImageDownloads = async () => {
  const rows = await listPendingImageDownloads({ limit: 1000 });
  if (!rows.length) return 0;
  let recovered = 0;
  for (const row of rows) {
    try {
      const event = JSON.parse(String(row.raw_event_json || '{}'));
      const source = await recordLineEvent(event);
      if (!source || event?.message?.type !== 'image') continue;
      await processImageEvent(event, source);
      recovered += 1;
    } catch (error) {
      console.warn(`[LINE CAPTURE] pending image recovery failed for item ${row.id}:`, error?.message || error);
    }
  }
  console.log(`[LINE CAPTURE] recovered ${recovered}/${rows.length} pending image download(s)`);
  return recovered;
};

const normalizeCategory = (value) => {
  const category = String(value || '').trim();
  return CATEGORY_SET.has(category) ? category : '';
};

const normalizeStatus = (value) => {
  const status = String(value || '').trim();
  return STATUS_SET.has(status) ? status : '';
};

const normalizeDate = (value) => {
  const date = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
};

const parseInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
};

const parseMoney = (value) => {
  const text = String(value || '').replace(/,/g, '').trim();
  const match = text.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const amount = Number(match[0]);
  return Number.isFinite(amount) ? amount : null;
};

const receiptSubstituteDraft = (item) => {
  const rawText = String(item?.ai_raw_text || item?.ai_summary || '');
  const destination = rawText.split(/ไปยัง/i)[1] || '';
  const payeeName = destination
    .split(/(?:ธนาคาร|บัญชี|(?:X{2,}|x{2,})[-Xx\d])/)[0]
    .replace(/\s+/g, ' ')
    .trim();
  const payeeAccount = destination.match(/(?:X{2,}|x{2,})[-Xx\d]+|\d{3}[-\d]{5,}/)?.[0] || '';
  return {
    payer_name: 'บริษัท โซลาว จำกัด',
    payee_name: payeeName,
    payee_account: payeeAccount,
    amount: Number(item?.slip_amount_value || 0),
    document_date: toBangkokDate(item?.event_timestamp_ms),
    source_slip_item_id: Number(item?.id || 0)
  };
};

app.get('/health', async (req, res) => {
  await initDatabase();
  const ingest = await getIngestHealth();
  res.json({
    success: true,
    service: 'line-bill-capture',
    dataDir: getDataDir(),
    dbPath: getDbPath(),
    ingest,
    timestamp: new Date().toISOString()
  });
});

app.post(['/webhook', '/api/webhook', '/api/line-bill-capture/webhook'], express.raw({ type: 'application/json' }), async (req, res, next) => {
  try {
    const rawBodyBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const signature = req.headers['x-line-signature'];

    if (!verifyLineSignature({ rawBodyBuffer, signature })) {
      return res.status(401).json({
        success: false,
        message: 'Invalid LINE signature'
      });
    }

    let payload = null;
    try {
      payload = JSON.parse(rawBodyBuffer.toString('utf8'));
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid LINE payload'
      });
    }

    const events = Array.isArray(payload?.events) ? payload.events : [];
    const persistedSources = await persistWebhookEvents(events);

    res.status(200).json({ success: true });

    setImmediate(() => {
      processEvents(events, persistedSources).catch((error) => {
        console.error('[LINE CAPTURE] process events failed:', error?.message || error);
      });
    });
  } catch (error) {
    next(error);
  }
});

// --- PIN auth (BUILT BUT NOT ENABLED YET) ------------------------------------
// The gates below are deliberately commented out: the admin is still open on purpose,
// pending the owner setting ADMIN_PIN on Railway. To enable, uncomment requireAuthPage on
// the two /admin mounts and requireAuthApi on /api/admin, and restore signIn() in the smoke test.
// --- PIN auth ---------------------------------------------------------------
// /webhook stays open (LINE calls it; it is signature-verified) and so does /health.
// Everything under /admin and /api/admin requires a PIN session.

app.post('/api/auth/login', noStore, express.urlencoded({ extended: false }), express.json({ limit: '4kb' }), (req, res) => {
  const fromForm = Boolean(req.is('application/x-www-form-urlencoded'));
  const reply = (status, message) => (fromForm
    ? res.status(status).type('html').send(loginPage(message))
    : res.status(status).json({ success: false, message }));

  const lockedSeconds = lockedFor(req);
  if (lockedSeconds > 0) {
    return reply(429, `ใส่ PIN ผิดหลายครั้ง ลองใหม่ในอีก ${Math.ceil(lockedSeconds / 60)} นาที`);
  }
  if (!checkPin(req, req.body?.pin)) {
    return reply(401, 'PIN ไม่ถูกต้อง');
  }

  setSessionCookie(req, res);
  return fromForm ? res.redirect('/admin') : res.json({ success: true });
});

app.post('/api/auth/logout', noStore, (req, res) => {
  clearSessionCookie(res);
  return res.json({ success: true });
});

app.get(['/admin', '/admin/'], noStore, /* requireAuthPage, */ (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});
app.get('/admin/day-report', noStore, /* requireAuthPage, */ async (req, res, next) => {
  try {
    const businessDate = normalizeDate(req.query.date);
    const sourceId = String(req.query.group || '').trim();
    const report = await getDayReport({ businessDate, sourceId });
    if (!report) return res.status(400).type('text').send('date and group are required');
    if (report.closing?.status !== 'closed') {
      return res.status(409).type('text').send('ต้องปิดรอบก่อนจึงจะพิมพ์รายงานได้');
    }
    const groupName = String(GROUP_LABELS[sourceId] || '').trim() || sourceId;
    return res.type('html').send(renderDayReport(report, {
      groupName,
      autoPrint: !['0', 'false', 'no'].includes(String(req.query.autoprint || '').toLowerCase())
    }));
  } catch (error) {
    next(error);
  }
});
app.use('/admin', noStore, /* requireAuthPage, */ express.static(PUBLIC_DIR, { index: false, redirect: false }));

app.use('/api/admin', noStore, /* requireAuthApi, */ express.json({ limit: '1mb' }));

app.get('/api/admin/ai/status', async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: await getAiWorkerStatus()
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/ai/run', async (req, res, next) => {
  try {
    const limit = parseInteger(req.body?.limit || req.query.limit, 5);
    res.json({
      success: true,
      data: await runAiWorkerCycle({ limit })
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/ai/rematch', async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: await rebuildAiMatches()
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/ai/requeue', async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const matchStatus = String(req.body?.match_status || '').trim();
    if (!ids.length && !matchStatus) {
      return res.status(400).json({ success: false, message: 'ids or match_status is required' });
    }
    res.json({ success: true, data: await requeueAiItems({ ids, matchStatus }) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/ai/reset-all', async (req, res, next) => {
  try {
    const aiStatus = await getAiWorkerStatus();
    if (!aiStatus.enabled) {
      return res.status(409).json({
        success: false,
        message: 'AI ยังปิดอยู่ จึงไม่ล้างผลเดิม กรุณาตั้ง OPENAI_API_KEY และเปิด AI ก่อน'
      });
    }
    res.json({
      success: true,
      data: await resetAllAiAnalysis({
        start: normalizeDate(req.body?.start),
        end: normalizeDate(req.body?.end),
        sourceId: String(req.body?.source_id || '').trim()
      })
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/days', async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: await listDays({
        start: normalizeDate(req.query.start),
        end: normalizeDate(req.query.end),
        sourceId: String(req.query.source_id || '').trim()
      })
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/days/close', async (req, res, next) => {
  try {
    const result = await closeDay({
      businessDate: normalizeDate(req.body?.business_date),
      sourceId: String(req.body?.source_id || '').trim(),
      sourceType: String(req.body?.source_type || 'group').trim() || 'group'
    });
    if (!result) {
      return res.status(400).json({ success: false, message: 'business_date and source_id are required' });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/days/reopen', async (req, res, next) => {
  try {
    const result = await reopenDay({
      businessDate: normalizeDate(req.body?.business_date),
      sourceId: String(req.body?.source_id || '').trim()
    });
    if (!result) {
      return res.status(400).json({ success: false, message: 'business_date and source_id are required' });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/items', async (req, res, next) => {
  try {
    const result = await listItems({
      category: normalizeCategory(req.query.category),
      status: normalizeStatus(req.query.status),
      matchStatus: String(req.query.match_status || '').trim(),
      flagged: ['1', 'true', 'yes'].includes(String(req.query.flagged || '').trim().toLowerCase()),
      sourceId: String(req.query.source_id || '').trim(),
      start: normalizeDate(req.query.start),
      end: normalizeDate(req.query.end),
      search: String(req.query.search || '').trim().slice(0, 200),
      limit: parseInteger(req.query.limit, 40),
      offset: parseInteger(req.query.offset, 0)
    });
    res.json({
      success: true,
      data: result.rows,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset
      },
      summary: result.summary,
      flagged_count: result.flagged_count
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/messages', async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: await listMessages({
        sourceId: String(req.query.source_id || '').trim(),
        senderUserId: String(req.query.sender_user_id || '').trim(),
        messageType: String(req.query.message_type || '').trim(),
        search: String(req.query.search || '').trim().slice(0, 200),
        start: normalizeDate(req.query.start || req.query.date),
        end: normalizeDate(req.query.end || req.query.date),
        limit: parseInteger(req.query.limit, 80),
        offset: parseInteger(req.query.offset, 0)
      })
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/senders', async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: await listSenders({
        sourceId: String(req.query.source_id || '').trim(),
        search: String(req.query.search || '').trim().slice(0, 200),
        limit: parseInteger(req.query.limit, 200),
        offset: parseInteger(req.query.offset, 0)
      })
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/senders/refresh', async (req, res, next) => {
  try {
    const rows = await listSenders({
      sourceId: String(req.body?.source_id || req.query.source_id || '').trim(),
      limit: parseInteger(req.body?.limit || req.query.limit, 200)
    });
    let refreshed = 0;
    let failed = 0;
    for (const row of rows) {
      const profile = await refreshSenderProfile({
        sourceType: row.source_type,
        sourceId: row.source_id,
        senderUserId: row.user_id
      }, { force: true });
      if (profile?.profile_status === 'ok') refreshed += 1;
      else failed += 1;
    }
    res.json({ success: true, data: { total: rows.length, refreshed, failed } });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/groups', async (req, res, next) => {
  try {
    const rows = await listGroups();
    res.json({
      success: true,
      data: rows.map((row) => ({
        ...row,
        display_name: String(
          GROUP_LABELS[row.source_id] || GROUP_LABELS[row.source_key] || ''
        ).trim() || null
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/matches', async (req, res, next) => {
  try {
    const status = String(req.query.status || '').trim();
    res.json({
      success: true,
      data: await listMatches({
        status: MATCH_STATUS_SET.has(status) ? status : '',
        sourceId: String(req.query.source_id || '').trim(),
        start: normalizeDate(req.query.start),
        end: normalizeDate(req.query.end),
        limit: parseInteger(req.query.limit, 100),
        offset: parseInteger(req.query.offset, 0)
      })
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/items/deduplicate', async (req, res, next) => {
  try {
    const result = await deduplicateImages();
    for (const duplicate of result.duplicates) {
      await safeDeleteStoredFile(duplicate.storagePath);
    }
    res.json({
      success: true,
      data: { duplicate_count: result.duplicates.length }
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/items/:id/image', async (req, res, next) => {
  try {
    const item = await getItemById(req.params.id);
    if (!item || !item.storage_path) {
      return res.status(404).json({ success: false, message: 'Image not found' });
    }

    const resolvedRoot = path.resolve(getImagesDir());
    const resolvedTarget = path.resolve(item.storage_path);
    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
      return res.status(403).json({ success: false, message: 'Invalid image path' });
    }

    await fs.access(resolvedTarget);
    res.setHeader('Content-Type', item.content_type || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(resolvedTarget);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return res.status(404).json({ success: false, message: 'Image file not found' });
    }
    next(error);
  }
});

app.get('/api/admin/items/:id/context', async (req, res, next) => {
  try {
    const context = await getItemContext({
      id: req.params.id,
      windowMs: parseInteger(req.query.window_ms, 2 * 60 * 60 * 1000),
      limit: parseInteger(req.query.limit, 80)
    });
    if (!context) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }
    res.json({ success: true, data: context });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/items/:id/request-transfer', async (req, res, next) => {
  try {
    const item = await getItemById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Bill item not found' });
    if (item.category !== 'bill') {
      return res.status(400).json({ success: false, message: 'Only a bill can request a transfer' });
    }
    if (item.match_status === 'confirmed') {
      return res.status(409).json({ success: false, message: 'This bill already has a confirmed slip' });
    }
    const text = String(req.body?.text || '').trim().slice(0, 5000);
    if (!text) return res.status(400).json({ success: false, message: 'Message text is required' });

    const pushed = await pushLineGroupMessage({ sourceType: item.source_type, sourceId: item.source_id, text });
    const request = await recordLineTransferRequest({
      itemId: item.id,
      sourceType: item.source_type,
      sourceId: item.source_id,
      messageText: text,
      status: pushed?.mock ? 'mock_sent' : 'sent',
      requestedBy: ADMIN_ACTOR
    });
    res.json({ success: true, data: request, mock: Boolean(pushed?.mock) });
  } catch (error) {
    const item = await getItemById(req.params.id).catch(() => null);
    const text = String(req.body?.text || '').trim().slice(0, 5000);
    if (item && text) {
      await recordLineTransferRequest({
        itemId: item.id,
        sourceType: item.source_type,
        sourceId: item.source_id,
        messageText: text,
        status: 'failed',
        requestedBy: ADMIN_ACTOR,
        errorMessage: error?.message || String(error)
      }).catch(() => {});
    }
    next(error);
  }
});

app.put('/api/admin/items/:id/category', async (req, res, next) => {
  try {
    const category = normalizeCategory(req.body?.category);
    if (!category) {
      return res.status(400).json({ success: false, message: 'Invalid category' });
    }
    const reason = String(req.body?.reason || '').trim().slice(0, 1000);
    const item = await updateCategory({ id: req.params.id, category, editedBy: ADMIN_ACTOR, reason });
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }
    res.json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/items/:id', async (req, res, next) => {
  try {
    const category = req.body?.category === undefined ? undefined : normalizeCategory(req.body.category);
    if (req.body?.category !== undefined && !category) {
      return res.status(400).json({ success: false, message: 'Invalid category' });
    }

    let item = await updateItemMetadata({
      id: req.params.id,
      category,
      categoryEditedBy: category === undefined ? undefined : ADMIN_ACTOR,
      vendorName: req.body?.vendor_name,
      supplierName: req.body?.supplier_name,
      billPurpose: req.body?.bill_purpose,
      billTotalText: req.body?.bill_total_text,
      billTotalValue: req.body?.bill_total_text === undefined ? undefined : parseMoney(req.body.bill_total_text),
      notes: req.body?.notes,
      editedBy: ADMIN_ACTOR
    });
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }
    let autoMatches = [];
    const changedMatchInput = category !== undefined || req.body?.bill_total_text !== undefined;
    if (changedMatchInput && ['bill', 'transfer', 'transfer_notice'].includes(item.category)) {
      autoMatches = await autoMatchAiPairs();
      if (autoMatches.length) item = await getItemById(req.params.id);
    }
    res.json({ success: true, data: item, auto_matches: autoMatches.length });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/items/:id/resolve-flag', async (req, res, next) => {
  try {
    const hasManualAmount = Object.prototype.hasOwnProperty.call(req.body || {}, 'bill_total_text');
    const item = await resolveAmountFlag({
      id: req.params.id,
      useAnnounced: Boolean(req.body?.use_announced),
      billTotalText: hasManualAmount ? req.body.bill_total_text : undefined,
      billTotalValue: hasManualAmount ? parseMoney(req.body.bill_total_text) : undefined,
      resolvedBy: ADMIN_ACTOR
    });
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }
    if (item.error === 'announced_amount_missing') {
      return res.status(400).json({ success: false, message: 'No announced amount is available' });
    }
    if (item.error === 'invalid_bill_total') {
      return res.status(400).json({ success: false, message: 'A valid bill total is required' });
    }
    res.json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/items/:id/receipt-substitute-draft', async (req, res, next) => {
  try {
    const item = await getItemById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
    if (!['transfer', 'transfer_notice'].includes(item.category)) {
      return res.status(400).json({ success: false, message: 'This item is not a transfer slip' });
    }
    if (['pending', 'confirmed', 'manual_review'].includes(item.match_status) && Number(item.matched_item_id || 0)) {
      return res.status(409).json({ success: false, message: 'This slip is already matched' });
    }
    const draft = receiptSubstituteDraft(item);
    if (!draft.amount) {
      return res.status(400).json({ success: false, message: 'The slip amount is missing' });
    }
    res.json({ success: true, data: draft });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/reimbursements/:id/review', async (req, res, next) => {
  try {
    const result = await reviewReimbursement({
      reimbursementItemId: req.params.id,
      status: String(req.body?.status || '').trim(),
      evidenceMode: String(req.body?.evidence_mode || '').trim(),
      reviewNote: String(req.body?.review_note || '').trim(),
      reviewedBy: ADMIN_ACTOR
    });
    const errors = {
      reimbursement_not_found: [404, 'Reimbursement item not found'],
      advance_not_found: [409, 'Linked advance-payment item not found'],
      invalid_status: [400, 'Invalid reimbursement review status'],
      invalid_evidence_mode: [400, 'Select how this expense is documented'],
      review_note_required: [400, 'A reason is required when no receipt substitute is needed'],
      existing_receipt_not_confirmed: [409, 'Confirm the existing bill or receipt first'],
      receipt_substitute_missing: [409, 'Create and confirm the receipt substitute first']
    };
    if (result?.error) {
      const [status, message] = errors[result.error] || [400, result.error];
      return res.status(status).json({ success: false, message });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/receipt-substitutes', async (req, res, next) => {
  try {
    const slipItemId = Number(req.body?.slip_item_id || 0);
    const slip = await getItemById(slipItemId);
    if (!slip) return res.status(404).json({ success: false, message: 'Slip not found' });
    const draft = receiptSubstituteDraft(slip);
    const result = await createReceiptSubstitute({
      slipItemId,
      documentDate: normalizeDate(req.body?.document_date) || draft.document_date,
      payerName: 'บริษัท โซลาว จำกัด',
      payeeName: String(req.body?.payee_name || draft.payee_name || '').trim().slice(0, 300),
      payeeAccount: String(req.body?.payee_account || draft.payee_account || '').trim().slice(0, 100),
      description: String(req.body?.description || '').trim().slice(0, 1000),
      createdBy: ADMIN_ACTOR
    });
    const errors = {
      slip_not_found: [404, 'Slip not found'],
      not_a_slip: [400, 'This item is not a transfer slip'],
      slip_unavailable: [409, 'This slip is unavailable'],
      slip_already_matched: [409, 'This slip is already matched'],
      slip_amount_missing: [400, 'The slip amount is missing'],
      payee_required: [400, 'Payee name is required'],
      description_required: [400, 'Expense description is required']
    };
    if (result?.error) {
      const [status, message] = errors[result.error] || [400, result.error];
      return res.status(status).json({ success: false, message, data: result });
    }
    const match = await setItemMatch({
      billItemId: result.item.id,
      slipItemId,
      score: 100,
      status: 'confirmed',
      reasons: ['สร้างใบแทนใบเสร็จรับเงินจากสลิปที่ไม่มีบิล'],
      createdBy: ADMIN_ACTOR
    });
    res.status(result.created ? 201 : 200).json({
      success: true,
      data: { item: await getItemById(result.item.id), match, created: result.created }
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/matches', async (req, res, next) => {
  try {
    const billItemId = Number(req.body?.bill_item_id || 0);
    const slipItemId = Number(req.body?.slip_item_id || 0);
    const status = String(req.body?.status || 'pending').trim();
    if (!billItemId || !slipItemId) {
      return res.status(400).json({ success: false, message: 'bill_item_id and slip_item_id are required' });
    }
    if (!MATCH_STATUS_SET.has(status)) {
      return res.status(400).json({ success: false, message: 'Invalid match status' });
    }
    const reviewNote = String(req.body?.review_note || '').trim().slice(0, 2000);
    const aiLearningApproved = Boolean(req.body?.ai_learning_approved);
    if (aiLearningApproved && !reviewNote) {
      return res.status(400).json({ success: false, message: 'A review note is required for AI learning' });
    }
    const match = await setItemMatch({
      billItemId,
      slipItemId,
      score: Number(req.body?.score || 0),
      status,
      reasons: Array.isArray(req.body?.reasons) ? req.body.reasons.slice(0, 20) : [],
      createdBy: ADMIN_ACTOR,
      reviewNote,
      aiLearningApproved
    });
    if (!match) {
      return res.status(404).json({ success: false, message: 'Bill or slip item not found' });
    }
    res.json({ success: true, data: match });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/match-groups', async (req, res, next) => {
  try {
    const status = String(req.body?.status || 'pending').trim();
    const result = await setItemMatchGroup({
      billItemIds: Array.isArray(req.body?.bill_item_ids) ? req.body.bill_item_ids : [],
      slipItemIds: Array.isArray(req.body?.slip_item_ids) ? req.body.slip_item_ids : [],
      status,
      reasons: Array.isArray(req.body?.reasons) ? req.body.reasons.slice(0, 20) : [],
      createdBy: ADMIN_ACTOR
    });
    const errors = {
      members_required: [400, 'ต้องเลือกบิลและสลิปอย่างน้อยฝั่งละ 1 รายการ'],
      invalid_status: [400, 'Invalid match status'],
      item_not_found: [404, 'ไม่พบเอกสารที่เลือก'],
      invalid_bill: [400, 'รายการฝั่งบิลมีเอกสารที่ไม่ใช่บิล'],
      invalid_slip: [400, 'รายการฝั่งสลิปมีเอกสารที่ไม่ใช่สลิป'],
      item_unavailable: [409, 'มีเอกสารที่ถูกลบหรือเป็นรูปซ้ำ'],
      amount_mismatch: [409, 'ยอดรวมบิลและยอดรวมสลิปยังไม่ตรงกัน']
    };
    if (result?.error) {
      const [code, message] = errors[result.error] || [400, result.error];
      return res.status(code).json({ success: false, message });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/items/:id/split-batch-payment', async (req, res, next) => {
  try {
    const result = await splitBatchPaymentSummary({
      parentItemId: Number(req.params.id || 0),
      lines: Array.isArray(req.body?.lines) ? req.body.lines : [],
      createdBy: ADMIN_ACTOR
    });
    const errors = {
      item_not_found: [404, 'ไม่พบรูปใบสรุป'],
      item_unavailable: [409, 'รูปถูกลบหรือเป็นรูปซ้ำ'],
      lines_required: [400, 'ต้องมีรายการอย่างน้อยหนึ่งแถว'],
      amount_required: [400, 'รายการที่ต้องจ่ายต้องระบุยอดเงิน'],
      already_split: [409, 'ใบสรุปนี้ถูกแยกเป็นรายการแล้ว']
    };
    if (result?.error) {
      const [code, message] = errors[result.error] || [400, result.error];
      return res.status(code).json({ success: false, message, data: result });
    }
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

app.get('/', (req, res) => {
  res.redirect('/admin');
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

app.use((error, req, res, next) => {
  console.error('[LINE CAPTURE] request failed:', error?.message || error);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

await initDatabase();
const semanticDuplicates = await markSemanticDuplicateBills();
if (semanticDuplicates.length) {
  console.warn(`[LINE CAPTURE] marked ${semanticDuplicates.length} semantic duplicate bill(s) before serving`);
}
// บิลที่ไม่มียอดต้องอยู่ใน needs_amount เสมอ ไม่ใช่ unmatched
// เดิมงานนี้ทำเฉพาะตอนกดปุ่ม "จัดคู่ใหม่" ข้อมูลที่ sync เข้ามาหรือของเก่า
// จึงค้างอยู่ถัง "บิลไม่เข้าคู่" ซึ่งไม่มีทางจับคู่ได้เพราะไม่มียอดให้เทียบ
const billsMissingAmount = await markBillsMissingAmount();
if (billsMissingAmount) {
  console.warn(`[LINE CAPTURE] moved ${billsMissingAmount} bill(s) without an amount to needs_amount`);
}
app.listen(PORT, HOST, () => {
  console.log(`LINE bill capture service running on http://${HOST}:${PORT}`);
  console.log(`Data dir: ${getDataDir()}`);
});
startAiWorker();
setTimeout(() => {
  recoverPendingImageDownloads().catch((error) => {
    console.error('[LINE CAPTURE] startup image recovery failed:', error?.message || error);
  });
}, 1000).unref();
