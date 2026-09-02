import { describe, expect, it } from 'vitest';
import { classifyItem, equalAmounts, urgency } from './domain';

describe('mobile workflow rules', () => {
  it('puts amount flags before unmatched categories', () => {
    expect(classifyItem({ category: 'bill', needs_amount_review: 1 })).toBe('needs_amount');
  });

  it('recognises confirmed items as done', () => {
    expect(classifyItem({ category: 'transfer', match_status: 'confirmed' })).toBe('done');
  });

  it('totals grouped documents without rounding away satang', () => {
    expect(equalAmounts([{ bill_total: 100.25 }, { bill_total: 49.75 }], [{ transfer_amount: 150 }]))
      .toEqual({ billTotal: 150, slipTotal: 150, difference: 0 });
  });

  it('sorts amount problems above ordinary unmatched work', () => {
    expect(urgency({ needs_amount: 1 })).toBeGreaterThan(urgency({ unmatched: 20 }));
  });
});
