import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';
import { numberError, firstDocumentError } from '../src/pages/receiving/receiving-validation.js';
import { prepareOcrReview, resolveAiLine, markOcrProposals } from '../src/pages/receiving/receiving-ai.js';
import { documentBody } from '../src/pages/receiving/receiving-utils.js';
import { readThemePreference, saveThemePreference } from '../src/design/theme-preference.js';

const user = { id: 1, role: 'admin' };
const line = (id = 3) => ({ id, product_id: 7, product_name: 'ผัก', order_item_id: 42, unit_text: 'กก.', quantity_received: '2', quantity_billed: '2', unit_price: '10', amount: '20', match: { source: 'order', confidence: .6 } });
const document = () => ({ id: 5, status: 'draft', kind: 'bill', delivery_date: '2026-10-15', receiver_user_id: 1,
  has_receiver_signature: true, images: [], ocr: { status: 'none' }, warnings: [], total: '20', discount: '0', vat: '0', lines: [line()] });
const open = async (h, action) => { await h.click('เพิ่มเติม'); await h.select('ทำรายการ', action); await h.click('เลือก'); };
const editor = (doc = document(), api = {}) => harness('DocumentEditor', { initialDocument: doc, user, onBack() {}, onChanged() {} }, api);
const message = (h, value) => h.all().some(node => h.text(node) === value);

test('r2: apply is local; failed API save retains values and unsaved state; only success clears it', async () => {
  let fails = true;
  const h = await editor(document(), { update: async (id, body) => {
    h.calls.push(['update', id, body]);
    if (fails) throw { response: { status: 422, data: { code: 'VALIDATION_FAILED' } } };
    return { ...document(), ...body };
  } });
  await open(h, 'header'); await h.select('เลขบิล', 'B-7'); await h.click('ใช้ข้อมูล');
  assert.equal(h.calls.length, 0); assert.ok(message(h, 'มีการแก้ไขรอบันทึก'));
  await open(h, 'save'); assert.equal(h.calls.length, 1); assert.ok(message(h, 'มีการแก้ไขรอบันทึก'));
  await h.click('ปิด'); await open(h, 'header');
  assert.ok(h.find(node => node.type === 'input' && node.props.value === 'B-7')); await h.click('ปิด');
  fails = false; await open(h, 'save');
  assert.equal(h.calls.length, 2); assert.ok(message(h, 'บันทึกร่างแล้ว')); assert.ok(!message(h, 'มีการแก้ไขรอบันทึก'));
});

test('r2: field validation selects the first invalid row, opens price details and focuses the field', async () => {
  const doc = document(); doc.lines.push({ ...line(4), unit_price: '-1' });
  const h = await editor(doc);
  await open(h, 'save');
  assert.equal(h.calls.length, 0);
  assert.equal(h.focused.at(-1), 'line-1-unit_price');
  const input = h.find(node => node.props.id === 'line-1-unit_price');
  assert.equal(input.props['aria-invalid'], true);
  assert.equal(h.opened.at(-1), 'line-1-unit_price');
  assert.ok(h.find(node => node.props.id === 'line-1-unit_price-hint'));
  await h.select('ราคาต่อหน่วย', '10');
  assert.equal(h.find(node => node.props.id === 'line-1-unit_price').props['aria-invalid'], undefined);
});

test('r2: bill header validation stays open with inline error and focus until corrected', async () => {
  const h = await editor(); await open(h, 'header'); await h.select('ยอดบิล', '1000000000000'); await h.click('ใช้ข้อมูล');
  assert.equal(h.focused.at(-1), 'header-total');
  assert.equal(h.find(node => node.props.id === 'header-total').props['aria-invalid'], true);
  assert.equal(h.calls.length, 0);
  await h.select('ยอดบิล', '25'); await h.click('ใช้ข้อมูล'); assert.ok(message(h, 'มีการแก้ไขรอบันทึก'));
});

test('r2: decimal validation uses API limits and reports the precise quantity/price/amount field', () => {
  for (const value of ['-1', 'NaN', '1e3', ' ']) assert.ok(numberError(value, 'quantity_received'));
  for (const [field, value] of [['quantity_received', '100000000'], ['unit_price', '1000000'], ['amount', '1000000000']]) assert.ok(numberError(value, field));
  assert.equal(numberError('1,234.50', 'amount'), '');
  assert.equal(numberError('0.123456', 'unit_price'), '');
  assert.equal(numberError('', 'quantity_received'), 'กรอกจำนวนรับจริง');
  assert.equal(numberError('', 'amount'), '');
  const doc = document(); doc.lines[0].quantity_received = '-1'; assert.equal(firstDocumentError(doc).id, 'line-0-quantity_received');
  doc.lines[0] = line(); doc.total = 'bad'; assert.equal(firstDocumentError(doc).id, 'header-total');
});

test('r2: OCR decisions are per line; pending AI blocks confirm and warnings appear beside the row', async () => {
  const doc = document(); doc.ocr = { status: 'done' }; doc.warnings = [{ code: 'LOW_CONFIDENCE', line_no: 1 }];
  const h = await editor(doc);
  await h.radio('sign'); await h.click('ตรวจรายการก่อน (ค้าง 1)');
  assert.equal(h.calls.length, 0); assert.ok(h.text(h.visible()).includes('AI เสนอ'));
  await h.click('แก้ ผัก');
  assert.ok(h.text(h.visible()).includes('อ่านบิลได้ไม่ชัด กรุณาตรวจจากรูปต้นฉบับ'));
  await h.click('ปิด');
  await h.acceptAi('ผัก'); assert.ok(h.text(h.visible()).includes('ตรวจครบ 1 รายการ')); assert.ok(!h.visible().some(node => node.props['aria-label'] === 'ใช้ AI ผัก')); assert.ok(message(h, 'มีการแก้ไขรอบันทึก'));
  await h.radio('sign'); await h.click('ตรวจรับ'); await h.click('ยืนยัน');
  assert.equal(h.calls.filter(call => call[0] === 'confirm').length, 1);
  assert.equal(h.calls.find(call => call[0] === 'update')[2].lines[0].match.source, 'manual');
});

test('r2: OCR reread preserves edited lines and explicitly cleared header; edit/zero remain independent', async () => {
  const doc = document(); doc.images = [{ id: 1, page_no: 1 }];
  const h = await editor(doc, { image: async () => new Blob(['image']), ocr: async () => {
    h.calls.push(['ocr']); return { ...document(), doc_ref: 'AI-REF', ocr: { status: 'done' }, lines: [{ ...line(), quantity_received: '99' }, { ...line(4), order_item_id: null, bill_text: 'ใหม่' }] };
  } });
  await h.radio('lines'); await h.click('ทั้งหมด'); await h.select('รับจริง', '1.5'); await h.click('บันทึกและตรวจถัดไป');
  await open(h, 'header'); await h.select('เลขบิล', ''); await h.click('ใช้ข้อมูล');
  await open(h, 'ocr');
  await h.click('ทั้งหมด');
  assert.equal(h.find(node => node.props.id === 'line-0-inline').props.value, '1.50');
  await open(h, 'header'); assert.ok(h.find(node => node.type === 'input' && node.props.value === '')); await h.click('ปิด');
  // Explicitly mark the added proposal unreceived; retain the row and allow undo.
  assert.equal(h.find(node => node.props.id === 'line-1-review').props.disabled, true);
  const field = h.find(node => node.props.id === 'line-1-inline'); field.props.onChange({ target: { value: '0' } }); await h.settle(); await h.click('บันทึกและตรวจถัดไป');
  await open(h, 'save');
  const body = h.calls.filter(call => call[0] === 'update').at(-1)[2];
  assert.equal(body.lines.length, 2); assert.deepEqual(Array.from(body.deleted_line_ids), []);
  assert.equal(body.lines[1].quantity_received, '0.00');
  assert.equal(body.lines[0].quantity_received, '1.50');
});

test('r2: skip restores a prior row; accepting/editing survives reopen without leaking UI metadata', () => {
  const prior = document(); const response = { ...document(), ocr: { status: 'done' }, lines: [{ ...line(), quantity_received: '8' }] };
  const proposed = prepareOcrReview(prior, response);
  assert.equal(resolveAiLine(proposed.lines[0], 'skip').quantity_received, '2');
  assert.equal(resolveAiLine(proposed.lines[0], 'edit').quantity_received, '8');
  assert.equal(resolveAiLine({ ...line(), _aiBaseline: null }, 'skip'), null);
  const accepted = { ...proposed, lines: [resolveAiLine(proposed.lines[0], 'use')] };
  assert.equal(markOcrProposals(accepted).lines[0]._aiProposal, undefined);
  const body = documentBody(proposed); assert.ok(!JSON.stringify(body).includes('_ai'));
});

test('r2: theme defaults to auto, persists each choice, and updates document root shared with the shell', async () => {
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.equal(readThemePreference(blocked), 'auto'); assert.doesNotThrow(() => saveThemePreference(blocked, 'dark'));
  assert.equal(readThemePreference({ getItem: () => 'invalid' }), 'auto');
  const h = await harness('Receiving'); await h.click('ตัวเลือก');
  const root = () => h.document.documentElement.dataset;
  assert.equal(root().theme, 'auto');
  for (const value of ['dark', 'light', 'auto']) {
    await h.radio(value); assert.equal(root().theme, value);
    assert.equal(h.storage.get('solao.receiving.theme.v1'), value);
  }
  const refreshed = await harness('Receiving', {}, {}, {}, { localStorage: { getItem: () => 'dark' } });
  assert.equal(refreshed.document.documentElement.dataset.theme, 'dark');
});


test('r2: drafts can save an unmatched product, but review focuses the product before confirmation', async () => {
  const doc = document(); doc.lines[0].product_id = null;
  const h = await editor(doc); await h.radio('lines'); await h.click('ทั้งหมด'); await h.select('รับจริง', '1'); await h.click('บันทึกและตรวจถัดไป');
  await open(h, 'save'); assert.equal(h.calls.filter(call => call[0] === 'update').length, 1);
  await h.radio('sign'); await h.click('ตรวจข้อมูลก่อน');
  assert.equal(h.focused.at(-1), 'line-0-product_id');
  assert.equal(h.calls.filter(call => call[0] === 'confirm').length, 0);
});

test('r2: repeated OCR keeps a new proposal skippable and never duplicates a reviewed order row', () => {
  const prior = document(); prior.lines = [];
  const response = { ...document(), ocr: { status: 'done' } };
  const first = prepareOcrReview(prior, response);
  const reread = prepareOcrReview(first, response);
  assert.equal(resolveAiLine(reread.lines[0], 'skip'), null);
  const reviewed = { ...document(), lines: [{ ...line(), match: { source: 'manual' } }] };
  const changedId = prepareOcrReview(reviewed, { ...response, lines: [{ ...line(8), quantity_received: '99' }] });
  assert.equal(changedId.lines.length, 1); assert.equal(changedId.lines[0].quantity_received, '2');
});

test('r2: layout uses token spacing, 4/8/12 grids, right-aligned numeric fields and native monoline disclosures', async () => {
  const { readFile } = await import('node:fs/promises');
  const load = path => readFile(new URL(path, import.meta.url), 'utf8');
  const tokens = await load('../src/design/tokens.css');
  for (const count of [4, 8, 12]) assert.ok(tokens.includes(`--sg-grid-columns: ${count}`));
  for (const path of ['../src/design/styles.css', '../src/design/preview.css', '../src/pages/receiving/receiving.css']) {
    const css = await load(path);
    for (const [, value] of css.matchAll(/(?:padding(?:-[a-z]+)?|margin(?:-[a-z]+)?|(?:column-|row-)?gap):\s*([^;}]+)/g)) {
      assert.ok(!/\d+px/.test(value), `${path}: raw spacing ${value}`);
    }
  }
  const styles = await load('../src/design/styles.css');
  assert.match(styles, /\.sg-number-field input\s*\{[^}]*text-align: right/s);
  assert.match(styles, /summary::-webkit-details-marker\s*\{ display: none/);
  assert.match(styles, /summary::after\s*\{[^}]*border-right: 2px solid currentColor/s);
  assert.ok(styles.includes('min-height: var(--sg-touch)'));
});

test('r2: excessive discount points to the header field instead of enabling confirm', async () => {
  const doc = document(); doc.discount = '21';
  const h = await editor(doc); await h.radio('sign'); await h.click('ตรวจข้อมูลก่อน');
  assert.equal(h.focused.at(-1), 'header-discount');
  assert.equal(h.find(node => node.props.id === 'header-discount').props['aria-invalid'], true);
  assert.ok(message(h, 'ส่วนลดมากกว่ายอดรวมและภาษี'));
  assert.equal(h.calls.length, 0);
});

test('r2: receiving works when reading the browser storage property itself is denied', async () => {
  const h = await harness('Receiving', {}, {}, {}, {}, { window: {
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, scrollTo() {},
    get localStorage() { throw Error('blocked'); }
  } });
  await h.click('ตัวเลือก'); await h.radio('dark');
  assert.equal(h.document.documentElement.dataset.theme, 'dark');
});
