import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { harness } from './receiving-harness.mjs';
import { doc, row, open, text, track, cleanup } from './review-a-port-harness.mjs';

// Device test 072q fixes (Q1-Q4). Component-harness checks only: the rendered layout
// (>= 4 count rows on 360x800) is verified by the SSD browser capture noted in the report.
afterEach(cleanup);

const rules = async file => { const css = postcss.parse(await readFile(new URL(`../src/pages/receiving/${file}`, import.meta.url), 'utf8')); const found = {}; css.walkRules(rule => { found[rule.selector] ||= {}; rule.walkDecls(d => { found[rule.selector][d.prop] = d.value; }); }); return found; };
const lines = count => Array.from({ length: count }, (_, i) => row(i + 1, { counted_quantity: null, quantity_received: '', quantity_ordered: '789', quantity_billed: '876', unit_text: i % 2 ? 'กก.' : 'กิโลกรัม' }));
const blind = count => doc({ kind: 'manual_receipt', counted_complete_at: null, lines: lines(count) });
const rowsOf = h => h.visible().filter(n => n.type === 'article' && n.props.className === 'ra-count-row');
const partsOf = (h, article) => { const all = h.all(article); return { name: all.find(n => n.props.className === 'ra-count-name'), field: all.find(n => n.type === 'div' && /\bsg-number-field\b/.test(n.props.className || '')), zero: all.find(n => n.type === 'button' && n.props.className === 'rc-count-zero'), input: all.find(n => n.type === 'input') }; };

test('Q3 count rows are single compact rows: name, one count field and a 0 chip', async () => {
  const h = await open(blind(9));
  const articles = rowsOf(h); assert.equal(articles.length, 9);
  for (const [index, article] of articles.entries()) {
    const children = article.props.children.flat().filter(Boolean);
    assert.equal(children.length, 3, 'name, field, zero chip only');
    const { name, field, zero, input } = partsOf(h, article);
    assert.equal(h.text(name), `ผัก ${index + 1}`);
    assert.ok(field && input && zero);
    assert.equal(input.props.id, `count-${index + 1}`);
    assert.equal(h.text(h.all(field).find(n => n.type === 'label')), `นับได้ ผัก ${index + 1}`, 'accessible label kept');
    assert.equal(zero.props['aria-label'], `ไม่ได้ส่ง ผัก ${index + 1}`);
    assert.equal(h.text(zero), 'ไม่มา');
    assert.equal(h.all(article).some(n => n.type === 'p'), false, 'no per-row helper paragraph while blank');
  }
});

test('Q3 the blank-vs-zero hint appears once above the list, never per row, and no ordered/bill quantity leaks', async () => {
  const h = await open(blind(9));
  const legends = h.visible().filter(n => n.props.id === 'count-legend'); assert.equal(legends.length, 1);
  assert.match(h.text(legends[0]), /ว่าง = ยังไม่นับ/); assert.match(h.text(legends[0]), /ไม่มา = ไม่ได้ส่ง/);
  assert.match(legends[0].props.className, /\brc-sr-only\b/, 'owner 2026-10-24: the legend is read aloud but not shown');
  assert.equal((text(h).match(/ว่าง = ยังไม่นับ/g) || []).length, 1);
  assert.equal(text(h).indexOf('count-legend'), -1);
  const nodes = h.visible(); assert.ok(nodes.indexOf(legends[0]) < nodes.indexOf(rowsOf(h)[0]), 'legend precedes the first row');
  assert.doesNotMatch(text(h), /789|876/);
});

test('Q3 zero chip sets an explicit 0, is keyboard reachable, and blank stays blank until counted', async () => {
  const h = await open(blind(3));
  const input = id => h.find(n => n.type === 'input' && n.props.id === `count-${id}`);
  const primary = () => h.find(n => n.type === 'button' && n.props.className?.includes('sg-primary'));
  assert.equal(input(1).props.value, ''); assert.equal(primary().props.disabled, true); assert.match(text(h), /เหลือ 3 รายการที่ต้องนับ/);
  const chip = id => h.find(n => n.props['aria-label'] === `ไม่ได้ส่ง ผัก ${id}`);
  assert.equal(chip(2).props['data-active'], undefined);
  await h.click('ไม่ได้ส่ง ผัก 2');
  assert.equal(input(2).props.value, '0'); assert.equal(input(1).props.value, '', 'other rows stay blank, never defaulted to 0');
  assert.equal(chip(2).props['data-active'], 'true'); assert.match(text(h), /เหลือ 2 รายการที่ต้องนับ/);
  await h.click('ไม่ได้ส่ง ผัก 2'); assert.equal(input(2).props.value, '0', 'pressing again is idempotent');
  assert.match(text(h), /ไม่มีของจริง/);
  input(2).props.onChange({ target: { value: '3.5' } }); await h.settle();
  assert.equal(input(2).props.value, '3.5'); assert.equal(chip(2).props['data-active'], undefined);
  assert.equal(chip(2).props.type, 'button');
  for (const id of [1, 2, 3]) assert.equal(input(id).props.inputMode, 'decimal', 'numeric keyboard kept');
  assert.equal(h.calls.length, 0);
});

test('Q3 invalid entry and the high-count warning marks still target the row field', async () => {
  const h = await open(blind(2), { count: async (id, body) => body.check_only ? { count_warnings: [{ product_id: 1, quantity: '99999', unit: 'กิโลกรัม' }] } : doc() });
  h.find(n => n.props.id === 'count-1').props.onChange({ target: { value: '99999' } }); await h.settle();
  h.find(n => n.props.id === 'count-2').props.onChange({ target: { value: '999999999999' } }); await h.settle();
  assert.equal(h.find(n => n.type === 'input' && n.props.id === 'count-2').props['aria-invalid'], true);
  h.find(n => n.props.id === 'count-2').props.onChange({ target: { value: '2' } }); await h.settle();
  await h.click('ยืนยันการนับ'); await h.click('แก้ไข');
  assert.deepEqual(h.focused, ['count-1']);
  const flagged = partsOf(h, rowsOf(h)[0]).field; assert.match(flagged.props.className, /ra-count-flagged/);
  assert.match(h.text(flagged), /ตรวจจำนวนอีกครั้ง/);
});

test('Q3 CSS contract: three columns, 44px zero chip, 48px+ input, no full-width input or stacked layout', async () => {
  const receiving = await rules('receiving.css');
  const rowRule = receiving[".solao .ra-document[data-step='count'] .ra-count-row"];
  // Review 2026-10-24: the count box keeps a 112px floor at 34% so a long product name stays on one line.
  assert.match(rowRule['grid-template-columns'], /minmax\(0, 1fr\) minmax\(112px, 3\d%\) 64px/);
  assert.equal(rowRule['align-items'], 'center');
  const input = receiving[".solao .ra-document[data-step='count'] .ra-count-row input"];
  assert.equal(input['min-height'], 'var(--sg-touch)');
  const zero = receiving[".solao .ra-document[data-step='count'] .rc-count-zero"];
  assert.equal(zero.width, '64px'); assert.equal(zero['min-width'], '64px'); // fits the word ไม่มา (device test 072s) assert.equal(zero['min-height'], '44px');
  const name = receiving[".solao .ra-document[data-step='count'] .ra-count-row > .ra-count-name"];
  assert.equal(name['font-size'], 'var(--sg-type-body)'); assert.equal(name['overflow-wrap'], 'anywhere');
  assert.ok(receiving[".solao .ra-document[data-step='count'] .ra-count-legend"]);
  const base = await rules('review-a.css');
  assert.match(base['.solao .ra-count-row input']['height'], /48px/, 'existing 48px input assertion remains true');
});

test('Q2 note stays collapsed behind a + button and saves through the same line patch when opened', async () => {
  const patches = [];
  const h = await harness('LineNote', { line: row(1, { note: '' }), disabled: false, onChange: patch => patches.push(patch) });
  assert.equal(h.visible().some(n => n.type === 'textarea'), false);
  const button = h.find(n => n.type === 'button'); assert.equal(h.text(button), '+ หมายเหตุ'); assert.equal(button.props['aria-label'], 'เพิ่มหมายเหตุ ผัก 1'); assert.equal(button.props.type, 'button');
  assert.equal(h.visible().some(n => n.type === 'select'), false, 'on-order line has no reason select');
  await h.click('เพิ่มหมายเหตุ ผัก 1');
  const area = h.find(n => n.type === 'textarea'); assert.equal(area.props.maxLength, 300); assert.equal(area.props.autoFocus, true);
  assert.equal(h.visible().some(n => n.type === 'button'), false, 'button is replaced by the field');
  area.props.onChange({ target: { value: 'ใบเสียหาย' } }); await h.settle();
  assert.equal(JSON.stringify(patches), JSON.stringify([{ note: 'ใบเสียหาย' }]));
  h.find(n => n.type === 'textarea').props.onChange({ target: { value: '' } }); await h.settle();
  assert.ok(h.find(n => n.type === 'textarea'), 'clearing the text does not collapse the field under the typist');
});

test('Q2 an existing note, or a required reason, is visible without extra taps', async () => {
  const withNote = await harness('LineNote', { line: row(1, { note: 'ของช้ำ' }), onChange() {} });
  assert.equal(withNote.find(n => n.type === 'textarea').props.value, 'ของช้ำ'); assert.equal(withNote.visible().some(n => n.type === 'button'), false);
  assert.equal(withNote.find(n => n.type === 'textarea').props.autoFocus, false, 'no focus steal on first render');
  const off = await harness('LineNote', { line: row(2, { order_item_id: null, note: '' }), onChange() {} });
  assert.ok(off.find(n => n.type === 'select'), 'off-order reason select always visible');
  assert.equal(off.visible().some(n => n.type === 'textarea'), false); assert.ok(off.find(n => n.type === 'button' && off.text(n) === '+ หมายเหตุ'));
  const reason = await harness('LineNote', { line: row(3, { order_item_id: null, note: 'โทรสั่ง' }), onChange() {} });
  assert.equal(reason.find(n => n.type === 'select').props.value, 'โทรสั่ง'); assert.equal(reason.visible().some(n => n.type === 'textarea'), false, 'a bare reason needs no open textarea');
  const other = await harness('LineNote', { line: row(4, { order_item_id: null, note: 'อื่นๆ' }), onChange() {} });
  assert.ok(other.find(n => n.type === 'textarea'), 'อื่นๆ asks for detail, so the field opens');
  const custom = await harness('LineNote', { line: row(5, { order_item_id: null, note: 'ส่งผิดสาขา' }), onChange() {} });
  assert.equal(custom.find(n => n.type === 'textarea').props.value, 'ส่งผิดสาขา');
  const locked = await harness('LineNote', { line: row(6, { note: '' }), disabled: true, onChange() {} });
  assert.equal(locked.find(n => n.type === 'button').props.disabled, true);
});

test('Q2 summary and review cards no longer render an open textarea per line', async () => {
  const manual = track(await harness('ManualReceiptSummary', { doc: doc({ kind: 'manual_receipt', lines: [row(1), row(2), row(3, { note: 'มีหมายเหตุ' })] }), onChange() {} }));
  assert.equal(manual.visible().filter(n => n.type === 'textarea').length, 1, 'only the line that already has a note shows the field');
  assert.equal(manual.visible().filter(n => n.type === 'button' && manual.text(n) === '+ หมายเหตุ').length, 2);
  const h = await open(doc({ lines: [row(1), row(2)] }));
  assert.equal(h.visible().filter(n => n.type === 'textarea').length, 0);
});

// Owner 2026-10-24 "ตัวหนังสือต้องน้อยๆ": the unknown ledger (three "ยังไม่ทราบ" rows) is gone; one line says what is pending.
test('Q1 no-bill summary is one line with no unknown ledger; bill receipts keep the ledger', async () => {
  const manual = track(await harness('ManualReceiptSummary', { doc: doc({ kind: 'manual_receipt', lines: [row(1, { review_decision: 'missing_bill' })] }) }));
  const section = manual.visible()[0];
  assert.equal((manual.text(section).match(/ยังไม่มีราคา · รอบัญชีขอบิล/g) || []).length, 1);
  assert.doesNotMatch(manual.text(section), /บัญชีต้องขอบิลและตรวจราคาต่อ|ไม่มีบิล · บัญชีขอบิลและตรวจราคา|ยังไม่รับรองมูลค่ารับ|ต้องขอบิล 1 ใบ/, 'old no-bill lines removed');
  assert.equal(manual.all(section).some(n => n.type === 'dl' || n.props?.className === 'ra-nobill-details'), false, 'no unknown-value ledger at all');
  assert.doesNotMatch(manual.text(section), /ยังไม่ทราบ|ยังคำนวณไม่ได้|0[.]00 บาท/);
  assert.match(manual.text(section), /รับ 1 จาก 1 รายการ/);
  const bill = track(await harness('ReviewSummary', { doc: doc({ lines: [row(1, { review_decision: 'accept' })] }) }));
  const billSection = bill.visible()[0];
  const receipt = billSection.props.children.flat().filter(Boolean).find(n => n.props?.className === 'ra-receipt-card');
  assert.ok(receipt && bill.all(receipt).some(n => n.type === 'dl' && n.props.className === 'ra-ledger'), 'bill ledger stays in the receipt card, not folded away');
  assert.equal(bill.all(billSection).some(n => n.props.className === 'ra-nobill-details'), false);
});

const shop = id => ({ supplier_key: `pg:${id}`, supplier_name: `ร้านตัวอย่าง ${id}`, items: [{ order_item_id: id, product_id: id, product_name: 'สินค้า', has_pending: true, unit_name: 'กก.' }] });
const primary = h => h.find(n => n.type === 'button' && n.props.className?.includes('sg-primary'));

test('Q4 a queue card only selects; one bottom action starts receiving', async () => {
  const sent = [];
  const created = body => ({ id: 31, client_uuid: body.client_uuid, status: 'draft', kind: 'bill', supplier_name_text: body.supplier_name_text, counted_complete_at: null, blind: true,
    lines: [{ id: 1, product_id: 1, product_name: 'สินค้า', unit_text: 'กก.' }], images: [], warnings: [], ocr: { status: 'locked' } });
  const h = track(await harness('Receiving', {}, { expected: async () => [shop(1), shop(2), shop(3)], create: async body => { sent.push(body); return created(body); } }));
  // Owner 2026-10-22 redesign: each card has its own scan button; the footer still names the selected shop.
  const startButtons = () => h.visible().filter(n => n.type === 'button' && /สแกนบิล/.test(h.text(n)) && n.props.className !== 'rc-queue-scan');
  assert.deepEqual(startButtons().map(n => h.text(n)), [], 'the footer receives from other shops only');
  assert.equal(h.visible().filter(n => n.props.className === 'rc-queue-scan').length, 3, 'one scan button per shop card');
  for (const id of [2, 3, 2]) {
    await h.click(`เลือกร้าน ร้านตัวอย่าง ${id}`);
    assert.equal(h.visible().some(n => n.type === 'form' && n.props.id === 'rc-create'), false, 'selecting never opens the create form');
    assert.equal(h.text(primary(h)), 'รับของจากร้านอื่น'); assert.ok(h.find(n => n.props.className === 'rc-queue-scan' && n.props['aria-label'] === `สแกนบิล ร้านตัวอย่าง ${id}`));
    assert.equal(startButtons().length, 0);
    assert.equal(h.visible().filter(n => n.props['aria-pressed'] === true).length, 1, 'one selected card');
    assert.equal(h.find(n => n.props['aria-label'] === `เลือกร้าน ร้านตัวอย่าง ${id}`).props['aria-pressed'], true);
  }
  assert.equal(h.visible().filter(n => n.props.className === 'rc-queue-picked').length, 1, 'selected cue shown once');
  assert.equal(h.calls.length, 0);
  // Scan-first: the bottom action creates the receipt for the selected shop at once (no setup form).
  await h.click('สแกนบิล ร้านตัวอย่าง 2');
  assert.equal(h.visible().some(n => n.type === 'form' && n.props.id === 'rc-create'), false, 'no setup form');
  assert.equal(sent.length, 1, 'the bottom action creates for the selected shop'); assert.equal(sent[0].supplier_name_text, 'ร้านตัวอย่าง 2');
});

test('Q4 follow-up stays a separate secondary action and optional shops stay selectable', async () => {
  const optional = { ...shop(2), receiving_optional: true };
  const h = track(await harness('Receiving', {}, { expected: async () => [shop(1), optional] }));
  assert.ok(h.find(n => n.props['aria-label'] === 'ตามของ ร้านตัวอย่าง 1'));
  assert.equal(h.visible().some(n => n.props['aria-label'] === 'ตามของ ร้านตัวอย่าง 2'), false);
  await h.click('เลือกร้าน ร้านตัวอย่าง 2'); assert.equal(h.text(primary(h)), 'รับของจากร้านอื่น'); assert.ok(h.find(n => n.props.className === 'rc-queue-scan' && n.props['aria-label'] === 'สแกนบิล ร้านตัวอย่าง 2'));
  const css = await rules('receiving.css');
  assert.equal(css['.solao .rc-queue-actions > .rc-queue-receive'], undefined);
  assert.equal(css[".solao[data-queue-layout='compact'] .rc-queue-actions > .rc-queue-receive"], undefined);
  assert.equal(css['.solao .rc-queue-actions > button']['min-height'], '48px');
});
