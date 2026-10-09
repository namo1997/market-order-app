// พรีวิวโต๊ะเทียบบน SSD snapshot เท่านั้น: สำเนา SQLite แบบ consistent + รูปเดิม ไม่มี AI/LINE จริง
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';
import { storage } from './ssd-storage.mjs';

assert.equal(process.env.SOLAO_LOCAL_SIMULATION, '1', 'ใช้ ssd-workspace.mjs run ก่อนเปิดพรีวิว');
storage.assertSSD();
const input = storage.assertSSDPath(process.argv[2]);
const out = storage.assertSSDPath(process.env.SOLAO_TEST_OUTPUT_DIR);
const data = await fs.mkdtemp(path.join(out, 'desk-data-'));
const dbPath = path.join(data, 'working.sqlite');
const original = new DatabaseSync(path.join(input, 'line-bill-capture.sqlite'), { readOnly: true });
try { await backup(original, dbPath); } finally { original.close(); }
await fs.cp(path.join(input, 'images'), path.join(data, 'images'), { recursive: true });
const copy = new DatabaseSync(dbPath);
try {
  const update = copy.prepare('UPDATE capture_items SET storage_path=? WHERE id=?');
  for (const item of copy.prepare('SELECT id,storage_relative_path FROM capture_items WHERE storage_relative_path IS NOT NULL').all()) {
    const target = path.resolve(data, 'images', item.storage_relative_path);
    assert.ok(target.startsWith(path.join(data, 'images') + path.sep));
    update.run(target, item.id);
  }
} finally { copy.close(); }
const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const log = await fs.open(path.join(out, 'desk-server.log'), 'wx', 0o600);
const child = spawn(process.execPath, ['src/server.js'], { cwd: process.cwd(), env: {
  ...process.env, HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'test',
  CAPTURE_DATA_DIR: data, CAPTURE_DB_PATH: dbPath, ADMIN_AUTH_DISABLED: '1',
  AI_WORKER_ENABLED: 'false', AI_PROVIDER: 'mock', OPENAI_API_KEY: '', GEMINI_API_KEY: '',
  LINE_BILL_CAPTURE_CHANNEL_SECRET: '', LINE_BILL_CAPTURE_CHANNEL_ACCESS_TOKEN: '',
  LINE_BILL_CAPTURE_ACCOUNTING_EXPORT_TOKEN: '', LINE_BILL_CAPTURE_PUSH_MOCK: '1',
  LINE_BILL_CAPTURE_SILENT_MODE: '1',
}, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', b => log.write(b)); child.stderr.on('data', b => log.write(b));
const base = `http://127.0.0.1:${port}`;
let ready = false;
for (let i = 0; i < 300; i++) {
  try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
  if (child.exitCode !== null) break;
  await new Promise(resolve => setTimeout(resolve, 100));
}
assert.ok(ready, 'ดู desk-server.log บน SSD');
const url = base + '/admin?view=day&date=2026-10-02&group=C987d13b96371f18f5a0996107d4f6ef5&bucket=review';
await fs.writeFile(path.join(out, 'desk-preview.json'), JSON.stringify({ base_url: base, admin_url: url,
  working_db: dbPath, source: process.cwd(), ai_worker: false, mock_line: true }, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ admin_url: url, report: path.join(out, 'desk-preview.json') }));
process.on('SIGTERM', () => child.kill('SIGTERM')); process.on('SIGINT', () => child.kill('SIGTERM'));
if (child.exitCode === null) await once(child, 'exit');
await log.close();
