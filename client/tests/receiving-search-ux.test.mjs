import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { harness } from './receiving-harness.mjs';
import { doc as billDoc, row, open as openBill, clock, btn, cleanup, historyBrowser } from './review-a-port-harness.mjs';
afterEach(cleanup);

// Owner device screenshot 2026-10-20: walk-in receipt, count step, "บด" typed with the keyboard open.
// Search must become a focused full-height sheet with a full-width list and no sticky bar.
const user = { id: 12, name: 'ผู้รับ', role: 'user', branch_id: 1, department_id: 10 };
const countDoc = patch => ({ id: 5, client_uuid: 'search-ux', supplier_master_id: 1, supplier_name_text: 'ร้านหมู', branch_id: 1, department_id: 10,
  delivery_date: '2026-10-20', status: 'draft', kind: 'manual_receipt', scope: 'department', counted_complete_at: null,
  lines: [], images: [], warnings: [], ocr: { status: 'locked' }, ...patch });
const history = [{ id: 7, name: 'ขาหมูบด 2 รอบ', unit_id: 2, unit_name: 'กิโลกรัม' }, { id: 9, name: 'หมูบดล้วน', unit_id: 2, unit_name: 'กก.' }];
const catalog = [{ id: 31, name: 'ปลาบดสำหรับทำลูกชิ้นเนื้อล้วนไม่ใส่แป้งพิเศษ', unit_name: 'กิโลกรัม' }, { id: 9, name: 'หมูบดล้วน', unit_name: 'กก.' }, { id: 7, name: 'ขาหมูบด 2 รอบ', unit_name: 'กิโลกรัม' }];
const api = { supplierProducts: async () => history, getProducts: async params => ({ data: params.search === 'บด' ? catalog : [] }) };
const wait = (ms = 380) => new Promise(resolve => setTimeout(resolve, ms));
const mount = async (patch, overrides = {}, browser = {}) => { const h = await harness('DocumentEditor', { initialDocument: countDoc(patch), user, onBack() {} }, { ...api, ...overrides }, {}, browser); mounted.push(h); return h; };
const mounted = [];
afterEach(() => { mounted.splice(0).forEach(h => h.unmount()); });
const footer = h => h.all().find(n => n.type === 'footer' && n.props.className === 'ra-footer');
const sheet = h => h.all().find(n => n.type === 'dialog');
const search = async (h, query) => { await h.select('ค้นหาสินค้า', query); await wait(); await h.settle(); };

test('S1 opening the search hides the sticky bar and shows a sheet with one helper line; closing restores both', async () => {
  const h = await mount();
  assert.equal(footer(h).props.hidden, false); assert.equal(sheet(h), undefined);
  await h.click('เพิ่มสินค้าที่มาส่ง');
  assert.equal(footer(h).props.hidden, true, 'bar hidden while searching');
  const dialog = sheet(h); assert.ok(dialog); assert.match(dialog.props.className, /ra-search-sheet/); assert.match(dialog.props.className, /rc-back-dismiss/);
  const helpers = h.all(dialog).filter(n => /\bra-search-helper\b/.test(n.props.className || ''));
  assert.equal(helpers.length, 1); assert.equal(h.text(helpers[0]), 'แตะสินค้าที่มาส่ง หรือพิมพ์ค้นหา');
  assert.doesNotMatch(h.text(h.all()), /แตะเพิ่มแล้วนับเอง|ยังไม่มีสินค้า · กด|ยังไม่มีประวัติสินค้า/);
  await h.click('ปิด');
  assert.equal(sheet(h), undefined); assert.equal(footer(h).props.hidden, false, 'bar restored');
});

test('S2 search input takes focus on open so the keyboard rises over the pinned field', async () => {
  const h = await mount();
  await h.click('เพิ่มสินค้าที่มาส่ง'); await wait(20); await h.settle();
  assert.ok(h.focused.includes('blind-add-product'));
  const input = h.find(n => n.props.id === 'blind-add-product'); assert.equal(input.props.type, 'search');
  assert.equal(h.text(h.find(n => n.type === 'label' && h.text(n).startsWith('ค้นหาสินค้า'))), 'ค้นหาสินค้า');
});

test('S3 results are a full-width vertical list: name, unit, history badge; history products first', async () => {
  const h = await mount();
  await h.click('เพิ่มสินค้าที่มาส่ง'); await search(h, 'บด');
  const list = h.find(n => n.type === 'ul' && n.props['aria-label'] === 'ผลค้นหาสินค้า');
  const items = list.props.children.filter(Boolean); assert.equal(items.length, 3);
  const rows = h.all(list).filter(n => n.type === 'button');
  assert.equal(rows.length, 3); for (const rowNode of rows) assert.match(rowNode.props.className, /rc-option-card.*ra-search-row/);
  assert.deepEqual(rows.map(n => n.props['aria-label']), ['หมูบดล้วน', 'ขาหมูบด 2 รอบ', 'ปลาบดสำหรับทำลูกชิ้นเนื้อล้วนไม่ใส่แป้งพิเศษ']);
  assert.match(h.text(rows[0]), /หมูบดล้วนกก\.ของร้านนี้/); assert.match(h.text(rows[1]), /ขาหมูบด 2 รอบกิโลกรัมของร้านนี้/);
  assert.equal(h.text(rows[2]), 'ปลาบดสำหรับทำลูกชิ้นเนื้อล้วนไม่ใส่แป้งพิเศษกิโลกรัม'); assert.doesNotMatch(h.text(rows[2]), /ของร้านนี้/);
  // The old cramped chips and the unfocused row picker are not used by this panel.
  assert.equal(h.all(list).some(n => /rc-check|rc-text-action/.test(n.props.className || '')), false);
  assert.equal(footer(h).props.hidden, true);
});

test('S4 not-found state offers adding a new product from the shop page', async () => {
  const h = await mount();
  await h.click('เพิ่มสินค้าที่มาส่ง'); await search(h, 'zzz');
  assert.match(h.text(sheet(h)), /ไม่พบ “zzz” · เพิ่มเป็นสินค้าใหม่ได้ที่หน้าร้านค้า/);
  assert.equal(h.all(sheet(h)).some(n => n.type === 'li'), false);
});

test('S5 choosing results ticks them and keeps the sheet open; เสร็จ adds blank rows, restores the bar and focuses the first new count', async () => {
  const h = await mount();
  await h.click('เพิ่มสินค้าที่มาส่ง'); await search(h, 'บด'); await h.click('ปลาบดสำหรับทำลูกชิ้นเนื้อล้วนไม่ใส่แป้งพิเศษ');
  // Owner 2026-10-24 (ข้อ 1): several items in one sheet; the query clears and the search box keeps focus.
  assert.ok(sheet(h)); assert.equal(h.focused.at(-1), 'blind-add-product'); assert.match(h.text(sheet(h)), /เสร็จ · เพิ่ม 1 รายการ/);
  await h.click('เสร็จ · เพิ่ม 1 รายการ');
  assert.equal(sheet(h), undefined); assert.equal(footer(h).props.hidden, false);
  const count = h.find(n => n.props.id === 'count--1'); assert.equal(count.props.value, '');
  assert.equal(h.focused.at(-1), 'count--1');
  assert.equal(h.calls.some(c => ['count', 'ocr', 'update'].includes(c[0])), false, 'no save from adding');
  assert.equal(h.find(n => n.type === 'button' && /^ยืนยันการนับ/.test(h.text(n))).props.disabled, true);
});

test('S6 history list adds with one tap and an already-listed product goes to its count input without duplicating', async () => {
  const h = await mount({ lines: [{ id: 1, product_id: 9, product_name: 'หมูบดล้วน', unit_text: 'กก.', unit_id: 2, bill_text: '', line_no: 1 }] });
  await h.select('นับได้ หมูบดล้วน', '1.5');
  await h.click('เพิ่มสินค้าที่มาส่ง');
  await h.click('ขาหมูบด 2 รอบกิโลกรัม'); assert.ok(sheet(h), 'the sheet stays open for the next item');
  // Tapping a ticked item takes it back out; tapping again adds it once.
  await h.click('ขาหมูบด 2 รอบกิโลกรัม✓ เพิ่มแล้ว'); assert.equal(h.all().filter(n => n.type === 'article' && n.props.className === 'ra-count-row').length, 1);
  await h.click('ขาหมูบด 2 รอบกิโลกรัม'); await h.click('เสร็จ · เพิ่ม 1 รายการ'); assert.equal(sheet(h), undefined); assert.equal(h.focused.at(-1), 'count--2');
  await h.click('เพิ่มสินค้าที่มาส่ง'); await search(h, 'บด'); await h.click('หมูบดล้วน · มีในใบแล้ว · ไปช่องนับเดิม');
  assert.equal(h.focused.at(-1), 'count-1'); assert.equal(h.all().filter(n => n.type === 'article' && n.props.className === 'ra-count-row').length, 2);
  assert.equal(h.find(n => n.props.id === 'count-1').props.value, '1.5', 'typed count survives the search');
});

test('S7 Android Back closes the search first and keeps typed counts', async () => {
  const browser = historyBrowser();
  const h = await mount({ lines: [{ id: 1, product_id: 9, product_name: 'หมูบดล้วน', unit_text: 'กก.', unit_id: 2, bill_text: '', line_no: 1 }] }, {}, browser);
  await h.select('นับได้ หมูบดล้วน', '2');
  await h.click('เพิ่มสินค้าที่มาส่ง'); await h.settle(); assert.ok(sheet(h)); assert.equal(browser.size, 1);
  browser.history.back(); await h.settle();
  assert.equal(sheet(h), undefined); assert.equal(footer(h).props.hidden, false);
  assert.equal(h.find(n => n.props.id === 'count-1').props.value, '2');
});

test('S8 history failure shows one status line with retry; typing still searches', async () => {
  let fail = true;
  const h = await mount({}, { supplierProducts: async () => { if (fail) throw Error('offline'); return history; } });
  await h.click('เพิ่มสินค้าที่มาส่ง');
  assert.match(h.text(sheet(h)), /โหลดสินค้าที่เคยส่งไม่ได้ ยังค้นหาเองได้/); assert.doesNotMatch(h.text(sheet(h)), /ค้นหาสินค้าที่มาส่ง/, 'no helper line under the field (owner 2026-10-24)');
  fail = false; await h.click('โหลดสินค้าที่เคยส่งอีกครั้ง'); await h.settle();
  assert.match(h.text(sheet(h)), /แตะสินค้าที่มาส่ง หรือพิมพ์ค้นหา/); assert.doesNotMatch(h.text(sheet(h)), /โหลดสินค้าที่เคยส่งไม่ได้/);
});

test('S9 bill document: the count step and the post-bill add step both use the sheet and restore the bar', async () => {
  const bill = await harness('DocumentEditor', { initialDocument: countDoc({ kind: 'bill', counted_complete_at: null, images: [{ id: 1, page_no: 1 }] }), user, onBack() {}, scanFirst: true }, api);
  mounted.push(bill);
  await bill.click('เพิ่มสินค้าที่มาส่ง'); assert.ok(sheet(bill)); assert.equal(footer(bill).props.hidden, true);
  await search(bill, 'บด'); await bill.click('หมูบดล้วน'); await bill.click('เสร็จ · เพิ่ม 1 รายการ'); assert.equal(sheet(bill), undefined); assert.equal(footer(bill).props.hidden, false);
  assert.equal(bill.focused.at(-1), 'count--1');
  const timers = clock();
  const compare = await openBill(billDoc({ lines: [row()] }), { getProducts: async () => ({ data: [{ id: 99, name: 'เพิ่มใหม่', unit_name: 'กก.' }] }) }, {}, timers.runtime);
  await compare.click('เพิ่มของที่ไม่มีในบิล'); assert.equal(footer(compare).props.hidden, true); assert.ok(sheet(compare));
  await compare.select('ค้นหาสินค้า', 'เพิ่ม'); await timers.tick(350); await compare.settle();
  assert.equal(compare.all(sheet(compare)).filter(n => n.type === 'li').length, 1);
  await compare.click('เพิ่มใหม่'); assert.equal(sheet(compare), undefined); assert.equal(footer(compare).props.hidden, false);
  assert.match(compare.text(compare.all()), /รายการเพิ่มหลังเปิดบิล/);
});

test('S10 branch-scope document offers no add-product search and keeps its bar', async () => {
  const branch = await mount({ scope: 'branch', lines: [{ id: 1, product_id: 9, product_name: 'หมูบดล้วน', unit_text: 'กก.', unit_id: 2, bill_text: '', line_no: 1, department_allocations: [] }] });
  assert.equal(branch.all().some(n => n.type === 'button' && branch.text(n) === 'เพิ่มสินค้าที่มาส่ง'), false);
  assert.equal(sheet(branch), undefined); assert.equal(footer(branch).props.hidden, false);
  const afterBill = await openBill(billDoc({ scope: 'branch', lines: [row()] }));
  assert.equal(afterBill.all().some(n => n.type === 'button' && afterBill.text(n) === 'เพิ่มของที่ไม่มีในบิล'), false);
  assert.equal(footer(afterBill).props.hidden, false);
});

test('S11 styles: full-height sheet above the keyboard, pinned input, 56px full-width rows, 2-line names, token spacing', async () => {
  const css = await readFile(new URL('../src/pages/receiving/review-a.css', import.meta.url), 'utf8');
  const block = css.slice(css.indexOf('/* Focused add-product search'));
  assert.match(block, /\.ra-footer\[hidden\] \{ display: none; \}/);
  const sheetRule = block.match(/\.sg-sheet\.ra-search-sheet \{[^}]*\}/)[0];
  for (const part of ['top: var(--ra-visible-top, 0px)', 'height: var(--ra-visible-height, 100dvh)', 'max-height: var(--ra-visible-height, 100dvh)', 'width: 100%', 'max-width: none']) assert.ok(sheetRule.includes(part), part);
  assert.match(block, /\.ra-search-pinned \{ flex: none;/); assert.match(block, /\.ra-search-scroll \{[^}]*flex: 1 1 auto;[^}]*overflow-y: auto/);
  assert.match(block, /\.ra-search-sheet \.rc-option-card \{ min-height: var\(--sg-space-14\);/); assert.match(block, /-webkit-line-clamp: 2/);
  assert.match(block, /\.ra-search-pinned input \{ min-height: var\(--sg-touch\)/);
  assert.doesNotMatch(block, /#[0-9a-f]{3,6}\b/i);
  const editor = await readFile(new URL('../src/pages/receiving/DocumentEditor.jsx', import.meta.url), 'utf8');
  assert.match(editor, /--ra-visible-height/); assert.match(editor, /--ra-visible-top/);
});

// Device 2026-10-21 (SM-A075F): after picking a product the numeric keyboard rose but the count bar hid the new row,
// because closing the sheet pops its history entry and the restored scroll (top) undid the fit.
test('S12 count fit re-runs after the sheet pops its history entry; helper clears the input focus ring', async () => {
  const editor = await readFile(new URL('../src/pages/receiving/DocumentEditor.jsx', import.meta.url), 'utf8');
  const effect = editor.slice(editor.indexOf("// Count-only layout"), editor.indexOf('const readingActive'));
  assert.match(effect, /window\.addEventListener\('popstate', schedule\)/);
  assert.match(effect, /window\.removeEventListener\('popstate', schedule\)/);
  const css = await readFile(new URL('../src/pages/receiving/review-a.css', import.meta.url), 'utf8');
  assert.match(css, /\.ra-search-pinned \{ flex: none; display: grid; gap: var\(--sg-space-2\); \}/);
  assert.match(css, /\.ra-search-helper \{ margin: var\(--sg-space-1\) 0 0;/);
});
