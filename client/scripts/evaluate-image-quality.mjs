// Offline calibration: node scripts/evaluate-image-quality.mjs <existing sharp entry> <SSD report directory> <image directories...>
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { analyzeImageData, IMAGE_QUALITY } from '../src/pages/receiving/image-quality.js';
const [sharpEntry, output, ...folders] = process.argv.slice(2);
if (!output?.startsWith('/Volumes/SSD Files/SOLAO/') || !folders.length) throw Error('Supply SSD output and image directories');
const { default: sharp } = await import(pathToFileURL(sharpEntry));
const results = [];
for (const folder of folders) for (const name of (await fs.readdir(folder)).sort()) {
  if (!/\.(jpe?g|png|webp)$/i.test(name)) continue;
  const file = path.join(folder, name);
  const { data, info } = await sharp(file).rotate().resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // Warm once; record median and max of 7 offline runs of the actual production metric.
  const image = { data, width: info.width, height: info.height };
  const metrics = analyzeImageData(image), times = [];
  for (let i = 0; i < 7; i++) { const start = performance.now(); analyzeImageData(image); times.push(performance.now() - start); }
  times.sort((a,b) => a-b);
  results.push({ file, width: info.width, height: info.height, ...metrics, medianMs: times[3], maxMs: times[6] });
}
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, 'real-image-quality.json'), JSON.stringify({ thresholds: IMAGE_QUALITY, note: 'Node CPU timing only; sharp resampling differs from browser canvas. No OCR/provider called.', results }, null, 2));
await fs.writeFile(path.join(output, 'real-image-quality.md'), '| ภาพ | mean | Laplacian variance | white % | ink % | คำเตือน | median ms |\n|---|---:|---:|---:|---:|---|---:|\n' + results.map(r => `| ${path.basename(r.file)} | ${r.meanBrightness.toFixed(1)} | ${r.laplacianVariance.toFixed(1)} | ${(r.whiteFraction*100).toFixed(1)} | ${(r.inkFraction*100).toFixed(1)} | ${r.warnings.join(', ') || '—'} | ${r.medianMs.toFixed(2)} |`).join('\n') + '\n');
console.log(JSON.stringify({ count: results.length, warned: results.filter(r => r.warnings.length).map(r => ({ file: path.basename(r.file), warnings: r.warnings })), maxMs: Math.max(...results.map(r => r.maxMs)) }));
