import type { Row } from './api';

export type Bucket = 'ai_pending' | 'review' | 'needs_amount' | 'bill' | 'slip' | 'support' | 'other' | 'done';

export function itemAmount(item: Row) {
  if (item.category === 'bill' || item.category === 'bill_page') {
    return Number(item.bill_total_value ?? item.bill_total ?? item.amount ?? 0);
  }
  if (['transfer', 'transfer_notice', 'incoming_transfer'].includes(String(item.category || ''))) {
    return Number(item.slip_amount_value ?? item.transfer_amount ?? item.amount ?? 0);
  }
  return Number(item.bill_total_value ?? item.slip_amount_value ?? item.bill_total ?? item.transfer_amount ?? item.amount ?? 0);
}

export function classifyItem(item: Row): Bucket {
  if (['unsent', 'duplicate'].includes(String(item.status || ''))) return 'other';
  if (item.match_status === 'confirmed') return 'done';
  if (!item.generated_document_type && ['pending', 'processing', 'failed', 'paused'].includes(String(item.ai_status || ''))) return 'ai_pending';
  if (item.amount_review_flag || item.needs_amount_review || item.needs_amount || item.match_status === 'needs_amount') return 'needs_amount';
  if (['pending', 'manual_review'].includes(String(item.match_status || ''))) return 'review';
  if (['bill', 'bill_page'].includes(String(item.category))) return 'bill';
  if (['transfer', 'transfer_notice'].includes(String(item.category))) return 'slip';
  if (item.category === 'payment_voucher') return 'support';
  return 'other';
}

export function urgency(day: Row) {
  return Number(day.needs_amount_count ?? day.needs_amount ?? 0) * 1000
    + Number(day.pending_count ?? day.pending ?? day.pending_matches ?? 0) * 100
    + Number(day.unmatched_count ?? day.unmatched ?? 0) * 10
    + Number(day.processing_count ?? day.ai_pending_count ?? 0);
}

export function selectNextRound(rows: Row[], today: string) {
  const open = rows.filter((row) => row.closing_status !== 'closed' && urgency(row) > 0);
  return [...open].sort((a, b) => {
    const aToday = a.business_date === today ? 1 : 0;
    const bToday = b.business_date === today ? 1 : 0;
    if (aToday !== bToday) return bToday - aToday;
    const dateOrder = String(b.business_date || '').localeCompare(String(a.business_date || ''));
    return dateOrder || urgency(b) - urgency(a) || String(a.source_id || '').localeCompare(String(b.source_id || ''));
  })[0];
}

export function rankCandidates(rows: Row[], amount: number, sourceId: string, date: string) {
  return [...rows].sort((a, b) => {
    const aDiff = Math.abs(itemAmount(a) - amount);
    const bDiff = Math.abs(itemAmount(b) - amount);
    if (Math.abs(aDiff - bDiff) > .009) return aDiff - bDiff;
    const aSameSource = a.source_id === sourceId ? 1 : 0;
    const bSameSource = b.source_id === sourceId ? 1 : 0;
    if (aSameSource !== bSameSource) return bSameSource - aSameSource;
    const aDate = Math.abs(new Date(`${businessDateForSort(a)}T12:00:00+07:00`).getTime() - new Date(`${date}T12:00:00+07:00`).getTime());
    const bDate = Math.abs(new Date(`${businessDateForSort(b)}T12:00:00+07:00`).getTime() - new Date(`${date}T12:00:00+07:00`).getTime());
    return aDate - bDate || Number(b.event_timestamp_ms || 0) - Number(a.event_timestamp_ms || 0);
  });
}

export type GroupDocumentSort = 'ai' | 'date_asc' | 'date_desc';

export function groupDocumentAvailable(item: Row) {
  if (['unsent', 'duplicate'].includes(String(item.status || ''))) return false;
  if (Number(item.cash_payment_id || 0)) return false;
  if (Number(item.amount_review_flag || 0) || item.match_status === 'needs_amount') return false;
  if (['pending', 'manual_review', 'confirmed'].includes(String(item.match_status || ''))) return false;
  return itemAmount(item) > 0;
}

export function rankGroupDocuments(rows: Row[], anchorDate: string, mode: GroupDocumentSort) {
  const anchor = new Date(`${anchorDate}T12:00:00+07:00`).getTime();
  const timestamp = (row: Row) => Number(row.event_timestamp_ms || 0)
    || new Date(`${businessDateForSort(row)}T12:00:00+07:00`).getTime();
  return [...rows].sort((a, b) => {
    const aTime = timestamp(a); const bTime = timestamp(b);
    if (mode === 'date_asc') return aTime - bTime || Number(a.id || 0) - Number(b.id || 0);
    if (mode === 'date_desc') return bTime - aTime || Number(b.id || 0) - Number(a.id || 0);
    const aDone = a.ai_status === 'done' || Boolean(a.category_edited_at) || Boolean(a.generated_document_type) ? 1 : 0;
    const bDone = b.ai_status === 'done' || Boolean(b.category_edited_at) || Boolean(b.generated_document_type) ? 1 : 0;
    if (aDone !== bDone) return bDone - aDone;
    const aConfidence = Number(a.ai_confidence ?? a.ai_category_confidence ?? 0);
    const bConfidence = Number(b.ai_confidence ?? b.ai_category_confidence ?? 0);
    if (Math.abs(aConfidence - bConfidence) > .0001) return bConfidence - aConfidence;
    return Math.abs(aTime - anchor) - Math.abs(bTime - anchor) || aTime - bTime || Number(a.id || 0) - Number(b.id || 0);
  });
}

function businessDateForSort(item: Row) {
  const timestamp = Number(item?.event_timestamp_ms || 0);
  if (timestamp) return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(timestamp));
  return String(item?.business_date || item?.created_at || '').slice(0, 10) || '1970-01-01';
}

export function equalAmounts(bills: Row[], slips: Row[]) {
  const billTotal = bills.reduce((sum, item) => sum + itemAmount(item), 0);
  const slipTotal = slips.reduce((sum, item) => sum + itemAmount(item), 0);
  return { billTotal, slipTotal, difference: billTotal - slipTotal };
}
