import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(rootDir, '.local-preview', 'data');
const dbPath = path.join(dataDir, 'line-bill-capture.sqlite');

if (!fs.existsSync(dbPath)) {
  console.error('Local preview data is missing. Run: npm run preview:sync');
  process.exit(1);
}

process.env.PORT = process.env.PREVIEW_PORT || '8010';
process.env.HOST = '127.0.0.1';
// The preview is loopback-only, so it stays one-click even though production admin is gated.
process.env.ADMIN_AUTH_DISABLED = '1';
process.env.CAPTURE_DATA_DIR = dataDir;
process.env.AI_WORKER_ENABLED = process.env.PREVIEW_AI_ENABLED === '1'
  ? (process.env.AI_WORKER_ENABLED || 'true')
  : 'false';
process.env.SHADOW_AI_DISABLED = process.env.PREVIEW_AI_ENABLED === '1' ? '0' : '1';
process.env.LINE_BILL_CAPTURE_CHANNEL_SECRET = '';
process.env.LINE_BILL_CAPTURE_CHANNEL_ACCESS_TOKEN = '';
process.env.LINE_BILL_CAPTURE_PUSH_MOCK = '1';
process.env.AI_MATCH_SOURCE_FALLBACKS = JSON.stringify({
  C987d13b96371f18f5a0996107d4f6ef5: ['C92c8a7b4a5099db619f6464e10eefab5']
});

console.log(`Local Bill Capture copy: http://localhost:${process.env.PORT}/admin`);
console.log(`Local Bill Capture mobile: http://localhost:${process.env.PORT}/m/`);
console.log(`Local Bill Capture mobile V2: http://localhost:${process.env.PORT}/m2/`);
console.log(`Local Bill Capture mobile V3: http://localhost:${process.env.PORT}/m3/`);
await import('../src/server.js');
