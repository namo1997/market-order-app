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

// เหมือน getStickerCopies ฝั่ง client: จำนวนเต็ม = ดวงละ 1 หน่วย, มีทศนิยม = ดวงเดียวทั้งก้อน
export const getStickerCopies = (quantity) => {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) return 1;
  if (Math.abs(qty - Math.round(qty)) < 0.000001) return Math.min(200, Math.max(1, Math.round(qty)));
  return 1;
};

export const getQuantityPerSticker = (quantity) => {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  if (Math.abs(qty - Math.round(qty)) < 0.000001) {
    // เกิน 200 ดวงพิมพ์แค่ 200 ดวง จึงแบ่งเท่า ๆ กัน
    return Math.round(qty) > 200 ? qty / 200 : 1;
  }
  return qty;
};
