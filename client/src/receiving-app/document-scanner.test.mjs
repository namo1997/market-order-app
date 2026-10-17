import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentScanner, createScannerCapture } from './document-scanner.mjs';

const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1])], { type: 'image/jpeg' });
const pdf = new Blob(['%PDF-1.7\nmock'], { type: 'application/pdf' });
function harness({ platform = 'android', registered = true, available = true, scan, fetchImpl, install } = {}) {
  const calls = [], reasons = [];
  const plugin = {
    isGoogleDocumentScannerModuleAvailable: async () => { calls.push('available'); return { available }; },
    installGoogleDocumentScannerModule: async () => { calls.push('install'); return install?.(); },
    scanDocument: async options => { calls.push(options); return scan ? scan(options) : {
      scannedImages: ['content://scan/1', 'file:///scan/2'], pdf: { uri: 'content://scan/pdf', pageCount: 2 },
    }; },
  };
  const scanner = createDocumentScanner({ plugin, capacitor: {
    getPlatform: () => platform, isPluginAvailable: name => { assert.equal(name, 'DocumentScanner'); return registered; },
    convertFileSrc: uri => `http://localhost/_capacitor_file_/${uri}`,
  }, onReason: code => reasons.push(code), fetchImpl: fetchImpl || (async (uri, options) => {
    calls.push({ uri, options }); return { ok: true, blob: async () => uri.endsWith('/pdf') ? pdf : jpeg };
  }) });
  return { scanner, calls, reasons, plugin };
}
test('scanner ready returns ordered JPEG Files and a PDF File in FULL mode without gallery or upload', async () => {
  const { scanner, calls } = harness();
  assert.equal(await scanner.isScannerAvailable(), true);
  const result = await scanner.scanBill({ maxPages: 10 });
  assert.deepEqual(calls.find(v => v?.pageLimit), { pageLimit: 10, scannerMode: 'FULL', galleryImportAllowed: false, resultFormats: 'JPEG_PDF' });
  assert.deepEqual(result.images.map(f => [f.name, f.type, f.size]), [['bill-1.jpeg', 'image/jpeg', 4], ['bill-2.jpeg', 'image/jpeg', 4]]);
  assert.ok(result.images.every(f => f instanceof File));
  assert.ok(result.pdf instanceof File); assert.equal(result.pdf.name, 'bill.pdf');
  assert.equal(result.pdf.type, 'application/pdf'); assert.equal(await result.pdf.text(), '%PDF-1.7\nmock');
  assert.deepEqual([...new Uint8Array(await result.images[0].arrayBuffer())], [255, 216, 255, 1]);
  assert.equal(scanner.lastReason, null);
  for (const read of calls.filter(v => v?.uri)) assert.deepEqual(read.options, { credentials: 'omit', redirect: 'error' });
});
for (const options of [{ platform: 'web' }, { platform: 'ios' }, { registered: false }]) {
  test(`unsupported scanner does not invoke plugin: ${JSON.stringify(options)}`, async () => {
    const { scanner, calls } = harness(options);
    assert.equal(await scanner.isScannerAvailable(), false); assert.equal(await scanner.scanBill(), null);
    assert.equal(scanner.lastReason, 'unsupported'); assert.deepEqual(calls, []);
  });
}
test('missing module starts one first-use installation, falls back, then becomes ready', async () => {
  const { scanner, calls, plugin } = harness({ available: false });
  assert.equal(await scanner.scanBill(), null); assert.equal(scanner.lastReason, 'module-installing');
  assert.equal(await scanner.scanBill(), null); assert.equal(calls.filter(x => x === 'install').length, 1);
  plugin.isGoogleDocumentScannerModuleAvailable = async () => ({ available: true });
  assert.equal((await scanner.scanBill()).images.length, 2); assert.equal(scanner.lastReason, null);
});
test('availability and install errors return safe reasons without private native details', async () => {
  const { scanner, plugin, reasons } = harness();
  plugin.isGoogleDocumentScannerModuleAvailable = async () => { throw Error('private-token /local/bill'); };
  assert.equal(await scanner.scanBill(), null); assert.equal(scanner.lastReason, 'unavailable');
  assert.doesNotMatch(JSON.stringify(reasons), /private-token|local/);
  const missing = harness({ available: false, install: () => { throw Error('private'); } });
  assert.equal(await missing.scanner.scanBill(), null); assert.equal(missing.scanner.lastReason, 'module-install-failed');
});
for (const [message, expected] of [['Scan cancelled or failed. Result code: 0', 'cancelled'], ['User canceled', 'cancelled'], ['private native stack', 'scan-failed']]) {
  test(`scanner rejection maps to ${expected}: ${message}`, async () => {
    const { scanner } = harness({ scan: () => { throw Error(message); } });
    assert.equal(await scanner.scanBill(), null); assert.equal(scanner.lastReason, expected);
  });
}
test('scanner accepts JPEG-only result when plugin omits optional PDF', async () => {
  const { scanner } = harness({ scan: () => ({ scannedImages: ['file:///scan/1'] }) });
  const result = await scanner.scanBill(); assert.equal(result.images.length, 1); assert.equal(result.pdf, null);
});
test('invalid page limits never launch native scanner', async () => {
  const { scanner, calls } = harness();
  for (const maxPages of [0, 11, 1.5, '10', NaN]) {
    assert.equal(await scanner.scanBill({ maxPages }), null); assert.equal(scanner.lastReason, 'invalid-page-limit');
  }
  assert.deepEqual(calls, []);
});
for (const result of [null, {}, { scannedImages: [] }, { scannedImages: ['file:///1', 'file:///2'] },
  { scannedImages: ['file:///1'], pdf: { uri: 'file:///pdf', pageCount: 2 } }]) {
  test(`invalid or excess scan result is rejected atomically: ${JSON.stringify(result)}`, async () => {
    const { scanner } = harness({ scan: () => result });
    assert.equal(await scanner.scanBill({ maxPages: 1 }), null); assert.equal(scanner.lastReason, 'invalid-result');
  });
}
test('remote scanner URI is rejected without making a request', async () => {
  let requests = 0;
  const { scanner } = harness({ scan: () => ({ scannedImages: ['https://outside.test/bill'] }), fetchImpl: async () => { requests++; } });
  assert.equal(await scanner.scanBill(), null); assert.equal(scanner.lastReason, 'scan-failed'); assert.equal(requests, 0);
});
for (const mode of ['not-ok', 'empty', 'wrong-magic', 'throw']) {
  test(`local read failure returns null without partial files: ${mode}`, async () => {
    const { scanner } = harness({ fetchImpl: async () => {
      if (mode === 'throw') throw Error('private path');
      return { ok: mode !== 'not-ok', blob: async () => new Blob([mode === 'empty' ? '' : 'not jpeg']) };
    } });
    assert.equal(await scanner.scanBill(), null); assert.equal(scanner.lastReason, 'scan-failed');
  });
}
test('concurrent scanner calls cannot overwrite plugin savedCall', async () => {
  let release;
  const { scanner } = harness({ scan: () => new Promise(resolve => { release = resolve; }) });
  const first = scanner.scanBill();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(await scanner.scanBill(), null); assert.equal(scanner.lastReason, 'busy');
  release({ scannedImages: ['content://scan/1'] });
  assert.equal((await first).images.length, 1); assert.equal(scanner.lastReason, null);
});
test('legacy capture defaults to single-page scanner and returns its File', async () => {
  const file = new File([jpeg], 'bill.jpeg', { type: 'image/jpeg' });
  const capture = createScannerCapture({ isNative: () => true, scanner: { scanBill: async options => {
    assert.deepEqual(options, { maxPages: 1 }); return { images: [file], pdf: null };
  } }, fallback: () => assert.fail('camera should not open') });
  assert.equal(await capture(), file);
});
for (const setup of [{ available: false }, { platform: 'web' }, { scan: () => { throw Error('cancelled'); } }, { scan: () => { throw Error('failed'); } }]) {
  test(`legacy capture automatically falls back to old camera: ${JSON.stringify(setup)}`, async () => {
    const { scanner } = harness(setup); let count = 0;
    const file = new File([jpeg], 'camera.jpeg', { type: 'image/jpeg' });
    const capture = createScannerCapture({ scanner, isNative: () => true, fallback: async () => { count++; return file; } });
    assert.equal(await capture(), file); assert.equal(count, 1);
  });
}
test('legacy web entry stays null and fallback camera cancellation remains null', async () => {
  assert.equal(createScannerCapture({ isNative: () => false }), null);
  const capture = createScannerCapture({ isNative: () => true, scanner: { scanBill: async () => null }, fallback: async () => null });
  assert.equal(await capture(), null);
});
