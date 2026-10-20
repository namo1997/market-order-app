import test from 'node:test';
import assert from 'node:assert/strict';
import * as ocrService from '../src/services/receiving-ocr.service.js';
import { makePngDataUrl, makeJpegDataUrl } from './helpers/receiving-fake-db.mjs';

test("Bill JPEG magic bytes provide real dimensions", async () => {
  const validJpeg = makeJpegDataUrl(800, 600);
  const parsedJpeg = ocrService.parseImageDataUrl(validJpeg);
  assert.equal(parsedJpeg.mimeType, 'image/jpeg');
  assert.equal(parsedJpeg.width, 800);
  assert.equal(parsedJpeg.height, 600);
});

test("Bill images reject signature PNG", async () => {
  const validPng = makePngDataUrl(300, 120);
  assert.throws(
    () => ocrService.parseImageDataUrl(validPng),
    (err) => err.code === 'VALIDATION_FAILED' && err.statusCode === 422
  );
});

test("Signature images accept PNG", async () => {
  const validPng = makePngDataUrl(300, 120);
  const parsedSig = ocrService.parseImageDataUrl(validPng, { allowedMimes: ['image/png'] });
  assert.equal(parsedSig.mimeType, 'image/png');
});

test("Bill images reject payloads larger than 3 MB", async () => {
  const oversizedJpeg = makeJpegDataUrl(10, 10, 3 * 1024 * 1024 + 500);
  assert.throws(
    () => ocrService.parseImageDataUrl(oversizedJpeg),
    (err) => err.code === 'IMAGE_TOO_LARGE' && err.statusCode === 413
  );
});
