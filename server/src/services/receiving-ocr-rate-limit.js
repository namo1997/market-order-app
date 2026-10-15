import crypto from 'node:crypto';
import {
  MAX_BILL_IMAGE_BYTES,
  OCR_RATE_LIMIT_PER_MINUTE,
  createReceivingError
} from './receiving-ocr.service.js';

export const extractImageDimensions = (buffer, mimeType) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return { width: null, height: null };

  try {
    if (mimeType === 'image/png' && buffer.length >= 24) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width: width > 0 ? width : null, height: height > 0 ? height : null };
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
          return { width: width > 0 ? width : null, height: height > 0 ? height : null };
        }
        offset += 2 + length;
      }
    }
  } catch {
    // ignore header parse errors
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
    allowedMimes = ['image/jpeg', 'image/webp'],
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

export const computeImagesContentHash = (images = []) => {
  const sorted = [...(images || [])].sort(
    (a, b) => Number(a.page_no || 0) - Number(b.page_no || 0)
  );
  const hash = crypto.createHash('sha256');
  for (const img of sorted) {
    const pageSha =
      img.sha256 ||
      (img.image_data
        ? crypto.createHash('sha256').update(Buffer.from(img.image_data)).digest('hex')
        : '');
    hash.update(`${Number(img.page_no || 0)}:${pageSha}|`);
  }
  return hash.digest('hex');
};

const ocrRateBuckets = new Map();

const pruneExpiredOcrRateBuckets = (windowStart) => {
  for (const [k, timestamps] of ocrRateBuckets.entries()) {
    const active = timestamps.filter((ts) => ts > windowStart);
    if (active.length === 0) {
      ocrRateBuckets.delete(k);
    } else if (active.length !== timestamps.length) {
      ocrRateBuckets.set(k, active);
    }
  }
};

export const resetOcrRateLimit = () => {
  ocrRateBuckets.clear();
};

export const getOcrRateBucketCount = () => ocrRateBuckets.size;

// R2-10: ล้าง key ที่หมดอายุ, ไม่ใช้ถัง anon ร่วม, รองรับ dryRun ก่อน claim และตอบ 429 RATE_LIMITED
export const checkOcrRateLimit = (
  key,
  {
    maxPerMinute = OCR_RATE_LIMIT_PER_MINUTE,
    nowMs = Date.now(),
    dryRun = false
  } = {}
) => {
  const bucketKey = String(key || '').trim();
  if (!bucketKey || bucketKey === 'user:anon' || bucketKey === 'anon') {
    return;
  }
  const windowStart = nowMs - 60000;
  pruneExpiredOcrRateBuckets(windowStart);

  const history = ocrRateBuckets.get(bucketKey) || [];
  if (history.length >= maxPerMinute) {
    throw createReceivingError(
      'RATE_LIMITED',
      'เรียกใช้งานระบบอ่านบิลถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
      429
    );
  }
  if (!dryRun) {
    ocrRateBuckets.set(bucketKey, [...history, nowMs]);
  }
};
