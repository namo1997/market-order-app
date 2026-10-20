import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmIssueCandidates} from '../src/models/receiving-issues-policy.js';
import {groupBillRequests,scanConfirmedIssues} from '../src/services/receiving-issues-followup.js';
import {detailIssue,listIssues,attachEvidence,createIssue,updateIssue} from '../src/models/receiving-issues-store.js';
import {issueDb} from './helpers/receiving-issues-db.mjs';
import {createReceivingHarness,deltaActor as user,makePngDataUrl,makeJpegDataUrl} from './helpers/receiving-fake-db.mjs';
const now=new Date('2026-10-18T00:00:00Z');
const line=(id,patch={})=>({id,document_id:1,product_name:['ขา B','ปีกกลาง','ปีกบน','อกไก่'][id-11],bill_text:'ทB',unit_text:'กก.',quantity_billed:null,counted_quantity:'5',quantity_received:'5',review_decision:'missing_bill',unit_price:null,...patch});
const staff={id:12,role:'user',branch_id:1,department_id:10};
const accountant={id:7,role:'accounting'};
const setup=()=>{const h=issueDb();h.state.lines=[line(11,{quantity_billed:'10',counted_quantity:'9',quantity_received:'9',review_decision:'short',unit_price:'60'}),line(12),line(13),line(14)];h.state.audits=[{document_id:1,details_json:JSON.stringify({issue_candidates:confirmIssueCandidates(h.state.lines,new Map())})}];return h;};

test('D4 three missing bills become one request with frozen item units; shortage remains independent; concurrent/repeated hook is idempotent',async()=>{
  const {db,state}=setup();
  await Promise.all([scanConfirmedIssues(db,1,now),scanConfirmedIssues(db,1,now)]);await scanConfirmedIssues(db,1,now);
  assert.equal(state.issues.length,2);assert.equal(state.scans.length,1);assert.equal(state.history.length,2);
  const shortage=state.issues.find(i=>i.type==='shortage'),request=state.issues.find(i=>i.type==='wrong_item');
  assert.equal(shortage.line_id,11);assert.equal(shortage.quantity,'1.00');assert.equal(shortage.amount,'60.00');
  assert.equal(request.line_id,null);assert.equal(request.quantity,'3.00');assert.equal(request.auto_key,'auto-1-bill-request');
  assert.match(request.note,/ขอบิลเพิ่ม 3 รายการ: ปีกกลาง 5 กก., ปีกบน 5 กก., อกไก่ 5 กก./);
  const detail=await detailIssue(db,staff,request.id);assert.equal(detail.unit_text,'รายการ');assert.equal(detail.request_items.length,3);
  assert.deepEqual(detail.request_items.map(i=>i.unit_text),['กก.','กก.','กก.']);
  const items=(await listIssues(db,staff)).items;assert.equal(items.find(i=>i.id===request.id).request_items.length,3);assert.equal(items.find(i=>i.id===shortage.id).unit_text,'กก.');
  await assert.rejects(detailIssue(db,{...staff,branch_id:2},request.id),e=>e.statusCode===403);
});

test('D4 failed partial scan retries frozen group once without duplicating shortage or leaking current line changes',async()=>{
  const {db,state}=setup();let failed=false;
  // Fail only after the first issue committed, as a process/network failure could.
  db.getConnection=(()=>{const get=db.getConnection;return async()=>{const conn=await get();const query=conn.query;conn.query=async(sql,args)=>{if(!failed&&sql.startsWith('INSERT INTO receiving_issues')&&args[2]==='wrong_item'){failed=true;throw Error('SYNTHETIC failure');}return query(sql,args);};return conn;};})();
  await assert.rejects(scanConfirmedIssues(db,1,now));assert.equal(state.scans.length,0);assert.equal(state.issues.length,1);
  state.lines[1].quantity_received='99';await scanConfirmedIssues(db,1,now);await scanConfirmedIssues(db,1,now);
  assert.equal(state.issues.length,2);assert.equal(state.history.length,2);assert.equal(state.scans.length,1);
  assert.equal((await detailIssue(db,staff,state.issues[1].id)).request_items[0].quantity,'5.00');
});

test('D4 group only bill requests, merges same product/unit exactly and retains mixed units and return/shortage keys',()=>{
  const candidates=confirmIssueCandidates([line(11),line(12,{product_name:'ขา B',quantity_received:'0.1'}),line(13,{product_name:'ขา B',quantity_received:'0.2'}),line(14,{product_name:'ขา B',unit_text:'ถุง'}),line(15,{review_decision:'not_received',quantity_received:'0'})],new Map());
  const grouped=groupBillRequests(candidates);assert.equal(grouped.length,2);assert.equal(grouped[1].type,'return');
  assert.equal(grouped[0].request_items.length,2);assert.equal(grouped[0].request_items[0].quantity,'5.30');assert.equal(grouped[0].request_items[1].unit_text,'ถุง');
  assert.equal(groupBillRequests([]).length,0);
});

test('D1 return decision persists collection status, validates input, preserves blind count and creates exactly one automatic return after confirm',async()=>{
  for(const return_status of ['waiting','collected']){
    let candidates;
    const h=await createReceivingHarness({testDate:'2026-10-18',afterReceivingConfirm:async()=>{candidates=h.state.audits.find(a=>a.action==='confirm').details.issue_candidates;}});
    const created=await h.invoke('createDocument',{user,body:{client_uuid:`fix-d-${return_status}`,delivery_date:h.today,kind:'bill',product_group_id:3,order_item_ids:[50,51]}});
    const id=created.body.data.id,lineId=created.body.data.lines[0].id;
    const accepted=created.body.data.lines[1];
    assert.equal((await h.invoke('updateDocument',{user,params:{id},body:{lines:[{id:accepted.id,quantity_received:'1',quantity_billed:'1',review_decision:'accept'}]}})).statusCode,200);
    // The harness prepares its blind count before updates, as the existing endpoint tests do.
    const changed=await h.invoke('updateDocument',{user,params:{id},body:{lines:[{id:lineId,quantity_billed:null,quantity_received:'0',remember_alias:false,review_decision:'not_received',return_status}]}});
    assert.equal(changed.statusCode,200);assert.equal(changed.body.data.lines[0].return_status,return_status);assert.ok(changed.body.data.lines[0].counted_quantity);
    const before=structuredClone(h.state.lines);
    const bad=await h.invoke('updateDocument',{user,params:{id},body:{lines:[{id:lineId,quantity_received:'0',remember_alias:false,review_decision:'not_received',return_status:'invalid'}]}});assert.equal(bad.statusCode,422);assert.deepEqual(h.state.lines,before);
    await h.invoke('addSignature',{user,params:{id},body:{role:'receiver',image_data_url:makePngDataUrl()}});
    const confirmed=await h.invoke('confirmDocument',{user,params:{id}});assert.equal(confirmed.statusCode,200);
    assert.equal(candidates.length,1);assert.equal(candidates[0].type,'return');assert.equal(candidates[0].return_status,return_status);assert.equal(Number(candidates[0].quantity_received),0);
    const {db,state}=issueDb();state.lines[0].return_status=return_status;state.audits=[{document_id:1,details_json:JSON.stringify({issue_candidates:candidates.map(c=>({...c,line_id:11}))})}];
    await scanConfirmedIssues(db,1,now);await scanConfirmedIssues(db,1,now);assert.equal(state.issues.length,1);assert.equal(state.issues[0].type,'return');
    assert.match(state.issues[0].note,return_status==='collected'?/ร้านมารับแล้ว/:/รอร้านมารับ/);
  }
});

test('D6 own-branch staff submit shortages/bill evidence idempotently; cannot close or cross branches; other types forbidden',async()=>{
  const {db,state}=setup();await scanConfirmedIssues(db,1,now);
  const proof={client_uuid:'d-proof-0001',image_data_url:makeJpegDataUrl(),note:'SYNTHETIC ร้านส่งมาแล้ว'};
  for(const issue of state.issues){
    await assert.rejects(attachEvidence(db,{...staff,branch_id:2},issue.id,proof,now),e=>e.statusCode===403);
    const results=await Promise.all([attachEvidence(db,staff,issue.id,proof,now),attachEvidence(db,staff,issue.id,proof,now)]);
    assert.deepEqual(results.map(r=>r.created),[true,false]);
    await assert.rejects(updateIssue(db,staff,issue.id,{version:1,status:'resolved',resolution:'new_bill',resolution_ref:'SYN-1'},now),e=>e.statusCode===403);
    await updateIssue(db,accountant,issue.id,{version:1,status:'resolved',resolution:issue.type==='shortage'?'redelivered':'new_bill',resolution_ref:'SYN-1'},now);
    await assert.rejects(attachEvidence(db,staff,issue.id,{...proof,client_uuid:'d-proof-0002'},now),e=>e.statusCode===409);
  }
  const other=await createIssue(db,staff,{document_id:1,client_uuid:'d-other-0001',type:'wrong_item',quantity:'1',note:'สินค้าไม่ตรง'},now);
  await assert.rejects(attachEvidence(db,staff,other.issue.id,proof,now),e=>e.statusCode===403);
});
