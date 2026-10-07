import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readExpenseStatusSummary} from '../src/expense-status.js';
assert.equal(process.env.SOLAO_LOCAL_SIMULATION,'1');
assert.ok(os.tmpdir().startsWith('/Volumes/SSD Files/SOLAO/'));
const root=process.argv[2];assert.ok(root?.startsWith('/Volumes/SSD Files/SOLAO/'));
const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
const sha=async file=>crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
assert.equal(await sha(manifest.file),manifest.sha256);
const work=await fs.mkdtemp(path.join(os.tmpdir(),'expense-real-week-'));
const file=path.join(work,'rehearsal.sqlite');await fs.copyFile(manifest.file,file);await fs.chmod(file,0o600);
process.env.CAPTURE_DB_PATH=file;process.env.CAPTURE_DATA_DIR=work;
const api=await import('../src/db.js');await api.initDatabase();
const raw=new DatabaseSync(file);
const adapter={prepare:(sql,params=[])=>{const rows=raw.prepare(sql).all(...params);let i=-1;return {step:()=>++i<rows.length,getAsObject:()=>rows[i],free:()=>{}};}};
const date="CASE WHEN event_timestamp_ms>0 THEN date(event_timestamp_ms/1000+25200,'unixepoch') ELSE substr(created_at,1,10) END";
const rows=raw.prepare(`SELECT id,category,status FROM capture_items WHERE (${date}) BETWEEN ? AND ? ORDER BY id`).all(manifest.start,manifest.end);
const eligible=rows.filter(row=>['bill','payment_voucher','transfer','transfer_notice'].includes(row.category)&&!['unsent','duplicate'].includes(row.status));
const summary=readExpenseStatusSummary(adapter,{start:manifest.start,end:manifest.end});
const members=summary.transactions.flatMap(t=>[...t.bill_ids,...t.slip_ids]);assert.equal(members.length,new Set(members).size,'each confirmed evidence item belongs to one transaction');
const tables=['capture_items','capture_matches','capture_cash_payments','capture_daily_closings','ai_learning_examples','ai_category_learning_examples','line_messages','line_transfer_requests'];
const digest=()=>Object.fromEntries(tables.map(table=>[table,crypto.createHash('sha256').update(JSON.stringify(raw.prepare(`SELECT * FROM ${table} ORDER BY id`).all())).digest('hex')]));
const baseline=digest();const profiles=[];let checked=0,locked=0;const sourceCounts={},missing={};let branchOutsideChoices=0;
for(const row of eligible){const p=await api.getExpenseProfile(row.id);assert.ok(p);profiles.push(p);checked++;if(p.suggestions?.branch?.value&&!['คันคลอง','บ้านเจ๊','ผลิต','ส่วนกลาง'].includes(p.suggestions.branch.value))branchOutsideChoices++;if(p.edit_lock){locked++;const result=await api.updateExpenseProfile({id:row.id,input:{expected_revision:p.revision,status:'draft',fields:p.fields,reason:'Local SSD lock test'},actor:'local-test'});assert.equal(result.error,'round_closed');}for(const key of p.preparation.missing_fields)missing[key]=(missing[key]||0)+1;for(const [key,s]of Object.entries(p.suggestions||{}))if(s?.value)sourceCounts[key]=(sourceCounts[key]||0)+1;const json=JSON.stringify(p);assert.ok(!/"recipient_account_masked":\{"value":"\d{5,}/.test(json),'masked account exposure');}
assert.deepEqual(digest(),baseline,'reads and rejected closed-round saves must not change protected data');
// Rehearsal only: open copied closings to exercise writes. Original snapshot remains readonly.
raw.prepare("UPDATE capture_daily_closings SET status='open'").run();const rehearsalBaseline=digest();
const results={draft_ok:0,draft_errors:{},reviewed_ok:0,reviewed_rejections:{},adopted_fields:0};const cases=[];
for(const p of profiles){const fields=structuredClone(p.fields);for(const[key,suggestion]of Object.entries(p.suggestions||{})){if(!fields[key]?.value&&suggestion?.value){fields[key]=structuredClone(suggestion);results.adopted_fields++;}}
 const input={expected_revision:p.revision,status:'draft',fields,reason:'ทดสอบรับข้อเสนอจากหลักฐานบนสำเนา SSD ไม่ใช่ข้อมูลที่ยืนยันใช้งานจริง'};
 const draft=await api.updateExpenseProfile({id:p.item_id,input,actor:'local-week-rehearsal'});
 if(draft.error){results.draft_errors[draft.error]=(results.draft_errors[draft.error]||0)+1;cases.push({id:p.item_id,draft_error:draft.error,field:draft.field});continue;}
 results.draft_ok++;const read=await api.getExpenseProfile(p.item_id);assert.deepEqual(read.fields,draft.fields,'persisted draft reload');
 const reviewed=await api.updateExpenseProfile({id:p.item_id,input:{...input,expected_revision:draft.revision,status:'reviewed'},actor:'local-week-rehearsal'});
 if(reviewed.error){results.reviewed_rejections[reviewed.error]=(results.reviewed_rejections[reviewed.error]||0)+1;cases.push({id:p.item_id,review_error:reviewed.error,field:reviewed.field});}else{results.reviewed_ok++;assert.equal(reviewed.preparation.status==='ready',reviewed.preparation.fields_complete&&reviewed.status==='reviewed');}
}
assert.deepEqual(digest(),rehearsalBaseline,'profile drafts/review attempts cannot mutate protected data');
const candidate=raw.prepare(`SELECT m.id,m.match_group_key FROM capture_matches m JOIN capture_items s ON s.id=m.slip_item_id JOIN capture_items b ON b.id=m.bill_item_id WHERE m.status='pending' AND s.status NOT IN ('unsent','duplicate') AND b.status NOT IN ('unsent','duplicate') AND date(s.event_timestamp_ms/1000+25200,'unixepoch') BETWEEN ? AND ? ORDER BY m.score DESC,m.id LIMIT 1`).get(manifest.start,manifest.end);
let controlledPair=null;
if(candidate){
 const beforePairSummary=readExpenseStatusSummary(adapter,{start:manifest.start,end:manifest.end});
 const ids=candidate.match_group_key?raw.prepare("SELECT id FROM capture_matches WHERE status='pending' AND match_group_key=?").all(candidate.match_group_key).map(row=>row.id):[candidate.id];
 for(const id of ids)raw.prepare("UPDATE capture_matches SET status='confirmed' WHERE id=?").run(id);
 const beforeGroupedRead=digest();const grouped=readExpenseStatusSummary(adapter,{start:manifest.start,end:manifest.end});
 assert.deepEqual(grouped.totals,beforePairSummary.totals,'confirmed evidence grouping cannot alter document totals');
 const groupedIds=grouped.transactions.flatMap(t=>[...t.bill_ids,...t.slip_ids]);assert.equal(groupedIds.length,new Set(groupedIds).size);
 assert.deepEqual(digest(),beforeGroupedRead,'grouped summary is readonly');
 controlledPair={simulated_only:true,confirmed_edge_ids:ids,document_totals_unchanged:true,transaction_counts:grouped.transaction_counts,membership_unique:true};
}
assert.equal(await sha(manifest.file),manifest.sha256,'original fresh snapshot unchanged');
const report={scope:{start:manifest.start,end:manifest.end},snapshot_at:manifest.snapshot_at,working_db:file,total_images:rows.length,eligible_documents:eligible.length,locked_documents:locked,document_totals:summary.totals,transaction_counts:summary.transaction_counts,missing_fields:missing,suggestions_available:sourceCounts,branch_suggestions_outside_choices:branchOutsideChoices,rehearsal:results,controlled_pair_rehearsal:controlledPair,cases,protected_data_unchanged:true,original_snapshot_unchanged:true,notes:['All writes on rehearsal copy; its closings intentionally opened before baseline.','No inferred facts filled manually; reviewed attempts use existing facts + explicit suggestion rehearsal only.','Reviewed success means document facts, not posting or readiness.']};
const reportPath=path.join(process.env.SOLAO_TEST_OUTPUT_DIR,'real-week-test.json');await fs.writeFile(reportPath,JSON.stringify(report,null,2),{mode:0o600});raw.close();console.log(JSON.stringify({...report,cases:undefined,working_db:undefined,report:reportPath}));
