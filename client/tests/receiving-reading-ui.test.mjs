import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { harness } from './receiving-harness.mjs';
import { readingProgress } from '../src/pages/receiving/reading-progress.js';
import { billViewerHistory } from '../src/pages/receiving/bill-viewer-history.js';

const user = { id: 1, role: 'receiver', name: 'ผู้รับ', branch_id: 1, department_id: 1 };
const doc = (values = {}) => ({ id: 5, status: 'draft', kind: 'bill', delivery_date: '2026-10-17', images: [{ id: 2, page_no: 1 }],
  lines: [], discount: '0', vat: '0', ocr: { status: 'none' }, warnings: [], ...values });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const editor = (overrides = {}, document = doc(), runtime = {}) => harness('DocumentEditor', { initialDocument: document, user, onChanged() {}, onBack() {} },
  { image: async () => new Blob(['mock-bill']), ...overrides }, {}, {}, runtime);
const start = async (h, label = 'อ่านบิล') => {
  const work = h.find(node => node.type === 'button' && h.text(node) === label).props.onClick();
  await h.settle(); return { work };
};
const text = h => h.text(h.visible());

function historyBrowser() {
  const entries = [{ router: 'preserved' }]; let index = 0; const listeners = new Set(); let backs = 0;
  return {
    history: { get state() { return entries[index]; }, pushState(state, title, url) { assert.equal(url, undefined); entries.splice(++index); entries[index] = state; },
      back() { backs++; if (index) index--; for (const fn of listeners) fn({ type: 'popstate' }); } },
    addEventListener(type, fn) { if (type === 'popstate') listeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'popstate') listeners.delete(fn); },
    get backs() { return backs; }, get size() { return listeners.size; },
  };
}

test('bill viewer: same URL preserves router state; Android Back closes once; close/dispose cannot navigate twice', () => {
  for (const action of ['back', 'close', 'dispose']) {
    const browser = historyBrowser(); let closed = 0;
    const handle = billViewerHistory(browser, () => closed++);
    assert.equal(browser.history.state.router, 'preserved'); assert.ok(browser.history.state.solaoBillViewer);
    if (action === 'back') browser.history.back(); else handle[action]();
    assert.equal(closed, action === 'dispose' ? 0 : 1); handle.dispose();
    assert.equal(browser.backs, 1); assert.equal(browser.size, 0);
    assert.deepEqual(browser.history.state, { router: 'preserved' });
  }
});

test('bill viewer: pending and saved pages stay inside overlay; pinch, pan, zoom, Escape and close work', async () => {
  let closed = 0; const browser = historyBrowser(); const revoked = [];
  const h = await harness('BillViewer', { documentId: 5, pages: [{ id: 2, page_no: 1 }, { dataUrl: 'data:image/jpeg;base64,fixture', page_no: 2 }], onClose: () => closed++ },
    { image: async (id, imageId) => { assert.equal(id, 5); assert.equal(imageId, 2); return new Blob(['mock']); } }, {}, browser,
    { URL: { createObjectURL: () => 'blob:mock-bill', revokeObjectURL: url => revoked.push(url) } });
  assert.equal(h.visible().filter(node => node.type === 'img').length, 2);
  assert.equal(h.visible().filter(node => node.type === 'a').length, 0);
  const pan = () => h.find(node => node.props.className === 'rc-image-pan');
  const pointer = (id, x, y) => ({ pointerId: id, pointerType: 'touch', clientX: x, clientY: y, preventDefault() {}, currentTarget: { setPointerCapture() {} } });
  pan().props.onPointerDown(pointer(1, 0, 0)); pan().props.onPointerDown(pointer(2, 100, 0));
  pan().props.onPointerMove(pointer(2, 100, 0)); pan().props.onPointerMove(pointer(2, 200, 0)); await h.settle();
  assert.match(text(h), /200%/);
  const scroll = pan().props.ref.current; scroll.scrollLeft = 60; scroll.scrollTop = 100;
  pan().props.onPointerUp(pointer(2, 200, 0)); pan().props.onPointerMove(pointer(1, 20, 30));
  assert.equal(scroll.scrollLeft, 40); assert.equal(scroll.scrollTop, 70);
  await h.click('ขยาย'); assert.match(text(h), /250%/);
  await h.click('ย่อ'); assert.match(text(h), /200%/);
  h.find(node => node.type === 'dialog').props.onCancel({ preventDefault() {} });
  assert.equal(closed, 1); assert.equal(browser.backs, 1);
  h.unmount(); assert.deepEqual(revoked, ['blob:mock-bill']);
});

test('bill viewer: failed protected image is recoverable and never navigates away', async () => {
  let closed = false;
  const h = await harness('BillViewer', { documentId: 5, pages: [{ id: 2 }], onClose: () => { closed = true; } }, { image: async () => { throw new Error('offline'); } });
  assert.match(text(h), /โหลดรูปไม่สำเร็จ/); await h.click('ปิด'); assert.equal(closed, true); h.unmount();
});

test('reading progress: 10/30 second boundaries and 120+ second display never imply an actual completion', () => {
  for (const [ms, label, elapsed] of [[0, 'AI กำลังอ่านบิล…', '0:00'], [9999, 'AI กำลังอ่านบิล…', '0:09'],
    [10000, 'กำลังอ่านรายการและราคา…', '0:10'], [29999, 'กำลังอ่านรายการและราคา…', '0:29'], [30000, 'เกือบเสร็จแล้ว', '0:30'], [125000, 'เกือบเสร็จแล้ว', '2:05']]) {
    assert.equal(readingProgress(ms).label, label); assert.equal(readingProgress(ms).elapsed, elapsed);
  }
});

test('reading progress: renders first bill, elapsed timer and cancel; timer cleans up on unmount', async () => {
  let now = 1000, callback, cleared = 0, cancelled = 0;
  const h = await harness('BillReadingProgress', { documentId: 5, page: { dataUrl: 'data:image/jpeg;base64,fixture' }, startedAt: now, onCancel: () => cancelled++ }, {}, {}, {},
    { Date: { now: () => now }, setInterval: fn => { callback = fn; return 9; }, clearInterval: id => { assert.equal(id, 9); cleared++; } });
  assert.equal(h.find(node => node.props.alt === 'ภาพบิลหน้าแรกที่กำลังอ่าน').props.src, 'data:image/jpeg;base64,fixture');
  now += 10000; callback(); await h.settle(); assert.match(text(h), /กำลังอ่านรายการและราคา…/); assert.match(text(h), /0:10/);
  now += 20000; callback(); await h.settle(); assert.match(text(h), /เกือบเสร็จแล้ว/); assert.match(text(h), /ปกติ 20–60 วินาที/);
  await h.click('ยกเลิก'); assert.equal(cancelled, 1); h.unmount(); assert.equal(cleared, 1);
});









test('UI contract: reduced motion, 48px safe-area close, all bill openings stay in app, OCR waits >=120s', async () => {
  const css = await readFile(new URL('../src/pages/receiving/bill-reading.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion: reduce[^}]*animation: none/s);
  assert.match(css, /data-motion='reduce'[^}]*animation: none/s);
  assert.match(css, /rc-image-fullscreen button[^}]*min-width: 48px; min-height: 48px/);
  for (const side of ['top', 'bottom', 'left', 'right']) assert.ok(css.includes(`--sg-safe-${side}`));
  for (const file of ['ImagePages.jsx', 'DocumentEditor.jsx', 'BillViewer.jsx']) {
    const source = await readFile(new URL(`../src/pages/receiving/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /window\.open|href=\{(?:photo|page|state)\.|location\.(?:href|assign)/);
  }
  const api = await readFile(new URL('../src/api/receiving-documents.js', import.meta.url), 'utf8');
  assert.ok(Number(api.match(/ocr:.*timeout: (\d+)/)[1]) >= 120000);
});





test('bill viewer: repeated close while asynchronous Back is queued consumes exactly one entry', () => {
  let state = { idx: 3 }, listener, back = 0, closed = 0;
  const browser = { history: { get state() { return state; }, pushState: next => { state = next; }, back: () => back++ },
    addEventListener: (type, fn) => { listener = fn; }, removeEventListener() {} };
  const handle = billViewerHistory(browser, () => closed++);
  handle.close(); handle.close(); assert.equal(back, 1); assert.equal(closed, 0);
  state = { idx: 3 }; listener(); assert.equal(closed, 1); handle.dispose(); assert.equal(back, 1);
});
