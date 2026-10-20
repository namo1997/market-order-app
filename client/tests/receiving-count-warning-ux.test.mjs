import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { harness } from './receiving-harness.mjs';
import { flaggedCountLines, activeCountFlags } from '../src/pages/receiving/count-warning.js';
import { focusCountField } from '../src/pages/receiving/receiving-validation.js';

const user = { id: 12, name: 'ผู้รับ', role: 'user', branch_id: 1, department_id: 10 };
const line = (id, product_id, name, extra = {}) => ({ id, line_no: id, product_id, product_name: name, order_item_id: 50 + id, unit_text: 'กิโลกรัม', quantity_ordered: '7', counted_quantity: null, quantity_billed: '8', unit_price: null, match: { source: 'order' }, ...extra });
const doc = () => ({ id: 5, client_uuid: 'warn', status: 'draft', kind: 'manual_receipt', images: [], warnings: [], ocr: { status: 'none' }, counted_complete_at: null, lines: [line(1, 7, 'ขา B'), line(2, 8, 'อกไก่'), line(3, 9, 'ปีก')] });
const warnings = [{ product_id: 7, quantity: '10144', unit: 'กิโลกรัม' }, { product_id: 9, quantity: '9000', unit: 'กิโลกรัม' }];
const css = name => readFile(new URL(`../src/pages/receiving/${name}`, import.meta.url), 'utf8');

async function open(counts = { 1: '10144', 2: '3', 3: '9000' }) {
  const saved = [];
  const h = await harness('DocumentEditor', { initialDocument: doc(), user, onBack() {} }, {
    count: async (id, body) => {
      if (body.check_only) return { count_warnings: warnings };
      saved.push(body);
      return { ...doc(), counted_complete_at: '2026-10-20T00:00:00Z', lines: doc().lines.map(item => ({ ...item, counted_quantity: body.lines.find(x => x.id === item.id).counted_quantity })) };
    },
  });
  for (const [id, value] of Object.entries(counts)) h.find(n => n.props.id === `count-${id}`).props.onValueChange?.(value) ?? h.find(n => n.type === 'input' && n.props.id === `count-${id}`).props.onChange({ target: { value } });
  await h.settle();
  await h.click('ยืนยันการนับ');
  return { h, saved };
}
const fieldsOf = h => h.all().filter(n => n.type === 'div' && /\bsg-number-field\b/.test(n.props.className || '')).map(n => {
  const parts = h.all(n);
  return { label: h.text(parts.find(x => x.type === 'label')), flagged: /\bra-count-flagged\b/.test(n.props.className), hint: h.text(parts.find(x => x.type === 'p' && /sg-field-hint/.test(x.props.className || ''))), value: parts.find(x => x.type === 'input').props.value };
});
const sheet = h => h.all().find(n => n.type === 'dialog');
const buttons = h => h.all(sheet(h)).filter(n => n.type === 'button' && !n.props['aria-label']);

test('count warning: product names with value and unit are listed for every flagged line, without ordered or bill quantities', async () => {
  const { h } = await open();
  const text = h.text(sheet(h));
  assert.match(text, /ขา B:\s*จำนวน 10144 กิโลกรัม ถูกต้องไหม\?/);
  assert.match(text, /ปีก:\s*จำนวน 9000 กิโลกรัม ถูกต้องไหม\?/);
  assert.doesNotMatch(text, /อกไก่/);
  assert.doesNotMatch(text, /\b7\b|\b8\b/);
});

test('count warning: แก้ไข is the primary full-width action and confirm is a secondary action below it', async () => {
  const { h } = await open();
  const [edit, confirm] = buttons(h);
  assert.equal(h.text(edit), 'แก้ไข');
  assert.match(edit.props.className, /\bsg-primary\b/);
  assert.equal(h.text(confirm), 'ยืนยัน จำนวนนี้ถูกต้อง');
  assert.match(confirm.props.className, /\bra-secondary-action\b/);
  assert.doesNotMatch(confirm.props.className, /sg-primary/);
  const style = await css('review-a.css');
  assert.match(style, /\.rc-count-warning-sheet \.sg-sheet-actions\s*\{[^}]*display: grid/);
  assert.match(style, /\.rc-count-warning-sheet \.sg-sheet-actions > button\s*\{[^}]*width: 100%;[^}]*min-height: var\(--sg-touch\)/);
  assert.match(style, /\.rc-count-warning-sheet \.sg-sheet-actions > \.sg-primary\s*\{[^}]*min-height: 56px/);
  assert.match(style, /\.ra-secondary-action\s*\{[^}]*min-height:48px/);
});

test('count warning: แก้ไข does not save, closes the sheet, focuses the first flagged field and marks every flagged field', async () => {
  const { h, saved } = await open();
  await h.click('แก้ไข');
  assert.equal(saved.length, 0);
  assert.equal(h.all().some(n => n.type === 'dialog'), false);
  assert.deepEqual(h.focused, ['count-1']);
  assert.deepEqual(h.scrolled, ['count-1']);
  assert.deepEqual(fieldsOf(h).map(({ label, flagged, hint }) => [label, flagged, hint]), [
    ['นับได้ ขา B', true, 'ตรวจจำนวนอีกครั้ง'],
    ['นับได้ อกไก่', false, ''],
    ['นับได้ ปีก', true, 'ตรวจจำนวนอีกครั้ง'],
  ]);
  for (const row of h.all().filter(n => n.type === 'article')) assert.doesNotMatch(h.text(row), /[78]/, 'ordered/bill quantities stay hidden');
});

test('count warning: the mark disappears once the value changes and the typed values are kept', async () => {
  const { h } = await open();
  await h.click('แก้ไข');
  h.find(n => n.props.id === 'count-1').props.onChange({ target: { value: '10.144' } });
  await h.settle();
  const fields = fieldsOf(h);
  assert.equal(fields[0].flagged, false);
  assert.equal(fields[0].value, '10.144');
  assert.equal(fields[2].flagged, true);
  assert.equal(fields[2].value, '9000');
});

test('count warning: close x and Android back (cancel/dismiss) behave like แก้ไข and never save', async () => {
  for (const dismiss of ['x', 'cancel']) {
    const { h, saved } = await open();
    const dialog = sheet(h);
    assert.match(dialog.props.className, /\brc-back-dismiss\b/);
    if (dismiss === 'x') await h.all(dialog).find(n => n.props['aria-label'] === 'ปิด').props.onClick();
    else await dialog.props.onCancel({ preventDefault() {} });
    await h.settle();
    assert.equal(saved.length, 0);
    assert.equal(h.all().some(n => n.type === 'dialog'), false);
    assert.deepEqual(h.focused, ['count-1']);
    assert.equal(fieldsOf(h).filter(f => f.flagged).length, 2);
    h.unmount();
  }
});

test('count warning: ยืนยัน จำนวนนี้ถูกต้อง saves the counts once and clears marks', async () => {
  const { h, saved } = await open();
  await h.click('ยืนยัน จำนวนนี้ถูกต้อง');
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].lines.map(item => item.counted_quantity), ['10144', '3', '9000']);
  assert.equal(h.all().some(n => n.type === 'dialog'), false);
});

test('count warning helpers: match by product and unit, and marks are value-bound', () => {
  const lines = [line(1, 7, 'ขา B'), line(2, 7, 'ขา B', { unit_text: 'ถุง' })];
  assert.equal(flaggedCountLines(lines, [{ product_id: 7, quantity: '5', unit: 'ถุง' }])[0].line.id, 2);
  assert.equal(flaggedCountLines(lines, [{ product_id: 7, quantity: '5', unit: 'หน่วย' }])[0].lines.length, 2);
  assert.deepEqual(activeCountFlags({ 1: '10144', 3: '9000' }, { 1: '10144', 3: '9' }), { 1: true });
});

test('count warning: focusCountField focuses, scrolls and selects the field text', () => {
  const log = [];
  const input = { closest: () => null, focus: () => log.push('focus'), select: () => log.push('select'), scrollIntoView: () => log.push('scroll') };
  focusCountField('count-1', { getElementById: () => input });
  assert.deepEqual(log, ['focus', 'scroll', 'select']);
});

test('count warning: styles use theme tokens, not raw spacing or colours', async () => {
  const style = await css('review-a.css');
  const block = style.slice(style.indexOf('.rc-count-warning-sheet .sg-sheet-actions {'));
  assert.match(block, /var\(--sg-review\)/);
  assert.match(block, /var\(--sg-review-bg\)/);
  for (const [, value] of block.matchAll(/(?:padding(?:-[a-z]+)?|margin(?:-[a-z]+)?|gap):\s*([^;}]+)/g)) assert.ok(!/\d+px/.test(value), value);
  assert.doesNotMatch(block, /#[0-9a-f]{3,6}\b/i);
  const app = await readFile(new URL('../src/receiving-app/ReceivingApp.jsx', import.meta.url), 'utf8');
  assert.match(app, /rc-back-dismiss/);
});
