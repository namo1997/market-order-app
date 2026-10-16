import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { harness } from './receiving-harness.mjs';
import { focusField } from '../src/pages/receiving/receiving-validation.js';
import { decimalEntryValid, rejectDecimalEntry } from '../src/pages/receiving/decimal-entry.js';

const user = { id: 1, name: 'ผู้รับทดสอบ', role: 'receiver' };
const line = (id, values = {}) => ({ id, line_no: id, product_id: id, order_item_id: id,
  product_name: `ผัก ${id}`, unit_text: 'กก.', quantity_received: '1', quantity_billed: '1', unit_price: '10', amount: '10',
  match: { source: 'order' }, ...values });
const doc = (values = {}) => ({ id: 5, status: 'draft', kind: 'bill', delivery_date: '2026-10-16',
  receiver_name: user.name, has_receiver_signature: true, total: '20', discount: '0', vat: '0', images: [],
  lines: [line(1), line(2)], ocr: { status: 'done' }, warnings: [], ...values });
const editor = (values, props = {}) => harness('DocumentEditor', { initialDocument: doc(values), user,
  onBack() {}, onChanged() {}, ...props }, { expected: async () => [{ items: [1, 2].map(id => ({ order_item_id: id, product_id: id, quantity_ordered: '1', received_quantity: '0', unit_name: 'กก.' })) }] }, {}, {}, { setTimeout: done => { done(); return 1; }, clearTimeout() {} });
const primary = h => h.find(node => node.type === 'button' && node.props.className?.includes('sg-primary'));
const field = (h, id = 'line-0-inline') => h.find(node => node.props.id === id);

test('UX060 #1: focus alone leaves CTA available; changing creates an actionable edit, save advances focus without accepting the next row', async () => {
  const h = await editor(); await h.radio('lines');
  field(h).props.onFocus(); await h.settle();
  assert.equal(h.text(primary(h)), 'ตรวจรายการก่อน (ค้าง 2)'); assert.equal(primary(h).props.disabled, false);
  await h.select('รับจริง ผัก 1', '0.5');
  assert.equal(h.text(primary(h)), 'บันทึกและตรวจถัดไป'); assert.equal(primary(h).props.disabled, false);
  await h.click('บันทึกและตรวจถัดไป');
  assert.equal(h.focused.at(-1), 'line-1-inline');
  assert.ok(h.text(h.visible()).includes('ตรวจแล้ว 1/2'));
  assert.ok(h.text(h.visible()).includes('ตรวจรายการนี้แล้ว'));
  assert.ok(h.text(h.visible()).includes('มีการแก้ไขรอบันทึก'));
  assert.equal(h.calls.length, 0); h.budget(); h.unmount();
});

test('UX060 #1: switching rows explains the open edit and returns focus; cancel preserves original quantities', async () => {
  const h = await editor(); await h.radio('lines'); await h.select('รับจริง ผัก 1', '2');
  const other = field(h, 'line-1-inline'); assert.equal(other.props.disabled, false);
  other.props.onFocus(); await h.settle();
  assert.ok(h.text(h.visible()).includes('บันทึกหรือยกเลิกแถวที่กำลังแก้ก่อน'));
  assert.equal(h.focused.at(-1), 'line-0-inline'); assert.equal(field(h).props.value, '2');
  assert.equal(field(h, 'line-1-inline').props.value, '1');
  await h.click('ยกเลิกแก้'); assert.equal(field(h).props.value, '1'); h.unmount();
});

test('UX060 #1: invalid empty quantity keeps enabled save CTA and focuses the field with a reason', async () => {
  const h = await editor(); await h.radio('lines'); await h.select('รับจริง ผัก 1', '');
  await h.click('บันทึกและตรวจถัดไป');
  assert.equal(h.focused.at(-1), 'line-0-inline'); assert.equal(field(h).props.value, '');
  assert.equal(primary(h).props.disabled, false); assert.ok(h.text(h.visible()).includes('กรอกจำนวนรับจริง'));
  assert.equal(h.calls.length, 0); h.unmount();
});

test('UX060 #1/#8: focus clears measured sticky header and complete row actions above keyboard/bar', () => {
  const scrolled = [];
  const row = { scrollIntoView() {}, getBoundingClientRect: () => ({ top: 80, bottom: 240, height: 160 }) };
  const input = { closest: selector => selector === '.rc-compact-item' ? row : null, focus() {}, getBoundingClientRect: () => ({ top: 80, bottom: 128 }) };
  focusField('test', { getElementById: () => input, defaultView: { innerHeight: 800, visualViewport: { height: 420 }, scrollBy: options => scrolled.push(options.top) },
    querySelector: selector => ({ getBoundingClientRect: () => selector.includes('toolbar') ? { bottom: 140 } : selector.includes('shell') ? { bottom: 64 } : { top: 360 } }) });
  assert.deepEqual(scrolled, [-68]);
});

test('UX060 #2: warning badge/details/confirm share counts, deduplicate a product warning and name both products', async () => {
  const h = await editor({ lines: [line(1, { match: { source: 'manual' } }), line(2, { match: { source: 'manual' } })],
    warnings: [{ code: 'PRICE_CHANGE', line_no: 1 }, { code: 'PRICE_CHANGE', line_no: 1 }, { code: 'PRICE_CHANGE', line_no: 2 }, { code: 'DOC_KIND_UNCERTAIN' }],
    ocr: { status: 'done', warnings: [{ code: 'DOC_KIND_UNCERTAIN' }] } });
  const summary = 'ยังไม่ตรวจ 0 รายการ · ข้อเตือนสินค้า 2 รายการ · ข้อสังเกตบิล 1 ข้อ';
  await h.click(summary);
  assert.equal(h.visible().filter(node => node.props.className === 'rc-check-row').length, 2);
  await h.click('ปิด'); await h.radio('sign'); await h.click('ตรวจรับ');
  const list = h.visible().find(node => node.props.className === 'rc-stack rc-warning-details');
  assert.ok(h.text(list).includes('ข้อเตือนสินค้า 2 รายการ'));
  assert.ok(h.text(list).includes('ข้อสังเกตบิล 1 ข้อ'));
  const rows = h.all(list).filter(node => node.type === 'li');
  assert.equal(rows.length, 3); assert.ok(h.text(rows[0]).includes('ผัก 1')); assert.ok(h.text(rows[1]).includes('ผัก 2'));
  assert.equal(h.text(list).split('ราคาเปลี่ยน').length - 1, 2);
  assert.ok(h.text(h.visible()).includes('ผลรวมตรงยอดบิล'));
  assert.equal(h.text(h.find(node => node.props.className === 'rc-confirm-caution')), 'ยืนยันแล้วเข้าคลัง แก้ไม่ได้'); h.unmount();
});

test('UX060 #4: starting another edit clears announcement while undo remains available after cancel', async () => {
  const h = await editor(); await h.radio('lines'); await h.select('รับจริง ผัก 1', '0.5'); await h.click('บันทึกและตรวจถัดไป');
  await h.select('รับจริง ผัก 2', '0.5');
  assert.ok(!h.visible().some(node => node.type === 'span' && node.props.role === 'status' && h.text(node) === 'ตรวจรายการนี้แล้ว'));
  await h.click('ยกเลิกแก้'); await h.click('เลิกทำรายการล่าสุด'); assert.ok(h.text(h.visible()).includes('ตรวจแล้ว 0/2')); h.unmount();
});

test('UX060 #5/#13: sheet scrolls only its body and success reserves a fixed GlassBar plus full mobile width', async () => {
  const css = postcss.parse(await readFile(new URL('../src/design/styles.css', import.meta.url), 'utf8'));
  const value = (selector, name) => { let value; css.walkRules(selector, r => r.walkDecls(name, d => { value = d.value; })); return value; };
  assert.equal(value('.solao .sg-sheet[open]', 'display'), 'flex');
  assert.equal(value('.solao .sg-sheet', 'overflow'), 'hidden');
  assert.equal(value('.solao .sg-sheet-body', 'min-height'), '0'); assert.equal(value('.solao .sg-sheet-body', 'overflow-y'), 'auto');
  for (const selector of ['.solao .sg-sheet-header', '.solao .sg-sheet-actions']) assert.equal(value(selector, 'flex-shrink'), '0');
  assert.equal(value('.solao .sg-sheet-actions', 'background'), 'var(--sg-surface)');
  let next = 0;
  const h = await editor({ status: 'confirmed' }, { onNextShop: () => next++ }); await h.radio('sign');
  const bar = h.find(node => node.props.className?.split(' ').includes('sg-bar'));
  assert.ok(h.text(bar).includes('กลับหน้ารับสินค้า')); assert.ok(h.text(bar).includes('ดูเอกสาร')); h.budget();
  await h.click('กลับหน้ารับสินค้า'); assert.equal(next, 1); await h.click('ดูเอกสาร');
  assert.ok(h.text(h.visible()).includes('ผู้ส่ง ไม่ระบุชื่อผู้ส่ง')); h.unmount();
});

test('UX060 #7/#9: absent price displays dash; explicit zero stays zero and bill fields are one tap away', async () => {
  const h = await editor({ lines: [line(1, { amount: null, unit_price: null }), line(2, { amount: '0', unit_price: '0' })], total: '0' });
  await h.radio('lines');
  const amounts = h.visible().filter(node => node.props.className === 'rc-line-amount rc-text-action');
  assert.equal(h.text(amounts[0]), '—ยังไม่มีราคา'); assert.equal(h.text(amounts[1]), '0.00');
  assert.ok(h.text(h.visible()).includes('รับจริงยอดในบิล')); assert.ok(h.text(h.visible()).includes('AI: 1 กก.'));
  await h.click('ราคาและบิล ผัก 1'); assert.ok(h.text(h.visible()).includes('จำนวนในบิล 1 กก. · ราคาต่อหน่วย — บาท')); h.unmount();
});

test('UX060 #10: rejects misplaced signs on type/paste, preserves text/caret and accepts intermediate decimals', () => {
  for (const value of ['', '.', '20.', '.5', '0', '20.5']) assert.equal(decimalEntryValid(value), true);
  for (const value of ['20-', '-1', '1e3', '1.2.3', 'abc']) assert.equal(decimalEntryValid(value), false);
  let caret, stopped = false;
  const target = { value: '20-5', selectionStart: 3, setSelectionRange: (a, b) => { caret = [a, b]; } };
  assert.equal(rejectDecimalEntry({ target, stopPropagation: () => { stopped = true; } }, '205'), true);
  assert.equal(target.value, '205'); assert.deepEqual(caret, [2, 2]); assert.equal(stopped, true);
});

test('UX060 #8/#11/#12: batch tools are disclosed, image count appears once and zero counters have no warning color', async () => {
  const h = await editor();
  assert.equal(h.visible().filter(node => node.type === 'span' && h.text(node) === '0/10 หน้า').length, 1);
  await h.radio('lines');
  assert.equal(h.visible().some(node => node.type === 'button' && h.text(node) === 'เลือกทั้งหมดที่แสดง'), false);
  await h.click('เลือกหลายรายการ'); await h.click('เลือกทั้งหมดที่แสดง');
  assert.ok(h.text(h.visible()).includes('เลือก 2 รายการ'));
  const over = h.visible().find(node => h.text(node) === 'เกิน 0 รายการ'); assert.equal(over.props['data-status'], undefined); h.unmount();
  const overview = await harness('Receiving', { chrome: 'embedded' });
  assert.ok(overview.text(overview.visible()).includes('รอรับ 1 ร้าน')); assert.equal(overview.text(primary(overview)), 'เริ่มรับร้านนี้');
  assert.equal(overview.text(overview.find(node => node.type === 'h1')), 'รอรับ 1 ร้าน'); overview.unmount();
});

test('UX060 #5: create/confirm actions are in a sibling footer outside the scrolling body', async () => {
  const create = await harness('CreateDocument', { group: { supplier_key: 'pg:1', supplier_name: 'ร้านทดสอบ', items: [] }, date: '2026-10-16', user, onClose() {}, onCreated() {} });
  const check = h => {
    const dialog = h.find(node => node.type === 'dialog');
    const body = h.all(dialog).find(node => node.props.className === 'sg-sheet-body');
    const footer = h.all(dialog).find(node => node.type === 'footer' && node.props.className === 'sg-sheet-actions');
    assert.ok(body); assert.ok(footer);
    assert.equal(h.all(body).includes(footer), false);
    assert.equal(h.all(footer).filter(node => node.props.className?.includes('sg-primary')).length, 1);
    assert.equal(h.all(body).filter(node => node.props.className?.includes('sg-primary')).length, 0);
  };
  check(create); create.unmount();
  const h = await editor({ lines: [line(1, { match: { source: 'manual' } }), line(2, { match: { source: 'manual' } })] });
  await h.radio('sign'); await h.click('ตรวจรับ'); check(h); h.unmount();
});

test('UX060 #10: full editor and header preserve accepted text when malformed text is rejected', async () => {
  const h = await editor(); await h.radio('lines'); await h.click('แก้ ผัก 1');
  await h.select('รับจริง', '20.'); assert.equal(field(h, 'line-0-quantity_received').props.value, '20.');
  await h.select('รับจริง', '20-'); assert.equal(field(h, 'line-0-quantity_received').props.value, '20.');
  assert.ok(h.text(h.visible()).includes('ใช้ตัวเลขตั้งแต่ 0'));
  await h.click('ยกเลิกแก้'); await h.click('เพิ่มเติม'); await h.select('ทำรายการ', 'header'); await h.click('เลือก');
  await h.select('ยอดบิล', '20-'); assert.equal(field(h, 'header-total').props.value, '20');
  assert.equal(field(h, 'header-total').props['aria-invalid'], true);
  assert.equal(h.calls.length, 0); h.unmount();
});
