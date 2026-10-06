import { describe, expect, it } from 'vitest';
import { fillReceiptDraftField } from './receiptDraft';

describe('receipt draft prefill', () => {
  it('fills a blank untouched field after a successful retry', () => {
    expect(fillReceiptDraftField('', 'ร้านสมมติ', false)).toBe('ร้านสมมติ');
  });
  it('preserves user input and intentional clearing across a retry', () => {
    expect(fillReceiptDraftField('ชื่อที่พิมพ์เอง', 'ค่าจากสลิป', true)).toBe('ชื่อที่พิมพ์เอง');
    expect(fillReceiptDraftField('', 'ค่าจากสลิป', true)).toBe('');
  });
  it('keeps existing slip metadata ahead of fallback draft text', () => {
    expect(fillReceiptDraftField('ค่าขนส่ง', 'ค่าที่ระบบแนะนำ', false)).toBe('ค่าขนส่ง');
  });
});
