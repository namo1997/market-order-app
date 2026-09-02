import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const args = Object.fromEntries(process.argv.slice(2).map((arg, index, all) => (
  arg.startsWith('--') ? [arg.slice(2), all[index + 1]?.startsWith('--') ? '1' : all[index + 1]] : null
)).filter(Boolean));
const inputDir = path.resolve(String(args.input || ''));
const outputDir = path.resolve(String(args.output || ''));
const expected = Number(args.expected || 0);

if (!inputDir || !outputDir) {
  throw new Error('Usage: node scripts/process-line-thumbnail-captures.mjs --input DIR --output DIR [--expected N]');
}

const files = (await fs.readdir(inputDir))
  .filter((name) => /\.(?:png|jpe?g|webp)$/i.test(name))
  .sort();
if (expected && files.length !== expected) {
  throw new Error(`Capture count mismatch: expected=${expected}, actual=${files.length}`);
}

await fs.mkdir(outputDir, { recursive: true });
const manifest = [];

const contiguousRuns = (values) => {
  if (!values.length) return [];
  const runs = [];
  let start = values[0];
  let previous = values[0];
  for (const value of values.slice(1)) {
    if (value > previous + 2) {
      runs.push([start, previous]);
      start = value;
    }
    previous = value;
  }
  runs.push([start, previous]);
  return runs;
};

const closestUsefulRun = (runs, center, minimumSize) => runs
  .filter(([start, end]) => end - start + 1 >= minimumSize)
  .sort((left, right) => {
    const leftDistance = Math.abs(((left[0] + left[1]) / 2) - center);
    const rightDistance = Math.abs(((right[0] + right[1]) / 2) - center);
    return leftDistance - rightDistance;
  })[0];

const detectThumbnailBounds = async (input) => {
  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const stageLeft = Math.floor(info.width * 0.135);
  const stageRight = info.width - stageLeft;
  const stageTop = Math.floor(info.height * 0.145);
  const stageBottom = Math.floor(info.height * 0.925);
  const isContent = (x, y) => {
    const offset = ((y * info.width) + x) * info.channels;
    return Math.max(data[offset], data[offset + 1], data[offset + 2]) > 45;
  };
  const contentColumns = [];
  for (let x = stageLeft; x < stageRight; x += 1) {
    let count = 0;
    for (let y = stageTop; y < stageBottom; y += 1) if (isContent(x, y)) count += 1;
    if (count > 12) contentColumns.push(x);
  }
  const contentRows = [];
  for (let y = stageTop; y < stageBottom; y += 1) {
    let count = 0;
    for (let x = stageLeft; x < stageRight; x += 1) if (isContent(x, y)) count += 1;
    if (count > 12) contentRows.push(y);
  }
  let columnRun = closestUsefulRun(contiguousRuns(contentColumns), info.width / 2, 70);
  let rowRun = closestUsefulRun(contiguousRuns(contentRows), info.height / 2, 60);
  // Dark artwork can have blank gaps wider than ordinary receipt text. In that
  // case use the complete centered signal span and restore a small dark margin.
  if (!columnRun && contentColumns.length) {
    const signalStart = contentColumns[0];
    const signalEnd = contentColumns.at(-1);
    const margin = Math.max(12, Math.round((signalEnd - signalStart + 1) * 0.2));
    columnRun = [signalStart - margin, signalEnd + margin];
  }
  if (!rowRun && contentRows.length) {
    const signalStart = contentRows[0];
    const signalEnd = contentRows.at(-1);
    const margin = Math.max(14, Math.round((signalEnd - signalStart + 1) * 0.1));
    rowRun = [signalStart - margin, signalEnd + margin];
  }
  if (!columnRun || !rowRun) throw new Error('Could not detect the centered LINE thumbnail');
  const padding = 2;
  const left = Math.max(0, columnRun[0] - padding);
  const top = Math.max(0, rowRun[0] - padding);
  const right = Math.min(info.width - 1, columnRun[1] + padding);
  const bottom = Math.min(info.height - 1, rowRun[1] + padding);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
};

for (const name of files) {
  const input = path.join(inputDir, name);
  const metadata = await sharp(input).metadata();
  if (!metadata.width || !metadata.height) throw new Error(`Unreadable screenshot: ${name}`);

  // Detect the centered media rectangle from the black viewer stage. This avoids
  // importing LINE controls, the filmstrip, cursor, or expired-media notice.
  let bounds;
  try {
    bounds = await detectThumbnailBounds(input);
  } catch (error) {
    throw new Error(`${name}: ${error.message}`, { cause: error });
  }
  const trimmed = sharp(input).extract(bounds);
  const trimmedBuffer = await trimmed.png().toBuffer();
  const trimmedMetadata = await sharp(trimmedBuffer).metadata();
  if (!trimmedMetadata.width || !trimmedMetadata.height || trimmedMetadata.width < 80 || trimmedMetadata.height < 80) {
    throw new Error(`Recovered thumbnail is unexpectedly small: ${name}`);
  }

  const scale = Math.min(4, 1800 / trimmedMetadata.width, 2400 / trimmedMetadata.height);
  const targetWidth = Math.max(trimmedMetadata.width, Math.round(trimmedMetadata.width * scale));
  const targetHeight = Math.max(trimmedMetadata.height, Math.round(trimmedMetadata.height * scale));
  const output = path.join(outputDir, name.replace(/\.(?:png|jpe?g|webp)$/i, '.jpg'));
  await sharp(trimmedBuffer)
    .resize(targetWidth, targetHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .sharpen({ sigma: 1.1, m1: 0.7, m2: 1.6 })
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toFile(output);
  manifest.push({
    file: path.basename(output),
    source_screenshot: name,
    source_size: `${metadata.width}x${metadata.height}`,
    thumbnail_size: `${trimmedMetadata.width}x${trimmedMetadata.height}`,
    recovered_size: `${targetWidth}x${targetHeight}`,
    crop: bounds,
    quality: 'expired_line_desktop_thumbnail_upscaled'
  });
}

await fs.writeFile(
  path.join(outputDir, 'recovery-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`
);
console.log(JSON.stringify({ processed: manifest.length, output: outputDir }, null, 2));
