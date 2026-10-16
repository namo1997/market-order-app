import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { harness } from './receiving-harness.mjs';
import { focusField } from '../src/pages/receiving/receiving-validation.js';

const css = postcss.parse(await readFile(new URL('../src/pages/receiving/receiving.css', import.meta.url), 'utf8'));
const declaration = (selector, name) => {
  let value;
  css.walkRules(selector, rule => rule.walkDecls(name, decl => { value = decl.value; }));
  return value;
};

test('review focus: focused quantity clears both keyboard viewport and bottom bar', () => {
  const calls = [];
  const input = { closest: () => null, focus: options => calls.push(['focus', options]), scrollIntoView() {}, getBoundingClientRect: () => ({ top: 300, bottom: 380 }) };
  const root = { getElementById: () => input, defaultView: { innerHeight: 800, visualViewport: { offsetTop: 0, height: 400 }, scrollBy: options => calls.push(['scroll', options]) },
    querySelector: selector => ({ getBoundingClientRect: () => selector.includes('toolbar') ? { bottom: 96 } : { top: 300 } }) };
  focusField('quantity', root);
  assert.deepEqual(calls, [['focus', { preventScroll: true }], ['scroll', { top: 80, behavior: 'instant' }]]);
});

test('review layout contract: content and focused fields reserve measured bar height plus safe area', () => {
  assert.match(declaration('.solao .rc-document', '--rc-clearance'), /var\(--rc-bar-height\).*var\(--sg-safe-bottom\)/);
  assert.equal(declaration('.solao .rc-document', 'padding-bottom'), 'var(--rc-clearance)');
  assert.match(declaration('.solao .rc-document :where(input, button, .rc-compact-item)', 'scroll-margin-block'), /var\(--rc-clearance\)/);
  assert.match(declaration('html:has(.rc-document)', 'scroll-padding-bottom'), /var\(--rc-page-bar-height/);
  assert.match(declaration('.solao .rc-document .sg-bar', 'bottom'), /var\(--sg-safe-bottom\).*var\(--rc-keyboard-offset\)/);
});

test('review layout contract: sticky help has an opaque surface, checkbox target is 48px token, icon labels >=13px', async () => {
  assert.equal(declaration('.solao .rc-review-toolbar', 'position'), 'sticky');
  assert.equal(declaration('.solao .rc-review-toolbar', 'background'), 'var(--sg-surface)');
  assert.equal(declaration('.solao .rc-bulk-check', 'width'), 'var(--sg-touch)');
  assert.equal(declaration('.solao .rc-bulk-check', 'height'), 'var(--sg-touch)');
  assert.equal(declaration('.solao .rc-receiving-actions > .sg-labeled-button', 'font-size'), 'var(--sg-type-icon-label)');
  const tokens = await readFile(new URL('../src/design/tokens.css', import.meta.url), 'utf8');
  assert.match(tokens, /--sg-type-icon-label: .8125rem/);
});

test('review layout: 56 actual component rows remain compact, with no per-row forms or repeated warning paragraphs', async () => {
  const lines = Array.from({ length: 56 }, (_, i) => ({ id: i + 1, line_no: i + 1, product_id: i + 1, order_item_id: i + 1,
    product_name: `สินค้า ${i + 1}`, quantity_received: '1', quantity_billed: '1', unit_price: '1', amount: '1', unit_text: 'กก.', match: { source: 'order' } }));
  const h = await harness('DocumentEditor', { initialDocument: { id: 1, status: 'draft', kind: 'bill', delivery_date: '2026-10-16',
    lines, images: [], total: '56', ocr: { status: 'done' }, warnings: lines.map(line => ({ code: 'LOW_CONFIDENCE', line_no: line.line_no })) },
  user: { id: 1, role: 'receiver' }, onBack() {}, onChanged() {} }, { expected: async () => [{ items: lines.map(line => ({ order_item_id: line.id, product_id: line.id, quantity_ordered: '1', received_quantity: '0', unit_name: 'กก.' })) }] });
  await h.radio('lines');
  assert.equal(h.visible().filter(node => node.props.className === 'rc-compact-item').length, 56);
  assert.equal(h.visible().filter(node => node.props.className === 'rc-compact-row').length, 56);
  assert.equal(h.visible().filter(node => node.props.className === 'rc-bulk-check').length, 56);
  assert.equal(h.visible().filter(node => node.type === 'input' && node.props.inputMode === 'decimal').length, 56);
  assert.equal(h.visible().filter(node => node.type === 'dialog').length, 0);
  assert.equal(h.visible().filter(node => node.type === 'p' && h.text(node).includes('อ่านบิลได้ไม่ชัด')).length, 0);
  assert.equal(h.visible().filter(node => node.type === 'p' && h.text(node).includes('ข้อเตือนสินค้า 56 รายการ')).length, 1);
  h.budget(); h.unmount();
});
