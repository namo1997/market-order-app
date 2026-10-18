import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { confirmIssueCandidates, stamp, iso } from '../src/models/receiving-issues-policy.js';
import { createIssue, listIssues, detailIssue, mapIssue, updateIssue } from '../src/models/receiving-issues-store.js';
import { scanConfirmedIssues, afterReceivingConfirm } from '../src/services/receiving-issues-followup.js';
import { issueDb } from './helpers/receiving-issues-db.mjs';
import { createReceivingHarness, deltaActor as user, makePngDataUrl } from './helpers/receiving-fake-db.mjs';
const now=new Date('2026-10-18T15:57:00Z');
const manager={role:'accountant',id:7};
const source=(id,patch={})=>({id,document_id:1,product_name:'ขา B',bill_text:'ทB',counted_quantity:'5',quantity_received:'5',quantity_billed:null,review_decision:'missing_bill',unit_price:null,unit_text:'กก.',...patch});

test('C3: creation ignores spoofed name, old alias issues resolve trusted product name without changing history',async()=>{
  const {db,state}=issueDb();state.lines[0].product_name='ขา B';state.lines[0].bill_text='ทB';
  const created=await createIssue(db,{...user,branch_id:1},{client_uuid:'c-name-test',document_id:1,line_id:11,type:'shortage',quantity:'1',product_name:'spoof'},now);
  assert.equal(created.issue.product_name,'ขา B');
  state.issues[0].product_name='ทB';
  for(const item of [(await listIssues(db,{...user,branch_id:1})).items[0],await detailIssue(db,manager,1)]){
    assert.equal(item.product_name,'ขา B');assert.equal(item.bill_text,'ทB');
  }
  assert.equal(state.issues[0].product_name,'ทB');assert.equal(state.history.length,1);
  await assert.rejects(detailIssue(db,{...user,branch_id:2},1),e=>e.statusCode===403);
});

test('C4: UTC database -> API -> Bangkok is independent of host; created and default due differ by 24h',async()=>{
  assert.equal(stamp('2026-10-18T22:57:00+07:00'),'2026-10-18 15:57:00.000');
  for(const input of ['2026-10-18 15:57:00.000000','2026-10-18T15:57:00Z','2026-10-18T22:57:00+07:00',now])assert.equal(iso(input),'2026-10-18T15:57:00.000Z');
  const {db}=issueDb();const {issue}=await createIssue(db,user,{client_uuid:'c-clock-test',document_id:1,type:'return',quantity:'1'},now);
  assert.equal(issue.created_at,'2026-10-18T15:57:00.000Z');assert.equal(issue.due_at,'2026-10-19T15:57:00.000Z');
  assert.equal(Date.parse(issue.due_at)-Date.parse(issue.created_at),86400000);
  const moduleUrl=new URL('../src/models/receiving-issues-policy.js',import.meta.url).href;
  for(const TZ of ['UTC','Asia/Bangkok','America/Los_Angeles']){
    const code=`import {iso} from ${JSON.stringify(moduleUrl)}; process.stdout.write(iso('2026-10-18 17:00:00.000000'))`;
    assert.equal(execFileSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,TZ},encoding:'utf8'}).trim(),'2026-10-18T17:00:00.000Z');
  }
  const row={...issue,due_at:'2026-10-18 17:00:00.000000',created_at:'2026-10-18 16:59:59.000000',updated_at:'2026-10-18 17:00:00.000000'};
  assert.equal(mapIssue(row).created_at,'2026-10-18T16:59:59.000Z');assert.equal(mapIssue(row).due_at,'2026-10-18T17:00:00.000Z');
});

test('C2: closed filter includes resolved and cancelled only, scoped by branch and paginated in SQL',async()=>{
  const {db,state}=issueDb();
  state.issues=[...Array.from({length:104},(_,i)=>({id:i+1,branch_id:i===103?2:1,status:i===0?'open':i===1?'waiting_supplier':i%2?'resolved':'cancelled',quantity:'1',amount:'0',due_at:stamp(now),created_at:stamp(now),updated_at:stamp(now)}))];
  const first=await listIssues(db,user,{status:'closed'});assert.equal(first.items.length,100);assert.equal(first.next_before_id,4);assert.ok(first.items.every(item=>item.branch_id===1&&['resolved','cancelled'].includes(item.status)));
  const next=await listIssues(db,user,{status:'closed',before_id:first.next_before_id});assert.equal(next.items.length,1);assert.equal(next.items[0].id,3);
});

test('C5: frozen decisions produce return from original count and bill request from received quantity; zero produces no issue',()=>{
  const lines=[source(11,{quantity_billed:'10',quantity_received:'9',counted_quantity:'9',review_decision:'short',unit_price:'60'}),source(12),source(13,{quantity_received:'0',review_decision:'not_received'}),source(14,{quantity_received:'0',counted_quantity:'0',review_decision:'not_received'})];
  const candidates=confirmIssueCandidates(lines,new Map());assert.equal(candidates.length,3);
  assert.deepEqual(candidates.map(c=>[c.type,c.quantity,c.amount]),[['shortage','1.00','60.00'],['wrong_item','5.00',null],['return','5.00',null]]);
  assert.equal(candidates[0].product_name,'ขา B');assert.match(candidates[1].note,/ไม่มีในบิล.*ขอบิลจากร้าน.*รอตรวจราคา/);assert.match(candidates[2].note,/คืนร้าน 5 กก./);assert.equal(candidates[2].quantity_received,'0');assert.equal(candidates[2].counted_quantity,'5');
});

test('C5: post-confirm hook retries partial failure idempotently and concurrent scans create one issue per line/type',async()=>{
  const {db,state}=issueDb();state.lines=[source(11),source(12,{review_decision:'not_received',quantity_received:'0'})];
  state.audits=[{document_id:1,details_json:JSON.stringify({issue_candidates:confirmIssueCandidates(state.lines,new Map())})}];
  let creates=0;
  const conn=db.getConnection.bind(db);db.getConnection=async()=>{const c=await conn();const q=c.query;c.query=async(sql,args)=>{if(sql.includes('INSERT INTO receiving_issues')&&++creates===2)throw Error('synthetic partial outage');return q(sql,args);};return c;};
  await afterReceivingConfirm(db,1);assert.equal(state.issues.length,1);assert.equal(state.scans.length,0);
  await Promise.all([scanConfirmedIssues(db,1,now),scanConfirmedIssues(db,1,now)]);
  assert.equal(state.issues.length,2);assert.equal(state.history.length,2);assert.equal(state.scans.length,1);assert.deepEqual(state.issues.map(i=>i.type),['wrong_item','return']);
  assert.equal(state.issues[0].auto_key,'auto-1-11-wrong_item');assert.equal(state.issues[1].auto_key,'auto-1-12-return');
  const before=structuredClone(state.issues);await scanConfirmedIssues(db,1,now);assert.deepEqual(state.issues,before);
});

test('C5: real confirm transaction freezes decisions before post-commit scan; rejected goods never enter inventory or receive twice',async()=>{
  let hooks=0,scan;const issues=issueDb();
  const h=await createReceivingHarness({prepareCount:false,testDate:'2026-10-18',afterReceivingConfirm:async()=>{
    hooks++;assert.equal(h.state.documents[0].status,'confirmed');
    const audit=h.state.audits.find(a=>a.action==='confirm');
    issues.state.audits=[{document_id:1,details_json:JSON.stringify(audit.details)}];
    issues.state.lines=h.state.lines.map(line=>({...line,document_id:1}));
    scan=scanConfirmedIssues(issues.db,1,now);await scan;
  }});
  const created=await h.invoke('createDocument',{user,body:{client_uuid:'c-confirm-test',delivery_date:h.today,product_group_id:3,order_item_ids:[50,51]}});assert.equal(created.statusCode,201);
  const doc=created.body.data,params={id:String(doc.id)};
  const counted=await h.invoke('saveCount',{user,params,body:{client_uuid:doc.client_uuid,lines:doc.lines.map(line=>({id:line.id,counted_quantity:'5'}))}});assert.equal(counted.statusCode,200);
  const [a,b]=counted.body.data.lines;
  const saved=await h.invoke('updateDocument',{user,params,body:{lines:[{id:a.id,quantity_received:'5',quantity_billed:null,review_decision:'missing_bill'},{id:b.id,quantity_received:'0',quantity_billed:null,remember_alias:false,review_decision:'not_received'}]}});assert.equal(saved.statusCode,200,JSON.stringify(saved.body));
  await h.invoke('addSignature',{user,params,body:{role:'receiver',image_data_url:makePngDataUrl()}});
  const confirmed=await h.invoke('confirmDocument',{user,params});assert.equal(confirmed.statusCode,200,JSON.stringify(confirmed.body));await scan;
  assert.equal(hooks,1);assert.equal(issues.state.issues.length,2);assert.deepEqual(issues.state.issues.map(i=>i.type),['wrong_item','return']);
  assert.ok(h.state.inventoryTransactions.length>0);assert.ok(h.state.inventoryTransactions.every(tx=>Number(tx.product_id)!==Number(b.product_id)));
  const inventory=structuredClone(h.state.inventoryTransactions);
  assert.equal((await h.invoke('confirmDocument',{user,params})).statusCode,409);assert.deepEqual(h.state.inventoryTransactions,inventory);assert.equal(issues.state.issues.length,2);
});
