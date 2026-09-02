import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import sharp from 'sharp';
import {
  getDataDir,
  getImagesDir,
  closeDay,
  answerDecisionFollowup,
  cancelDecisionEvent,
  commitDecisionEvent,
  confirmCashPayment,
  createDecisionEvent,
  createReceiptSubstitute,
  getDayReport,
  getIngestHealth,
  getDecisionAgentHealth,
  getDecisionAgentRun,
  getItemById,
  getItemContext,
  getSenderProfile,
  initDatabase,
  deduplicateImages,
  listDays,
  listDecisionEvents,
  listCashPaymentRecipientHistory,
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
  clearNeedsAmountOnNonBills,
  markUnsent,
  finishDecisionEvent,
  recordGroupValidationRequest,
  recordLineTransferRequest,
  recordCategoryLearningExample,
  recordMatchLearningFeedback,
  repairItemMatchState,
  recordLineEvent,
  requeueAiItems,
  resetAllAiAnalysis,
  setAiQueuePaused,
  resolveAmountFlag,
  reviewReimbursement,
  setItemMatch,
  setItemMatchGroup,
  splitBatchPaymentSummary,
  upsertSenderProfile,
  updateCategory,
  updateCashPayment,
  updateItemMetadata,
  upsertReceivedImage,
  voidCashPayment
} from './db.js';
import { renderDayReport } from './day-report.js';
import {
  checkPin,
  checkAdminOperator,
  clearSessionCookie,
  getAdminOperator,
  hasAdminOperators,
  isSignedIn,
  loginPage,
  lockedFor,
  operatorPage,
  requireAuthApi,
  requireAuthPage,
  safeAdminNext,
  setOperatorCookie,
  setSessionCookie
} from './auth.js';
import {
  autoMatchAiPairs,
  getAiWorkerStatus,
  rebuildAiMatches,
  runAiWorkerCycle,
  reviewCategoryCorrection,
  startAiWorker
} from './ai-worker.js';
import { getConfiguredGroupSettings, pushLineGroupMessage, runConfiguredGroupChecks } from './group-check.js';
import { runShadowDecision, shadowAiConfig } from './shadow-ai.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const MOBILE_DIR = path.resolve(__dirname, '..', 'mobile-admin', 'dist');
const MOBILE_V2_DIR = path.resolve(__dirname, '..', 'mobile-admin-v2', 'dist');
const MOBILE_V3_DIR = path.resolve(__dirname, '..', 'mobile-admin-v3', 'dist');

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || '0.0.0.0';
const CHANNEL_SECRET = String(process.env.LINE_BILL_CAPTURE_CHANNEL_SECRET || '').trim();
const CHANNEL_ACCESS_TOKEN = String(process.env.LINE_BILL_CAPTURE_CHANNEL_ACCESS_TOKEN || '').trim();
const ACCOUNTING_EXPORT_TOKEN = String(process.env.LINE_BILL_CAPTURE_ACCOUNTING_EXPORT_TOKEN || '').trim();
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
const adminActor = (req) => getAdminOperator(req) || 'admin-web';
const DECISION_REASON_REQUIRED = String(process.env.DECISION_REASON_REQUIRED ?? '1').trim() !== '0';
const LINE_CONTENT_MOCK_DIR = String(process.env.LINE_CONTENT_MOCK_DIR || '').trim();
const IMAGE_DOWNLOAD_MAX_ATTEMPTS = Math.max(
  1,
  Math.min(20, Number(process.env.LINE_BILL_CAPTURE_DOWNLOAD_MAX_ATTEMPTS || 5))
);
const TRANSFER_IMAGE_TTL_MS = 15 * 60 * 1000;
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const CATEGORY_SET = new Set(['pending', 'bill', 'bill_page', 'transfer', 'transfer_notice', 'incoming_transfer', 'payment_voucher', 'other']);
const STATUS_SET = new Set(['received', 'downloaded', 'download_failed', 'duplicate', 'unsent']);
const MATCH_STATUS_SET = new Set(['pending', 'confirmed', 'rejected', 'manual_review', 'needs_amount']);

const app = express();

const requireAccountingExportToken = (req, res, next) => {
  if (!ACCOUNTING_EXPORT_TOKEN) return res.status(503).json({ error: 'ACCOUNTING_EXPORT_NOT_ENABLED' });
  const provided = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || String(req.headers['x-accounting-sync-token'] || '');
  const expectedBuffer = Buffer.from(ACCOUNTING_EXPORT_TOKEN);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    return res.status(401).json({ error: 'INVALID_ACCOUNTING_EXPORT_TOKEN' });
  }
  return next();
};

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

const buildImagePath = ({ sha256, extension }) => {
  const safeHash = String(sha256 || '').replace(/[^a-f0-9]/gi, '').toLowerCase();
  const filename = `${safeHash}${extension}`;
  const relativePath = ['blobs', safeHash.slice(0, 2), filename].join('/');
  return {
    relativePath,
    absolutePath: path.join(getImagesDir(), relativePath)
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

const saveImage = async ({ sha256, buffer, extension }) => {
  const paths = buildImagePath({ sha256, extension });
  await fs.mkdir(path.dirname(paths.absolutePath), { recursive: true });
  await fs.writeFile(paths.absolutePath, buffer, { flag: 'wx' }).catch((error) => {
    if (error?.code !== 'EEXIST') throw error;
  });
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

const signTransferImage = (itemId, expires) => crypto
  .createHmac('sha256', CHANNEL_SECRET)
  .update(`${Number(itemId)}:${Number(expires)}`)
  .digest('hex');

const transferImageUrl = (req, itemId) => {
  const expires = Date.now() + TRANSFER_IMAGE_TTL_MS;
  const signature = signTransferImage(itemId, expires);
  const configuredBase = String(process.env.LINE_BILL_CAPTURE_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const base = configuredBase || `${forwardedProto || req.protocol}://${req.get('host')}`;
  const original = `${base}/api/line-bill-capture/transfer-request-image/${Number(itemId)}?expires=${expires}&signature=${signature}`;
  return { original, preview: `${original}&variant=preview` };
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
    const sha256 = crypto.createHash('sha256').update(downloaded.buffer).digest('hex');
    const paths = await saveImage({
      sha256,
      buffer: downloaded.buffer,
      extension: downloaded.extension
    });
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
  const persistedEvents = [];
  for (const event of Array.isArray(events) ? events : []) {
    const source = await recordLineEvent(event);
    if (event?.type === 'message' && event?.message?.type === 'image' && source) {
      await upsertReceivedImage({ event, source });
    }
    if (event?.type === 'message' && event?.message?.type === 'text' && source
      && String(event.message.text || '').trim() === 'ตรวจบิล'
      && getConfiguredGroupSettings(source.sourceType, source.sourceId)) {
      await recordGroupValidationRequest({
        webhookEventId: event.webhookEventId,
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        requestedByUserId: source.senderUserId,
        commandText: 'ตรวจบิล'
      });
    }
    let unsentHandled = false;
    if (event?.type === 'unsend') {
      const messageId = String(event?.unsend?.messageId || '').trim();
      if (messageId) {
        const previous = await markUnsent(messageId);
        if (previous?.storage_path) await safeDeleteStoredFile(previous.storage_path);
        unsentHandled = true;
      }
    }
    persistedEvents.push({ source, unsentHandled });
  }
  return persistedEvents;
};

const processEvents = async (events, persistedEvents = null) => {
  const safeEvents = Array.isArray(events) ? events : [];
  for (let index = 0; index < safeEvents.length; index += 1) {
    const event = safeEvents[index];
    try {
      const persisted = Array.isArray(persistedEvents) ? persistedEvents[index] : null;
      const source = persisted
        ? persisted.source
        : await recordLineEvent(event);
      if (event?.type === 'message' && source) {
        await refreshSenderProfile(source);
        if (!persisted && event?.message?.type === 'text' && String(event.message.text || '').trim() === 'ตรวจบิล'
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
      if (event?.type === 'unsend' && !persisted?.unsentHandled) {
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

let imageRecoveryRunning = false;
const recoverPendingImageDownloads = async () => {
  if (imageRecoveryRunning) return 0;
  imageRecoveryRunning = true;
  try {
    const rows = await listPendingImageDownloads({ limit: 1000, maxAttempts: IMAGE_DOWNLOAD_MAX_ATTEMPTS });
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
  } finally {
    imageRecoveryRunning = false;
  }
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
    ? date
    : '';
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
    ingest,
    timestamp: new Date().toISOString()
  });
});

app.post(['/webhook', '/api/webhook', '/api/line-bill-capture/webhook'], express.raw({ type: 'application/json', limit: '1mb' }), async (req, res, next) => {
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
    const persistedEvents = await persistWebhookEvents(events);

    res.status(200).json({ success: true });

    setImmediate(() => {
      processEvents(events, persistedEvents).catch((error) => {
        console.error('[LINE CAPTURE] process events failed:', error?.message || error);
      });
    });
  } catch (error) {
    next(error);
  }
});

// LINE webhooks and health stay public. Admin pages and APIs require a signed session.
// Local preview explicitly disables this gate while bound to 127.0.0.1 only.

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
  if (fromForm) return res.redirect(hasAdminOperators() ? '/auth/operator?next=%2Fadmin' : '/admin');
  return res.json({ success: true, operator_required: hasAdminOperators() });
});

app.get('/auth/operator', noStore, (req, res) => {
  if (!isSignedIn(req)) return res.redirect(303, '/admin');
  const nextPath = safeAdminNext(req.query?.next);
  if (!hasAdminOperators()) return res.redirect(303, nextPath);
  return res.type('html').send(operatorPage(nextPath));
});

app.post('/api/auth/operator', noStore, express.urlencoded({ extended: false }), express.json({ limit: '4kb' }), (req, res) => {
  if (!isSignedIn(req)) return res.status(401).type('html').send(loginPage('กรุณาเปิดลิงก์หลังบ้านใหม่'));
  const nextPath = safeAdminNext(req.body?.next);
  const operator = String(req.body?.operator || '').trim();
  if (!checkAdminOperator(operator)) {
    return res.status(400).type('html').send(operatorPage(nextPath, 'ไม่พบชื่อผู้ใช้งานนี้'));
  }
  setOperatorCookie(req, res, operator);
  return res.redirect(303, nextPath);
});

app.post('/api/auth/logout', noStore, (req, res) => {
  clearSessionCookie(res);
  return res.json({ success: true });
});

app.get(['/m', '/m/'], noStore, requireAuthPage, (req, res) => {
  res.sendFile(path.join(MOBILE_DIR, 'index.html'));
});
app.use('/m', noStore, requireAuthPage, express.static(MOBILE_DIR, { index: false, redirect: false }));
app.get('/m/*', noStore, requireAuthPage, (req, res) => {
  res.sendFile(path.join(MOBILE_DIR, 'index.html'));
});

app.get(['/m2', '/m2/'], noStore, requireAuthPage, (req, res) => {
  res.sendFile(path.join(MOBILE_V2_DIR, 'index.html'));
});
app.use('/m2', noStore, requireAuthPage, express.static(MOBILE_V2_DIR, { index: false, redirect: false }));
app.get('/m2/*', noStore, requireAuthPage, (req, res) => {
  res.sendFile(path.join(MOBILE_V2_DIR, 'index.html'));
});

app.get(['/m3', '/m3/'], noStore, requireAuthPage, (req, res) => {
  res.sendFile(path.join(MOBILE_V3_DIR, 'index.html'));
});
app.use('/m3', noStore, requireAuthPage, express.static(MOBILE_V3_DIR, { index: false, redirect: false }));
app.get('/m3/*', noStore, requireAuthPage, (req, res) => {
  res.sendFile(path.join(MOBILE_V3_DIR, 'index.html'));
});

app.get(['/admin', '/admin/'], noStore, requireAuthPage, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});
app.get('/admin/day-report', noStore, requireAuthPage, async (req, res, next) => {
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
app.use('/admin', noStore, requireAuthPage, express.static(PUBLIC_DIR, { index: false, redirect: false }));

// LINE fetches image-message URLs server-to-server, so this one media route is public but
// short-lived and HMAC signed. It never lists data and cannot be used without the exact item URL.
app.get('/api/line-bill-capture/transfer-request-image/:id', noStore, async (req, res, next) => {
  try {
    const itemId = Number(req.params.id || 0);
    const expires = Number(req.query.expires || 0);
    const provided = String(req.query.signature || '');
    if (!itemId || !expires || expires < Date.now() || expires > Date.now() + TRANSFER_IMAGE_TTL_MS + 60_000) {
      return res.status(403).end();
    }
    const expected = signTransferImage(itemId, expires);
    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(provided);
    if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
      return res.status(403).end();
    }
    const item = await getItemById(itemId);
    if (!item || item.status !== 'downloaded' || !item.storage_path || !['image/jpeg', 'image/png'].includes(item.content_type)) {
      return res.status(404).end();
    }
    const resolvedRoot = path.resolve(getImagesDir());
    const resolvedTarget = path.resolve(item.storage_path);
    if (!resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) return res.status(403).end();
    await fs.access(resolvedTarget);
    if (String(req.query.variant || '') === 'preview') {
      const preview = await sharp(resolvedTarget)
        .rotate()
        .resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 78, mozjpeg: true })
        .toBuffer();
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=900');
      return res.send(preview);
    }
    res.setHeader('Content-Type', item.content_type);
    res.setHeader('Cache-Control', 'private, max-age=900');
    return res.sendFile(resolvedTarget);
  } catch (error) {
    if (error?.code === 'ENOENT') return res.status(404).end();
    return next(error);
  }
});

app.use('/api/admin', noStore, requireAuthApi, express.json({ limit: '1mb' }));

app.post('/api/admin/decision-contexts', async (req, res, next) => {
  try {
    const actionKey = String(req.body?.action_key || '').trim();
    if (!actionKey) return res.status(400).json({ success: false, message: 'action_key is required' });
    const result = await createDecisionEvent({
      actionKey,
      entityType: req.body?.entity_type,
      entityId: req.body?.entity_id,
      actor: adminActor(req),
      pageUrl: req.body?.page_url,
      contextSnapshot: req.body?.context_snapshot
    });
    setImmediate(() => runShadowDecision({ decisionId: result.id, runId: result.shadow_run_id }).catch(() => {}));
    res.status(201).json({ success: true, data: { id: result.id, shadow_run_id: result.shadow_run_id, shadow_status: result.shadow_status } });
  } catch (error) { next(error); }
});

app.get('/api/admin/decisions', async (req, res, next) => {
  try {
    res.json({ success: true, data: await listDecisionEvents({
      limit: req.query.limit,
      actionKey: String(req.query.action_key || ''),
      comparison: String(req.query.comparison || '')
    }) });
  } catch (error) { next(error); }
});

app.post('/api/admin/decisions/:id/follow-up', async (req, res, next) => {
  try {
    const answer = String(req.body?.answer || '').trim();
    if (!answer) return res.status(400).json({ success: false, message: 'answer is required' });
    res.json({ success: true, data: await answerDecisionFollowup({ decisionId: req.params.id, answer, answeredBy: adminActor(req) }) });
  } catch (error) { next(error); }
});

app.post('/api/admin/decisions/:id/cancel', async (req, res, next) => {
  try {
    const result = await cancelDecisionEvent({ id: req.params.id, actor: adminActor(req) });
    if (result?.error) return res.status(409).json({ success: false, message: result.error });
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
});

app.get('/api/admin/agents/health', async (_req, res, next) => {
  try {
    res.json({ success: true, data: {
      service: 'line-bill-capture', shadow_mode: true,
      ...shadowAiConfig(), ...(await getDecisionAgentHealth()),
      ingest: await getIngestHealth()
    } });
  } catch (error) { next(error); }
});

app.get('/api/admin/ingest-health', async (_req, res, next) => {
  try {
    const health = await getIngestHealth();
    res.json({
      success: true,
      data: {
        ...health,
        completeness: {
          ...health.completeness,
          anomalies: (health.completeness?.anomalies || []).map((row) => ({
            ...row,
            source_name: String(GROUP_LABELS[row.source_id] || '').trim() || row.source_id
          }))
        }
      }
    });
  } catch (error) { next(error); }
});

app.get('/api/admin/agents/runs/:runId', async (req, res, next) => {
  try {
    const run = await getDecisionAgentRun(req.params.runId);
    if (!run) return res.status(404).json({ success: false, message: 'Agent run not found' });
    res.json({ success: true, data: run });
  } catch (error) { next(error); }
});

const adminDecisionActionKey = (req) => {
  const route = String(req.path || '').replace(/\/\d+(?=\/|$)/g, '/:id');
  const method = String(req.method || '').toLowerCase();
  const known = {
    'post:/ai/run': 'ai.queue.run',
    'post:/ai/rematch': 'ai.matches.rebuild',
    'post:/ai/requeue': 'ai.items.requeue',
    'post:/ai/reset-all': 'ai.analysis.reset',
    'post:/ai/pause': 'ai.queue.pause',
    'post:/days/close': 'day.close',
    'post:/days/reopen': 'day.reopen',
    'post:/senders/refresh': 'senders.refresh',
    'post:/items/deduplicate': 'documents.deduplicate',
    'post:/items/:id/request-transfer': 'line.transfer_request.send',
    'put:/items/:id/category': 'document.category.change',
    'post:/items/:id/category-learning/review': 'document.category_learning.review',
    'patch:/items/:id': 'document.metadata.update',
    'post:/items/:id/cash-payment': 'cash_payment.confirm',
    'patch:/items/:id/cash-payment': 'cash_payment.update',
    'post:/items/:id/cash-payment/void': 'cash_payment.void',
    'post:/items/:id/repair-match-state': 'document.match_state.repair',
    'post:/items/:id/resolve-flag': 'document.amount_flag.resolve',
    'post:/reimbursements/:id/review': 'reimbursement.review',
    'post:/receipt-substitutes': 'receipt_substitute.create',
    'post:/matches': 'match.review',
    'post:/matches/:id/learning-feedback': 'match.learning_feedback',
    'post:/match-groups': 'match_group.review',
    'post:/items/:id/split-batch-payment': 'batch_payment.split'
  };
  return known[`${method}:${route}`] || `bill_capture.${method}.${route.replace(/^\//, '').replaceAll('/', '.')}`;
};

app.use('/api/admin', async (req, res, next) => {
  if (!DECISION_REASON_REQUIRED) return next();
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path === '/decision-contexts' || req.path.startsWith('/decisions/') || req.path.startsWith('/agents/') || req.path.endsWith('/category-learning/review')) return next();
  const actionKey = adminDecisionActionKey(req);
  const decisionId = String(req.headers['x-decision-id'] || req.body?.decision_id || '').trim();
  const reasonCode = String(req.headers['x-decision-reason-code'] || req.body?.reason_code || '').trim();
  const encodedReasonText = String(req.headers['x-decision-reason-text'] || req.body?.reason_text || '').trim();
  const evidenceMessageIds = String(req.headers['x-decision-evidence-ids'] || req.body?.evidence_message_ids || '')
    .split(',').map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value > 0).slice(0, 12);
  let reasonText = encodedReasonText;
  try { reasonText = decodeURIComponent(encodedReasonText); } catch {}
  if (!decisionId || !reasonCode || (reasonCode === 'other' && !reasonText)) {
    return res.status(422).json({
      success: false,
      message: 'ต้องระบุเหตุผลก่อนบันทึกการตัดสินใจ',
      details: { code: 'decision_reason_required', action_key: actionKey }
    });
  }
  try {
    const result = await commitDecisionEvent({
      id: decisionId, actionKey, route: req.originalUrl, method: req.method,
      reasonCode, reasonText, evidenceMessageIds, requestPayload: req.body || {}
    });
    if (result?.error) return res.status(409).json({ success: false, message: result.error });
    req.decisionId = decisionId;
    res.on('finish', () => {
      finishDecisionEvent({ id: decisionId, success: res.statusCode < 400, httpStatus: res.statusCode }).catch(() => {});
    });
    return next();
  } catch (error) { return next(error); }
});

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
    const aiStatus = String(req.body?.ai_status || '').trim();
    if (!ids.length && !matchStatus && !aiStatus) {
      return res.status(400).json({ success: false, message: 'ids, match_status or ai_status is required' });
    }
    res.json({ success: true, data: await requeueAiItems({ ids, matchStatus, aiStatus }) });
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
    const rawStart = String(req.body?.start || '').trim();
    const rawEnd = String(req.body?.end || '').trim();
    const sourceId = String(req.body?.source_id || '').trim();
    if ((rawStart && !normalizeDate(rawStart)) || (rawEnd && !normalizeDate(rawEnd))) {
      return res.status(400).json({ success: false, message: 'วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD' });
    }
    if (!rawStart && !rawEnd && !sourceId && req.body?.all !== true) {
      return res.status(400).json({ success: false, message: 'ต้องระบุวัน/กลุ่ม หรือยืนยัน all=true สำหรับทั้งระบบ' });
    }
    const result = await resetAllAiAnalysis({
      start: normalizeDate(rawStart),
      end: normalizeDate(rawEnd),
      sourceId
    });
    if (result?.error) {
      const message = result.error === 'invalid_date_range'
        ? 'วันเริ่มต้นต้องไม่อยู่หลังวันสิ้นสุด'
        : 'ขอบเขตวันที่ไม่ถูกต้อง';
      return res.status(400).json({ success: false, message, data: result });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/ai/pause', async (req, res, next) => {
  try {
    const result = await setAiQueuePaused({
      start: normalizeDate(req.body?.start),
      end: normalizeDate(req.body?.end),
      sourceId: String(req.body?.source_id || '').trim(),
      paused: req.body?.paused !== false
    });
    if (result?.error) {
      return res.status(400).json({
        success: false,
        message: result.error === 'scope_required' ? 'ต้องระบุวันหรือกลุ่มที่ต้องการพักคิว' : 'ขอบเขตวันที่ไม่ถูกต้อง',
        data: result
      });
    }
    res.json({ success: true, data: result });
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

// Read-only machine contract for the standalone management-accounting service.
// Open rounds expose status only; closed rounds expose the immutable report snapshot.
app.get('/accounting-export/rounds', noStore, requireAccountingExportToken, async (req, res, next) => {
  try {
    const start = normalizeDate(req.query.from);
    const end = normalizeDate(req.query.to);
    const sourceId = String(req.query.branch || req.query.source_id || '').trim();
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    const rows = await listDays({ start, end, sourceId });
    const updatedSince = req.query.updated_since ? new Date(String(req.query.updated_since)) : null;
    const filtered = rows.filter((row) => !updatedSince || !row.closed_at && !row.reopened_at || new Date(`${row.reopened_at || row.closed_at}Z`) > updatedSince);
    const page = filtered.slice(offset, offset + limit).map((row) => {
      const businessDate = String(row.business_date);
      const source = String(row.source_id);
      const revision = String(row.closed_at || row.reopened_at || `${businessDate}:${source}`);
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ businessDate, source, revision, summary: row.summary_json || null })).digest('hex');
      return {
        id: `${source}:${businessDate}`,
        business_date: businessDate,
        source_type: row.source_type || 'group',
        source_id: source,
        branch: GROUP_LABELS[source] || source,
        status: row.closing_status === 'closed' ? 'closed' : 'open',
        revision,
        closed_at: row.closed_at || null,
        reopened_at: row.reopened_at || null,
        fingerprint
      };
    });
    return res.json({ success: true, data: page, pagination: { limit, offset, total: filtered.length, next_offset: offset + page.length < filtered.length ? offset + page.length : null } });
  } catch (error) { return next(error); }
});

app.get('/accounting-export/rounds/:roundId/snapshot', noStore, requireAccountingExportToken, async (req, res, next) => {
  try {
    const raw = decodeURIComponent(String(req.params.roundId || ''));
    const separator = raw.lastIndexOf(':');
    const sourceId = separator >= 0 ? raw.slice(0, separator) : '';
    const businessDate = separator >= 0 ? raw.slice(separator + 1) : '';
    const report = await getDayReport({ businessDate, sourceId });
    if (!report) return res.status(404).json({ error: 'ROUND_NOT_FOUND' });
    if (report.closing?.status !== 'closed') return res.status(409).json({ error: 'ROUND_NOT_CLOSED', status: report.closing?.status || 'open', business_date: businessDate, source_id: sourceId });
    const snapshot = report.closing.summary || {};
    const transactions = Array.isArray(report.transactions) ? report.transactions : [];
    const items = transactions.flatMap((transaction, transactionIndex) => {
      const bills = Array.isArray(transaction.bill_members) ? transaction.bill_members : [];
      return bills.map((bill, billIndex) => ({
        id: `${sourceId}:${businessDate}:transaction:${transactionIndex}:bill:${billIndex}:${bill.bill_id || ''}`,
        bill_id: bill.bill_id || null,
        source_id: sourceId,
        business_date: businessDate,
        document_date: businessDate,
        supplier_name: bill.vendor_name || transaction.vendor_name || null,
        description: bill.bill_purpose || bill.vendor_name || transaction.description || 'ค่าใช้จ่ายจากบิลตลาด',
        amount_incl_vat: Number(bill.bill_total_value || 0),
        payment_method: transaction.payment_method || null,
        paid_date: transaction.slip_timestamp_ms ? new Date(Number(transaction.slip_timestamp_ms)).toISOString().slice(0, 10) : businessDate,
        evidence_url: bill.image_url || bill.image_path || null,
        transaction_id: transaction.transaction_id || null,
        raw_transaction: transaction
      }));
    });
    return res.json({ success: true, data: { id: raw, business_date: businessDate, source_id: sourceId, revision: report.closing.updated_at || report.closing.closed_at, fingerprint: crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'), status: 'closed', summary: snapshot, items, reimbursements: report.reimbursements || [], incoming_transfers: report.incoming_transfers || [] } });
  } catch (error) { return next(error); }
});

app.get('/api/admin/cash-payments/recipients', async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: await listCashPaymentRecipientHistory({ limit: parseInteger(req.query.limit, 24) })
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
    if (result.error === 'day_has_unresolved_items') {
      return res.status(409).json({ success: false, message: 'ยังมีรายการที่ต้องตรวจหรือยังไม่เข้าคู่', data: result });
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
      live: ['1', 'true', 'yes'].includes(String(req.query.live || '').trim().toLowerCase()),
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
    let item = await getItemById(req.params.id);
    if (item?.status === 'duplicate' && item.duplicate_of_item_id) {
      item = await getItemById(item.duplicate_of_item_id);
    }
    if (!item || item.status === 'unsent' || !item.storage_path) {
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
      return res.status(409).json({ success: false, message: 'บิลนี้ชำระแล้ว' });
    }
    if (req.body?.confirmation !== 'SEND_IMAGE_AND_TEXT' || Number(req.body?.preview_item_id || 0) !== Number(item.id)) {
      return res.status(400).json({ success: false, message: 'กรุณาตรวจตัวอย่างรูป กลุ่ม และข้อความก่อนยืนยันส่ง' });
    }
    if (!item.storage_path || !['image/jpeg', 'image/png'].includes(item.content_type)) {
      return res.status(409).json({ success: false, message: 'รูปบิลนี้ไม่ใช่ JPEG/PNG จึงยังส่งเป็นรูปเข้า LINE ไม่ได้' });
    }
    const text = String(req.body?.text || '').trim().slice(0, 5000);
    if (!text) return res.status(400).json({ success: false, message: 'Message text is required' });

    const imageUrls = transferImageUrl(req, item.id);
    if (String(process.env.LINE_BILL_CAPTURE_PUSH_MOCK || '').trim() !== '1' && !imageUrls.original.startsWith('https://')) {
      return res.status(500).json({ success: false, message: 'ต้องตั้ง LINE_BILL_CAPTURE_PUBLIC_BASE_URL เป็น HTTPS ก่อนส่งรูป' });
    }
    const pushed = await pushLineGroupMessage({
      sourceType: item.source_type,
      sourceId: item.source_id,
      text,
      imageUrl: imageUrls.original,
      previewImageUrl: imageUrls.preview
    });
    const request = await recordLineTransferRequest({
      itemId: item.id,
      sourceType: item.source_type,
      sourceId: item.source_id,
      messageText: text,
      status: pushed?.mock ? 'mock_sent' : 'sent',
      requestedBy: adminActor(req),
      includesImage: true,
      imageItemId: item.id
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
        requestedBy: adminActor(req),
        includesImage: true,
        imageItemId: item.id,
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
    const before = await getItemById(req.params.id);
    if (!before) return res.status(404).json({ success: false, message: 'Item not found' });
    const amountKind = category === 'bill'
      ? 'bill'
      : ['transfer', 'transfer_notice'].includes(category) ? 'slip' : '';
    const requestedAmountText = amountKind === 'bill'
      ? req.body?.bill_total_text
      : amountKind === 'slip' ? req.body?.slip_amount_text : undefined;
    const currentAmount = amountKind === 'bill'
      ? (before.bill_total_value ?? parseMoney(before.bill_total_text))
      : amountKind === 'slip' ? (before.slip_amount_value ?? parseMoney(before.slip_amount_text)) : null;
    const resultingAmount = requestedAmountText === undefined ? Number(currentAmount || 0) : Number(parseMoney(requestedAmountText) || 0);
    if (amountKind && !(resultingAmount > 0)) {
      return res.status(400).json({
        success: false,
        code: 'document_amount_required',
        message: `กรุณาระบุยอด${amountKind === 'bill' ? 'บิล' : 'สลิป'}มากกว่า 0 บาทก่อนเปลี่ยนประเภท`
      });
    }
    const learningRequested = req.body?.ai_learning_approved === true;
    const aiResponse = String(req.body?.learning_response || '').trim().slice(0, 2000);
    if (learningRequested && (!reason || !aiResponse)) {
      return res.status(400).json({ success: false, message: 'ต้องมีเหตุผลและคำตอบยืนยันจาก AI ก่อนบันทึกเป็นตัวอย่าง' });
    }
    let item = await updateItemMetadata({
      id: req.params.id,
      category,
      categoryEditedBy: adminActor(req),
      categoryEditReason: reason,
      billTotalText: amountKind === 'bill' && requestedAmountText !== undefined ? requestedAmountText : undefined,
      billTotalValue: amountKind === 'bill' && requestedAmountText !== undefined ? resultingAmount : undefined,
      slipAmountText: amountKind === 'slip' && requestedAmountText !== undefined ? requestedAmountText : undefined,
      slipAmountValue: amountKind === 'slip' && requestedAmountText !== undefined ? resultingAmount : undefined,
      editedBy: adminActor(req)
    });
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }
    // เก็บทุกครั้งที่คนแก้ประเภท ไม่ใช่เฉพาะตอนที่พิมพ์เหตุผล
    // เพราะการแก้ที่เกิดบ่อยที่สุดคือกดเปลี่ยนเฉย ๆ ถ้าไม่เก็บก็ไม่ได้เรียนอะไรจากมันเลย
    // (คู่ ประเภทเดิม→ประเภทใหม่ พร้อมรูป เป็นตัวอย่างที่ใช้สอนได้อยู่แล้ว)
    //
    // แต่คนต้องสั่งไม่ให้เก็บได้ ส่ง record_learning:false มาเมื่อรายการนั้นเป็นกรณีเฉพาะกิจ
    // ที่ไม่ควรเอาไปสอน เช่นรูปเสีย รูปซ้ำ หรือแก้ผิดแล้วแก้กลับ
    const recordLearning = req.body?.record_learning !== false;
    const learning = (!recordLearning || before.category === category) ? null : await recordCategoryLearningExample({
      item: before,
      originalCategory: before.category,
      correctedCategory: category,
      reason,
      aiResponse: learningRequested ? aiResponse : '',
      approvedBy: adminActor(req)
    });
    let autoMatches = [];
    if (amountKind) {
      autoMatches = await autoMatchAiPairs();
      if (autoMatches.length) item = await getItemById(req.params.id);
    }
    const relatedAutoMatch = autoMatches.find((match) =>
      Number(match.bill_item_id) === Number(item.id) || Number(match.slip_item_id) === Number(item.id)
    );
    res.json({
      success: true,
      data: {
        ...item,
        learning,
        auto_matches: relatedAutoMatch ? 1 : 0,
        auto_match_id: relatedAutoMatch?.id || null,
        auto_match_status: relatedAutoMatch?.status || null,
        auto_match_bill_id: relatedAutoMatch?.bill_item_id || null,
        auto_match_slip_id: relatedAutoMatch?.slip_item_id || null
      }
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/items/:id/category-learning/review', async (req, res, next) => {
  try {
    const item = await getItemById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
    const reason = String(req.body?.reason || '').trim().slice(0, 1500);
    if (!reason) return res.status(400).json({ success: false, message: 'กรุณาระบุเหตุผล' });
    // เดิมฝัง 'other' ไว้ตายตัว ทำให้สอน AI ได้เฉพาะตอนกด "ไม่ใช่บิล/สลิป"
    // ทั้งที่การแก้ที่มีค่าที่สุดคือ บิล↔สลิป
    const targetCategory = normalizeCategory(req.body?.target_category) || 'other';
    const result = await reviewCategoryCorrection({ item, reason, targetCategory });
    res.json({ success: true, data: result });
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
    const currentItem = await getItemById(req.params.id);
    if (!currentItem) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }
    const resultingCategory = category || currentItem.category;
    if (req.body?.slip_amount_text !== undefined) {
      const slipAmount = parseMoney(req.body.slip_amount_text);
      if (!['transfer', 'transfer_notice', 'incoming_transfer'].includes(resultingCategory)) {
        return res.status(400).json({ success: false, message: 'แก้ยอดสลิปได้เฉพาะเอกสารการโอน' });
      }
      if (!(Number(slipAmount) > 0)) {
        return res.status(400).json({ success: false, message: 'กรุณาระบุยอดสลิปมากกว่า 0 บาท' });
      }
    }

    let item = await updateItemMetadata({
      id: req.params.id,
      category,
      categoryEditedBy: category === undefined ? undefined : adminActor(req),
      vendorName: req.body?.vendor_name,
      supplierName: req.body?.supplier_name,
      billPurpose: req.body?.bill_purpose,
      billTotalText: req.body?.bill_total_text,
      billTotalValue: req.body?.bill_total_text === undefined ? undefined : parseMoney(req.body.bill_total_text),
      slipAmountText: req.body?.slip_amount_text,
      slipAmountValue: req.body?.slip_amount_text === undefined ? undefined : parseMoney(req.body.slip_amount_text),
      notes: req.body?.notes,
      editedBy: adminActor(req)
    });
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }
    let autoMatches = [];
    const changedMatchInput = category !== undefined || req.body?.bill_total_text !== undefined || req.body?.slip_amount_text !== undefined;
    if (changedMatchInput && ['bill', 'transfer', 'transfer_notice'].includes(item.category)) {
      autoMatches = await autoMatchAiPairs();
      if (autoMatches.length) item = await getItemById(req.params.id);
    }
    const relatedAutoMatch = autoMatches.find((match) =>
      Number(match.bill_item_id) === Number(item.id) || Number(match.slip_item_id) === Number(item.id)
    );
    res.json({
      success: true,
      data: {
        ...item,
        auto_matches: relatedAutoMatch ? 1 : 0,
        auto_match_id: relatedAutoMatch?.id || null,
        auto_match_status: relatedAutoMatch?.status || null,
        auto_match_bill_id: relatedAutoMatch?.bill_item_id || null,
        auto_match_slip_id: relatedAutoMatch?.slip_item_id || null
      }
    });
  } catch (error) {
    next(error);
  }
});

const cashPaymentErrors = {
  bill_not_found: [404, 'ไม่พบบิล'],
  not_a_bill: [400, 'รายการนี้ไม่ใช่บิล'],
  bill_unavailable: [409, 'บิลถูกลบหรือเป็นรูปซ้ำ'],
  amount_review_required: [409, 'บิลยังติดธงตรวจยอด ต้องเคลียร์ธงก่อน'],
  amount_missing: [400, 'บิลยังไม่มียอดเงิน'],
  cash_payment_exists: [409, 'บิลนี้บันทึกชำระเงินสดแล้ว'],
  cash_payment_not_found: [404, 'ไม่พบรายการชำระเงินสด'],
  active_match_exists: [409, 'บิลนี้มีคู่สลิปอยู่แล้ว ต้องยกเลิกคู่ก่อน'],
  recipient_required: [400, 'ต้องระบุชื่อผู้รับเงิน'],
  note_required: [400, 'ต้องระบุหมายเหตุการจ่ายเงินสด'],
  void_reason_required: [400, 'ต้องระบุเหตุผลที่ยกเลิก'],
  business_date_missing: [400, 'ไม่พบวันที่รอบของบิล']
};

const sendCashPaymentResult = (res, result, successStatus = 200) => {
  if (result?.error) {
    const [status, message] = cashPaymentErrors[result.error] || [400, result.error];
    return res.status(status).json({ success: false, message, data: result });
  }
  return res.status(successStatus).json({ success: true, data: result });
};

app.post('/api/admin/items/:id/cash-payment', async (req, res, next) => {
  try {
    const result = await confirmCashPayment({
      billItemId: req.params.id,
      recipientName: req.body?.recipient_name,
      note: req.body?.note,
      confirmedBy: adminActor(req)
    });
    return sendCashPaymentResult(res, result, 201);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/items/:id/cash-payment', async (req, res, next) => {
  try {
    const result = await updateCashPayment({
      billItemId: req.params.id,
      recipientName: req.body?.recipient_name,
      note: req.body?.note,
      updatedBy: adminActor(req)
    });
    return sendCashPaymentResult(res, result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/items/:id/cash-payment/void', async (req, res, next) => {
  try {
    const result = await voidCashPayment({
      billItemId: req.params.id,
      reason: req.body?.reason,
      voidedBy: adminActor(req)
    });
    return sendCashPaymentResult(res, result);
  } catch (error) {
    next(error);
  }
});

// ซ่อมรายการที่ตกหล่น: คำนวณสถานะจับคู่ใหม่จากแถวจับคู่จริง
// ใช้กับรายการในถัง "ตกหล่น" ที่ปิดรอบไม่ได้แต่ไม่โผล่ในถังงานปกติ
app.post('/api/admin/items/:id/repair-match-state', async (req, res, next) => {
  try {
    const result = await repairItemMatchState(req.params.id);
    if (!result) return res.status(404).json({ success: false, message: 'Item not found' });
    res.json({ success: true, data: result });
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
      resolvedBy: adminActor(req)
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
      reviewedBy: adminActor(req)
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
      createdBy: adminActor(req)
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
    res.status(result.created ? 201 : 200).json({
      success: true,
      data: { item: result.item, match: result.match, created: result.created }
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
    if (!['pending', 'confirmed', 'rejected'].includes(status)) {
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
      createdBy: adminActor(req),
      reviewNote,
      aiLearningApproved,
      replaceExisting: req.body?.replace_existing === true
    });
    const matchErrors = {
      same_item: [400, 'บิลและสลิปต้องเป็นคนละรูป'],
      invalid_status: [400, 'สถานะคู่ไม่ถูกต้อง'],
      invalid_bill: [400, 'รายการฝั่งบิลไม่ใช่บิล'],
      invalid_slip: [400, 'รายการฝั่งสลิปไม่ใช่สลิป'],
      amount_missing: [400, 'บิลหรือสลิปยังไม่มียอดเงิน'],
      item_unavailable: [409, 'เอกสารถูกลบหรือเป็นรูปซ้ำ'],
      amount_review_required: [409, 'รายการนี้มีธงตรวจยอด ต้องเคลียร์ธงก่อนยืนยัน'],
      amount_mismatch: [409, 'ยอดบิลและสลิปยังไม่ตรงกัน'],
      cash_payment_conflict: [409, 'บิลนี้ชำระเงินสดแล้ว ต้องยกเลิกเงินสดก่อน'],
      document_already_used: [409, 'บิลหรือสลิปนี้ถูกใช้ในธุรกรรมอื่นแล้ว กรุณาใช้คำสั่งเปลี่ยนคู่เพื่อยืนยันยกเลิกคู่เดิม'],
    };
    if (match?.error) {
      const [code, message] = matchErrors[match.error] || [400, match.error];
      return res.status(code).json({ success: false, message, data: match });
    }
    if (!match) {
      return res.status(404).json({ success: false, message: 'Bill or slip item not found' });
    }
    res.json({ success: true, data: match });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/matches/:id/learning-feedback', async (req, res, next) => {
  try {
    const result = await recordMatchLearningFeedback({
      matchId: req.params.id,
      reviewNote: req.body?.review_note,
      approvedBy: adminActor(req)
    });
    const errors = {
      match_not_found: [404, 'ไม่พบคู่เอกสารนี้'],
      match_not_confirmed: [409, 'สอนได้เฉพาะคู่ที่คนยืนยันแล้ว'],
      review_note_required: [400, 'กรุณาระบุว่าเหตุผลหรือลำดับของ AI ผิดอย่างไร']
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

app.post('/api/admin/match-groups', async (req, res, next) => {
  try {
    const status = String(req.body?.status || 'pending').trim();
    const result = await setItemMatchGroup({
      billItemIds: Array.isArray(req.body?.bill_item_ids) ? req.body.bill_item_ids : [],
      slipItemIds: Array.isArray(req.body?.slip_item_ids) ? req.body.slip_item_ids : [],
      status,
      reasons: Array.isArray(req.body?.reasons) ? req.body.reasons.slice(0, 20) : [],
      createdBy: adminActor(req),
      replaceExisting: req.body?.replace_existing === true
    });
    const errors = {
      members_required: [400, 'ต้องเลือกบิลและสลิปอย่างน้อยฝั่งละ 1 รายการ'],
      invalid_status: [400, 'Invalid match status'],
      item_not_found: [404, 'ไม่พบเอกสารที่เลือก'],
      invalid_bill: [400, 'รายการฝั่งบิลมีเอกสารที่ไม่ใช่บิล'],
      invalid_slip: [400, 'รายการฝั่งสลิปมีเอกสารที่ไม่ใช่สลิป'],
      amount_missing: [400, 'บิลหรือสลิปที่เลือกยังไม่มียอดเงิน'],
      item_unavailable: [409, 'มีเอกสารที่ถูกลบหรือเป็นรูปซ้ำ'],
      amount_review_required: [409, 'มีรายการติดธงตรวจยอด ต้องเคลียร์ธงก่อนยืนยัน'],
      amount_mismatch: [409, 'ยอดรวมบิลและยอดรวมสลิปยังไม่ตรงกัน'],
      cash_payment_conflict: [409, 'มีบิลที่ชำระเงินสดแล้ว ต้องยกเลิกเงินสดก่อน'],
      document_already_used: [409, 'มีบิลหรือสลิปที่อยู่ในธุรกรรมอื่นแล้ว กรุณายืนยันจัดชุดใหม่ก่อน']
    };
    if (result?.error) {
      const [code, message] = errors[result.error] || [400, result.error];
      return res.status(code).json({ success: false, message, data: result });
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
      createdBy: adminActor(req)
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
  const status = error?.type === 'entity.too.large' || error?.status === 413 ? 413 : 500;
  res.status(status).json({
    success: false,
    message: status === 413 ? 'Request body is too large' : 'Internal server error'
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
const strayNeedsAmount = await clearNeedsAmountOnNonBills();
if (strayNeedsAmount) {
  console.warn(`[LINE CAPTURE] cleared needs_amount from ${strayNeedsAmount} non-bill item(s)`);
}
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
setInterval(() => {
  recoverPendingImageDownloads().catch((error) => {
    console.error('[LINE CAPTURE] scheduled image recovery failed:', error?.message || error);
  });
}, 60 * 1000).unref();
