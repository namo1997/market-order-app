import { scaledInteger, decimalString, thaiUnit } from './receiving-utils.js';
import { lineErrors } from './receiving-validation.js';
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
// P8: a follow-up delivery is compared with what is still outstanding (ordered - previous receipts).
// `previously_received_quantity` is only sent by the server after the blind count is complete.
export function partialDelivery(line) {
  try {
    if (line.quantity_ordered == null || line.quantity_ordered === '') return null;
    if (line.previously_received_quantity == null || line.previously_received_quantity === '') return null;
    const ordered = scaledInteger(line.quantity_ordered), previous = scaledInteger(line.previously_received_quantity);
    const current = scaledInteger(line.quantity_received ?? 0);
    if (previous <= 0n) return null;
    const remaining = ordered > previous ? ordered - previous : 0n;
    const outstanding = remaining - current;
    return { ordered, previous, current, remaining, outstanding,
      remainingText: decimalString(remaining), outstandingText: decimalString(outstanding > 0n ? outstanding : -outstanding) };
  } catch { return null; }
}
export function partialDeliveryText(line) {
  const info = partialDelivery(line);
  if (!info) return '';
  const unit = line.ordered_unit || line.unit_text || '';
  const tail = info.outstanding > 0n ? `ยังขาด ${qtyText(info.outstandingText)}${unit ? ` ${unit}` : ''}`
    : info.outstanding === 0n ? 'ครบแล้ว' : `เกิน ${qtyText(info.outstandingText)}${unit ? ` ${unit}` : ''}`;
  return `สั่ง ${qtyText(line.quantity_ordered)} · รับก่อนหน้า ${qtyText(line.previously_received_quantity)} · ครั้งนี้ ${qtyText(line.quantity_received)} · ${tail}`;
}
export function orderDifference(line) {
  try {
    if (line.quantity_ordered == null || line.quantity_ordered === '') return '';
    const partial = partialDelivery(line);
    const delta = partial ? partial.remaining - partial.current : scaledInteger(line.quantity_ordered) - scaledInteger(line.quantity_received);
    return delta === 0n ? '' : `${delta > 0n ? 'ขาด' : 'เกิน'}จาก${partial ? 'ยอดค้างรับ' : 'ใบสั่ง'} ${qtyText(decimalString(delta > 0n ? delta : -delta))} ${line.ordered_unit || line.unit_text || ''}`;
  } catch { return ''; }
}
export function rowDecision(line, doc) {
  try {
  if (line.counted_quantity === null && !line._countConfirmed) return { kind: 'invalid', invalid: true, label: 'กรอกจำนวนหลังเปิดบิล', action: 'ตรวจข้อมูลก่อนรับ' };
  if (!validCount(line.quantity_received)) return { kind: 'invalid', invalid: true, label: 'กรอกจำนวนรับให้ครบ', action: 'ตรวจข้อมูลก่อนรับ' };
  if (doc?.kind === 'bill' && doc.ocr?.status !== 'done' && !line.bill_entered_manually && !line._billEntered) return { kind: 'waiting_bill', invalid: true, label: 'รออ่านบิล', action: 'อ่านบิลหรือกรอกจำนวนบิลก่อน' };
  if (line.price_by_weight && line.amount != null && line.amount !== '' && scaledInteger(line.quantity_received) > 0n) return weightDecision(line);
  const hasQuantity = line.quantity_billed != null && line.quantity_billed !== '';
  if ((!hasQuantity || scaledInteger(line.quantity_billed) === 0n) && scaledInteger(line.quantity_received) === 0n && scaledInteger(line.counted_quantity ?? 0) === 0n) return { kind: 'not_delivered', label: 'ไม่ได้มาส่ง', action: 'ไม่ได้มาส่ง · ค้างตามใบสั่ง (ตามของ)' };
  if (!hasQuantity && doc?.ocr?.status !== 'done' && !['no_bill', 'manual_receipt'].includes(doc?.kind)) return { kind: 'waiting_bill', invalid: true, label: 'รออ่านบิล', action: 'อ่านบิลหรือกรอกจำนวนบิลก่อน' };
  if (!hasQuantity) return { kind: 'missing_bill', label: 'ไม่มีในบิล', action: `รับ ${qtyText(line.quantity_received)} ${line.unit_text || line.ordered_unit || 'หน่วย'} · ให้บัญชีขอบิลจากร้าน` };
  if (!line.product_id || line.match?.source === 'ai') return { kind: 'wrong_product', label: 'สินค้าไม่ตรง', action: 'ยืนยันสินค้าที่เลือกและรับ' };
  const counted = scaledInteger(line.quantity_received ?? 0);
  const delta = counted - scaledInteger(line.quantity_billed);
  const unitMismatch = (line.unit_text && line.ordered_unit && normalizeReceivingUnit(line.unit_text) !== normalizeReceivingUnit(line.ordered_unit))
    || (line._billUnit && normalizeReceivingUnit(line._billUnit) !== normalizeReceivingUnit(line.unit_text));
  if (unitMismatch) return { kind: 'wrong_product', label: 'ตรวจหน่วย', action: 'ยืนยันหน่วยและรับ' };
  if (delta < 0n) return { kind: 'short', label: 'ขาด (จากบิล)', action: `รับ ${qtyText(line.quantity_received)} ${line.unit_text || line.ordered_unit || 'หน่วย'} · แจ้งร้านขาด ${qtyText(decimalString(-delta))} ${line.unit_text || line.ordered_unit || 'หน่วย'}` };
  if (delta > 0n) return { kind: 'over', label: 'เกิน', action: `รับ ${qtyText(line.quantity_received)} เป็นของเกิน` };
  const overOrder = line.quantity_ordered != null && line.quantity_ordered !== '' && counted > scaledInteger(line.quantity_ordered);
  if (line.ordered_price != null && line.unit_price != null && line.unit_price !== '' && scaledInteger(line.ordered_price, 6) !== scaledInteger(line.unit_price, 6)) return { kind: 'price_review', label: `ตรง · ราคาไม่ตรง${overOrder ? ' · เกินใบสั่ง' : ''}`, action: overOrder ? `ยืนยันรับเกินใบสั่ง ${qtyText(line.quantity_received)} ${line.unit_text || line.ordered_unit || 'หน่วย'} และส่งตรวจราคา` : `รับ ${qtyText(line.quantity_received)} และส่งตรวจราคา` };
  if (overOrder) return { kind: 'over_order', label: 'ตรงบิล · เกินใบสั่ง', action: `ยืนยันรับเกินใบสั่ง ${qtyText(line.quantity_received)} ${line.unit_text || line.ordered_unit || 'หน่วย'}` };
  return { kind: 'accept', label: 'ตรง', action: `ยืนยันรับ ${qtyText(line.quantity_received)}` };
  } catch { return { kind: 'invalid', invalid: true, label: 'ตรวจจำนวนหรือราคา', action: 'ตรวจข้อมูลก่อนรับ' }; }
}
// A pack row read from the bill (1 กล่อง × 400) is stored in counting units (10 ถุง × 40); show both.
export const packText = line => {
  const printed = line.bill_read?.quantity_billed;
  if (printed == null || printed === '' || line.quantity_billed == null || line.quantity_billed === '') return '';
  try { if (scaledInteger(printed) === scaledInteger(line.quantity_billed)) return ''; } catch { return ''; }
  return `บิลเขียน ${qtyText(printed)} × ${qtyText(line.bill_read.unit_price)} · คิดเป็น ${qtyText(line.quantity_billed)} ${line.unit_text || 'หน่วย'}`;
};
// Priced by weight (bill in kg, received in pieces): the bill weight is never compared with the count.
export const weightBillText = line => `บิล ${line.quantity_billed != null && line.quantity_billed !== '' ? `${qtyText(line.quantity_billed)} ${line.unit_text || 'ตัว'} · ` : ''}${qtyText(line.bill_weight)} ${line.bill_weight_unit || 'กก.'}${line.weight_unit_price != null ? ` × ${qtyText(line.weight_unit_price)}` : ''} = ${Number(line.amount).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;
function weightDecision(line) {
  if (!line.product_id || line.match?.source === 'ai') return { kind: 'wrong_product', label: 'สินค้าไม่ตรง', action: 'ยืนยันสินค้าที่เลือกและรับ' };
  const unit = line.unit_text || line.ordered_unit || 'หน่วย';
  // A handwritten piece count on the bill ("ช่อน 10ต") is compared with our count; the weight never is.
  if (line.quantity_billed != null && line.quantity_billed !== '') {
    const delta = scaledInteger(line.quantity_received) - scaledInteger(line.quantity_billed);
    if (delta < 0n) return { kind: 'short', label: 'ขาด (จากบิล)', action: `รับ ${qtyText(line.quantity_received)} ${unit} · แจ้งร้านขาด ${qtyText(decimalString(-delta))} ${unit}` };
    if (delta > 0n) return { kind: 'over', label: 'เกิน', action: `รับ ${qtyText(line.quantity_received)} เป็นของเกิน` };
  }
  const changed = line.weight_ref_price != null && line.weight_unit_price != null &&
    scaledInteger(line.weight_ref_price, 6) !== scaledInteger(line.weight_unit_price, 6);
  if (changed) return { kind: 'price_review', label: `คิดตามน้ำหนัก · ราคาต่อ กก. เปลี่ยน (${qtyText(line.weight_ref_price)} → ${qtyText(line.weight_unit_price)})`,
    action: `รับ ${qtyText(line.quantity_received)} ${unit} และส่งตรวจราคา · ${weightBillText(line)}` };
  return { kind: 'accept', label: 'ตรง · คิดตามน้ำหนัก', action: `ยืนยันรับ ${qtyText(line.quantity_received)} ${unit} · ${weightBillText(line)}` };
}
export { reviewLedger } from './review-ledger.js';
// Persisted decisions use the same wording in the app summary and accounting.
// Done screen: what the receipt hands to accounting to follow (short and returned goods), said in one line.
export function followupText(doc) {
  const count = decision => (doc?.lines || []).filter(line => line.review_decision === decision).length;
  return [['short', 'แจ้งร้านขาด'], ['not_received', 'คืนร้าน']].filter(([decision]) => count(decision))
    .map(([decision, label]) => `${label} ${count(decision)}`).join(' · ') + ((count('short') || count('not_received')) ? ' รายการ' : '');
}
export function receiptDecisionText(line) {
  const unit = line.unit_text || line.ordered_unit || 'หน่วย';
  const received = qtyText(line.quantity_received);
  switch (line.review_decision) {
    case 'not_delivered': return 'ไม่ได้มาส่ง · ค้างตามใบสั่ง (ตามของ)';
    case 'over_order': return `ยืนยันรับเกินใบสั่ง ${received} ${unit}`;
    case 'not_received': return `ไม่รับ · คืนร้าน ${qtyText(line.counted_quantity)} ${unit} · ${line.return_status === 'collected' ? 'ร้านมารับแล้ว · รอหลักฐาน' : 'รอร้านมารับ'}`;
    case 'missing_bill': return `รับ ${received} ${unit} · ให้บัญชีขอบิลจากร้าน`;
    // Owner 2026-10-24 "รับไปก่อนแล้วตามหลัง": no product in the catalogue yet; accounting links it after confirm.
    case 'receive_unmatched': return `รับ ${received} ${thaiUnit(unit) || unit} · ${line.product_id ? 'บัญชีผูกสินค้าแล้ว' : 'รอบัญชีผูกสินค้า'}`;
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

// A no-bill receipt compares the received quantity with the order. The automatic
// 'missing_bill' decision is a document-level bill request, not a line difference.
export function lineDiffersFromOrder(line) {
  if (line.quantity_ordered == null || line.quantity_ordered === '') return true;
  const partial = partialDelivery(line);
  if (partial ? partial.outstanding !== 0n : Number(line.quantity_received) !== Number(line.quantity_ordered)) return true;
  return !!line.review_decision && !['missing_bill', 'accept'].includes(line.review_decision);
}
// Owner 2026-10-24 "ตัวหนังสือต้องน้อยๆ": the sign card says only how many were received;
// differences and the bill request stay in the folded "รายละเอียดสรุป".
export function signSummaryText(doc) {
  const received = doc.lines.filter(line => Number(line.quantity_received) > 0).length;
  return `รับ ${received} จาก ${doc.lines.length} รายการ`;
}

// A batch must never acknowledge a proposed alias or a unit conversion.
export function canBulkAccept(line, doc) {
  return !line.review_decision && !!line.product_id &&
    !['ai', 'alias', 'none'].includes(line.match?.source) &&
    !Object.values(lineErrors(line, doc.kind)).some(Boolean) &&
    (line.unit_multiplier == null || Number(line.unit_multiplier) === 1) &&
    rowDecision(line, doc).kind === 'accept';
}

// UI navigation only: validation and persisted decisions remain authoritative.
export function reviewBlocker(line, doc) {
  const errors = lineErrorsForReview(line, doc);
  if (!line.product_id || line.match?.source === 'ai') return { field: 'product', reason: 'จับคู่สินค้านี้ก่อน' };
  if (line.counted_quantity == null && !line._countConfirmed) return { field: 'quantity_received', reason: 'กรอกจำนวนที่ตรวจจริงหลังเปิดบิล' };
  if (errors) return errors;
  const decision = rowDecision(line, doc);
  if (decision.kind === 'waiting_bill') return { field: 'quantity_billed', reason: 'อ่านบิลหรือกรอกจำนวนบิลก่อน' };
  // Bug hunt 2026-10-24: a line without an order compares the bill unit with the product, not an order.
  if (decision.kind === 'wrong_product') return { field: 'unit', reason: line.order_item_id && line.ordered_unit ? 'ตรวจหน่วยบิลกับใบสั่งก่อนรับ' : 'ตรวจหน่วยบิลกับสินค้าก่อนรับ' };
  if (line.match?.source === 'alias') return { field: 'decision', reason: 'ตรวจการจับคู่จากชื่อย่อและยืนยันทีละรายการ' };
  return { field: 'decision', reason: decision.label === 'ตรง' ? 'ยืนยันรายการที่ตรวจตรงแล้ว' : decision.label };
}
function lineErrorsForReview(line, doc) {
  const errors = lineErrors(line, doc.kind);
  for (const field of ['quantity_received', 'quantity_billed', 'unit_price']) {
    if (errors[field]) return { field, reason: errors[field] };
  }
  return errors.amount ? { field: 'unit_price', reason: errors.amount } : null;
}

export function reviewMilestones(step, counted = false, quick = false) {
  const current = step === 'images' ? counted ? 'compare' : 'count' : step;
  return (quick ? [['count', 'นับ'], ['compare', 'เซ็น']] : [['count', 'นับ'], ['compare', 'ตรวจ'], ['summary', 'สรุป'], ['sign', 'เซ็น']])
    .map(([value, label]) => ({ value, label, current: value === current }));
}

// Owner 2026-10-28 "หน้าที่ของพนักงานแค่รับสินค้าให้ตรงเท่านั้น": staff count and sign. Every row then takes the
// decision it already proposes and price, bill and product questions go to accounting (the server opens the follow-up).
// Admin and accounting keep the full review with prices and per-row decisions.
export const staffReceiving = user => !['admin', 'super_admin', 'accounting', 'accountant'].includes(user?.role);
// A product the AI guessed still needs a person (the server refuses to confirm it); a row not received needs no answer.
export const needsProductCheck = line => !line.review_decision && line.match?.source === 'ai' && Number(line.quantity_received) > 0;
export function autoDecision(line, doc) {
  if (doc.kind === 'manual_receipt') return 'missing_bill';
  if (needsProductCheck(line)) return null;
  // An AI-guessed row that did not come: what it is does not matter for stock, only that the bill listed it.
  if (line.match?.source === 'ai') return Number(line.quantity_billed || 0) > 0 ? 'short' : 'not_delivered';
  const decision = rowDecision(line, doc);
  if (decision.invalid) return null;
  // No product in the catalogue: received for now, accounting links it (owner 2026-10-24 "รับไปก่อนแล้วตามหลัง").
  if (!line.product_id && !line.order_item_id) return Number(line.quantity_received) > 0 ? 'receive_unmatched' : 'short';
  return decision.kind;
}
// Undecided rows with their automatic decision; null when nothing changes.
export function withAutoDecisions(doc) {
  let changed = false;
  const lines = doc.lines.map(line => {
    if (line.review_decision) return line;
    const decision = autoDecision(line, doc);
    if (!decision) return line;
    changed = true;
    // Only a person teaches a bill name: an AI guess or a row without a product is never remembered.
    const unlearned = decision === 'receive_unmatched' || decision === 'not_delivered' || line.match?.source === 'ai';
    return { ...line, review_decision: decision, ...(unlearned ? { remember_alias: false } : {}),
      ...(line.match?.source === 'ai' ? { match: { source: 'manual', confidence: 1 } } : {}) };
  });
  return changed ? { ...doc, lines } : null;
}
