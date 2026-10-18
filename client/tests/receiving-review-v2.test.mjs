import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { harness } from './receiving-harness.mjs';
import { ocrReadSummary, matchLabel } from '../src/pages/receiving/review-card.js';
import { documentBody } from '../src/pages/receiving/receiving-utils.js';

const line = { id: 1, line_no: 1, bill_text: 'ทB', product_id: 8, product_name: 'ขา B', order_item_id: 51,
  unit_text: 'กก.', unit_id: 2, quantity_billed: '10', quantity_received: '10', unit_price: '60', amount: '600',
  bill_read: { quantity_billed: 10, unit_price: 60, amount: 600 }, match: { source: 'alias', confidence: .99 } };
const expected = [ { order_item_id: 50, product_id: 7, product_name: 'อกไก่', quantity_ordered: '10', unit_name: 'กก.', unit_id: 2 },
  { order_item_id: 51, product_id: 8, product_name: 'ขา B', quantity_ordered: '10', unit_name: 'กก.', unit_id: 2 } ];
const doc = values => ({ id: 5, kind: 'bill', status: 'draft', delivery_date: '2026-10-17', supplier_name_text: 'เจ๊แวว',
  lines: [line], images: [], warnings: [], total: '600', ocr: { status: 'done', raw_read: { doc_date: '2026-10-17', total: 600, line_count: 1 } }, ...values });
const editor = (values = {}, api = {}, runtime = {}) => harness('DocumentEditor', { initialDocument: doc(values), user: { id: 1, role: 'receiver' }, onBack() {}, onChanged() {} },
  { expected: async () => [{ items: expected }], ...api }, {}, {}, runtime);
const text = h => h.text(h.visible());













test('review v2: all source labels are Thai and remembering only adds an optional API field', () => {
  for (const [source, label] of [['alias', 'จำชื่อย่อร้านนี้'], ['order', 'ตรงกับที่สั่ง'], ['ai', 'AI เดา — ยืนยัน'], ['manual', 'เลือกเอง'], ['none', 'เลือกแล้ว — ตรวจตัวเลข']]) assert.equal(matchLabel({ ...line, match: { source } }), label);
  assert.equal(matchLabel({ product_id: null, match: { source: 'none' } }), 'ยังไม่จับคู่');
  const body = documentBody(doc({ lines: [{ ...line, remember_alias: false }] }));
  assert.equal(body.lines[0].remember_alias, false); assert.ok(!JSON.stringify(body).includes('bill_read'));
  assert.equal(body.lines[0].amount, '600.00');
});

test('review v2: cards use opaque design tokens, wrapping grid and fullscreen safe areas', async () => {
  const css = await readFile(new URL('../src/pages/receiving/receiving.css', import.meta.url), 'utf8');
  assert.match(css, /rc-review-cards \.rc-compact-item \{[^}]*background: var\(--sg-surface\)/);
  assert.match(css, /rc-receipt-numbers \{[^}]*minmax\(0,1fr\)/);
  assert.match(css, /rc-image-fullscreen[^}]*--sg-safe-top/);
  assert.match(css, /rc-image-fullscreen[^}]*--sg-safe-bottom/);
  assert.match(css, /rc-image-pan \{ overflow: auto/);
  assert.match(css, /rc-image-pan img \{[^}]*height: auto; max-height: none/);
});
