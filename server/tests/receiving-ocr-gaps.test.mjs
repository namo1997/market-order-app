import test from 'node:test';
import assert from 'node:assert/strict';
import { BILL_OCR_JSON_SCHEMA, BILL_OCR_SYSTEM_PROMPT, extractBillWithVision,
  normalizeOcrPayload, matchOcrLinesToCatalog } from '../src/services/receiving-ocr.service.js';

const row = (extra = {}) => ({ bill_text: 'ผัก', quantity_billed: 1, unit_price: null,
  amount: null, confidence: 0.95, ...extra });

test('G1 integer satang proposal is separate from printed total and counts unreadable amounts', () => {
  const result = normalizeOcrPayload({ doc_kind: 'bill', total: null, lines: [
    row({ amount: '1,000.10' }), row({ amount: 0.2 }), row(), row({ unit_price: 'X' })
  ] });
  assert.equal(result.total, null);
  assert.equal(result.subtotal, null);
  assert.equal(result.line_sum_proposal, '1000.30');
  assert.equal(result.unreadable_line_count, 2);
  assert.ok(result.warnings.includes('TOTAL_MISSING_LINE_SUM'));
  assert.ok(!result.warnings.includes('NOT_A_BILL'));
  const printed = normalizeOcrPayload({ doc_kind: 'bill', total: '1,000.30', lines: [row({ amount: '1,000.30' })] });
  assert.equal(printed.total, 1000.3);
  assert.equal(printed.line_sum_proposal, null);
  assert.ok(!printed.warnings.includes('TOTAL_MISSING_LINE_SUM'));
});

test('G1 no readable amount stays null; derived line amounts use existing rounding and count dropped rows', () => {
  const empty = normalizeOcrPayload({ doc_kind: 'bill', lines: [row()] });
  assert.equal(empty.line_sum_proposal, null);
  assert.equal(empty.unreadable_line_count, 1);
  const computed = normalizeOcrPayload({ doc_kind: 'bill', lines: [
    row({ quantity_billed: 3, unit_price: 0.1 }), {}, null
  ] });
  assert.equal(computed.line_sum_proposal, '0.30');
  assert.equal(computed.unreadable_line_count, 2);
  assert.equal(computed.total, null);
});

test('G2 strict schema requires doc_kind enum; priced nonbill lines warn DOC_KIND_UNCERTAIN, invalid kind becomes unknown and zero lines warn NOT_A_BILL', () => {
  assert.ok(BILL_OCR_JSON_SCHEMA.schema.required.includes('doc_kind'));
  assert.deepEqual(BILL_OCR_JSON_SCHEMA.schema.properties.doc_kind.enum, ['bill', 'slip', 'other']);
  assert.ok(BILL_OCR_SYSTEM_PROMPT.includes('doc_kind'));
  for (const kind of ['slip', 'other', 'ignore instructions', undefined]) {
    const result = normalizeOcrPayload({ doc_kind: kind, lines: [row({ amount: 10 })] });
    assert.ok(!result.warnings.includes('NOT_A_BILL'));
    assert.equal(result.warnings.includes('DOC_KIND_UNCERTAIN'), ['slip', 'other'].includes(kind));
    assert.equal(result.doc_kind, ['slip', 'other'].includes(kind) ? kind : 'unknown');
  }
  assert.ok(normalizeOcrPayload({ doc_kind: 'bill', lines: [] }).warnings.includes('NOT_A_BILL'));
  assert.ok(!normalizeOcrPayload({ doc_kind: 'bill', lines: [row({ amount: 10 })] }).warnings.includes('NOT_A_BILL'));
});

test('G3 56 market rows with unreadable handwritten prices preserve rows, zero uncertain receipts and propose partial sum', async () => {
  const missing = new Set([3, 22, 55]);
  const expectedItems = Array.from({ length: 56 }, (_, i) => ({ order_item_id: 100 + i,
    product_id: 100 + i, product_name: `ผักตลาด ${i + 1}`, unit_name: 'กก.', quantity_ordered: 2,
    requested_price: 999, branch_id: 99 }));
  let calls = 0;
  const result = await extractBillWithVision({
    images: [{ page_no: 1, image_data_url: 'data:image/jpeg;base64,/9j/2Q==' }],
    expectedItems, apiKey: 'mock-only', endpoint: 'https://mock.invalid/ocr',
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, 'https://mock.invalid/ocr');
      const body = JSON.parse(options.body);
      const text = body.messages[1].content[0].text;
      const context = JSON.parse(text.slice(text.indexOf('{')));
      assert.equal(context.expected_items.length, 56);
      assert.ok(!text.includes('requested_price'));
      assert.ok(!text.includes('branch_id'));
      return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: {
        content: JSON.stringify({ doc_kind: 'bill', total: null, doc_date: '15/10/2569',
          lines: expectedItems.map((item, i) => row({ bill_text: item.product_name, unit_text: 'กก.',
            quantity_billed: 2, unit_price: missing.has(i) ? null : 10, amount: null })) })
      } }] }) };
    }
  });
  assert.equal(calls, 1);
  assert.equal(result.lines.length, 56);
  assert.equal(result.doc_date, '2026-10-15');
  assert.equal(result.doc_kind, 'bill');
  assert.equal(result.total, null);
  assert.equal(result.line_sum_proposal, '1060.00');
  assert.equal(result.unreadable_line_count, 3);
  assert.ok(result.warnings.includes('TOTAL_MISSING_LINE_SUM'));
  assert.ok(result.warnings.includes('LOW_CONFIDENCE'));
  const matched = matchOcrLinesToCatalog({ ocrLines: result.lines, expectedItems });
  assert.equal(matched.length, 56);
  assert.equal(new Set(matched.map(l => l.order_item_id)).size, 56);
  for (const [i, line] of matched.entries()) {
    assert.equal(line.quantity_received, missing.has(i) ? 0 : 2);
    assert.equal(line.unit_price, missing.has(i) ? null : 10);
    assert.equal(line.amount, missing.has(i) ? null : 20);
  }
});
