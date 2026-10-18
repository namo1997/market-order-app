import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { harness } from './receiving-harness.mjs';
import { needsBillCheck } from '../src/pages/receiving/receiving-illustration-state.js';

const readme = await readFile(new URL('../src/assets/illustrations/README.md', import.meta.url), 'utf8');
const altTexts = Object.fromEntries([...readme.matchAll(/\| `([^`]+)\.webp` \| [^|]+ \| ([^|]+) \|/g)].map(([, state, alt]) => [state, alt.trim()]));
const user = { id: 1, name: 'ผู้รับ', role: 'admin' };
const line = { id: 3, product_id: 7, product_name: 'ผัก', quantity_received: '2', quantity_billed: '2', unit_price: '10', amount: '20', unit_text: 'กก.', match: { source: 'manual' } };
const doc = (values = {}) => ({ id: 5, status: 'draft', kind: 'bill', delivery_date: '2026-10-15', images: [], lines: [line], total: '20', discount: '0', vat: '0', ocr: { status: 'none', warnings: [] }, warnings: [], ...values });
const editor = (document = doc(), overrides = {}, props = {}, runtime = {}) => harness('DocumentEditor', { initialDocument: document, user, onBack() {}, onChanged() {}, ...props }, { image: async () => new Blob(['mock']), ...overrides }, {}, {}, runtime);
const images = h => h.visible().filter(node => node.type === 'img');
const has = (h, state) => images(h).some(node => node.props.src.endsWith(`/${state}.webp`));
const assertImage = (h, state, loading = 'lazy') => {
  const img = images(h).find(node => node.props.src.endsWith(`/${state}.webp`));
  assert.ok(img, `${state} shown in active UI`);
  assert.equal(img.props.alt, altTexts[state], `${state}: README Thai alt`);
  assert.equal(img.props.loading, loading);
  assert.equal(img.props.width, '480'); assert.equal(img.props.height, '480');
  h.budget();
};
const openAction = async (h, action) => { await h.click('เพิ่มเติม'); await h.select('ทำรายการ', action); await h.click('เลือก'); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('illustrations: first load welcomes; successful empty results alone show empty-today with README alts', async () => {
  const pending = deferred();
  const h = await harness('Receiving', {}, { expected: () => pending.promise, list: async () => [] });
  assertImage(h, 'welcome', 'eager'); assert.ok(!has(h, 'empty-today'));
  assert.ok(h.visible().some(node => node.props['aria-busy'] === true));
  pending.resolve([]); await h.settle();
  assertImage(h, 'empty-today', 'eager'); assert.ok(!has(h, 'welcome'));
  await h.click('ดูเอกสาร'); h.budget();
  await h.click('ตัวเลือก'); await h.click('รับสินค้าเพิ่ม (ไม่อ้างอิงใบสั่ง)'); h.budget();
});

test('illustrations: initial admin scope selection welcomes without claiming an active load', async () => {
  const h = await harness('Receiving', {}, {}, { isAdmin: true, user: { id: 1, role: 'admin' } });
  assertImage(h, 'welcome', 'eager');
  assert.ok(!h.visible().some(node => node.props['aria-busy'] === true));
  await h.click('ตัวเลือก'); h.budget();
});

test('illustrations: error replaces empty state; retry reloads the actual request', async () => {
  let fails = true;
  const h = await harness('Receiving', {}, { expected: async () => { if (fails) throw { response: { status: 503 } }; return []; } });
  assertImage(h, 'error', 'eager'); assert.ok(!has(h, 'empty-today')); assert.ok(!has(h, 'welcome'));
  fails = false; await h.click('ลองใหม่'); assertImage(h, 'empty-today', 'eager'); assert.ok(!has(h, 'error'));
});

test('illustrations: opening failure retries that document rather than reloading the list', async () => {
  let calls = 0;
  const h = await harness('Receiving', {}, { list: async () => [doc()], get: async () => { if (++calls === 1) throw { response: { status: 503 } }; return doc(); } });
  await h.radio('documents');
  await h.click('เปิดเอกสาร #5 ไม่ระบุผู้ส่ง ร่าง'); assertImage(h, 'error', 'eager');
  await h.click('ลองใหม่'); assert.equal(calls, 2); assertImage(h, 'capture-bill', 'eager');
});

test('illustrations: offline is explicit, never claims durable storage, and recovers on online event', async () => {
  const events = {};
  const navigator = { onLine: false };
  const h = await harness('Receiving', {}, { expected: async () => [] }, {}, { addEventListener: (name, callback) => { events[name] = callback; } }, { navigator });
  assertImage(h, 'offline', 'eager'); assert.ok(!has(h, 'empty-today'));
  assert.ok(!h.text(h.visible()).includes('ร่างนี้อยู่ในเครื่องแล้ว'));
  navigator.onLine = true; events.online(); await h.settle(); assertImage(h, 'empty-today', 'eager');
  const edit = await editor(doc(), {}, { online: false }); assertImage(edit, 'offline'); assert.ok(!has(edit, 'capture-bill'));
  const create = await harness('CreateDocument', { user, date: '2026-10-15', onClose() {}, onCreated() {}, online: false }); assertImage(create, 'offline');
});

test('illustrations: past-date emptiness and status-filter emptiness do not claim today has no receipts', async () => {
  const h = await harness('Receiving', {}, { expected: async () => [] });
  await h.click('ตัวเลือก'); await h.select('วันที่', '2020-01-01'); await h.click('ใช้ข้อมูล');
  assertImage(h, 'empty-today', 'eager'); assert.ok(h.text(h.visible()).includes('ยังไม่มีของเข้าในวันที่เลือก'));
  const filtered = await harness('Receiving', {}, { list: async () => [doc()] });
  await filtered.radio('documents'); await filtered.radio('confirmed');
  assert.ok(!has(filtered, 'empty-today')); assert.ok(filtered.text(filtered.visible()).includes('ไม่มีเอกสารในสถานะนี้'));
});

test('illustrations: capture, review and sign have correct alts and keep one existing primary action', async () => {
  const h = await editor(); assertImage(h, 'capture-bill', 'eager');
  await h.radio('lines'); assert.equal(h.visible().some(node => node.props['data-illustration'] === 'review-lines'), false); assert.ok(h.visible().some(node => node.props['aria-label'] === 'กรองรายการ')); assert.ok(!has(h, 'capture-bill'));
  await h.radio('sign'); assert.ok(h.visible().some(node => node.type === 'canvas')); assert.ok(!has(h, 'review-lines'));
  h.find(node => node.type === 'canvas').props.onPointerDown({ button: 0, pointerType: 'mouse', pointerId: 1, clientX: 20, clientY: 20, preventDefault() {} }); await h.settle();
  assert.ok(!has(h, 'sign')); h.budget();
});

test('illustrations: reading-bill is tied to the actual OCR promise and never pretends success', async () => {
  const pending = deferred();
  const h = await editor(doc({ images: [{ id: 1, page_no: 1 }] }), { ocr: () => pending.promise });
  assert.ok(!has(h, 'reading-bill'));
  const work = h.find(node => node.type === 'button' && h.text(node) === 'อ่านบิล').props.onClick(); await h.settle();
  assertImage(h, 'reading-bill'); assert.ok(!has(h, 'received-success'));
  assert.ok(h.visible().some(node => node.props.role === 'status' && node.props['aria-busy'] === true));
  pending.resolve(doc({ ocr: { status: 'done' } })); await work; await h.settle();
  assert.ok(!has(h, 'reading-bill')); assert.equal(h.visible().some(node => node.props['data-illustration'] === 'review-lines'), false); assert.ok(h.visible().some(node => node.props['aria-label'] === 'กรองรายการ'));
});

test('illustrations: not-a-bill requires explicit warning and no usable rows; draft and failed OCR remain distinct', async () => {
  assert.equal(needsBillCheck(doc({ lines: [] })), false);
  assert.equal(needsBillCheck(doc({ lines: [], ocr: { status: 'failed' } })), false);
  assert.equal(needsBillCheck(doc({ ocr: { status: 'done', warnings: ['NOT_A_BILL'] } })), false);
  assert.equal(needsBillCheck(doc({ lines: [], ocr: { status: 'done' } })), false);
  const h = await editor(doc({ lines: [], images: [{ id: 1, page_no: 1 }] }), { ocr: async () => doc({ lines: [], images: [{ id: 1, page_no: 1 }], ocr: { status: 'done', warnings: ['NOT_A_BILL'] } }) });
  await h.click('อ่านบิล'); assertImage(h, 'not-a-bill'); assert.ok(!has(h, 'review-lines')); assert.ok(!has(h, 'received-success'));
  await h.click('ถ่ายบิล'); h.budget();
  const failed = await editor(doc({ images: [{ id: 1, page_no: 1 }] }), { ocr: async () => { throw { response: { status: 503, data: { code: 'OCR_UNAVAILABLE' } } }; } });
  await failed.click('อ่านบิล'); assertImage(failed, 'error'); assert.ok(!has(failed, 'not-a-bill')); assert.ok(!has(failed, 'reading-bill'));
});

test('illustrations: corrected photo after zero-line OCR offers a real reread instead of skipping to lines', async () => {
  const h = await editor(doc({ lines: [], images: [{ id: 1, page_no: 1 }], ocr: { status: 'done', warnings: ['NOT_A_BILL'] } }));
  assertImage(h, 'not-a-bill'); await h.click('ถ่ายบิล');
  const input = h.find(node => node.type === 'input' && node.props.type === 'file');
  await input.props.onChange({ target: { files: [{ size: 20, type: 'image/jpeg', name: 'bill.jpg', slice: () => new Blob([new Uint8Array([255, 216, 255])]) }], value: 'bill.jpg' } }); await h.settle();
  await h.click('ส่งอ่านบิล'); assert.ok(!has(h, 'not-a-bill'));
  assert.equal(h.calls.filter(call => call[0] === 'ocr').length, 1);
});

test('illustrations: reopened failed OCR shows error; explicit non-bill warning shows the bill-check hint', async () => {
  const failed = await editor(doc({ ocr: { status: 'failed' } }));
  assertImage(failed, 'error'); assert.ok(!has(failed, 'capture-bill'));
  const flagged = await editor(doc({ lines: [], ocr: { status: 'done', warnings: ['NOT_A_BILL'] } }));
  assertImage(flagged, 'not-a-bill'); assert.ok(!has(flagged, 'review-lines'));
});

test('illustrations: saving edited data before OCR does not show the OCR picture prematurely', async () => {
  const saving = deferred(); const reading = deferred(); let calls = 0;
  const h = await editor(doc({ images: [{ id: 1, page_no: 1 }] }), { update: () => saving.promise, ocr: () => { calls++; return reading.promise; } });
  await h.radio('lines'); await h.click('ทั้งหมด'); await h.select('รับจริง', '1'); await h.click('บันทึกและถัดไป'); await h.radio('images');
  const work = h.find(node => node.type === 'button' && h.text(node) === 'อ่านบิล').props.onClick(); await h.settle();
  assert.equal(calls, 0); assert.ok(!has(h, 'reading-bill'));
  saving.resolve(doc({ images: [{ id: 1, page_no: 1 }] })); await h.settle();
  assert.equal(calls, 1); assertImage(h, 'reading-bill');
  reading.resolve(doc({ ocr: { status: 'done' } })); await work; await h.settle();
  assert.ok(!has(h, 'reading-bill'));
});

test('illustrations: received-success only follows confirmed response; request failure never shows it', async () => {
  for (const fails of [false, true]) {
    const pending = deferred();
    const h = await editor(doc({ has_receiver_signature: true }), { confirm: () => pending.promise }, {}, { setTimeout: done => { done(); return 1; }, clearTimeout() {} });
    await h.radio('sign'); await h.click('ตรวจรับ');
    const work = h.find(node => node.type === 'button' && h.text(node) === 'ยืนยัน').props.onClick(); await h.settle();
    assert.ok(!has(h, 'received-success'));
    if (fails) pending.reject({ request: {} }); else pending.resolve(doc({ status: 'confirmed', has_receiver_signature: true }));
    await work; await h.settle();
    if (fails) { assert.ok(!has(h, 'received-success')); assertImage(h, 'error'); }
    else assertImage(h, 'received-success', 'eager');
  }
});

test('illustrations: helpers stay static and within 160–240px; review art yields space below tablet width', async () => {
  const css = await readFile(new URL('../src/pages/receiving/receiving.css', import.meta.url), 'utf8');
  const illustrationCSS = css.slice(css.indexOf('/* Static helpers'));
  const tokens = await readFile(new URL('../src/design/tokens.css', import.meta.url), 'utf8');
  const spaces = Object.fromEntries([...tokens.matchAll(/--sg-space-(\d+): (\d+)px/g)].map(([, key, value]) => [key, Number(value)]));
  const resolved = illustrationCSS.replace(/calc\(var\(--sg-space-(\d+)\) \* (\d+)\)/g, (_, key, multiplier) => `${spaces[key] * Number(multiplier)}px`);
  assert.match(resolved, /clamp\(160px, 44vw, 240px\)/);
  assert.match(illustrationCSS, /max-width: 100%/);
  assert.match(illustrationCSS, /rc-illustration--supporting \{ display: none/);
  assert.match(illustrationCSS, /@media \(min-width: 760px\)/);
  assert.doesNotMatch(illustrationCSS, /animation|transition|transform/);
  assert.equal(Object.keys(altTexts).length, 10);
});
