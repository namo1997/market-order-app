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
  await h.radio('documents'); h.budget();
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
  await h.click('เปิดเอกสาร #5 ไม่ระบุผู้ส่ง ยังไม่เสร็จ'); assertImage(h, 'error', 'eager');
  await h.click('ลองใหม่'); assert.equal(calls, 2); assertImage(h, 'capture-bill', 'eager');
});

test('illustrations: offline is explicit, never claims durable storage, and recovers on online event', async () => {
  const events = {};
  const navigator = { onLine: false };
  const h = await harness('Receiving', {}, { expected: async () => [] }, {}, { addEventListener: (name, callback) => { events[name] = callback; } }, { navigator });
  assertImage(h, 'offline', 'eager'); assert.ok(!has(h, 'empty-today'));
  assert.ok(!h.text(h.visible()).includes('ร่างนี้อยู่ในเครื่องแล้ว'));
  navigator.onLine = true; events.online(); await h.settle(); assertImage(h, 'empty-today', 'eager');
  const edit = await editor(doc(), {}, { online: false }); assert.match(edit.text(edit.visible()), /ออฟไลน์/);
  const create = await harness('CreateDocument', { user, date: '2026-10-15', onClose() {}, onCreated() {}, online: false }); assertImage(create, 'offline');
});

test('illustrations: past-date emptiness and status-filter emptiness do not claim today has no receipts', async () => {
  const h = await harness('Receiving', {}, { expected: async () => [] });
  await h.click('ตัวเลือก'); await h.select('วันที่', '2020-01-01'); await h.click('ตกลง');
  assertImage(h, 'empty-today', 'eager'); assert.ok(h.text(h.visible()).includes('ยังไม่มีของเข้าในวันที่เลือก'));
  const filtered = await harness('Receiving', {}, { list: async () => [doc()] });
  await filtered.radio('documents'); await filtered.radio('confirmed');
  assert.ok(!has(filtered, 'empty-today')); assert.ok(filtered.text(filtered.visible()).includes('ไม่มีเอกสารในสถานะนี้'));
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
  assert.equal(Object.keys(altTexts).length, 11);
});
