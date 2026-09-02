import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-bill-human-confirm-'));
process.env.CAPTURE_DATA_DIR = dataDir;

try {
  const {
    initDatabase,
    listMatches,
    recordMatchLearningFeedback,
    setItemMatch
  } = await import('../src/db.js');
  await initDatabase();
  const database = new DatabaseSync(path.join(dataDir, 'line-bill-capture.sqlite'));
  const now = new Date().toISOString();
  const insert = database.prepare(
    `INSERT INTO capture_items
      (id, line_message_id, source_type, source_id, category, status,
       file_sha256, storage_path, storage_relative_path, bill_total_value,
       slip_amount_value, ai_status, ai_summary, match_status, raw_event_json,
       created_at, updated_at)
     VALUES (?, ?, 'group', 'Ghuman', ?, 'downloaded', ?, ?, ?, ?, ?, 'done', ?, 'unmatched', '{}', ?, ?)`
  );
  insert.run(1, 'human-bill', 'bill', 'human-sha-bill', '/tmp/human-bill.jpg', 'human-bill.jpg', 250, null, 'บิลค่าสินค้า 250 บาท', now, now);
  insert.run(2, 'human-slip', 'transfer', 'human-sha-slip', '/tmp/human-slip.jpg', 'human-slip.jpg', null, 250, 'สลิปโอนสำเร็จ 250 บาท', now, now);
  database.close();

  const aiProposal = await setItemMatch({
    billItemId: 1,
    slipItemId: 2,
    score: 99,
    status: 'confirmed',
    reasons: ['ยอดตรงและเลขอ้างอิงตรง'],
    createdBy: 'ai-worker'
  });
  assert.equal(aiProposal.status, 'pending', 'AI must never create a confirmed match');
  assert.equal(aiProposal.reviewed_by, null, 'AI proposal must not impersonate a human reviewer');

  const humanConfirmation = await setItemMatch({
    billItemId: 1,
    slipItemId: 2,
    score: 99,
    status: 'confirmed',
    reasons: ['คนตรวจรูปบิลและสลิปแล้ว'],
    createdBy: 'admin-web',
    reviewNote: 'ยอดบิลและยอดสลิปตรงกัน',
    aiLearningApproved: true
  });
  assert.equal(humanConfirmation.status, 'confirmed');
  assert.equal(humanConfirmation.reviewed_by, 'admin-web');

  const positiveVerify = new DatabaseSync(path.join(dataDir, 'line-bill-capture.sqlite'), { readOnly: true });
  const positiveExample = positiveVerify.prepare('SELECT * FROM ai_learning_examples WHERE match_id = ?').get(humanConfirmation.id);
  assert.equal(positiveExample.outcome, 'confirmed', 'One-tap confirmation reason must become a positive AI example');
  assert.match(positiveExample.review_note, /ยอดบิลและยอดสลิปตรงกัน/);
  positiveVerify.close();

  const learned = await recordMatchLearningFeedback({
    matchId: humanConfirmation.id,
    reviewNote: 'คู่ถูก แต่ควรให้น้ำหนักเลขอ้างอิงมากกว่าเวลาใกล้กัน',
    approvedBy: 'admin-web'
  });
  assert.equal(learned.learned_edges, 1);

  const verify = new DatabaseSync(path.join(dataDir, 'line-bill-capture.sqlite'), { readOnly: true });
  const stored = verify.prepare('SELECT * FROM capture_matches WHERE id = ?').get(humanConfirmation.id);
  const example = verify.prepare('SELECT * FROM ai_learning_examples WHERE match_id = ?').get(humanConfirmation.id);
  assert.equal(stored.status, 'confirmed', 'Teaching from done must not change transaction status');
  assert.equal(stored.ai_learning_approved, 1);
  assert.match(stored.review_note, /เลขอ้างอิง/);
  assert.match(example.example_json, /reason_or_ranking_feedback/);
  verify.close();

  const returnedToReview = await setItemMatch({
    billItemId: 1,
    slipItemId: 2,
    score: 99,
    status: 'pending',
    reasons: ['ถอนการยืนยันเพื่อให้คนตรวจใหม่'],
    createdBy: 'admin-web',
    reviewNote: 'สลิปนี้จ่ายบิลใบอื่น',
    aiLearningApproved: true
  });
  assert.equal(returnedToReview.status, 'pending');
  const rejectionVerify = new DatabaseSync(path.join(dataDir, 'line-bill-capture.sqlite'), { readOnly: true });
  const rejectionExample = rejectionVerify.prepare('SELECT * FROM ai_learning_examples WHERE match_id = ?').get(humanConfirmation.id);
  assert.equal(rejectionExample.outcome, 'rejected', 'Unconfirm reason must become a negative AI example even while the pair returns to review');
  rejectionVerify.close();

  await setItemMatch({
    billItemId: 1,
    slipItemId: 2,
    score: 99,
    status: 'confirmed',
    reasons: ['คนตรวจซ้ำแล้ว'],
    createdBy: 'admin-web',
    reviewNote: 'เลขอ้างอิงและยอดตรงกันหลังตรวจซ้ำ',
    aiLearningApproved: true
  });

  const rows = await listMatches({ status: 'confirmed', limit: 10 });
  assert.equal(rows.length, 1);

  const ui = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(ui, /เหตุผลที่ AI เสนอคู่นี้/);
  assert.match(ui, /id="done-learning-note"/);
  assert.match(ui, /matches\/\$\{match\.id\}\/learning-feedback/);
  assert.match(ui, /if\(code!==['"]other['"]\)return finish/, 'Preset decision reasons must submit in one tap');
  assert.match(ui, /ai_learning_approved:Boolean\(reason\.text\)/, 'One-tap match reasons must be approved as AI examples');
  console.log('Human confirmation guard and completed-match AI feedback test passed');
} finally {
  await fs.rm(dataDir, { recursive: true, force: true });
}
