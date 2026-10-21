import { scaledInteger, decimalString, lineAmount, moneyString } from '../../../../server/src/utils/receiving-value.js';
export { scaledInteger, decimalString, lineAmount, moneyString };

export const WARNING_TEXT = Object.freeze({
  BILL_TOTAL_MISMATCH: 'ยอดในบิลไม่ลงตัว ตรวจส่วนลด/VAT',
  LINE_AMOUNT_MISMATCH: 'จำนวน × ราคาไม่ตรงกับยอดบรรทัด กรุณาเทียบบิล',
  SHIP_TO_MISMATCH: 'บิลนี้ส่งสาขาอื่น?',
  SUM_MISMATCH: 'ยอดรวมไม่ตรงกับบิล กรุณาตรวจราคา ส่วนลด และภาษี',
  TOTAL_EQUATION_MISMATCH: 'ยอดก่อนส่วนลด − ส่วนลด + ภาษี ไม่ตรงกับยอดรวมบิล กรุณาตรวจอีกครั้ง',
  PRICE_CHANGE: 'ราคาเปลี่ยนจากครั้งก่อนเกิน 15% กรุณาตรวจอีกครั้ง',
  QTY_SHORT: 'รับของน้อยกว่าที่สั่ง ตรวจจำนวนที่มาส่งจริง',
  QTY_OVER: 'รับของมากกว่าที่สั่ง ตรวจจำนวนก่อนยืนยัน',
  UNMATCHED_LINE: 'ยังไม่ได้เลือกสินค้าให้รายการนี้',
  DUPLICATE_BILL: 'อาจเป็นบิลซ้ำ ตรวจเลขบิลและเอกสารก่อนหน้า',
  LOW_CONFIDENCE: 'อ่านบิลได้ไม่ชัด กรุณาตรวจจากรูปต้นฉบับ',
  DOC_KIND_UNCERTAIN: 'AI ยังไม่แน่ใจชนิดเอกสาร กรุณาเทียบรายการกับรูปบิล',
  BILL_IS_STATEMENT: 'รูปนี้เป็นใบวางบิล/ใบสรุปรอบ ไม่ใช่ใบส่งของ — ถ่ายใบส่งของของวันนี้แทน หรือรับแบบไม่มีบิล',
  NOT_A_BILL: 'AI ไม่พบรายการในภาพหรือไม่แน่ใจชนิดเอกสาร กรุณาเทียบกับรูปบิล',
});
export const warningText = (warning) => WARNING_TEXT[typeof warning === 'string' ? warning : warning.code]
  || 'มีข้อมูลที่ต้องตรวจสอบ กรุณาเทียบกับบิลต้นฉบับ';

export const sumLines = (lines) => lines.reduce((sum, line) => sum + lineAmount(line), 0n);
export const formatBaht = (value) => {
  const [whole, fraction] = decimalString(value).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
};
export const bangkokDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);
export const canVoid = (doc, user, date = new Date()) => {
  if (doc.status === 'void') return false;
  if (['admin', 'super_admin'].includes(user?.role)) return true;
  const reference = new Date(doc.confirmed_at || doc.created_at);
  if (!Number.isFinite(reference.getTime())) return false;
  const days = (Date.parse(bangkokDate(date)) - Date.parse(bangkokDate(reference))) / 86400000;
  return days >= 0 && ((user?.role === 'accounting' && days <= 7)
    || (Number(doc.receiver_user_id) === Number(user?.id) && days === 0));
};

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

export const pendingKey = (user) => `${user.receiving_scope === 'branch' ? 'solao.receiving.branch.pending.v1' : 'solao.receiving.pending.v1'}:${user.id}:${user.branch_id ?? user.branch}:${user.department_id ?? user.department}`;
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
  if (doc.kind === 'manual_receipt' && doc.switchToManual) body.kind = 'manual_receipt';
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
      note: line.note || null, bill_text: line.bill_text || '', product_id: line.product_id || null,
      product_name: line.product_name || null, order_item_id: line.order_item_id || null,
      unit_text: line.unit_text || null, unit_id: line.unit_id || null,
      ...(line.unit_multiplier !== undefined ? { unit_multiplier: line.unit_multiplier } : {}),
      quantity_billed: quantity(line.quantity_billed, true),
      quantity_received: quantity(line.quantity_received, false),
      unit_price: line.unit_price === '' || line.unit_price == null ? null : String(line.unit_price),
      amount: line.unit_price == null && line.amount == null ? null : decimalString(amount),
      ...(line.remember_alias !== undefined ? { remember_alias: line.remember_alias } : {}),
      match: line.match,
    };
  });
  return body;
}

// Bill rows read before the count can carry the printed English unit; staff count in Thai units.
// Display only: the stored unit_text is unchanged.
const THAI_UNITS = { kilogram: 'กก.', kilograms: 'กก.', kg: 'กก.', kgs: 'กก.', gram: 'กรัม', grams: 'กรัม', g: 'กรัม',
  litre: 'ลิตร', liter: 'ลิตร', liters: 'ลิตร', litres: 'ลิตร', l: 'ลิตร', piece: 'ชิ้น', pieces: 'ชิ้น', pcs: 'ชิ้น', pc: 'ชิ้น',
  pack: 'แพ็ค', packs: 'แพ็ค', box: 'กล่อง', boxes: 'กล่อง', bottle: 'ขวด', bottles: 'ขวด', bag: 'ถุง', bags: 'ถุง', can: 'กระป๋อง', cans: 'กระป๋อง' };
export const thaiUnit = unit => THAI_UNITS[String(unit || '').trim().toLowerCase().replace(/\.$/, '')] || unit;
