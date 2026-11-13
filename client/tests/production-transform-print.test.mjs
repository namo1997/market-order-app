// สติกเกอร์แปรรูป: สแกนง่าย (จุดเต็มที่ 203 dpi), วันที่เป็นวันไทย และหน้าต่างพิมพ์บนมือถือต้องไม่ถูกปิดก่อนพิมพ์เสร็จ
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, mock, test } from 'node:test';
import {
  buildBarcodeSvg,
  buildQrSvg,
  buildScanId,
  encodeTransformStickerCode,
  buildTransformStickerHtml,
  extractYmd,
  printTransformStickers,
  shouldAutoClosePrintWindow,
  TRANSFORM_STICKER_LAYOUT
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

test('every sticker gets its own 12-digit code: transform row id + copy number', () => {
  assert.equal(encodeTransformStickerCode(146290, 2), '001462900002');
  assert.equal(buildScanId({ ...label, transactionId: 146290, sequence: 1 }), '001462900001');
  // ไม่มี id รายการ: รหัสสินค้า + วันผลิตแบบวันไทย
  assert.equal(buildScanId({ referenceId: '-', productCode: 'pk-001', producedAt: EARLY_MORNING_UTC }), 'PK001261113');
  const html = buildTransformStickerHtml([{ ...label, transactionId: 146290 }]);
  // 2 ชุด = 2 ดวง รหัสไม่ซ้ำกัน
  assert.match(html, /class="scan-id"[^>]*>0014 6290 0001</);
  assert.match(html, /class="scan-id"[^>]*>0014 6290 0002</);
  assert.match(html, /วันที่ผลิต<\/div>\s*<div class="date-value">13\/11\/69</);
  const page = readFileSync(new URL('../src/pages/production/ProductionTransform.jsx', import.meta.url), 'utf8');
  assert.match(page, /transactionId: item\.transaction_id/);
  assert.match(page, /transactionId: row\.id/);
});

test('withdraw page scans stickers: +quantity per sticker, same sticker only once', () => {
  const page = readFileSync(new URL('../src/pages/user/WithdrawStock.jsx', import.meta.url), 'utf8');
  assert.match(page, /placeholder="สแกนสติกเกอร์"/);
  assert.match(page, /withdrawAPI\.getSticker\(code\)/);
  assert.match(page, /ดวงนี้สแกนแล้ว/);
  assert.match(page, /sticker\.quantity_per_sticker/);
  // บวกจำนวนแบบ functional update กันสแกนรัวแล้วจำนวนหาย
  assert.match(page, /setDraftItems\(\(prev\) => \{\s*const existing = prev\.find/);
  const api = readFileSync(new URL('../src/api/withdraw.js', import.meta.url), 'utf8');
  assert.match(api, /\/withdraw\/sticker\//);
});

test('withdraw page also takes phone camera and keyboard-wedge scanners', () => {
  const page = readFileSync(new URL('../src/pages/user/WithdrawStock.jsx', import.meta.url), 'utf8');
  assert.match(page, /aria-label="สแกนด้วยกล้อง"/);
  assert.match(page, /\{isCameraOpen && \(\s*<CameraScanner/);
  // เครื่องยิงพิมพ์ตัวเลขรัว (ห่างกันไม่เกิน 100 ms) แล้ว Enter: รับ 12 หลักแม้ไม่ได้แตะช่องสแกน
  assert.match(page, /window\.addEventListener\('keydown', onKeyDown\)/);
  assert.match(page, /now - lastAt > 100/);
  assert.match(page, /code\.length === 12/);
  // ทั้งสามทางใช้ handler เดียว และกันดวงซ้ำระหว่างรอผล
  assert.match(page, /pendingCodesRef\.current\.has\(code\)/);
  const camera = readFileSync(new URL('../src/components/scan/CameraScanner.jsx', import.meta.url), 'utf8');
  assert.match(camera, /'BarcodeDetector' in window/);
  assert.match(camera, /import\('@zxing\/browser'\)/);
  assert.match(camera, /BarcodeFormat\.CODE_128, BarcodeFormat\.QR_CODE/);
  assert.match(camera, /facingMode: \{ ideal: 'environment' \}/);
  assert.match(camera, /track\.stop\(\)/);
  assert.match(camera, /playsInline/);
});

test('barcode bars are whole printer dots (4 dots = 0.5 mm) with quiet zones', () => {
  const barcode = buildBarcodeSvg('731450600000', { maxWidthMm: 64, heightMm: 11 });
  assert.equal(barcode.moduleDots, 4);
  // 101 โมดูล (CODE128 ชุด C) + quiet zone 10+10
  assert.match(barcode.svg, /viewBox="0 0 121 1"/);
  assert.equal(barcode.widthMm, 60.5);
  assert.match(barcode.svg, /preserveAspectRatio="none"/);
  assert.match(barcode.svg, /shape-rendering="crispEdges"/);
  // รหัสยาวกว่าเดิมต้องย่อแท่งให้พอดี ไม่ล้นความกว้าง
  const long = buildBarcodeSvg('PK001-261113-600000-EXTRA', { maxWidthMm: 64, heightMm: 11 });
  assert.ok(long.widthMm <= 64);
});

test('QR is the smallest version with whole-dot modules', () => {
  const qr = buildQrSvg('731450600000', { maxSizeMm: 18.5 });
  assert.equal(qr.moduleCount, 21);
  assert.equal(qr.moduleDots, 7);
  assert.equal(qr.sizeMm, 18.375);
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

test('transform page prints on the real 72x50 mm label (landscape)', () => {
  assert.equal(TRANSFORM_STICKER_LAYOUT, '72x50');
  const html = buildTransformStickerHtml([label]);
  assert.match(html, /size: 72mm 50mm;/);
  assert.match(html, /width: 72mm !important;/);
  assert.match(html, /height: 50mm !important;/);
  // ขอบข้าง 4 มม. เผื่อเครื่องพิมพ์วางภาพเลื่อน ~2 มม.
  assert.match(html, /padding: 2mm 4mm;/);
  // ไม่ย่อ/ขยายเนื้อหา ไม่งั้นแท่งบาร์โค้ดไม่ตรงจุดเครื่องพิมพ์
  assert.doesNotMatch(html, /scale\(/);
  assert.match(buildTransformStickerHtml([label], { layout: '3x2' }), /size: 76\.2mm 50\.8mm;/);
  assert.match(buildTransformStickerHtml([label], { layout: 'unknown' }), /size: 72mm 50mm;/);
  const page = readFileSync(new URL('../src/pages/production/ProductionTransform.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /layout: '3x2'/);
  assert.equal((page.match(/layout: TRANSFORM_STICKER_LAYOUT/g) || []).length, 2);
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
