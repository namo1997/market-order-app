import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { harness } from './receiving-harness.mjs';
import { documentReviewSummary, reviewFingerprint } from '../src/pages/receiving/receiving-review.js';
import { moneyStatus, priceCompleteness } from '../src/pages/receiving/receiving-status.js';

const line = (id, values = {}) => ({ id, line_no: id, product_id: id, order_item_id: id,
  product_name: `ผัก ${id}`, unit_text: 'กก.', quantity_received: '1', quantity_billed: '1', amount: '10', unit_price: '10',
  match: { source: 'order' }, ...values });
const document = (values = {}) => ({ id: 5, status: 'draft', kind: 'bill', delivery_date: '2026-10-16',
  has_receiver_signature: true, total: '20', discount: '0', vat: '0', images: [], lines: [line(1), line(2)],
  ocr: { status: 'done' }, warnings: [{ code: 'PRICE_CHANGE', line_no: 1 }], ...values });
const expected = [1, 2].map(id => ({ order_item_id: id, product_id: id, quantity_ordered: '1', received_quantity: '0', unit_name: 'กก.' }));
const editor = (doc = document(), overrides = {}) => harness('DocumentEditor', { initialDocument: doc,
  user: { id: 1, name: 'ผู้รับ', role: 'receiver' }, onBack() {}, onChanged() {} },
{ expected: async () => [{ items: expected }], ...overrides }, {}, {}, { setTimeout: done => { done(); return 1; }, clearTimeout() {} });
const summaryLabel = (h) => h.find(node => node.props.className === 'rc-review-trigger').props['aria-label'];
const buttonTexts = h => h.visible().filter(node => node.type === 'button').map(node => h.text(node));

test('UX061 #1: review work is separate; warning counts persist across review/save/sign/confirm', async () => {
  let expectedReads = 0;
  const h = await editor(document(), { expected: async () => { expectedReads++; return [{ items: expected }]; } });
  await h.radio('lines');
  assert.equal(summaryLabel(h), 'ยังไม่ตรวจ 2 รายการ · ข้อเตือนสินค้า 1 รายการ · ข้อสังเกตบิล 0 ข้อ');
  assert.ok(buttonTexts(h).includes('ยังไม่ตรวจ 2'));
  for (const id of [1, 2]) { await h.select(`รับจริง ผัก ${id}`, '1'); await h.click('บันทึกและถัดไป'); }
  const label = 'ยังไม่ตรวจ 0 รายการ · ข้อเตือนสินค้า 1 รายการ · ข้อสังเกตบิล 0 ข้อ';
  assert.equal(summaryLabel(h), label); assert.ok(buttonTexts(h).includes('ยังไม่ตรวจ 0'));
  await h.click('ไปเซ็น'); assert.equal(summaryLabel(h), label);
  await h.click('ตรวจรับ');
  assert.equal(h.text(h.find(node => node.props.className === 'rc-confirm-caution')), 'ยืนยันแล้วเข้าคลัง แก้ไม่ได้');
  assert.ok(h.text(h.visible()).includes('ข้อเตือนสินค้า 1 รายการ'));
  assert.equal(expectedReads, 1, 'saving a draft preserves its order comparison instead of briefly treating all rows as unmatched');
  assert.equal(h.calls.filter(call => call[0] === 'update').length, 1); h.unmount();
});

test('UX061 #1: server changes after save are displayed before confirmation; next attempt uses refreshed summary', async () => {
  const initial = document({ lines: [line(1, { match: { source: 'manual' } }), line(2, { match: { source: 'manual' } })] });
  const h = await editor(initial, { update: async (id, body) => ({ ...initial, ...body, warnings: [] }) });
  await h.radio('lines'); await h.click('ทั้งหมด'); await h.select('รับจริง ผัก 1', '1'); await h.click('บันทึกและถัดไป');
  await h.click('ไปเซ็น'); await h.click('ตรวจรับ');
  assert.equal(h.text(h.find(node => node.type === 'h2')), 'ตรวจสรุป');
  assert.ok(h.text(h.find(node => node.type === 'details')).includes('ข้อเตือนสินค้า 0 รายการ'));
  assert.ok(h.text(h.visible()).includes('สรุปเปลี่ยน: ข้อเตือนสินค้า 1→0 รายการ'));
  assert.ok(!buttonTexts(h).includes('ยืนยัน'));
  await h.click('ตรวจสรุปแล้ว ไปเซ็น'); await h.click('ตรวจรับ');
  assert.equal(h.text(h.find(node => node.props.className === 'rc-confirm-caution')), 'ยืนยันแล้วเข้าคลัง แก้ไม่ได้'); h.unmount();
});

test('UX061 #1: equal counts with different reasons still require an updated summary', () => {
  const before = documentReviewSummary(document(), expected);
  const after = documentReviewSummary(document({ warnings: [{ code: 'LOW_CONFIDENCE', line_no: 1 }] }), expected);
  assert.equal(before.itemCount, after.itemCount); assert.notEqual(reviewFingerprint(before), reviewFingerprint(after));
});

test('UX061 #2: missing/blank prices differ from explicit zero while the money equation remains unchanged', () => {
  const lines = [line(1, { amount: null, unit_price: null }), line(2, { amount: '', unit_price: '' }),
    line(3, { amount: '0', unit_price: null }), line(4, { amount: null, unit_price: '0' })];
  assert.deepEqual(priceCompleteness(lines), { missingCount: 2, label: 'ยังไม่มีราคา 2 รายการ' });
  const money = moneyStatus(lines, '0', '0', '0'); assert.equal(money.status, 'ok'); assert.equal(money.adjusted, 0n);
  assert.deepEqual(priceCompleteness([line(1)]), { missingCount: 0, label: '' });
});

test('UX061 #2: confirmation, success, details and reopening retain missing-price context beside matching totals', async () => {
  const doc = document({ lines: [line(1, { match: { source: 'manual' } }), line(2, { amount: null, unit_price: null, match: { source: 'manual' } })], total: '10' });
  const h = await editor(doc); await h.radio('sign'); await h.click('ตรวจรับ');
  assert.ok(h.text(h.visible()).includes('ผลรวมตรงยอดบิล')); assert.ok(h.text(h.visible()).includes('ยังไม่มีราคา 1 รายการ'));
  await h.click('ยืนยัน');
  assert.ok(h.text(h.visible()).includes('ยังไม่มีราคา 1 รายการ')); assert.ok(h.text(h.visible()).includes('รับของแล้ว รอราคา'));
  assert.ok(h.text(h.visible()).includes('10.00 บาท')); await h.click('ดูเอกสาร');
  assert.ok(h.text(h.visible()).includes('รับของแล้ว รอราคา')); h.unmount();
  const reopened = await editor({ ...doc, status: 'confirmed' }); await reopened.radio('sign');
  assert.ok(reopened.text(reopened.visible()).includes('ยังไม่มีราคา 1 รายการ')); reopened.unmount();
});

test('UX061 #3: success/edit bars reserve nowrap secondary labels, flexible primary and 48px touch targets', async () => {
  const css = postcss.parse(await readFile(new URL('../src/pages/receiving/receiving.css', import.meta.url), 'utf8'));
  const value = (selector, prop) => { let result; css.walkRules(selector, rule => rule.walkDecls(prop, decl => { result = decl.value; })); return result; };
  const secondary = '.solao :is(.rc-success-bar, .rc-edit-bar) > .rc-text-action';
  assert.equal(value(secondary, 'white-space'), 'nowrap'); assert.equal(value(secondary, 'overflow-wrap'), 'normal');
  assert.equal(value(secondary, 'flex'), '0 0 auto'); assert.equal(value(secondary, 'min-height'), 'var(--sg-touch)');
  assert.equal(value(secondary, 'min-width'), 'var(--sg-touch)');
  const primary = '.solao :is(.rc-success-bar, .rc-edit-bar) > .sg-primary';
  assert.equal(value(primary, 'flex'), '1 1 0'); assert.equal(value(primary, 'width'), 'auto'); assert.equal(value(primary, 'min-width'), '0');
  const h = await editor(); await h.radio('lines'); await h.select('รับจริง ผัก 1', '2');
  assert.ok(h.visible().some(node => node.props.className?.includes('sg-bar') && node.props.className.includes('rc-edit-bar'))); h.unmount();
  const success = await editor(document({ status: 'confirmed' })); await success.radio('sign');
  assert.ok(success.visible().some(node => node.props.className?.includes('sg-bar') && node.props.className.includes('rc-success-bar'))); success.unmount();
});

test('UX061 #4: same code+line across bill/OCR sources merges once; different lines and unknown scope survive', () => {
  const doc = document({ warnings: [{ code: 'PRICE_CHANGE', line_no: 1 }, { code: 'PRICE_CHANGE', line_no: 2 }, { code: 'PRICE_CHANGE' }],
    ocr: { warnings: [{ code: 'PRICE_CHANGE', line_no: '1' }, { code: 'PRICE_CHANGE', line_no: '2' }, 'PRICE_CHANGE'] } });
  const checks = documentReviewSummary(doc, expected);
  assert.equal(checks.itemCount, 2); assert.equal(checks.documentCount, 1);
  for (const row of checks.rows) assert.equal(row.reasons.filter(reason => reason.includes('ราคาเปลี่ยน')).length, 1);
  assert.match(checks.documentReasons[0], /^ทั้งบิล \(ไม่ระบุรายการ\): ราคาเปลี่ยน/);
  assert.equal(doc.ocr.warnings.length, 3, 'summarizing never mutates source warnings');
});

test('UX061 #5: completion has one message; hiding row feedback preserves undo history and quantities', async () => {
  const h = await editor(); await h.radio('lines'); await h.select('รับจริง ผัก 1', '0.5'); await h.click('บันทึกและถัดไป');
  await h.click('ปิดข้อความ'); assert.ok(buttonTexts(h).includes('เลิกทำรายการล่าสุด'));
  await h.select('รับจริง ผัก 2', '1'); await h.click('บันทึกและถัดไป');
  assert.equal(h.visible().filter(node => node.type === 'strong' && h.text(node) === 'ตรวจครบ 2 รายการ').length, 1);
  assert.ok(!buttonTexts(h).includes('ปิดข้อความ')); assert.ok(!h.text(h.visible()).includes('ตรวจรายการนี้แล้ว'));
  await h.click('เลิกทำรายการล่าสุด'); assert.ok(buttonTexts(h).includes('ยังไม่ตรวจ 1'));
  await h.click('เลิกทำรายการล่าสุด'); assert.ok(buttonTexts(h).includes('ยังไม่ตรวจ 2'));
  assert.equal(h.find(node => node.props.id === 'line-0-inline').props.value, '1'); assert.equal(h.calls.length, 0); h.unmount();
});

test('UX061 #6: inline editing has one save/cancel location and compact AI hint', async () => {
  const h = await editor(); await h.radio('lines'); await h.select('รับจริง ผัก 1', '2.5');
  const rows = h.visible().filter(node => node.props.className === 'rc-compact-item');
  assert.ok(!h.all(rows[0]).some(node => node.type === 'button' && /ยกเลิก|บันทึก|ตรวจรายการนี้แล้ว/.test(h.text(node))));
  assert.equal(buttonTexts(h).filter(text => text === 'ยกเลิกแก้').length, 1);
  assert.equal(buttonTexts(h).filter(text => text === 'บันทึกและถัดไป').length, 1);
  assert.ok(h.text(h.visible()).includes('AI: 1 กก.ใช้ค่า'));
  await h.click('ยกเลิกแก้'); assert.equal(h.find(node => node.props.id === 'line-0-inline').props.value, '1'); h.unmount();
});

test('UX061 #4: identical fallback text from distinct codes/scopes is never silently discarded', () => {
  const checks = documentReviewSummary(document({ warnings: [{ code: 'UNKNOWN_A' }, { code: 'UNKNOWN_B' },
    { code: 'UNKNOWN_A', line_no: 1 }, { code: 'UNKNOWN_B', line_no: 1 }] }), expected);
  assert.equal(checks.documentCount, 2); assert.equal(checks.rows.length, 1); assert.equal(checks.rows[0].reasons.length, 2);
});

test('UX061 #1: signature refresh also displays changed reasons before proceeding', async () => {
  const initial = document({ has_receiver_signature: false, lines: [line(1, { match: { source: 'manual' } }), line(2, { match: { source: 'manual' } })] });
  const h = await editor(initial, { get: async () => ({ ...initial, has_receiver_signature: true, warnings: [{ code: 'LOW_CONFIDENCE', line_no: 1 }] }) });
  await h.radio('sign');
  const canvas = h.find(node => node.type === 'canvas');
  canvas.props.onPointerDown({ button: 0, pointerType: 'mouse', pointerId: 1, clientX: 50, clientY: 50, preventDefault() {} });
  canvas.props.onPointerUp(); await h.settle(); await h.click('บันทึกเซ็น');
  assert.ok(h.text(h.visible()).includes('สรุปเปลี่ยน: รายละเอียดข้อเตือนเปลี่ยน กรุณาตรวจอีกครั้ง'));
  assert.ok(h.text(h.visible()).includes('อ่านบิลได้ไม่ชัด')); assert.ok(!buttonTexts(h).includes('ยืนยัน')); h.unmount();
});

test('UX061 #1: explicit draft save announces refreshed warning counts', async () => {
  const initial = document({ lines: [line(1, { match: { source: 'manual' } }), line(2, { match: { source: 'manual' } })] });
  const h = await editor(initial, { update: async (id, body) => ({ ...initial, ...body, warnings: [] }) });
  await h.radio('lines'); await h.click('ทั้งหมด'); await h.select('รับจริง ผัก 1', '1'); await h.click('บันทึกและถัดไป');
  await h.click('เพิ่มเติม'); await h.select('ทำรายการ', 'save'); await h.click('เลือก');
  assert.ok(h.text(h.visible()).includes('สรุปเปลี่ยน: ข้อเตือนสินค้า 1→0 รายการ'));
  assert.equal(summaryLabel(h), 'ยังไม่ตรวจ 0 รายการ · ข้อเตือนสินค้า 0 รายการ · ข้อสังเกตบิล 0 ข้อ'); h.unmount();
});
