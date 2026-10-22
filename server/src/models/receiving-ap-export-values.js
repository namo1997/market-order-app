import { scaledInteger, decimalString } from '../utils/receiving-value.js';
import { buildSupplierKey } from '../services/receiving-ocr.service.js';

const present = value => value !== null && value !== undefined && value !== '';
const money = value => present(value) ? Number(scaledInteger(value)) : null;
const id = value => value == null ? null : Number(value);
export const bangkokTimestamp = epoch => epoch == null ? null
  : `${new Date(Number(epoch) * 1000 + 7 * 3600000).toISOString().slice(0, 23)}+07:00`;

// Quantity is already the received count, not the billed count. Keep six price
// decimals until extending it, then use the existing half-up satang rule.
export function exportLine(row) {
  const quantity = scaledInteger(row.quantity_received ?? 0);
  // Priced by weight: the bill amount is what the received pieces cost; price per piece = amount / pieces.
  const byWeight = Number(row.price_by_weight || 0) === 1 && present(row.amount) && quantity > 0n;
  // A bill piece count (handwritten "10ต") prices each piece; otherwise the amount covers the pieces received.
  const pieces = byWeight && present(row.quantity_billed) && scaledInteger(row.quantity_billed) > 0n ? scaledInteger(row.quantity_billed) : quantity;
  let price = null;
  if (byWeight) price = (scaledInteger(row.amount, 6) * 100n + pieces / 2n) / pieces;
  else if (present(row.base_unit_price)) price = scaledInteger(row.base_unit_price, 6);
  else if (present(row.unit_price)) {
    const multiplier = scaledInteger(row.unit_multiplier ?? 1, 4);
    if (multiplier === 0n) throw new Error('Invalid receiving unit multiplier');
    price = (scaledInteger(row.unit_price, 6) * 10000n + multiplier / 2n) / multiplier;
  }
  const amount = quantity === 0n ? 0 : byWeight && pieces === quantity ? Number(scaledInteger(row.amount)) : price === null ? null
    : Number((quantity * price + 500000n) / 1000000n);
  if (amount !== null && !Number.isSafeInteger(amount)) throw new Error('Invalid receiving line value');
  return { line_id: Number(row.id), product_id: id(row.product_id), product_name: row.product_name ?? null,
    item_code: row.item_code ?? null, bill_text: row.bill_text || '',
    quantity_received: decimalString(quantity), unit: row.unit_text || row.unit || null,
    unit_price_satang: price === null ? null : Number((price + 5000n) / 10000n),
    amount_satang: amount, decision: row.review_decision ?? null };
}

export function exportDocument(row, lineRows, issues) {
  const lines = lineRows.map(exportLine);
  const statement = row.export_ocr_kind === 'statement' && lines.length === 0;
  const value = statement ? 0 : !lines.length || lines.some(line => line.amount_satang === null) ? null
    : lines.reduce((total, line) => total + line.amount_satang, 0);
  if (value !== null && !Number.isSafeInteger(value)) throw new Error('Invalid receiving value');
  const branchCode = row.branch_ap_code?.trim() || null, masterCode = row.master_ap_code?.trim() || null;
  return { document_id: Number(row.id), status: row.status,
    updated_at: bangkokTimestamp(row.updated_epoch), confirmed_at: bangkokTimestamp(row.confirmed_epoch),
    voided_at: bangkokTimestamp(row.voided_epoch), receipt_date: row.receipt_date,
    branch: { id: Number(row.branch_id), code: row.branch_code ?? null, name: row.branch_name ?? null },
    department: { id: id(row.department_id), name: row.department_name ?? null },
    receiving_scope: row.receiving_scope || 'department',
    supplier: { key: buildSupplierKey({ supplierMasterId: row.supplier_master_id,
      productGroupId: row.product_group_id, supplierNameText: row.supplier_name_text }),
      master_id: id(row.supplier_master_id), product_group_id: id(row.product_group_id),
      name: row.supplier_name_text || row.master_name || row.group_name || '',
      ap_code: branchCode || masterCode, ap_code_source: branchCode ? 'branch_code' : masterCode ? 'master_code' : 'none' },
    doc_kind: statement ? 'statement_only' : row.kind === 'manual_receipt' ? 'no_bill' : 'bill',
    doc_ref: row.doc_ref ?? null, doc_date: row.export_doc_date ?? null,
    bill_totals_satang: { subtotal: money(row.subtotal), discount: money(row.discount), vat: money(row.vat), total: money(row.total) },
    received_value_satang: value, price_status: value === null ? 'needs_accounting_price' : 'from_bill',
    lines, open_issues: [...new Map(issues.map(issue => ({ type: issue.export_type || (issue.type === 'shortage' ? 'short' : issue.type),
      status: issue.status === 'waiting_supplier' ? 'open' : issue.status,
      credit_note_ref: issue.resolution === 'credit_note' ? issue.resolution_ref ?? null : null }))
      .map(issue => [JSON.stringify(issue), issue])).values()],
    image_count: Number(row.image_count || 0) };
}
