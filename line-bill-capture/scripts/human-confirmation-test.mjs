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
    repairItemMatchState,
    setItemMatch,
    setMarketTransferAmount
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
  assert.match(ui, /X-Decision-Reason-Code':'user_action'/, 'Human actions must be logged without Shadow AI');
  assert.doesNotMatch(ui, /AI กำลังวิเคราะห์เอกสารนี้|ใช้เหตุผล AI เป็นร่าง/);
  // ปุ่ม "ซ่อมสถานะรายการนี้": รายการที่ match_status ค้าง pending แต่ไม่มีแถวคู่จริง ต้องกลับเป็น unmatched
  const repairDb = new DatabaseSync(path.join(dataDir, 'line-bill-capture.sqlite'));
  repairDb.prepare(
    `INSERT INTO capture_items
      (id, line_message_id, source_type, source_id, category, status, bill_total_value,
       ai_status, match_status, matched_item_id, raw_event_json, created_at, updated_at)
     VALUES (90, 'repair-ghost', 'group', 'Ghuman', 'bill', 'downloaded', 120, 'done', 'pending', 999, '{}', ?, ?)`
  ).run(now, now);
  repairDb.close();
  const repaired = await repairItemMatchState(90);
  assert.equal(repaired.changed, true);
  assert.equal(repaired.before_match_status, 'pending');
  assert.equal(repaired.after_match_status, 'unmatched');
  assert.equal(repaired.item.matched_item_id, null);
  const repairedAgain = await repairItemMatchState(90);
  assert.equal(repairedAgain.changed, false, 'Repair must be idempotent');
  assert.equal(await repairItemMatchState(12345), null, 'Unknown item returns null (HTTP 404)');

  // บิลตลาด (แบบ #956): ยอดซื้อ 14,927 เงินขาด -32 ระบบคำนวณยอดโอน 14,959 แต่แชทพิมพ์/สลิปโอนจริง 14,927
  const marketDb = new DatabaseSync(path.join(dataDir, 'line-bill-capture.sqlite'));
  const market = { billTotal: 14927, transferTotal: 14959, typedTransferTotal: 14927, balance: -32, date: '1/8/69' };
  const insertMarket = marketDb.prepare(
    `INSERT INTO capture_items
      (id, line_message_id, source_type, source_id, category, status, bill_total_text, bill_total_value,
       announced_amount, slip_amount_value, bill_purpose, ai_status, ai_summary, ai_result_json,
       match_status, raw_event_json, created_at, updated_at)
     VALUES (?, ?, 'group', 'Gmarket', ?, 'downloaded', ?, ?, ?, ?, ?, 'done', ?, ?, 'unmatched', '{}', ?, ?)`
  );
  insertMarket.run(70, 'market-bill', 'bill', '14,927.00', 14927, 14959, null, 'บิลตลาด 1/8/69',
    'บิลตลาด 1/8/69 ยอดซื้อ 14,927 บาท', JSON.stringify({ market_reconciliation: market }), now, now);
  insertMarket.run(71, 'market-slip', 'transfer', null, null, null, 14927, null,
    'สลิปโอนเงินสำเร็จ 14,927 บาท', '{}', now, now);
  insertMarket.run(72, 'plain-bill', 'bill', '500.00', 500, null, null, 'ค่าผัก',
    'บิลค่าผัก 500 บาท', '{}', now, now);
  marketDb.close();
  await setItemMatch({ billItemId: 70, slipItemId: 71, score: 80, status: 'manual_review', reasons: ['ยอดต่าง 32'], createdBy: 'admin-web' });

  assert.equal((await setMarketTransferAmount({ id: 72, mode: 'purchase', resolvedBy: 'dot' })).error, 'not_market_bill');
  assert.equal((await setMarketTransferAmount({ id: 70, mode: 'bogus', resolvedBy: 'dot' })).error, 'invalid_mode');
  assert.equal((await setMarketTransferAmount({ id: 70, mode: 'manual', amountValue: 0, resolvedBy: 'dot' })).error, 'invalid_amount');
  assert.equal(await setMarketTransferAmount({ id: 9999, mode: 'purchase' }), null);

  const marketFixed = await setMarketTransferAmount({ id: 70, mode: 'purchase', resolvedBy: 'dot' });
  assert.equal(marketFixed.announced_amount, 14927, 'Market bill now matches on the purchase amount');
  assert.equal(marketFixed.bill_total_value, 14927, 'Purchase amount itself is unchanged');
  assert.equal(marketFixed.bill_total_edited_by, 'dot', 'Human choice locks the amount against market repair/AI reread');
  assert.match(marketFixed.notes, /ยอดโอนตลาด: ยึดยอดซื้อ 14,927\.00 \(เดิม 14,959\.00, ระบบคำนวณ 14,959\.00, เงินขาดเกิน -32\.00/);
  const marketPair = (await listMatches({ status: 'manual_review', limit: 50 })).find((match) => Number(match.bill_item_id) === 70);
  assert.ok(marketPair, 'The human-made pair stays active for confirmation');

  const typed = await setMarketTransferAmount({ id: 70, mode: 'typed', resolvedBy: 'dot' });
  assert.equal(typed.announced_amount, 14927);
  assert.equal(typed.notes.split('\n').length, 2, 'Each choice appends one audit line to the bill notes');
  const manual = await setMarketTransferAmount({ id: 70, mode: 'manual', amountValue: 14959, resolvedBy: 'dot' });
  assert.equal(manual.announced_amount, 14959);
  console.log('Human confirmation guard, completed-match feedback, and silent audit log test passed');
} finally {
  await fs.rm(dataDir, { recursive: true, force: true });
}
