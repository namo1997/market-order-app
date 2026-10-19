import { receiptDecisionText } from '../../receiving/review-a.js';
import { reviewLedger } from '../../receiving/review-ledger.js';
import { decimalString } from '../../receiving/receiving-utils.js';

const actions = { create: 'สร้างใบรับ', upload_image: 'เพิ่มรูปบิล', ocr: 'อ่านบิลด้วย AI', update: 'แก้ไขใบรับ', sign: 'ลงลายเซ็น', confirm: 'ยืนยันรับสินค้า', void: 'ยกเลิกใบรับ', blind_count: 'บันทึกการนับ', edit_after_bill_reveal: 'แก้ไขหลังเปิดบิล' };
export function auditDescription(audit) {
  if (audit.action === 'edit_after_bill_reveal' && audit.decisions?.length) return audit.decisions
    .map(line => `ตัดสินใจ ${line.product_name || 'ไม่ระบุสินค้า'}: ${receiptDecisionText(line)}`).join(' · ');
  const label = actions[audit.action] || 'เหตุการณ์ที่ยังไม่รองรับ';
  return `${label}${audit.line_count != null ? ` ${audit.line_count} รายการ` : ''}`;
}
// Reuse integer-money valuation including legacy amount-only and unknown-price rows.
export function receivedLineValue(line) {
  if (line.quantity_received == null || line.quantity_received === '') return null;
  try {
    const value = reviewLedger({ lines: [line] });
    return value.missingPrice ? null : decimalString(value.received);
  } catch { return null; }
}
