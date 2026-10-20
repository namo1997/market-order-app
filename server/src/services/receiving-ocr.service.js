import { receiptText, ocrLineAmountSatang } from './receiving-ocr-checks.js';
export { billBranchMismatch } from './receiving-ocr-checks.js';
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

// R2-9: clamp line_no <= MAX_OCR_LINES และจัดเลขลำดับบรรทัดใหม่ 1..N เสมอ
export const normalizeOcrPayload = (raw = {}, modelName = null, { marketOrder = false, deliveryDate } = {}) => {
  const source = raw && typeof raw === 'object' ? raw : {};
  const rawLinesAll = Array.isArray(source.lines)
    ? source.lines
    : Array.isArray(source.items)
      ? source.items
      : [];

  let schemaWarningTriggered = false;
  const docKinds = ['bill', 'slip', 'other', 'unknown'];
  const docKind = docKinds.includes(source.doc_kind) ? source.doc_kind : 'unknown';
  if (source.doc_kind != null && !docKinds.includes(source.doc_kind)) schemaWarningTriggered = true;
  if (rawLinesAll.length > MAX_OCR_LINES) {
    schemaWarningTriggered = true;
  }
  const rawLines = rawLinesAll.slice(0, MAX_OCR_LINES);

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

      const amountMismatch = qty !== null && unitPrice !== null && amount !== null &&
        ocrLineAmountSatang(qty, unitPrice) !== BigInt(toSatangInt(amount));
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

  const subtotal = clampHeaderMoney(source.subtotal ?? source.sub_total);
  const discount = clampHeaderMoney(source.discount);
  const vat = clampHeaderMoney(source.vat ?? source.tax);
  const total = clampHeaderMoney(source.total ?? source.grand_total ?? source.net_total);

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
    !line.bill_text || line.amount === null).length + (rawLinesAll.length - filteredLines.length);
  const knownAmounts = normalizedLines.map((line) => toSatangInt(line.amount)).filter((n) => n !== null);
  const lineSumProposal = total === null && knownAmounts.length > 0
    ? formatMoney(knownAmounts.reduce((sum, n) => sum + n, 0) / 100) : null;
  if (total === null && normalizedLines.length > 0) warningCodes.push('TOTAL_MISSING_LINE_SUM');
  // Classifier uncertainty must not hide successfully extracted product rows.
  if (normalizedLines.length === 0) warningCodes.push('NOT_A_BILL');
  else if (docKind === 'slip' || docKind === 'other') warningCodes.push('DOC_KIND_UNCERTAIN');

  const rawSupplierName = receiptText(source.supplier_name ?? source.vendor ?? source.vendor_name ?? source.shop_name) || '';
  const rawDocRef = receiptText(source.doc_ref ?? source.invoice_no ?? source.bill_no, 100, { reference: true }) || '';
  const supplierCode = receiptText(source.supplier_code, 50);
  const docDate = normalizeBillDate(source.doc_date ?? source.bill_date ?? source.date, { deliveryDate });
  if (deliveryDate !== undefined && !docDate) warningCodes.push('DOC_DATE_INVALID');

  return {
    supplier_code: supplierCode && /^[a-z][a-z0-9_-]{0,49}$/i.test(supplierCode) ? supplierCode : null,
    ship_to: receiptText(source.ship_to),
    addressee: receiptText(source.addressee),
    doc_kind: docKind,
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
      ['BILL_TOTAL_MISMATCH', 'LINE_AMOUNT_MISMATCH', 'SUM_MISMATCH', 'TOTAL_EQUATION_MISMATCH', 'LOW_CONFIDENCE', 'TOTAL_MISSING_LINE_SUM', 'NOT_A_BILL', 'DOC_KIND_UNCERTAIN', 'DOC_DATE_INVALID'].includes(code)
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
