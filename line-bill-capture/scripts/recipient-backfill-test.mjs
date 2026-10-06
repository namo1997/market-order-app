import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-bill-recipient-backfill-'));
process.env.CAPTURE_DATA_DIR = dataDir;

try {
  const { initDatabase, backfillRecipientDetails } = await import('../src/db.js');
  await initDatabase();
  const dbPath = path.join(dataDir, 'line-bill-capture.sqlite');
  const database = new DatabaseSync(dbPath);
  const now = new Date().toISOString();
  const insert = database.prepare(`INSERT INTO capture_items
    (id,line_message_id,source_type,source_id,category,status,ai_status,ai_raw_text,ai_summary,ai_result_json,raw_event_json,event_timestamp_ms,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run(1, 'recipient-backfill-1', 'group', 'BACKFILL', 'transfer', 'downloaded', 'done',
    'โอนเงินสำเร็จ จาก บจก. โซลาว ธนาคารกสิกรไทย XXX-X-X6310-X ไปยัง บริษัท ปลายทาง ธนาคารไทยพาณิชย์ 1234567201 จำนวนเงิน 100 บาท',
    'สลิปโอนเงิน', JSON.stringify({ category: 'transfer', raw_text: 'โอนเงินสำเร็จ จาก บจก. โซลาว ธนาคารกสิกรไทย XXX-X-X6310-X ไปยัง บริษัท ปลายทาง ธนาคารไทยพาณิชย์ 1234567201 จำนวนเงิน 100 บาท' }),
    '{}', Date.parse('2026-08-25T10:00:00+07:00'), now, now);
  insert.run(2, 'recipient-backfill-2', 'group', 'BACKFILL', 'transfer', 'downloaded', 'done', '', 'เดิมผ่านแล้ว', JSON.stringify({ category: 'transfer', recipient_extraction_version: 1, recipient_review_status: 'UNRESOLVED' }), '{}', Date.parse('2026-08-26T10:00:00+07:00'), now, now);
  insert.run(3, 'recipient-backfill-bill', 'group', 'BACKFILL', 'bill', 'downloaded', 'done', 'ผู้ขาย ธนาคารทดสอบ 1111111234', 'บิล', JSON.stringify({ category: 'bill' }), '{}', Date.parse('2026-08-25T11:00:00+07:00'), now, now);
  database.close();

  const preview = await backfillRecipientDetails({ start: '2026-08-25', end: '2026-08-31' });
  assert.equal(preview.apply, false);
  assert.equal(preview.scanned, 2);
  assert.equal(preview.eligible, 1);
  assert.equal(preview.changed, 0);
  assert.equal(preview.extracted, 1);

  const before = new DatabaseSync(dbPath, { readOnly: true }).prepare('SELECT ai_result_json FROM capture_items WHERE id=1').get().ai_result_json;
  assert.doesNotMatch(before, /recipient_identity_token/);

  const applied = await backfillRecipientDetails({ start: '2026-08-25', end: '2026-08-31', apply: true });
  assert.equal(applied.changed, 1);
  const verify = new DatabaseSync(dbPath, { readOnly: true });
  const stored = JSON.parse(verify.prepare('SELECT ai_result_json FROM capture_items WHERE id=1').get().ai_result_json);
  assert.equal(stored.recipient_extraction_version, 1);
  assert.equal(stored.recipient_name, 'บริษัท ปลายทาง');
  assert.equal(stored.recipient_account_masked, '••••7201');
  assert.match(stored.recipient_identity_token, /^recipient-proof:/);
  const rerun = await backfillRecipientDetails({ start: '2026-08-25', end: '2026-08-31', apply: true });
  assert.equal(rerun.changed, 0);
  assert.equal(rerun.skipped_already_versioned, 2);
  verify.close();
  console.log('Recipient extraction persistence and idempotent Local backfill test passed');
} finally {
  await fs.rm(dataDir, { recursive: true, force: true });
}
