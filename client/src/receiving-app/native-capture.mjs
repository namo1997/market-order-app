import { Capacitor } from '@capacitor/core';
import { Camera } from '@capacitor/camera';
import { createImageCapture } from './camera.mjs';
import { scanBill, createScannerCapture } from './document-scanner.mjs';
const isNative = () => Capacitor.isNativePlatform();
const fallback = createImageCapture({ isNative, camera: Camera });
export const captureImage = createScannerCapture({ isNative, scanner: { scanBill }, fallback });
// Multi-page consumers can opt into the adapter without changing the browser.
export { scanBill };
