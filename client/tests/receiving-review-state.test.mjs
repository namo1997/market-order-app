import test from 'node:test';
import assert from 'node:assert/strict';
import { newReviewState, transitionReview, reviewCounters, orderComparison } from '../src/pages/receiving/line-review-state.js';
import { markOcrProposals, prepareOcrReview, resolveAiLine, retainAiReview } from '../src/pages/receiving/receiving-ai.js';
import { documentBody } from '../src/pages/receiving/receiving-utils.js';
import { harness } from './receiving-harness.mjs';

const row = (id = 1, values = {}) => ({ id, line_no: id, product_id: id, order_item_id: id, product_name: `ผัก ${id}`,
  quantity_received: '0.2', quantity_billed: '0.2', unit_price: '10', amount: '2', unit_text: 'กก.', match: { source: 'order', confidence: .95 }, ...values });
const expectedItems = [1, 2, 3].map(id => ({ order_item_id: id, product_id: id, quantity_ordered: '0.3', received_quantity: '0.1', unit_name: 'กก.' }));
const proposals = (lines = [row(), row(2)]) => markOcrProposals({ status: 'draft', ocr: { status: 'done' }, lines }).lines;
const initial = lines => ({ ...newReviewState(), lines: proposals(lines) });
const context = { expectedItems, kind: 'bill', warnings: [] };
const reduce = (state, event, ctx = context) => transitionReview(state, event, ctx);

test('review state: opening/editing/cancelling never acknowledges AI; invalid save keeps input', () => {
  const start = initial();
  let state = reduce(start, { type: 'edit', index: 0, mode: 'full' });
  assert.equal(state.lines, start.lines);
  assert.ok(resolveAiLine(state.lines[0], 'edit')._aiProposal);
  state = reduce(state, { type: 'change', values: { quantity_received: '-1' } });
  state = reduce(state, { type: 'save' });
  assert.ok(state.error); assert.equal(state.editing.line.quantity_received, '-1');
  assert.equal(reviewCounters(state.lines, expectedItems).reviewed, 0);
  state = reduce(state, { type: 'cancel' });
  assert.equal(state.lines[0].quantity_received, '0.2'); assert.ok(state.lines[0]._aiProposal);
});

test('review state: explicit valid save acknowledges once, counters separate shortages/overages', () => {
  let state = reduce(initial(), { type: 'input', index: 0, values: { quantity_received: '0.1' } });
  assert.equal(reviewCounters(state.lines, expectedItems).reviewed, 0);
  state = reduce(state, { type: 'save' });
  assert.equal(state.lines[0].match.source, 'manual');
  assert.deepEqual(reviewCounters(state.lines, expectedItems), { total: 2, reviewed: 1, short: 1, over: 0 });
  state = reduce(state, { type: 'input', index: 1, values: { quantity_received: '0.3' } });
  state = reduce(state, { type: 'save' });
  assert.deepEqual(reviewCounters(state.lines, expectedItems), { total: 2, reviewed: 2, short: 1, over: 1 });
});

test('review state: incomplete mapping can save a quantity draft without acknowledgement; OCR cannot overwrite it', () => {
  let state = initial([row(1, { product_id: null })]);
  state = reduce(state, { type: 'input', index: 0, values: { quantity_received: '1.25' } });
  state = reduce(state, { type: 'save' });
  assert.equal(state.lines[0].quantity_received, '1.25');
  assert.ok(state.lines[0]._aiProposal); assert.equal(reviewCounters(state.lines, expectedItems).reviewed, 0);
  const reread = prepareOcrReview({ lines: state.lines }, { status: 'draft', ocr: { status: 'done' }, lines: [row(1, { quantity_received: '99' })] });
  assert.equal(reread.lines[0].quantity_received, '1.25');
  assert.ok(reduce(state, { type: 'preview', action: 'use', indices: [0] }).error);
});

test('review state: zero preview has no effect; confirm retains every row; undo restores provenance', () => {
  const start = initial();
  let state = reduce(start, { type: 'preview', action: 'zero', indices: [0] });
  assert.equal(state.lines, start.lines); assert.equal(state.pending.rows[0].after, '0');
  assert.equal(reduce(state, { type: 'dismiss' }).pending, null);
  state = reduce(state, { type: 'confirm' });
  assert.equal(state.lines.length, 2); assert.equal(state.lines[0].quantity_received, '0');
  state = reduce(state, { type: 'undo' });
  assert.deepEqual(state.lines, start.lines); assert.equal(state.history.length, 0);
});

test('review state: bulk use/ordered/zero all require preview and restore exactly with undo', () => {
  for (const action of ['use', 'ordered', 'zero']) {
    const start = initial();
    let state = reduce(start, { type: 'preview', action, indices: [0, 1, 0] });
    assert.equal(state.pending.rows.length, 2); assert.equal(state.lines, start.lines);
    state = reduce(state, { type: 'confirm' });
    assert.equal(state.lines.filter(line => line._aiProposal).length, 0);
    assert.equal(state.history.length, 1);
    assert.deepEqual(reduce(state, { type: 'undo' }).lines, start.lines);
  }
});

test('review state: bulk rejects warning/low confidence/unmatched/unit mismatch/duplicate order/invalid numbers atomically', () => {
  for (const values of [{ match: { source: 'order', confidence: .3 } }, { product_id: null }, { unit_text: 'ถุง' }, { quantity_received: '-1' }]) {
    const start = initial([row(), row(2, values)]);
    const state = reduce(start, { type: 'preview', action: 'use', indices: [0, 1] });
    assert.ok(state.error); assert.equal(state.pending, null); assert.equal(state.lines, start.lines);
  }
  const start = initial();
  assert.ok(reduce(start, { type: 'preview', action: 'use', indices: [0, 1] }, { ...context, warnings: [{ code: 'LOW_CONFIDENCE', line_no: 2 }] }).error);
  assert.ok(reduce(initial([row(), row(2, { order_item_id: 1 })]), { type: 'preview', action: 'ordered', indices: [0, 1] }).error);
});

test('review state: bulk AI cannot overwrite a human decision; undo stack preserves later edits', () => {
  let state = reduce(initial(), { type: 'apply', action: 'use', indices: [0] });
  const accepted = state.lines;
  assert.ok(reduce(state, { type: 'preview', action: 'use', indices: [0, 1] }).error);
  state = reduce(state, { type: 'input', index: 1, values: { quantity_received: '1.25' } });
  const preview = reduce(state, { type: 'preview', action: 'zero', indices: [0] });
  assert.equal(preview.error, ''); assert.equal(preview.lines[1].quantity_received, '1.25');
  assert.equal(preview.lines[0].quantity_received, accepted[0].quantity_received);
  assert.equal(preview.pending.rows[0].after, '0');
  state = reduce(state, { type: 'save' });
  state = reduce(state, { type: 'undo' }); assert.deepEqual(state.lines, accepted);
  state = reduce(state, { type: 'undo' }); assert.equal(state.lines[0].quantity_received, '0.2'); assert.ok(state.lines[0]._aiProposal);
});

test('review state: partial receipts use exact remaining quantity and preserve billed money; metadata never enters API', () => {
  let state = initial();
  assert.equal(orderComparison(state.lines[0], expectedItems, state.lines).remaining, '0.20');
  state = reduce(reduce(state, { type: 'preview', action: 'ordered', indices: [0, 1] }), { type: 'confirm' });
  assert.equal(state.lines[0].quantity_received, '0.20'); assert.equal(state.lines[0].amount, '2');
  const saved = retainAiReview({ lines: state.lines.map(line => ({ ...line, _aiReviewed: undefined })) }, { lines: state.lines });
  assert.equal(reviewCounters(saved.lines, expectedItems).reviewed, 2);
  assert.ok(!JSON.stringify(documentBody({ lines: saved.lines })).includes('_ai'));
});

const doc = () => ({ id: 5, status: 'draft', kind: 'bill', delivery_date: '2026-10-16', ocr: { status: 'done' },
  lines: [row(), row(2)], images: [], warnings: [], discount: '0', vat: '0', total: '4' });
const ui = () => harness('DocumentEditor', { initialDocument: doc(), user: { id: 1, role: 'receiver' }, onBack() {}, onChanged() {} }, { expected: async () => [{ items: expectedItems }] });
const choose = async (h, index) => { if (!h.find(node => node.type === 'button' && h.text(node) === 'เลือกหลายรายการ').props['aria-expanded']) await h.click('เลือกหลายรายการ'); h.find(node => node.props.id === `line-${index}-review`).props.onChange(); await h.settle(); };
