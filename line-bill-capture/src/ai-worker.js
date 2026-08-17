import fs from 'fs/promises';
import path from 'path';
import { traceAnalysis, traceFailure } from './ai-trace.js';
import {
  applyAiAnalysis,
  getItemById,
  getAiQueueStats,
  listAiLearningExamples,
  listAiQueueItems,
  listItems,
  listMatches,
  listReimbursementCandidates,
  listNearbyConversation,
  listNearbyText,
  markBillsMissingAmount,
  markAiFailed,
  markAiProcessing,
  markSemanticDuplicateBills,
  resetAiPendingMatches,
  setReimbursementLink,
  setItemMatch,
  splitBatchPaymentSummary
} from './db.js';
import { runConfiguredGroupChecks } from './group-check.js';

const DEFAULT_MODEL = 'gpt-5.6-terra';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_SOURCE_FALLBACKS = {
  C987d13b96371f18f5a0996107d4f6ef5: ['C92c8a7b4a5099db619f6464e10eefab5']
};
const AI_WORKER_ACTOR = 'ai-worker';
const DEFAULT_USD_THB_RATE = 35;
const OPENAI_STANDARD_PRICING = {
  'gpt-5.6-luna': {
    inputUsdPerMillion: 1,
    cachedInputUsdPerMillion: 0.1,
    outputUsdPerMillion: 6
  },
  'gpt-5.6-terra': {
    inputUsdPerMillion: 2.5,
    cachedInputUsdPerMillion: 0.25,
    outputUsdPerMillion: 15
  }
};

const parseSourceFallbacks = (value) => {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([sourceId, fallbackIds]) => [
      String(sourceId),
      (Array.isArray(fallbackIds) ? fallbackIds : [fallbackIds]).map(String).filter(Boolean)
    ]));
  } catch {
    return {};
  }
};

const BILL_CAPTURE_ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    category: {
      type: 'string',
      enum: ['bill', 'transfer', 'transfer_notice', 'incoming_transfer', 'payment_voucher', 'other']
    },
    confidence: {
      type: 'number'
    },
    category_confidence: {
      type: 'number'
    },
    vendor_name: {
      type: ['string', 'null']
    },
    vendor_tax_id: {
      type: ['string', 'null']
    },
    supplier_name: {
      type: ['string', 'null']
    },
    bill_purpose: {
      type: ['string', 'null']
    },
    payment_role: {
      type: 'string',
      enum: ['ordinary_payment', 'advance_payment', 'reimbursement', 'unknown']
    },
    doc_ref: {
      type: ['string', 'null']
    },
    invoice_date: {
      type: ['string', 'null']
    },
    due_date: {
      type: ['string', 'null']
    },
    page_no: {
      type: ['number', 'null']
    },
    page_count: {
      type: ['number', 'null']
    },
    document_class: {
      type: 'string',
      enum: ['standard_bill', 'bill_summary_cover', 'bill_summary', 'batch_payment_summary', 'bill_continuation', 'transfer_slip', 'incoming_transfer', 'payment_voucher', 'other']
    },
    summary_period: {
      type: ['string', 'null']
    },
    summary_lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          doc_ref: { type: ['string', 'null'] },
          invoice_date: { type: ['string', 'null'] },
          due_date: { type: ['string', 'null'] },
          amount: { type: ['number', 'null'] }
        },
        required: ['doc_ref', 'invoice_date', 'due_date', 'amount'],
        additionalProperties: false
      }
    },
    payment_lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          supplier_name: { type: 'string' },
          payee_name: { type: ['string', 'null'] },
          bank_name: { type: ['string', 'null'] },
          account_no: { type: ['string', 'null'] },
          amount: { type: ['number', 'null'] },
          excluded: { type: 'boolean' },
          note: { type: ['string', 'null'] }
        },
        required: ['supplier_name', 'payee_name', 'bank_name', 'account_no', 'amount', 'excluded', 'note'],
        additionalProperties: false
      }
    },
    bill_total_text: {
      type: ['string', 'null']
    },
    bill_total_value: {
      type: ['number', 'null']
    },
    announced_amount: {
      type: ['number', 'null']
    },
    slip_amount_text: {
      type: ['string', 'null']
    },
    slip_amount_value: {
      type: ['number', 'null']
    },
    slip_amount_confidence: {
      type: ['number', 'null']
    },
    raw_text: {
      type: 'string'
    },
    summary: {
      type: 'string'
    },
    evidence: {
      type: 'array',
      items: {
        type: 'string'
      }
    },
    needs_review: {
      type: 'boolean'
    },
    amount_conflict: {
      type: 'boolean'
    }
  },
  required: [
    'category',
    'confidence',
    'category_confidence',
    'vendor_name',
    'vendor_tax_id',
    'supplier_name',
    'bill_purpose',
    'payment_role',
    'doc_ref',
    'invoice_date',
    'due_date',
    'page_no',
    'page_count',
    'document_class',
    'summary_period',
    'summary_lines',
    'payment_lines',
    'bill_total_text',
    'bill_total_value',
    'announced_amount',
    'slip_amount_text',
    'slip_amount_value',
    'slip_amount_confidence',
    'raw_text',
    'summary',
    'evidence',
    'needs_review',
    'amount_conflict'
  ],
  additionalProperties: false
};

const workerState = {
  enabled: false,
  running: false,
  provider: null,
  model: null,
  lastRunAt: null,
  lastResult: null,
  lastError: null
};

const toBool = (value, fallback = false) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const toNumber = (value, fallback, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const getAiConfig = () => {
  const explicitProvider = String(process.env.AI_PROVIDER || '').trim().toLowerCase();
  const provider = explicitProvider || (process.env.OPENAI_API_KEY ? 'openai' : '');
  const model = String(process.env.OPENAI_VISION_MODEL || DEFAULT_MODEL).trim();
  const enabledValue = String(process.env.AI_WORKER_ENABLED || 'auto').trim().toLowerCase();
  const configured = provider === 'mock' || (provider === 'openai' && Boolean(process.env.OPENAI_API_KEY));
  const enabled = enabledValue === 'auto' ? configured : toBool(enabledValue, false) && configured;

  return {
    enabled,
    configured,
    provider: provider || null,
    model,
    usdThbRate: toNumber(process.env.AI_COST_USD_THB_RATE, DEFAULT_USD_THB_RATE, 0.01, 1000),
    inputUsdPerMillion: toNumber(process.env.AI_INPUT_USD_PER_MILLION, Number.NaN, 0),
    cachedInputUsdPerMillion: toNumber(process.env.AI_CACHED_INPUT_USD_PER_MILLION, Number.NaN, 0),
    outputUsdPerMillion: toNumber(process.env.AI_OUTPUT_USD_PER_MILLION, Number.NaN, 0),
    openaiBaseUrl: String(process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, ''),
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    imageDetail: String(process.env.OPENAI_IMAGE_DETAIL || 'high').trim() || 'high',
    reasoningEffort: ['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(String(process.env.OPENAI_REASONING_EFFORT || '').trim().toLowerCase())
      ? String(process.env.OPENAI_REASONING_EFFORT).trim().toLowerCase()
      : 'medium',
    maxOutputTokens: toNumber(process.env.OPENAI_MAX_OUTPUT_TOKENS, 3000, 200, 8000),
    maxImageBytes: toNumber(process.env.AI_MAX_IMAGE_BYTES, 12 * 1024 * 1024, 1024, 25 * 1024 * 1024),
    intervalMs: toNumber(process.env.AI_WORKER_INTERVAL_MS, 15000, 1000, 10 * 60 * 1000),
    startDelayMs: toNumber(process.env.AI_WORKER_START_DELAY_MS, 2000, 0, 10 * 60 * 1000),
    batchSize: toNumber(process.env.AI_WORKER_BATCH_SIZE, 5, 1, 25),
    maxAttempts: toNumber(process.env.AI_WORKER_MAX_ATTEMPTS, 8, 1, 20),
    staleProcessingMs: toNumber(process.env.AI_WORKER_STALE_PROCESSING_MS, 10 * 60 * 1000, 30 * 1000, 24 * 60 * 60 * 1000),
    autoMatchEnabled: toBool(process.env.AI_AUTO_MATCH_ENABLED, true),
    autoMatchMinScore: toNumber(process.env.AI_AUTO_MATCH_MIN_SCORE, 90, 1, 99),
    // Candidate pairs are created only when there is enough evidence to be
    // useful. Strong pairs can still be auto-confirmed below.
    sequenceMatchMinScore: toNumber(process.env.AI_SEQUENCE_MATCH_MIN_SCORE, 50, 1, 99),
    amountTolerance: toNumber(process.env.AI_MATCH_AMOUNT_TOLERANCE, 5, 0, 1000000),
    percentTolerance: toNumber(process.env.AI_MATCH_PERCENT_TOLERANCE, 0.02, 0, 1),
    maxMatchHours: toNumber(process.env.AI_MATCH_MAX_HOURS, 48, 0.01, 24 * 30),
    requireSameSource: toBool(process.env.AI_MATCH_REQUIRE_SAME_SOURCE, true),
    sourceFallbacks: String(process.env.AI_MATCH_SOURCE_FALLBACKS || '').trim()
      ? parseSourceFallbacks(process.env.AI_MATCH_SOURCE_FALLBACKS)
      : DEFAULT_SOURCE_FALLBACKS,
    // Typed messages near a slip often carry the transfer amount the sender
    // wrote by hand; feed them to the vision model as extra context.
    textContextWindowMs: toNumber(process.env.AI_TEXT_CONTEXT_WINDOW_MS, 30 * 60 * 1000, 0, 6 * 60 * 60 * 1000),
    textContextLimit: toNumber(process.env.AI_TEXT_CONTEXT_LIMIT, 10, 0, 100),
    conversationContextWindowMs: toNumber(process.env.AI_CONVERSATION_CONTEXT_WINDOW_MS, 6 * 60 * 60 * 1000, 0, 24 * 60 * 60 * 1000),
    conversationContextLimit: toNumber(process.env.AI_CONVERSATION_CONTEXT_LIMIT, 15, 0, 120),
    analysisConcurrency: toNumber(process.env.AI_ANALYSIS_CONCURRENCY, 1, 1, 5)
  };
};

const estimateAiCost = (usage, config) => {
  const modelPricing = OPENAI_STANDARD_PRICING[String(config.model || '').toLowerCase()] || {};
  const inputRate = Number.isFinite(config.inputUsdPerMillion)
    ? config.inputUsdPerMillion
    : modelPricing.inputUsdPerMillion;
  const cachedRate = Number.isFinite(config.cachedInputUsdPerMillion)
    ? config.cachedInputUsdPerMillion
    : modelPricing.cachedInputUsdPerMillion;
  const outputRate = Number.isFinite(config.outputUsdPerMillion)
    ? config.outputUsdPerMillion
    : modelPricing.outputUsdPerMillion;
  if (![inputRate, cachedRate, outputRate].every(Number.isFinite)) return null;

  const inputTokens = Math.max(0, Number(usage?.input_tokens || 0));
  const cachedInputTokens = Math.min(inputTokens, Math.max(0, Number(usage?.cached_input_tokens || 0)));
  const uncachedInputTokens = inputTokens - cachedInputTokens;
  const outputTokens = Math.max(0, Number(usage?.output_tokens || 0));
  const inputUsd = (uncachedInputTokens / 1_000_000) * inputRate;
  const cachedInputUsd = (cachedInputTokens / 1_000_000) * cachedRate;
  // OpenAI output token counts already include reasoning tokens.
  const outputUsd = (outputTokens / 1_000_000) * outputRate;
  const totalUsd = inputUsd + cachedInputUsd + outputUsd;

  return {
    estimated: true,
    model: config.model,
    usd_thb_rate: config.usdThbRate,
    total_usd: totalUsd,
    total_thb: totalUsd * config.usdThbRate,
    input_usd: inputUsd,
    cached_input_usd: cachedInputUsd,
    output_usd: outputUsd,
    rates_usd_per_million: {
      input: inputRate,
      cached_input: cachedRate,
      output: outputRate
    }
  };
};

const mimeFromItem = (item) => {
  const contentType = String(item?.content_type || '').split(';')[0].trim().toLowerCase();
  if (contentType.startsWith('image/')) return contentType;
  const extension = String(item?.file_extension || path.extname(item?.storage_path || '') || '').toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.heic') return 'image/heic';
  return 'image/jpeg';
};

const parseMoney = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).replace(/,/g, '').trim();
  const match = text.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const amount = Number(match[0]);
  return Number.isFinite(amount) ? amount : null;
};

const toPageNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
};

const normalizeConfidence = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = parsed > 1 ? parsed / 100 : parsed;
  return Math.max(0, Math.min(1, normalized));
};

const normalizeCategory = (value) => {
  const category = String(value || '').trim().toLowerCase();
  if (category === 'slip') return 'transfer';
  if (['bill', 'transfer', 'transfer_notice', 'incoming_transfer', 'payment_voucher', 'other'].includes(category)) return category;
  return 'other';
};

const normalizeAnalysis = (analysis) => {
  const raw = analysis && typeof analysis === 'object' ? analysis : {};
  const category = normalizeCategory(raw.category || raw.document_type);
  const billTotalValue = parseMoney(raw.bill_total_value ?? raw.bill_total_text);
  const announcedAmount = parseMoney(raw.announced_amount);
  const slipAmountValue = parseMoney(raw.slip_amount_value ?? raw.slip_amount_text);
  const amountConflict = Boolean(raw.amount_conflict);

  return {
    amount_conflict: amountConflict,
    category,
    document_type: category,
    confidence: normalizeConfidence(raw.confidence) ?? 0,
    category_confidence: normalizeConfidence(raw.category_confidence ?? raw.document_type_confidence ?? raw.confidence) ?? 0,
    vendor_name: raw.vendor_name == null ? null : String(raw.vendor_name).trim() || null,
    vendor_tax_id: raw.vendor_tax_id == null
      ? null
      : (() => {
        const digits = String(raw.vendor_tax_id).replace(/\D/g, '');
        return digits.length === 13 ? digits : null;
      })(),
    supplier_name: raw.supplier_name == null ? null : String(raw.supplier_name).trim() || null,
    bill_purpose: raw.bill_purpose == null ? null : String(raw.bill_purpose).trim() || null,
    payment_role: ['ordinary_payment', 'advance_payment', 'reimbursement'].includes(String(raw.payment_role || '').trim())
      ? String(raw.payment_role).trim()
      : 'unknown',
    doc_ref: raw.doc_ref == null ? null : String(raw.doc_ref).replace(/\s+/g, '').trim() || null,
    invoice_date: raw.invoice_date == null ? null : String(raw.invoice_date).trim() || null,
    due_date: raw.due_date == null ? null : String(raw.due_date).trim() || null,
    page_no: toPageNumber(raw.page_no),
    page_count: toPageNumber(raw.page_count),
    document_class: ['standard_bill', 'bill_summary_cover', 'bill_summary', 'batch_payment_summary', 'bill_continuation', 'transfer_slip', 'incoming_transfer', 'payment_voucher', 'other'].includes(String(raw.document_class || '').trim())
      ? String(raw.document_class).trim()
      : (category === 'transfer' || category === 'transfer_notice' ? 'transfer_slip' : 'standard_bill'),
    summary_period: raw.summary_period == null ? null : String(raw.summary_period).trim() || null,
    summary_lines: Array.isArray(raw.summary_lines)
      ? raw.summary_lines.slice(0, 200).map((line) => ({
        doc_ref: line?.doc_ref == null ? null : String(line.doc_ref).replace(/\s+/g, '').trim() || null,
        invoice_date: line?.invoice_date == null ? null : String(line.invoice_date).trim() || null,
        due_date: line?.due_date == null ? null : String(line.due_date).trim() || null,
        amount: parseMoney(line?.amount)
      }))
      : [],
    payment_lines: Array.isArray(raw.payment_lines)
      ? raw.payment_lines.slice(0, 100).map((line) => ({
        supplier_name: String(line?.supplier_name || '').trim().slice(0, 300),
        payee_name: line?.payee_name == null ? null : String(line.payee_name).trim().slice(0, 300) || null,
        bank_name: line?.bank_name == null ? null : String(line.bank_name).trim().slice(0, 120) || null,
        account_no: line?.account_no == null ? null : String(line.account_no).trim().slice(0, 120) || null,
        amount: parseMoney(line?.amount),
        excluded: Boolean(line?.excluded),
        note: line?.note == null ? null : String(line.note).trim().slice(0, 1000) || null
      })).filter((line) => line.supplier_name)
      : [],
    bill_total_text: raw.bill_total_text == null ? (billTotalValue == null ? null : String(billTotalValue)) : String(raw.bill_total_text).trim() || null,
    bill_total_value: billTotalValue,
    announced_amount: announcedAmount,
    slip_amount_text: raw.slip_amount_text == null ? (slipAmountValue == null ? null : String(slipAmountValue)) : String(raw.slip_amount_text).trim() || null,
    slip_amount_value: slipAmountValue,
    slip_amount_confidence: normalizeConfidence(raw.slip_amount_confidence ?? raw.amount_confidence ?? raw.confidence),
    raw_text: raw.raw_text == null ? '' : String(raw.raw_text).slice(0, 20000),
    summary: raw.summary == null ? '' : String(raw.summary).slice(0, 1000),
    evidence: Array.isArray(raw.evidence) ? raw.evidence.slice(0, 20).map((entry) => String(entry).slice(0, 300)) : [],
    needs_review: Boolean(raw.needs_review) || amountConflict
  };
};

const parseThaiDate = (value) => {
  const match = String(value || '').match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += year >= 50 ? 1957 : 2000;
  if (year >= 2400) year -= 543;
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return {
    key: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    timestamp
  };
};

const uniqueContextMessages = (nearbyText = [], conversationContext = []) => {
  const seen = new Set();
  return [...(Array.isArray(nearbyText) ? nearbyText : []), ...(Array.isArray(conversationContext) ? conversationContext : [])]
    .filter((message) => String(message?.message_type || 'text') === 'text')
    .filter((message) => {
      const text = String(message?.text || '').replace(/\u00a0/g, ' ').trim();
      if (!text) return false;
      const key = `${Number(message?.event_timestamp_ms || 0)}:${text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export const selectNearestTypedContext = ({ messages = [], senderUserId = '', centerMs = 0, limit = 10 } = {}) => {
  const sender = String(senderUserId || '').trim();
  const center = Number(centerMs || 0);
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => !sender || !message?.sender_user_id || String(message.sender_user_id) === sender)
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const leftTime = Number(left.message?.event_timestamp_ms || 0);
      const rightTime = Number(right.message?.event_timestamp_ms || 0);
      const leftDistance = center > 0 && leftTime > 0 ? Math.abs(leftTime - center) : left.index;
      const rightDistance = center > 0 && rightTime > 0 ? Math.abs(rightTime - center) : right.index;
      return leftDistance - rightDistance || leftTime - rightTime || left.index - right.index;
    })
    .slice(0, Math.max(0, Number(limit || 0)))
    .map(({ message }) => message)
    .sort((left, right) => Number(left?.event_timestamp_ms || 0) - Number(right?.event_timestamp_ms || 0));
};

const explicitAnnouncementAmounts = (text) => {
  const value = String(text || '').replace(/\u00a0/g, ' ');
  const matches = [];
  const pattern = /(?:ยอด(?:รวม|บิล|โอน)?|จำนวน(?:เงิน)?|รวม|โอนยอด|จ่าย)\s*(?:คือ|เป็น|ทั้งหมด|สุทธิ|เพิ่ม|ให้|มา|:|：|=)?\s*(?:฿|บาท)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)/gi;
  for (const match of value.matchAll(pattern)) {
    const amount = parseMoney(match[1]);
    if (amount > 0 && amount < 100000000) matches.push(amount);
  }
  if (!matches.length) {
    const compact = value.match(/^\s*(?:ค่า[^\d\n]{1,80}|[\p{L}][^\d\n]{1,80})\s+([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:บาท|\.-)?\s*$/iu);
    const amount = parseMoney(compact?.[1]);
    if (amount > 0 && amount < 100000000) matches.push(amount);
  }
  return [...new Set(matches)];
};

export const isDailyMarketSheetVisual = (analysis = {}) => {
  const visualText = `${analysis?.raw_text || ''} ${analysis?.summary || ''} ${analysis?.bill_purpose || ''}`
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!visualText) return false;

  // Supplier documents can contain generic words such as "ตลาด" and "รายการสินค้า".
  // A daily market sheet must also expose its own title or cash-control structure.
  if (/makro|แม็คโคร|cp\s*axtra|ใบกำกับภาษี|tax\s*invoice|ใบส่งของ|bangchak|บางจาก|น้ำมันรถ/i.test(visualText)) {
    return false;
  }
  const hasMarketIdentity = /ตลาดสด|บิลตลาด|รายการซื้อของตลาด|ใบสรุป(?:ยอด)?(?:ซื้อของ)?ตลาด|สรุปยอดเงินตลาด|ยอดเงินตลาด/i.test(visualText)
    || /ตลาด\s*(?:วันที่|\d{1,2}\s*\/\s*\d{1,2})/i.test(visualText);
  const hasCashControl = /รับ\s*[0-9][0-9,.]*/i.test(visualText)
    && /จ่าย\s*[0-9][0-9,.]*/i.test(visualText)
    && /ทอน|ขาดเกิน|โอนเพิ่ม/i.test(visualText);
  const hasMarketTable = /รวม\s*\d+\s*รายการ/i.test(visualText)
    && /รายการสินค้า|ตาราง|สินค้า/i.test(visualText);
  return hasMarketIdentity && (hasCashControl || hasMarketTable);
};

export const selectBillAnnouncementContext = ({ analysis = {}, item = {}, messages = [] } = {}) => {
  if (normalizeCategory(analysis.category || analysis.document_type) !== 'bill') return null;
  if (isDailyMarketSheetVisual(analysis)) return null;
  const center = Number(item.event_timestamp_ms || 0);
  const sender = String(item.sender_canonical_user_id || item.sender_user_id || '');
  const billTotal = Number(analysis.bill_total_value || 0);
  const candidates = uniqueContextMessages(messages, [])
    .filter((message) => !sender || !message.sender_user_id || String(message.sender_user_id) === sender)
    .flatMap((message) => {
      const eventMs = Number(message.event_timestamp_ms || 0);
      const delta = eventMs - center;
      if (!center || !eventMs || delta > 5 * 60 * 1000 || delta < -2 * 60 * 1000) return [];
      return explicitAnnouncementAmounts(message.text).map((amount) => {
        const exact = billTotal > 0 && Math.abs(amount - billTotal) <= 1;
        const after = delta >= 0;
        const score = (exact ? 1000 : 0) + (after ? 200 : 0) - Math.abs(delta) / 1000;
        return { message, amount, delta, exact, after, score };
      });
    })
    .sort((left, right) => right.score - left.score);
  const selected = candidates[0];
  if (!selected) return null;
  // A differing amount is accepted only from the preferred post-image announcement.
  // This prevents an unrelated previous bill from creating a false review flag.
  if (!selected.exact && !selected.after) return null;
  const text = String(selected.message.text || '');
  const explainedDifference = /หัก|เหลือ|ยอดโอน|โอนเพิ่ม|ขาดเกิน|ส่วนลด/i.test(text);
  return {
    amount: selected.amount,
    messageId: Number(selected.message.id || 0) || null,
    method: selected.exact ? 'same_sender_exact_amount' : 'same_sender_post_image',
    confidence: selected.exact ? 0.99 : 0.82,
    reason: `ข้อความ${selected.after ? 'หลัง' : 'ก่อน'}รูป ${Math.round(Math.abs(selected.delta) / 1000)} วินาที${selected.exact ? ' และยอดตรงกับเอกสาร' : ''}`,
    explainedDifference
  };
};

export const marketAnnouncementFromText = (nearbyText = [], { analysis = {}, item = {}, conversationContext = [] } = {}) => {
  const visualText = `${analysis?.invoice_date || ''} ${analysis?.raw_text || ''} ${analysis?.summary || ''}`;
  const documentDate = parseThaiDate(visualText);
  const itemTime = Number(item?.event_timestamp_ms || 0);
  const candidates = uniqueContextMessages(nearbyText, conversationContext)
    .map((message, index) => {
      const text = String(message?.text || '').replace(/\u00a0/g, ' ').trim();
      const date = text.match(/ตลาด\s*(\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{2,4})/i)?.[1]?.replace(/\s+/g, '') || '';
      const billTotal = parseMoney(text.match(/จ่าย\s*([0-9][0-9,]*(?:\.\d+)?)/)?.[1]);
      const transferTotal = parseMoney(text.match(/โอนเพิ่ม\s*([0-9][0-9,]*(?:\.\d+)?)/)?.[1]);
      if (!date || !(billTotal > 0) || !(transferTotal > 0)) return null;
      const parsedDate = parseThaiDate(date);
      const eventTime = Number(message?.event_timestamp_ms || 0);
      return {
        text,
        date,
        dateKey: parsedDate?.key || '',
        dateDistance: documentDate && parsedDate
          ? Math.abs(parsedDate.timestamp - documentDate.timestamp)
          : Number.POSITIVE_INFINITY,
        timeDistance: itemTime > 0 && eventTime > 0 ? Math.abs(eventTime - itemTime) : index,
        billTotal,
        transferTotal
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftExactDate = Boolean(documentDate && left.dateKey === documentDate.key);
      const rightExactDate = Boolean(documentDate && right.dateKey === documentDate.key);
      if (leftExactDate !== rightExactDate) return leftExactDate ? -1 : 1;
      if (left.dateDistance !== right.dateDistance) return left.dateDistance - right.dateDistance;
      return left.timeDistance - right.timeDistance;
    });
  return candidates[0] || null;
};

const marketAccountReimbursementFromContext = (analysis, nearbyText = [], { item = {}, conversationContext = [] } = {}) => {
  if (!['transfer', 'transfer_notice'].includes(normalizeCategory(analysis?.category || analysis?.document_type))) return null;
  const visualText = `${analysis?.raw_text || ''} ${analysis?.summary || ''}`;
  const companyOutbound = /(?:จาก|FROM)\s*(?:บจก\.?|บริษัท)?\s*โซลาว/i.test(visualText);
  const marketAccount = /(?:ไปยัง|ถึง|TO)[\s\S]{0,180}(?:7193|ศิริลักษณ์|ศิริลัก|เวียงแสง)/i.test(visualText);
  const amount = Number(analysis?.slip_amount_value || parseMoney(visualText.match(/จำนวน(?:เงิน)?\s*([0-9][0-9,]*(?:\.\d+)?)/i)?.[1]) || 0);
  const itemTime = Number(item?.event_timestamp_ms || 0);
  if (!companyOutbound || !marketAccount || !(amount > 0) || !itemTime) return null;

  const candidates = uniqueContextMessages(nearbyText, conversationContext)
    .map((message) => {
      const text = String(message?.text || '').replace(/\u00a0/g, ' ').trim();
      const eventTime = Number(message?.event_timestamp_ms || 0);
      const minutesBefore = (itemTime - eventTime) / 60000;
      const amounts = explicitAnnouncementAmounts(text);
      const exactAmount = amounts.some((value) => Math.abs(value - amount) <= 1);
      const dailyMarketFunding = /ตลาด\s*\d{1,2}\s*\/\s*\d{1,2}/i.test(text) && /โอนเพิ่ม/i.test(text);
      if (!/ตลาด/i.test(text) || dailyMarketFunding || !exactAmount || minutesBefore < 0 || minutesBefore > 180) return null;
      const purpose = text
        .replace(/@\S+/g, ' ')
        .replace(/(?:ยอด|จำนวน(?:เงิน)?)\s*[0-9][0-9,]*(?:\.\d+)?\s*(?:บาท|\.-)?/gi, ' ')
        .replace(/นะคะ|ครับ|ค่ะ/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return { text, purpose: purpose || 'ค่าใช้จ่ายที่บัญชีตลาดสำรองจ่าย', amount, minutesBefore };
    })
    .filter(Boolean)
    .sort((left, right) => left.minutesBefore - right.minutesBefore);
  return candidates[0] || null;
};

const detectKnownMarketplace = (text) => {
  const value = String(text || '');
  if (/Shopee|ช้อปปี้/i.test(value)) return 'Shopee';
  if (/Lazada|ลาซาด้า/i.test(value)) return 'Lazada';
  if (/รายละเอียดคำสั่งซื้อ/i.test(value) && /ร้านแนะนำ/i.test(value) && /ชำระเงินภายใน/i.test(value)) return 'Shopee';
  return '';
};

const detectMarketplace = (text) => detectKnownMarketplace(text) || 'คำสั่งซื้อออนไลน์';

export const applyDeterministicChatRules = (analysis, nearbyText = [], context = {}) => {
  const market = marketAnnouncementFromText(nearbyText, { ...context, analysis });
  const visualText = `${analysis?.raw_text || ''} ${analysis?.summary || ''}`;
  let corrected = analysis;

  if (market && isDailyMarketSheetVisual(analysis)) {
    corrected = {
      ...corrected,
      category: 'bill',
      document_type: 'bill',
      document_class: 'standard_bill',
      bill_purpose: `บิลตลาด ${market.date}`.trim(),
      bill_total_text: market.billTotal.toFixed(2),
      bill_total_value: market.billTotal,
      announced_amount: market.transferTotal,
      amount_conflict: false,
      needs_review: false,
      confidence: Math.max(Number(corrected.confidence || 0), 0.95),
      category_confidence: Math.max(Number(corrected.category_confidence || 0), 0.98),
      summary: `บิลตลาด ${market.date} ยอดซื้อ ${market.billTotal.toLocaleString('en-US')} บาท ยอดโอนหลังปรับยอด ${market.transferTotal.toLocaleString('en-US')} บาท`,
      evidence: [
        ...(Array.isArray(corrected.evidence) ? corrected.evidence : []),
        `ข้อความแจ้งตลาด: จ่าย ${market.billTotal} บาท`,
        `ข้อความแจ้งตลาด: โอนเพิ่ม ${market.transferTotal} บาท`
      ].slice(0, 20)
    };
  }

  const marketReimbursement = marketAccountReimbursementFromContext(corrected, nearbyText, context);
  if (marketReimbursement) {
    corrected = {
      ...corrected,
      category: 'transfer',
      document_type: 'transfer',
      document_class: 'transfer_slip',
      payment_role: 'reimbursement',
      bill_purpose: `คืนเงินบัญชีตลาด - ${marketReimbursement.purpose}`,
      summary: `บจก. โซลาวคืนเงินเข้าบัญชีตลาด ${marketReimbursement.amount.toLocaleString('en-US')} บาท สำหรับ${marketReimbursement.purpose}ที่บัญชีตลาดสำรองจ่าย`,
      evidence: [
        ...(Array.isArray(corrected.evidence) ? corrected.evidence : []),
        `ข้อความก่อนสลิป: ${marketReimbursement.text}`,
        'ปลายทางเป็นบัญชีค่าใช้จ่ายตลาดเลขท้าย 7193'
      ].slice(0, 20)
    };
  }

  const correctedVisualText = `${corrected?.raw_text || ''} ${corrected?.summary || ''}`;
  const isOnlineOrder = /รายละเอียดคำสั่งซื้อ/i.test(correctedVisualText)
    && /รวมคำสั่งซื้อ|ยอดชำระเงิน/i.test(correctedVisualText)
    && /หมายเลขคำสั่งซื้อ|ชำระเงินภายใน|ร้านแนะนำ/i.test(correctedVisualText);
  const onlineOrderAmount = isOnlineOrder
    ? parseMoney(correctedVisualText.match(/(?:รวมคำสั่งซื้อ|ยอดชำระเงิน)\s*[:：]?\s*(?:฿|บาท)?\s*([0-9][0-9,]*(?:\.\d+)?)/i)?.[1])
    : null;
  if (isOnlineOrder && onlineOrderAmount > 0) {
    const vendor = String(corrected.vendor_name || '').trim();
    const marketplace = detectMarketplace(correctedVisualText);
    const existingPurpose = String(corrected.bill_purpose || '').trim();
    const purposeDetail = existingPurpose && !/^(?:Shopee|ช้อปปี้|Lazada|ลาซาด้า|คำสั่งซื้อออนไลน์)/i.test(existingPurpose)
      ? existingPurpose
      : vendor;
    corrected = {
      ...corrected,
      category: 'bill',
      document_type: 'bill',
      document_class: 'standard_bill',
      bill_purpose: `${marketplace}${purposeDetail ? ` - ${purposeDetail}` : ''}`,
      bill_total_text: onlineOrderAmount.toFixed(2),
      bill_total_value: onlineOrderAmount,
      amount_conflict: false,
      needs_review: false,
      confidence: Math.max(Number(corrected.confidence || 0), 0.95),
      category_confidence: Math.max(Number(corrected.category_confidence || 0), 0.98),
      summary: `บิลคำสั่งซื้อ ${marketplace}${vendor ? ` ร้าน ${vendor}` : ''} ยอด ${onlineOrderAmount.toLocaleString('en-US')} บาท`,
      evidence: [
        ...(Array.isArray(corrected.evidence) ? corrected.evidence : []),
        'หน้ารายละเอียดคำสั่งซื้อมีร้าน สินค้า เลขคำสั่งซื้อ และยอดชำระ',
        `ยอดคำสั่งซื้อ ${onlineOrderAmount} บาท`
      ].slice(0, 20)
    };
  }

  if (/ใบสำคัญจ่าย|PAYMENT\s+VOUCHER/i.test(correctedVisualText)) {
    corrected = {
      ...corrected,
      category: 'payment_voucher',
      document_type: 'payment_voucher',
      document_class: 'payment_voucher',
      amount_conflict: false,
      needs_review: false,
      confidence: Math.max(Number(corrected.confidence || 0), 0.95),
      category_confidence: Math.max(Number(corrected.category_confidence || 0), 0.99),
      summary: String(corrected.summary || '').trim() || 'ใบสำคัญจ่าย เป็นเอกสารประกอบธุรกรรมที่เกี่ยวข้อง'
    };
  }

  const transferDestination = correctedVisualText.split(/ไปยัง/i)[1] || '';
  const transferOrigin = correctedVisualText.split(/ไปยัง/i)[0] || '';
  if (/โอนเงินสำเร็จ|ชำระเงินสำเร็จ/i.test(correctedVisualText)
    && /ศิริลักษณ์/i.test(transferDestination)
    && /9078/.test(transferDestination)
    && !/บจก\.?\s*โซลาว/i.test(transferOrigin)) {
    corrected = {
      ...corrected,
      category: 'incoming_transfer',
      document_type: 'incoming_transfer',
      document_class: 'incoming_transfer',
      payment_role: 'unknown',
      amount_conflict: false,
      needs_review: false,
      category_confidence: Math.max(Number(corrected.category_confidence || 0), 0.98),
      summary: String(corrected.summary || '').trim() || 'หลักฐานเงินโอนเข้าบัญชีตลาดสด'
    };
  }

  return corrected;
};

export const preserveKnownTransferFromMarketContext = (analysis, item = {}) => {
  const wasTransfer = ['transfer', 'transfer_notice'].includes(String(item.category || ''))
    && Number(item.slip_amount_value || 0) > 0;
  const becameMarketBill = normalizeCategory(analysis.category || analysis.document_type) === 'bill'
    && /บิลตลาด|ตลาดสด|รายการสินค้า|ยอดเงินตลาด|สรุปยอดเงิน/i.test(
      `${analysis.bill_purpose || ''} ${analysis.raw_text || ''} ${analysis.summary || ''}`
    );
  if (!wasTransfer || !becameMarketBill) return analysis;
  return {
    ...analysis,
    category: item.category,
    document_type: item.category,
    document_class: 'transfer_slip',
    bill_total_text: null,
    bill_total_value: null,
    announced_amount: null,
    slip_amount_text: item.slip_amount_text || Number(item.slip_amount_value).toFixed(2),
    slip_amount_value: Number(item.slip_amount_value),
    amount_conflict: false,
    needs_review: true,
    summary: item.ai_summary || analysis.summary,
    evidence: [
      ...(Array.isArray(analysis.evidence) ? analysis.evidence : []),
      'คงประเภทสลิปเดิมไว้ เพราะผลอ่านใหม่ถูกข้อความสรุปตลาดใกล้เคียงครอบภาพ'
    ].slice(0, 20)
  };
};

const extractResponseText = (json) => {
  if (typeof json?.output_text === 'string') return json.output_text;
  const chunks = [];
  for (const output of json?.output || []) {
    for (const content of output?.content || []) {
      if (typeof content?.text === 'string') chunks.push(content.text);
      if (typeof content?.content === 'string') chunks.push(content.content);
    }
  }
  return chunks.join('\n').trim();
};

const parseJsonObject = (text) => {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('AI response has no text');
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error('AI response is not valid JSON');
  }
};

const renderTypedContext = (item, nearbyText = []) => {
  if (!Array.isArray(nearbyText) || !nearbyText.length) {
    return 'No typed chat messages were captured near this image.';
  }
  const center = Number(item.event_timestamp_ms || 0);
  return nearbyText
    .map((message) => {
      const ms = Number(message.event_timestamp_ms || 0);
      const relMin = center && ms ? Math.round((ms - center) / 60000) : null;
      const when = relMin === null
        ? ''
        : relMin === 0
          ? ' (about the same time as the image)'
          : relMin > 0
            ? ` (${relMin} min after the image)`
            : ` (${Math.abs(relMin)} min before the image)`;
      return `- "${String(message.text || '').replace(/\s+/g, ' ').trim().slice(0, 200)}"${when}`;
    })
    .join('\n');
};

const renderLearningExamples = (examples = []) => {
  if (!Array.isArray(examples) || !examples.length) return 'No owner-approved examples yet.';
  return examples.map((row) => {
    let example = {};
    try { example = JSON.parse(row.example_json || '{}'); } catch { example = {}; }
    const bill = example.bill || {};
    const slip = example.slip || {};
    return `- ${row.outcome === 'confirmed' ? 'CORRECT PAIR' : 'WRONG PAIR'}: ${String(row.review_note || '').replace(/\s+/g, ' ').slice(0, 300)} | bill=${bill.vendor_name || bill.bill_purpose || '-'} ${bill.amount ?? '-'} | slip=${slip.amount ?? '-'}`;
  }).join('\n');
};

const renderConversationContext = (item, messages = []) => {
  if (!Array.isArray(messages) || !messages.length) return 'No group conversation was captured near this image.';
  const center = Number(item.event_timestamp_ms || 0);
  return messages.map((message) => {
    const ms = Number(message.event_timestamp_ms || 0);
    const relMin = center && ms ? Math.round((ms - center) / 60000) : 0;
    const relative = relMin === 0 ? 'same time' : relMin > 0 ? `${relMin}m after` : `${Math.abs(relMin)}m before`;
    const sender = String(message.sender_display_name || message.sender_user_id || 'unknown').replace(/\s+/g, ' ').slice(0, 80);
    if (message.message_type === 'text') {
      return `- [${relative}] ${sender}: "${String(message.text || '').replace(/\s+/g, ' ').trim().slice(0, 300)}"`;
    }
    if (Number(message.capture_item_id || 0) === Number(item.id)) return `- [${relative}] ${sender}: [CURRENT IMAGE]`;
    const amount = message.capture_bill_total ?? message.capture_slip_amount;
    const summary = String(message.capture_ai_summary || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    const known = message.capture_ai_status === 'done'
      ? `${message.capture_category || 'image'}${amount == null ? '' : ` amount=${amount}`}${summary ? `; ${summary}` : ''}`
      : 'image not analyzed yet';
    return `- [${relative}] ${sender}: [IMAGE #${message.capture_item_id || '?'}: ${known}]`;
  }).join('\n');
};

const buildVisionPrompt = (item, nearbyText = [], learningExamples = [], conversationContext = []) => `
You are reading Thai LINE OA images for a bill/slip matching back office.

Return only a compact JSON object. Do not wrap it in markdown.

Classify the image:
- "bill": vendor bill, invoice, receipt, order total, shop bill, market order bill.
- "transfer": bank transfer slip or payment confirmation screenshot with a transferred amount.
- "transfer_notice": text/image notice saying transfer was made, but not a bank slip.
- "other": anything else.

Strict slip rule: a transfer is evidence that THIS business paid a supplier. A photograph of a phone
showing a merchant/POS/cashier app, a sales dashboard, QR receiving screen, or a list of customers
who paid is NOT a transfer slip, even when it contains words such as "จ่ายแล้ว", "QR", or an amount.
Classify those images as "other" and set slip_amount_value to null. Example: a photo of a K SHOP
screen showing a customer's QR payment is a merchant sales record, not a bank transfer proof.

Payment instructions are also "other", not "transfer_notice": an image that only supplies a bank
account number, PromptPay number, payee name, or asks the recipient to send a slip AFTER payment
is a request to pay, not evidence that any payment happened. Do not use its nearby chat amount as a
slip amount. "transfer_notice" is reserved for a message that explicitly confirms a transfer was made.

An e-commerce checkout or order-detail screen from Lazada, Shopee, or another marketplace is a
"bill" when it shows a seller/shop, purchased item, order number, and final amount due. It remains a
bill even when payment is still pending, a countdown or "ชำระเงิน" button is visible, or the chosen
payment method is QR/PromptPay. Extract the final "รวมคำสั่งซื้อ" / "ยอดชำระเงิน" as bill_total_value
and the order number as doc_ref. A separate screen containing only a QR code or account/payment
instructions remains "other"; the later bank/payment-service success receipt is the transfer slip.
Shopee order screens commonly use a strong orange checkout header/button and contain Thai labels
such as "รายละเอียดคำสั่งซื้อ", "ร้านแนะนำ", "รวมคำสั่งซื้อ", and "ชำระเงิน". Treat those combined
signals as a Shopee bill; never infer the platform from orange color alone. Keep the actual seller in
vendor_name and set bill_purpose to "Shopee - <typed purpose or purchased item>" so it can match a
bank bill-payment receipt whose payee is "ชำระสินค้า Shopee" / Biller ID 010753600031501.

Daily cashier settlement, cash handover, sales reconciliation, or daily money-remittance summary
forms are "other". They can contain handwritten totals, QR/card/GRAB collections, and even a bank
receipt attached in the same photo, but they are operational closeout documents rather than one
supplier-payment slip. Do not match them to a supplier bill or use their aggregate total as a slip.

A screenshot or photograph of a chat conversation is "other", even when a chat bubble says that
money was received, paid, or transferred. It is discussion context, not a bank-issued payment
receipt. Do not treat numbers or account details quoted in chat bubbles as slip evidence.

An incoming-credit alert is category="incoming_transfer", not a supplier-payment slip. If it says "เงินเข้า", "เงินโอนเข้า",
"received", has a plus sign, or records money arriving into this business's account, it proves that
the business received money rather than paid a supplier. It must never be matched to a purchase bill.
Apply the same direction check to an e-Slip: use category="incoming_transfer" when a customer or another
third party is the sender and this business or a business-controlled account is the recipient. Extract the
received amount into slip_amount_text and slip_amount_value, and set document_class="incoming_transfer".
For this back office, an e-Slip reading "ถึง บริษัท
โซลาว" / "to Solao" is customer money received, not a supplier payment, regardless of its amount.
บจก. โซลาว / บริษัท โซลาว / Solao is THIS company. Always read its position on the slip before
classifying: when Solao appears under "จาก" / "from", the company is sending money out; when Solao
appears under "ไปยัง" / "ถึง" / "to", the company is receiving money and the image is not a
supplier-payment slip.
The account held by น.ส. ศิริลักษณ์ เวียงแสง (also OCRed as ศิริลัก) with account-number ending
7193 is the designated ตลาดสด expense account. A completed transfer from บจก. โซลาว to this
account is business funding for market expenses: classify it as "transfer" and keep it eligible for
bill matching. It is NOT customer revenue or an unrelated incoming-credit alert. Still require the
slip to show a completed transfer; an account-detail or payment-instruction image alone is "other".
Payment for a daily market sheet ("บิลตลาด") is normally sent to this 7193 account, so when such a
slip appears near an unmatched market sheet, prefer that pairing over a merely similar amount. The
account also receives other kinds of transfers, so never assume a 7193 slip is a market payment on
the account alone: the adjusted daily transfer amount must still agree.

Advance-payment and reimbursement rule:
- payment_role="advance_payment" when a person/employee pays a merchant, supplier, or biller first
  for a business expense and the chat says or clearly implies สำรองจ่าย, จ่ายแทน, ออกให้ก่อน, or
  identifies the business purpose. This remains category="transfer"; it is proof of the original
  expense payment, not a vendor bill.
- payment_role="reimbursement" when บจก. โซลาว transfers the same expense amount back to that person
  and chat says คืนเงินสำรอง, คืนค่าสินค้า, เบิกคืน, or otherwise explicitly identifies repayment.
- payment_role="ordinary_payment" for normal company-to-supplier payments. Use "unknown" when the
  role cannot be established.
- An advance-payment slip and its reimbursement slip form one reimbursement chain, not a bill-slip
  pair. Match that chain using exact amount, same expense purpose, conversation order, sender/payee
  identity, and time. Never attach either image to an unrelated bill merely because its amount is near.

Supplier formats vary. Do not require a fixed layout or fixed Thai labels: a bill may be a printed
receipt, invoice, delivery note, handwritten form, cash sale, or another supplier-specific format.
Read the final payable amount using the labels and structure that are actually visible in that image.

Extract:
- vendor_name: shop/vendor name printed on a bill, otherwise null.
- vendor_tax_id: the vendor's 13-digit Thai tax ID printed on the bill, digits only. Read it carefully
  from the label "เลขประจำตัวผู้เสียภาษี" or "Tax ID". Return null if it is not visible; never guess.
- supplier_name: the supplier name explicitly identified on the summary cover. For a summary cover,
  copy the value from the cover's explicit ชื่อ / Name supplier field exactly as printed. Do not
  substitute the company header, tax ID holder, customer/address, or a guessed name from detail bills.
  For a normal detail bill, return null unless the supplier is unambiguous.
- bill_purpose: what the expense is FOR, as announced in typed chat or proven by a named biller
  (e.g. "ค่าเนื้อ", "ค่าผัก", "ค่าน้ำประปา"). For a completed payment to การประปาส่วนภูมิภาค,
  return "ค่าน้ำประปา" even though the image is a transfer slip. Null when the purpose is unclear.
- payment_role: use the advance-payment/reimbursement rule above. For non-transfer images return
  "unknown". Do not infer reimbursement from amount alone.
- doc_ref: the document number used to identify and pay this expense. For a bill, use the tax invoice
  number ("เลขที่ใบกำกับภาษี" / "Tax Invoice No."), e.g. "006871045473". For a CP AXTRA/SMARTONE
  payment slip, use "เลขที่อ้างอิง" (the bill's Ref 2), not the bank transaction number. It must
  match the Makro bill's tax-invoice/reference number exactly. Null when no document reference exists.
- page_no / page_count: from a page marker like "หน้าที่ 2 จาก 3" (page 2 of 3) -> page_no=2, page_count=3.
  Null when the document is a single page with no page marker.
- invoice_date / due_date: the invoice or document date and due date when printed. Return the printed
  date text in a compact form, otherwise null.
- document_class: use "bill_summary_cover" for a ใบรับวางบิล / Bill Acceptance / ใบปะหน้าสรุป
  that lists multiple bills and their amounts. Use "bill_summary" for a separate supplier summary
  or cash-sale summary that aggregates several detail bills and must not be counted as one detail bill.
  Use "batch_payment_summary" for a payment-run sheet that lists several suppliers/payees,
  bank accounts, and separate amounts to transfer. Its grand total is a reconciliation control,
  not one bill owed to one vendor. Use "standard_bill" for a normal single bill,
  "bill_continuation" for a continuation page, "transfer_slip" for an outgoing bank slip,
  "incoming_transfer" for money received by this business, and "other" otherwise.
  A ใบสำคัญจ่าย / PAYMENT VOUCHER is always relevant supporting evidence: use
  category="payment_voucher" and document_class="payment_voucher", never "other".
- summary_period: the covered period printed on a summary cover, otherwise null.
- summary_lines: for a summary cover, extract EVERY bill row from its table, including repeated amounts.
  Each row must include its amount when readable, plus document/date/due-date when present. For every
  non-cover image return an empty array. Do not use the cover grand total as a line amount.
- payment_lines: only for document_class="batch_payment_summary", extract EVERY supplier/payment row.
  Return supplier_name, payee_name, bank_name, account_no, and amount. Set excluded=true when a
  handwritten note such as "จัดรวม", "จัดส่งรวม", "รอบหน้า", or an absent amount clearly means the
  row is not part of the printed grand total; preserve the note. For all other images return [].
- bill_total_text and bill_total_value: final payable/grand total of a bill. Do not use unit prices or subtotals if a final total exists.
- announced_amount: the amount explicitly typed in nearby chat for this bill. Return null when no clear bill announcement amount is present. Store it separately even when it matches the image total.
- slip_amount_text and slip_amount_value: transferred amount on a slip/transfer notice.
- confidence, category_confidence, slip_amount_confidence: numbers from 0 to 1 based on visual certainty.
- raw_text: important OCR text visible in the image, especially Thai text, totals, dates, account names, reference ids.
- summary: one short Thai sentence.
- evidence: short snippets supporting the classification and amount.
- needs_review: true if any core field is uncertain.
- amount_conflict: see the typed-messages rule below.

Typed chat messages the same sender wrote near this image:
${renderTypedContext(item, nearbyText)}

Owner-approved review examples from this back office:
${renderLearningExamples(learningExamples)}
Use these examples only as operational hints. Visible evidence in the current image remains authoritative.

Ordered conversation timeline from the same LINE group (all senders):
${renderConversationContext(item, conversationContext)}
Use speaker identity, order, and explicit references to understand what the current image is about.
Do not assume two nearby images are a pair merely because they are adjacent. A pairing still needs
support from amount, payee/vendor identity, document reference, or an explicit chat statement.

Multi-page bills (common with Makro/wholesaler invoices):
- One invoice is often photographed as several pages. Only the LAST page carries the final payable
  grand total ("ยอดสุทธิ" / "รวมเงิน" / "ยอดชำระ"); the earlier pages only list items and say
  "มีต่อหน้า N" (continued on page N) at the bottom.
- On a page WITHOUT the final payable total, bill_total_value MUST be null. Never promote a line
  item, a subtotal, or a discount figure to bill_total_value just to fill it in.
- Still return doc_ref and page_no/page_count on every page, so the pages can be grouped later.

Summary-cover rules:
- A ใบรับวางบิล or Bill Acceptance is a cover, not one of the detail bills. Set document_class to
  "bill_summary_cover" and read each table row into summary_lines. The back office will compare this
  list as a multiset against the detail bill amounts, so never collapse duplicate amounts.
- The cover's grand total belongs in bill_total_value, but it must not also appear in summary_lines.
- A separate cash-sale or supplier summary may appear after the detail bills. Classify it as
  "bill_summary" when it aggregates a period or several documents; it is evidence for review, not
  another detail row to count against the cover.
- A supplier payment-run sheet (for example "สรุปยอดชำระ supplier") is different from a bill
  summary cover. Set document_class="batch_payment_summary", put each supplier in payment_lines,
  and keep the printed grand total in bill_total_value. Never treat the grand total as one vendor bill.

Rules for using the typed messages (they matter mainly for BILLS):
- When someone posts a bill, they usually TYPE what it is for and its amount, e.g. "ค่าเนื้อ 3,276", "ค่าผัก 1,174 โอนด้วย".
- For a bill: set bill_purpose from the typed description of what the charge is for.
- When several images and announcements are interleaved, associate each announcement with the
  immediately preceding order/bill image when its product description or amount agrees. Do not
  attach the previous order's announcement to the next image merely because it is also nearby.
- A daily market sheet headed "ตลาดสด" with an explicit document date and a table of purchased
  items is a bill, not a cashier settlement form. Set bill_purpose to "บิลตลาด <document date>".
  The literal prefix "บิลตลาด" is required — do not shorten it to "ตลาด" or write only the date,
  because downstream matching keys on that prefix to apply the shortage/excess adjustment.
  Its companion chat commonly contains รับ, จ่าย, ทอน, เงินในบัญชีขาดเกิน, and โอนเพิ่ม. For this
  format only: "จ่าย" is bill_total_value. The expected transfer for that day is จ่าย adjusted by
  เงินในบัญชีขาดเกิน: subtract a positive excess and add a shortage. Store that daily expected
  transfer as announced_amount. รับ, ทอน, and account balance are reconciliation context, not
  candidate bill totals. "โอนเพิ่ม" can be the combined transfer for several consecutive market
  sheets; when it equals the sum of their adjusted daily transfers, allocate each daily amount to
  its own bill instead of assigning the combined amount to the latest bill. Example: day 8 has
  จ่าย 13,985 and excess +1 -> 13,984; day 9 has จ่าย 15,142 and excess +29 -> 15,113; the typed
  combined transfer 29,097 is 13,984 + 15,113. This explained difference is not an amount conflict.
  A multi-page market sheet may still be a complete bill for matching when the companion message
  supplies จ่าย and the reconciliation values; do not leave it as bill_page/ขาดหน้ายอด solely
  because the photographed sheet says page 1/2.
- For a bill amount: if the bill image has no readable total, use the amount typed in the chat as bill_total. If the image DOES show a total and a typed amount is also present and they differ by more than rounding, set amount_conflict=true (keep the image total as bill_total_value) and list both numbers in evidence.
- Always return announced_amount when a nearby typed message clearly gives the bill amount, whether or not it matches the image.
- Slips (transfer proofs) rarely have typed text. Read slip_amount from the slip image itself. Do NOT infer a slip amount from unrelated chat numbers, and keep amount_conflict=false for slips unless the image itself is ambiguous.
- Ignore typed numbers that are clearly not amounts (phone numbers, times, reference ids, dates).

Use null when a field is not available. Do not guess.

Context:
item_id=${item.id}
line_message_id=${item.line_message_id}
source=${item.source_type}:${item.source_id}
`;

const analyzeWithOpenAi = async ({ item, config, nearbyText = [], learningExamples = [], conversationContext = [] }) => {
  if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY is not configured');
  const image = await fs.readFile(item.storage_path);
  if (image.length > config.maxImageBytes) {
    throw new Error(`Image is too large for AI worker: ${image.length} bytes`);
  }

  const body = {
    model: config.model,
    reasoning: { effort: config.reasoningEffort },
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: buildVisionPrompt(item, nearbyText, learningExamples, conversationContext) },
          {
            type: 'input_image',
            image_url: `data:${mimeFromItem(item)};base64,${image.toString('base64')}`,
            detail: config.imageDetail
          }
        ]
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'line_bill_capture_analysis',
        schema: BILL_CAPTURE_ANALYSIS_SCHEMA,
        strict: true
      }
    },
    max_output_tokens: config.maxOutputTokens
  };

  const response = await fetch(`${config.openaiBaseUrl}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!response.ok) {
    const message = json?.error?.message || text.slice(0, 500) || `HTTP ${response.status}`;
    throw new Error(`OpenAI vision request failed: ${message}`);
  }

  const analysis = normalizeAnalysis(parseJsonObject(extractResponseText(json)));
  const usage = json?.usage || {};
  analysis._usage = {
    input_tokens: Number(usage.input_tokens || 0),
    cached_input_tokens: Number(usage.input_tokens_details?.cached_tokens || 0),
    output_tokens: Number(usage.output_tokens || 0),
    reasoning_tokens: Number(usage.output_tokens_details?.reasoning_tokens || 0),
    total_tokens: Number(usage.total_tokens || 0)
  };
  return analysis;
};

// Pull an amount and a "what it is for" label from typed chat text, the way a
// bill announcement reads (e.g. "ค่าเนื้อ 3,276").
const mockTypedFromText = (nearbyText = []) => {
  const texts = (Array.isArray(nearbyText) ? nearbyText : []).map((message) => String(message.text || ''));
  const withNumber = texts.find((text) => parseMoney(text) != null);
  const amount = withNumber ? parseMoney(withNumber) : null;
  const purposeSource = texts.find((text) => /ค่า\S/.test(text)) || withNumber || '';
  const purpose = purposeSource
    .replace(/[0-9,.]+/g, '')
    .replace(/บาท|โอน|แล้ว|ครับ|ค่ะ|ด้วย|นะ|จ่าย|\.-/g, '')
    .trim() || null;
  return { amount, purpose };
};

const analyzeWithMock = async ({ item, nearbyText = [] }) => {
  const key = `${item.line_message_id || ''} ${item.storage_relative_path || ''} ${item.storage_path || ''}`.toLowerCase();
  if (key.includes('advance-payment')) {
    return normalizeAnalysis({
      category: 'transfer',
      payment_role: 'advance_payment',
      confidence: 0.98,
      category_confidence: 0.98,
      bill_purpose: 'ตาชั่ง ผลิต',
      slip_amount_text: '2,361.00',
      slip_amount_value: 2361,
      slip_amount_confidence: 0.99,
      raw_text: 'จ่ายบิลสำเร็จ จาก พนักงาน ไปยัง 123 SERVICE จำนวนเงิน 2,361.00',
      summary: 'พนักงานสำรองจ่ายค่าตาชั่งให้ 123 SERVICE จำนวน 2,361 บาท',
      evidence: ['ตาชั่ง ผลิต', 'จ่ายจากบัญชีบุคคล', '2,361.00'],
      needs_review: false,
      amount_conflict: false
    });
  }
  if (key.includes('reimbursement')) {
    return normalizeAnalysis({
      category: 'transfer',
      payment_role: 'reimbursement',
      confidence: 0.99,
      category_confidence: 0.99,
      bill_purpose: 'คืนเงินสำรองซื้อตาชั่ง',
      slip_amount_text: '2,361.00',
      slip_amount_value: 2361,
      slip_amount_confidence: 0.99,
      raw_text: 'โอนเงินสำเร็จ จาก บจก. โซลาว ไปยัง พนักงาน จำนวนเงิน 2,361.00',
      summary: 'บจก. โซลาวคืนเงินสำรองค่าตาชั่งจำนวน 2,361 บาท',
      evidence: ['คืนเงินสำรองซื้อตาชั่ง', 'จาก บจก. โซลาว', '2,361.00'],
      needs_review: false,
      amount_conflict: false
    });
  }
  if (key.includes('summary-cover')) {
    return normalizeAnalysis({
      category: 'bill',
      document_class: 'bill_summary_cover',
      confidence: 0.98,
      category_confidence: 0.98,
      vendor_name: 'เจ๊แววไก่สด',
      supplier_name: 'เจ๊แววไก่สด',
      bill_total_text: '300.00',
      bill_total_value: 300,
      summary_period: 'ทดสอบ',
      summary_lines: [
        { doc_ref: 'A', invoice_date: '20/7/69', due_date: null, amount: 100 },
        { doc_ref: 'B', invoice_date: '20/7/69', due_date: null, amount: 200 }
      ],
      raw_text: 'mock bill acceptance summary 300.00',
      summary: 'ใบปะหน้าสรุปยอด 300.00',
      evidence: ['mock summary cover'],
      needs_review: false,
      amount_conflict: false
    });
  }
  if (key.includes('summary-bill-a')) {
    return normalizeAnalysis({
      category: 'bill',
      document_class: 'standard_bill',
      confidence: 0.97,
      category_confidence: 0.97,
      vendor_name: 'เจ๊แววไก่สด',
      bill_total_text: '100.00',
      bill_total_value: 100,
      raw_text: 'mock summary detail bill 100.00',
      summary: 'บิลย่อย 100.00',
      evidence: ['mock summary detail'],
      needs_review: false,
      amount_conflict: false
    });
  }
  if (key.includes('summary-bill-b')) {
    return normalizeAnalysis({
      category: 'bill',
      document_class: 'standard_bill',
      confidence: 0.97,
      category_confidence: 0.97,
      vendor_name: 'เจ๊แววไก่สด',
      bill_total_text: '200.00',
      bill_total_value: 200,
      raw_text: 'mock summary detail bill 200.00',
      summary: 'บิลย่อย 200.00',
      evidence: ['mock summary detail'],
      needs_review: false,
      amount_conflict: false
    });
  }
  if (key.includes('semantic-duplicate')) {
    return normalizeAnalysis({
      category: 'bill',
      confidence: 0.96,
      category_confidence: 0.97,
      vendor_name: 'บริษัททดสอบซัพพลายเออร์ จำกัด',
      vendor_tax_id: '0105555555555',
      doc_ref: 'DUP-4224',
      bill_total_text: '4,224.00',
      bill_total_value: 4224,
      raw_text: 'บริษัททดสอบซัพพลายเออร์ จำกัด เลขประจำตัวผู้เสียภาษี 0105555555555 เลขที่เอกสาร DUP-4224 ยอดสุทธิ 4,224.00',
      summary: 'บิลทดสอบสำหรับตรวจเอกสารซ้ำ',
      evidence: ['mock semantic duplicate bill'],
      needs_review: false,
      amount_conflict: false
    });
  }
  if (key.includes('report-slip')) {
    return normalizeAnalysis({
      category: 'transfer',
      payment_role: 'ordinary_payment',
      confidence: 0.98,
      category_confidence: 0.98,
      slip_amount_text: '7,777.00',
      slip_amount_value: 7777,
      slip_amount_confidence: 0.99,
      amount_conflict: false,
      raw_text: 'mock report transfer slip amount 7,777.00',
      summary: 'AI mock สลิปสำหรับทดสอบรายงานยอด 7,777.00',
      evidence: ['mock report slip']
    });
  }
  // mock multi-page invoice: "...-p1of3" = continuation page (no total), "...-p3of3" = the payable page
  const pageMatch = key.match(/-p(\d+)of(\d+)/);
  if (pageMatch) {
    const pageNo = Number(pageMatch[1]);
    const pageCount = Number(pageMatch[2]);
    const isLast = pageNo === pageCount;
    const docRef = (key.match(/doc([0-9a-z]+)/) || [])[1] || 'mockdoc';
    return normalizeAnalysis({
      category: 'bill',
      confidence: 0.93,
      category_confidence: 0.95,
      vendor_name: 'makro',
      doc_ref: docRef,
      page_no: pageNo,
      page_count: pageCount,
      bill_total_text: isLast ? '1,720.00' : null,
      bill_total_value: isLast ? 1720 : null,
      amount_conflict: false,
      raw_text: `mock makro invoice ${docRef} หน้าที่ ${pageNo} จาก ${pageCount}${isLast ? ' ยอดสุทธิ 1,720.00' : ' มีต่อหน้า ' + (pageNo + 1)}`,
      summary: isLast
        ? `ใบกำกับ makro หน้า ${pageNo}/${pageCount} ยอดสุทธิ 1,720.00`
        : `ใบกำกับ makro หน้า ${pageNo}/${pageCount} ยังไม่แสดงยอดรวม`,
      evidence: [`หน้าที่ ${pageNo} จาก ${pageCount}`, `เลขที่ใบกำกับภาษี ${docRef}`],
      needs_review: false
    });
  }

  if (key.includes('slip') || key.includes('transfer')) {
    // Slips rarely carry typed text; read the amount from the image only.
    return normalizeAnalysis({
      category: 'transfer',
      payment_role: 'ordinary_payment',
      confidence: 0.96,
      category_confidence: 0.96,
      slip_amount_text: '1,720.00',
      slip_amount_value: 1720,
      slip_amount_confidence: 0.95,
      amount_conflict: false,
      raw_text: 'mock transfer slip amount 1,720.00 ไปยัง ร้านทดสอบ',
      summary: 'AI mock อ่านเป็นสลิปโอนเงินไปยังร้านทดสอบยอด 1,720.00',
      evidence: ['mock slip filename', 'amount 1,720.00', 'payee ร้านทดสอบ']
    });
  }
  if (key.includes('bill')) {
    const { amount: typedAmount, purpose } = mockTypedFromText(nearbyText);
    if (key.includes('bill-noamount')) {
      // Image total unreadable — fill it from the typed announcement if present.
      const total = typedAmount ?? null;
      const totalText = total == null ? null : total.toLocaleString('en-US', { minimumFractionDigits: 2 });
      return normalizeAnalysis({
        category: 'bill',
        confidence: 0.82,
        category_confidence: 0.9,
        vendor_name: 'ร้านยอดไม่ชัด',
        bill_purpose: purpose,
        bill_total_text: totalText,
        bill_total_value: total,
        announced_amount: typedAmount,
        amount_conflict: false,
        raw_text: `mock bill without readable total${typedAmount != null ? `, typed amount ${typedAmount}` : ''}`,
        summary: total == null
          ? 'AI mock อ่านเป็นบิลแต่ไม่พบยอดรวม'
          : `AI mock บิลไม่มียอดในรูป ใช้ยอดจากข้อความ ${totalText}`,
        evidence: ['mock missing total'],
        needs_review: total == null
      });
    }
    const imageAmount = key.includes('bill-alt') ? 999 : 1720;
    const amountText = imageAmount.toLocaleString('en-US', { minimumFractionDigits: 2 });
    const amountConflict = typedAmount != null && Math.abs(typedAmount - imageAmount) > 1;
    return normalizeAnalysis({
      category: 'bill',
      confidence: 0.94,
      category_confidence: 0.94,
      vendor_name: 'ร้านทดสอบ',
      bill_purpose: purpose,
      bill_total_text: amountText,
      bill_total_value: imageAmount,
      announced_amount: typedAmount,
      amount_conflict: amountConflict,
      raw_text: `mock bill ร้านทดสอบ total ${amountText}${typedAmount != null ? `, typed ${typedAmount}` : ''}`,
      summary: amountConflict
        ? `AI mock: ยอดในรูป ${amountText} แต่แจ้ง ${typedAmount} — ต้องตรวจ`
        : `AI mock อ่านเป็นบิลร้านทดสอบยอด ${amountText}`,
      evidence: amountConflict
        ? ['mock bill filename', `image total ${amountText}`, `typed ${typedAmount}`]
        : ['mock bill filename', `total ${amountText}`]
    });
  }
  return normalizeAnalysis({
    category: 'other',
    confidence: 0.75,
    category_confidence: 0.75,
    raw_text: 'mock other image',
    summary: 'AI mock ยังไม่พบว่าเป็นบิลหรือสลิป',
    evidence: ['mock default']
  });
};

const analyzeItem = async ({ item, config, nearbyText = [], learningExamples = [], conversationContext = [] }) => {
  const applyContextBinding = (analysis) => {
    const isMarketDocument = /^บิลตลาด\b/i.test(String(analysis.bill_purpose || ''));
    if (isMarketDocument) return analysis;
    const link = selectBillAnnouncementContext({
      analysis,
      item,
      messages: uniqueContextMessages(nearbyText, conversationContext)
    });
    if (normalizeCategory(analysis.category || analysis.document_type) !== 'bill') return analysis;
    if (!link) {
      return {
        ...analysis,
        announced_amount: null,
        amount_conflict: false,
        _context_link: null
      };
    }
    const visual = Number(analysis.bill_total_value || 0);
    const conflict = visual > 0 && Math.abs(visual - link.amount) > 1 && !link.explainedDifference;
    return {
      ...analysis,
      announced_amount: link.amount,
      amount_conflict: conflict,
      needs_review: Boolean(analysis.needs_review) || conflict,
      _context_link: link
    };
  };
  if (config.provider === 'mock') {
    const analysis = applyContextBinding(preserveKnownTransferFromMarketContext(applyDeterministicChatRules(
      await analyzeWithMock({ item, config, nearbyText }),
      nearbyText,
      { item, conversationContext }
    )));
    analysis._usage = { input_tokens: 100, cached_input_tokens: 20, output_tokens: 25, reasoning_tokens: 0, total_tokens: 125 };
    return analysis;
  }
  if (config.provider === 'openai') {
    const analysis = await analyzeWithOpenAi({ item, config, nearbyText, learningExamples, conversationContext });
    const usage = analysis._usage;
    const corrected = applyContextBinding(preserveKnownTransferFromMarketContext(
      applyDeterministicChatRules(analysis, nearbyText, { item, conversationContext })
    ));
    corrected._usage = usage;
    return corrected;
  }
  throw new Error('AI provider is not configured');
};

const classifyAiFailure = (error, attemptCount) => {
  const message = String(error?.message || error || 'unknown AI error');
  const missingStorage = error?.code === 'ENOENT' || /ENOENT|no such file/i.test(message);
  const transient = !missingStorage && /429|408|5\d\d|timeout|timed out|fetch failed|ECONN|socket|temporar|overloaded|server error/i.test(message);
  if (!transient) return { errorKind: missingStorage ? 'storage_missing' : 'permanent', nextRetryAt: null };
  const attempt = Math.max(1, Number(attemptCount || 1));
  const delayMs = Math.min(6 * 60 * 60 * 1000, 30 * 1000 * (2 ** Math.min(attempt - 1, 8)));
  return { errorKind: 'transient', nextRetryAt: new Date(Date.now() + delayMs).toISOString() };
};

const normalizedDigits = (value) => String(value || '').replace(/\D/g, '');
const extractCpAxtraReference = (item) => {
  const text = String(item?.ai_raw_text || '');
  const match = text.match(/(?:เลขที่อ้างอิง|reference|ref\s*2)\s*[:：]?\s*(\d{10,15})/i);
  return normalizedDigits(match?.[1]) || normalizedDigits(item?.doc_ref);
};
const extractMakroBillReference = (item) => {
  const stored = normalizedDigits(item?.doc_ref);
  if (stored) return stored;
  const text = String(item?.ai_raw_text || '');
  const match = text.match(/(?:เลขที่ใบกำกับภาษี|tax invoice no\.?|เลขที่ใบแจ้งหนี้|ref\s*2)\s*[:：]?\s*(\d{10,15})/i);
  return normalizedDigits(match?.[1]);
};

const itemEvidence = (item) => {
  try {
    const result = JSON.parse(item?.ai_result_json || '{}');
    return Array.isArray(result.evidence)
      ? result.evidence.slice(0, 2).map((entry) => String(entry).replace(/\s+/g, ' ').trim().slice(0, 160)).filter(Boolean)
      : [];
  } catch {
    return [];
  }
};

const paymentRoleOf = (item) => {
  const stored = String(item?.payment_role || '').trim();
  if (['ordinary_payment', 'advance_payment', 'reimbursement'].includes(stored)) return stored;
  try {
    const parsed = JSON.parse(item?.ai_result_json || '{}');
    const role = String(parsed?.payment_role || '').trim();
    return ['ordinary_payment', 'advance_payment', 'reimbursement'].includes(role) ? role : 'unknown';
  } catch {
    return 'unknown';
  }
};

const reimbursementText = (item) => [item?.bill_purpose, item?.ai_summary, item?.ai_raw_text]
  .filter(Boolean)
  .join(' ');

const isExplicitReimbursement = (item) => paymentRoleOf(item) === 'reimbursement'
  || /คืนเงินสำรอง|คืนค่า.+ที่สำรอง|เบิกคืน|คืนเงิน.+(?:ซื้อ|จ่าย)/i.test(reimbursementText(item));

export const isMarketAccountReimbursement = (item) => paymentRoleOf(item) === 'reimbursement'
  && /7193|ศิริลักษณ์|ศิริลัก|เวียงแสง/i.test(`${item?.ai_raw_text || item?.raw_text || ''} ${item?.ai_summary || item?.summary || ''}`)
  && /คืนเงิน(?:เข้า)?บัญชีตลาด|บัญชีตลาด.+สำรองจ่าย/i.test(reimbursementText(item));

const isCompanyOutbound = (item) => /(?:จาก|FROM)\s*(?:บจก\.?|บริษัท)?\s*โซลาว|SOLAO.+(?:FROM|SENDER)/i
  .test(String(item?.ai_raw_text || ''));

const purposeTokens = (item) => {
  const text = String(item?.bill_purpose || item?.ai_summary || '')
    .replace(/คืนเงินสำรอง|เงินสำรอง|สำรองจ่าย|เบิกคืน|คืนเงิน|บจก\.?|บริษัท|โซลาว|เจ๊|คุณ|นาย|นางสาว|น\.ส\.|ซื้อ|ค่า|จ่าย|โอน|บาท/gi, ' ');
  const ignored = new Set(['และ', 'หรือ', 'ที่', 'ให้', 'ไป', 'มา', 'ของ', 'เพื่อ', 'จาก', 'จำนวน']);
  const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
  return new Set([...segmenter.segment(text)]
    .filter((part) => part.isWordLike)
    .map((part) => part.segment.trim().toLowerCase())
    .filter((part) => part.length >= 2 && !ignored.has(part)));
};

const sharedPurposeTokens = (left, right) => {
  const leftTokens = purposeTokens(left);
  const rightTokens = purposeTokens(right);
  return [...leftTokens].filter((token) => rightTokens.has(token));
};

export const autoLinkAdvanceReimbursements = async (config = getAiConfig()) => {
  const items = await listReimbursementCandidates({ limit: 2000 });
  const reimbursements = items.filter(isExplicitReimbursement);
  const advances = items.filter((item) => !isExplicitReimbursement(item) && !isCompanyOutbound(item));
  const usedAdvances = new Set();
  const links = [];

  for (const reimbursement of reimbursements) {
    const reimbursementAmount = Number(reimbursement.slip_amount_value || 0);
    const reimbursementTime = Number(reimbursement.event_timestamp_ms || 0);
    if (!(reimbursementAmount > 0) || !reimbursementTime) continue;
    const candidates = advances.map((advance) => {
      const advanceAmount = Number(advance.slip_amount_value || 0);
      const advanceTime = Number(advance.event_timestamp_ms || 0);
      const hours = (reimbursementTime - advanceTime) / 3600000;
      const sharedPurpose = sharedPurposeTokens(advance, reimbursement);
      const exactAmount = Math.abs(advanceAmount - reimbursementAmount) <= config.amountTolerance;
      const sameSource = advance.source_id === reimbursement.source_id;
      const explicitAdvance = paymentRoleOf(advance) === 'advance_payment';
      if (!exactAmount || !sameSource || hours < 0 || hours > 30 * 24 || !sharedPurpose.length) return null;
      return { advance, hours, sharedPurpose, score: (explicitAdvance ? 30 : 0) + sharedPurpose.length * 10 - Math.min(hours, 24) };
    }).filter(Boolean).sort((left, right) => right.score - left.score || left.hours - right.hours);
    const best = candidates.find((candidate) => !usedAdvances.has(candidate.advance.id));
    if (!best) continue;
    const reasons = [
      'ธุรกรรมสำรองจ่ายและคืนเงินสำรอง',
      `ยอดตรงกัน ${reimbursementAmount.toFixed(2)} บาท`,
      `วัตถุประสงค์ตรงกัน: ${best.sharedPurpose.join(', ')}`,
      `สำรองจ่ายก่อนคืนเงิน ${best.hours.toFixed(2)} ชั่วโมง`,
      'กลุ่ม LINE เดียวกัน',
      'รอตรวจยืนยันโดยผู้ดูแล'
    ];
    const linked = await setReimbursementLink({
      advanceItemId: best.advance.id,
      reimbursementItemId: reimbursement.id,
      reasons
    });
    if (linked) {
      usedAdvances.add(best.advance.id);
      links.push(linked);
    }
  }
  return links;
};

// บิลตลาดสดถูกอ้างอิงหลายที่ด้วย bill_purpose ที่ขึ้นต้น "บิลตลาด" แต่ของจริงโมเดล
// เขียนสั้นเป็น "ตลาด" ได้ จึงต้องรับรูปแบบที่หลวมกว่า ไม่งั้นตรรกะตลาดสดทั้งชุดจะไม่ทำงาน
const isMarketSheet = (bill) => {
  const purpose = String(bill?.bill_purpose || '').trim();
  if (/^บิลตลาด/.test(purpose) || /^ตลาด$/.test(purpose) || /ตลาดสด/.test(purpose)) return true;
  return /ซื้อของตลาด|รายการซื้อของตลาด|ของตลาดวันที่|ตลาดสด/.test(String(bill?.ai_summary || ''));
};

const normalizeIdentity = (value) => String(value || '')
  .normalize('NFC')
  .toLowerCase()
  .replace(/(?:บริษัท|บจก\.?|หจก\.?|จำกัด|ร้าน|นาย|นางสาว|น\.ส\.?|นาง|คุณ|ธนาคาร|bank|company|co\.?\s*ltd\.?)/giu, ' ')
  .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const identityTokens = (value) => normalizeIdentity(value)
  .split(' ')
  .filter((token) => token.length >= 3)
  .filter((token) => !/^(?:โอนเงิน|สำเร็จ|จำนวนเงิน|จำนวน|บาท|จาก|ไปยัง|ผู้รับ|ชำระเงิน|ชำระสินค้า|receipt|payment|transfer)$/.test(token));

const identitiesOverlap = (left, right) => {
  const leftNormalized = normalizeIdentity(left);
  const rightNormalized = normalizeIdentity(right);
  if (!leftNormalized || !rightNormalized) return false;
  if (leftNormalized === rightNormalized) return true;
  const leftCompact = leftNormalized.replace(/\s+/g, '');
  const rightCompact = rightNormalized.replace(/\s+/g, '');
  if (Math.min(leftCompact.length, rightCompact.length) >= 4
      && (leftCompact.includes(rightCompact) || rightCompact.includes(leftCompact))) return true;
  const rightTokens = new Set(identityTokens(right));
  return identityTokens(left).some((token) => rightTokens.has(token));
};

const extractSlipRecipient = (slip) => {
  const text = `${slip?.ai_raw_text || ''}\n${slip?.ai_summary || ''}`
    .replace(/[|;]/g, '\n');
  const match = text.match(
    /(?:ไปยัง|ถึง|ผู้รับ(?:เงิน)?|\bto\b)\s*[:：]?\s*([^\n]{2,120}?)(?=\s*(?:ธนาคาร|เลขที่|เลขบัญชี|บัญชี|xxx|x\d|จำนวนเงิน|จำนวน|ค่าธรรมเนียม|วันที่|เวลา|$))/iu
  );
  return String(match?.[1] || '').trim();
};

const identityEvidenceForPair = ({ bill, slip, billIdentity, slipIdentity, marketTransferAmount, referenceMatch }) => {
  const billNames = [bill?.supplier_name, bill?.vendor_name].map((value) => String(value || '').trim()).filter(Boolean);
  const slipRecipient = extractSlipRecipient(slip);
  const slipNames = [slip?.vendor_name, slipRecipient].map((value) => String(value || '').trim()).filter(Boolean);
  const genericMatch = billNames.some((billName) => slipNames.some((slipName) => identitiesOverlap(billName, slipName)))
    || billNames.some((billName) => identitiesOverlap(billName, slipIdentity));
  const billMarketplace = detectKnownMarketplace(`${billIdentity} ${bill?.bill_purpose || ''}`);
  const slipMarketplace = detectKnownMarketplace(slipIdentity);
  const marketplaceMatch = Boolean(billMarketplace && slipMarketplace && billMarketplace === slipMarketplace);
  const marketplaceConflict = Boolean(billMarketplace && slipMarketplace && billMarketplace !== slipMarketplace);
  const makroBill = /makro|แม็คโคร|CP\s*AXTRA/i.test(billIdentity);
  const cpAxtraSlip = /CP\s*AXTRA|SMARTONE|010756700041404/i.test(slipIdentity);
  const marketAccountSlip = /x7193|ศิริลัก|เวียงแสง/i.test(slipIdentity);
  const marketPair = Boolean(marketTransferAmount > 0 && marketAccountSlip);
  const marketExpenseReimbursementPair = Boolean(
    isMarketAccountReimbursement(slip)
    && marketAccountSlip
    && /ตลาด/i.test(`${bill?.bill_purpose || ''} ${bill?.ai_summary || ''}`)
  );
  const provincialWaterMatch = /การประปาส่วนภูมิภาค/.test(billIdentity)
    && /การประปาส่วนภูมิภาค/.test(slipIdentity);
  const specialMatch = referenceMatch || marketPair || marketExpenseReimbursementPair || provincialWaterMatch || marketplaceMatch;
  const explicitRecipientMismatch = Boolean(billNames.length && slipNames.length && !genericMatch && !specialMatch);
  const identityConflict = marketplaceConflict
    || (cpAxtraSlip && !makroBill)
    || (isMarketSheet(bill) && slipNames.length > 0 && !marketAccountSlip)
    || explicitRecipientMismatch;

  return {
    billMarketplace,
    slipMarketplace,
    marketplaceMatch,
    genericMatch,
    marketPair,
    marketExpenseReimbursementPair,
    provincialWaterMatch,
    identityConfirmed: Boolean(specialMatch || genericMatch),
    identityConflict,
    slipRecipient
  };
};

export const scoreSequencePair = ({ bill, slip, config }) => {
  const paymentRole = paymentRoleOf(slip);
  const marketAccountReimbursement = isMarketAccountReimbursement(slip);
  if (paymentRole === 'reimbursement' && !marketAccountReimbursement) return null;
  const documentAmount = Number(bill.bill_total_value || 0);
  const marketTransferAmount = isMarketSheet(bill) ? Number(bill.announced_amount || 0) : 0;
  // Daily market sheets are reimbursed after their explicit shortage/excess adjustment.
  // Their announced_amount is therefore the slip-facing amount, while bill_total_value
  // remains the actual market spend shown in the back office.
  const billAmount = marketTransferAmount > 0 ? marketTransferAmount : documentAmount;
  const slipAmount = Number(slip.slip_amount_value || 0);
  const hasBillAmount = Number.isFinite(billAmount) && billAmount > 0;
  const hasAmounts = hasBillAmount && Number.isFinite(slipAmount) && slipAmount > 0;
  if (!hasAmounts) return null;
  const diff = hasAmounts ? Math.abs(billAmount - slipAmount) : null;
  const diffPercent = hasAmounts ? diff / Math.max(1, billAmount) : null;
  if (paymentRole === 'advance_payment' && (!hasAmounts || diff > config.amountTolerance)) return null;

  const billTime = Number(bill.event_timestamp_ms || 0);
  const slipTime = Number(slip.event_timestamp_ms || 0);
  const hours = billTime && slipTime ? Math.abs(billTime - slipTime) / 3600000 : 0;
  const billIdentity = `${bill.vendor_name || ''} ${bill.ai_raw_text || bill.raw_text || ''} ${bill.ai_summary || bill.summary || ''} ${bill.bill_purpose || ''}`;
  const slipIdentity = `${slip.vendor_name || ''} ${slip.ai_raw_text || slip.raw_text || ''} ${slip.ai_summary || slip.summary || ''} ${slip.bill_purpose || ''}`;
  const cpAxtraSlip = /CP\s*AXTRA|SMARTONE|010756700041404/i.test(slipIdentity);
  const makroBill = /makro|แม็คโคร|CP\s*AXTRA/i.test(billIdentity);
  const billReference = extractMakroBillReference(bill);
  const slipReference = cpAxtraSlip ? extractCpAxtraReference(slip) : '';
  const cpAxtraPair = Boolean(makroBill && cpAxtraSlip && billReference && slipReference);
  if (cpAxtraPair && billReference && slipReference && billReference !== slipReference) return null;
  const referenceMatch = Boolean(cpAxtraPair && billReference && slipReference && billReference === slipReference);
  const fallbackBillSources = config.sourceFallbacks?.[slip.source_id] || [];
  const crossSourceFallback = bill.source_id !== slip.source_id && fallbackBillSources.includes(bill.source_id);
  if (config.requireSameSource && bill.source_id !== slip.source_id && !referenceMatch && !crossSourceFallback) return null;
  // Fallback groups are a guarded second pass. Near amounts remain available
  // in the manual picker but are not proposed automatically.
  if (crossSourceFallback && !referenceMatch && (!hasAmounts || diff > config.amountTolerance)) return null;
  const identity = identityEvidenceForPair({ bill, slip, billIdentity, slipIdentity, marketTransferAmount, referenceMatch });
  // A single bill/slip proposal must reconcile on its own. Large differences are handled by
  // the explicit many-to-many workflow, otherwise non-amount signals can flood the queue.
  if (diff > config.amountTolerance && diffPercent > config.percentTolerance) return null;
  const { marketPair, marketExpenseReimbursementPair, provincialWaterMatch } = identity;
  const allowedHours = provincialWaterMatch || referenceMatch
    ? Math.max(config.maxMatchHours, 14 * 24)
    : config.maxMatchHours;
  if (hours > allowedHours) return null;

  const amountScore = !hasAmounts
    ? 0
    : diff <= config.amountTolerance
      ? 45
      : diffPercent <= config.percentTolerance
        ? 35
        : diffPercent <= 0.05
          ? 18
          : diffPercent <= 0.15
            ? 8
            : 0;
  const sourceScore = bill.source_id === slip.source_id ? 20 : crossSourceFallback ? 5 : 0;
  const sameSender = Boolean(bill.sender_user_id && slip.sender_user_id && bill.sender_user_id === slip.sender_user_id);
  const senderScore = sameSender ? 8 : 0;
  const timeScore = !hours || hours <= (5 / 60)
    ? 20
    : hours <= 0.5
      ? 18
      : hours <= 1
        ? 17
        : hours <= 6
          ? 15
          : hours <= 24
            ? 10
            : 5;
  const aiConfidence = ((Number(bill.ai_confidence || 0) || 0) + (Number(slip.ai_confidence || 0) || 0)) / 2;
  const aiScore = Math.round(Math.max(0, Math.min(1, aiConfidence)) * 10);
  const identityScore = referenceMatch
    ? 0
    : provincialWaterMatch || marketPair || marketExpenseReimbursementPair
      ? 12
      : identity.marketplaceMatch
        ? 8
        : identity.genericMatch
          ? 10
          : 0;
  const identityPenalty = identity.identityConflict ? -40 : 0;
  const referenceScore = referenceMatch ? 20 : 0;
  const score = Math.max(0, Math.min(99, amountScore + sourceScore + senderScore + timeScore + aiScore + identityScore + identityPenalty + referenceScore));
  const contextualReasons = [
    bill.bill_purpose ? `บริบทค่าใช้จ่าย: ${String(bill.bill_purpose).slice(0, 160)}` : null,
    ...itemEvidence(bill).map((entry) => `หลักฐานบิล: ${entry}`),
    ...itemEvidence(slip).map((entry) => `หลักฐานสลิป: ${entry}`)
  ].filter(Boolean);

  return {
    score,
    diff,
    diffPercent,
    hours,
    reasons: [
      hasAmounts && diff <= config.amountTolerance ? 'ยอดตรงกัน' : 'เรียงจากคู่ที่ใกล้เคียงที่สุด',
      hasAmounts ? `ยอดบิล ${billAmount}` : 'ไม่พบยอดบิล',
      marketTransferAmount > 0 ? `ยอดซื้อของตลาด ${documentAmount}` : 'ใช้ยอดเอกสารจับคู่',
      marketPair ? 'โอนเข้าบัญชีค่าใช้จ่ายตลาดสด (ลงท้าย 7193)' : null,
      marketExpenseReimbursementPair ? 'คืนเงินเข้าบัญชีตลาดสำหรับค่าใช้จ่ายที่บัญชีตลาดสำรองจ่าย' : null,
      hasAmounts ? `ยอดสลิป ${slipAmount}` : 'ไม่พบยอดสลิป',
      hasAmounts ? `ส่วนต่าง ${diff.toFixed(2)}` : 'ให้คนตรวจยอด',
      bill.source_id === slip.source_id ? 'กลุ่มเดียวกัน' : crossSourceFallback ? 'ค้นจากกลุ่มสำรองหลังกลุ่มเดิมไม่พบคู่' : 'คนละกลุ่ม',
      provincialWaterMatch ? 'หน่วยงานตรงกัน: การประปาส่วนภูมิภาค' : 'ไม่พบกติกาหน่วยงานเฉพาะ',
      identity.marketplaceMatch ? `ช่องทางตรงกัน: ${identity.billMarketplace}` : 'ไม่มีช่องทาง marketplace ที่ยืนยันตรงกัน',
      identity.genericMatch ? 'ชื่อร้าน/ผู้รับเงินสอดคล้องกัน' : null,
      identity.identityConflict ? `ชื่อร้านหรือผู้รับเงินขัดแย้งกัน${identity.slipRecipient ? `: ${identity.slipRecipient}` : ''}` : null,
      referenceMatch ? `เลขอ้างอิง CP AXTRA ตรงกัน ${billReference}` : 'ไม่มีเลขอ้างอิงเฉพาะที่ตรงกัน',
      sameSender ? 'ผู้ส่งคนเดียวกัน' : 'ผู้ส่งต่างกันหรือยังยืนยันไม่ได้',
      `เวลาห่าง ${hours.toFixed(2)} ชั่วโมง`,
      ...contextualReasons
    ],
    exactAmount: diff <= config.amountTolerance,
    identityConfirmed: identity.identityConfirmed,
    identityConflict: identity.identityConflict,
    crossSourceFallback,
    scoreBreakdown: { amountScore, sourceScore, senderScore, timeScore, aiScore, identityScore, identityPenalty, referenceScore }
  };
};

const loadAllItemsForAutoMatch = async () => {
  const rows = [];
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const page = await listItems({ status: 'downloaded', matchStatus: 'unmatched', limit: pageSize, offset });
    rows.push(...page.rows);
    offset += page.rows.length;
    if (!page.rows.length || offset >= page.total) break;
  }
  return rows.filter((item) => item.ai_status === 'done' && ['bill', 'transfer', 'transfer_notice'].includes(item.category));
};

const loadAllMatchesByStatus = async (status) => {
  const matches = [];
  const pageSize = 500;
  let offset = 0;
  while (true) {
    const page = await listMatches({ status, limit: pageSize, offset });
    matches.push(...page);
    if (page.length < pageSize) break;
    offset += page.length;
  }
  return matches;
};

const pairKey = (billId, slipId) => `${Number(billId || 0)}:${Number(slipId || 0)}`;
const isHumanControlledMatch = (match) => Boolean(
  Number(match?.ai_learning_approved || 0)
  || (match?.reviewed_by && match.reviewed_by !== AI_WORKER_ACTOR)
  || (match?.created_by && match.created_by !== AI_WORKER_ACTOR)
  || match?.match_group_key
);

const addActiveMatch = (activeByItem, match) => {
  for (const itemId of [match.bill_item_id, match.slip_item_id]) {
    const id = Number(itemId || 0);
    if (!id) continue;
    const entries = activeByItem.get(id) || [];
    entries.push(match);
    activeByItem.set(id, entries);
  }
};

const removeActiveMatch = (activeByItem, match) => {
  for (const itemId of [match.bill_item_id, match.slip_item_id]) {
    const id = Number(itemId || 0);
    if (!id) continue;
    const entries = (activeByItem.get(id) || []).filter((entry) => Number(entry.id) !== Number(match.id));
    if (entries.length) activeByItem.set(id, entries);
    else activeByItem.delete(id);
  }
};

const conflictingActiveMatches = (activeByItem, billId, slipId) => {
  const conflicts = [...(activeByItem.get(Number(billId)) || []), ...(activeByItem.get(Number(slipId)) || [])];
  return [...new Map(conflicts.map((match) => [Number(match.id), match])).values()];
};

const canApplyCandidate = ({ candidate, activeMatches, targetStatus }) => {
  if (!activeMatches.length) return true;
  const samePair = activeMatches.filter((match) => pairKey(match.bill_item_id, match.slip_item_id) === pairKey(candidate.bill.id, candidate.slip.id));
  const otherPairs = activeMatches.filter((match) => !samePair.includes(match));
  if (activeMatches.some((match) => ['confirmed', 'manual_review'].includes(match.status))) return false;
  if (otherPairs.some((match) => match.status !== 'pending' || isHumanControlledMatch(match))) return false;
  if (otherPairs.some((match) => candidate.scored.score <= Number(match.score || 0))) return false;
  if (samePair.some((match) => candidate.scored.score < Number(match.score || 0))) return false;
  if (!otherPairs.length && samePair.length) {
    const current = samePair[0];
    const promotes = current.status === 'pending' && targetStatus === 'confirmed';
    return promotes || candidate.scored.score > Number(current.score || 0);
  }
  return true;
};

export const autoMatchAiPairs = async (config = getAiConfig()) => {
  if (!config.autoMatchEnabled) return [];
  await autoLinkAdvanceReimbursements(config);
  const [unmatchedItems, pendingMatches, confirmedMatches, manualReviewMatches, rejectedMatches] = await Promise.all([
    loadAllItemsForAutoMatch(),
    loadAllMatchesByStatus('pending'),
    loadAllMatchesByStatus('confirmed'),
    loadAllMatchesByStatus('manual_review'),
    loadAllMatchesByStatus('rejected')
  ]);
  const activeMatches = [...pendingMatches, ...confirmedMatches, ...manualReviewMatches];
  const activeByItem = new Map();
  activeMatches.forEach((match) => addActiveMatch(activeByItem, match));
  const manualRejectionBlacklist = new Set(
    rejectedMatches.filter(isHumanControlledMatch).map((match) => pairKey(match.bill_item_id, match.slip_item_id))
  );
  const pendingItemIds = [...new Set(pendingMatches.flatMap((match) => [match.bill_item_id, match.slip_item_id]).map(Number).filter(Boolean))];
  const pendingItems = (await Promise.all(pendingItemIds.map((id) => getItemById(id))))
    .filter((item) => item?.status === 'downloaded' && item?.ai_status === 'done')
    .filter((item) => ['bill', 'transfer', 'transfer_notice'].includes(item.category));
  const items = [...new Map([...unmatchedItems, ...pendingItems].map((item) => [Number(item.id), item])).values()];
  const bills = items.filter((item) => item.category === 'bill');
  const slips = items.filter((item) => ['transfer', 'transfer_notice'].includes(item.category) && Number(item.slip_amount_value || 0) > 0);
  const candidates = [];
  const matches = [];

  for (const bill of bills) {
    for (const slip of slips) {
      if (manualRejectionBlacklist.has(pairKey(bill.id, slip.id))) continue;
      const scored = scoreSequencePair({ bill, slip, config });
      if (scored && scored.score >= config.sequenceMatchMinScore) {
        candidates.push({ bill, slip, scored });
      }
    }
  }

  candidates.sort((left, right) => {
    if (left.scored.exactAmount !== right.scored.exactAmount) return left.scored.exactAmount ? -1 : 1;
    if (right.scored.score !== left.scored.score) return right.scored.score - left.scored.score;
    if ((left.scored.diff ?? Number.POSITIVE_INFINITY) !== (right.scored.diff ?? Number.POSITIVE_INFINITY)) {
      return (left.scored.diff ?? Number.POSITIVE_INFINITY) - (right.scored.diff ?? Number.POSITIVE_INFINITY);
    }
    return left.scored.hours - right.scored.hours;
  });

  const usedBills = new Set();
  const usedSlips = new Set();
  for (const { bill, slip, scored } of candidates) {
    if (usedBills.has(bill.id) || usedSlips.has(slip.id)) continue;
    // A flagged slip has a typed amount that disagrees with the printed slip;
    // never auto-confirm it, always route to a human.
    const amountConflict = Boolean(Number(bill.amount_review_flag || 0) || Number(slip.amount_review_flag || 0));
    const status = !config.deferAutoConfirm
      && scored.exactAmount
      && !amountConflict
      && scored.identityConfirmed
      && !scored.identityConflict
      && !scored.crossSourceFallback
      && scored.score >= config.autoMatchMinScore
      ? 'confirmed'
      : 'pending';
    const candidate = { bill, slip, scored };
    const activeConflicts = conflictingActiveMatches(activeByItem, bill.id, slip.id);
    if (!canApplyCandidate({ candidate, activeMatches: activeConflicts, targetStatus: status })) continue;
    const pendingReason = amountConflict
      ? 'ยอดในรูปกับยอดที่พิมพ์ไม่ตรงกัน ต้องให้คนตรวจ'
      : config.deferAutoConfirm
        ? 'รอ AI วิเคราะห์รูปในคิวให้ครบก่อนยืนยันอัตโนมัติ'
        : !scored.exactAmount
          ? 'ยอดยังไม่ตรงตามค่าความคลาดเคลื่อน ต้องให้คนตรวจ'
          : scored.identityConflict
            ? 'ชื่อร้านหรือผู้รับเงินขัดแย้งกัน ต้องให้คนตรวจ'
            : !scored.identityConfirmed
              ? 'ยอดและเวลาใกล้กัน แต่ยังไม่มีหลักฐานยืนยันร้าน/ผู้รับเงิน'
      : scored.crossSourceFallback
        ? 'คู่ข้ามกลุ่มสำรอง ต้องให้คนตรวจยืนยัน'
        : 'รอตรวจยืนยันโดยผู้ดูแล';
    const match = await setItemMatch({
      billItemId: bill.id,
      slipItemId: slip.id,
      score: scored.score,
      status,
      reasons: [...scored.reasons, status === 'confirmed' ? 'AI ยืนยันอัตโนมัติจากหลักฐานตรงกัน' : pendingReason],
      createdBy: AI_WORKER_ACTOR
    });
    if (match && !match.error) {
      activeConflicts.forEach((activeMatch) => removeActiveMatch(activeByItem, activeMatch));
      addActiveMatch(activeByItem, match);
      usedBills.add(bill.id);
      usedSlips.add(slip.id);
      matches.push(match);
    }
  }

  return matches;
};

export const rebuildAiMatches = async () => {
  const config = getAiConfig();
  const duplicates = await markSemanticDuplicateBills();
  const reset = await resetAiPendingMatches();
  const needsAmount = await markBillsMissingAmount();
  const matches = await autoMatchAiPairs(config);
  return {
    duplicates,
    reset: reset.reset,
    needs_amount: needsAmount,
    matched: matches.length,
    match_ids: matches.map((match) => match.id)
  };
};

export const runAiWorkerCycle = async ({ limit } = {}) => {
  if (workerState.running) {
    return {
      enabled: workerState.enabled,
      provider: workerState.provider,
      model: workerState.model,
      skipped: true,
      reason: 'AI worker is already running'
    };
  }

  const config = getAiConfig();
  workerState.enabled = config.enabled;
  workerState.provider = config.provider;
  workerState.model = config.model;
  workerState.running = true;
  workerState.lastRunAt = new Date().toISOString();

  if (!config.enabled) {
    const result = {
      enabled: false,
      provider: config.provider,
      model: config.model,
      reason: config.configured ? 'AI_WORKER_ENABLED is false' : 'AI provider is not configured'
    };
    workerState.running = false;
    workerState.lastResult = result;
    return result;
  }

  const result = {
    enabled: true,
    provider: config.provider,
    model: config.model,
    processed: 0,
    failed: 0,
    matched: 0,
    item_ids: [],
    failed_item_ids: [],
    match_ids: []
  };

  try {
    const staleBeforeIso = new Date(Date.now() - config.staleProcessingMs).toISOString();
    const items = await listAiQueueItems({
      limit: limit || config.batchSize,
      maxAttempts: config.maxAttempts,
      staleBeforeIso
    });
    const learningExamples = await listAiLearningExamples({ limit: 12 });

    let nextItemIndex = 0;
    const processNextItem = async () => {
      while (nextItemIndex < items.length) {
        const item = items[nextItemIndex];
        nextItemIndex += 1;
      const claimed = await markAiProcessing({
        id: item.id,
        provider: config.provider,
        model: config.model,
        staleBeforeIso
      });
      if (!claimed || claimed.status !== 'downloaded' || claimed.ai_status !== 'processing') continue;

      const itemStartedAt = Date.now();
      try {
        const centerMs = Number(claimed.event_timestamp_ms || 0);
        const conversationFetchLimit = Math.max(
          config.conversationContextLimit,
          config.textContextLimit > 0 ? Math.min(120, Math.max(40, config.textContextLimit * 4)) : 0
        );
        const rawConversationContext = conversationFetchLimit > 0
          ? await listNearbyConversation({
            sourceType: claimed.source_type,
            sourceId: claimed.source_id,
            centerMs,
            windowMs: Math.max(config.conversationContextWindowMs, config.textContextWindowMs),
            limit: conversationFetchLimit
          })
          : [];
        const directNearbyText = config.textContextLimit > 0
          ? await listNearbyText({
            sourceType: claimed.source_type,
            sourceId: claimed.source_id,
            senderUserId: claimed.sender_canonical_user_id || claimed.sender_user_id,
            centerMs,
            windowMs: config.textContextWindowMs,
            limit: 100
          })
          : [];
        const nearbyText = selectNearestTypedContext({
          messages: uniqueContextMessages(directNearbyText, rawConversationContext),
          senderUserId: claimed.sender_canonical_user_id || claimed.sender_user_id,
          centerMs,
          limit: config.textContextLimit
        });
        const conversationContext = selectNearestTypedContext({
          messages: rawConversationContext,
          centerMs,
          limit: config.conversationContextLimit
        });
        const analysis = await analyzeItem({ item: claimed, config, nearbyText, learningExamples, conversationContext });
        traceAnalysis({
          item: claimed,
          config,
          analysis,
          durationMs: Date.now() - itemStartedAt,
          contextCounts: {
            nearbyText: nearbyText.length,
            conversation: conversationContext.length,
            learningExamples: Array.isArray(learningExamples) ? learningExamples.length : 0
          }
        });
        const updated = await applyAiAnalysis({
          id: claimed.id,
          provider: config.provider,
          model: config.model,
          analysis
        });
        if (updated) {
          result.processed += 1;
          result.item_ids.push(updated.id);
          const paymentLines = Array.isArray(analysis.payment_lines) ? analysis.payment_lines : [];
          const payableLines = paymentLines.filter((line) => !line.excluded);
          const payableTotal = payableLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
          const canSplitPaymentBatch = analysis.document_class === 'batch_payment_summary'
            && payableLines.length >= 2
            && payableLines.every((line) => Number(line.amount || 0) > 0)
            && Number(analysis.bill_total_value || 0) > 0
            && Math.abs(payableTotal - Number(analysis.bill_total_value || 0)) < 0.01;
          if (canSplitPaymentBatch) {
            await splitBatchPaymentSummary({
              parentItemId: updated.id,
              lines: paymentLines,
              createdBy: AI_WORKER_ACTOR
            });
          }
        }
      } catch (error) {
        const failure = classifyAiFailure(error, claimed.ai_attempt_count);
        traceFailure({ item: claimed, config, error, failure, durationMs: Date.now() - itemStartedAt });
        await markAiFailed({
          id: claimed.id,
          provider: config.provider,
          model: config.model,
          errorMessage: error?.message || 'unknown AI error',
          ...failure
        });
        result.failed += 1;
        result.failed_item_ids.push(claimed.id);
      }
      }
    };
    const workerCount = Math.min(items.length, config.analysisConcurrency);
    await Promise.all(Array.from({ length: workerCount }, () => processNextItem()));

    const queueAfterAnalysis = await getAiQueueStats({ maxAttempts: config.maxAttempts, staleBeforeIso });
    const deferAutoConfirm = Number(queueAfterAnalysis.pending_retryable || 0) > 0;
    const matches = await autoMatchAiPairs({ ...config, deferAutoConfirm });
    result.matched = matches.length;
    result.match_ids = matches.map((match) => match.id);
    result.auto_confirm_deferred = deferAutoConfirm;
    result.group_checks = await runConfiguredGroupChecks();
    workerState.lastResult = result;
    workerState.lastError = null;
    return result;
  } catch (error) {
    workerState.lastError = error?.message || String(error);
    throw error;
  } finally {
    workerState.running = false;
  }
};

export const getAiWorkerStatus = async () => {
  const config = getAiConfig();
  const staleBeforeIso = new Date(Date.now() - config.staleProcessingMs).toISOString();
  const queue = await getAiQueueStats({ maxAttempts: config.maxAttempts, staleBeforeIso });
  return {
    ...workerState,
    enabled: config.enabled,
    configured: config.configured,
    provider: config.provider,
    model: config.model,
    auto_match_enabled: config.autoMatchEnabled,
    auto_match_min_score: config.autoMatchMinScore,
    sequence_match_min_score: config.sequenceMatchMinScore,
    cost_estimate: estimateAiCost(queue.token_usage, config),
    queue
  };
};

export const startAiWorker = () => {
  const config = getAiConfig();
  workerState.enabled = config.enabled;
  workerState.provider = config.provider;
  workerState.model = config.model;

  if (!config.enabled) {
    console.log(`[LINE CAPTURE] AI worker disabled: ${config.configured ? 'AI_WORKER_ENABLED is false' : 'provider not configured'}`);
    return { stop: () => {}, runNow: runAiWorkerCycle };
  }

  let stopped = false;
  let timer = null;

  const schedule = (delayMs = config.intervalMs) => {
    if (stopped) return;
    timer = setTimeout(async () => {
      if (workerState.running) {
        schedule();
        return;
      }
      try {
        await runAiWorkerCycle();
      } catch (error) {
        console.error('[LINE CAPTURE] AI worker cycle failed:', error?.message || error);
      } finally {
        schedule();
      }
    }, delayMs);
    timer.unref?.();
  };

  console.log(`[LINE CAPTURE] AI worker enabled provider=${config.provider} model=${config.model}`);
  schedule(config.startDelayMs);

  return {
    runNow: runAiWorkerCycle,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    }
  };
};
