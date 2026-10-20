import { reviewLedger, decimalString } from '../utils/receiving-value.js';
import { aggregateBranchLines } from './receiving-branch-policy.js';

// Keep missing line coverage unknown. In particular, an old header without
// lines cannot establish that the supplier delivered goods worth zero baht.
function valuation(doc) {
  if (doc.blind || !doc.lines?.length) return null;
  try {
    // The app receives grouped product/unit rows for branch-wide receipts.
    // Group first, then round: splitting one product over departments must not
    // add a cent or multiply the number of pending-price items in accounting.
    const lines = (doc.scope || doc.receiving_scope) === 'branch' ? aggregateBranchLines(doc.lines) : doc.lines;
    return reviewLedger({ ...doc, lines });
  } catch {
    // Invalid legacy data is incomplete coverage, never a zero-valued receipt.
    return null;
  }
}
export function receiptValue(doc) {
  const ledger = valuation(doc);
  if (!ledger) return null;
  return { received_known: decimalString(ledger.received), received_net: decimalString(ledger.receivedNet),
    pending_price_count: ledger.pendingPrices.length };
}

const columns = `line.id, line.product_id, line.unit_id, line.branch_weight, line.order_item_id,
  line.branch_department_id, line.counted_quantity, line.quantity_received, line.quantity_billed,
  line.unit_price, line.amount, line.review_decision`;

export async function confirmedValues(db, filters) {
  const [rows] = await db.query(`SELECT rd.id AS ledger_document_id, rd.receiving_scope, rd.total, rd.discount, rd.vat,
    ${columns} FROM receiving_documents rd
    LEFT JOIN receiving_document_lines line ON line.document_id = rd.id
    ${filters.where} AND rd.status = 'confirmed' ORDER BY rd.id, line.id`, filters.params);
  const docs = new Map();
  for (const row of rows) {
    const key = Number(row.ledger_document_id);
    if (!docs.has(key)) docs.set(key, { ...row, lines: [] });
    if (row.id != null) docs.get(key).lines.push(row);
  }
  let known = 0n, net = 0n, pending = 0, unknown = 0;
  for (const doc of docs.values()) {
    const ledger = valuation(doc);
    if (!ledger) { unknown++; continue; }
    known += ledger.received; net += ledger.receivedNet; pending += ledger.pendingPrices.length;
  }
  return { received_known_total: decimalString(known), received_net_total: decimalString(net),
    pending_price_count: pending, unvalued_document_count: unknown };
}

export async function pageValues(db, rows) {
  const ids = rows.filter(row => row.status !== 'draft' || row.counted_complete_at).map(row => row.id);
  if (!ids.length) return new Map();
  const [lines] = await db.query(`SELECT line.document_id, ${columns}
    FROM receiving_document_lines line WHERE line.document_id IN (${ids.map(() => '?').join(',')})
    ORDER BY line.document_id, line.id`, ids);
  const grouped = new Map(ids.map(id => [Number(id), []]));
  for (const line of lines) grouped.get(Number(line.document_id))?.push(line);
  return new Map(rows.map(row => [Number(row.id), receiptValue({ ...row, lines: grouped.get(Number(row.id)) })]));
}
