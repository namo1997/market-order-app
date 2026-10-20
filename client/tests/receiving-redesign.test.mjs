import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { harness, armPad } from './receiving-harness.mjs';
import { reviewCounters, transitionReview, newReviewState } from '../src/pages/receiving/line-review-state.js';

const user = { id: 1, name: 'มาลี', role: 'receiver', branch_id: 1, department_id: 1 };
const row = (id, values = {}) => ({ id, line_no: id, product_id: id, order_item_id: id, product_name: `สินค้า ${id}`, bill_text: `สินค้า ${id}`,
  quantity_received: '1', quantity_billed: '1', unit_price: '10', amount: '10', unit_text: 'กก.', match: { source: 'order', confidence: .95 }, ...values });
const items = rows => rows.map(line => ({ order_item_id: line.id, product_id: line.id, product_name: line.product_name, quantity_ordered: '1', received_quantity: '0', unit_name: 'กก.' }));
const document = (values = {}) => ({ id: 21, status: 'draft', kind: 'bill', supplier_name_text: 'ร้านป้าดา', delivery_date: '2026-10-16', receiver_name: user.name,
  lines: [row(1), row(2), row(3)], total: '30', vat: '0', discount: '0', images: [], warnings: [], ocr: { status: 'done' }, ...values });
const editor = (doc = document(), api = {}, props = {}, runtime = {}) => harness('DocumentEditor', { initialDocument: doc, user, onBack() {}, onChanged() {}, ...props }, {
  expected: async () => [{ items: items(doc.lines) }], ...api,
}, {}, {}, { setTimeout: done => { done(); return 1; }, clearTimeout() {}, ...runtime });
const chosen = h => h.visible().filter(node => node.type === 'input' && node.props.type === 'checkbox' && node.props.checked);
const primary = h => h.find(node => node.type === 'button' && node.props.className?.includes('sg-primary'));
const ink = async h => { await armPad(h); const pad = h.find(node => node.type === 'canvas'); pad.props.onPointerDown({ pointerType: 'mouse', button: 0, pointerId: 1, clientX: 30, clientY: 30, preventDefault() {} }); pad.props.onPointerUp(); await h.settle(); };

const selectAll = async h => {
  const toggle = h.find(node => node.type === 'button' && h.text(node) === 'เลือกหลายรายการ');
  if (!toggle.props['aria-expanded']) await h.click('เลือกหลายรายการ');
  await h.click('เลือกทั้งหมดที่แสดง');
};

test('queue home: all shop cards precede explicit selection; selected shop has three preview rows and capture context', async () => {
  const groups = ['ร้านป้าดา', 'ร้านเจ๊นิด', 'ร้านลุงชัย'].map((supplier_name, index) => ({ supplier_key: `pg:${index}`, supplier_name, items: items(Array.from({ length: index ? 2 : 56 }, (_, i) => row(i + 1))) }));
  const h = await harness('Receiving', {}, { expected: async () => groups });
  assert.match(h.text(h.visible()), /รอรับ 3 ร้าน/);
  assert.equal(h.visible().filter(node => node.type === 'li').length, 0);
  await h.click('เลือกร้าน ร้านป้าดา');
  assert.equal(h.visible().filter(node => node.type === 'li').length, 3);
  assert.match(h.text(h.visible()), /รอรับ60 รายการ/);
  await h.click('ดูรายการทั้งหมด 56 รายการ'); assert.equal(h.visible().filter(node => node.type === 'li').length, 56);
  await h.click('เลือกร้าน ร้านเจ๊นิด');
  assert.equal(h.text(primary(h)), 'เริ่มรับของ ร้านเจ๊นิด'); assert.equal(h.calls.length, 0);
  await h.click('เริ่มรับของ ร้านเจ๊นิด'); assert.ok(h.find(node => node.type === 'input' && node.props.value === 'ร้านเจ๊นิด'));
  h.unmount();
});

test('redesign home: empty result offers documents and explicit additional capture; document tab still creates an independent receipt', async () => {
  const h = await harness('Receiving', {}, { expected: async () => [] });
  assert.ok(h.visible().some(node => node.props['data-illustration'] === 'empty-today'));
  assert.equal(h.text(primary(h)), 'ดูเอกสาร'); await h.click('ดูเอกสาร');
  assert.ok(h.find(node => node.type === 'input' && node.props.value === 'documents').props.checked);
  await h.click('ตัวเลือก'); await h.click('รับสินค้าเพิ่ม (ไม่อ้างอิงใบสั่ง)');
  assert.ok(h.find(node => node.type === 'form')); h.unmount();
  const other = await harness('Receiving'); await other.radio('documents'); await other.click('ตัวเลือก'); await other.click('รับสินค้าเพิ่ม (ไม่อ้างอิงใบสั่ง)');
  const supplier = other.find(node => node.type === 'input' && node.props.maxLength === 255);
  assert.equal(supplier.props.value, ''); other.unmount();
});









test('redesign zero: explicit zero retains row, billed amount and order identity; undo restores proposal provenance', () => {
  const line = row(1); line._aiProposal = { ...line };
  let state = { ...newReviewState(), lines: [line] };
  state = transitionReview(state, { type: 'preview', action: 'zero', indices: [0] }, { expectedItems: items([line]) });
  assert.equal(state.lines[0].quantity_received, '1');
  state = transitionReview(state, { type: 'confirm' });
  assert.equal(state.lines.length, 1); assert.equal(state.lines[0].quantity_received, '0'); assert.equal(state.lines[0].amount, '10'); assert.equal(state.lines[0].order_item_id, 1);
  state = transitionReview(state, { type: 'undo' }); assert.equal(state.lines[0], line); assert.equal(reviewCounters(state.lines, items([line]), 'bill').reviewed, 0);
});



test('redesign ledger CSS contract: four columns share track widths, numeric/header no-wrap, measured large text reflows to two levels', async () => {
  const css = postcss.parse(await readFile(new URL('../src/pages/receiving/receiving.css', import.meta.url), 'utf8'));
  const rules = selector => { const values = {}; css.walkRules(selector, rule => rule.walkDecls(decl => { values[decl.prop] = decl.value; })); return values; };
  const columns = rules('.solao .rc-compact-head, .solao .rc-compact-row')['grid-template-columns'];
  assert.equal(columns, 'minmax(0,1fr) minmax(32px,.28fr) minmax(64px,.55fr) minmax(60px,.5fr)');
  assert.equal(rules('.solao .rc-compact-head > :not(:first-child)')['white-space'], 'nowrap');
  assert.equal(rules('.solao .rc-ordered, .solao .rc-line-amount')['white-space'], 'nowrap');
  assert.equal(rules(".solao .rc-document[data-large-text='true'] .rc-product-cell")['grid-column'], '1 / -1');
  const source = await readFile(new URL('../src/pages/receiving/use-review-layout.js', import.meta.url), 'utf8');
  assert.match(source, /getComputedStyle\(element\).fontSize/);
});
