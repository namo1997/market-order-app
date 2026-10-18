import { Capacitor } from '@capacitor/core';
import { DocumentScanner } from '@capacitor-mlkit/document-scanner';

// No upload, gallery persistence, base64 conversion or private error logging.
// Return null on failure; lastReason/onReason expose only stable public codes.
export function createDocumentScanner({ capacitor, plugin, fetchImpl = globalThis.fetch,
  makeFile = (parts, name, options) => new File(parts, name, options), onReason = () => {} }) {
  let lastReason = null;
  let installing = false;
  let scanning = false;
  const reason = code => { lastReason = code; onReason(code); return null; };
  const supported = () => capacitor.getPlatform() === 'android' && capacitor.isPluginAvailable('DocumentScanner');
  async function isScannerAvailable() {
    try {
      if (!supported()) { reason('unsupported'); return false; }
      const { available } = await plugin.isGoogleDocumentScannerModuleAvailable();
      if (!available) { reason('module-unavailable'); return false; }
      lastReason = null;
      return true;
    } catch { reason('unavailable'); return false; }
  }
  async function readLocal(uri, name, type) {
    // Never fetch a remote URL supplied by a plugin response.
    if (typeof uri !== 'string' || !/^(file:\/\/\/|content:\/\/)/.test(uri)) throw Error('invalid-uri');
    const path = capacitor.convertFileSrc(uri);
    const response = await fetchImpl(path, { credentials: 'omit', redirect: 'error' });
    if (!response.ok) throw Error('read-failed');
    const blob = await response.blob();
    if (!blob.size) throw Error('empty-file');
    const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
    const valid = type === 'image/jpeg'
      ? head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
      : String.fromCharCode(...head) === '%PDF-';
    if (!valid) throw Error('invalid-file');
    return makeFile([blob], name, { type });
  }
  async function scanBill({ maxPages = 10 } = {}) {
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10) return reason('invalid-page-limit');
    if (scanning) return reason('busy');
    scanning = true;
    try {
      if (!await isScannerAvailable()) {
        if (lastReason === 'module-unavailable') {
          // Installation is asynchronous in Play services. Use the old camera
          // now; a later tap rechecks readiness instead of blocking the UI.
          if (!installing) {
            installing = true;
            try { await plugin.installGoogleDocumentScannerModule(); }
            catch { installing = false; return reason('module-install-failed'); }
          }
          return reason('module-installing');
        }
        return null;
      }
      installing = false;
      const result = await plugin.scanDocument({ pageLimit: maxPages, scannerMode: 'FULL',
        galleryImportAllowed: true, resultFormats: 'JPEG_PDF' });
      const uris = result?.scannedImages;
      if (!Array.isArray(uris) || !uris.length || uris.length > maxPages) return reason('invalid-result');
      const images = [];
      for (const [index, uri] of uris.entries()) images.push(await readLocal(uri, `bill-${index + 1}.jpeg`, 'image/jpeg'));
      let pdf = null;
      if (result.pdf) {
        if (result.pdf.pageCount !== images.length) return reason('invalid-result');
        pdf = await readLocal(result.pdf.uri, 'bill.pdf', 'application/pdf');
      }
      lastReason = null;
      return { images, pdf };
    } catch (error) {
      return reason(/cancel(?:led|ed)?|canceled|ยกเลิก/i.test(error?.message || '') ? 'cancelled' : 'scan-failed');
    } finally { scanning = false; }
  }
  return { isScannerAvailable, scanBill, get lastReason() { return lastReason; } };
}

export const scanner = createDocumentScanner({ capacitor: Capacitor, plugin: DocumentScanner });
export const isScannerAvailable = () => scanner.isScannerAvailable();
export const scanBill = options => scanner.scanBill(options);
export const getScannerFallbackReason = () => scanner.lastReason;

// ImagePages currently expects File|null, not an array. Limit the legacy entry
// to one page rather than silently discard pages. scanBill supports 1–10 pages
// and PDF for the future captureImages interface documented in REPORT.md.
export function createScannerCapture({ scanner: adapter, fallback, isNative }) {
  if (!isNative()) return null;
  let active = false;
  return async () => {
    if (active) return null;
    active = true;
    try {
      const result = await adapter.scanBill({ maxPages: 1 });
      if (!result) {
        const reason = adapter?.lastReason ?? adapter?.getLastReason?.();
        if (reason === 'cancelled') return null;
        return await fallback();
      }
      return result.images[0];
    } finally { active = false; }
  };
}
