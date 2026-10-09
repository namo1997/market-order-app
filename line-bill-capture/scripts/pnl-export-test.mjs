import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { addPnlExportFields } from '../src/pnl-export.js';

assert.ok(process.env.SOLAO_LOCAL_SIMULATION === '1' && os.tmpdir().startsWith('/Volumes/SSD Files/SOLAO/'), 'Use SSD snapshot runner');
process.env.CAPTURE_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'pnl-export-'));
process.env.CAPTURE_DB_PATH = path.join(process.env.CAPTURE_DATA_DIR, 'fictional.sqlite');
const api = await import('../src/db.js');
await api.initDatabase();
const sql = new DatabaseSync(process.env.CAPTURE_DB_PATH);
sql.exec('PRAGMA busy_timeout=5000');
const date = '2026-10-01', source = 'PNL-FICTIONAL', now = '2026-10-01T05:00:00.000Z';
const insert = sql.prepare(`INSERT INTO capture_items
  (id,line_message_id,source_type,source_id,category,status,ai_status,raw_event_json,event_timestamp_ms,created_at,updated_at)
  VALUES(?,?,'group',?,?,'downloaded','done','{}',?,?,?)`);
for (const id of [10,11,12,20,21,30,31]) insert.run(id, `fictional-${id}`, source, id % 10 === 0 ? 'bill' : 'transfer', Date.parse(now), now, now);
const save = (id, revision, updated, purpose) => sql.prepare(`INSERT INTO capture_expense_profiles
  (item_id,revision,status,fields_json,updated_by,updated_at) VALUES(?,?,'draft',?,'fictional',?)
  ON CONFLICT(item_id) DO UPDATE SET revision=excluded.revision,fields_json=excluded.fields_json,updated_at=excluded.updated_at`)
  .run(id, revision, JSON.stringify({
    purpose: { value: purpose, source: 'manual', evidence: [{ item_id: id }] },
    transaction_type: { value: 'purchase', source: 'manual', evidence: [] },
    recipient_account_masked: { value: '••••0000', source: 'manual', evidence: [] },
    private_field: { value: 'DO_NOT_EXPORT', source: 'manual', evidence: [] }
  }), updated);
save(10, 1, now, 'บิลชนะสลิป'); save(11, 1, now, 'สลิปสำรอง'); save(12, 1, now, 'สลิปที่สอง'); save(21, 1, now, 'ใช้ profile สลิป');
const transactions = [
  { bill_members: [{ bill_id: 10, bill_total_value: 100, vendor_name: 'ร้านสมมติ A' }], slip_members: [{ slip_id: 11 }, { slip_id: 12 }], payment_method: 'bank_transfer' },
  { bill_members: [{ bill_id: 20, bill_total_value: 200, vendor_name: 'ร้านสมมติ B' }], slip_members: [{ slip_id: 21 }], payment_method: 'bank_transfer' },
  { bill_members: [{ bill_id: 30, bill_total_value: 300, vendor_name: 'ร้านสมมติ C' }], slip_members: [{ slip_id: 31 }], payment_method: 'bank_transfer' }
];
const summary = { snapshot_version: 5, recipient_export_version: 1, transactions, reimbursements: [], incoming_transfers: [] };
sql.prepare(`INSERT INTO capture_daily_closings
  (business_date,source_type,source_id,status,summary_json,closed_by,closed_at,created_at,updated_at)
  VALUES(?,'group',?,'closed',?,'fictional',?,?,?)`).run(date, source, JSON.stringify(summary), now, now, now);
// Verify preservation of arbitrary old keys/values as well as the HTTP contract.
const legacy = { id: 'legacy-index', bill_id: 10, raw_transaction: transactions[0], recipients_by_slip: [], untouched: { nested: true } };
const { profiles } = await api.getPnlExportProfiles({ transactions });
const enhanced = addPnlExportFields({ items: [legacy], transactions, snapshot: summary, profiles }).items[0];
const { stable_key, expense_profile, ...old } = enhanced;
assert.deepEqual(old, legacy);
assert.equal(stable_key, 'lbc:bill:10');
assert.equal(expense_profile.item_id, 10);
const reordered = addPnlExportFields({ items: [legacy], transactions: [...transactions].reverse(), snapshot: summary, profiles });
assert.equal(reordered.items[0].stable_key, stable_key);
const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
const token = crypto.randomUUID();
const child = spawn(process.execPath, ['src/server.js'], { cwd: path.resolve(import.meta.dirname, '..'), env: {
  ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'test', ADMIN_AUTH_MODE: 'operator_only',
  ADMIN_OPERATOR_NAMES: '["fictional"]', ADMIN_SESSION_SECRET: crypto.randomUUID(), ADMIN_AUTH_DISABLED: '0',
  AI_WORKER_ENABLED: 'false', AI_PROVIDER: 'mock', OPENAI_API_KEY: '', LINE_BILL_CAPTURE_CHANNEL_ACCESS_TOKEN: '',
  LINE_BILL_CAPTURE_CHANNEL_SECRET: '', LINE_BILL_CAPTURE_ACCOUNTING_EXPORT_TOKEN: token,
  LINE_BILL_CAPTURE_PUSH_MOCK: '1', LINE_BILL_CAPTURE_SILENT_MODE: '1'
}, stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; child.stdout.on('data', (data) => output += data); child.stderr.on('data', (data) => output += data);
const base = `http://127.0.0.1:${port}`;
const request = async (url) => {
  const response = await fetch(base + url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200); return (await response.json()).data;
};
const snapshotUrl = `/accounting-export/rounds/${encodeURIComponent(`${source}:${date}`)}/snapshot`;
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, output);
  assert.equal((await fetch(base + snapshotUrl)).status, 401);
  const first = await request(snapshotUrl);
  assert.equal(first.pnl_fields_version, 1); assert.deepEqual(first.payments_without_bill, []);
  assert.deepEqual(first.items.map((item) => item.stable_key), ['lbc:bill:10', 'lbc:bill:20', 'lbc:bill:30']);
  assert.equal(first.items[0].expense_profile.item_id, 10); assert.equal(first.items[1].expense_profile.item_id, 21);
  assert.equal(first.items[2].expense_profile, null);
  assert.equal(first.items[0].expense_profile.purpose, 'บิลชนะสลิป');
  const oldKeys = ['id','bill_id','source_id','business_date','document_date','supplier_name','description','amount_incl_vat',
    'payment_method','payer_account_name','payer_bank','payer_account_masked','payer_accounts','recipients_by_slip','paid_date',
    'evidence_url','evidence','generated_document','transaction_id','raw_transaction'];
  assert.deepEqual(Object.keys(first.items[0]).filter((key) => !['stable_key','expense_profile'].includes(key)).sort(), oldKeys.sort());
  assert.deepEqual(first.summary, summary); assert.deepEqual(first.reimbursements, []); assert.deepEqual(first.incoming_transfers, []);
  const profileKeys = ['item_id','status','revision','transaction_type','branch','department','purpose','supplier_name'];
  assert.deepEqual(Object.keys(first.items[0].expense_profile).sort(), profileKeys.sort());
  assert.ok(!JSON.stringify(first).includes('DO_NOT_EXPORT'));
  assert.ok(!JSON.stringify(first).includes(token));
  assert.ok(!/\d{10,}/.test(JSON.stringify(first)), 'No full account number in export fixture');
  const listUrl = `/accounting-export/rounds?from=${date}&to=${date}`;
  const listed = (await request(listUrl)).find((row) => row.source_id === source);
  assert.equal(listed.profile_max_updated_at, now);
  assert.equal((await request(snapshotUrl)).fingerprint, first.fingerprint);
  const updated = '2026-10-02T05:00:00.000Z'; save(10, 2, updated, 'แก้หลังปิดรอบ');
  const second = await request(snapshotUrl);
  assert.notEqual(second.fingerprint, first.fingerprint);
  assert.equal(second.items[0].expense_profile.revision, 2);
  const relisted = (await request(listUrl)).find((row) => row.source_id === source);
  assert.equal(relisted.profile_max_updated_at, updated);
  assert.equal(relisted.fingerprint, listed.fingerprint, 'Legacy list fingerprint remains unchanged on profile-only edit');
  assert.equal((await request(snapshotUrl)).fingerprint, second.fingerprint);
  // First available slip wins; its profile status stays draft, no implicit review.
  sql.prepare('DELETE FROM capture_expense_profiles WHERE item_id=10').run();
  assert.equal((await request(snapshotUrl)).items[0].expense_profile.item_id, 11);
  sql.prepare('DELETE FROM capture_expense_profiles WHERE item_id=11').run();
  assert.equal((await request(snapshotUrl)).items[0].expense_profile.item_id, 12);
  assert.equal((await request(snapshotUrl)).items[0].expense_profile.status, 'draft');
  // A snapshot member moved to another group/date still invalidates its original round.
  sql.prepare("UPDATE capture_items SET source_id='PNL-OTHER' WHERE id=21").run();
  save(21, 2, '2026-10-03T05:00:00.000Z', 'แก้สลิปต่างกลุ่ม');
  assert.equal((await request(listUrl)).find((row) => row.source_id === source).profile_max_updated_at, '2026-10-03T05:00:00.000Z');
  sql.prepare('DELETE FROM capture_expense_profiles').run();
  assert.equal((await request(listUrl)).find((row) => row.source_id === source).profile_max_updated_at, null);
  assert.ok((await request(snapshotUrl)).items.every((item) => item.expense_profile === null));
  console.log('P&L export: profile precedence, stable keys, additive fields, privacy, HTTP auth, fingerprint and list invalidation passed');
} finally {
  child.kill('SIGTERM'); if (child.exitCode === null) await once(child, 'exit'); sql.close();
}
