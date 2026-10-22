import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { harness } from './receiving-harness.mjs';
import { transitionReview, newReviewState } from '../src/pages/receiving/line-review-state.js';
import { billAmountLabel } from '../src/pages/receiving/review-card.js';
import { markOcrProposals } from '../src/pages/receiving/receiving-ai.js';

const row = (id, values = {}) => ({ id, line_no: id, product_id: id, order_item_id: id, product_name: `ผัก ${id}`,
  bill_text: `บิล ${id}`, quantity_billed: '10', quantity_received: '10', unit_price: '60', amount: '600', unit_text: 'กก.', match: { source: 'order', confidence: 1 }, ...values });
const expected = [1, 2].map(id => ({ order_item_id: id, product_id: id, product_name: `ผัก ${id}`, quantity_ordered: '10', received_quantity: '0', unit_name: 'กก.' }));
const group = id => ({ supplier_key: `pg:${id}`, supplier_name: id === 1 ? 'เจ๊แววไก่สด' : 'ร้านผัก', items: [expected[id - 1]] });
const doc = { id: 7, kind: 'bill', status: 'draft', delivery_date: '2026-10-18', supplier_name_text: 'เจ๊แววไก่สด', images: [], warnings: [], lines: [row(1), row(2)], total: '1200', ocr: { status: 'done' } };
const editor = () => harness('DocumentEditor', { initialDocument: doc, user: { id: 1, role: 'receiver' }, onBack() {}, onChanged() {} }, { expected: async () => [{ items: expected }] });
const field = (h, index = 0) => h.find(n => n.props.id === `line-${index}-inline`);
const primary = h => h.find(n => n.type === 'button' && n.props.className?.includes('sg-primary'));
const text = h => h.text(h.visible());
const state = () => ({ ...newReviewState(), lines: markOcrProposals(doc).lines });
const reduce = (s, e) => transitionReview(s, e, { expectedItems: expected });

test('A07 R2 A / Q4: every card only selects its shop; a single selected-shop primary starts receiving', async () => {
  for (const groups of [[group(1)], [group(1), group(2)]]) {
    const h = await harness('Receiving', {}, { expected: async () => groups });
    assert.equal(h.text(primary(h)), `สแกนบิล ${groups[0].supplier_name}`);
    // Owner 2026-10-22 redesign: one summary line, and each card carries its own "สแกนบิล" (aria names the shop).
    assert.match(text(h), new RegExp(`วันนี้ ${groups.length} ร้าน · รอรับ`));
    assert.equal(h.visible().filter(n => n.type === 'button' && /^สแกนบิล /.test(n.props['aria-label'] || '') && n.props.className === 'rc-queue-scan').length, groups.length);
    assert.ok(!text(h).includes('รับร้านนี้'));
    // Q4: no per-card "รับของ <ร้าน>" button duplicating the bottom action.
    assert.equal(h.visible().filter(n => n.type === 'button' && h.text(n).startsWith('รับของ ')).length, 0);
    assert.equal(h.visible().filter(n => n.type === 'button' && h.text(n).startsWith('สแกนบิล ')).length, 1);
    assert.equal(h.visible().filter(n => n.type === 'button' && /^เลือกร้าน /.test(n.props['aria-label'] || '')).length, groups.length);
    const last = groups.at(-1).supplier_name;
    await h.click(`เลือกร้าน ${last}`);
    assert.equal(h.find(n => n.props['aria-label'] === `เลือกร้าน ${last}`).props['aria-pressed'], true);
    assert.ok(text(h).includes('เลือกแล้ว'), 'selected card shows a visible selected cue, not colour alone');
    assert.equal(h.text(primary(h)), `สแกนบิล ${last}`);
    assert.equal(h.calls.length, 0, 'selecting never writes');
    await h.click('ตัวเลือก'); await h.click('ตั้งค่าใบรับเอง');
    assert.ok(h.find(n => n.type === 'input' && n.props.value === last));
    assert.equal(h.calls.length, 0); h.unmount();
  }
});









test('A07 R2 #2: direct input, product selection and AI on another row save valid draft first', () => {
  for (const event of [{ type: 'input', index: 1, values: { quantity_received: '3' } },
    { type: 'select-product', index: 1, values: { product_id: 3, product_name: 'ใหม่' } },
    { type: 'apply', action: 'use', indices: [1] }]) {
    const edited = reduce(state(), { type: 'input', index: 0, values: { quantity_received: '1.25' } });
    const next = reduce(edited, event); assert.equal(next.error, ''); assert.equal(next.lines[0].quantity_received, '1.25');
    assert.ok(!next.lines[0]._aiProposal); assert.equal(next.lines[0].amount, '600');
  }
});

test('A07 R2 #2: invalid draft refuses cross-row actions explicitly without losing values or acknowledging AI', () => {
  for (const quantity of ['', '-1', '999999999999']) {
    const edited = reduce(state(), { type: 'input', index: 0, values: { quantity_received: quantity } });
    for (const event of [{ type: 'edit', index: 1 }, { type: 'input', index: 1, values: { quantity_received: '3' } }, { type: 'prepare-row', index: 1 }]) {
      const next = reduce(edited, event); assert.ok(next.error); assert.equal(next.editing.line.quantity_received, quantity);
      assert.equal(next.editing.index, 0); assert.strictEqual(next.lines, edited.lines); assert.equal(next.history.length, 0);
    }
  }
});







test('A07 R2 #8: compact headers and 48/56px targets use shared theme tokens (structural checks)', async () => {
  const css = postcss.parse(await readFile(new URL('../src/pages/receiving/receiving.css', import.meta.url), 'utf8'));
  const values = selector => { const result = {}; css.walkRules(rule => { if (rule.selector === selector) rule.walkDecls(d => { result[d.prop] = d.value; }); }); return result; };
  assert.equal(values('.solao .rc-document-header h1')['font-size'], 'var(--sg-type-body)');
  assert.equal(values('body:has(.rc-app) .rc-shell-header')['min-height'], 'var(--sg-touch)');
  assert.equal(values('.solao .rc-queue-actions > .rc-queue-receive')['min-height'], undefined, 'Q4: the duplicate card receive button style is gone');
  assert.equal(values('.solao .rc-queue-actions > button')['min-height'], '48px');
  assert.equal(values('.solao .rc-queue-heading')['min-height'], '64px', 'the whole card heading stays a large tap target');
  assert.equal(values('.solao .rc-review-cards .rc-line-amount')['min-height'], 'var(--sg-touch)');
  assert.equal(values('.solao .rc-actual-group [data-status=\'review\']').color, 'var(--sg-review)');
  const h = await harness('Receiving', {}, {}, { user: { id: 1, role: 'receiver', branch: 'สาขาทดสอบ', department: 'ครัวทดสอบ' } });
  assert.ok(!text(h).includes('สาขาทดสอบ')); await h.click('ตัวเลือก'); assert.match(text(h), /สาขาทดสอบ \/ ครัวทดสอบ/); h.unmount();
});

test('A07 R2 #4: labels follow explicit amount, billed quantity and received fallback including zero', () => {
  assert.equal(billAmountLabel(row(1)), 'ยอดตามบิล');
  assert.equal(billAmountLabel(row(1, { amount: '0' })), 'ยอดตามบิล');
  assert.equal(billAmountLabel(row(1, { amount: null })), 'คำนวณจากจำนวนในบิล');
  assert.equal(billAmountLabel(row(1, { amount: null, quantity_billed: null })), 'คำนวณจากจำนวนรับจริง');
});
