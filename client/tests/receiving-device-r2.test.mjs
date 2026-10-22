import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { harness } from './receiving-harness.mjs';
import { isPartialReceipt } from '../src/pages/receiving/receiving-status.js';

const item = (id, received, ordered = '20') => ({ order_item_id: id, product_name: `ผัก ${id}`, quantity_ordered: ordered, received_quantity: received, unit_name: 'กิโลกรัม' });
const create = items => harness('CreateDocument', {
  group: items ? { supplier_key: 'pg:1', supplier_name: 'ตลาด', items } : null,
  date: '2026-10-16', user: { id: 1, role: 'receiver' }, onClose() {}, onCreated() {},
});
const warnings = h => h.all().filter(node => node.props['data-status'] === 'review');

const declarations = async (file, selector) => {
  const css = postcss.parse(await readFile(new URL(file, import.meta.url), 'utf8'));
  const result = {};
  css.walkRules(rule => {
    if (rule.selector === selector) rule.walkDecls(declaration => { result[declaration.prop] = declaration.value; });
  });
  return result;
};

// Structural regression guards, separate from the rendered 360/390/412px browser fixture.
test('device layout contract: Thai icon labels cannot shrink or wrap into individual characters', async () => {
  const label = await declarations('../src/design/styles.css', '.solao .sg-labeled-button');
  assert.equal(label['white-space'], 'nowrap');
  assert.equal(label.flex, '0 0 auto');
  assert.equal(label['min-width'], 'max-content');
  const options = await declarations('../src/pages/receiving/receiving.css', '.solao .rc-receiving-actions > .sg-labeled-button');
  assert.equal(options['flex-direction'], 'column');
  assert.equal(options['font-size'], 'var(--sg-type-icon-label)');
});

test('device layout contract: both main actions share remaining space and preserve secondary controls', async () => {
  const main = await declarations('../src/pages/receiving/receiving.css', '.solao .rc-receiving-actions > .sg-primary');
  assert.equal(main.flex, '1 1 0');
  assert.equal(main.width, 'auto');
  assert.equal(main['overflow-wrap'], 'normal');
  const h = await harness('Receiving');
  await h.click('เลือกร้าน ตลาด');
  const bar = () => h.find(node => node.props.className?.includes('rc-receiving-actions'));
  // Owner 2026-10-22 redesign: the footer always receives from other shops; cards carry their own scan.
  for (const primary of ['รับของจากร้านอื่น', 'รับของจากร้านอื่น ']) {
    const buttons = h.all(bar()).filter(node => node.type === 'button');
    assert.equal(buttons.length, 3);
    assert.equal(buttons[0].props['aria-label'], 'ตัวเลือก');
    assert.equal(h.text(buttons[0]), 'ตัวเลือก');
    assert.equal(buttons[1].props['aria-label'], 'โหลดใหม่');
    assert.equal(h.text(buttons[2]), primary.trim());
    if (primary === 'รับของจากร้านอื่น') {
      assert.ok(h.text(h.visible()).includes('ร้านที่กำลังรับ'));
      await h.radio('documents');
    }
  }
  h.unmount();
});

test('device r2: partial receipt comparison uses exact decimals and rejects invalid quantities', () => {
  for (const received of ['0.10', '0.29']) assert.equal(isPartialReceipt(item(1, received, '0.30')), true);
  for (const received of [null, '', '0', '0.00', '0.30', '0.31', '-1', 'bad']) assert.equal(isPartialReceipt(item(1, received, '0.30')), false);
  assert.equal(isPartialReceipt(item(1, '1', 'bad')), false);
});

test('device r2: free receipts and untouched orders have no amber quantity warning', async () => {
  for (const items of [undefined, [], [item(1, '0'), item(2, null)], [item(1, '20'), item(2, '21')]]) {
    const h = await create(items);
    assert.equal(warnings(h).length, 0);
    assert.ok(!h.text(h.all()).includes('ตรวจยอดคงเหลือ'));
    h.unmount();
  }
});

test('device r2: only selected partial receipts explain both the reason and next action', async () => {
  const h = await create([item(1, '5'), item(2, '0')]);
  assert.equal(warnings(h).length, 1);
  assert.equal(h.text(warnings(h)[0]), '1 รายการที่เลือกเคยรับบางส่วนแล้ว หลังสร้างใบรับ ให้ตรวจจำนวนรับจริงเทียบยอดที่ยังขาด');
  const partial = () => h.find(node => node.type === 'input' && node.props.type === 'checkbox');
  partial().props.onChange({ target: { checked: false } }); await h.settle();
  assert.equal(warnings(h).length, 0);
  partial().props.onChange({ target: { checked: true } }); await h.settle();
  assert.equal(warnings(h).length, 1);
  assert.equal(h.calls.length, 0);
  h.unmount();
});

test('device r2: fully received rows do not warn until a partial row is explicitly selected', async () => {
  const h = await create([{ ...item(1, '5'), is_received: true }, item(2, '0.10', '0.30')]);
  assert.ok(h.text(warnings(h)[0]).startsWith('1 รายการ'));
  h.find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } }); await h.settle();
  assert.ok(h.text(warnings(h)[0]).startsWith('2 รายการ'));
  h.unmount();
});
