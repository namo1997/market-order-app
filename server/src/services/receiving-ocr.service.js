import { receiptText, ocrLineAmountSatang, billRefMatchingPattern } from './receiving-ocr-checks.js';
export { billBranchMismatch, weakBillRead, shopFromBillHeader, billShopMismatch } from './receiving-ocr-checks.js';
import { toBangkokDateKey } from '../utils/bangkok-date.js';
import {
  computeDocumentWarnings,
  computeTextSimilarity,
  matchOcrLinesToCatalog,
  mergeOcrLinesPreservingUserEdits
} from './receiving-ocr-matcher.js';
import {
  checkOcrRateLimit,
  computeImagesContentHash,
  extractImageDimensions,
  getOcrRateBucketCount,
  isSupportedImageBuffer,
  parseImageDataUrl,
  resetOcrRateLimit
} from './receiving-ocr-rate-limit.js';

export const MAX_BILL_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_OCR_PAGES = 10;
export const MAX_OCR_LINES = 200;
export const MAX_TOTAL_OCR_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_MONEY_VALUE = 999999999.99;
export const MAX_UNIT_PRICE_VALUE = 999999.999999;
export const MAX_QUANTITY_VALUE = 99999999.99;
export const MAX_UNIT_MULTIPLIER_VALUE = 10000;
export const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.8;
export const DEFAULT_PRICE_CHANGE_THRESHOLD = 0.15;
export const DEFAULT_SUM_MISMATCH_TOLERANCE = 1.0;
export const DEFAULT_OCR_MODEL = 'gpt-6.1-sol';
export const OCR_RATE_LIMIT_PER_MINUTE = 5;
export const MAX_OCR_ATTEMPTS_PER_DOCUMENT = 10;

export const ERROR_STATUS_BY_CODE = {
  UNAUTHORIZED: 401,
  VALIDATION_FAILED: 422,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  NOT_DRAFT: 409,
  CONFLICT: 409,
  SIGNATURE_REQUIRED: 422,
  RATE_LIMITED: 429,
  OCR_UNAVAILABLE: 503,
  RECEIVING_NOT_READY: 503,
  IMAGE_TOO_LARGE: 413
};

export const createReceivingError = (code, message, statusCode) => {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode || ERROR_STATUS_BY_CODE[code] || 400;
  return err;
};

export const toFiniteNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return null;
  const cleaned =
    typeof value === 'string'
      ? value.replace(/[,\s฿]/g, '').replace(/บาท$/u, '').trim()
      : value;
  if (cleaned === '') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

export const toSatangInt = (value) => {
  const num = toFiniteNumberOrNull(value);
  if (num === null) return null;
  return Math.round((num + Number.EPSILON) * 100);
};

export const fromSatangInt = (satang) => {
  if (satang === null || satang === undefined || !Number.isFinite(Number(satang))) return null;
  return Math.round(Number(satang)) / 100;
};

// R2-4 & R2-5: ใช้ความละเอียดจำนวน 2 ตำแหน่ง (หน่วยสตางค์/ร้อยละของหน่วย) ให้ตรงกับ DECIMAL(10,2) ของตารางเดิม
export const roundQty2 = (value) => {
  const num = toFiniteNumberOrNull(value);
  if (num === null) return null;
  return Math.round((num + Number.EPSILON) * 100) / 100;
};

export const toMilliQtyInt = (value) => {
  const rounded2 = roundQty2(value);
  if (rounded2 === null) return null;
  return Math.round((rounded2 + Number.EPSILON) * 1000);
};

export const fromMilliQtyInt = (millis) => {
  if (millis === null || millis === undefined || !Number.isFinite(Number(millis))) return null;
  return roundQty2(Number(millis) / 1000);
};

export const validatePositiveIntOrNull = (value, fieldName) => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (!Number.isSafeInteger(num) || num <= 0) {
    throw createReceivingError('VALIDATION_FAILED', `ค่า ${fieldName} ต้องเป็นจำนวนเต็มบวก`);
  }
  return num;
};

export const validateMoneyOrNull = (value, fieldName) => {
  if (value === null || value === undefined || value === '') return null;
  const num = toFiniteNumberOrNull(value);
  if (num === null || num < 0 || num > MAX_MONEY_VALUE) {
    throw createReceivingError('VALIDATION_FAILED', `ค่า ${fieldName} ไม่ถูกต้องหรือเกินขอบเขตที่กำหนด`);
  }
  return fromSatangInt(toSatangInt(num));
};

export const validateUnitPriceOrNull = (value, fieldName = 'unit_price') => {
  if (value === null || value === undefined || value === '') return null;
  const num = toFiniteNumberOrNull(value);
  if (num === null || num < 0 || num > MAX_UNIT_PRICE_VALUE) {
    throw createReceivingError('VALIDATION_FAILED', `ค่า ${fieldName} ไม่ถูกต้องหรือเกินขอบเขตที่กำหนด`);
  }
  return Math.round((num + Number.EPSILON) * 1000000) / 1000000;
};

// R2-4: จำกัดจำนวนเป็นทศนิยมไม่เกิน 2 ตำแหน่งตามคอลัมน์ DECIMAL(10,2) เดิมของระบบ
export const validateQuantityOrNull = (value, fieldName, { allowNull = true } = {}) => {
  if (value === null || value === undefined || value === '') {
    if (allowNull) return null;
    throw createReceivingError('VALIDATION_FAILED', `กรุณาระบุ ${fieldName}`);
  }
  const num = toFiniteNumberOrNull(value);
  if (num === null || num < 0 || num > MAX_QUANTITY_VALUE) {
    throw createReceivingError('VALIDATION_FAILED', `ค่า ${fieldName} ไม่ถูกต้องหรือเกินขอบเขตที่กำหนด`);
  }
  const scaled100 = (num + Number.EPSILON) * 100;
  if (Math.abs(scaled100 - Math.round(scaled100)) > 1e-4) {
    throw createReceivingError(
      'VALIDATION_FAILED',
      `ค่า ${fieldName} รองรับทศนิยมไม่เกิน 2 ตำแหน่ง`
    );
  }
  return roundQty2(num);
};

// R2-8: ตรวจสอบ unit_multiplier และ match.confidence จาก PUT
export const validateUnitMultiplier = (value, fieldName = 'unit_multiplier') => {
  if (value === null || value === undefined || value === '') return 1;
  const num = toFiniteNumberOrNull(value);
  if (num === null || num <= 0 || num > MAX_UNIT_MULTIPLIER_VALUE) {
    throw createReceivingError(
      'VALIDATION_FAILED',
      `ค่า ${fieldName} ต้องมากกว่า 0 และไม่เกิน ${MAX_UNIT_MULTIPLIER_VALUE}`
    );
  }
  return Math.round((num + Number.EPSILON) * 10000) / 10000;
};

export const validateConfidenceOrNull = (value, fieldName = 'confidence') => {
  if (value === null || value === undefined || value === '') return null;
  const num = toFiniteNumberOrNull(value);
  if (num === null || num < 0 || num > 1) {
    throw createReceivingError(
      'VALIDATION_FAILED',
      `ค่า ${fieldName} ต้องอยู่ระหว่าง 0 ถึง 1`
    );
  }
  return Math.round((num + Number.EPSILON) * 10000) / 10000;
};

export const formatMoney = (value) => {
  const satang = toSatangInt(value);
  if (satang === null) return null;
  return (satang / 100).toFixed(2);
};

export const formatQuantity = (value, { allowNull = true } = {}) => {
  const rounded = roundQty2(value);
  if (rounded === null) return allowNull ? null : '0';
  if (rounded === 0) return '0';
  return rounded.toFixed(2).replace(/\.?0+$/, '');
};

export const computeBaseUnitPrice = ({
  unitPrice = null,
  amount = null,
  quantityBilled = null,
  quantityReceived = null,
  unitMultiplier = 1
} = {}) => {
  const price = toFiniteNumberOrNull(unitPrice);
  const amt = toFiniteNumberOrNull(amount);
  const qtyBilled = toFiniteNumberOrNull(quantityBilled);
  const qtyRec = toFiniteNumberOrNull(quantityReceived);
  const mult = toFiniteNumberOrNull(unitMultiplier);
  const effectiveMultiplier = mult !== null && mult > 0 ? mult : 1;

  if (price !== null) {
    if (effectiveMultiplier !== 1) {
      return Math.round((price / effectiveMultiplier + Number.EPSILON) * 1000000) / 1000000;
    }
    if (
      qtyBilled !== null &&
      qtyBilled > 0 &&
      qtyRec !== null &&
      qtyRec > qtyBilled &&
      Math.abs(qtyRec / qtyBilled - Math.round(qtyRec / qtyBilled)) < 0.0001
    ) {
      const inferredMult = Math.round(qtyRec / qtyBilled);
      if (inferredMult >= 2 && amt !== null && Math.abs(qtyBilled * price - amt) <= 1) {
        return Math.round((price / inferredMult + Number.EPSILON) * 1000000) / 1000000;
      }
    }
    return Math.round((price + Number.EPSILON) * 1000000) / 1000000;
  }

  if (amt !== null && qtyRec !== null && qtyRec > 0) {
    return Math.round((amt / qtyRec + Number.EPSILON) * 1000000) / 1000000;
  }

  return null;
};

export const normalizeMatchText = (value) =>
  String(value || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\(\s*ญ\.?\s*\)/g, ' ใหญ่ ')
    .replace(/[()[\]{}"'`.,/#!$%^&*;:{}=\-_~@+?<>|\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Supplier's own printed item/product code (not a tax id, phone or bank number). Short, alphanumeric,
// compared case-insensitively. 9+ consecutive digits look like a phone/tax/bank number and are rejected.
export const MAX_ITEM_CODE_LENGTH = 40;
// A long digit-only code (e.g. SD Guthrie "3100003525") is kept only when accounting taught it for that shop
// (`taught`), or through normalizeTaughtItemCode when accounting enters it. Phone, tax-id and dashed
// bank-account shapes are never accepted.
export const looksLikeProtectedNumber = code => {
  const digits = String(code || '').replace(/[-.\/_]/g, '');
  return /^\d{13}$/.test(digits) || /^0[689]\d{8}$/.test(digits) || /^0[2-7]\d{7}$/.test(digits)
    || (/[-]/.test(code) && /^\d{10,12}$/.test(digits));
};
export const normalizeItemCode = (value, { taught = null } = {}) => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) value = String(value);
  if (typeof value !== 'string') return null;
  const code = value.normalize('NFC').replace(/\s+/g, '').toUpperCase();
  if (!code || code.length > MAX_ITEM_CODE_LENGTH) return null;
  if (!/^[A-Z0-9][A-Z0-9._\/-]*$/.test(code)) return null;
  if (/\d{9,}/.test(code.replace(/[-.\/_]/g, ''))) return taught?.has?.(code) && !looksLikeProtectedNumber(code) ? code : null;
  return code;
};
export const normalizeTaughtItemCode = (value) => {
  const code = normalizeItemCode(value);
  if (code) return code;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value).normalize('NFC').replace(/\s+/g, '').toUpperCase();
  return /^(?:[A-Z]{1,4}[-.]?)?\d{9,20}$/.test(raw) && !looksLikeProtectedNumber(raw.replace(/^[A-Z]{1,4}[-.]?/, '')) ? raw : null;
};

export const buildSupplierKey = ({
  supplierMasterId = null,
  productGroupId = null,
  supplierNameText = ''
} = {}) => {
  const smId = Number(supplierMasterId);
  if (Number.isFinite(smId) && smId > 0) return `sm:${Math.trunc(smId)}`;
  const pgId = Number(productGroupId);
  if (Number.isFinite(pgId) && pgId > 0) return `pg:${Math.trunc(pgId)}`;
  const normalizedName = normalizeMatchText(supplierNameText);
  if (normalizedName) return `name:${normalizedName.slice(0, 90)}`;
  return 'none';
};

const normalizeUnanchoredBillDate = (value) => {
  const raw = String(value instanceof Date ? toBangkokDateKey(value) : value ?? '').trim();
  if (!raw) return null;

  let year;
  let month;
  let day;

  const isoMatch = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else {
    const dmy4Match = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (dmy4Match) {
      day = Number(dmy4Match[1]);
      month = Number(dmy4Match[2]);
      year = Number(dmy4Match[3]);
    } else {
      const dmy2Match = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2})$/);
      if (!dmy2Match) return null;
      day = Number(dmy2Match[1]);
      month = Number(dmy2Match[2]);
      const yy = Number(dmy2Match[3]);
      year = yy >= 40 ? 2500 + yy - 543 : 2000 + yy;
    }
  }

  if (year >= 2400) year -= 543;
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;

  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() + 1 !== month ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

// Calendar-day arithmetic only: never infer a bill year from the machine clock.
export const normalizeBillDate = (value, { deliveryDate } = {}) => {
  const normalized = normalizeUnanchoredBillDate(value);
  if (deliveryDate === undefined) return normalized;
  const delivery = normalizeUnanchoredBillDate(deliveryDate);
  if (!delivery) return null;
  const anchor = Date.parse(`${delivery}T00:00:00Z`);
  const inWindow = (date) => {
    if (!date) return false;
    const days = (Date.parse(`${date}T00:00:00Z`) - anchor) / 86400000;
    return days >= -180 && days <= 7;
  };
  if (inWindow(normalized)) return normalized;

  const raw = String(value ?? '').trim();
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2}|\d{4}))?$/);
  if (!iso && !dmy) return null;
  const yearText = iso ? iso[1] : dmy[3];
  const month = Number(iso ? iso[2] : dmy[2]);
  const day = Number(iso ? iso[3] : dmy[1]);
  const deliveryYear = Number(delivery.slice(0, 4));
  const candidates = new Set();
  const addYear = (year) => {
    // Validate the actual calendar date, including leap days, before comparing.
    const date = normalizeUnanchoredBillDate(`${year}-${month}-${day}`);
    if (inWindow(date)) candidates.add(date);
  };
  if (!yearText) {
    for (const year of [deliveryYear - 1, deliveryYear, deliveryYear + 1]) addYear(year);
  } else if (yearText.length === 2 || /^(19|20)\d{2}$/.test(yearText)) {
    // Recover BE short years misexpanded as 19xx/20xx, preserving both digits.
    // 2069/1969 -> 2569 -> 2026; 2009 -> 2509 -> 1966, never 2026.
    const century = Math.floor((deliveryYear + 543) / 100) * 100;
    for (const offset of [-100, 0, 100]) addYear(century + offset + Number(yearText.slice(-2)) - 543);
  }
  return candidates.size === 1 ? [...candidates][0] : null;
};

export const clampConfidence = (value) => {
  const num = toFiniteNumberOrNull(value);
  if (num === null) return null;
  if (num < 0) return 0;
  if (num > 1 && num <= 100) {
    return Math.round((num / 100) * 10000) / 10000;
  }
  return Math.max(0, Math.min(1, Math.round(num * 10000) / 10000));
};

// Billing statements (ใบวางบิล / ใบรับวางบิล / period summaries) are not delivery notes.
const STATEMENT_VENDOR_RE = /(?:บริษัท|บจก\.?)\s*โซลาว|solao\s+co\b/i;
const STATEMENT_TEXT_RE = /วางบิล|bill\s*acceptance/i;
const STATEMENT_RANGE_RE = /รับสินค้า\s*วันที่\s*\d{1,2}\s*[-–]\s*\d{1,2}/;
const STATEMENT_INVOICE_REF_RE = /^\s*(?:PU|SI|AR|ED|PB)[-\s]?\d{4,}/i;

const textOf = (value) => (typeof value === 'string' ? value : '');

// Returns why the payload is a statement ('doc_kind' | 'solao_header' | 'statement_text' |
// 'period_summary' | 'invoice_list') or null. Safety net for providers that say "bill".
export const detectBillingStatement = (source = {}, rawLines = []) => {
  if (source.doc_kind === 'statement') return 'doc_kind';
  const vendors = [source.supplier_name, source.vendor, source.vendor_name, source.shop_name].map(textOf);
  if (vendors.some((text) => STATEMENT_VENDOR_RE.test(text))) return 'solao_header';
  const headers = [source.doc_title, source.title, source.doc_ref, ...vendors].map(textOf);
  const lineTexts = rawLines.map((item) => textOf(item?.bill_text ?? item?.text));
  if ([...headers, ...lineTexts].some((text) => STATEMENT_TEXT_RE.test(text))) return 'statement_text';
  if (rawLines.length === 1 && STATEMENT_RANGE_RE.test(lineTexts[0])) return 'period_summary';
  if (rawLines.length >= 2 && lineTexts.every((text) => STATEMENT_INVOICE_REF_RE.test(text))) return 'invoice_list';
  return null;
};

// Discount rows are printed as negative price/amount (e.g. "ลด 26.-", qty 4, price -24.30).
const isDiscountRawLine = (item) => {
  if (!item || typeof item !== 'object') return false;
  const price = toFiniteNumberOrNull(item.unit_price ?? item.price);
  const amount = toFiniteNumberOrNull(item.amount ?? item.line_total ?? item.total);
  if ((price !== null && price < 0) || (amount !== null && amount < 0)) return true;
  return /^\s*(?:ส่วนลด|ลดราคา|discount)/i.test(textOf(item.bill_text ?? item.text));
};

const discountLineOf = (item) => {
  const qty = toFiniteNumberOrNull(item.quantity_billed ?? item.quantity ?? item.qty);
  const price = toFiniteNumberOrNull(item.unit_price ?? item.price);
  const amount = toFiniteNumberOrNull(item.amount ?? item.line_total ?? item.total);
  let satang = null;
  if (amount !== null) satang = Math.abs(toSatangInt(amount));
  else if (qty !== null && price !== null) satang = Number(ocrLineAmountSatang(Math.abs(qty), Math.abs(price)));
  if (satang !== null && satang / 100 > MAX_MONEY_VALUE) satang = null;
  return { kind: 'discount', bill_text: (receiptText(item.bill_text ?? item.text, 500) || '').slice(0, 500),
    amount: satang === null ? null : fromSatangInt(satang) };
};

// R2-9: clamp line_no <= MAX_OCR_LINES และจัดเลขลำดับบรรทัดใหม่ 1..N เสมอ
export const normalizeOcrPayload = (raw = {}, modelName = null, { marketOrder = false, deliveryDate, billRefPattern = null, taughtItemCodes = null } = {}) => {
  const source = raw && typeof raw === 'object' ? raw : {};
  const rawLinesAll = Array.isArray(source.lines)
    ? source.lines
    : Array.isArray(source.items)
      ? source.items
      : [];

  let schemaWarningTriggered = false;
  const docKinds = ['bill', 'slip', 'other', 'statement', 'unknown'];
  const statementReason = detectBillingStatement(source, rawLinesAll);
  const docKind = statementReason ? 'statement' : docKinds.includes(source.doc_kind) ? source.doc_kind : 'unknown';
  if (source.doc_kind != null && !docKinds.includes(source.doc_kind)) schemaWarningTriggered = true;
  if (rawLinesAll.length > MAX_OCR_LINES) {
    schemaWarningTriggered = true;
  }
  // Statements never produce bill lines; discount rows are folded into the bill discount instead.
  const rawLines = statementReason ? [] : rawLinesAll.filter((item) => !isDiscountRawLine(item)).slice(0, MAX_OCR_LINES);
  const discountRaw = statementReason ? [] : rawLinesAll.filter(isDiscountRawLine);
  const discountRawCount = discountRaw.length;
  const discountLines = discountRaw.slice(0, MAX_OCR_LINES).map(discountLineOf);

  const sanitizeOcrNumber = (val, maxLimit) => {
    if (val === null || val === undefined || val === '') return null;
    const num = toFiniteNumberOrNull(val);
    if (num === null || num < 0 || num > maxLimit) {
      schemaWarningTriggered = true;
      return null;
    }
    return num;
  };

  const fieldConfidence =
    source.field_confidence && typeof source.field_confidence === 'object'
      ? {
          supplier_name: clampConfidence(
            source.field_confidence.supplier_name ?? source.field_confidence.vendor
          ),
          doc_ref: clampConfidence(source.field_confidence.doc_ref),
          doc_date: clampConfidence(source.field_confidence.doc_date),
          subtotal: clampConfidence(source.field_confidence.subtotal),
          discount: clampConfidence(source.field_confidence.discount),
          vat: clampConfidence(source.field_confidence.vat),
          total: clampConfidence(source.field_confidence.total)
        }
      : {};

  const filteredLines = rawLines
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const rawLineNo = Number(item.line_no);
      if (
        item.line_no !== undefined &&
        item.line_no !== null &&
        (!Number.isSafeInteger(rawLineNo) || rawLineNo <= 0 || rawLineNo > MAX_OCR_LINES)
      ) {
        schemaWarningTriggered = true;
      }

      const rawBillText = receiptText(item.bill_text ?? item.text, 501) || '';
      if (rawBillText.length > 500) schemaWarningTriggered = true;
      const billText = rawBillText.slice(0, 500);

      const rawUnitText = receiptText(item.unit_text ?? item.unit, 101) || '';
      if (rawUnitText.length > 100) schemaWarningTriggered = true;
      const unitText = rawUnitText ? rawUnitText.slice(0, 100) : null;

      let lineHadInvalidNumber = false;
      const rawQty = item.quantity_billed ?? item.quantity ?? item.qty;
      const rawPrice = item.unit_price ?? item.price;
      const rawAmt = item.amount ?? item.line_total ?? item.total;

      let qty = sanitizeOcrNumber(rawQty, MAX_QUANTITY_VALUE);
      let unitPrice = sanitizeOcrNumber(rawPrice, MAX_UNIT_PRICE_VALUE);
      let amount = sanitizeOcrNumber(rawAmt, MAX_MONEY_VALUE);

      if (
        (rawQty != null && rawQty !== '' && qty === null) ||
        (rawPrice != null && rawPrice !== '' && unitPrice === null) ||
        (rawAmt != null && rawAmt !== '' && amount === null)
      ) {
        lineHadInvalidNumber = true;
      }

      if (qty !== null) qty = roundQty2(qty);
      if (unitPrice !== null) {
        unitPrice = Math.round((unitPrice + Number.EPSILON) * 1000000) / 1000000;
      }
      if (amount !== null) amount = fromSatangInt(toSatangInt(amount));

      // Shops round or drop satang on a line (CNF 8.15 x 255 = 2,078.25 printed 2,078.00): under 1 baht is not a mismatch.
      // Only a whole-baht printed amount equal to the computed amount rounded or with satang dropped is accepted.
      const computedSatang = qty !== null && unitPrice !== null && amount !== null ? ocrLineAmountSatang(qty, unitPrice) : null;
      const printedSatang = amount !== null ? BigInt(toSatangInt(amount)) : null;
      const wholeBahtOk = computedSatang !== null && printedSatang % 100n === 0n &&
        (printedSatang === (computedSatang / 100n) * 100n || printedSatang === ((computedSatang + 50n) / 100n) * 100n);
      const amountMismatch = computedSatang !== null && computedSatang !== printedSatang && !wholeBahtOk;
      const billRead = { quantity_billed: qty, unit_price: unitPrice, amount };
      const missingMarketPrice = marketOrder && unitPrice === null && amount === null;
      if (missingMarketPrice) qty = 0;

      if (!lineHadInvalidNumber && !missingMarketPrice) {
        if (amount === null && qty !== null && unitPrice !== null) {
          const computedAmt = fromSatangInt(toSatangInt(qty * unitPrice));
          if (computedAmt !== null && computedAmt <= MAX_MONEY_VALUE) {
            amount = computedAmt;
          }
        } else if (unitPrice === null && qty !== null && qty > 0 && amount !== null) {
          unitPrice = Math.round((amount / qty + Number.EPSILON) * 1000000) / 1000000;
        } else if (qty === null && unitPrice !== null && unitPrice > 0 && amount !== null) {
          const computedQty = roundQty2(amount / unitPrice);
          if (computedQty !== null && computedQty <= MAX_QUANTITY_VALUE) {
            qty = computedQty;
          }
        }
      }

      const lineFieldConf =
        item.field_confidence && typeof item.field_confidence === 'object'
          ? {
              bill_text: clampConfidence(
                item.field_confidence.bill_text ?? item.field_confidence.text
              ),
              quantity_billed: clampConfidence(
                item.field_confidence.quantity_billed ?? item.field_confidence.quantity
              ),
              unit_text: clampConfidence(
                item.field_confidence.unit_text ?? item.field_confidence.unit
              ),
              unit_price: clampConfidence(item.field_confidence.unit_price),
              amount: clampConfidence(item.field_confidence.amount)
            }
          : null;

      const lineConfCandidates = [
        clampConfidence(item.confidence),
        ...(lineFieldConf ? Object.values(lineFieldConf).filter((v) => v !== null) : [])
      ].filter((v) => v !== null);

      let lineConfidence =
        lineConfCandidates.length > 0
          ? Math.round(
              (lineConfCandidates.reduce((sum, v) => sum + v, 0) / lineConfCandidates.length) *
                10000
            ) / 10000
          : null;

      if (lineHadInvalidNumber || missingMarketPrice || amountMismatch) {
        lineConfidence = lineConfidence !== null ? Math.min(lineConfidence, 0.4) : 0.4;
      }

      return {
        bill_text: billText,
        bill_read: billRead,
        flags: amountMismatch ? ['LINE_AMOUNT_MISMATCH'] : [],
        item_code: normalizeItemCode(item.item_code, { taught: taughtItemCodes }),
        suggested_product_name: receiptText(item.suggested_product_name),
        suggestion_reason: receiptText(item.suggestion_reason),
        quantity_billed: qty,
        unit_text: unitText,
        unit_price: unitPrice,
        amount,
        confidence: lineConfidence,
        field_confidence: lineFieldConf
      };
    })
    .filter((line) => line && (line.bill_text || line.amount !== null || line.quantity_billed !== null));

  // R2-9: จัดเลข line_no ใหม่เป็น 1..N (ไม่เกิน MAX_OCR_LINES)
  const normalizedLines = filteredLines.slice(0, MAX_OCR_LINES).map((line, index) => ({
    line_no: index + 1,
    ...line
  }));

  const clampHeaderMoney = (val) => {
    const n = sanitizeOcrNumber(val, MAX_MONEY_VALUE);
    return n !== null ? fromSatangInt(toSatangInt(n)) : null;
  };

  let subtotal = statementReason ? null : clampHeaderMoney(source.subtotal ?? source.sub_total);
  let discount = statementReason ? null : clampHeaderMoney(source.discount);
  const vat = statementReason ? null : clampHeaderMoney(source.vat ?? source.tax);
  const total = statementReason ? null : clampHeaderMoney(source.total ?? source.grand_total ?? source.net_total);
  // Printed discount rows only fill a missing header discount (never added on top of it).
  const discountLinesSatang = discountLines.reduce((sum, line) => sum + (toSatangInt(line.amount) ?? 0), 0);
  if (discount === null && discountLinesSatang > 0) discount = fromSatangInt(discountLinesSatang);
  // Owner 2026-10-22 (ไทยน้ำทิพย์: a "-24.30" discount row under each item): the model reports subtotal
  // sometimes before and sometimes after those rows. When the subtotal (or, without one, the total less
  // VAT) equals the item rows less the discount rows, restate it as the pre-discount item sum.
  if (discountLinesSatang > 0 && !statementReason) {
    const itemSum = normalizedLines.reduce((sum, line) => sum + (toSatangInt(line.amount) ?? 0), 0);
    const afterDiscount = itemSum - discountLinesSatang;
    const near = (a, b) => a !== null && Math.abs(a - b) <= 100;
    const subtotalSatang = subtotal === null ? null : toSatangInt(subtotal);
    const netOfVat = total === null ? null : toSatangInt(total) - (vat === null ? 0 : toSatangInt(vat));
    if (near(subtotalSatang, afterDiscount) || (subtotal === null && near(netOfVat, afterDiscount))) {
      subtotal = fromSatangInt(itemSum);
      if (discount === null || near(toSatangInt(discount), discountLinesSatang) || toSatangInt(discount) === 0) discount = fromSatangInt(discountLinesSatang);
    }
  }

  let overallConfidence = clampConfidence(source.overall_confidence ?? source.confidence);
  if (overallConfidence === null) {
    const confValues = [
      ...Object.values(fieldConfidence).filter((v) => v !== null),
      ...normalizedLines.map((l) => l.confidence).filter((v) => v !== null)
    ];
    if (confValues.length > 0) {
      overallConfidence =
        Math.round((confValues.reduce((sum, v) => sum + v, 0) / confValues.length) * 10000) /
        10000;
    }
  }
  if (schemaWarningTriggered) {
    overallConfidence = overallConfidence !== null ? Math.min(overallConfidence, 0.5) : 0.5;
  }
  const { warningCodes } = computeDocumentWarnings({
    document: { subtotal, discount, vat, total },
    lines: normalizedLines
  });
  if ([subtotal, discount, vat, total].every(value => value !== null) &&
      toSatangInt(subtotal) - toSatangInt(discount) + toSatangInt(vat) !== toSatangInt(total)) {
    warningCodes.push('BILL_TOTAL_MISMATCH');
  }
  if (normalizedLines.some(line => line.flags.includes('LINE_AMOUNT_MISMATCH'))) {
    warningCodes.push('LINE_AMOUNT_MISMATCH');
  }
  const reportedSumMismatch =
    Array.isArray(source.warnings) &&
    source.warnings.some(
      (warning) => (typeof warning === 'string' ? warning : warning?.code) === 'SUM_MISMATCH'
    );
  if (
    reportedSumMismatch ||
    warningCodes.includes('SUM_MISMATCH') ||
    warningCodes.includes('TOTAL_EQUATION_MISMATCH') ||
    warningCodes.includes('BILL_TOTAL_MISMATCH') || warningCodes.includes('LINE_AMOUNT_MISMATCH')
  ) {
    overallConfidence = Math.min(overallConfidence ?? 0.6, 0.6);
  }
  if (reportedSumMismatch && !warningCodes.includes('SUM_MISMATCH')) {
    warningCodes.push('SUM_MISMATCH');
  }
  if (
    overallConfidence !== null &&
    overallConfidence < DEFAULT_LOW_CONFIDENCE_THRESHOLD &&
    !warningCodes.includes('LOW_CONFIDENCE')
  ) {
    warningCodes.push('LOW_CONFIDENCE');
  }

  const unreadableLineCount = normalizedLines.filter((line) =>
    !line.bill_text || line.amount === null).length +
    (statementReason ? 0 : rawLinesAll.length - discountRawCount - filteredLines.length);
  const knownAmounts = normalizedLines.map((line) => toSatangInt(line.amount)).filter((n) => n !== null);
  const lineSumProposal = total === null && knownAmounts.length > 0
    ? formatMoney(knownAmounts.reduce((sum, n) => sum + n, 0) / 100) : null;
  if (total === null && normalizedLines.length > 0) warningCodes.push('TOTAL_MISSING_LINE_SUM');
  // Classifier uncertainty must not hide successfully extracted product rows.
  if (statementReason) warningCodes.push('BILL_IS_STATEMENT');
  else if (normalizedLines.length === 0) warningCodes.push('NOT_A_BILL');
  else if (docKind === 'slip' || docKind === 'other') warningCodes.push('DOC_KIND_UNCERTAIN');

  const rawSupplierName = statementReason ? '' :
    receiptText(source.supplier_name ?? source.vendor ?? source.vendor_name ?? source.shop_name) || '';
  const printedRef = source.doc_ref ?? source.invoice_no ?? source.bill_no;
  const rawDocRef = statementReason ? '' :
    billRefMatchingPattern(printedRef, billRefPattern) || receiptText(printedRef, 100, { reference: true }) || '';
  const supplierCode = statementReason ? null : receiptText(source.supplier_code, 50);
  const docDate = statementReason ? null : normalizeBillDate(source.doc_date ?? source.bill_date ?? source.date, { deliveryDate });
  if (!statementReason && deliveryDate !== undefined && !docDate) warningCodes.push('DOC_DATE_INVALID');

  return {
    supplier_code: supplierCode && /^[a-z][a-z0-9_-]{0,49}$/i.test(supplierCode) ? supplierCode : null,
    ship_to: receiptText(source.ship_to),
    addressee: receiptText(source.addressee),
    doc_kind: docKind,
    ...(statementReason ? { statement_reason: statementReason } : {}),
    discount_lines: discountLines,
    line_sum_proposal: lineSumProposal,
    unreadable_line_count: unreadableLineCount,
    supplier_name: rawSupplierName ? rawSupplierName.slice(0, 255) : null,
    doc_ref: rawDocRef ? rawDocRef.slice(0, 100) : null,
    doc_date: docDate,
    subtotal,
    discount,
    vat,
    total,
    model: String(modelName || source.model || DEFAULT_OCR_MODEL).slice(0, 100),
    confidence: overallConfidence,
    field_confidence: fieldConfidence,
    has_schema_warnings: schemaWarningTriggered,
    warnings: warningCodes.filter((code) =>
      ['BILL_TOTAL_MISMATCH', 'LINE_AMOUNT_MISMATCH', 'SUM_MISMATCH', 'TOTAL_EQUATION_MISMATCH', 'LOW_CONFIDENCE', 'TOTAL_MISSING_LINE_SUM', 'NOT_A_BILL', 'DOC_KIND_UNCERTAIN', 'DOC_DATE_INVALID', 'BILL_IS_STATEMENT'].includes(code)
    ),
    lines: normalizedLines
  };
};

export {
  BILL_OCR_JSON_SCHEMA,
  BILL_OCR_SYSTEM_PROMPT,
  extractBillWithVision,
  getCustomOcrProvider,
  setCustomOcrProvider
} from './receiving-ocr-provider.js';

export {
  checkOcrRateLimit,
  computeImagesContentHash,
  extractImageDimensions,
  getOcrRateBucketCount,
  isSupportedImageBuffer,
  parseImageDataUrl,
  resetOcrRateLimit
};

export {
  computeDocumentWarnings,
  computeTextSimilarity,
  matchOcrLinesToCatalog,
  mergeOcrLinesPreservingUserEdits
};
