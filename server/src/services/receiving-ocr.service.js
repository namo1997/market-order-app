import crypto from 'node:crypto';

export const MAX_BILL_IMAGE_BYTES = 3 * 1024 * 1024; // 3 MB
export const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.75;
export const DEFAULT_PRICE_CHANGE_THRESHOLD = 0.15; // 15%
export const DEFAULT_SUM_MISMATCH_TOLERANCE = 1.0; // 1 บาท

export const ERROR_STATUS_BY_CODE = {
  VALIDATION_FAILED: 422,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  NOT_DRAFT: 409,
  SIGNATURE_REQUIRED: 422,
  OCR_UNAVAILABLE: 503,
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
  const cleaned = typeof value === 'string'
    ? value.replace(/[,\s฿]/g, '').replace(/บาท$/u, '').trim()
    : value;
  if (cleaned === '') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

export const formatMoney = (value) => {
  const num = toFiniteNumberOrNull(value);
  if (num === null) return null;
  return (Math.round((num + Number.EPSILON) * 100) / 100).toFixed(2);
};

export const formatQuantity = (value, { allowNull = true } = {}) => {
  const num = toFiniteNumberOrNull(value);
  if (num === null) {
    return allowNull ? null : '0';
  }
  const rounded = Math.round((num + Number.EPSILON) * 1000) / 1000;
  if (Math.abs(rounded) < 0.0000001) return '0';
  return rounded.toFixed(3).replace(/\.?0+$/, '');
};

export const normalizeMatchText = (value) =>
  String(value || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[()[\]{}"'`.,/#!$%^&*;:{}=\-_~@+?<>|\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const buildSupplierKey = ({
  supplierMasterId = null,
  productGroupId = null,
  supplierNameText = ''
} = {}) => {
  const smId = Number(supplierMasterId);
  if (Number.isFinite(smId) && smId > 0) {
    return `sm:${Math.trunc(smId)}`;
  }
  const pgId = Number(productGroupId);
  if (Number.isFinite(pgId) && pgId > 0) {
    return `pg:${Math.trunc(pgId)}`;
  }
  const normalizedName = normalizeMatchText(supplierNameText);
  if (normalizedName) {
    return `name:${normalizedName.slice(0, 90)}`;
  }
  return 'none';
};

export const normalizeBillDate = (value) => {
  const raw = String(value ?? '').trim();
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
    const dmyMatch = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (dmyMatch) {
      day = Number(dmyMatch[1]);
      month = Number(dmyMatch[2]);
      year = Number(dmyMatch[3]);
    } else {
      return null;
    }
  }

  // แปลงปี พ.ศ. เป็น ค.ศ.
  if (year >= 2400) {
    year -= 543;
  }

  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

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

export const extractImageDimensions = (buffer, mimeType) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) {
    return { width: null, height: null };
  }

  try {
    if (mimeType === 'image/png' && buffer.length >= 24) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return {
        width: width > 0 ? width : null,
        height: height > 0 ? height : null
      };
    }

    if (mimeType === 'image/webp' && buffer.length >= 30) {
      const chunkHeader = buffer.subarray(12, 16).toString('ascii');
      if (chunkHeader === 'VP8 ' && buffer.length >= 30) {
        const width = buffer.readUInt16LE(26) & 0x3fff;
        const height = buffer.readUInt16LE(28) & 0x3fff;
        return { width: width || null, height: height || null };
      }
      if (chunkHeader === 'VP8L' && buffer.length >= 25) {
        const b0 = buffer[21];
        const b1 = buffer[22];
        const b2 = buffer[23];
        const b3 = buffer[24];
        const width = 1 + (((b1 & 0x3f) << 8) | b0);
        const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
        return { width: width || null, height: height || null };
      }
      if (chunkHeader === 'VP8X' && buffer.length >= 30) {
        const width = 1 + buffer.readUIntLE(24, 3);
        const height = 1 + buffer.readUIntLE(27, 3);
        return { width: width || null, height: height || null };
      }
    }

    if (mimeType === 'image/jpeg') {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = buffer[offset + 1];
        if (marker === 0xff) {
          offset += 1;
          continue;
        }
        if (marker === 0xd8 || marker === 0xd9) {
          offset += 2;
          continue;
        }
        const length = buffer.readUInt16BE(offset + 2);
        if (length < 2 || offset + 2 + length > buffer.length) break;

        const isSofMarker =
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf);
        if (isSofMarker && offset + 9 <= buffer.length) {
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          return {
            width: width > 0 ? width : null,
            height: height > 0 ? height : null
          };
        }
        offset += 2 + length;
      }
    }
  } catch {
    // ignore header parse errors and return null dimensions
  }

  return { width: null, height: null };
};

export const isSupportedImageBuffer = (buffer, mimeType) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (mimeType === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === 'image/webp') {
    return (
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return false;
};

export const parseImageDataUrl = (
  imageDataUrl,
  {
    allowedMimes = ['image/jpeg', 'image/webp', 'image/png'],
    maxBytes = MAX_BILL_IMAGE_BYTES
  } = {}
) => {
  const raw = String(imageDataUrl || '').trim();
  if (!raw) {
    throw createReceivingError('VALIDATION_FAILED', 'กรุณาระบุข้อมูลรูปภาพ (image_data_url)');
  }

  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) {
    throw createReceivingError('VALIDATION_FAILED', 'รูปแบบ image_data_url ไม่ถูกต้อง');
  }

  const mimeType = match[1].toLowerCase();
  if (!allowedMimes.includes(mimeType)) {
    throw createReceivingError(
      'VALIDATION_FAILED',
      `รองรับเฉพาะไฟล์รูปภาพชนิด ${allowedMimes.join(', ')}`
    );
  }

  const base64Payload = match[2].replace(/\s+/g, '');
  const estimatedBytes = Math.floor((base64Payload.length * 3) / 4);
  if (estimatedBytes > maxBytes + 1024) {
    throw createReceivingError('IMAGE_TOO_LARGE', 'ขนาดรูปภาพเกิน 3 MB กรุณาย่อรูปก่อนส่ง');
  }

  const buffer = Buffer.from(base64Payload, 'base64');
  if (buffer.length > maxBytes) {
    throw createReceivingError('IMAGE_TOO_LARGE', 'ขนาดรูปภาพเกิน 3 MB กรุณาย่อรูปก่อนส่ง');
  }

  if (!isSupportedImageBuffer(buffer, mimeType)) {
    throw createReceivingError('VALIDATION_FAILED', 'ข้อมูลไฟล์รูปภาพไม่ถูกต้องหรือเสียหาย');
  }

  const { width, height } = extractImageDimensions(buffer, mimeType);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    mimeType,
    buffer,
    sizeBytes: buffer.length,
    width,
    height,
    sha256
  };
};

const clampConfidence = (value) => {
  const num = toFiniteNumberOrNull(value);
  if (num === null) return null;
  if (num > 1 && num <= 100) {
    return Math.round((num / 100) * 10000) / 10000;
  }
  return Math.max(0, Math.min(1, Math.round(num * 10000) / 10000));
};

export const normalizeOcrPayload = (raw = {}, modelName = null) => {
  const source = raw && typeof raw === 'object' ? raw : {};
  const rawLines = Array.isArray(source.lines)
    ? source.lines
    : Array.isArray(source.items)
      ? source.items
      : [];

  const fieldConfidence =
    source.field_confidence && typeof source.field_confidence === 'object'
      ? {
          supplier_name: clampConfidence(source.field_confidence.supplier_name),
          doc_ref: clampConfidence(source.field_confidence.doc_ref),
          doc_date: clampConfidence(source.field_confidence.doc_date),
          subtotal: clampConfidence(source.field_confidence.subtotal),
          discount: clampConfidence(source.field_confidence.discount),
          vat: clampConfidence(source.field_confidence.vat),
          total: clampConfidence(source.field_confidence.total)
        }
      : {};

  const normalizedLines = rawLines
    .map((item, idx) => {
      if (!item || typeof item !== 'object') return null;
      const billText = String(
        item.bill_text ?? item.name ?? item.description ?? item.product_name ?? ''
      ).trim();
      let qty = toFiniteNumberOrNull(item.quantity_billed ?? item.quantity ?? item.qty);
      let unitPrice = toFiniteNumberOrNull(item.unit_price ?? item.price);
      let amount = toFiniteNumberOrNull(item.amount ?? item.line_total ?? item.total);

      if (amount === null && qty !== null && unitPrice !== null) {
        amount = Math.round((qty * unitPrice + Number.EPSILON) * 100) / 100;
      } else if (unitPrice === null && qty !== null && qty > 0 && amount !== null) {
        unitPrice = Math.round((amount / qty + Number.EPSILON) * 100) / 100;
      } else if (qty === null && unitPrice !== null && unitPrice > 0 && amount !== null) {
        qty = Math.round((amount / unitPrice + Number.EPSILON) * 1000) / 1000;
      }

      const lineFieldConf =
        item.field_confidence && typeof item.field_confidence === 'object'
          ? {
              bill_text: clampConfidence(item.field_confidence.bill_text),
              quantity_billed: clampConfidence(item.field_confidence.quantity_billed),
              unit_text: clampConfidence(item.field_confidence.unit_text),
              unit_price: clampConfidence(item.field_confidence.unit_price),
              amount: clampConfidence(item.field_confidence.amount)
            }
          : null;

      const lineConfCandidates = [
        clampConfidence(item.confidence),
        ...(lineFieldConf ? Object.values(lineFieldConf).filter((v) => v !== null) : [])
      ].filter((v) => v !== null);

      const lineConfidence =
        lineConfCandidates.length > 0
          ? Math.round(
              (lineConfCandidates.reduce((sum, v) => sum + v, 0) / lineConfCandidates.length) *
                10000
            ) / 10000
          : null;

      return {
        line_no: Number.isFinite(Number(item.line_no)) && Number(item.line_no) > 0
          ? Math.trunc(Number(item.line_no))
          : idx + 1,
        bill_text: billText,
        quantity_billed: qty,
        unit_text: String(item.unit_text ?? item.unit ?? '').trim() || null,
        unit_price: unitPrice,
        amount,
        confidence: lineConfidence,
        field_confidence: lineFieldConf
      };
    })
    .filter((line) => line && (line.bill_text || line.amount !== null || line.quantity_billed !== null));

  const subtotal = toFiniteNumberOrNull(source.subtotal ?? source.sub_total);
  const discount = toFiniteNumberOrNull(source.discount);
  const vat = toFiniteNumberOrNull(source.vat ?? source.tax);
  const total = toFiniteNumberOrNull(source.total ?? source.grand_total ?? source.net_total);

  let overallConfidence = clampConfidence(source.confidence);
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

  return {
    supplier_name: String(source.supplier_name ?? source.vendor_name ?? source.shop_name ?? '').trim() || null,
    doc_ref: String(source.doc_ref ?? source.invoice_no ?? source.bill_no ?? '').trim() || null,
    doc_date: normalizeBillDate(source.doc_date ?? source.bill_date ?? source.date),
    subtotal,
    discount,
    vat,
    total,
    model: modelName || source.model || null,
    confidence: overallConfidence,
    field_confidence: fieldConfidence,
    lines: normalizedLines
  };
};

let customOcrProvider = null;

export const setCustomOcrProvider = (providerFn) => {
  customOcrProvider = typeof providerFn === 'function' ? providerFn : null;
};

export const getCustomOcrProvider = () => customOcrProvider;

export const BILL_OCR_SYSTEM_PROMPT = `
คุณคือระบบอ่านบิลรับสินค้าสำหรับร้านอาหารและตลาดสด
อ่านรูปบิลทุกหน้าแล้วสกัดข้อมูลระดับหัวบิลและรายการสินค้าทีละบรรทัด ตอบเป็น JSON เท่านั้นตามโครงสร้างนี้:
{
  "supplier_name": "ชื่อร้านหรือซัพพลายเออร์ หรือ null",
  "doc_ref": "เลขที่บิล/ใบส่งของ/ใบเสร็จ หรือ null",
  "doc_date": "YYYY-MM-DD (ถ้าในบิลเป็น พ.ศ. ให้แปลงเป็น ค.ศ.) หรือ null",
  "subtotal": 0.00,
  "discount": 0.00,
  "vat": 0.00,
  "total": 0.00,
  "confidence": 0.95,
  "field_confidence": {
    "supplier_name": 0.95,
    "doc_ref": 0.95,
    "doc_date": 0.95,
    "subtotal": 0.95,
    "discount": 0.95,
    "vat": 0.95,
    "total": 0.95
  },
  "lines": [
    {
      "line_no": 1,
      "bill_text": "ชื่อสินค้าตามที่ปรากฏในบิล",
      "quantity_billed": 1,
      "unit_text": "หน่วยในบิล เช่น กก., ถุง, ลัง, แพ็ค",
      "unit_price": 100.00,
      "amount": 100.00,
      "confidence": 0.95,
      "field_confidence": {
        "bill_text": 0.95,
        "quantity_billed": 0.95,
        "unit_text": 0.95,
        "unit_price": 0.95,
        "amount": 0.95
      }
    }
  ]
}
กติกา:
- ห้ามแต่งตัวเลขที่ไม่มีในบิล ถ้าอ่านไม่ออกให้ใส่ null และลดค่า confidence ของช่องนั้นให้ต่ำลง (< 0.65)
- ถ้าบิลมีหลายหน้า ให้รวมรายการเรียงลำดับบรรทัดต่อเนื่องกัน
`.trim();

export const extractBillWithVision = async ({
  images = [],
  document = {},
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.RECEIVING_OCR_MODEL || process.env.OPENAI_OCR_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
  endpoint = process.env.OPENAI_ENDPOINT || 'https://api.openai.com/v1/chat/completions',
  fetchImpl = globalThis.fetch,
  timeoutMs = Number(process.env.RECEIVING_OCR_TIMEOUT_MS || 55000)
} = {}) => {
  if (customOcrProvider) {
    const customResult = await customOcrProvider({ images, document, model });
    return normalizeOcrPayload(customResult, customResult?.model || model);
  }

  const trimmedKey = String(apiKey || '').trim();
  if (!trimmedKey || typeof fetchImpl !== 'function') {
    throw createReceivingError(
      'OCR_UNAVAILABLE',
      'ระบบอ่านบิลยังไม่พร้อมใช้งานในขณะนี้'
    );
  }

  if (!Array.isArray(images) || images.length === 0) {
    throw createReceivingError(
      'VALIDATION_FAILED',
      'กรุณาอัปโหลดรูปบิลอย่างน้อย 1 หน้าก่อนเริ่มอ่านบิล'
    );
  }

  const sortedImages = [...images].sort((a, b) => Number(a.page_no || 0) - Number(b.page_no || 0));
  const userContent = [
    {
      type: 'text',
      text: `อ่านบิลรับสินค้าทั้งหมด ${sortedImages.length} หน้า และส่งคืนเฉพาะ JSON ตามโครงสร้างที่กำหนด`
    },
    ...sortedImages.map((img) => {
      const dataUrl = img.image_data_url
        ? img.image_data_url
        : `data:${img.mime_type || img.mime || 'image/jpeg'};base64,${Buffer.from(img.image_data).toString('base64')}`;
      return {
        type: 'image_url',
        image_url: {
          url: dataUrl,
          detail: 'high'
        }
      };
    })
  ];

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), Math.min(Math.max(1000, timeoutMs), 60000))
    : null;

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${trimmedKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: BILL_OCR_SYSTEM_PROMPT },
          { role: 'user', content: userContent }
        ]
      }),
      ...(controller ? { signal: controller.signal } : {})
    });
  } catch (networkError) {
    throw createReceivingError(
      'OCR_UNAVAILABLE',
      'ไม่สามารถเชื่อมต่อบริการอ่านบิลได้ กรุณาลองใหม่อีกครั้ง'
    );
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!response || !response.ok) {
    throw createReceivingError(
      'OCR_UNAVAILABLE',
      `บริการอ่านบิลตอบกลับไม่สำเร็จ (HTTP ${response?.status || 'unknown'})`
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw createReceivingError('OCR_UNAVAILABLE', 'ข้อมูลตอบกลับจากระบบอ่านบิลไม่ถูกต้อง');
  }

  const rawContent = String(payload?.choices?.[0]?.message?.content || '').trim();
  if (!rawContent) {
    throw createReceivingError('OCR_UNAVAILABLE', 'ระบบอ่านบิลไม่ส่งข้อมูลกลับมา');
  }

  const cleanedJson = rawContent
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleanedJson);
  } catch {
    throw createReceivingError('OCR_UNAVAILABLE', 'ไม่สามารถแปลงผลลัพธ์จากระบบอ่านบิลได้');
  }

  return normalizeOcrPayload(parsed, payload?.model || model);
};

export const computeTextSimilarity = (a, b) => {
  const normA = normalizeMatchText(a);
  const normB = normalizeMatchText(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;

  const compactA = normA.replace(/\s+/g, '');
  const compactB = normB.replace(/\s+/g, '');
  if (compactA === compactB) return 0.97;

  if (compactA.length >= 2 && compactB.length >= 2) {
    if (compactA.includes(compactB) || compactB.includes(compactA)) {
      const minLen = Math.min(compactA.length, compactB.length);
      const maxLen = Math.max(compactA.length, compactB.length);
      return Math.max(0.75, Math.min(0.93, 0.72 + (minLen / maxLen) * 0.22));
    }
  }

  const tokensA = new Set(normA.split(' ').filter(Boolean));
  const tokensB = new Set(normB.split(' ').filter(Boolean));
  if (tokensA.size > 0 && tokensB.size > 0) {
    let intersection = 0;
    for (const token of tokensA) {
      if (tokensB.has(token)) intersection += 1;
    }
    if (intersection > 0) {
      const union = new Set([...tokensA, ...tokensB]).size;
      return intersection / union;
    }
  }

  // Bigram Dice coefficient for Thai strings without spaces
  if (compactA.length >= 2 && compactB.length >= 2) {
    const bigramsA = new Map();
    for (let i = 0; i < compactA.length - 1; i += 1) {
      const bg = compactA.slice(i, i + 2);
      bigramsA.set(bg, (bigramsA.get(bg) || 0) + 1);
    }
    let overlap = 0;
    for (let i = 0; i < compactB.length - 1; i += 1) {
      const bg = compactB.slice(i, i + 2);
      const count = bigramsA.get(bg) || 0;
      if (count > 0) {
        overlap += 1;
        bigramsA.set(bg, count - 1);
      }
    }
    return (2 * overlap) / (compactA.length - 1 + (compactB.length - 1));
  }

  return 0;
};

const resolveUnitByText = (unitText, units = []) => {
  const normUnit = normalizeMatchText(unitText);
  if (!normUnit) return null;
  for (const unit of units) {
    if (
      normalizeMatchText(unit.name) === normUnit ||
      normalizeMatchText(unit.abbreviation) === normUnit
    ) {
      return unit;
    }
  }
  return null;
};

export const matchOcrLinesToCatalog = ({
  ocrLines = [],
  aliases = [],
  expectedItems = [],
  products = [],
  units = [],
  supplierKey = 'none'
} = {}) => {
  const productById = new Map();
  for (const product of products) {
    productById.set(Number(product.id), product);
  }
  for (const item of expectedItems) {
    if (item.product_id && !productById.has(Number(item.product_id))) {
      productById.set(Number(item.product_id), {
        id: Number(item.product_id),
        name: item.product_name,
        unit_id: item.unit_id ?? null,
        unit_name: item.unit_name ?? null
      });
    }
  }

  const usedOrderItemIds = new Set();

  const findBestExpectedOrderItemForProduct = (productId) => {
    for (const item of expectedItems) {
      const orderItemId = Number(item.order_item_id);
      if (
        Number(item.product_id) === Number(productId) &&
        !usedOrderItemIds.has(orderItemId)
      ) {
        return item;
      }
    }
    return expectedItems.find((item) => Number(item.product_id) === Number(productId)) || null;
  };

  return ocrLines.map((line, index) => {
    const lineNo = Number.isFinite(Number(line.line_no)) && Number(line.line_no) > 0
      ? Math.trunc(Number(line.line_no))
      : index + 1;
    const billText = String(line.bill_text || '').trim();
    const normBill = normalizeMatchText(billText);
    const unitText = line.unit_text ? String(line.unit_text).trim() : null;
    const normUnit = normalizeMatchText(unitText);
    const quantityBilled = toFiniteNumberOrNull(line.quantity_billed);
    const unitPrice = toFiniteNumberOrNull(line.unit_price);
    const amount =
      toFiniteNumberOrNull(line.amount) ??
      (quantityBilled !== null && unitPrice !== null
        ? Math.round((quantityBilled * unitPrice + Number.EPSILON) * 100) / 100
        : null);

    // 1. ค้นหาจาก supplier_product_aliases ก่อน
    let bestAlias = null;
    let bestAliasScore = 0;

    for (const alias of aliases) {
      const aliasNormBill = alias.normalized_bill_text || normalizeMatchText(alias.bill_text);
      const aliasNormUnit = alias.normalized_unit_text ?? normalizeMatchText(alias.unit_text);
      const score = computeTextSimilarity(normBill, aliasNormBill);
      if (score < 0.84) continue;

      const sameSupplier =
        supplierKey !== 'none' &&
        alias.supplier_key &&
        alias.supplier_key === supplierKey;
      const sameUnit = !normUnit || !aliasNormUnit || normUnit === aliasNormUnit;
      const weightedScore =
        score + (sameSupplier ? 0.04 : 0) + (sameUnit ? 0.02 : -0.03);

      if (weightedScore > bestAliasScore) {
        bestAliasScore = weightedScore;
        bestAlias = { alias, rawScore: score };
      }
    }

    if (bestAlias) {
      const { alias, rawScore } = bestAlias;
      const productId = Number(alias.product_id);
      const product = productById.get(productId) || null;
      const expectedItem = findBestExpectedOrderItemForProduct(productId);
      if (expectedItem?.order_item_id) {
        usedOrderItemIds.add(Number(expectedItem.order_item_id));
      }

      const multiplierRaw = Number(alias.unit_multiplier || 1);
      const multiplier = Number.isFinite(multiplierRaw) && multiplierRaw > 0 ? multiplierRaw : 1;
      const baseQtyBilled = quantityBilled ?? (expectedItem ? toFiniteNumberOrNull(expectedItem.quantity_ordered) : 0) ?? 0;
      const qtyReceived = Math.round((baseQtyBilled * multiplier + Number.EPSILON) * 1000) / 1000;
      const matchedUnit = resolveUnitByText(unitText, units);
      const lineConf = clampConfidence(line.confidence);
      const matchConfidence = Math.min(
        1,
        Math.round(((lineConf !== null ? (rawScore * 0.7 + lineConf * 0.3) : rawScore * 0.98)) * 10000) / 10000
      );

      return {
        line_no: lineNo,
        bill_text: billText,
        product_id: productId,
        product_name:
          product?.name ||
          expectedItem?.product_name ||
          alias.product_name ||
          null,
        order_item_id: expectedItem ? Number(expectedItem.order_item_id) : null,
        unit_text: unitText || expectedItem?.unit_name || product?.unit_name || alias.unit_text || null,
        unit_id: alias.unit_id
          ? Number(alias.unit_id)
          : matchedUnit?.id
            ? Number(matchedUnit.id)
            : expectedItem?.unit_id
              ? Number(expectedItem.unit_id)
              : product?.unit_id
                ? Number(product.unit_id)
                : null,
        quantity_billed: quantityBilled,
        quantity_received: qtyReceived,
        unit_price: unitPrice,
        amount,
        match: {
          source: 'alias',
          confidence: matchConfidence
        }
      };
    }

    // 2. ค้นหาจากรายการใบสั่งของวันนี้ (expected order_items)
    let bestOrder = null;
    let bestOrderScore = 0;

    for (const item of expectedItems) {
      const score = computeTextSimilarity(normBill, item.product_name);
      if (score < 0.6) continue;
      const isUnused = !usedOrderItemIds.has(Number(item.order_item_id));
      const adjustedScore = score + (isUnused ? 0.03 : 0);
      if (adjustedScore > bestOrderScore) {
        bestOrderScore = adjustedScore;
        bestOrder = { item, rawScore: score };
      }
    }

    if (bestOrder) {
      const { item, rawScore } = bestOrder;
      usedOrderItemIds.add(Number(item.order_item_id));
      const matchedUnit = resolveUnitByText(unitText, units);
      const lineConf = clampConfidence(line.confidence);
      const matchConfidence = Math.min(
        1,
        Math.round(((lineConf !== null ? (rawScore * 0.7 + lineConf * 0.3) : rawScore * 0.95)) * 10000) / 10000
      );

      return {
        line_no: lineNo,
        bill_text: billText,
        product_id: Number(item.product_id),
        product_name: item.product_name || null,
        order_item_id: Number(item.order_item_id),
        unit_text: unitText || item.unit_name || null,
        unit_id: matchedUnit?.id
          ? Number(matchedUnit.id)
          : item.unit_id
            ? Number(item.unit_id)
            : null,
        quantity_billed: quantityBilled,
        quantity_received:
          quantityBilled !== null
            ? quantityBilled
            : toFiniteNumberOrNull(item.quantity_ordered) ?? 0,
        unit_price: unitPrice,
        amount,
        match: {
          source: 'order',
          confidence: matchConfidence
        }
      };
    }

    // 3. ไม่พบการจับคู่
    const matchedUnit = resolveUnitByText(unitText, units);
    return {
      line_no: lineNo,
      bill_text: billText,
      product_id: null,
      product_name: null,
      order_item_id: null,
      unit_text: unitText,
      unit_id: matchedUnit?.id ? Number(matchedUnit.id) : null,
      quantity_billed: quantityBilled,
      quantity_received: quantityBilled !== null ? quantityBilled : 0,
      unit_price: unitPrice,
      amount,
      match: {
        source: 'none',
        confidence: clampConfidence(line.confidence)
      }
    };
  });
};

export const mergeOcrLinesPreservingUserEdits = ({
  existingLines = [],
  newMatchedLines = []
} = {}) => {
  const userEditedByLineNo = new Map();
  const userEditedOrderItemIds = new Set();

  for (const existing of existingLines) {
    const isEdited =
      Boolean(existing.is_user_edited) || existing.match_source === 'manual' || existing.match?.source === 'manual';
    if (isEdited) {
      userEditedByLineNo.set(Number(existing.line_no), existing);
      if (existing.order_item_id) {
        userEditedOrderItemIds.add(Number(existing.order_item_id));
      }
    }
  }

  if (userEditedByLineNo.size === 0) {
    return newMatchedLines.map((line, index) => ({
      ...line,
      line_no: Number(line.line_no) || index + 1,
      is_user_edited: false
    }));
  }

  const merged = [];
  const handledLineNos = new Set();

  for (const ocrLine of newMatchedLines) {
    const lineNo = Number(ocrLine.line_no);
    if (userEditedByLineNo.has(lineNo)) {
      const preserved = userEditedByLineNo.get(lineNo);
      merged.push({
        ...preserved,
        is_user_edited: true
      });
      handledLineNos.add(lineNo);
      continue;
    }

    if (ocrLine.order_item_id && userEditedOrderItemIds.has(Number(ocrLine.order_item_id))) {
      continue;
    }

    merged.push({
      ...ocrLine,
      is_user_edited: false
    });
    handledLineNos.add(lineNo);
  }

  for (const [lineNo, preserved] of userEditedByLineNo.entries()) {
    if (!handledLineNos.has(lineNo)) {
      merged.push({
        ...preserved,
        is_user_edited: true
      });
    }
  }

  return merged.sort((a, b) => Number(a.line_no || 0) - Number(b.line_no || 0));
};

export const computeDocumentWarnings = ({
  document = {},
  lines = [],
  expectedItemsById = new Map(),
  latestPricesByProductId = new Map(),
  isDuplicateBill = false,
  lowConfidenceThreshold = DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  priceChangeThreshold = DEFAULT_PRICE_CHANGE_THRESHOLD,
  sumMismatchTolerance = DEFAULT_SUM_MISMATCH_TOLERANCE
} = {}) => {
  const warnings = [];
  const pushWarning = (code, message, lineNo = null) => {
    const normalizedLineNo = lineNo === null || lineNo === undefined ? null : Number(lineNo);
    const exists = warnings.some(
      (w) => w.code === code && w.line_no === normalizedLineNo
    );
    if (!exists) {
      warnings.push({
        code,
        message,
        line_no: normalizedLineNo
      });
    }
  };

  // 1. DUPLICATE_BILL
  if (isDuplicateBill) {
    pushWarning(
      'DUPLICATE_BILL',
      'พบบิลซ้ำในระบบ (ซัพพลายเออร์ เลขที่บิล และยอดรวมตรงกัน)',
      null
    );
  }

  // 2. LOW_CONFIDENCE (ระดับเอกสาร)
  const docConfidence = toFiniteNumberOrNull(
    document.ocr_confidence ?? document.ocr?.confidence
  );
  if (docConfidence !== null && docConfidence < lowConfidenceThreshold) {
    pushWarning(
      'LOW_CONFIDENCE',
      'ความมั่นใจในการอ่านบิลต่ำ กรุณาตรวจสอบข้อมูลทุกบรรทัด',
      null
    );
  }

  // 3. ตรวจรายบรรทัด + คำนวณผลรวมบรรทัด
  let sumLineAmounts = 0;
  let hasAnyLineAmount = false;

  for (const line of lines) {
    const lineNo = Number(line.line_no) || null;
    const productId = line.product_id ? Number(line.product_id) : null;
    const orderItemId = line.order_item_id ? Number(line.order_item_id) : null;
    const qtyBilled = toFiniteNumberOrNull(line.quantity_billed);
    const qtyReceived = toFiniteNumberOrNull(line.quantity_received) ?? 0;
    const unitPrice = toFiniteNumberOrNull(line.unit_price);
    const explicitAmount = toFiniteNumberOrNull(line.amount);
    const effectiveAmount =
      explicitAmount !== null
        ? explicitAmount
        : unitPrice !== null && (qtyBilled ?? qtyReceived) !== null
          ? (qtyBilled ?? qtyReceived) * unitPrice
          : null;

    if (effectiveAmount !== null) {
      sumLineAmounts += effectiveAmount;
      hasAnyLineAmount = true;
    }

    // UNMATCHED_LINE
    if (!productId) {
      pushWarning(
        'UNMATCHED_LINE',
        `บรรทัดที่ ${lineNo || '-'}: ยังไม่ได้จับคู่สินค้าในระบบ`,
        lineNo
      );
    }

    // LOW_CONFIDENCE (ระดับบรรทัด)
    const lineConfidence = toFiniteNumberOrNull(
      line.match_confidence ?? line.match?.confidence ?? line.confidence
    );
    if (lineConfidence !== null && lineConfidence < lowConfidenceThreshold) {
      pushWarning(
        'LOW_CONFIDENCE',
        `บรรทัดที่ ${lineNo || '-'}: ความมั่นใจในการอ่าน/จับคู่ต่ำ`,
        lineNo
      );
    }

    // PRICE_CHANGE (> 15% จากราคาล่าสุด)
    if (productId && unitPrice !== null && unitPrice > 0) {
      const refPrice = toFiniteNumberOrNull(latestPricesByProductId.get(productId));
      if (refPrice !== null && refPrice > 0) {
        const diffRatio = Math.abs(unitPrice - refPrice) / refPrice;
        if (diffRatio > priceChangeThreshold) {
          pushWarning(
            'PRICE_CHANGE',
            `บรรทัดที่ ${lineNo || '-'}: ราคาต่อหน่วย (${formatMoney(unitPrice)}) ต่างจากราคาล่าสุด (${formatMoney(refPrice)}) เกิน 15%`,
            lineNo
          );
        }
      }
    }

    // QTY_SHORT / QTY_OVER (เทียบกับใบสั่ง)
    if (orderItemId && expectedItemsById.has(orderItemId)) {
      const expected = expectedItemsById.get(orderItemId);
      const orderedQty = toFiniteNumberOrNull(
        expected.quantity_ordered ?? expected.quantity
      );
      if (orderedQty !== null && orderedQty > 0) {
        if (qtyReceived < orderedQty - 0.0005) {
          pushWarning(
            'QTY_SHORT',
            `บรรทัดที่ ${lineNo || '-'}: จำนวนรับจริง (${formatQuantity(qtyReceived)}) น้อยกว่าที่สั่ง (${formatQuantity(orderedQty)})`,
            lineNo
          );
        } else if (qtyReceived > orderedQty + 0.0005) {
          pushWarning(
            'QTY_OVER',
            `บรรทัดที่ ${lineNo || '-'}: จำนวนรับจริง (${formatQuantity(qtyReceived)}) มากกว่าที่สั่ง (${formatQuantity(orderedQty)})`,
            lineNo
          );
        }
      }
    }
  }

  // 4. SUM_MISMATCH (ผลรวมบรรทัด ≠ subtotal/total เกิน 1 บาท)
  const subtotal = toFiniteNumberOrNull(document.subtotal);
  const discount = toFiniteNumberOrNull(document.discount) ?? 0;
  const vat = toFiniteNumberOrNull(document.vat) ?? 0;
  const total = toFiniteNumberOrNull(document.total);

  if (hasAnyLineAmount && (subtotal !== null || total !== null)) {
    let mismatch = false;
    if (subtotal !== null && Math.abs(sumLineAmounts - subtotal) > sumMismatchTolerance) {
      mismatch = true;
    }
    if (total !== null) {
      const expectedTotalFromLines = sumLineAmounts - discount + vat;
      const diffWithAdjusted = Math.abs(expectedTotalFromLines - total);
      const diffWithRaw = Math.abs(sumLineAmounts - total);
      if (
        diffWithAdjusted > sumMismatchTolerance &&
        diffWithRaw > sumMismatchTolerance
      ) {
        mismatch = true;
      }
    }
    if (mismatch) {
      pushWarning(
        'SUM_MISMATCH',
        'ผลรวมจำนวนเงินของบรรทัดรายการไม่ตรงกับยอดรวมของบิลเกิน 1 บาท',
        null
      );
    }
  }

  const warningCodes = Array.from(new Set(warnings.map((w) => w.code)));
  return {
    warnings,
    warningCodes
  };
};
