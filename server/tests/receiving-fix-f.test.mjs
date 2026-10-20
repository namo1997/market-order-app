import test from 'node:test';
import assert from 'node:assert/strict';
import { ledgerDetail } from '../src/models/receiving-admin.model.js';
import { adminAudit } from '../src/models/receiving-admin-history.js';
import { createReceivingHarness } from './helpers/receiving-fake-db.mjs';

test('F1 audit projection allowlists count/decision snapshots, tolerates legacy JSON and hides blind decisions',()=>{
  const audit={id:1,action:'edit_after_bill_reveal',actor_name:'ผู้รับ',created_at:'2026-10-18 12:00:00',
    details_json:JSON.stringify({updated_lines_count:1,private:'must-not-leak',decisions:[{id:4,product_name:'ขา B',unit_text:'กก.',review_decision:'short',quantity_received:'9',quantity_billed:'10',image_data:'must-not-leak'},null,{review_decision:'unknown'}]})};
  const result=adminAudit(audit);assert.equal(result.line_count,1);assert.equal(result.decisions.length,1);
  assert.equal(result.decisions[0].quantity_received,'9');assert.doesNotMatch(JSON.stringify(result),/must-not-leak|details_json|image_data/);
  assert.equal(adminAudit(audit,true).decisions,undefined);
  for(const details_json of ['bad','null','[]','{}'])assert.equal(adminAudit({...audit,details_json}).decisions,undefined);
  assert.equal(adminAudit({action:'blind_count',details_json:JSON.stringify({lines:[{},{},{},{}]})}).line_count,4);
});
test('F1 update records immutable persisted decisions in the same transaction; failed audit rolls back edits',async()=>{
  let rejectAudit=false;
  const h=await createReceivingHarness({queryHook:sql=>{if(rejectAudit&&sql.includes('INSERT INTO receiving_document_audits'))throw Error('synthetic audit failure');}});
  const user={id:12,name:'ผู้รับ',role:'user',branch_id:1,department_id:10};
  const created=await h.invoke('createDocument',{user,body:{client_uuid:'fix-f-history',delivery_date:h.today,kind:'bill',product_group_id:3,order_item_ids:[50]}});
  assert.equal(created.statusCode,201);const id=created.body.data.id;const line=h.state.lines.find(l=>l.document_id===id);
  const update=quantity=>h.invoke('updateDocument',{user,params:{id:String(id)},body:{lines:[{id:line.id,quantity_received:quantity,quantity_billed:'10',unit_price:'60',review_decision:'short'}]}});
  const first=await update('9');assert.equal(first.statusCode,200);
  const audit=h.state.audits.filter(a=>a.action==='edit_after_bill_reveal').at(-1);
  assert.equal(audit.details.decisions[0].quantity_received,'9');assert.equal(audit.details.decisions[0].review_decision,'short');
  const second=await update('8');assert.equal(second.statusCode,200);assert.equal(audit.details.decisions[0].quantity_received,'9');
  const before=JSON.stringify({lines:h.state.lines,audits:h.state.audits});rejectAudit=true;
  const failed=await update('7');assert.equal(failed.statusCode,500);
  assert.equal(JSON.stringify({lines:h.state.lines,audits:h.state.audits}),before);
});
test('F4 ledger detail scopes all related issues by parameterized document ID and returns safe summaries for every accounting role',async()=>{
  for(const role of ['admin','super_admin','accounting','accountant']){
    const calls=[];
    const db={async query(sql,params){calls.push({sql,params});assert.match(sql.trim(),/^SELECT /);
      if(sql.includes('FROM receiving_documents rd'))return [[{id:5,status:'confirmed',branch_id:2,department_id:20}]];
      if(sql.includes('FROM receiving_document_audits'))return [[{id:1,action:'blind_count',details_json:'{"lines":[{}]}'}]];
      if(sql.includes('FROM receiving_issues')){assert.match(sql,/WHERE document_id = \? ORDER BY id DESC/);assert.deepEqual(params,[5]);assert.doesNotMatch(sql,/status IN|LIMIT|image_data|details_json/);return [[{id:3,type:'return',status:'resolved'},{id:2,type:'wrong_item',auto_key:'auto-5-bill-request'},{id:1,type:'shortage'}]];}
      return [[]];
    }};
    const detail=await ledgerDetail(db,{user:{role},id:'5'});assert.equal(detail.issues.length,3);assert.equal(detail.audits[0].line_count,1);
    assert.doesNotMatch(JSON.stringify(detail.audits),/details_json/);
  }
  let queried=false;const db={query(){queried=true;throw Error('no SQL');}};
  await assert.rejects(ledgerDetail(db,{user:{role:'user'},id:5}),e=>e.code==='FORBIDDEN');assert.equal(queried,false);
  await assert.rejects(ledgerDetail(db,{user:{role:'accounting'},id:'5 OR 1=1'}),e=>e.code==='VALIDATION_FAILED');assert.equal(queried,false);
});
test('F1 F4 blind drafts reveal neither historical decisions nor issue summaries',async()=>{
  const db={async query(sql){
    if(sql.includes('FROM receiving_documents rd'))return [[{id:5,status:'draft',branch_id:1,department_id:10,counted_complete_at:null}]];
    if(sql.includes('FROM receiving_document_audits'))return [[{action:'edit_after_bill_reveal',details_json:'{"decisions":[{"review_decision":"short","quantity_billed":"999"}]}'}]];
    assert.doesNotMatch(sql,/FROM receiving_issues/);return [[]];
  }};
  const detail=await ledgerDetail(db,{user:{role:'accounting'},id:5});assert.equal(detail.blind,true);
  assert.deepEqual(detail.issues,[]);assert.equal(detail.audits[0].decisions,undefined);assert.doesNotMatch(JSON.stringify(detail),/999/);
});
