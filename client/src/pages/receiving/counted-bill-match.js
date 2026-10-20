import { normalizeReceivingUnit } from './receiving-status.js';

// Move bill facts onto the original count row; never copy/replace count evidence.
export function countedBillTargets(doc, bill) {
  if (doc.scope === 'branch' || !doc.counted_complete_at || doc.ocr?.status !== 'done' ||
    bill.counted_quantity != null || bill.review_decision || !bill.bill_text) return [];
  return doc.lines.filter(row => row.id !== bill.id && row.product_id && row.counted_quantity != null &&
    !row.review_decision && !row.bill_text && row.quantity_billed == null &&
    (!bill.unit_text || normalizeReceivingUnit(bill.unit_text) === normalizeReceivingUnit(row.unit_text)));
}

export function matchBillToCount(doc, billId, targetId) {
  const bill = doc.lines.find(row => row.id === billId);
  const target = bill && countedBillTargets(doc, bill).find(row => row.id === targetId);
  if (!target) return null;
  return { ...doc, has_receiver_signature: false, has_courier_signature: false,
    lines: doc.lines.filter(row => row.id !== billId).map(row => row.id === targetId ? { ...row,
      bill_text: bill.bill_text, quantity_billed: bill.quantity_billed, unit_price: bill.unit_price,
      amount: bill.amount, match: { source: 'manual', confidence: 1 }, remember_alias: false,
      review_decision: null } : row) };
}
