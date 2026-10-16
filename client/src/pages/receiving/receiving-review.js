import { warningText } from './receiving-utils.js';
import { moneyStatus, quantityStatus, priceCompleteness } from './receiving-status.js';

// Saved hints for quantities/money/products are superseded by live values.
const derivedCodes = new Set(['SUM_MISMATCH', 'TOTAL_EQUATION_MISMATCH', 'QTY_SHORT', 'QTY_OVER', 'UNMATCHED_LINE']);
export function reviewWarnings(doc) {
  const seen = new Set();
  return [...(doc.warnings || []), ...(doc.ocr?.warnings || [])]
    .map(warning => typeof warning === 'string' ? { code: warning } : warning)
    .filter(warning => {
      const key = `${warning.code}:${Number(warning.line_no || 0)}`;
      if (derivedCodes.has(warning.code) || seen.has(key)) return false;
      seen.add(key); return true;
    });
}

// Human review work and data warnings are independent. Acknowledging AI alone
// must never remove a warning or inflate the number of products with warnings.
export function reviewSummary(doc, lineStates, warnings, money) {
  const seen = new Set();
  const unique = warnings.filter(warning => {
    const key = `${warning.code}:${Number(warning.line_no || 0)}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const rows = doc.lines.map((line, index) => {
    const lineNo = Number(line.line_no || index + 1);
    const reasons = [lineStates[index].status !== 'ok' && lineStates[index].label,
      ...unique.filter(warning => Number(warning.line_no) === lineNo).map(warningText)].filter(Boolean);
    return { index, lineNo, title: line.product_name || line.bill_text || `รายการ ${lineNo}`, reasons };
  }).filter(row => row.reasons.length).sort((a, b) => a.lineNo - b.lineNo || a.index - b.index);
  const documentReasons = [
    !doc.lines.length && 'ยังไม่มีรายการ อ่านบิลหรือเพิ่มรายการจากรายละเอียด',
    money.status !== 'ok' && money.label,
    ...unique.filter(warning => !doc.lines.some((line, index) => Number(warning.line_no) === Number(line.line_no || index + 1)))
      .map(warning => `${warning.line_no ? `รายการ ${warning.line_no} (ไม่พบในเอกสาร): ` : 'ทั้งบิล (ไม่ระบุรายการ): '}${warningText(warning)}`),
  ].filter(Boolean);
  const itemCount = rows.length;
  const documentCount = documentReasons.length;
  const unreviewedCount = doc.lines.filter(line => line._aiProposal).length;
  const pricing = priceCompleteness(doc.lines);
  return { rows, documentReasons, itemCount, documentCount, unreviewedCount, pricing,
    warningLabel: `ข้อเตือนสินค้า ${itemCount} รายการ · ข้อสังเกตบิล ${documentCount} ข้อ`,
    dataHasIssues: !!(itemCount || documentCount || pricing.missingCount),
    hasIssues: !!(unreviewedCount || itemCount || documentCount || pricing.missingCount),
    label: `ยังไม่ตรวจ ${unreviewedCount} รายการ · ข้อเตือนสินค้า ${itemCount} รายการ · ข้อสังเกตบิล ${documentCount} ข้อ` };
}

export function documentReviewSummary(doc, expectedItems) {
  return reviewSummary(doc, doc.lines.map(line => quantityStatus(line, expectedItems, doc.lines, doc.kind)), reviewWarnings(doc),
    moneyStatus(doc.lines, doc.discount, doc.vat, doc.total, doc.subtotal));
}

// Visible context contains only work that needs attention; full counts remain in details.
export function reviewAttention(checks) {
  const over = checks.rows.filter(row => row.reasons.some(reason => reason.startsWith('เกิน '))).length;
  const short = checks.rows.filter(row => row.reasons.some(reason => reason.startsWith('ขาด '))).length;
  return [checks.unreviewedCount && `ยังไม่ตรวจ ${checks.unreviewedCount} รายการ`,
    over && `สินค้าเกิน ${over} รายการ`, short && `สินค้าขาด ${short} รายการ`,
    checks.itemCount > over + short && `ข้อเตือนสินค้า ${checks.itemCount - over - short} รายการ`,
    checks.documentCount && `ข้อสังเกตบิล ${checks.documentCount} ข้อ`, checks.pricing.label].filter(Boolean).join(' / ');
}

// Compare displayed content, including reasons, rather than counts alone.
export const reviewFingerprint = checks => JSON.stringify([checks.unreviewedCount, checks.rows,
  checks.documentReasons, checks.pricing]);

// Describe changed content even when warning counts stay equal.
export function reviewChangeMessage(before, after) {
  const changed = [
    ['unreviewedCount', 'ยังไม่ตรวจ', 'รายการ'], ['itemCount', 'ข้อเตือนสินค้า', 'รายการ'],
    ['documentCount', 'ข้อสังเกตบิล', 'ข้อ'],
  ].filter(([key]) => before[key] !== after[key]).map(([key, label, unit]) => `${label} ${before[key]}→${after[key]} ${unit}`);
  if (before.pricing.missingCount !== after.pricing.missingCount) changed.push(`ยังไม่มีราคา ${before.pricing.missingCount}→${after.pricing.missingCount} รายการ`);
  return `สรุปเปลี่ยน: ${changed.join(' / ') || 'รายละเอียดข้อเตือนเปลี่ยน กรุณาตรวจอีกครั้ง'}`;
}
