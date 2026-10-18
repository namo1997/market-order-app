import { scaledInteger, decimalString, sumLines } from './receiving-utils.js';
import { normalizeReceivingUnit } from './receiving-status.js';

export function validCount(value) {
  try { return /^\d+(?:\.\d{1,2})?$/.test(String(value ?? '').trim()) && scaledInteger(value) <= 9999999999n; }
  catch { return false; }
}
export function billAlias(line, doc) {
  const raw = String(line.bill_text || '').trim();
  return raw && raw !== '—' && raw !== String(line.product_name || '').trim() &&
    (doc ? doc.ocr?.status === 'done' : line.quantity_billed != null && line.quantity_billed !== '') ? raw : '';
}
export function orderDifference(line) {
  try {
    if (line.quantity_ordered == null || line.quantity_billed == null || line.quantity_billed === '' || scaledInteger(line.quantity_ordered) === scaledInteger(line.quantity_billed)) return '';
    const delta = scaledInteger(line.quantity_ordered) - scaledInteger(line.quantity_received);
    return delta > 0n ? `ขาดจากใบสั่ง ${qtyText(decimalString(delta))} ${line.ordered_unit || line.unit_text || ''}` : '';
  } catch { return ''; }
}
export function rowDecision(line, doc) {
  try {
  if (line.counted_quantity === null && !line._countConfirmed) return { kind: 'invalid', invalid: true, label: 'กรอกจำนวนหลังเปิดบิล', action: 'ตรวจข้อมูลก่อนรับ' };
  if (!validCount(line.quantity_received)) return { kind: 'invalid', invalid: true, label: 'กรอกจำนวนรับให้ครบ', action: 'ตรวจข้อมูลก่อนรับ' };
  if (doc?.kind === 'bill' && doc.ocr?.status !== 'done' && !line.bill_entered_manually && !line._billEntered) return { kind: 'waiting_bill', invalid: true, label: 'รออ่านบิล', action: 'อ่านบิลหรือกรอกจำนวนบิลก่อน' };
  const hasQuantity = line.quantity_billed != null && line.quantity_billed !== '';
  if (!hasQuantity && doc?.ocr?.status !== 'done' && doc?.kind !== 'no_bill') return { kind: 'waiting_bill', invalid: true, label: 'รออ่านบิล', action: 'อ่านบิลหรือกรอกจำนวนบิลก่อน' };
  if (!hasQuantity) return { kind: 'missing_bill', label: 'ไม่มีในบิล', action: `รับ ${qtyText(line.quantity_received)} และให้บัญชีตามบิล` };
  if (!line.product_id || line.match?.source === 'ai') return { kind: 'wrong_product', label: 'สินค้าไม่ตรง', action: 'ยืนยันสินค้าที่เลือกและรับ' };
  const counted = scaledInteger(line.quantity_received ?? 0);
  const delta = counted - scaledInteger(line.quantity_billed);
  const unitMismatch = line.unit_text && line.ordered_unit && normalizeReceivingUnit(line.unit_text) !== normalizeReceivingUnit(line.ordered_unit);
  if (unitMismatch) return { kind: 'wrong_product', label: 'ตรวจหน่วย', action: 'ยืนยันหน่วยและรับ' };
  if (delta < 0n) return { kind: 'short', label: 'ขาด (จากบิล)', action: `รับ ${qtyText(line.quantity_received)} และแจ้งขาด` };
  if (delta > 0n) return { kind: 'over', label: 'เกิน', action: `รับ ${qtyText(line.quantity_received)} เป็นของเกิน` };
  if (line.ordered_price != null && line.unit_price != null && line.unit_price !== '' && scaledInteger(line.ordered_price, 6) !== scaledInteger(line.unit_price, 6)) return { kind: 'price_review', label: 'ตรง · ราคาไม่ตรง', action: `รับ ${qtyText(line.quantity_received)} และส่งตรวจราคา` };
  return { kind: 'accept', label: 'ตรง', action: `ยืนยันรับ ${qtyText(line.quantity_received)}` };
  } catch { return { kind: 'invalid', invalid: true, label: 'ตรวจจำนวนหรือราคา', action: 'ตรวจข้อมูลก่อนรับ' }; }
}
export function reviewLedger(doc) {
  const bill = doc.total == null ? sumLines(doc.lines) : scaledInteger(doc.total);
  const missingPrice = doc.lines.some(line => (line.unit_price == null || line.unit_price === '') && (line.amount == null || line.amount === '' || scaledInteger(line.amount) !== 0n));
  const received = doc.lines.reduce((sum, line) => line.unit_price == null ? sum : sum +
    (scaledInteger(line.quantity_received ?? 0) * scaledInteger(line.unit_price, 6) + 500000n) / 1000000n, 0n);
  const billedLines = sumLines(doc.lines);
  const adjustments = doc.lines.filter(line => line.unit_price != null).map(line => ({ id: line.id, name: line.product_name,
    amount: (scaledInteger(line.quantity_received ?? 0) * scaledInteger(line.unit_price, 6) + 500000n) / 1000000n - sumLines([line]) })).filter(row => row.amount !== 0n);
  const discount = scaledInteger(doc.discount || 0), vat = scaledInteger(doc.vat || 0);
  return { net: billedLines - discount + vat, billedLines, bill, adjustment: received - billedLines, adjustments, received, missingPrice,
    discount: scaledInteger(doc.discount || 0), vat: scaledInteger(doc.vat || 0) };
}
export const qtyText = value => {
  if (value == null || value === '') return '—';
  try {
    scaledInteger(value, 6);
    return String(value).trim().replaceAll(',', '').replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  } catch { return 'ตรวจค่า'; }
};
