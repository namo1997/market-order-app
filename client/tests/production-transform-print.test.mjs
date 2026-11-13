// สติกเกอร์แปรรูป: วันที่ล็อต/บาร์โค้ดต้องเป็นวันไทย และหน้าต่างพิมพ์บนมือถือต้องไม่ถูกปิดก่อนพิมพ์เสร็จ
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, mock, test } from 'node:test';
import {
  buildLotNo,
  buildTransformStickerHtml,
  extractYmd,
  printTransformStickers,
  shouldAutoClosePrintWindow
} from '../src/pages/production/transformStickerPrint.js';

// 06:30 น. วันที่ 13 พ.ย. 2569 เวลาไทย = 23:30 UTC ของวันที่ 12
const EARLY_MORNING_UTC = '2026-11-12T23:30:00.000Z';

const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const fakeWindow = ({ userAgent, maxTouchPoints = 0, coarse = false }) => ({
  navigator: { userAgent, maxTouchPoints },
  matchMedia: () => ({ matches: coarse })
});

const fakePopup = () => {
  const listeners = {};
  const popup = {
    printed: 0,
    closed: 0,
    html: '',
    document: {
      open() {},
      write(html) { popup.html += html; },
      close() {}
    },
    focus() {},
    print() { popup.printed += 1; },
    close() { popup.closed += 1; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    fire(type) { (listeners[type] || []).forEach((fn) => fn()); }
  };
  return popup;
};

const label = {
  productName: 'หมูหมัก',
  productUnit: 'ถุง',
  productCode: 'PK001',
  producedAt: EARLY_MORNING_UTC,
  referenceId: 'PRD-1731450600000',
  quantityText: '+2 ถุง',
  quantityValue: 2
};

afterEach(() => {
  mock.timers.reset();
  delete globalThis.window;
  delete globalThis.alert;
});

test('extractYmd uses the Bangkok day, not the UTC day', () => {
  assert.equal(extractYmd(EARLY_MORNING_UTC), '2026-11-13');
  assert.equal(extractYmd('2026-11-13T10:00:00.000Z'), '2026-11-13');
  assert.equal(extractYmd('2026-11-13T17:30:00.000Z'), '2026-11-14');
  assert.equal(extractYmd('2026-11-13'), '2026-11-13');
  assert.equal(extractYmd(new Date(EARLY_MORNING_UTC)), '2026-11-13');
  assert.equal(extractYmd(''), null);
  assert.equal(extractYmd('not a date'), null);
});

test('lot number and barcode of an early-morning transform carry the Thai date', () => {
  assert.match(buildLotNo(label.referenceId, label.producedAt), /^LOT20261113-/);
  const html = buildTransformStickerHtml([label], { layout: '3x2' });
  assert.match(html, /ล็อต LOT20261113-/);
  assert.match(html, /PK001-261113-/);
  assert.doesNotMatch(html, /LOT20261112/);
  assert.doesNotMatch(html, /PK001-261112-/);
});

test('sticker page has a screen-only print/close bar', () => {
  const html = buildTransformStickerHtml([label], { layout: '3x2' });
  assert.match(html, /class="print-toolbar"/);
  assert.match(html, /onclick="window\.print\(\)"/);
  assert.match(html, /onclick="window\.close\(\)"/);
  assert.match(html, /@media print \{ \.print-toolbar \{ display: none !important; \} \}/);
  // 2 ชุด = 2 ดวง
  assert.equal((html.match(/<section class="sticker/g) || []).length, 2);
});

test('auto-close only on desktop', () => {
  assert.equal(shouldAutoClosePrintWindow(fakeWindow({ userAgent: DESKTOP_UA })), true);
  assert.equal(shouldAutoClosePrintWindow(fakeWindow({ userAgent: ANDROID_UA })), false);
  assert.equal(shouldAutoClosePrintWindow(fakeWindow({ userAgent: DESKTOP_UA, maxTouchPoints: 5 })), false);
  assert.equal(shouldAutoClosePrintWindow(fakeWindow({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)', coarse: true })), false);
});

const runPrint = (win) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const popup = fakePopup();
  globalThis.alert = (message) => { throw new Error(`unexpected alert: ${message}`); };
  globalThis.window = { ...win, open: () => popup };
  printTransformStickers([label], { layout: '3x2' });
  mock.timers.tick(250);
  return popup;
};

test('desktop: window closes only after the print dialog finishes', () => {
  const popup = runPrint(fakeWindow({ userAgent: DESKTOP_UA }));
  assert.equal(popup.printed, 1);
  assert.equal(popup.closed, 0, 'must not close right after print()');
  popup.fire('afterprint');
  mock.timers.tick(300);
  assert.equal(popup.closed, 1);
});

test('mobile: window stays open after print() so the print job is not lost', () => {
  const popup = runPrint(fakeWindow({ userAgent: ANDROID_UA }));
  assert.equal(popup.printed, 1);
  popup.fire('afterprint');
  mock.timers.tick(5000);
  assert.equal(popup.closed, 0);
});

test('transform page defaults to the Thai day and does not re-save items after a partial failure', () => {
  const source = readFileSync(new URL('../src/pages/production/ProductionTransform.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /toISOString\(\)\.split\('T'\)\[0\]/);
  assert.match(source, /useState\(\(\) => bangkokDate\(\)\)/);
  assert.match(source, /savedIds\.has\(Number\(productId\)\)/);
  assert.match(source, /setOutputQuantities\(withoutSaved\)/);
});
