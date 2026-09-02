import { describe, expect, it } from 'vitest';
import { classifyItem, equalAmounts, groupDocumentAvailable, itemAmount, rankCandidates, rankGroupDocuments, selectNextRound, urgency } from './domain';

describe('mobile workflow rules', () => {
  it('puts amount flags before unmatched categories', () => {
    expect(classifyItem({ category: 'bill', needs_amount_review: 1 })).toBe('needs_amount');
  });

  it('recognises confirmed items as done', () => {
    expect(classifyItem({ category: 'transfer', match_status: 'confirmed' })).toBe('done');
    expect(classifyItem({ category: 'bill', match_status: 'confirmed', generated_document_type: 'receipt_substitute', ai_status: 'pending' })).toBe('done');
  });

  it('uses the amount belonging to the current document type', () => {
    expect(itemAmount({ category: 'transfer', bill_total_value: 8949, slip_amount_value: 2000 })).toBe(2000);
    expect(itemAmount({ category: 'bill', bill_total_value: 8949, slip_amount_value: 2000 })).toBe(8949);
  });

  it('keeps AI failures visible instead of hiding them as other images', () => {
    expect(classifyItem({ status: 'downloaded', ai_status: 'failed', category: 'other' })).toBe('ai_pending');
    expect(classifyItem({ status: 'downloaded', ai_status: 'paused', category: 'transfer' })).toBe('ai_pending');
  });

  it('does not treat image count alone as unfinished work', () => {
    expect(urgency({ item_count: 30 })).toBe(0);
  });

  it('totals grouped documents without rounding away satang', () => {
    expect(equalAmounts([{ bill_total: 100.25 }, { bill_total: 49.75 }], [{ transfer_amount: 150 }]))
      .toEqual({ billTotal: 150, slipTotal: 150, difference: 0 });
  });

  it('sorts amount problems above ordinary unmatched work', () => {
    expect(urgency({ needs_amount: 1 })).toBeGreaterThan(urgency({ unmatched: 20 }));
  });

  it('selects today before a larger historical backlog', () => {
    const rows = [
      { business_date: '2026-08-13', source_id: 'old', unmatched_count: 99 },
      { business_date: '2026-08-14', source_id: 'today', pending_count: 1 }
    ];
    expect(selectNextRound(rows, '2026-08-14')?.source_id).toBe('today');
  });

  it('falls back to the latest open round when today has no work', () => {
    const rows = [
      { business_date: '2026-08-10', source_id: 'older', pending_count: 10 },
      { business_date: '2026-08-13', source_id: 'latest', unmatched_count: 1 }
    ];
    expect(selectNextRound(rows, '2026-08-14')?.source_id).toBe('latest');
  });

  it('ranks exact same-group candidates before cross-group candidates', () => {
    const rows = [
      { id: 1, source_id: 'other', business_date: '2026-08-14', slip_amount_value: 100 },
      { id: 2, source_id: 'same', business_date: '2026-08-13', slip_amount_value: 100 },
      { id: 3, source_id: 'same', business_date: '2026-08-14', slip_amount_value: 101 }
    ];
    expect(rankCandidates(rows, 100, 'same', '2026-08-14').map((row) => row.id)).toEqual([2, 1, 3]);
  });

  it('sorts grouped documents by AI readiness or chronological order', () => {
    const rows = [
      { id: 1, category: 'bill', bill_total_value: 100, ai_status: 'done', ai_confidence: .7, event_timestamp_ms: Date.parse('2026-08-12T10:00:00+07:00') },
      { id: 2, category: 'bill', bill_total_value: 100, ai_status: 'done', ai_confidence: .95, event_timestamp_ms: Date.parse('2026-08-11T10:00:00+07:00') },
      { id: 3, category: 'bill', bill_total_value: 100, ai_status: 'pending', ai_confidence: .99, event_timestamp_ms: Date.parse('2026-08-10T10:00:00+07:00') }
    ];
    expect(rankGroupDocuments(rows, '2026-08-12', 'ai').map((row) => row.id)).toEqual([2, 1, 3]);
    expect(rankGroupDocuments(rows, '2026-08-12', 'date_asc').map((row) => row.id)).toEqual([3, 2, 1]);
    expect(rankGroupDocuments(rows, '2026-08-12', 'date_desc').map((row) => row.id)).toEqual([1, 2, 3]);
  });

  it('does not offer documents already used by another transaction', () => {
    expect(groupDocumentAvailable({ category: 'bill', bill_total_value: 100, match_status: 'confirmed' })).toBe(false);
    expect(groupDocumentAvailable({ category: 'transfer', slip_amount_value: 100, match_status: 'unmatched' })).toBe(true);
    expect(groupDocumentAvailable({ category: 'bill', bill_total_value: 100, cash_payment_id: 9 })).toBe(false);
    expect(groupDocumentAvailable({ category: 'bill', bill_total_value: 100, amount_review_flag: 1 })).toBe(false);
    expect(groupDocumentAvailable({ category: 'bill', bill_total_value: 100, match_status: 'needs_amount' })).toBe(false);
  });
});
