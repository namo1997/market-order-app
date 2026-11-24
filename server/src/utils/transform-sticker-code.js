// รหัสสติกเกอร์แปรรูป 12 หลัก = id รายการรับเข้าจากการแปรรูป (inventory_transactions) 8 หลัก + ลำดับดวง 4 หลัก
// ตัวเลขล้วนจำนวนคู่ → CODE128 ชุด C และ QR โหมดตัวเลข สแกนง่ายสุดบนเครื่องพิมพ์ 203 dpi
// ต้องตรงกับ client/src/pages/production/transformStickerPrint.js
export const STICKER_CODE_LENGTH = 12;
const MAX_TRANSACTION_ID = 99_999_999;
const MAX_SEQUENCE = 9_999;

export const encodeTransformStickerCode = (transactionId, sequence = 1) => {
  const id = Number(transactionId);
  const seq = Number(sequence);
  if (!Number.isInteger(id) || id <= 0 || id > MAX_TRANSACTION_ID) return null;
  if (!Number.isInteger(seq) || seq <= 0 || seq > MAX_SEQUENCE) return null;
  return `${String(id).padStart(8, '0')}${String(seq).padStart(4, '0')}`;
};

export const decodeTransformStickerCode = (value) => {
  const text = String(value || '').replace(/\D/g, '');
  if (text.length !== STICKER_CODE_LENGTH) return null;
  const transactionId = Number(text.slice(0, 8));
  const sequence = Number(text.slice(8));
  if (transactionId <= 0 || sequence <= 0) return null;
  return { code: text, transactionId, sequence };
};

// จำนวนดวงและจำนวนต่อดวง (ต้องเหมือน client/src/pages/production/transformStickerPrint.js)
// - ตั้ง "บรรจุแพ็คละ" (packSize) ไว้: 1 ดวงต่อ 1 แพ็ค, ดวงสุดท้ายนับเศษ (เช่น 12 ตัว แพ็คละ 5 = 5, 5, 2)
// - ไม่ได้ตั้ง: จำนวนเต็ม = ดวงละ 1 หน่วย, มีทศนิยม = ดวงเดียวทั้งก้อน
export const MAX_STICKER_COPIES = 200;
const round3 = (value) => Math.round(value * 1000) / 1000;
const isWhole = (value) => Math.abs(value - Math.round(value)) < 0.000001;

export const getStickerCopies = (quantity, packSize = 0) => {
  const qty = Number(quantity);
  const pack = Number(packSize);
  if (!Number.isFinite(qty) || qty <= 0) return 1;
  if (pack > 0) return Math.min(MAX_STICKER_COPIES, Math.max(1, Math.ceil(round3(qty / pack))));
  if (isWhole(qty)) return Math.min(MAX_STICKER_COPIES, Math.max(1, Math.round(qty)));
  return 1;
};

export const getQuantityPerSticker = (quantity, packSize = 0, sequence = 1) => {
  const qty = Number(quantity);
  const pack = Number(packSize);
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  if (pack > 0) {
    const copies = getStickerCopies(qty, pack);
    const seq = Math.min(Math.max(1, Number(sequence) || 1), copies);
    return seq < copies ? pack : round3(qty - pack * (copies - 1));
  }
  if (isWhole(qty)) {
    // เกิน 200 ดวงพิมพ์แค่ 200 ดวง จึงแบ่งเท่า ๆ กัน
    return Math.round(qty) > MAX_STICKER_COPIES ? qty / MAX_STICKER_COPIES : 1;
  }
  return qty;
};
