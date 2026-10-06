import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

// Run through the SOLAO SSD runner: all fictional data stays on verified SSD.
assert.ok(os.tmpdir().startsWith('/Volumes/SSD Files/SOLAO/'), 'Use the SSD workspace runner');
const data = await fs.mkdtemp(path.join(os.tmpdir(), 'lbc-ux-api-'));
process.env.CAPTURE_DATA_DIR = data;
process.env.CAPTURE_DB_PATH = path.join(data, 'fictional.sqlite');
const db = await import('../src/db.js');
await db.initDatabase();
const sql = new DatabaseSync(process.env.CAPTURE_DB_PATH);
const now = new Date().toISOString();
const insert = sql.prepare(`INSERT INTO capture_items (id,line_message_id,source_type,source_id,category,status,bill_total_value,slip_amount_value,match_status,raw_event_json,created_at,updated_at) VALUES (?,?,'group','Gfictional',?,'downloaded',?,?,'unmatched','{}',?,?)`);
for (const [id, category, bill, slip] of [[1,'bill',100,null],[2,'transfer',null,100],[3,'bill',40,null],[4,'bill',60,null],[5,'transfer',null,100],[6,'bill',100,null],[7,'transfer',null,100],[8,'transfer',null,100],[9,'bill',100,null],[10,'transfer',null,100],[11,'bill',100,null],[12,'transfer',null,100],[13,'bill',100,null],[14,'transfer',null,100],[15,'transfer',null,100]]) insert.run(id, `ux-api-${id}`, category, bill, slip, now, now);
const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const child = spawn(process.execPath, ['src/server.js'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'test', ADMIN_AUTH_DISABLED: '0', ADMIN_AUTH_MODE: 'operator_only', ADMIN_OPERATOR_NAMES: '["dot"]', ADMIN_SESSION_SECRET: 'fictional-api-secret', AI_WORKER_ENABLED: 'false', AI_PROVIDER: 'mock', OPENAI_API_KEY: '', LINE_BILL_CAPTURE_CHANNEL_ACCESS_TOKEN: '', LINE_BILL_CAPTURE_CHANNEL_SECRET: 'fictional-webhook-secret', LINE_BILL_CAPTURE_SILENT_MODE: '1' },
  stdio: ['ignore','pipe','pipe']
});
let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
const base = `http://127.0.0.1:${port}`;
let cookie = '';
const post = async (route, body) => {
  const context = await fetch(base + '/api/admin/decision-contexts', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ action_key: route === 'match-groups' ? 'match_group.review' : 'match.review', entity_type: 'matches', context_snapshot: { route, request: body } }), signal: AbortSignal.timeout(5000) });
  const contextBody = await context.json(); assert.equal(context.status, 201, JSON.stringify(contextBody));
  const res = await fetch(base + '/api/admin/' + route, { method: 'POST', headers: { 'content-type': 'application/json', cookie, 'x-decision-reason-code': 'user_action', 'x-decision-id': contextBody.data.id }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) }); return { status: res.status, body: await res.json() };
};
const pair = (bill, slip, status, note, approved = false, extra = {}) => post('matches', { bill_item_id: bill, slip_item_id: slip, status, review_note: note, ai_learning_approved: approved, ...extra });
const results = [];
const check = async (name, fn) => { try { await fn(); results.push({ name, passed: true }); } catch (error) { results.push({ name, passed: false, error: error.message }); } };
try {
  let ready = false;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {} if (child.exitCode !== null) break; await new Promise(r => setTimeout(r, 100)); }
  assert.ok(ready, output);
  const auth = await fetch(base + '/api/auth/operator', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ operator: 'dot' }) });
  assert.equal(auth.status, 303); cookie = auth.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  await check('pending/confirmed/rejected/Undo explicit learning transitions', async () => {
    assert.equal((await pair(1,2,'pending','เสนอคู่')).status, 200);
    assert.equal((await db.listAiLearningExamples()).length, 0);
    assert.equal((await pair(1,2,'confirmed','เลขอ้างอิงตรง',true)).status, 200);
    assert.equal((await db.listAiLearningExamples())[0].outcome, 'confirmed');
    assert.equal((await pair(1,2,'pending','สลิปผิดร้าน',true)).status, 200);
    assert.equal((await db.listAiLearningExamples())[0].outcome, 'rejected');
    assert.equal((await pair(1,2,'rejected','คนละร้าน',true)).status, 200);
    assert.equal((await db.listAiLearningExamples())[0].outcome, 'rejected');
    assert.equal((await pair(1,2,'pending','ย้อนกลับ',false)).status, 200);
    assert.equal((await db.listAiLearningExamples()).length, 0);
    assert.equal(sql.prepare('SELECT count(*) n FROM ai_learning_examples').get().n, 1);
  });
  await check('boolean false and non-boolean false do not teach', async () => {
    for (const approved of [false, 'false', 0, '0', null]) {
      assert.equal((await pair(1,2,'confirmed','หมายเหตุไม่สอน',approved)).status, 200);
      assert.equal(sql.prepare('SELECT ai_learning_approved n FROM capture_matches WHERE bill_item_id=1 AND slip_item_id=2').get().n, 0, `approval ${JSON.stringify(approved)}`);
      assert.equal((await db.listAiLearningExamples()).length, 0);
    }
  });
  await check('group review note HTTP roundtrip in all states', async () => {
    for (const status of ['pending','confirmed','rejected']) {
      const note = `ตรวจชุดรวม ${status}`;
      const res = await post('match-groups', { bill_item_ids: [3,4], slip_item_ids: [5], status, review_note: `  ${note}  ` });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const edges = sql.prepare('SELECT review_note,ai_learning_approved,status FROM capture_matches WHERE match_group_key=?').all(res.body.data.match_group_key);
      assert.equal(edges.length, 2); assert.ok(edges.every(e => e.review_note === note && e.ai_learning_approved === 0 && e.status === status));
    }
  });
  await check('replacement suppresses stale confirmed positive and retains history', async () => {
    assert.equal((await pair(6,7,'confirmed','คู่เดิมตรวจแล้ว',true)).status, 200);
    const original = sql.prepare('SELECT id FROM capture_matches WHERE bill_item_id=6 AND slip_item_id=7').get().id;
    assert.ok((await db.listAiLearningExamples()).some(e => e.review_note === 'คู่เดิมตรวจแล้ว'));
    const replacement = await post('match-groups', { bill_item_ids: [6], slip_item_ids: [8], status: 'confirmed', review_note: 'จัดชุดใหม่', replace_existing: true });
    assert.equal(replacement.status, 200);
    assert.equal(sql.prepare('SELECT status FROM capture_matches WHERE id=?').get(original).status, 'rejected');
    assert.ok(!(await db.listAiLearningExamples()).some(e => e.review_note === 'คู่เดิมตรวจแล้ว'), 'Old positive must not be injected after replacement');
    assert.equal(sql.prepare('SELECT count(*) n FROM ai_learning_examples WHERE match_id=?').get(original).n, 1);
  });
  await check('pair replacement suppresses stale confirmed positive', async () => {
    assert.equal((await pair(13,14,'confirmed','ตรวจคู่ก่อนเปลี่ยน',true)).status, 200);
    assert.equal((await pair(13,15,'confirmed','เลือกสลิปใหม่',false,{ replace_existing: true })).status, 200);
    assert.ok(!(await db.listAiLearningExamples()).some(e => e.review_note === 'ตรวจคู่ก่อนเปลี่ยน'), 'Old pair positive must not survive replacement');
  });
  await check('concurrent same pair and group requests preserve unique edges', async () => {
    const pairs = await Promise.all([pair(9,10,'confirmed','กดซ้ำ',true), pair(9,10,'confirmed','กดซ้ำ',true)]);
    assert.ok(pairs.every(r => r.status === 200));
    assert.equal(sql.prepare('SELECT count(*) n FROM capture_matches WHERE bill_item_id=9 AND slip_item_id=10').get().n, 1);
    const groups = await Promise.all([1,2].map(() => post('match-groups', { bill_item_ids: [11], slip_item_ids: [12], status: 'confirmed', review_note: 'กดชุดซ้ำ' })));
    assert.ok(groups.every(r => r.status === 200));
    assert.equal(sql.prepare("SELECT count(*) n FROM capture_matches WHERE bill_item_id=11 AND slip_item_id=12 AND status='confirmed'").get().n, 1);
  });
  console.log(JSON.stringify({ suite: 'ux-decision-safety-api', results }, null, 2));
  if (results.some(r => !r.passed)) process.exitCode = 1;
} finally {
  if (child.exitCode === null) { const stopped = once(child,'exit'); child.kill('SIGTERM'); await stopped; }
  sql.close(); await fs.rm(data, { recursive: true, force: true });
}
