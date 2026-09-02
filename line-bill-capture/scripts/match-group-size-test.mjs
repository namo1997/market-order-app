import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-bill-match-group-size-'));
process.env.CAPTURE_DATA_DIR = dataDir;

try {
  const { initDatabase, setItemMatchGroup } = await import('../src/db.js');
  await initDatabase();

  const database = new DatabaseSync(path.join(dataDir, 'line-bill-capture.sqlite'));
  const now = new Date().toISOString();
  const insert = database.prepare(
    `INSERT INTO capture_items
      (id, line_message_id, source_type, source_id, category, status,
       bill_total_value, slip_amount_value, match_status, raw_event_json, created_at, updated_at)
     VALUES (?, ?, 'group', 'Glarge', ?, 'downloaded', ?, ?, 'unmatched', '{}', ?, ?)`
  );
  const add = (id, category, billAmount, slipAmount) =>
    insert.run(id, `large-${id}`, category, billAmount, slipAmount, now, now);

  const manyBills = Array.from({ length: 64 }, (_, index) => index + 1);
  manyBills.forEach((id) => add(id, 'bill', 1, null));
  add(100, 'transfer', null, 64);

  add(200, 'bill', 64, null);
  const manySlips = Array.from({ length: 64 }, (_, index) => index + 201);
  manySlips.forEach((id) => add(id, 'transfer', null, 1));
  database.close();

  const billsResult = await setItemMatchGroup({
    billItemIds: manyBills,
    slipItemIds: [100],
    status: 'pending',
    createdBy: 'size-test'
  });
  assert.equal(billsResult.error, undefined);
  assert.deepEqual(billsResult.bill_item_ids, manyBills);
  assert.deepEqual(billsResult.slip_item_ids, [100]);
  assert.equal(billsResult.bill_total, 64);
  assert.equal(billsResult.slip_total, 64);
  assert.ok(billsResult.match_group_key.length < 80, 'Large groups must keep a fixed-size key');

  const slipsResult = await setItemMatchGroup({
    billItemIds: [200],
    slipItemIds: manySlips,
    status: 'pending',
    createdBy: 'size-test'
  });
  assert.equal(slipsResult.error, undefined);
  assert.deepEqual(slipsResult.bill_item_ids, [200]);
  assert.deepEqual(slipsResult.slip_item_ids, manySlips);
  assert.equal(slipsResult.bill_total, 64);
  assert.equal(slipsResult.slip_total, 64);

  const confirmed = await setItemMatchGroup({
    billItemIds: manyBills,
    slipItemIds: [100],
    status: 'confirmed',
    createdBy: 'size-test'
  });
  assert.equal(confirmed.error, undefined);
  assert.equal(confirmed.bill_item_ids.length, 64);

  const verify = new DatabaseSync(path.join(dataDir, 'line-bill-capture.sqlite'), { readOnly: true });
  assert.equal(
    Number(verify.prepare('SELECT COUNT(*) AS count FROM capture_matches WHERE match_group_key = ?').get(confirmed.match_group_key).count),
    64,
    'A 64:1 group should use 64 sparse edges'
  );
  assert.equal(
    Number(verify.prepare('SELECT COUNT(*) AS count FROM capture_matches WHERE match_group_key = ?').get(slipsResult.match_group_key).count),
    64,
    'A 1:64 group should use 64 sparse edges'
  );
  verify.close();
  console.log('Large match-group test passed (64:1 and 1:64)');
} finally {
  await fs.rm(dataDir, { recursive: true, force: true });
}
