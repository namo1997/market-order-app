import { warningText } from './receiving-utils.js';

// Count items once, even when the same item has several reasons to check.
// Bill-level issues have their own group, never inflate the item count.
export function reviewSummary(doc, lineStates, warnings, money) {
  const rows = doc.lines.map((line, index) => {
    const lineNo = Number(line.line_no || index + 1);
    const reasons = [line._aiProposal && 'ตรวจข้อเสนอ AI กับบิล',
      lineStates[index].status !== 'ok' && lineStates[index].label,
      ...warnings.filter(warning => Number(warning.line_no) === lineNo).map(warningText)].filter(Boolean);
    return { index, lineNo, title: line.product_name || line.bill_text || `รายการ ${lineNo}`, reasons: [...new Set(reasons)] };
  }).filter(row => row.reasons.length).sort((a, b) => a.lineNo - b.lineNo || a.index - b.index);
  const documentReasons = [...new Set([
    !doc.lines.length && 'ยังไม่มีรายการ อ่านบิลหรือเพิ่มรายการจากรายละเอียด',
    money.status !== 'ok' && money.label,
    ...warnings.filter(warning => !doc.lines.some((line, index) => Number(warning.line_no) === Number(line.line_no || index + 1))).map(warningText),
  ].filter(Boolean))];
  return { rows, documentReasons, hasIssues: !!(rows.length || documentReasons.length),
    label: rows.length ? `ตรวจ ${rows.length} รายการ` : documentReasons.length ? 'ตรวจข้อมูลบิล' : 'ตรงใบสั่ง' };
}
