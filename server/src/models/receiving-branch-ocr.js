import { aggregateBranchLines, branchLineGroups, expandBranchUpdate } from './receiving-branch-policy.js';
import { createReceivingError, formatQuantity, normalizeMatchText, toMilliQtyInt, fromMilliQtyInt,
  matchOcrLinesToCatalog } from '../services/receiving-ocr.service.js';

// Only linked order items from the document's branch become provider context.
export function branchOcrExpectedItems(rows) {
  return branchLineGroups(rows).map(parts => ({ ...parts[0],
    quantity_ordered: formatQuantity(fromMilliQtyInt(parts.reduce((total, row) =>
      total + toMilliQtyInt(row.quantity_ordered), 0)), { allowNull: false })
  }));
}

export function mergeBranchOcrLines({ existingLines, ocrLines, aliases, expectedItems, units, supplierKey }) {
  const groups = branchLineGroups(existingLines);
  const anchors = aggregateBranchLines(existingLines);
  const seen = new Set();
  const patches = new Map();
  for (const read of ocrLines) {
    const unit = units.find(unit => [unit.name, unit.abbreviation].some(text =>
      normalizeMatchText(text) && normalizeMatchText(text) === normalizeMatchText(read.unit_text)));
    const candidates = expectedItems.filter(item => !unit || Number(item.unit_id) === Number(unit.id));
    const billUnit = normalizeMatchText(read.unit_text);
    const scopedAliases = aliases.filter(alias => !billUnit || !normalizeMatchText(alias.unit_text) ||
      normalizeMatchText(alias.unit_text) === billUnit);
    const [matched] = matchOcrLinesToCatalog({ ocrLines: [read], aliases: scopedAliases, expectedItems: candidates, units, supplierKey });
    const possible = candidates.filter(item => Number(item.product_id) === Number(matched.product_id));
    const anchor = anchors.find(line => Number(line.product_id) === Number(matched.product_id) &&
      Number(line.unit_id) === Number(matched.unit_id));
    const aliasUnit = matched.match.source === 'alias' && scopedAliases.some(alias =>
      Number(alias.product_id) === Number(matched.product_id) && normalizeMatchText(alias.unit_text) === billUnit);
    const unknownUnit = billUnit && !unit && !aliasUnit &&
      !possible.some(item => normalizeMatchText(item.unit_name) === billUnit);
    if (!anchor || possible.length !== 1 || !matched.order_item_id || seen.has(anchor.id) || unknownUnit) {
      throw createReceivingError('VALIDATION_FAILED', 'อ่านบิลสาขาแล้วมีรายการที่จับคู่ไม่ได้ หน่วยไม่ตรง หรือสินค้าซ้ำ กรุณาตรวจรูปและกรอกยอดรวมเอง');
    }
    seen.add(anchor.id);
    // Provider quantities are bill evidence only; preserve the physical count.
    const billFields = { ...matched };
    delete billFields.quantity_received;
    patches.set(anchor.id, { ...billFields, id: anchor.id, unit_id: anchor.unit_id,
      order_item_id: anchor.order_item_id, ocr_line_no: read.line_no });
  }
  return groups.flatMap(parts => {
    // Identity-based preservation works even when bill order differs from order lines.
    if (parts.some(line => line.is_user_edited || line.match_source === 'manual')) return parts;
    const anchor = parts[0];
    const patch = patches.get(anchor.id) || { id: anchor.id, bill_text: '', quantity_billed: null,
      unit_price: null, base_unit_price: null, amount: null,
      match: { source: 'order', confidence: 0.4 } };
    const { lines } = expandBranchUpdate({ lines: [patch] }, parts);
    return lines.map((line, i) => ({ ...parts[i], ...line, is_user_edited: false }));
  });
}

// Keep physical IDs, branch weights and department ownership for confirm/void.
// Use the same update shape as the ordinary editor; never delete/recreate branch lines.
export async function persistBranchOcrLines(connection, documentId, lines) {
  for (const line of lines) {
    if (line.is_user_edited || line.match_source === 'manual') continue;
    await connection.query(
      `UPDATE receiving_document_lines SET bill_text = ?, quantity_billed = ?, unit_price = ?, base_unit_price = NULL, amount = ?, match_source = ?, match_confidence = ?, review_decision = NULL WHERE id = ? AND document_id = ?`,
      [line.bill_text || '', line.quantity_billed, line.unit_price, line.amount,
        line.match?.source || line.match_source, line.match?.confidence ?? line.match_confidence,
        line.id, documentId]
    );
  }
}
