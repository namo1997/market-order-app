import type { Row } from './api';

export type Bucket = 'review' | 'needs_amount' | 'bill' | 'slip' | 'other' | 'done';

export function itemAmount(item: Row) {
  return Number(item.bill_total_value ?? item.slip_amount_value ?? item.bill_total ?? item.transfer_amount ?? item.amount ?? 0);
}

export function classifyItem(item: Row): Bucket {
  if (item.match_status === 'confirmed') return 'done';
  if (item.amount_review_flag || item.needs_amount_review || item.needs_amount || item.match_status === 'needs_amount') return 'needs_amount';
  if (['pending', 'manual_review'].includes(String(item.match_status || ''))) return 'review';
  if (['bill', 'bill_page'].includes(String(item.category))) return 'bill';
  if (['transfer', 'transfer_notice'].includes(String(item.category))) return 'slip';
  return 'other';
}

export function urgency(day: Row) {
  return Number(day.needs_amount_count ?? day.needs_amount ?? 0) * 1000
    + Number(day.pending_count ?? day.pending ?? day.pending_matches ?? 0) * 100
    + Number(day.unmatched_count ?? day.unmatched ?? 0) * 10
    + Number(day.item_count || day.total_items || 0);
}

export function equalAmounts(bills: Row[], slips: Row[]) {
  const billTotal = bills.reduce((sum, item) => sum + itemAmount(item), 0);
  const slipTotal = slips.reduce((sum, item) => sum + itemAmount(item), 0);
  return { billTotal, slipTotal, difference: billTotal - slipTotal };
}
