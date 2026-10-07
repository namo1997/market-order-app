import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
assert.ok(os.tmpdir().startsWith('/Volumes/SSD Files/SOLAO/'),'Use SSD snapshot runner');
process.env.CAPTURE_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(),'receipt-void-'));
process.env.CAPTURE_DB_PATH = path.join(process.env.CAPTURE_DATA_DIR,'fictional.sqlite');
const api = await import('../src/db.js'); await api.initDatabase();
const sql = new DatabaseSync(process.env.CAPTURE_DB_PATH);
let checks=0; const is=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
const now='2026-10-07T03:00:00.000Z', timestamp=Date.parse(now);
const insert=sql.prepare(`INSERT INTO capture_items(id,line_message_id,source_type,source_id,category,status,slip_amount_value,bill_total_value,match_status,raw_event_json,event_timestamp_ms,created_at,updated_at)
 VALUES(?,?,'group','VOID-FICTIONAL',?,'downloaded',?,?,'unmatched','{}',?,?,?)`);
for(const id of [10,20,30,40,50,60,70]) insert.run(id,`void-slip-${id}`,'transfer',100,null,timestamp,now,now);
insert.run(80,'void-real-bill','bill',null,100,timestamp,now,now);
const make=async id=>api.createReceiptSubstitute({slipItemId:id,documentDate:'2026-10-07',payeeName:'ผู้รับสมมติ',description:'ซื้อผักสมมติ',createdBy:'fictional'});
const first=await make(10); is(first.created,true);
const id=first.item.id;
const artifact=path.join(process.env.CAPTURE_DATA_DIR,'fictional-receipt.txt'); await fs.writeFile(artifact,'fictional preserved evidence');
sql.prepare('UPDATE capture_items SET storage_path=?,storage_relative_path=?,file_sha256=? WHERE id=?').run(artifact,'fictional-receipt.txt','a'.repeat(64),id);
await api.updateExpenseProfile({id,input:{expected_revision:0,status:'draft',fields:{purpose:{value:'ซื้อผักสมมติ',source:'manual',evidence:[]}}},actor:'fictional'});
const original=await api.getItemById(id), doc=JSON.parse(original.generated_document_json);
const histories=sql.prepare('SELECT * FROM capture_expense_profile_revisions ORDER BY item_id,revision').all();
const profiles=sql.prepare('SELECT * FROM capture_expense_profiles ORDER BY item_id').all();
sql.prepare("UPDATE capture_matches SET ai_learning_approved=1,review_note='positive-fixture' WHERE id=?").run(first.match.id);
sql.prepare(`INSERT INTO ai_learning_examples(match_id,outcome,review_note,example_json,approved_by,created_at,updated_at) VALUES(?,'confirmed','positive-fixture','{}','fictional',?,?)`).run(first.match.id,now,now);
const learning=sql.prepare('SELECT * FROM ai_learning_examples ORDER BY id').all();
is((await api.listAiLearningExamples()).filter(row=>row.outcome==='confirmed').length,1);
is((await api.voidReceiptSubstitute({itemId:80,reason:'ยกเลิก'})).error,'not_receipt_substitute');
is((await api.voidReceiptSubstitute({itemId:99999,reason:'ยกเลิก'})).error,'item_not_found');
is((await api.voidReceiptSubstitute({itemId:id,reason:'  '})).error,'reason_required');
is((await api.voidReceiptSubstitute({itemId:id,reason:'ยกเลิก',expectedUpdatedAt:'stale'})).error,'revision_conflict');
const cancelled=await api.voidReceiptSubstitute({itemId:id,reason:'สร้างใบแทนผิด',voidedBy:'fictional-canceller',expectedUpdatedAt:original.updated_at});
is(cancelled.voided,true);is(cancelled.item_id,id);is(cancelled.idempotent,false);is(cancelled.item.status,'unsent');is(cancelled.rejected_match_ids,[first.match.id]);
const afterDoc=JSON.parse(cancelled.item.generated_document_json);
for(const [key,value] of Object.entries(doc)) is(afterDoc[key],value);
is(afterDoc.void_reason,'สร้างใบแทนผิด');is(afterDoc.voided_by,'fictional-canceller');
is(cancelled.item.storage_path,artifact);is(cancelled.item.file_sha256,original.file_sha256);is(cancelled.item.generated_from_item_id,10);
is((await api.getItemById(10)).slip_amount_value,100);is((await api.getItemById(10)).match_status,'unmatched');is((await api.getItemById(10)).matched_item_id,null);
is(sql.prepare('SELECT * FROM ai_learning_examples ORDER BY id').all(),learning);is((await api.listAiLearningExamples()).filter(row=>row.outcome==='confirmed').length,0);
is(sql.prepare('SELECT ai_learning_approved FROM capture_matches WHERE id=?').get(first.match.id).ai_learning_approved,0);
is(sql.prepare('SELECT * FROM capture_expense_profile_revisions ORDER BY item_id,revision').all(),histories);is(sql.prepare('SELECT * FROM capture_expense_profiles ORDER BY item_id').all(),profiles);
const beforeRetry=sql.prepare('SELECT * FROM capture_items ORDER BY id').all();
const retry=await api.voidReceiptSubstitute({itemId:id,reason:'different retry reason',expectedUpdatedAt:'stale'});is(retry.idempotent,true);is(retry.item.generated_document_json,cancelled.item.generated_document_json);is(sql.prepare('SELECT * FROM capture_items ORDER BY id').all(),beforeRetry);
is((await make(10)).error,'receipt_substitute_unavailable');
is((await api.updateItemMetadata({id,category:'other',editedBy:'fictional'})).error,'receipt_substitute_unavailable');
is((await api.setItemMatch({billItemId:id,slipItemId:10,status:'confirmed',createdBy:'fictional'})).error,'item_unavailable');
// A different actual bill now using the source slip must never be reset by cancelling its old receipt.
const repointed=await make(20); await api.setItemMatch({billItemId:repointed.item.id,slipItemId:20,status:'rejected',createdBy:'fictional'});
await api.setItemMatch({billItemId:80,slipItemId:20,status:'confirmed',createdBy:'fictional'});
const beforeRepoint=sql.prepare('SELECT * FROM capture_items ORDER BY id').all(), beforeMatches=sql.prepare('SELECT * FROM capture_matches ORDER BY id').all();
is((await api.voidReceiptSubstitute({itemId:repointed.item.id,reason:'ยกเลิก'})).error,'receipt_substitute_group_conflict');
is(sql.prepare('SELECT * FROM capture_items ORDER BY id').all(),beforeRepoint);is(sql.prepare('SELECT * FROM capture_matches ORDER BY id').all(),beforeMatches);
// Shared group key also counts as a broader component, even without shared item IDs.
const grouped=await make(30),other=await make(40);
sql.prepare("UPDATE capture_matches SET match_group_key='void-shared-group' WHERE id IN (?,?)").run(grouped.match.id,other.match.id);
is((await api.voidReceiptSubstitute({itemId:grouped.item.id,reason:'ยกเลิก'})).error,'receipt_substitute_group_conflict');
is((await api.getItemById(other.item.id)).match_status,'confirmed');
// Own closed round and source-slip round both block; no automatic reopen occurs.
const closed=await make(50);
sql.prepare("INSERT INTO capture_daily_closings(business_date,source_id,status,created_at,updated_at) VALUES('2026-10-07','VOID-FICTIONAL','closed',?,?)").run(now,now);
const beforeClosing=sql.prepare('SELECT * FROM capture_daily_closings').all();
is((await api.voidReceiptSubstitute({itemId:closed.item.id,reason:'ยกเลิก'})).error,'round_closed');is(sql.prepare('SELECT * FROM capture_daily_closings').all(),beforeClosing);
sql.prepare("UPDATE capture_daily_closings SET status='open'").run();
// Keep receipt on an open own day while its matched source transaction's day is closed.
sql.prepare('UPDATE capture_items SET event_timestamp_ms=? WHERE id=?').run(timestamp+86400000,closed.item.id);
sql.prepare("UPDATE capture_daily_closings SET status='closed'").run();
is((await api.voidReceiptSubstitute({itemId:closed.item.id,reason:'ยกเลิก'})).error,'round_closed');
sql.prepare("UPDATE capture_daily_closings SET status='open'").run();
const corrupt=await make(60);sql.prepare('UPDATE capture_items SET generated_from_item_id=70 WHERE id=?').run(corrupt.item.id);
is((await api.voidReceiptSubstitute({itemId:corrupt.item.id,reason:'ยกเลิก'})).error,'receipt_substitute_source_invalid');
const concurrent=await make(70);
// Cancellation must not invalidate confirmed advance/reimbursement evidence in either direction.
for (const direction of ['source','reverse']) {
  if (direction === 'source') sql.prepare("UPDATE capture_items SET reimbursement_related_item_id=80,reimbursement_status='confirmed',reimbursement_evidence_mode='receipt_substitute' WHERE id=70").run();
  else sql.prepare("UPDATE capture_items SET reimbursement_related_item_id=70,reimbursement_status='confirmed',reimbursement_evidence_mode='receipt_substitute' WHERE id=80").run();
  const coupledItems=sql.prepare('SELECT * FROM capture_items ORDER BY id').all();
  const coupledMatches=sql.prepare('SELECT * FROM capture_matches ORDER BY id').all();
  is((await api.voidReceiptSubstitute({itemId:concurrent.item.id,reason:'ห้ามลบหลักฐานเงินทดรอง'})).error,'receipt_substitute_group_conflict');
  is(sql.prepare('SELECT * FROM capture_items ORDER BY id').all(),coupledItems);
  is(sql.prepare('SELECT * FROM capture_matches ORDER BY id').all(),coupledMatches);
  sql.prepare("UPDATE capture_items SET reimbursement_related_item_id=NULL,reimbursement_status='unmatched',reimbursement_evidence_mode=NULL WHERE id IN (70,80)").run();
}
const concurrentResults=await Promise.all([1,2].map(()=>api.voidReceiptSubstitute({itemId:concurrent.item.id,reason:'คำขอซ้ำพร้อมกัน',expectedUpdatedAt:concurrent.item.updated_at})));
is(concurrentResults.map(result=>result.idempotent),[false,true]);
is(concurrentResults[0].item.generated_document_json,concurrentResults[1].item.generated_document_json);
// Restart must preserve tombstone, immutable expense history and generated evidence file.
const restart=spawnSync(process.execPath,['--input-type=module','-e',`const api=await import(${JSON.stringify(new URL('../src/db.js',import.meta.url).href)}); await api.initDatabase(); console.log(JSON.stringify(await api.getItemById(${id})));`],{env:process.env,encoding:'utf8'});
is(restart.status,0);const restarted=JSON.parse(restart.stdout.trim());is(restarted.status,'unsent');is(restarted.storage_path,artifact);is(await fs.readFile(artifact,'utf8'),'fictional preserved evidence');
is(sql.prepare('SELECT * FROM capture_expense_profile_revisions ORDER BY item_id,revision').all(),histories);
sql.close();console.log(`Receipt substitute cancellation: ${checks} checks passed; scoped rejection, closed locks, idempotency, financial/learning/history and restart/file preservation.`);
