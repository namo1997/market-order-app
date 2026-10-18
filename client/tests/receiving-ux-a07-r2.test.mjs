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

test('A07 R2 A: one and multiple shops start only on the named card, with explicit navigation below', async () => {
  for (const groups of [[group(1)], [group(1), group(2)]]) {
    const h = await harness('Receiving', {}, { expected: async () => groups });
    assert.equal(h.text(primary(h)), 'ดูเอกสาร');
    assert.ok(text(h).includes('ของมาจากร้านไหน แตะรับของที่ร้านนั้น'));
    assert.ok(!text(h).includes('รับร้านนี้'));
    assert.equal(h.visible().filter(n => n.type === 'button' && h.text(n).startsWith('รับของ ')).length, groups.length);
    await h.click(`รับของ ${groups.at(-1).supplier_name}`);
    assert.ok(h.find(n => n.type === 'input' && n.props.value === groups.at(-1).supplier_name));
    assert.equal(h.calls.length, 0); h.unmount();
  }
});

test('A07 R2 #1/#3/#4/#6: card order, live delta, AI action and unchanged bill money share one group', async () => {
  const h = await editor(); await h.radio('lines'); await h.select('รับจริง ผัก 1', '210');
  const card = h.find(n => n.props['data-line-index'] === 0);
  const children = card.props.children.filter(Boolean);
  assert.equal(children[0].props.className, 'rc-product-layer');
  assert.equal(children[1].props.className, 'rc-receipt-numbers');
  assert.ok(children[2].props.className.includes('rc-line-amount'));
  assert.equal(children[3].type, 'details'); assert.ok(!children[3].props.open);
  const actual = h.all(card).find(n => n.props.className === 'rc-actual-group');
  assert.match(h.text(actual), /เกิน 200 กก\./);
  assert.equal(h.all(actual).find(n => n.props.id === 'line-0-status').props['data-status'], 'review');
  assert.match(h.text(actual), /AI: 10 กก\.ใช้ค่า/);
  assert.equal(h.all(card).filter(n => n.props.className === 'rc-ai-suggestion').length, 1);
  assert.match(h.text(children[2]), /ยอดตามบิล600\.00 บาท/);
  assert.equal(h.calls.length, 0); h.unmount();
});

test('A07 R2 #2: valid draft autosaves before focus moves; undo restores quantities and AI provenance', async () => {
  const h = await editor(); await h.radio('lines'); await h.click('ทั้งหมด');
  await h.select('รับจริง ผัก 1', '1.25'); field(h, 1).props.onFocus(); await h.settle();
  assert.equal(field(h).props.value, '1.25'); assert.equal(field(h, 1).props.value, '10');
  assert.equal(h.focused.at(-1), 'line-1-inline');
  await h.select('รับจริง ผัก 2', '2.50'); await h.click('บันทึกและถัดไป');
  await h.click('เลิกทำรายการล่าสุด'); assert.equal(field(h).props.value, '1.25'); assert.equal(field(h, 1).props.value, '10');
  await h.click('เลิกทำรายการล่าสุด'); assert.equal(field(h).props.value, '10'); assert.match(text(h), /ตรวจแล้ว 0\/2/);
  assert.equal(h.calls.length, 0); h.unmount();
});

test('A07 R2 #2: invalid draft stays visible with field reason, cannot be lost on row or picker change', async () => {
  const h = await editor(); await h.radio('lines'); await h.select('รับจริง ผัก 1', '');
  field(h, 1).props.onFocus(); await h.settle();
  assert.equal(field(h).props.value, ''); assert.equal(h.focused.at(-1), 'line-0-inline');
  assert.equal(field(h).props['aria-invalid'], true);
  const actual = h.find(n => n.props.className === 'rc-actual-group'); assert.match(h.text(actual), /กรอกจำนวนรับจริง/);
  await h.click('เปลี่ยนสินค้า ผัก 2'); assert.equal(h.visible().filter(n => n.type === 'dialog').length, 0);
  assert.equal(field(h).props.value, ''); assert.equal(h.calls.length, 0); h.unmount();
});

test('A07 R2 #2: current product picker and full edit preserve draft quantity, raw bill and exact billed amount', async () => {
  const h = await editor(); await h.radio('lines'); await h.select('รับจริง ผัก 1', '1.25');
  await h.click('เปลี่ยนสินค้า ผัก 1'); await h.click('ผัก 2'); await h.click('ใช้สินค้านี้');
  assert.equal(field(h).props.value, '1.25'); await h.click('แก้ ผัก 2');
  const input = h.find(n => n.props.id === 'line-0-quantity_received'); assert.equal(input.props.value, '1.25');
  await h.click('บันทึกและถัดไป'); await h.click('ทั้งหมด');
  assert.equal(field(h).props.value, '1.25'); assert.match(text(h), /ในบิลเขียนบิล 1/);
  assert.match(h.text(h.find(n => n.props['data-line-index'] === 0)), /600\.00 บาท/);
  assert.equal(h.calls.length, 0); h.unmount();
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

test('A07 R2 #3: short, over, exact decimals and invalid values update next to the input immediately', async () => {
  const h = await editor(); await h.radio('lines');
  for (const [value, label] of [['0.1', 'ขาด 9.9 กก.'], ['10', 'ครบ'], ['10.2', 'เกิน 0.2 กก.'], ['', 'กรอกจำนวนรับจริง']]) {
    await h.select('รับจริง ผัก 1', value);
    const status = h.find(n => n.props.id === 'line-0-status'); assert.equal(h.text(status), label);
    assert.equal(status.props['data-status'], value === '' ? 'error' : value === '10' ? 'ok' : 'review');
  }
  h.unmount();
});

test('A07 R2 #5/#6: short enabled CTA and OCR metadata available only in its sheet', async () => {
  const h = await editor(); await h.radio('lines'); assert.equal(h.text(primary(h)), 'ตรวจรายการถัดไป');
  assert.equal(h.visible().filter(n => n.props.className === 'rc-ocr-read-summary').length, 0);
  await h.click('เพิ่มเติม'); await h.select('ทำรายการ', 'ocr-result'); await h.click('เลือก');
  assert.match(text(h), /ผลอ่านบิล.*ตรวจรายการกับบิลอีกครั้ง/); assert.ok(!text(h).includes('ข้อความดิบ'));
  await h.click('ปิด'); await h.select('รับจริง ผัก 1', '210');
  assert.equal(h.text(primary(h)), 'บันทึกและถัดไป'); assert.equal(primary(h).props.disabled, false); h.unmount();
});

test('A07 R2 #7: bulk checkboxes exist only after explicit bulk toggle, then disappear again', async () => {
  const h = await editor(); await h.radio('lines');
  const checks = () => h.visible().filter(n => n.type === 'input' && n.props.type === 'checkbox');
  assert.equal(checks().length, 0); await h.click('เลือกหลายรายการ'); assert.equal(checks().length, 2);
  await h.click('เลือกทั้งหมดที่แสดง'); assert.equal(checks().filter(n => n.props.checked).length, 2);
  await h.click('เลือกหลายรายการ'); assert.equal(checks().length, 0); assert.ok(!text(h).includes('เลือก 2 รายการ'));
  h.unmount();
});

test('A07 R2 #8: compact headers and 48/56px targets use shared theme tokens (structural checks)', async () => {
  const css = postcss.parse(await readFile(new URL('../src/pages/receiving/receiving.css', import.meta.url), 'utf8'));
  const values = selector => { const result = {}; css.walkRules(rule => { if (rule.selector === selector) rule.walkDecls(d => { result[d.prop] = d.value; }); }); return result; };
  assert.equal(values('.solao .rc-document-header h1')['font-size'], 'var(--sg-type-body)');
  assert.equal(values('body:has(.rc-app) .rc-shell-header')['min-height'], 'var(--sg-touch)');
  assert.equal(values('.solao .rc-queue-actions > .rc-queue-receive')['min-height'], '56px');
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

test('A07 R2 #2/#6: using AI during quantity edit preserves the newly chosen product and can undo both decisions', async () => {
  const h = await editor(); await h.radio('lines'); await h.click('ทั้งหมด');
  await h.select('รับจริง ผัก 1', '1.25'); await h.click('เปลี่ยนสินค้า ผัก 1'); await h.click('ผัก 2'); await h.click('ใช้สินค้านี้');
  await h.click('ใช้ค่า'); assert.equal(field(h).props.value, '10');
  assert.ok(h.find(n => n.props['aria-label'] === 'แก้ ผัก 2'));
  assert.match(text(h), /ตรวจแล้ว 1\/2/); await h.click('เลิกทำรายการล่าสุด');
  assert.ok(h.find(n => n.props['aria-label'] === 'แก้ ผัก 1')); assert.match(text(h), /ตรวจแล้ว 0\/2/);
  assert.equal(h.calls.length, 0); h.unmount();
});

test('A07 R2 #3: full row editor also shows live discrepancy immediately after its received field', async () => {
  const h = await editor(); await h.radio('lines'); await h.click('แก้ ผัก 1'); await h.select('รับจริง', '210');
  const stack = h.find(n => n.props.className === 'rc-stack' && h.all(n).some(c => c.props.id === 'line-0-quantity_received'));
  const nodes = stack.props.children.flat().filter(Boolean);
  const index = nodes.findIndex(n => n.props?.className?.includes('sg-number-field') && h.all(n).some(c => c.props.id === 'line-0-quantity_received'));
  assert.ok(index >= 0); assert.match(h.text(nodes[index + 1]), /เกิน 200 กก\./);
  assert.equal(nodes[index + 1].props['data-status'], 'review'); h.unmount();
});
