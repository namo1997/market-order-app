import { normalizeReceivingUnit } from './receiving-status.js';

// Client-side twin of the server's normalizeMatchText/computeTextSimilarity (those modules pull in
// server-only code). Thai has no spaces, so compare character bigrams after dropping tone marks.
// No similarity cut-off: supplier abbreviations ("โม่", "ทB") are unrelated to product names, so
// similarity only orders the safe candidates; the in-card confirm step guards against mis-taps.
const MATCH_MAX_SUGGESTIONS = 5;
export const normalizeMatchText = value => String(value || '').normalize('NFC').toLowerCase()
  .replace(/[​-‍﻿]/g, '').replace(/\(\s*ญ\.?\s*\)/g, ' ใหญ่ ')
  .replace(/[็-๎]/g, '').replace(/[()[\]{}"'`.,/#!$%^&*;:=\-_~@+?<>|\\\s]+/g, '');
const bigrams = text => { const map = new Map(); for (let i = 0; i < text.length - 1; i += 1) { const key = text.slice(i, i + 2); map.set(key, (map.get(key) || 0) + 1); } return map; };
export function billNameSimilarity(a, b) {
  const x = normalizeMatchText(a), y = normalizeMatchText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const left = bigrams(x), right = bigrams(y); let shared = 0;
  for (const [key, count] of left) shared += Math.min(count, right.get(key) || 0);
  const smaller = Math.min(x.length, y.length) - 1;
  return smaller > 0 ? shared / smaller : 0;
}

// A blank or generic "หน่วย" unit is unknown, not different; two known units must agree.
const knownUnit = value => { const unit = normalizeReceivingUnit(value); return unit && unit !== 'หน่วย' ? unit : ''; };
const unitsCompatible = (a, b) => !knownUnit(a) || !knownUnit(b) || knownUnit(a) === knownUnit(b);

// Move bill facts onto the original count row; never copy/replace count evidence.
// Candidates are safe rows only, then ranked by name similarity (best first, no cut-off).
export function countedBillTargets(doc, bill) {
  if (doc.scope === 'branch' || !doc.counted_complete_at || doc.ocr?.status !== 'done' ||
    bill.counted_quantity != null || bill.review_decision || !bill.bill_text) return [];
  return doc.lines.filter(row => row.id !== bill.id && row.product_id && row.counted_quantity != null &&
    Number(row.counted_quantity) > 0 &&
    !row.review_decision && !row.bill_text && row.quantity_billed == null &&
    unitsCompatible(bill.unit_text, row.unit_text))
    .map(row => ({ row, score: billNameSimilarity(bill.bill_text, row.product_name) }))
    .sort((a, b) => b.score - a.score).slice(0, MATCH_MAX_SUGGESTIONS).map(item => item.row);
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
