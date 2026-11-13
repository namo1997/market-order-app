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
  assert.match(page, /สแกนดวงนี้แล้ว/);
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

test('scan feedback: sound + vibration, toast above page, running summary', async () => {
  const { SCAN_TONES, SCAN_VIBRATION } = await import('../src/components/scan/scanFeedback.js');
  const { groupScannedStickers } = await import('../src/components/scan/scanResultUtils.js');
  // เสียงแยกกันชัด: สำเร็จ = 2 เสียงสูง, ซ้ำ = 1 เสียงกลาง, ผิด = เสียงต่ำยาว
  assert.equal(SCAN_TONES.ok.filter((step) => step.freq).length, 2);
  assert.ok(SCAN_TONES.ok.every((step) => !step.freq || step.freq >= 1000));
  assert.ok(SCAN_TONES.error[0].freq < 400 && SCAN_TONES.error[0].ms >= 300);
  assert.ok(SCAN_VIBRATION.error.length > SCAN_VIBRATION.ok.length);
  const groups = groupScannedStickers([
    { product_id: 1, name: 'A', unit: 'ถุง', quantity: 1, at: 1 },
    { product_id: 2, name: 'B', unit: 'กก.', quantity: 2.5, at: 2 },
    { product_id: 1, name: 'A', unit: 'ถุง', quantity: 1, at: 3 }
  ]);
  assert.deepEqual(groups.map((g) => [g.name, g.quantity, g.stickers]), [['A', 2, 2], ['B', 2.5, 1]]);

  const result = readFileSync(new URL('../src/components/scan/ScanResult.jsx', import.meta.url), 'utf8');
  // portal ไป body กันโดนการ์ดที่มี transform ทับ
  assert.match(result, /createPortal\(/);
  assert.match(result, /aria-live="assertive"/);
  const camera = readFileSync(new URL('../src/components/scan/CameraScanner.jsx', import.meta.url), 'utf8');
  assert.match(camera, /return createPortal\(/);
  assert.match(camera, /\{events\.length\} ดวง/);
  assert.match(camera, /เสร็จ/);
  const page = readFileSync(new URL('../src/pages/user/WithdrawStock.jsx', import.meta.url), 'utf8');
  assert.match(page, /playScanFeedback\(tone\)/);
  assert.match(page, /unlockScanAudio/);
  assert.match(page, /<ScannedSummary events=\{scanEvents\} \/>/);
  assert.match(page, /'ไม่พบสติกเกอร์'/);
});

test('packing page: per-branch list, scan feedback per outcome, stable line order, menu + route', () => {
  const page = readFileSync(new URL('../src/pages/production/ProductionPacking.jsx', import.meta.url), 'utf8');
  for (const text of ['เกินที่สั่ง', 'สแกนดวงนี้แล้ว', 'ไม่มีในใบสั่ง', 'ไม่พบสติกเกอร์', 'จัดเสร็จ']) {
    assert.ok(page.includes(text), text);
  }
  assert.match(page, /case 'over':/);
  assert.match(page, /case 'not_in_order':/);
  assert.match(page, /useWedgeScanner\(/);
  assert.match(page, /<CameraScanner/);
  // บรรทัดไม่กระโดดเมื่อครบ: ใช้ลำดับจาก server ตรง ๆ
  assert.match(page, /const sortedLines = branch\?\.lines \|\| \[\];/);
  assert.match(page, /scrollIntoView\(\{ block: 'center'/);
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /path="\/production\/packing"[\s\S]{0,120}requireSupplierOrders/);
  const menu = readFileSync(new URL('../src/pages/user/FunctionSelect.jsx', import.meta.url), 'utf8');
  assert.match(menu, /title: 'จัดของส่งสาขา'/);
  const api = readFileSync(new URL('../src/api/productionPacking.js', import.meta.url), 'utf8');
  assert.match(api, /\/production\/packing\/branches\/\$\{branchId\}\/scan/);
});

test('camera gate: stickers still in view are not re-sent, two stickers do not ping-pong', async () => {
  const { createScanGate, pickCenteredCode, isPointsCentered } = await import('../src/components/scan/cameraScanGate.js');
  let t = 0;
  const gate = createScanGate({ holdMs: 2500, minGapMs: 900, now: () => t });
  const sent = [];
  // ม้วนสติกเกอร์: เห็น A กับ B สลับกันทุก 120 ms นาน 5 วิ
  for (t = 0; t <= 5000; t += 120) {
    for (const code of (Math.round(t / 120) % 2 ? ['B', 'A'] : ['A', 'B'])) {
      if (gate(code)) sent.push([code, t]);
    }
  }
  assert.deepEqual(sent.map(([code]) => code), ['A', 'B']);
  assert.ok(sent[1][1] - sent[0][1] >= 900);
  // หายจากภาพเกิน 2.5 วิ แล้วกลับมา → ส่งใหม่ได้ (ให้ระบบเตือน "สแกนดวงนี้แล้ว" ครั้งเดียว)
  t = 9000;
  assert.equal(gate('A'), true);
  assert.equal(gate('A'), false);

  const frame = [1280, 720];
  const results = [
    { rawValue: 'EDGE', boundingBox: { x: 0, y: 300, width: 120, height: 60 } },
    { rawValue: 'NEAR', boundingBox: { x: 500, y: 320, width: 200, height: 60 } },
    { rawValue: 'MID', boundingBox: { x: 560, y: 330, width: 160, height: 60 } }
  ];
  assert.equal(pickCenteredCode(results, ...frame), 'MID');
  assert.equal(pickCenteredCode([results[0]], ...frame), null);
  assert.equal(isPointsCentered([{ x: 10, y: 10 }, { x: 60, y: 20 }], ...frame), false);
  assert.equal(isPointsCentered([{ x: 600, y: 350 }, { x: 700, y: 360 }], ...frame), true);

  const camera = readFileSync(new URL('../src/components/scan/CameraScanner.jsx', import.meta.url), 'utf8');
  assert.match(camera, /if \(!gate\(code\)\) return;/);
  assert.match(camera, /pickCenteredCode\(results, video\.videoWidth, video\.videoHeight\)/);
  assert.doesNotMatch(camera, /results\.forEach\(/);
});

test('packing taps are instant and batched: no button lock, one request per burst', () => {
  const page = readFileSync(new URL('../src/pages/production/ProductionPacking.jsx', import.meta.url), 'utf8');
  assert.match(page, /bumpLine\(line\.product_id, delta\)/);
  assert.match(page, /setTimeout\(\(\) => flushProduct\(productId\), 350\)/);
  assert.match(page, /touch-manipulation/);
  assert.doesNotMatch(page, /disabled=\{busy \|\| line\.packed <= 0\}/);
  // ก่อนจัดเสร็จ/ออกจากสาขา ต้องส่งที่ค้างให้หมด
  assert.match(page, /await flushAll\(\);\s*await productionPackingAPI\.setPacked/);
  assert.match(page, /const backToBranches = async \(\) => \{\s*await flushAll\(\);/);
});

test('pack size: stickers per pack with the remainder on the last, same formula as the server', async () => {
  const client = await import('../src/pages/production/transformStickerPrint.js');
  const server = await import('../../server/src/utils/transform-sticker-code.js');
  for (const [qty, pack] of [[12, 5], [100, 5], [101, 5], [3, 0], [2.5, 0], [250, 0], [7.5, 2], [1, 5]]) {
    const copies = client.getStickerCopies(qty, pack);
    assert.equal(copies, server.getStickerCopies(qty, pack), `copies ${qty}/${pack}`);
    for (let seq = 1; seq <= copies; seq += 1) {
      assert.equal(client.getQuantityPerSticker(qty, pack, seq), server.getQuantityPerSticker(qty, pack, seq), `${qty}/${pack}#${seq}`);
    }
  }
  const labels = client.expandStickerLabels([{
    productName: 'ไก่บ้านหมักย่าง', productUnit: 'ตัว', transactionId: 150000,
    quantityText: '+12 ตัว', quantityValue: 12, packSize: 5, packUnitLabel: 'ถุง'
  }]);
  assert.deepEqual(labels.map((l) => l.quantityText), ['5 ตัว', '5 ตัว', '2 ตัว']);
  assert.deepEqual(labels.map((l) => l.sequenceText), ['ถุง 1/3', 'ถุง 2/3', 'ถุง 3/3']);
  const html = client.buildTransformStickerHtml(labels.slice(0, 1).map(({ sequence, sequenceText, quantityText, ...rest }) => rest));
  assert.match(html, /5 ตัว · ถุง 1\/3/);

  const page = readFileSync(new URL('../src/pages/production/ProductionTransform.jsx', import.meta.url), 'utf8');
  assert.match(page, /\.\.\.packFieldsFor\(item\.product_id\)/);
  assert.match(page, /\.\.\.packFieldsFor\(row\.product_id\)/);
  assert.match(page, /ตั้งค่าแพ็ค/);
  // สินค้าที่ยังไม่ตั้งแพ็ค ไม่เติม "ถุง" ให้ แสดงแค่ปุ่ม "ตั้งแพ็ค"
  const tab = readFileSync(new URL('../src/pages/production/ProductionPackSizeTab.jsx', import.meta.url), 'utf8');
  assert.match(tab, /useState\(pack\?\.pack_unit_label \|\| ''\)/);
  assert.match(tab, /useState\(Boolean\(pack\)\)/);
  assert.match(tab, />\s*ตั้งแพ็ค\s*</);
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

test('A1: over-stock 409 shows each ingredient with the unit it will really cut; other errors are not intercepted', async () => {
  const { getOverStockLines } = await import('../src/utils/usage-unit.js');
  const error = {
    response: {
      status: 409,
      data: {
        code: 'INGREDIENT_OVER_STOCK',
        over_stock: [{ product_name: 'น้ำส้มสายชู', unit_label: 'แกลลอน', required_quantity: 1200, available_quantity: 4 }]
      }
    }
  };
  const lines = getOverStockLines(error);
  assert.match(lines, /น้ำส้มสายชู/);
  assert.match(lines, /1,200 แกลลอน/);
  assert.match(lines, /มี 4 แกลลอน/);
  assert.equal(getOverStockLines({ response: { status: 409, data: { code: 'OTHER' } } }), null);
  assert.equal(getOverStockLines({ response: { status: 500 } }), null);
  assert.equal(getOverStockLines(new Error('network')), null);
});
