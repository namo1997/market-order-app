import test from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_QUALITY as Q, analyzeImageData, classifyQuality, enhancementFor, enhanceImageData } from '../src/pages/receiving/image-quality.js';
import { compressImage, MAX_IMAGE_BYTES } from '../src/pages/receiving/image-utils.js';
import { harness } from './receiving-harness.mjs';

const pixels = (width, height, value) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, color = value(x, y);
    data[i] = data[i + 1] = data[i + 2] = color; data[i + 3] = 255;
  }
  return { data, width, height };
};
const receipt = () => pixels(600, 800, (x, y) => y % 24 < 3 && x > 35 && x < 550 && x % 12 < 8 ? 25 : 230);
const dark = () => pixels(600, 800, (x, y) => x % 20 < 3 && y % 24 < 12 ? 5 : 45);
const metrics = { laplacianVariance: Q.blurVariance, meanBrightness: Q.darkMean, whiteFraction: Q.glareFraction, inkFraction: Q.glareMaxInkFraction, contrast: 60 };
test('quality: sharp synthetic receipt is not warned, flat/smoothed image is blurred', () => {
  const sharp = analyzeImageData(receipt());
  assert.deepEqual(sharp.warnings, []);
  const smooth = analyzeImageData(pixels(600, 800, (x) => 180 + Math.round(10 * Math.sin(x / 60))));
  assert.ok(smooth.warnings.includes('blur'));
  assert.ok(sharp.laplacianVariance > smooth.laplacianVariance * 100);
});
test('quality: low light, clipped white and normal white paper are distinct', () => {
  assert.ok(analyzeImageData(dark()).warnings.includes('dark'));
  assert.ok(analyzeImageData(pixels(600, 800, () => 255)).warnings.includes('glare'));
  const paper = pixels(600, 800, (x, y) => y % 24 < 3 && x > 35 && x < 550 ? 25 : 255);
  assert.ok(!analyzeImageData(paper).warnings.includes('glare'));
});
test('quality: thresholds are conservative and strict at boundaries', () => {
  assert.deepEqual(classifyQuality(metrics).warnings, []);
  assert.deepEqual(classifyQuality({ ...metrics, laplacianVariance: Q.blurVariance - .01 }).warnings, ['blur']);
  assert.deepEqual(classifyQuality({ ...metrics, meanBrightness: Q.darkMean - .01 }).warnings, ['dark']);
  assert.deepEqual(classifyQuality({ ...metrics, whiteFraction: .99, inkFraction: 0 }).warnings, ['glare']);
  assert.deepEqual(classifyQuality({ ...metrics, whiteFraction: .99, inkFraction: .005 }).warnings, []);
  assert.deepEqual(classifyQuality(metrics, { ...Q, blurVariance: 40 }).warnings, ['blur']);
});
test('quality: bounded analysis rejects oversized/invalid ImageData and is deterministic', () => {
  assert.throws(() => analyzeImageData({ data: [], width: 801, height: 800 }));
  assert.throws(() => analyzeImageData({ data: [], width: 0, height: 0 }));
  assert.throws(() => analyzeImageData({ data: [], width: 10, height: 10 }));
  assert.deepEqual(analyzeImageData(receipt()), analyzeImageData(receipt()));
});
test('quality: enhancement only for dark/faint, no thresholding or loss of number shades', () => {
  assert.equal(enhancementFor(analyzeImageData(receipt())), null);
  assert.equal(enhancementFor(analyzeImageData(pixels(10, 10, () => 255))), null);
  const input = pixels(256, 3, x => x);
  const adjustment = enhancementFor(analyzeImageData(dark()));
  assert.ok(adjustment);
  const output = enhanceImageData(input, adjustment).data;
  assert.equal(output[0], 0); assert.equal(output[255 * 4], 255);
  for (let x = 1; x < 256; x++) assert.ok(output[x * 4] >= output[(x - 1) * 4]);
  for (let i = 3; i < output.length; i += 4) assert.equal(output[i], 255);
  assert.ok(new Set(Array.from({ length: 256 }, (_, x) => output[x * 4])).size > 230);
  const faint = enhancementFor({ ...metrics, meanBrightness: 230, contrast: 20, warnings: [] });
  assert.ok(faint);
  const faded = enhanceImageData(pixels(3, 3, () => 180), faint);
  assert.ok(faded.data[0] < 180, 'faint grey ink gets darker against white paper');
  assert.equal(enhanceImageData(pixels(3, 3, () => 255), faint).data[0], 255);
});
function environment(t, { fallback = false, readbackFails = false } = {}) {
  const previous = new Map();
  const replace = (name, value) => { previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value, writable: true }); };
  t.after(() => previous.forEach((descriptor, key) => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]));
  const calls = { orientation: [], encoded: [], drawn: [], closed: 0, adjusted: 0 };
  replace('createImageBitmap', async (_file, options) => { calls.orientation.push(options); if (fallback) throw Error('unsupported'); return { width: 3000, height: 4000, close() { calls.closed++; } }; });
  replace('Image', class { naturalWidth = 3000; naturalHeight = 4000; set src(_value) { this.onload(); } });
  replace('document', { createElement: () => {
    const canvas = { getContext: () => ({ fillRect() {}, drawImage(...args) { calls.drawn.push(args.slice(1)); }, getImageData() { if (readbackFails) throw Error('readback'); return dark(); }, putImageData() { calls.adjusted++; } }),
      toBlob(done, type, quality) { calls.encoded.push([canvas.width, canvas.height, quality]); done(new Blob(['jpeg'], { type })); } };
    return canvas;
  } });
  replace('FileReader', class { readAsDataURL() { this.result = 'data:image/jpeg;base64,anBlZw=='; this.onload(); } });
  return calls;
}
const jpeg = () => new Blob([new Uint8Array([255, 216, 255])], { type: 'image/jpeg' });
test('quality: EXIF-aware bitmap path analyzes oriented 600x800 before 1800x2400 JPEG; retains original', async t => {
  const calls = environment(t), file = jpeg(), result = await compressImage(file);
  assert.deepEqual(calls.orientation, [{ imageOrientation: 'from-image' }]);
  assert.deepEqual(calls.drawn[0], [0, 0, 600, 800]);
  assert.deepEqual(calls.encoded, [[1800, 2400, .86]]);
  assert.equal(calls.closed, 1); assert.equal(calls.adjusted, 1);
  assert.equal(result.originalBlob, file); assert.ok(result.enhanced);
  assert.ok(result.quality.warnings.includes('dark')); assert.ok(result.blob.size <= MAX_IMAGE_BYTES);
});
test('quality: native img fallback uses EXIF-oriented natural size and cleans up', async t => {
  const calls = environment(t, { fallback: true });
  const result = await compressImage(jpeg());
  assert.deepEqual(calls.drawn[0], [0, 0, 600, 800]);
  assert.deepEqual(calls.encoded[0], [1800, 2400, .86]); assert.ok(result.quality);
});
test('quality: unavailable analysis never falsely labels an image clear and does not block upload', async t => {
  environment(t, { readbackFails: true });
  const result = await compressImage(jpeg());
  assert.equal(result.quality, null); assert.equal(result.enhanced, false); assert.ok(result.dataUrl);
});
async function imageUI({ busy = false, count = 1 } = {}) {
  const quality = analyzeImageData(dark());
  const props = { doc: { status: 'draft', images: [] }, pending: Array.from({ length: count }, (_, i) => ({ key: `page-${i}`, dataUrl: 'data:image/jpeg;base64,c3ludGhldGlj', blob: jpeg(), quality })), busy,
    setProcessing() {}, inputRef: { current: null } };
  props.setPending = next => { props.pending = typeof next === 'function' ? next(props.pending) : next; };
  const h = await harness('ImagePages', props);
  return { h, props };
}
test('quality UI: warning count precedes reading, Thai advice, retake primary and use secondary', async () => {
  const { h, props } = await imageUI({ count: 2 });
  assert.match(h.text(h.all()), /มีคำเตือนภาพ 2 หน้า/);
  await h.click('ตรวจภาพหน้านี้');
  assert.match(h.text(h.visible()), /แสงน้อย.*เปิดไฟ/);
  const retake = h.find(n => n.type === 'button' && h.text(n) === 'ถ่ายใหม่');
  assert.match(retake.props.className, /sg-primary/);
  assert.doesNotMatch(h.find(n => n.type === 'button' && h.text(n) === 'ใช้ภาพนี้').props.className, /sg-primary/);
  await h.click('ใช้ภาพนี้'); assert.equal(props.pending[0].qualityAccepted, true);
  await h.click('ใช้ภาพนี้'); assert.equal(props.pending[1].qualityAccepted, true);
  assert.equal(h.all().filter(n => n.type === 'dialog').length, 0);
  assert.match(h.text(h.all()), /มีคำเตือนภาพ 2 หน้า/); // Acknowledgement does not erase risk.
  assert.equal(props.pending.length, 2); h.unmount();
});
test('quality UI: retake replaces selected slot, cancellation keeps original, page order preserved', async () => {
  const { h, props } = await imageUI({ count: 2 });
  await h.click('ตรวจภาพหน้านี้'); await h.click('ถ่ายใหม่');
  const picker = () => h.find(n => n.type === 'input' && n.props['aria-label'] === 'ถ่ายบิลใหม่แทนหน้าเดิม');
  await picker().props.onChange({ target: { files: [], value: '' } }); await h.settle();
  assert.equal(props.pending[0].key, 'page-0');
  assert.equal(h.all().filter(n => n.type === 'dialog').length, 1);
  await h.click('ถ่ายใหม่');
  await picker().props.onChange({ target: { files: [jpeg()], value: '' } }); await h.settle();
  assert.equal(props.pending.length, 2); assert.equal(props.pending[1].key, 'page-1');
  assert.notEqual(props.pending[0].key, 'page-0'); h.unmount();
});
test('quality UI: assigned page cannot be retaken; busy controls locked; unchecked remains honest', async () => {
  const { h, props } = await imageUI({ busy: true });
  assert.ok(h.find(n => n.type === 'button' && h.text(n) === 'ตรวจภาพหน้านี้').props.disabled);
  props.busy = false; props.pending[0].pageNo = 1; await h.settle();
  assert.equal(h.all().filter(n => n.type === 'button' && h.text(n) === 'ตรวจภาพหน้านี้').length, 0);
  props.pending[0].quality = null; await h.settle();
  assert.match(h.text(h.all()), /ยังไม่ตรวจ/); assert.doesNotMatch(h.text(h.all()), /✓ ชัด/); h.unmount();
});
test('quality UI: newly selected dark photo opens warning before any upload, invalid retake retains original', async () => {
  const props = { doc: { id: 7, status: 'draft', images: [] }, pending: [], busy: false, setProcessing() {}, inputRef: { current: null } };
  props.setPending = next => { props.pending = typeof next === 'function' ? next(props.pending) : next; };
  const h = await harness('ImagePages', props, {}, {}, {}, { document: {
    createElement: () => ({ getContext: () => ({ fillRect() {}, drawImage() {}, getImageData: dark, putImageData() {} }), toBlob: done => done(jpeg()) }),
  }, createImageBitmap: async () => ({ width: 600, height: 800, close() {} }) });
  await h.find(n => n.type === 'input' && n.props['aria-label'] === 'รูปบิล').props.onChange({ target: { files: [jpeg()], value: '' } }); await h.settle();
  assert.equal(h.all().filter(n => n.type === 'dialog').length, 1);
  assert.match(h.text(h.visible()), /แสงน้อย/); assert.equal(props.pending.length, 1); assert.deepEqual(h.calls, []);
  const original = props.pending[0];
  await h.click('ถ่ายใหม่');
  await h.find(n => n.type === 'input' && n.props['aria-label'] === 'ถ่ายบิลใหม่แทนหน้าเดิม').props.onChange({ target: { files: [new Blob(['fake'], { type: 'image/jpeg' })], value: '' } }); await h.settle();
  assert.equal(props.pending[0], original);
  await h.click('ใช้ภาพนี้'); assert.equal(props.pending[0].qualityAccepted, true); h.unmount();
});
