import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
assert.ok(process.env.SOLAO_LOCAL_SIMULATION === '1' && os.tmpdir().startsWith('/Volumes/SSD Files/SOLAO/'), 'Use SSD snapshot runner');
const root=path.resolve(import.meta.dirname,'..');
process.env.CAPTURE_DATA_DIR=await fs.mkdtemp(path.join(os.tmpdir(),'receipt-void-http-'));
process.env.CAPTURE_DB_PATH=path.join(process.env.CAPTURE_DATA_DIR,'fictional.sqlite');
const db=await import('../src/db.js');await db.initDatabase();
const sql=new DatabaseSync(process.env.CAPTURE_DB_PATH);
// The server can still be persisting its decision audit when fixture setup resumes.
sql.exec('PRAGMA busy_timeout=5000');
const now='2026-10-07T03:00:00.000Z', stamp=Date.parse(now);
const insert=sql.prepare(`INSERT INTO capture_items(id,line_message_id,source_type,source_id,category,status,slip_amount_value,bill_total_value,match_status,raw_event_json,event_timestamp_ms,created_at,updated_at)
 VALUES(?,?,'group','VOID-HTTP-FICTIONAL',?,'downloaded',?,?,'unmatched','{}',?,?,?)`);
for(const id of [10,20,30,40,50])insert.run(id,`fictional-${id}`,'transfer',100,null,stamp,now,now);
insert.run(60,'fictional-real-bill','bill',null,100,stamp,now,now);
const receipts=[];for(const id of [10,20,30,40]){const result=await db.createReceiptSubstitute({slipItemId:id,documentDate:'2026-10-07',payeeName:'ผู้รับสมมติ',description:'ซื้อผักสมมติ',createdBy:'fictional'});assert.equal(result.created,true);receipts.push(result);}
const [normal,closed,grouped,otherGroup]=receipts;
await db.updateExpenseProfile({id:normal.item.id,input:{expected_revision:0,status:'draft',fields:{purpose:{value:'ซื้อผักสมมติ',source:'manual',evidence:[]}}},actor:'fictional'});
const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const child=spawn(process.execPath,['src/server.js'],{cwd:root,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'test',ADMIN_AUTH_DISABLED:'0',ADMIN_AUTH_MODE:'operator_only',ADMIN_OPERATOR_NAMES:'["fictional"]',ADMIN_SESSION_SECRET:'fictional-void-http',DECISION_REASON_REQUIRED:'1',AI_WORKER_ENABLED:'false',AI_PROVIDER:'mock',OPENAI_API_KEY:'',LINE_BILL_CAPTURE_CHANNEL_ACCESS_TOKEN:'',LINE_BILL_CAPTURE_CHANNEL_SECRET:'fictional',LINE_BILL_CAPTURE_ACCOUNTING_EXPORT_TOKEN:'',LINE_BILL_CAPTURE_PUSH_MOCK:'1',LINE_BILL_CAPTURE_SILENT_MODE:'1'},stdio:['ignore','pipe','pipe']});
let output='',cookie='',checks=0;child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
const base=`http://127.0.0.1:${port}`,route=id=>`/api/admin/items/${id}/receipt-substitute/void`;
const request=async(url,options={})=>{const response=await fetch(base+url,{redirect:'manual',signal:AbortSignal.timeout(5000),...options});return {status:response.status,body:await response.json()};};
const payload=id=>({reason:'สร้างใบแทนผิด ต้องคงหลักฐานต้นทาง',expected_updated_at:sql.prepare('SELECT updated_at FROM capture_items WHERE id=?').get(id).updated_at});
const post=async(id,body,decision=true)=>{let decisionId;
if(decision){const context=await request('/api/admin/decision-contexts',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({action_key:'receipt_substitute.void',entity_type:'item',entity_id:String(id),context_snapshot:{route:route(id)}})});assert.equal(context.status,201,JSON.stringify(context.body));decisionId=context.body.data.id;}
const result=await request(route(id),{method:'POST',headers:{cookie,'content-type':'application/json',...(decisionId?{'x-decision-id':decisionId,'x-decision-reason-code':'user_action'}:{})},body:JSON.stringify(body)});return {...result,decisionId};};
const equal=(a,b)=>{assert.deepEqual(a,b);checks++;};
const untouched=()=>JSON.stringify(Object.fromEntries(['capture_cash_payments','capture_daily_closings','capture_expense_profiles','capture_expense_profile_revisions','ai_learning_examples','ai_category_learning_examples','line_transfer_requests'].map(name=>[name,sql.prepare(`SELECT * FROM ${name} ORDER BY 1`).all()])));
try{
let ready=false;for(let i=0;i<80;i++){try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)break;await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(ready,output);
equal((await post(normal.item.id,payload(normal.item.id),false)).status,401);
const login=await fetch(base+'/api/auth/operator',{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({operator:'fictional'})});equal(login.status,303);cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
equal((await post(normal.item.id,payload(normal.item.id),false)).status,422);
const originalItems=sql.prepare('SELECT * FROM capture_items ORDER BY id').all(),originalMatches=sql.prepare('SELECT * FROM capture_matches ORDER BY id').all();
for(const [body,code] of [[{...payload(normal.item.id),reason:' '},'reason_required'],[{...payload(normal.item.id),reason:'x'.repeat(1001)},'reason_required'],[{reason:'cancel'},'revision_required']]){const result=await post(normal.item.id,body);equal(result.status,400);equal(result.body.details.code,code);}
const stale=await post(normal.item.id,{...payload(normal.item.id),expected_updated_at:'stale'});equal(stale.status,409);equal(stale.body.details.code,'revision_conflict');
const wrong=await post(60,payload(60));equal(wrong.status,400);equal(wrong.body.details.code,'not_receipt_substitute');
const missing=await post(99999,{reason:'cancel',expected_updated_at:now});equal(missing.status,404);
equal(sql.prepare('SELECT * FROM capture_items ORDER BY id').all(),originalItems);equal(sql.prepare('SELECT * FROM capture_matches ORDER BY id').all(),originalMatches);
sql.prepare("UPDATE capture_matches SET match_group_key='fictional-void-conflict' WHERE id IN (?,?)").run(grouped.match.id,otherGroup.match.id);
const conflict=await post(grouped.item.id,payload(grouped.item.id));equal(conflict.status,409);equal(conflict.body.details.code,'receipt_substitute_group_conflict');
sql.prepare("INSERT INTO capture_daily_closings(business_date,source_id,status,created_at,updated_at) VALUES('2026-10-07','VOID-HTTP-FICTIONAL','closed',?,?)").run(now,now);
const closedBefore=untouched(),closedItems=sql.prepare('SELECT * FROM capture_items ORDER BY id').all();const blocked=await post(closed.item.id,payload(closed.item.id));equal(blocked.status,409);equal(blocked.body.details.code,'round_closed');equal(untouched(),closedBefore);equal(sql.prepare('SELECT * FROM capture_items ORDER BY id').all(),closedItems);
sql.prepare("UPDATE capture_daily_closings SET status='open'").run();
const before=untouched(),otherItems=sql.prepare('SELECT * FROM capture_items WHERE id NOT IN (?,?) ORDER BY id').all(normal.item.id,10),otherMatches=sql.prepare('SELECT * FROM capture_matches WHERE id<>? ORDER BY id').all(normal.match.id),stampBefore=payload(normal.item.id).expected_updated_at;
const result=await post(normal.item.id,{reason:'ใบแทนผิด',expected_updated_at:stampBefore});equal(result.status,200);equal(result.body.data,{item_id:normal.item.id,source_slip_item_id:10,voided:true,idempotent:false,rejected_match_ids:[normal.match.id]});
equal(sql.prepare('SELECT status FROM capture_items WHERE id=?').get(normal.item.id).status,'unsent');equal({...sql.prepare('SELECT match_status,matched_item_id,slip_amount_value FROM capture_items WHERE id=10').get()},{match_status:'unmatched',matched_item_id:null,slip_amount_value:100});equal(sql.prepare('SELECT status FROM capture_matches WHERE id=?').get(normal.match.id).status,'rejected');equal(untouched(),before);equal(sql.prepare('SELECT * FROM capture_items WHERE id NOT IN (?,?) ORDER BY id').all(normal.item.id,10),otherItems);equal(sql.prepare('SELECT * FROM capture_matches WHERE id<>? ORDER BY id').all(normal.match.id),otherMatches);
let event;for(let i=0;i<30;i++){event=sql.prepare('SELECT * FROM decision_events WHERE id=?').get(result.decisionId);if(event.status==='completed')break;await new Promise(resolve=>setTimeout(resolve,20));}equal(event.status,'completed');equal(event.action_key,'receipt_substitute.void');equal(event.entity_id,String(normal.item.id));equal(JSON.parse(event.request_payload).reason,'ใบแทนผิด');equal(JSON.parse(event.result_summary).http_status,200);
const finalItems=sql.prepare('SELECT * FROM capture_items ORDER BY id').all(),finalMatches=sql.prepare('SELECT * FROM capture_matches ORDER BY id').all();const retry=await post(normal.item.id,{reason:'retry',expected_updated_at:stampBefore});equal(retry.status,200);equal(retry.body.data.idempotent,true);equal(sql.prepare('SELECT * FROM capture_items ORDER BY id').all(),finalItems);equal(sql.prepare('SELECT * FROM capture_matches ORDER BY id').all(),finalMatches);
// Cancelled receipt cannot be edited/reclassified or silently restored through other routes.
for (const [method,path,action,body] of [
  ['PATCH',`/api/admin/items/${normal.item.id}`,'document.metadata.update',{bill_purpose:'revive'}],
  ['PUT',`/api/admin/items/${normal.item.id}/category`,'document.category.change',{category:'bill',reason:'revive'}],
  ['POST','/api/admin/receipt-substitutes','receipt_substitute.create',{slip_item_id:10,document_date:'2026-10-07',payee_name:'fictional',description:'revive'}]
]) {
  const context=await request('/api/admin/decision-contexts',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({action_key:action,entity_type:'item',entity_id:String(normal.item.id),context_snapshot:{route:path}})});
  equal(context.status,201);
  const response=await request(path,{method,headers:{cookie,'content-type':'application/json','x-decision-id':context.body.data.id,'x-decision-reason-code':'user_action'},body:JSON.stringify(body)});
  equal(response.status,409);
}
equal(sql.prepare('SELECT * FROM capture_items ORDER BY id').all(),finalItems);equal(sql.prepare('SELECT * FROM capture_matches ORDER BY id').all(),finalMatches);equal(untouched(),before);
console.log(JSON.stringify({passed:checks,auth:true,decision_audit:true,scoped_void:true,idempotent_retry:true,closed_and_group_conflicts:true}));
}finally{child.kill('SIGTERM');sql.close();}
process.exit(0);
