import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';

// ระยะ 3: สถานะข้อมูลค่าใช้จ่าย (อ่านอย่างเดียว) — ข้อมูลสมมติบน SSD runner เท่านั้น
assert.ok(process.env.SOLAO_LOCAL_SIMULATION === '1' && os.tmpdir().startsWith('/Volumes/SSD Files/SOLAO/'), 'Use the SOLAO SSD runner');
const root = path.resolve(import.meta.dirname, '..');
const data = await fs.mkdtemp(path.join(os.tmpdir(), 'expense-status-'));
process.env.CAPTURE_DATA_DIR = data;
process.env.CAPTURE_DB_PATH = path.join(data, 'fictional.sqlite');
const db = await import('../src/db.js');
await db.initDatabase();
const sql = new DatabaseSync(process.env.CAPTURE_DB_PATH);
const now = '2026-10-06T03:00:00.000Z', stamp = Date.parse(now), DAY = 86400000;
const insert = sql.prepare(`INSERT INTO capture_items
  (id,line_message_id,source_type,source_id,category,status,vendor_name,supplier_name,bill_total_value,slip_amount_value,match_status,ai_status,ai_result_json,event_timestamp_ms,raw_event_json,created_at,updated_at)
  VALUES(?,?,'group',?,?,?,'หัวบิลสมมติ',?,?,?,'unmatched','done','{}',?,'{}',?,?)`);
// id, group, category, status, dayOffset
const rows = [[1,'GA','bill','downloaded',0],[2,'GA','transfer','downloaded',0],[3,'GA','bill','downloaded',0],[4,'GA','transfer_notice','downloaded',0],
  [5,'GB','bill','downloaded',0],[6,'GA','other','downloaded',0],[7,'GA','bill','unsent',0],[8,'GA','bill','downloaded',0],[9,'GA','bill_page','downloaded',0],
  [10,'GA','incoming_transfer','downloaded',0],[11,'GA','bill','downloaded',1],[12,'GA','pending','downloaded',0],[13,'GA','payment_voucher','downloaded',0],[14,'GA','other','downloaded',0],
  [15,'GA','bill','downloaded',3]];
for (const [id, group, category, status, day] of rows) insert.run(id, `img-${id}`, group, category, status, `ร้านสมมติ ${id}`, 100 + id, 200 + id, stamp + day * DAY, now, now);
sql.prepare("UPDATE capture_items SET status='duplicate',duplicate_of_item_id=1 WHERE id=8").run();
const field = (value, source = 'manual') => ({ value, source, evidence: [] });
const empty = { supplier_name: field(null), purpose: field(null), transaction_type: field(null) };
const save = (id, fields, status, revision = 0) => db.updateExpenseProfile({ id, input: { expected_revision: revision, status, fields: { ...empty, ...fields }, reason: 'ตรวจจำลอง' }, actor: 'fictional' });
assert.equal((await save(1, { transaction_type: field('purchase'), supplier_name: field('ร้านสมมติ'), purpose: field('ซื้อของสมมติ') }, 'reviewed')).status, 'reviewed');
assert.equal((await save(2, { notes: field('ร่าง') }, 'draft')).status, 'draft');
assert.equal((await save(13, {}, 'draft')).status, 'draft');
assert.equal((await save(15, { transaction_type: field('purchase'), supplier_name: field('ร้านสมมติ'), purpose: field('ซื้อ') }, 'reviewed')).status, 'reviewed');
// รูป "อื่น ๆ" ที่มีร่างอยู่ ต้องไม่ถูกนับ
assert.equal((await save(6, {}, 'draft')).status, 'draft');
sql.prepare(`INSERT INTO capture_expense_profiles (item_id,revision,status,fields_json,updated_by,updated_at) VALUES(?,?,?,?,?,?)`).run(8, 1, 'draft', '{}', 'fictional', now);
const profileCount = () => sql.prepare('SELECT COUNT(*) AS n FROM capture_expense_profiles').get().n;
const revisionCount = () => sql.prepare('SELECT COUNT(*) AS n FROM capture_expense_profile_revisions').get().n;
const financial = () => JSON.stringify(['capture_items', 'capture_matches', 'capture_cash_payments', 'capture_daily_closings'].map(name => sql.prepare(`SELECT * FROM ${name} ORDER BY 1`).all()));
const baseline = { profiles: profileCount(), revisions: revisionCount(), financial: financial() };

const results = [];
const check = async (name, fn) => { await fn(); results.push({ name, passed: true }); };
const day = '2026-10-06';

await check('batch status: เฉพาะบิล/สลิปที่นับได้ และไม่สร้างแถว', async () => {
  const all = await db.getExpenseStatusBatch([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14]);
  assert.deepEqual(Object.fromEntries(Object.entries(all.items).map(([id, v]) => [id, v.status])), { 1: 'reviewed', 2: 'draft', 3: 'none', 4: 'none', 5: 'none', 13: 'draft' });
  assert.equal(profileCount(), baseline.profiles); assert.equal(revisionCount(), baseline.revisions);
  assert.equal((await db.getExpenseStatusBatch([])).error, 'ids_invalid');
  assert.equal((await db.getExpenseStatusBatch([1, -2])).error, 'ids_invalid');
  assert.equal((await db.getExpenseStatusBatch(Array.from({ length: 1001 }, (_, i) => i + 1))).error, 'ids_invalid');
});
await check('summary: นับบิลและสลิปแยกสถานะ ตัด other/ยกเลิก/ซ้ำ/หน้าประกอบ/โอนเข้า/รอ AI', async () => {
  const result = await db.getExpenseStatusSummary({ start: day, end: day });
  // GA: บิล 1(reviewed) 3(none) 13(draft); สลิป 2(draft) 4(none); GB: บิล 5(none)
  assert.deepEqual(result.totals.bill, { none: 2, draft: 1, reviewed: 1, total: 4 });
  assert.deepEqual(result.totals.slip, { none: 1, draft: 1, reviewed: 0, total: 2 });
  const ids = result.items.map(x => x.id).sort((a, b) => a - b);
  assert.deepEqual(ids, [1, 2, 3, 4, 5, 13]);
  for (const excluded of [6, 7, 8, 9, 10, 12, 14]) assert.ok(!ids.includes(excluded), `item ${excluded} must not count`);
  assert.equal(result.days.length, 2);
});
await check('summary: ช่วงวัน กลุ่ม และขอบเขตวันที่ Bangkok', async () => {
  const range = await db.getExpenseStatusSummary({ start: '2026-10-06', end: '2026-10-10' });
  assert.deepEqual(range.totals.bill, { none: 3, draft: 1, reviewed: 2, total: 6 });
  assert.deepEqual(range.days.map(d => d.date), ['2026-10-09', '2026-10-07', '2026-10-06', '2026-10-06']);
  const onlyB = await db.getExpenseStatusSummary({ start: '2026-10-06', end: '2026-10-10', sourceId: 'GB' });
  assert.equal(onlyB.totals.bill.total, 1); assert.equal(onlyB.totals.slip.total, 0);
  const late = await db.getExpenseStatusSummary({ start: '2026-10-08', end: '2026-10-08' });
  assert.equal(late.totals.bill.total + late.totals.slip.total, 0);
  for (const bad of [{ start: '2026-10-10', end: '2026-10-06' }, { start: 'x', end: day }, { start: '2026-02-30', end: day }, { start: '2024-01-01', end: '2026-10-06' }]) {
    assert.ok((await db.getExpenseStatusSummary(bad)).error, JSON.stringify(bad));
  }
});
await check('การอ่านสถานะไม่สร้าง profile และไม่แตะยอด คู่ เงินสด หรือปิดรอบ', async () => {
  await db.getExpenseStatusSummary({ start: day, end: day }); await db.getExpenseStatusBatch([1, 2, 3]);
  assert.equal(profileCount(), baseline.profiles); assert.equal(revisionCount(), baseline.revisions);
  assert.equal(financial(), baseline.financial);
});
await check('สถานะไม่ผูกกับตรรกะปิดรอบ/จับคู่ (static)', async () => {
  const [indexHtml, statusJs] = await Promise.all(['public/index.html', 'public/expense-status.js'].map(f => fs.readFile(path.join(root, f), 'utf8')));
  // เงื่อนไขปิดรอบ/คิวต้องไม่อ้างสถานะค่าใช้จ่าย
  for (const name of ['dayWorkCount', 'outstandingItem']) {
    const line = indexHtml.split('\n').find(l => l.includes(`${name}=`) && !l.includes('expenseStatus'));
    assert.ok(line && !/expense/i.test(line), `${name} must not use expense status`);
  }
  assert.ok(!/expense/i.test(indexHtml.split('\n').find(l => l.startsWith('const bucketRows='))), 'bucketRows unchanged');
  assert.ok(indexHtml.includes('window.expenseStatusFilterRows?window.expenseStatusFilterRows(bucketRows(S.bucket),S.bucket)'));
  assert.ok(!/outstandingItem\s*=|dayWorkCount\s*=/.test(statusJs), 'expense-status.js must not redefine close-day logic');
  const labels = ['ยังไม่กรอก', 'ร่าง', 'ตรวจแล้ว', 'ไม่ใช่การอนุมัติจ่ายหรือลงบัญชี'];
  for (const label of labels) assert.ok(statusJs.includes(label), label);
  assert.ok(!/[✓✔]/.test(statusJs), 'ตรวจแล้วต้องไม่ใช้เครื่องหมายถูกที่ดูเหมือนอนุมัติ');
});

// ---------- HTTP: ต้องผ่าน auth ----------
const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
sql.close(); await db.closeDatabase?.();
const child = spawn(process.execPath, ['src/server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'test',
  ADMIN_AUTH_DISABLED: '0', ADMIN_AUTH_MODE: 'operator_only', ADMIN_OPERATOR_NAMES: '["dot"]', ADMIN_SESSION_SECRET: 'fictional-status-secret',
  AI_WORKER_ENABLED: 'false', AI_PROVIDER: 'mock', OPENAI_API_KEY: '', LINE_BILL_CAPTURE_CHANNEL_ACCESS_TOKEN: '', LINE_BILL_CAPTURE_CHANNEL_SECRET: 'fictional',
  LINE_BILL_CAPTURE_PUSH_MOCK: '1', LINE_BILL_CAPTURE_SILENT_MODE: '1' } });
let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
const base = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {} if (child.exitCode !== null) break; await new Promise(r => setTimeout(r, 100)); }
  assert.ok(ready, output);
  await check('HTTP: ไม่มี auth ถูกปฏิเสธ; มี auth อ่านได้และไม่สร้างแถว', async () => {
    assert.equal((await fetch(`${base}/api/admin/expense-status/items?ids=1`)).status, 401);
    assert.equal((await fetch(`${base}/api/admin/expense-status/summary?start=${day}&end=${day}`)).status, 401);
    const login = await fetch(base + '/api/auth/operator', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ operator: 'dot' }) });
    const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const get = async route => { const r = await fetch(base + route, { headers: { cookie } }); return { status: r.status, body: await r.json() }; };
    const items = await get('/api/admin/expense-status/items?ids=1,2,3,6');
    assert.equal(items.status, 200); assert.deepEqual(Object.keys(items.body.data).sort(), ['1', '2', '3']);
    assert.equal(items.body.data[1].status, 'reviewed');
    assert.equal((await get('/api/admin/expense-status/items?ids=1,abc')).status, 400);
    assert.equal((await get('/api/admin/expense-status/items')).status, 400);
    const summary = await get(`/api/admin/expense-status/summary?start=${day}&end=${day}&source_id=GA`);
    assert.equal(summary.status, 200); assert.equal(summary.body.data.totals.bill.total, 3);
    assert.equal((await get('/api/admin/expense-status/summary?start=bad&end=bad')).status, 400);
    const check = new DatabaseSync(process.env.CAPTURE_DB_PATH);
    assert.equal(check.prepare('SELECT COUNT(*) AS n FROM capture_expense_profiles').get().n, baseline.profiles);
    assert.equal(check.prepare('SELECT COUNT(*) AS n FROM capture_expense_profile_revisions').get().n, baseline.revisions);
    check.close();
  });
} finally { child.kill('SIGTERM'); }
console.log(JSON.stringify({ passed: results.length, results }, null, 2));
process.exit(0);
