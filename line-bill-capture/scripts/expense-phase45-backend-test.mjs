import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { ensureExpenseProfileSchema, readExpenseProfile, saveExpenseProfile, EXPENSE_TRANSACTION_TYPES } from '../src/expense-profile.js';
assert.equal(process.env.SOLAO_LOCAL_SIMULATION, '1');
assert.ok(os.tmpdir().startsWith('/Volumes/SSD Files/SOLAO/'));
const original = process.env.EXPENSE_PHASE45_SNAPSHOT || '/Volumes/SSD Files/SOLAO/line-bill-capture/releases/expense-facts-20261006-1791281997/backups/production-snapshot.sqlite';
const dir = await fs.mkdtemp(path.join(os.tmpdir(),'expense-phase45-'));
const dbPath = path.join(dir,'working.sqlite'); await fs.copyFile(original,dbPath); await fs.chmod(dbPath,0o600);
const sql = new DatabaseSync(dbPath);
const db = {
  run(text,params) { return params ? sql.prepare(text).run(...params) : sql.exec(text); },
  prepare(text,params=[]) { const rows=sql.prepare(text).all(...params);let position=-1;return {step(){return ++position<rows.length},getAsObject(){return rows[position]},free(){}}; }
};
ensureExpenseProfileSchema(db);
const financial = () => JSON.stringify(Object.fromEntries(['capture_items','capture_matches','capture_daily_closings','capture_cash_payments','line_messages','ai_learning_examples'].map(table=>[table,sql.prepare(`SELECT * FROM ${table} ORDER BY id`).all()])));
const before = financial(), checks=[];
function check(name,fn){fn();checks.push(name)}
const entry = (value,source='manual',evidence=[]) => ({value,source,evidence});
const save = (id,fields,status='draft',revision=0) => saveExpenseProfile(db,{id,input:{expected_revision:revision,status,fields,reason:'ตรวจจากสำเนาหลักฐานบน SSD'},actor:'local-test'});
const fieldKeys=['purpose','transaction_type','recipient_name','branch'];
for (const id of [2335,2345]) {
  check(`#${id}: complete proposals; no auto save; reviewed persists`,()=>{
    const profile=readExpenseProfile(db,id); assert.equal(profile.revision,0);
    for(const key of fieldKeys) assert.ok(profile.suggestions[key]?.value,`${id} missing ${key}`);
    assert.equal(profile.suggestions.transaction_type.value,'government_remittance');
    assert.equal(profile.suggestions.branch.source,'group_label');
    assert.equal(profile.suggestions.branch.value,'คันคลอง');
    if(id===2335){ assert.equal(profile.suggestions.purpose.source,'chat'); assert.equal(profile.suggestions.purpose.evidence[0].message_id,'629874384396091453'); assert.equal(profile.suggestions.recipient_name.source,'paired_ocr'); }
    const result=save(id,profile.suggestions,'reviewed'); assert.equal(result.status,'reviewed'); assert.equal(result.revision,1);
    assert.equal(readExpenseProfile(db,id).history.length,1);
    assert.equal(save(id,{},'draft',0).error,'revision_conflict');
  });
}
check('enum and required remittance facts enforced; no shop required',()=>{
  assert.ok(EXPENSE_TRANSACTION_TYPES.includes('government_remittance'));
  const base=Object.fromEntries(fieldKeys.map(key=>[key,entry(key==='transaction_type'?'government_remittance':null)]));
  assert.equal(save(2335,base,'reviewed',1).error,'review_remittance_fields_required');
  for(const missing of ['purpose','recipient_name','branch']){
    const fields={purpose:entry('ภาษีหัก ณ ที่จ่าย'),recipient_name:entry('กรมสรรพากร'),branch:entry('คันคลอง'),transaction_type:entry('government_remittance'),[missing]:entry(null)};
    assert.equal(save(2335,fields,'reviewed',1).error,'review_remittance_fields_required');
  }
});
check('new sources reject wrong fields and forged foreign evidence',()=>{
  assert.equal(save(2335,{notes:entry('fake','group_label',[{item_id:2335}])},'draft',1).error,'source_invalid');
  assert.equal(save(2335,{branch:entry('fake','group_label',[{item_id:2345}])},'draft',1).error,'evidence_item_invalid');
  assert.equal(save(2335,{recipient_name:entry('fake','paired_ocr',[{item_id:2557}])},'draft',1).error,'evidence_item_invalid');
  for (const invalid of [null,[],{item_id:'2345'},{item_id:2345,message_id:'fake'}]) assert.equal(save(2335,{recipient_name:entry('fake','paired_ocr',[invalid])},'draft',1).error,'evidence_item_invalid');
  assert.equal(save(2335,{purpose:entry('fake','ai_summary',[])},'draft',1).error,'evidence_required');
  assert.equal(save(2335,{purpose:entry('fake','chat',[{item_id:2335,message_id:'missing'}])},'draft',1).error,'evidence_message_invalid');
});
check('masked accounts and free-text responses/history',()=>{
  assert.equal(save(2335,{recipient_account_masked:entry('1234567890')},'draft',1).error,'account_must_be_masked');
  const saved=save(2335,{notes:entry('เลขบัญชี 1234567890')},'draft',1);
  assert.equal(saved.revision,2); assert.doesNotMatch(JSON.stringify(saved),/1234567890/); assert.match(saved.fields.notes.value,/••••7890/);
  assert.doesNotMatch(JSON.stringify(save(2335,{notes:entry('เลขบัญชี 12345')},'draft',2)),/12345/);
});
check('immutable revisions; protected financial/chat tables exactly preserved',()=>{
  assert.throws(()=>sql.exec('DELETE FROM capture_expense_profile_revisions'),/immutable/);
  assert.throws(()=>sql.exec("UPDATE capture_expense_profile_revisions SET reason='changed'"),/immutable/);
  assert.equal(financial(),before);
});
// Negative boundaries on separate copies: no evidence from another group/day/amount or unsent messages.
for(const [name,where] of [
  ['wrong amount',"text='ค่า กยศ ยอด 961 บาท'"],
  ['wrong group',"source_id='other-group'"],
  ['wrong day',"event_timestamp_ms=event_timestamp_ms+86400000"],
  ['outside window',"event_timestamp_ms=event_timestamp_ms+3600000"],
  ['unsent',"status='unsent'"],
  ['amount embedded in account',"text='ค่า กยศ เลขบัญชี 1239604567'"],
]) {
  sql.exec('BEGIN');sql.prepare(`UPDATE line_messages SET ${where} WHERE line_message_id=?`).run('629874384396091453');
  check(`chat excludes ${name}`,()=>assert.notEqual(readExpenseProfile(db,2335).suggestions.purpose?.source,'chat'));
  sql.exec('ROLLBACK');
}
check('ambiguous same-amount chat does not guess',()=>{
  sql.exec('BEGIN');sql.prepare(`UPDATE line_messages SET text='ค่าภาษี ยอด 960 บาท' WHERE line_message_id=?`).run('629874489622266568');
  assert.notEqual(readExpenseProfile(db,2335).suggestions.purpose?.source,'chat');sql.exec('ROLLBACK');
});
const context=vm.createContext({window:{addEventListener(){}},Set});
vm.runInContext(await fs.readFile(new URL('../public/expense-pair-review.js',import.meta.url),'utf8')+';this.model=expenseReasonModel;this.title=expenseQueueTitle;',context);
check('AI reason summary <=5; contradictions historical only; queue nonblank',()=>{
  const reasons=['ยอดตรง','ยังไม่มีหลักฐานยืนยันร้าน','เวลาใกล้กัน',...Array.from({length:14},(_,i)=>`หลักฐาน ${i}`)];
  const model=context.model(reasons,true);assert.equal(model.selected.length,5);assert.ok(!model.selected.some(s=>s.includes('ยังไม่มีหลักฐาน')));assert.ok(model.remaining.some(s=>s.includes('ยังไม่มีหลักฐาน')));
  assert.equal(context.title({id:2335,ai_summary:'ค่า กยศ'}),'ค่า กยศ');assert.ok(context.title({id:1}));
});
await fs.writeFile(path.join(process.env.SOLAO_TEST_OUTPUT_DIR,'expense-phase45-backend.json'),JSON.stringify({passed:true,checks,working_db:dbPath,protected_tables_unchanged:financial()===before},null,2));
sql.close();console.log(`expense phase 4/5: ${checks.length} groups passed`);
