// All tunable thresholds live here. Metrics refer to a <=800px, oriented image.
export const IMAGE_QUALITY = Object.freeze({
  analysisLongest: 800,
  blurVariance: 35, // Conservative: catches strongly smoothed text, not a focus guarantee.
  darkMean: 75, // Do not mistake ordinary grey paper / shadows for low light.
  whiteLevel: 250,
  glareFraction: 0.80,
  glareMaxInkFraction: 0.003, // <0.3% dark ink: calibrated against sparse white invoices/screenshots (66 bills).
  inkLevel: 100,
  faintContrast: 32,
  enhanceDarkMean: 115,
  ocrLongest: 2400,
  contrastGain: 1.08, // Monotone, color-preserving lift; never threshold text to black/white.
  darkLift: 12,
});
export const QUALITY_MESSAGES = Object.freeze({
  blur: 'ภาพไม่ชัด — ถือนิ่งๆ แล้วถ่ายใหม่',
  dark: 'แสงน้อย — เปิดไฟหรือย้ายไปที่สว่าง',
  glare: 'สว่างจ้าหรือแสงสะท้อน — เอียงบิลเล็กน้อย',
});
export function classifyQuality(metrics, limits = IMAGE_QUALITY) {
  const warnings = [];
  if (metrics.laplacianVariance < limits.blurVariance) warnings.push('blur');
  if (metrics.meanBrightness < limits.darkMean) warnings.push('dark');
  if (metrics.whiteFraction > limits.glareFraction && metrics.inkFraction < limits.glareMaxInkFraction) warnings.push('glare');
  return { ...metrics, warnings };
}
// O(pixels), one small grayscale buffer; ImageData-compatible and usable offline in Node.
export function analyzeImageData({ data, width, height }, limits = IMAGE_QUALITY) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3
    || width * height > limits.analysisLongest ** 2 || data.length !== width * height * 4) throw new Error('ขนาดภาพตรวจคุณภาพไม่ถูกต้อง');
  const gray = new Uint8Array(width * height);
  let sum = 0, squares = 0, white = 0, ink = 0;
  for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
    // Canvas is composited over white before analysis (including transparent PNGs).
    const y = (77 * data[i] + 150 * data[i + 1] + 29 * data[i + 2]) >> 8;
    gray[p] = y; sum += y; squares += y * y;
    if (Math.min(data[i], data[i + 1], data[i + 2]) >= limits.whiteLevel) white++;
    if (y < limits.inkLevel) ink++;
  }
  let lapSum = 0, lapSquares = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      const lap = gray[p - 1] + gray[p + 1] + gray[p - width] + gray[p + width] - 4 * gray[p];
      lapSum += lap; lapSquares += lap * lap;
    }
  }
  const count = gray.length, interior = (width - 2) * (height - 2), mean = sum / count;
  return classifyQuality({ meanBrightness: mean, contrast: Math.sqrt(Math.max(0, squares / count - mean * mean)),
    laplacianVariance: Math.max(0, lapSquares / interior - (lapSum / interior) ** 2),
    whiteFraction: white / count, inkFraction: ink / count }, limits);
}
export function enhancementFor(quality, limits = IMAGE_QUALITY) {
  if (!quality || quality.warnings.includes('glare')) return null;
  const dark = quality.meanBrightness < limits.enhanceDarkMean;
  if (!dark && quality.contrast >= limits.faintContrast) return null;
  return { gain: limits.contrastGain, lift: dark ? limits.darkLift : 0, pivot: dark ? 128 : 255 };
}
export function enhanceImageData(image, adjustment) {
  if (!adjustment) return image;
  const { data } = image;
  // Same monotone transform per channel, alpha untouched; no hard clipping of highlights.
  const lut = Uint8Array.from({ length: 256 }, (_, value) => {
    // Faint ink on white paper needs a white pivot so grey ink becomes darker.
    const adjusted = (value - adjustment.pivot) * adjustment.gain + adjustment.pivot + adjustment.lift;
    const weight = Math.min(value / 32, (255 - value) / 32, 1);
    return Math.round(value + (adjusted - value) * weight);
  });
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]]; data[i + 1] = lut[data[i + 1]]; data[i + 2] = lut[data[i + 2]];
  }
  return image;
}
