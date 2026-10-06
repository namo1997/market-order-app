import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {once} from 'node:events';
const html=fs.readFileSync('public/index.html','utf8');
const body=html.slice(html.indexOf('S.dataGeneration=0;'),html.indexOf('function render(){'));
let releaseA; const gate=new Promise(r=>releaseA=r);
const S={start:'2026-09-01',end:'2026-09-01',source:'GA',bucket:'review',selected:null,view:'day'};
const renders=[];
const c={S,JSON,Number,Boolean,Promise,
fetchAllRows:async(url,p)=>{if(p.source_id==='GA')await gate; const id=p.source_id==='GA'?1:2;return url.endsWith('/items')?[{id,date:p.start,source_id:p.source_id}]:p.status==='pending'?[{id:id*10,source_id:p.source_id}]:[]},
aggregateMatches:r=>r,hydrateMatchMembers:async(_,r)=>r,dateOf:r=>r.date,
renderGroupOptions(){},bucketRows:()=>S.matches,render(){renders.push({source:S.source,date:S.start,itemIds:S.items.map(x=>x.id),matchSources:S.matches.map(x=>x.source_id)})},writeDaySelection(){}};
vm.createContext(c); vm.runInContext(body+';this.load=data',c);
const a=c.load(false);S.start=S.end='2026-09-02';S.source='GB';await c.load(false);releaseA();await a;
const race={confirmed:S.source==='GB'&&S.matches[0]?.source_id==='GA',renders};assert.equal(S.matches[0]?.source_id,'GB');assert.equal(S.items[0]?.id,2);assert.equal(renders.length,1);
// Delayed hydration and delayed failure cannot overwrite a new scope.
for (const failure of [false,true]) {
  let release;const held=new Promise(resolve=>release=resolve);S.source='GA';S.start=S.end='2026-09-01';
  c.fetchAllRows=async(url,p)=>{if(failure&&p.source_id==='GA'){await held;throw new Error('old failure')}const id=p.source_id==='GA'?1:2;return url.endsWith('/items')?[{id,date:p.start,source_id:p.source_id}]:p.status==='pending'?[{id:id*10,source_id:p.source_id}]:[]};
  c.hydrateMatchMembers=async(_,rows)=>{if(!failure&&rows[0]?.source_id==='GA')await held;return rows};
  const old=c.load(false,{background:true});await Promise.resolve();S.source='GB';S.start=S.end='2026-09-02';await c.load(false);release();assert.equal(await old,false);assert.equal(S.items[0]?.id,2);assert.equal(S.matches[0]?.source_id,'GB');
}
S.dayLoading=true;assert.equal(await c.load(false,{background:true}),false);S.dayLoading=false;
process.env.CAPTURE_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'scope-receipt-fictional-'));
process.env.CAPTURE_DB_PATH=path.join(process.env.CAPTURE_DATA_DIR,'fictional.sqlite');
const db=await import(pathToFileURL(path.join(process.cwd(),'src/db.js')));await db.initDatabase();
const sql=new DatabaseSync(process.env.CAPTURE_DB_PATH);const now=new Date().toISOString();
sql.prepare("INSERT INTO capture_items(id,line_message_id,source_type,source_id,category,status,slip_amount_value,match_status,raw_event_json,created_at,updated_at) VALUES (1,'fictional-1','group','Gfictional','transfer','downloaded',100,'unmatched','{}',?,?)").run(now,now);
const initial={slipItemId:1,documentDate:'2026-09-01',payeeName:'Fictional old recipient',description:'Fictional old detail',createdBy:'fictional-test'};
const first=await db.createReceiptSubstitute(initial);assert.ok(first.created);
const identical=await db.createReceiptSubstitute(initial);assert.equal(identical.idempotent,true);
await db.setItemMatch({billItemId:first.item.id,slipItemId:1,status:'rejected',createdBy:'fictional-test'});
const second=await db.createReceiptSubstitute({...initial,payeeName:'Fictional corrected recipient',description:'Fictional corrected detail'});
assert.equal(second.error,'receipt_substitute_conflict');const stored=JSON.parse((await db.getItemById(first.item.id)).generated_document_json);assert.equal(stored.payee_name,initial.payeeName);assert.equal((await db.getItemById(1)).match_status,'unmatched');const retry=await db.createReceiptSubstitute(initial);assert.equal(retry.error,'receipt_substitute_review_required');
await db.updateItemMetadata({id:first.item.id,category:'other',editedBy:'fictional-test'});
const unavailable=await db.createReceiptSubstitute(initial);assert.equal(unavailable.error,'receipt_substitute_unavailable');let error=unavailable.error;
const recategorized={error};
// UI conflict keeps the draft and points at the original document's real day route.
const fields=new Map(['receipt-date','receipt-payee','receipt-account','receipt-description','receipt-submit','receipt-form','receiptbg'].map(id=>[id,{value:'typed '+id,hidden:false,children:[],prepend(node){this.children.unshift(node)}}]));
const noticeNodes=[];const node=()=>({append(...children){this.children=children},setAttribute(){},className:'',textContent:''});const ui={receiptSubmitting:false,receiptDraftLoading:false,receiptSlipId:1,receiptReimbursementId:null,createdReceiptSlips:new Set(),S:{start:'2026-09-02',source:'GB'},$:id=>fields.get(id),document:{createElement(){const n=node();noticeNodes.push(n);return n}},withReviewLock:fn=>fn(),api:async()=>{const e=new Error('มีใบแทนเดิมแล้ว');e.data={existingItemId:99,existingItem:{created_at:'2026-09-01',source_id:'GA',category:'other'}};throw e},dateOf:x=>x.created_at,URLSearchParams,Number,String};
const uiContext=vm.createContext(ui),uiStart=html.lastIndexOf('async function submitReceiptSubstitute(event){'),uiEnd=html.indexOf('</script>',uiStart);vm.runInContext(html.slice(uiStart,uiEnd)+';this.submit=submitReceiptSubstitute',uiContext);await uiContext.submit({preventDefault(){}});assert.equal(fields.get('receipt-payee').value,'typed receipt-payee');assert.equal(ui.createdReceiptSlips.size,0);const link=noticeNodes.find(n=>n.href);assert.ok(link.href.startsWith('/admin?'));const query=new URLSearchParams(link.href.split('?')[1]);assert.equal(query.get('group'),'GA');assert.equal(query.get('date'),'2026-09-01');assert.equal(query.get('bucket'),'other');assert.equal(query.get('item'),'99');
ui.api=async()=>({success:true});ui.closeReceiptSubstitute=()=>{fields.get('receiptbg').hidden=true};ui.toast=()=>{};ui.data=async()=>{};await uiContext.submit({preventDefault(){}});assert.equal(ui.createdReceiptSlips.has(1),false,'Completed flow must send future receipt requests to server again');
// Exercise authenticated API conflicts using fictional SQLite only.
for(const id of [100,101])sql.prepare("INSERT INTO capture_items(id,line_message_id,source_type,source_id,category,status,slip_amount_value,match_status,raw_event_json,created_at,updated_at) VALUES (?,?,'group','Gfictional','transfer','downloaded',100,'unmatched','{}',?,?)").run(id,'fictional-'+id,now,now);
const rejectedReceipt=await db.createReceiptSubstitute({...initial,slipItemId:100});await db.setItemMatch({billItemId:rejectedReceipt.item.id,slipItemId:100,status:'rejected',createdBy:'fictional-test'});
const confirmedReceipt=await db.createReceiptSubstitute({...initial,slipItemId:101});
const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
const child=spawn(process.execPath,['src/server.js'],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1',ADMIN_AUTH_MODE:'operator_only',ADMIN_AUTH_DISABLED:'0',ADMIN_OPERATOR_NAMES:'["dot"]',ADMIN_SESSION_SECRET:'fictional-scope-secret',AI_PROVIDER:'mock',AI_WORKER_ENABLED:'false',LINE_BILL_CAPTURE_SILENT_MODE:'1'},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
try{
 const base=`http://127.0.0.1:${port}`;let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready,log);
 const auth=await fetch(base+'/api/auth/operator',{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({operator:'dot'})});assert.equal(auth.status,303);const cookie=auth.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
 const body={slip_item_id:1,document_date:initial.documentDate,payee_name:initial.payeeName,description:initial.description};
 const context=await fetch(base+'/api/admin/decision-contexts',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({action_key:'receipt_substitute.create',entity_type:'document',context_snapshot:{request:body}})});const decision=await context.json();assert.equal(context.status,201);
 const response=await fetch(base+'/api/admin/receipt-substitutes',{method:'POST',headers:{cookie,'content-type':'application/json','x-decision-id':decision.data.id,'x-decision-reason-code':'user_action'},body:JSON.stringify(body)});const result=await response.json();assert.equal(response.status,409);assert.equal(result.data.error,'receipt_substitute_unavailable');assert.equal(result.data.existingItemId,first.item.id);assert.ok(result.message.includes('ใบแทนเดิม'));assert.equal(result.data.existingItem.category,'other');
 const postReceipt=async(payload)=>{const ctx=await fetch(base+'/api/admin/decision-contexts',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({action_key:'receipt_substitute.create',entity_type:'document',context_snapshot:{request:payload}})});const dc=await ctx.json();assert.equal(ctx.status,201,JSON.stringify(dc)+log);const res=await fetch(base+'/api/admin/receipt-substitutes',{method:'POST',headers:{cookie,'content-type':'application/json','x-decision-id':dc.data.id,'x-decision-reason-code':'user_action'},body:JSON.stringify(payload)});return {status:res.status,body:await res.json()}};
 const rejectedBody={...body,slip_item_id:100};
 const conflict=await postReceipt({...rejectedBody,payee_name:'Fictional corrected'});assert.equal(conflict.status,409);assert.equal(conflict.body.data.error,'receipt_substitute_conflict');
 const review=await postReceipt(rejectedBody);assert.equal(review.status,409);assert.equal(review.body.data.error,'receipt_substitute_review_required');

 const beforeMatches=sql.prepare('SELECT * FROM capture_matches ORDER BY id').all();const repeated=await postReceipt({...body,slip_item_id:101});assert.equal(repeated.status,200);assert.equal(repeated.body.data.idempotent,true);assert.equal(repeated.body.data.item.id,confirmedReceipt.item.id);assert.deepEqual(sql.prepare('SELECT * FROM capture_matches ORDER BY id').all(),beforeMatches);
}finally{child.kill();await once(child,'exit');sql.close()}
console.log('scope race, hydrate/error/polling, receipt idempotency/conflict/audit preservation and authenticated API passed');
