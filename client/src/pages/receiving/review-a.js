import { scaledInteger, decimalString } from './receiving-utils.js';
import { normalizeReceivingUnit } from './receiving-status.js';

export function initialReviewStep(doc) {
  if (doc.status !== 'draft') return 'summary';
  if (doc.kind === 'manual_receipt') return doc.counted_complete_at ? 'summary' : 'count';
  return doc.counted_complete_at ? 'compare' : 'images';
}
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
    if (line.quantity_ordered == null || line.quantity_ordered === '') return '';
    const delta = scaledInteger(line.quantity_ordered) - scaledInteger(line.quantity_received);
    return delta === 0n ? '' : `${delta > 0n ? 'ขาด' : 'เกิน'}จากใบสั่ง ${qtyText(decimalString(delta > 0n ? delta : -delta))} ${line.ordered_unit || line.unit_text || ''}`;
  } catch { return ''; }
}
export function rowDecision(line, doc) {
  try {
  if (line.counted_quantity === null && !line._countConfirmed) return { kind: 'invalid', invalid: true, label: 'กรอกจำนวนหลังเปิดบิล', action: 'ตรวจข้อมูลก่อนรับ' };
  if (!validCount(line.quantity_received)) return { kind: 'invalid', invalid: true, label: 'กรอกจำนวนรับให้ครบ', action: 'ตรวจข้อมูลก่อนรับ' };
  if (doc?.kind === 'bill' && doc.ocr?.status !== 'done' && !line.bill_entered_manually && !line._billEntered) return { kind: 'waiting_bill', invalid: true, label: 'รออ่านบิล', action: 'อ่านบิลหรือกรอกจำนวนบิลก่อน' };
  const hasQuantity = line.quantity_billed != null && line.quantity_billed !== '';
  if ((!hasQuantity || scaledInteger(line.quantity_billed) === 0n) && scaledInteger(line.quantity_received) === 0n && scaledInteger(line.counted_quantity ?? 0) === 0n) return { kind: 'not_delivered', label: 'ไม่ได้มาส่ง', action: 'ไม่ได้มาส่ง · ค้างตามใบสั่ง (ตามของ)' };
  if (!hasQuantity && doc?.ocr?.status !== 'done' && !['no_bill', 'manual_receipt'].includes(doc?.kind)) return { kind: 'waiting_bill', invalid: true, label: 'รออ่านบิล', action: 'อ่านบิลหรือกรอกจำนวนบิลก่อน' };
  if (!hasQuantity) return { kind: 'missing_bill', label: 'ไม่มีในบิล', action: `รับ ${qtyText(line.quantity_received)} ${line.unit_text || line.ordered_unit || 'หน่วย'} · ให้บัญชีขอบิลจากร้าน` };
  if (!line.product_id || line.match?.source === 'ai') return { kind: 'wrong_product', label: 'สินค้าไม่ตรง', action: 'ยืนยันสินค้าที่เลือกและรับ' };
  const counted = scaledInteger(line.quantity_received ?? 0);
  const delta = counted - scaledInteger(line.quantity_billed);
  const unitMismatch = line.unit_text && line.ordered_unit && normalizeReceivingUnit(line.unit_text) !== normalizeReceivingUnit(line.ordered_unit);
  if (unitMismatch) return { kind: 'wrong_product', label: 'ตรวจหน่วย', action: 'ยืนยันหน่วยและรับ' };
  if (delta < 0n) return { kind: 'short', label: 'ขาด (จากบิล)', action: `รับ ${qtyText(line.quantity_received)} ${line.unit_text || line.ordered_unit || 'หน่วย'} · แจ้งร้านขาด ${qtyText(decimalString(-delta))} ${line.unit_text || line.ordered_unit || 'หน่วย'}` };
  if (delta > 0n) return { kind: 'over', label: 'เกิน', action: `รับ ${qtyText(line.quantity_received)} เป็นของเกิน` };
  const overOrder = line.quantity_ordered != null && line.quantity_ordered !== '' && counted > scaledInteger(line.quantity_ordered);
  if (line.ordered_price != null && line.unit_price != null && line.unit_price !== '' && scaledInteger(line.ordered_price, 6) !== scaledInteger(line.unit_price, 6)) return { kind: 'price_review', label: `ตรง · ราคาไม่ตรง${overOrder ? ' · เกินใบสั่ง' : ''}`, action: overOrder ? `ยืนยันรับเกินใบสั่ง ${qtyText(line.quantity_received)} ${line.unit_text || line.ordered_unit || 'หน่วย'} และส่งตรวจราคา` : `รับ ${qtyText(line.quantity_received)} และส่งตรวจราคา` };
  if (overOrder) return { kind: 'over_order', label: 'ตรงบิล · เกินใบสั่ง', action: `ยืนยันรับเกินใบสั่ง ${qtyText(line.quantity_received)} ${line.unit_text || line.ordered_unit || 'หน่วย'}` };
  return { kind: 'accept', label: 'ตรง', action: `ยืนยันรับ ${qtyText(line.quantity_received)}` };
  } catch { return { kind: 'invalid', invalid: true, label: 'ตรวจจำนวนหรือราคา', action: 'ตรวจข้อมูลก่อนรับ' }; }
}
export { reviewLedger } from './review-ledger.js';
// Persisted decisions use the same wording in the app summary and accounting.
export function receiptDecisionText(line) {
  const unit = line.unit_text || line.ordered_unit || 'หน่วย';
  const received = qtyText(line.quantity_received);
  switch (line.review_decision) {
    case 'not_delivered': return 'ไม่ได้มาส่ง · ค้างตามใบสั่ง (ตามของ)';
    case 'over_order': return `ยืนยันรับเกินใบสั่ง ${received} ${unit}`;
    case 'not_received': return `ไม่รับ · คืนร้าน ${qtyText(line.counted_quantity)} ${unit} · ${line.return_status === 'collected' ? 'ร้านมารับแล้ว · รอหลักฐาน' : 'รอร้านมารับ'}`;
    case 'missing_bill': return `รับ ${received} ${unit} · ให้บัญชีขอบิลจากร้าน`;
    case 'wrong_product': return `รับ ${received} ${unit} · ตรวจสินค้า/หน่วยแล้ว`;
    case 'price_review': return `รับ ${received} ${unit} · ให้บัญชีตรวจราคา`;
    case 'over': return `รับ ${received} เป็นของเกิน`;
    case 'accept': return `ยืนยันรับ ${received}`;
    case 'short': {
      try {
        const shortage = scaledInteger(line.quantity_billed) - scaledInteger(line.quantity_received);
        if (shortage > 0n) return `รับ ${received} ${unit} · แจ้งร้านขาด ${qtyText(decimalString(shortage))} ${unit}`;
      } catch { /* Legacy records can lack the original quantities. */ }
      return `รับ ${received} ${unit} · แจ้งร้านว่าขาด (ไม่ทราบส่วนต่าง)`;
    }
    default: return line.review_decision ? 'ตรวจข้อมูลการตัดสินใจ' : 'ยังไม่ตัดสินใจ';
  }
}
export const qtyText = value => {
  if (value == null || value === '') return '—';
  try {
    scaledInteger(value, 6);
    return String(value).trim().replaceAll(',', '').replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  } catch { return 'ตรวจค่า'; }
};
