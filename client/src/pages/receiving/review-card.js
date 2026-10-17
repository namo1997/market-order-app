import { formatBaht, scaledInteger } from './receiving-utils.js';
import { thaiDate } from './receiving-status.js';

export function matchLabel(line) {
  if (line.match?.source === 'alias') return 'จำชื่อย่อร้านนี้';
  if (line.match?.source === 'order') return 'ตรงกับที่สั่ง';
  if (line.match?.source === 'ai' || (!line.product_id && line.suggested_product_name)) return 'AI เดา — ยืนยัน';
  if (line.product_id && line.match?.source === 'none') return 'เลือกแล้ว — ตรวจตัวเลข';
  return line.match?.source === 'manual' ? 'เลือกเอง' : 'ยังไม่จับคู่';
}

export function ocrReadSummary(doc) {
  const raw = doc.ocr?.raw_read;
  if (!raw) return 'ผลอ่านบิลเดิม ไม่มีสรุปข้อความดิบ';
  let amount = 'ไม่พบยอดรวม';
  try { if (raw.total != null) amount = `ยอด ${formatBaht(scaledInteger(raw.total))} บาท`; } catch { /* Invalid saved metadata remains unknown. */ }
  return `AI อ่าน: ${raw.doc_date ? thaiDate(raw.doc_date) : 'ไม่พบวันที่'} / ${amount} / ${raw.line_count} บรรทัด / ต้องยืนยัน ${doc.lines.filter(line => line._aiProposal).length} บรรทัด`;
}
