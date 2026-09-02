import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), '..');
const phase = process.argv[2] || '';
const dataDir = process.argv[3] || '';

if (phase === 'seed') {
  process.env.CAPTURE_DATA_DIR = dataDir;
  const { initDatabase } = await import('../src/db.js');
  await initDatabase();
  const database = new DatabaseSync(path.join(dataDir, 'line-bill-capture.sqlite'));
  const now = new Date().toISOString();
  const insertItem = database.prepare(
    `INSERT INTO capture_items
      (id, line_message_id, source_type, source_id, category, status,
       file_sha256, storage_path, storage_relative_path, duplicate_of_item_id,
       bill_total_value, slip_amount_value, amount_review_flag,
       match_status, matched_item_id, raw_event_json, created_at, updated_at)
     VALUES (?, ?, 'group', 'Grepair', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`
  );
  const addItem = ({ id, category, status = 'downloaded', hash = null, storagePath = null,
    relativePath = null, duplicateOf = null, bill = null, slip = null, flag = 0,
    matchStatus = 'unmatched', matchedId = null }) => insertItem.run(
    id, `repair-${id}`, category, status, hash, storagePath, relativePath, duplicateOf,
    bill, slip, flag, matchStatus, matchedId, now, now
  );

  addItem({ id: 1, category: 'bill', bill: 100, matchStatus: 'confirmed', matchedId: 2 });
  addItem({ id: 2, category: 'transfer', slip: 90, matchStatus: 'confirmed', matchedId: 1 });
  addItem({ id: 3, category: 'bill', bill: 50, flag: 1, matchStatus: 'confirmed', matchedId: 4 });
  addItem({ id: 4, category: 'transfer', slip: 50, matchStatus: 'confirmed', matchedId: 3 });
  addItem({
    id: 5,
    category: 'pending',
    status: 'unsent',
    hash: 'same-hash',
    storagePath: path.join(dataDir, 'images', 'canonical.jpg'),
    relativePath: 'images/canonical.jpg'
  });
  addItem({ id: 6, category: 'pending', status: 'duplicate', hash: 'same-hash', duplicateOf: 5 });
  addItem({
    id: 7,
    category: 'pending',
    status: 'unsent',
    storagePath: path.join(dataDir, 'images', 'stale.jpg'),
    relativePath: 'images/stale.jpg'
  });
  addItem({ id: 8, category: 'bill', bill: 20, matchStatus: 'confirmed', matchedId: 9 });
  addItem({ id: 9, category: 'transfer', slip: 20, matchStatus: 'confirmed', matchedId: 8 });
  addItem({ id: 10, category: 'bill', bill: 100, matchStatus: 'confirmed', matchedId: 11 });
  addItem({ id: 11, category: 'transfer', slip: 90, matchStatus: 'confirmed', matchedId: 10 });
  addItem({ id: 12, category: 'other' });
  addItem({ id: 13, category: 'payment_voucher' });
  database.prepare(
    `UPDATE capture_items
     SET ai_status = 'done', ai_raw_text = ?, ai_summary = ?, ai_result_json = ?
     WHERE id = ?`
  ).run(
    'ใบสำคัญจ่าย PAYMENT VOUCHER; รายการ ค่านักร้อง; จำนวนเงิน 450; รวมเงิน Total 450',
    'ใบสำคัญจ่ายภายใน ไม่ใช่บิลหรือสลิป',
    JSON.stringify({ category: 'other', document_class: 'other', raw_text: 'ใบสำคัญจ่าย PAYMENT VOUCHER รวมเงิน Total 450' }),
    12
  );
  database.prepare(
    `UPDATE capture_items
     SET ai_status = 'done', ai_raw_text = ?, ai_summary = ?, ai_result_json = ?
     WHERE id = ?`
  ).run(
    'ใบสำคัญจ่าย PAYMENT VOUCHER; รายการ ค่าแรงรายวัน; รวมเงิน 360 บาท',
    'ใบสำคัญจ่ายค่าแรงรายวัน 360 บาท',
    JSON.stringify({ category: 'payment_voucher', document_class: 'payment_voucher', bill_purpose: 'ค่าแรงรายวัน', bill_total_value: 360 }),
    13
  );
  database.prepare(
    `UPDATE capture_items SET event_timestamp_ms = CASE id
       WHEN 8 THEN ? WHEN 9 THEN ? END WHERE id IN (8, 9)`
  ).run(Date.parse('2026-08-01T23:50:00+07:00'), Date.parse('2026-08-02T00:10:00+07:00'));
  database.prepare(
    `UPDATE capture_items
     SET sender_user_id = 'Umarket', bill_purpose = NULL, announced_amount = 132,
         ai_summary = 'แบบสรุปยอดปิดตลาดประจำวัน ไม่ใช่ใบเรียกเก็บเงินหรือหลักฐานโอนชำระค่าสินค้า',
         ai_result_json = '{"bill_total_value":100,"announced_amount":132,"amount_conflict":true}',
         amount_review_flag = 1, event_timestamp_ms = ?
     WHERE id = 10`
  ).run(Date.parse('2026-08-01T20:07:00+07:00'));
  database.prepare(
    `UPDATE capture_items SET event_timestamp_ms = ? WHERE id = 11`
  ).run(Date.parse('2026-08-01T20:27:00+07:00'));
  database.prepare(
    `INSERT INTO line_messages
      (line_message_id, message_type, source_type, source_id, sender_user_id,
       text, status, event_timestamp_ms, raw_event_json, created_at, updated_at)
     VALUES ('repair-market-chat', 'text', 'group', 'Grepair', 'Umarket', ?, 'active', ?, '{}', ?, ?)`
  ).run(
    'ตลาด 1/8/69 รับ 1,000.- จ่าย 100.- เงินในบัญชีขาดเกิน -32.- @Jum โอนเพิ่ม 90 นะคะ',
    Date.parse('2026-08-01T20:09:00+07:00'), now, now
  );

  const insertMatch = database.prepare(
    `INSERT INTO capture_matches
      (id, bill_item_id, slip_item_id, score, status, reason_json, created_by,
       reviewed_by, reviewed_at, confirmed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'confirmed', '[]', 'ai-worker', ?, ?, ?, ?, ?)`
  );
  insertMatch.run(1, 1, 2, 95, 'admin-web', now, now, now, now);
  insertMatch.run(2, 3, 4, 95, 'ai-worker', now, now, now, now);
  insertMatch.run(3, 8, 9, 99, 'admin-web', now, now, now, now);
  insertMatch.run(4, 10, 11, 99, 'admin-web', now, now, now, now);
  database.prepare(
    `INSERT INTO capture_daily_closings
      (business_date, source_type, source_id, status, summary_json, closed_by,
       closed_at, created_at, updated_at)
     VALUES ('2026-08-01', 'group', 'Grepair', 'closed', ?, 'legacy-test', ?, ?, ?)`
  ).run(JSON.stringify({
    snapshot_version: 3,
    confirmed_bill_amount: 20,
    confirmed_slip_amount: 20,
    transactions: [{
      match_id: 3,
      bill_id: 8,
      slip_id: 9,
      payment_method: 'bank_transfer',
      bill_total_value: 20,
      slip_amount_value: 20,
      bill_members: [{ bill_id: 8, bill_total_value: 20 }],
      slip_members: [{ slip_id: 9, slip_amount_value: 20, slip_timestamp_ms: Date.parse('2026-08-02T00:10:00+07:00') }]
    }],
    reimbursements: []
  }), now, now, now);
  database.close();
  process.exit(0);
}

if (phase === 'repair') {
  process.env.CAPTURE_DATA_DIR = dataDir;
  const { initDatabase } = await import('../src/db.js');
  await initDatabase();
  process.exit(0);
}

if (phase === 'transaction-date') {
  process.env.CAPTURE_DATA_DIR = dataDir;
  const { closeDay, initDatabase, listMatches } = await import('../src/db.js');
  await initDatabase();
  const aug1 = await listMatches({ status: 'confirmed', start: '2026-08-01', end: '2026-08-01', limit: 100 });
  const aug2 = await listMatches({ status: 'confirmed', start: '2026-08-02', end: '2026-08-02', limit: 100 });
  assert.equal(aug1.some((row) => Number(row.id) === 3), false, 'Cross-day pair must leave the bill date');
  assert.equal(aug2.some((row) => Number(row.id) === 3), true, 'Cross-day pair must use the slip date');
  assert.equal(aug2.find((row) => Number(row.id) === 3)?.transaction_business_date, '2026-08-02');
  const closing = await closeDay({ businessDate: '2026-08-02', sourceId: 'Grepair' });
  assert.equal(closing?.summary?.transactions?.some((row) => Number(row.bill_id) === 8), true, 'Slip-day close must snapshot the cross-day transaction');
  process.exit(0);
}

const temporaryDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-bill-db-repair-'));
const imagesDir = path.join(temporaryDataDir, 'images');
await fs.mkdir(imagesDir, { recursive: true });
const canonicalPath = path.join(imagesDir, 'canonical.jpg');
const stalePath = path.join(imagesDir, 'stale.jpg');
await fs.writeFile(canonicalPath, 'canonical evidence');
await fs.writeFile(stalePath, 'must be deleted');

try {
  const childEnv = { ...process.env, CAPTURE_DATA_DIR: temporaryDataDir };
  execFileSync(process.execPath, [scriptPath, 'seed', temporaryDataDir], { cwd: rootDir, env: childEnv, stdio: 'inherit' });
  execFileSync(process.execPath, [scriptPath, 'repair', temporaryDataDir], { cwd: rootDir, env: childEnv, stdio: 'inherit' });
  execFileSync(process.execPath, [scriptPath, 'transaction-date', temporaryDataDir], { cwd: rootDir, env: childEnv, stdio: 'inherit' });

  const database = new DatabaseSync(path.join(temporaryDataDir, 'line-bill-capture.sqlite'), { readOnly: true });
  const item = (id) => database.prepare('SELECT * FROM capture_items WHERE id = ?').get(id);
  const match = (id) => database.prepare('SELECT * FROM capture_matches WHERE id = ?').get(id);

  assert.equal(match(1).status, 'manual_review');
  assert.equal(item(1).match_status, 'manual_review');
  assert.equal(item(2).match_status, 'manual_review');
  assert.equal(match(2).status, 'pending');
  assert.equal(item(3).match_status, 'pending');
  assert.equal(item(4).match_status, 'pending');
  assert.equal(match(3).status, 'confirmed');
  assert.equal(item(8).match_status, 'confirmed');
  assert.equal(item(9).match_status, 'confirmed');
  assert.equal(item(10).bill_total_value, 100);
  assert.equal(item(10).announced_amount, 90);
  assert.equal(item(10).amount_review_flag, 0);
  assert.equal(item(10).bill_purpose, 'บิลตลาด 1/8/69');
  assert.equal(match(4).status, 'confirmed');
  assert.equal(item(10).match_status, 'confirmed');
  assert.equal(item(11).match_status, 'confirmed');
  assert.equal(item(12).category, 'bill');
  assert.equal(item(12).bill_total_value, 450);
  assert.equal(item(12).match_status, 'unmatched');
  assert.equal(JSON.parse(item(12).ai_result_json).document_class, 'payment_voucher');
  assert.match(item(12).ai_summary, /ใช้เป็นบิล/);
  assert.equal(item(13).category, 'bill');
  assert.equal(item(13).bill_total_value, 360);
  assert.equal(item(13).bill_purpose, 'ค่าแรงรายวัน');
  assert.equal(item(5).storage_path, null);
  assert.equal(item(6).status, 'downloaded');
  assert.equal(item(6).duplicate_of_item_id, null);
  assert.equal(item(6).storage_path, canonicalPath);
  assert.equal(item(7).storage_path, null);
  const repairedAug1 = JSON.parse(database.prepare(
    `SELECT summary_json FROM capture_daily_closings
     WHERE business_date = '2026-08-01' AND source_id = 'Grepair'`
  ).get().summary_json);
  assert.equal(repairedAug1.snapshot_version, 5);
  assert.equal(repairedAug1.transactions.some((row) => Number(row.bill_id) === 8), false,
    'Legacy bill-day snapshot must remove a transaction whose slip belongs to the next day');
  database.close();

  await fs.access(canonicalPath);
  await assert.rejects(fs.access(stalePath), { code: 'ENOENT' });
  console.log('DB repair regression test passed');
} finally {
  await fs.rm(temporaryDataDir, { recursive: true, force: true });
}
