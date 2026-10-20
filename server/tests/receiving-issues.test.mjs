import test from 'node:test';
import assert from 'node:assert/strict';
import {createIssue,listIssues,detailIssue,updateIssue,attachEvidence,evidenceBinary} from '../src/models/receiving-issues-store.js';
import {afterReceivingConfirm,scanConfirmedIssues,discoverIssueFollowups} from '../src/services/receiving-issues-followup.js';
import {confirmIssueCandidates,discrepancies,units,decimal,due} from '../src/models/receiving-issues-policy.js';
import {ISSUE_DDL,ensureIssueTables} from '../src/models/receiving-issues-schema.js';
import {issueDb} from './helpers/receiving-issues-db.mjs';
import {makePngDataUrl,makeJpegDataUrl,createReceivingHarness} from './helpers/receiving-fake-db.mjs';
const user={id:12,name:'ผู้รับ',role:'user',branch_id:1,department_id:10};
const accountant={...user,id:7,role:'accounting'};
const now=new Date('2026-10-18T00:00:00Z');
const body=(extra={})=>({client_uuid:'manual-issue-0001',document_id:1,line_id:11,type:'return',quantity:'1.00',amount:'0.10',due_at:'2026-10-18T08:00:00+07:00',...extra});
const proof=(extra={})=>({client_uuid:'proof-fixture-0001',image_data_url:makeJpegDataUrl(),collector_name:'คนขับรถ',signature_data_url:makePngDataUrl(),...extra});
const status=code=>e=>e.statusCode===code;
async function seeded(extra={}){const h=issueDb();h.row=(await createIssue(h.db,user,body(extra),now)).issue;return h;}

test('issue create: trusted document/line scope, validation, 403/404/409, idempotency including concurrent retry',async()=>{
  const {db,state}=issueDb();
  const results=await Promise.all([createIssue(db,user,body(),now),createIssue(db,user,body(),now)]);
  assert.equal(state.issues.length,1);assert.equal(state.history.length,1);assert.deepEqual(results.map(r=>r.created),[true,false]);
  assert.equal(results[0].issue.supplier_name,'ร้านผัก');assert.equal(results[0].issue.branch_id,1);
  await assert.rejects(createIssue(db,user,body({quantity:'2'}),now),status(409));
  await assert.rejects(createIssue(db,user,body({document_id:2,line_id:21}),now),status(403));
  await assert.rejects(createIssue(db,user,body({document_id:999}),now),status(404));
  await assert.rejects(createIssue(db,user,body({line_id:21}),now),status(404));
  for(const extra of [{type:'injected'},{quantity:'-1'},{quantity:'0'},{quantity:'1.001'},{amount:'10000000000'},{client_uuid:'bad'},{due_at:'2026-10-18T09:00'},{note:'x'.repeat(1001)}])await assert.rejects(createIssue(db,user,body(extra),now),status(422));
  state.docs[0].status='draft';await assert.rejects(createIssue(db,user,body(),now),status(409));
});

test('issue list/detail: staff own branch across departments; accounting all branches; filters, pagination, no blob leaks',async()=>{
  const {db,state}=await seeded();await createIssue(db,accountant,body({client_uuid:'manual-issue-0002',document_id:2,line_id:21,type:'damaged'}),now);
  assert.equal((await listIssues(db,user)).items.length,1);assert.equal((await listIssues(db,{...user,department_id:99})).items.length,1);
  assert.equal((await listIssues(db,accountant)).items.length,2);
  assert.equal((await listIssues(db,accountant,{branch_id:2,type:'damaged',supplier:'ร้าน',min_age_days:1},new Date('2026-10-20T00:00:00Z'))).items.length,1);
  assert.equal((await listIssues(db,user,{branch_id:2})).items.length,0);
  await assert.rejects(detailIssue(db,user,2),status(403));await assert.rejects(detailIssue(db,user,999),status(404));
  await assert.rejects(listIssues(db,user,{status:'bad'}),status(422));await assert.rejects(listIssues(db,{...user,branch_id:null}),status(403));
  for(let i=3;i<=105;i++)state.issues.push({...state.issues[0],id:i});
  const page=await listIssues(db,user);assert.equal(page.items.length,100);assert.ok(page.next_before_id);
  const next=await listIssues(db,user,{before_id:page.next_before_id});assert.equal(next.items.length,4);
  const detail=await detailIssue(db,user,1);assert.equal(detail.history.length,1);assert.equal(detail.evidence.length,0);assert.doesNotMatch(JSON.stringify(detail),/image_data|signature_data/);
});

test('issue transitions: manager only, optimistic race, all resolutions, terminal freeze, owner validation, audit and rollback',async()=>{
  const h=await seeded();const id=h.row.id;
  await assert.rejects(updateIssue(h.db,user,id,{version:1,status:'waiting_supplier'}),status(403));
  await assert.rejects(updateIssue(h.db,accountant,999,{version:1}),status(404));
  await assert.rejects(updateIssue(h.db,accountant,id,{version:1,status:'bad'}),status(422));
  await assert.rejects(updateIssue(h.db,accountant,id,{version:1,owner_user_id:999}),status(422));
  const concurrent=await Promise.allSettled([1,2].map(()=>updateIssue(h.db,accountant,id,{version:1,status:'waiting_supplier',owner_user_id:7,note:'โทรตามแล้ว'},now)));
  assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal(concurrent.find(r=>r.status==='rejected').reason.statusCode,409);
  await assert.rejects(updateIssue(h.db,accountant,id,{version:2,status:'open'}),status(409));
  await assert.rejects(updateIssue(h.db,accountant,id,{version:2,status:'resolved',resolution:'credit_note'}),status(422));
  const before=structuredClone(h.state.issues);h.state.fail='INSERT INTO receiving_issue_history';
  await assert.rejects(updateIssue(h.db,accountant,id,{version:2,status:'resolved',resolution:'redelivered'}));assert.deepEqual(h.state.issues,before);h.state.fail=null;
  await updateIssue(h.db,accountant,id,{version:2,status:'resolved',resolution:'new_bill',resolution_ref:'NEW-01',resolution_amount:'0.10'},now);
  assert.equal(h.state.issues[0].resolution_ref,'NEW-01');await assert.rejects(updateIssue(h.db,accountant,id,{version:3,status:'open'}),status(409));
  for(const resolution of ['redelivered','credit_note','written_off','returned']){
    const f=await seeded();if(resolution==='returned')await attachEvidence(f.db,user,1,proof(),now);
    await updateIssue(f.db,accountant,1,{version:1,status:'resolved',resolution,resolution_ref:'CN-1',note:'ตกลงแล้ว'},now);
    assert.equal(f.state.issues[0].resolution,resolution);
  }
  const f=await seeded();await assert.rejects(updateIssue(f.db,accountant,1,{version:1,status:'cancelled'}),status(422));
  await updateIssue(f.db,accountant,1,{version:1,status:'cancelled',note:'แจ้งซ้ำ'},now);assert.equal(f.state.issues[0].status,'cancelled');
});

test('evidence: magic/size/count, return collector, optional PNG signature, protected reads, retry, closed freeze, transactional audit',async()=>{
  const {db,state}=await seeded();
  await assert.rejects(attachEvidence(db,user,1,proof({collector_name:''}),now),status(422));
  await assert.rejects(attachEvidence(db,user,1,proof({image_data_url:'data:image/jpeg;base64,aGVsbG8='}),now),status(422));
  await assert.rejects(attachEvidence(db,user,1,proof({image_data_url:'data:image/jpeg;base64,'+'A'.repeat(5*1024*1024)}),now),status(413));
  await assert.rejects(attachEvidence(db,{...user,branch_id:2},1,proof(),now),status(403));
  await assert.rejects(attachEvidence(db,user,999,proof(),now),status(404));
  const result=await Promise.all([attachEvidence(db,user,1,proof(),now),attachEvidence(db,user,1,proof(),now)]);assert.deepEqual(result.map(r=>r.created),[true,false]);assert.equal(state.evidence.length,1);
  await assert.rejects(attachEvidence(db,user,1,proof({collector_name:'เปลี่ยนชื่อ'}),now),status(409));
  assert.ok((await evidenceBinary(db,user,1,1,'signature')).buffer.length);assert.equal((await evidenceBinary(db,accountant,1,1)).mime,'image/jpeg');
  await assert.rejects(evidenceBinary(db,{...user,branch_id:2},1,1),status(403));await assert.rejects(evidenceBinary(db,user,1,999),status(404));await assert.rejects(evidenceBinary(db,user,1,1,'bad'),status(422));
  const detail=await detailIssue(db,user,1);assert.equal(detail.evidence[0].has_signature,true);assert.doesNotMatch(JSON.stringify(detail),/base64|signature_data|image_data/);
  state.fail='INSERT INTO receiving_issue_history';await assert.rejects(attachEvidence(db,user,1,proof({client_uuid:'new-proof-0002'}),now));assert.equal(state.evidence.length,1);state.fail=null;
  for(let i=2;i<=10;i++)await attachEvidence(db,user,1,proof({client_uuid:`proof-fixture-00${i}`,signature_data_url:null}),now);
  await assert.rejects(attachEvidence(db,user,1,proof({client_uuid:'proof-too-many'}),now),status(422));
  await updateIssue(db,accountant,1,{version:1,status:'resolved',resolution:'returned'},now);
  await assert.rejects(attachEvidence(db,user,1,proof({client_uuid:'proof-after-close'}),now),status(409));
  assert.equal((await attachEvidence(db,user,1,proof(),now)).created,false);
  const f=await seeded({type:'damaged'});await assert.rejects(attachEvidence(f.db,user,1,proof(),now),status(403));
  await assert.rejects(updateIssue(f.db,accountant,1,{version:1,status:'resolved',resolution:'returned'},now),status(422));
});

test('automatic discrepancies: pre-confirm outstanding count, exact satang/rounding, zero receipts, over, no failure blocks confirm',async()=>{
  const rows=confirmIssueCandidates([{id:11,order_item_id:50,quantity_billed:'2',quantity_received:'0.10',unit_price:'0.100000'},{id:12,quantity_billed:'0.10',quantity_received:'0.30',unit_price:'0.10'}],new Map([[50,{quantity:'0.50',received_quantity:'0.20'}]]));
  assert.equal(rows[0].quantity,'0.20');assert.equal(rows[0].amount,'0.02');assert.equal(rows[1].type,'over');
  assert.equal(decimal(units('0.1')+units('0.2')),'0.30');assert.equal(discrepancies([{id:1,quantity_billed:'1',quantity_received:0,unit_price:'0.005'}])[0].amount,'0.01');
  assert.equal(discrepancies([{id:1,quantity_billed:'2',quantity_received:0,unit_price:'0.005'}])[0].amount,'0.01');
  assert.equal(confirmIssueCandidates([{quantity_billed:'broken'}],new Map()),null);
  const {db,state}=issueDb();await Promise.all([scanConfirmedIssues(db,1,now),scanConfirmedIssues(db,1,now)]);
  assert.equal(state.issues.length,1);assert.equal(state.issues[0].type,'shortage');assert.equal(state.scans.length,1);
  state.fail='INSERT INTO receiving_issues';await afterReceivingConfirm(db,2);assert.equal(state.scans.length,1);state.fail=null;
  await scanConfirmedIssues(db,2,now);assert.equal(state.issues[1].type,'over');
});

test('confirm freezes candidates in audit before balances change, hook after commit, failure isolated',async()=>{
  let called=0;let bundle;
  const h=await createReceivingHarness({testDate:'2026-10-18',afterReceivingConfirm:async()=>{called++;assert.equal(h.state.documents[0].status,'confirmed');}});
  const doc=await h.invoke('createDocument',{user,body:{client_uuid:'issue-hook-receipt',delivery_date:h.today,kind:'bill',product_group_id:3,order_item_ids:[50]}});
  const id=doc.body.data.id;const line=doc.body.data.lines[0];
  assert.equal((await h.invoke('updateDocument',{user,params:{id},body:{lines:[{id:line.id,quantity_received:'1',quantity_billed:'3',unit_price:'0.10',review_decision:'short'}]}})).statusCode,200);
  await h.invoke('addSignature',{user,params:{id},body:{role:'receiver',image_data_url:makePngDataUrl()}});
  bundle=await h.invoke('confirmDocument',{user,params:{id}});assert.equal(bundle.statusCode,200);assert.equal(called,1);
  const audit=h.state.audits.find(a=>a.action==='confirm');assert.equal(audit.details.issue_candidates[0].type,'shortage');
});

test('overdue reminders: UTC/Bangkok boundary, durable dedupe/race, reschedule, closure sync and rollback',async()=>{
  const h=await seeded();for(const doc of h.state.docs)h.state.scans.push({document_id:doc.id});
  await discoverIssueFollowups(h.db,new Date('2026-10-18T00:59:59Z'));assert.equal(h.state.followups.length,0);
  await Promise.all([discoverIssueFollowups(h.db,new Date('2026-10-18T01:00:00Z')),discoverIssueFollowups(h.db,new Date('2026-10-18T01:00:00Z'))]);
  assert.equal(h.state.followups.length,1);assert.equal(JSON.parse(h.state.followups[0].pending_items_json)[0].issue_id,1);
  await updateIssue(h.db,accountant,1,{version:1,status:'waiting_supplier',due_at:'2026-10-19T08:00:00+07:00'},now);
  assert.equal(h.state.followups[0].status,'resolved');
  h.state.fail='INSERT INTO receiving_issue_reminders';await assert.rejects(discoverIssueFollowups(h.db,new Date('2026-10-19T02:00:00Z')));assert.equal(h.state.followups.length,1);h.state.fail=null;
  await discoverIssueFollowups(h.db,new Date('2026-10-19T02:00:00Z'));assert.equal(h.state.followups.length,2);
  await updateIssue(h.db,accountant,1,{version:2,status:'resolved',resolution:'redelivered'},now);assert.ok(h.state.followups.every(f=>f.status==='resolved'));
  assert.equal(due('2026-10-19T00:00:00+07:00'),'2026-10-18 17:00:00.000');
});

test('schema: idempotent, receiving-only, bounded DECIMAL and query indexes; production opt-in',async()=>{
  assert.equal(ISSUE_DDL.length,6);for(const ddl of ISSUE_DDL)assert.match(ddl,/^CREATE TABLE IF NOT EXISTS receiving_issue/);
  assert.match(ISSUE_DDL.join('\n'),/DECIMAL\(12,2\)/);assert.match(ISSUE_DDL.join('\n'),/idx_issue_due/);
  const calls=[];const db={query:async sql=>calls.push(sql)};await ensureIssueTables(db,{env:{NODE_ENV:'production'}});assert.equal(calls.length,0);
  await ensureIssueTables(db,{force:true});await ensureIssueTables(db,{force:true});assert.equal(calls.length,12);
});

test('linked issue followup can be acknowledged but cannot be resolved without the issue resolution endpoint',async()=>{
  const {queueDb}=await import('./helpers/receiving-queue-db.mjs');
  const {updateFollowup}=await import('../src/models/receiving-followups-store.js');
  const {db,state}=queueDb();state.rows.push({id:1,branch_id:1,department_id:10,status:'open',created_at:'2026-10-18 00:00:00.000',updated_at:'2026-10-18 00:00:00.000',pending_items_json:JSON.stringify([{issue_id:1,order_item_id:-1}])});
  await updateFollowup(db,{user:accountant,id:1,status:'acknowledged',now});
  await assert.rejects(updateFollowup(db,{user:accountant,id:1,status:'resolved',now}),status(409));assert.equal(state.rows[0].status,'acknowledged');
});

test('integration A issue candidates compare receipt to bill, preserve count/decision and keep order shortage separate',()=>{
 const ordered=new Map([[50,{quantity:'20',received_quantity:'0'}]]);
 const row={id:11,order_item_id:50,product_name:'ผัก',counted_quantity:'8',quantity_received:'8',quantity_billed:'10',unit_price:'2',review_decision:'short'};
 const [issue]=confirmIssueCandidates([row],ordered);
 assert.equal(issue.quantity,'2.00');assert.equal(issue.amount,'4.00');assert.equal(issue.type,'shortage');
 assert.equal(issue.comparison,'bill');assert.equal(issue.counted_quantity,'8');assert.equal(issue.review_decision,'short');
 assert.equal(confirmIssueCandidates([{...row,quantity_billed:'8',review_decision:'accept'}],ordered).length,0);
 assert.equal(confirmIssueCandidates([{...row,quantity_billed:null,review_decision:'missing_bill'}],ordered)[0].type,'wrong_item');
 assert.equal(confirmIssueCandidates([{...row,quantity_billed:null,quantity_received:'0',review_decision:'not_received'}],ordered)[0].type,'return');
 assert.equal(confirmIssueCandidates([{...row,review_decision:'wrong_product'}],ordered)[0].type,'wrong_item');
 const [corrected]=confirmIssueCandidates([{...row,quantity_received:'9'}],ordered);
 assert.equal(corrected.quantity,'1.00');assert.equal(corrected.counted_quantity,'8');
});

test('skip_receiving_required groups never generate issue followup reminders',async()=>{
  const h=await seeded();for(const doc of h.state.docs)h.state.scans.push({document_id:doc.id});
  h.state.docs[0].product_group_id=3;h.state.docs[0].skip_receiving_required=true;
  await discoverIssueFollowups(h.db,new Date('2026-10-19T02:00:00Z'));
  assert.equal(h.state.followups.length,0);assert.equal(h.state.reminders.length,0);
  h.state.docs[0].skip_receiving_required=false;
  await discoverIssueFollowups(h.db,new Date('2026-10-19T02:00:00Z'));
  assert.equal(h.state.followups.length,1);
});
