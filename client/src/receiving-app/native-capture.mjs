import { Capacitor } from '@capacitor/core';
import { Camera } from '@capacitor/camera';
import { createImageCapture } from './camera.mjs';
import { scanner, scanBill, getScannerFallbackReason, createScannerCapture } from './document-scanner.mjs';
const isNative = () => Capacitor.isNativePlatform();
const fallback = createImageCapture({ isNative, camera: Camera });
export const captureImage = createScannerCapture({
  isNative,
  scanner: { scanBill, get lastReason() { return getScannerFallbackReason(); } },
  fallback
});
// Multi-page consumers can opt into the adapter without changing the browser.
export { scanBill, scanner };
