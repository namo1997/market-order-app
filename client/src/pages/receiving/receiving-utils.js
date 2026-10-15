export const WARNING_TEXT = Object.freeze({
  SUM_MISMATCH: 'ยอดรวมไม่ตรงกับบิล กรุณาตรวจราคา ส่วนลด และภาษี',
  TOTAL_EQUATION_MISMATCH: 'ยอดก่อนส่วนลด − ส่วนลด + ภาษี ไม่ตรงกับยอดรวมบิล กรุณาตรวจอีกครั้ง',
  PRICE_CHANGE: 'ราคาเปลี่ยนจากครั้งก่อนเกิน 15% กรุณาตรวจอีกครั้ง',
  QTY_SHORT: 'รับของน้อยกว่าที่สั่ง ตรวจจำนวนที่มาส่งจริง',
  QTY_OVER: 'รับของมากกว่าที่สั่ง ตรวจจำนวนก่อนยืนยัน',
  UNMATCHED_LINE: 'ยังไม่ได้เลือกสินค้าให้รายการนี้',
  DUPLICATE_BILL: 'อาจเป็นบิลซ้ำ ตรวจเลขบิลและเอกสารก่อนหน้า',
  LOW_CONFIDENCE: 'อ่านบิลได้ไม่ชัด กรุณาตรวจจากรูปต้นฉบับ',
});
export const warningText = (warning) => WARNING_TEXT[typeof warning === 'string' ? warning : warning.code]
  || 'มีข้อมูลที่ต้องตรวจสอบ กรุณาเทียบกับบิลต้นฉบับ';

// คำนวณด้วยจำนวนเต็มทั้งจำนวนสินค้าและเงิน ปัด half-up ที่ขอบเขตสตางค์
export function scaledInteger(value, places = 2) {
  const text = String(value ?? '').trim().replaceAll(',', '');
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error('กรอกตัวเลขตั้งแต่ 0 ขึ้นไป');
  const [whole, fraction = ''] = text.split('.');
  const padded = fraction.padEnd(places + 1, '0');
  const result = BigInt(whole) * 10n ** BigInt(places)
    + BigInt(padded.slice(0, places) || '0') + (padded[places] >= '5' ? 1n : 0n);
  if (result > 99999999999999n) throw new Error('ตัวเลขสูงเกินกำหนด');
  return result;
}
export function decimalString(value) {
  const number = BigInt(value);
  const sign = number < 0n ? '-' : '';
  const absolute = number < 0n ? -number : number;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
export const moneyString = (value) => value === '' || value == null ? null : decimalString(scaledInteger(value));
export function lineAmount(line) {
  if (line.amount !== '' && line.amount != null) return scaledInteger(line.amount);
  if (line.unit_price === '' || line.unit_price == null) return 0n;
  const quantity = scaledInteger(line.quantity_billed === '' || line.quantity_billed == null
    ? line.quantity_received ?? '0' : line.quantity_billed);
  // ราคาใน API อาจมี 6 ตำแหน่ง คงความละเอียดก่อนปัดยอดบรรทัด
  const price = scaledInteger(line.unit_price, 6);
  return (quantity * price + 500000n) / 1000000n;
}
export const sumLines = (lines) => lines.reduce((sum, line) => sum + lineAmount(line), 0n);
export const formatBaht = (value) => {
  const [whole, fraction] = decimalString(value).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
};
export const bangkokDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);
export const canVoid = (doc, user, date = new Date()) => doc.status !== 'void' && (
  ['admin', 'super_admin'].includes(user?.role)
  || (Number(doc.receiver_user_id) === Number(user?.id)
    && bangkokDate(new Date(doc.confirmed_at || doc.created_at)) === bangkokDate(date))
);

export function errorText(error) {
  if (!error.response) return 'การเชื่อมต่อขัดข้อง ยังไม่ทราบผลการส่ง กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง';
  const code = error.response.data?.code;
  const messages = {
    RATE_LIMITED: 'อ่านบิลถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
    OCR_UNAVAILABLE: 'ระบบอ่านบิลยังไม่พร้อม กรอกรายการเองหรือกลับมาอ่านใหม่ภายหลังได้',
    RECEIVING_NOT_READY: 'ระบบรับสินค้ายังไม่พร้อมใช้งาน กรุณาแจ้งผู้ดูแล',
    NOT_DRAFT: 'สถานะเอกสารเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนทำต่อ',
    FORBIDDEN: 'คุณไม่มีสิทธิ์ใช้งานเอกสารนี้',
    NOT_FOUND: 'ไม่พบเอกสารหรือรูปที่ต้องการ',
    SIGNATURE_REQUIRED: 'กรุณาเซ็นชื่อผู้รับก่อนยืนยัน',
    IMAGE_TOO_LARGE: 'รูปมีขนาดเกิน 3 MB กรุณาเลือกรูปใหม่',
    VALIDATION_FAILED: 'ข้อมูลยังไม่ถูกต้อง ตรวจจำนวน ราคา สินค้า และวันที่อีกครั้ง',
  };
  return messages[code] || ({ 401: 'กรุณาเข้าสู่ระบบใหม่', 429: messages.RATE_LIMITED,
    409: messages.NOT_DRAFT, 503: 'ระบบยังไม่พร้อม กรุณาลองใหม่ภายหลัง' })[error.response.status]
    || 'ส่งข้อมูลไม่สำเร็จ กรุณาตรวจข้อมูลแล้วลองใหม่';
}

export const pendingKey = (user) => `solao.receiving.pending.v1:${user.id}:${user.branch_id ?? user.branch}:${user.department_id ?? user.department}`;
export function readPending(key, storage) {
  try {
    const value = JSON.parse(storage.getItem(key));
    return value?.client_uuid && value?.delivery_date && ['bill', 'manual_receipt'].includes(value.kind) ? value : null;
  } catch { return null; }
}
export function ensurePending(key, body, current, storage, uuid = () => crypto.randomUUID()) {
  const payload = current || readPending(key, storage) || { ...body, client_uuid: uuid() };
  let persisted = true;
  try { storage.setItem(key, JSON.stringify(payload)); } catch { persisted = false; }
  return { payload, persisted };
}
export function clearPending(key, storage) {
  try { storage.removeItem(key); } catch { /* ยังใช้ UUID เดิมในหน้านี้ได้ */ }
}

export function documentBody(doc, deleted = []) {
  const body = Object.fromEntries(['supplier_name_text', 'doc_ref', 'doc_date', 'courier_name'].map((key) => [key, doc[key] || null]));
  for (const key of ['subtotal', 'discount', 'vat', 'total']) body[key] = moneyString(doc[key]);
  body.deleted_line_ids = deleted;
  body.lines = doc.lines.map((line, index) => {
    const quantity = (value, optional) => {
      if (optional && (value == null || value === '')) return null;
      const result = scaledInteger(value);
      if (result > 9999999999n) throw new Error('จำนวนสินค้าสูงเกินกำหนด');
      return decimalString(result);
    };
    if (line.unit_price != null && line.unit_price !== '' && scaledInteger(line.unit_price, 6) > 999999999999n) {
      throw new Error('ราคาต่อหน่วยสูงเกินกำหนด');
    }
    const amount = lineAmount(line);
    if (amount > 99999999999n) throw new Error('ยอดบรรทัดสูงเกินกำหนด');
    return {
      ...(line.id ? { id: line.id } : {}), line_no: index + 1,
      bill_text: line.bill_text || '', product_id: line.product_id || null,
      product_name: line.product_name || null, order_item_id: line.order_item_id || null,
      unit_text: line.unit_text || null, unit_id: line.unit_id || null,
      ...(line.unit_multiplier !== undefined ? { unit_multiplier: line.unit_multiplier } : {}),
      quantity_billed: quantity(line.quantity_billed, true),
      quantity_received: quantity(line.quantity_received, false),
      unit_price: line.unit_price === '' || line.unit_price == null ? null : String(line.unit_price),
      amount: line.unit_price == null && line.amount == null ? null : decimalString(amount),
      match: line.match,
    };
  });
  return body;
}
