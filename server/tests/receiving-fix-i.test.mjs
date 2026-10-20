import test from 'node:test';
import assert from 'node:assert/strict';
import { issueDb } from './helpers/receiving-issues-db.mjs';
import { createIssue, listIssues, detailIssue, attachEvidence, updateIssue } from '../src/models/receiving-issues-store.js';
import { makeJpegDataUrl } from './helpers/receiving-fake-db.mjs';
const staff={id:12,role:'user',branch_id:1,department_id:10};
const accounting={...staff,id:7,role:'accounting'};
const now=new Date('2026-10-19T12:00:00Z');
const status=code=>error=>error.statusCode===code;
async function seed() {
  const h=issueDb();
  await createIssue(h.db,staff,{client_uuid:'round-i-issue',document_id:1,line_id:11,type:'return',quantity:'1',amount:'60'},now);
  return h;
}
const closing={version:1,status:'resolved',resolution:'credit_note',resolution_amount:'60.00',resolution_ref_pending:true,owner_user_id:7};

test('I1/I4/I6 list and detail share scoped branch/owner names and evidence count; attachment does not close or change stock',async()=>{
  const {db,state}=await seed();
  let detail=await detailIssue(db,staff,1);
  assert.equal(detail.branch_name,'สาขาทดสอบหนึ่ง');assert.equal(detail.owner_name,null);assert.equal(detail.evidence_count,0);
  await updateIssue(db,accounting,1,{version:1,owner_user_id:7},now);
  const unchanged=structuredClone({docs:state.docs,lines:state.lines});
  await attachEvidence(db,staff,1,{client_uuid:'round-i-evidence',image_data_url:makeJpegDataUrl(),collector_name:'คนขับทดสอบ'},now);
  const list=await listIssues(db,staff);
  detail=await detailIssue(db,staff,1);
  for(const row of [list.items[0],detail]) {
    assert.equal(row.evidence_count,1);assert.equal(row.owner_name,'บัญชี');assert.equal(row.branch_name,'สาขาทดสอบหนึ่ง');assert.equal(row.status,'open');
    assert.equal('image_data' in row,false);
  }
  assert.deepEqual({docs:state.docs,lines:state.lines},unchanged);
  await assert.rejects(detailIssue(db,{...staff,branch_id:2},1),status(403));
  const outsider=await listIssues(db,{...staff,branch_id:2});assert.deepEqual(outsider.items,[]);
  assert.ok(state.queries.filter(q=>q.sql.includes('WHERE id IN')).every(q=>q.args.length>0&&q.sql.includes('?')));
});

test('I4/I6 deleted names stay null; inactive owner name remains visible without active-directory lookup',async()=>{
  const {db,state}=await seed();state.issues[0].owner_user_id=7;
  assert.equal((await detailIssue(db,accounting,1)).owner_name,'บัญชี');
  state.branches=[];state.users=[];
  const row=(await listIssues(db,accounting)).items[0];assert.equal(row.branch_name,null);assert.equal(row.owner_name,null);
});

test('I7 credit closure requires explicit pending choice, rejects strings/conflicts and missing new-bill references',async()=>{
  const {db,state}=await seed();
  for(const patch of [{resolution_ref_pending:undefined},{resolution_ref_pending:false},{resolution_ref_pending:'true'},
    {resolution:'new_bill'},{resolution_ref:'CN-ALREADY'},{status:'waiting_supplier'}]) {
    await assert.rejects(updateIssue(db,accounting,1,{...closing,...patch},now),status(422));
    assert.equal(state.issues[0].version,1);assert.equal(state.issues[0].status,'open');
  }
  const result=await updateIssue(db,accounting,1,closing,now);
  assert.equal(result.status,'resolved');assert.equal(result.resolution_ref,'');assert.equal(result.resolution_amount,'60.00');
  assert.equal((await detailIssue(db,accounting,1)).resolution_ref_pending,true);
  assert.equal(JSON.parse(state.history.at(-1).details_json).resolution_ref_pending,true);
});

test('I7 pending reference completes once with version and audit; rejects staff, closed-field changes, overwrite and stale request',async()=>{
  const {db,state}=await seed();await updateIssue(db,accounting,1,closing,now);
  const before=structuredClone(state.issues[0]);
  await assert.rejects(updateIssue(db,staff,1,{version:2,resolution_ref:'CN-001'},now),status(403));
  await assert.rejects(updateIssue(db,accounting,999,{version:2,resolution_ref:'CN-001'},now),status(404));
  await assert.rejects(updateIssue(db,accounting,1,{version:1,resolution_ref:'CN-001'},now),status(409));
  for(const ref of ['', '  ', 'a'.repeat(256)])await assert.rejects(updateIssue(db,accounting,1,{version:2,resolution_ref:ref},now),status(422));
  for(const patch of [{status:'open'},{resolution_amount:'0'},{owner_user_id:null},{note:'changed'}])
    await assert.rejects(updateIssue(db,accounting,1,{version:2,resolution_ref:'CN-001',...patch},now),status(409));
  const result=await updateIssue(db,accounting,1,{version:2,resolution_ref:' CN-001 '},now);
  assert.equal(result.resolution_ref,'CN-001');assert.equal(result.version,3);assert.equal(result.closed_at,new Date(before.closed_at.replace(' ','T')+'Z').toISOString());
  assert.equal(result.resolution_amount,before.resolution_amount);assert.equal(result.status,'resolved');
  assert.equal((await detailIssue(db,accounting,1)).resolution_ref_pending,false);
  assert.equal(state.history.at(-1).action,'reference_added');
  await assert.rejects(updateIssue(db,accounting,1,{version:3,resolution_ref:'CN-002'},now),status(409));
});

test('I7 reference audit failure rolls back reference/version; concurrent completion succeeds once and terminal paths remain closed',async()=>{
  const {db,state}=await seed();await updateIssue(db,accounting,1,closing,now);
  const before=structuredClone({issues:state.issues,history:state.history});state.fail='INSERT INTO receiving_issue_history';
  await assert.rejects(updateIssue(db,accounting,1,{version:2,resolution_ref:'CN-001'},now));
  assert.deepEqual({issues:state.issues,history:state.history},before);state.fail=null;
  const results=await Promise.allSettled(['CN-001','CN-002'].map(resolution_ref=>updateIssue(db,accounting,1,{version:2,resolution_ref},now)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.statusCode,409);
  for(const [statusValue,resolution] of [['cancelled',null],['resolved','returned'],['resolved','new_bill']]) {
    Object.assign(state.issues[0],{status:statusValue,resolution,resolution_ref:null});
    await assert.rejects(updateIssue(db,accounting,1,{version:3,resolution_ref:'CN-003'},now),status(409));
  }
});
