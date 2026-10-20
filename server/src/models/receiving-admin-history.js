const decisions = ['accept', 'short', 'over', 'over_order', 'not_delivered', 'wrong_product', 'price_review', 'missing_bill', 'not_received'];
const quantity = value => value != null && /^\d+(?:\.\d{1,6})?$/.test(String(value)) ? String(value) : null;
const text = value => typeof value === 'string' ? value.slice(0, 255) : null;

// Only display fields leave the audit store. Never expose raw OCR/provider data.
export function decisionSnapshot(line) {
  return { id: Number(line.id), product_name: text(line.product_name), unit_text: text(line.unit_text),
    counted_quantity: quantity(line.counted_quantity), quantity_received: quantity(line.quantity_received),
    quantity_billed: quantity(line.quantity_billed), review_decision: line.review_decision,
    return_status: ['waiting', 'collected'].includes(line.return_status) ? line.return_status : null };
}
export function adminAudit(row, blind = false) {
  const result = { id: row.id, action: row.action, actor_name: row.actor_name, created_at: row.created_at };
  let details;
  try { details = JSON.parse(row.details_json || '{}'); } catch { return result; }
  if (!details || typeof details !== 'object') return result;
  if (row.action === 'blind_count' && Array.isArray(details.lines)) result.line_count = details.lines.length;
  if (row.action === 'edit_after_bill_reveal') {
    if (Number.isSafeInteger(details.updated_lines_count) && details.updated_lines_count >= 0) result.line_count = details.updated_lines_count;
    if (!blind && Array.isArray(details.decisions)) result.decisions = details.decisions
      .filter(line => line && decisions.includes(line.review_decision)).map(decisionSnapshot);
  }
  return result;
}
