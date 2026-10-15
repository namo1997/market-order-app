import { Capacitor } from '@capacitor/core';
import { Camera } from '@capacitor/camera';
import { createImageCapture } from './camera.mjs';
export const captureImage = createImageCapture({ isNative: () => Capacitor.isNativePlatform(), camera: Camera });
