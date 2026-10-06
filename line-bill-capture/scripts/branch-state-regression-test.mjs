import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
const root = fileURLToPath(new URL('..',import.meta.url));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(),'lbc-branch-state-'));
process.env.CAPTURE_DATA_DIR = scratch;
process.env.CAPTURE_DB_PATH = path.join(scratch,'line-bill-capture.sqlite');
const db = await import('../src/db.js');
const ai = await import('../src/ai-worker.js');
await db.initDatabase();
const persistAnalysis = async args => {
  sql.prepare('UPDATE capture_items SET storage_path = COALESCE(storage_path, ?) WHERE id = ?').run('/fictional/' + args.id + '.jpg', args.id);
  await db.requeueAiItems({ ids: [args.id] });
  const claimed = await db.markAiProcessing({ id: args.id, provider: args.provider, model: args.model });
  assert.ok(claimed);
  return db.applyAiAnalysis({ ...args, claimToken: claimed.ai_claim_token });
};

const sql = new DatabaseSync(process.env.CAPTURE_DB_PATH);
let nextId=1;
const insert = sql.prepare(`INSERT INTO capture_items(id,line_message_id,source_type,source_id,sender_user_id,category,status,ai_status,match_status,event_timestamp_ms,bill_total_value,slip_amount_value,doc_ref,vendor_name,vendor_tax_id,created_at,updated_at,raw_event_json) VALUES (?,?,'group',?,'A',?,'downloaded','done','unmatched',?,?,?,?,?,?,?,?,'{}')`);
const fixture = (group,category,date,amount=100,docRef=null,vendor='fictional-shop',tax=null) => {
  const id=nextId++,stamp=date+'T12:00:00+07:00';
  insert.run(id,'fictional-'+id,group,category,Date.parse(stamp),category==='bill'?amount:null,category==='transfer'?amount:null,docRef,vendor,tax,stamp,stamp);
  return {id,source_type:'group',source_id:group,sender_user_id:'A',category,event_timestamp_ms:Date.parse(stamp),date,doc_ref:docRef,vendor_name:vendor,vendor_tax_id:tax};
};
const row = id => db.getItemById(id);
const html = fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const line = prefix => html.split('\n').find(value=>value.startsWith(prefix));
const docSource = ['const sameInvoice=', 'const docPages=', 'const docHasPayable=', 'const isOrphanPage='].map(line).join('\n');
const uiDocuments = pool => new Function('S','liveItem',docSource+';return {docPages,isOrphanPage};')({pool},r=>r.status!=='unsent'&&r.status!=='duplicate');
const assertClosingOpen = (group,date,total=100) => {
  const closing=sql.prepare('SELECT * FROM capture_daily_closings WHERE source_id=? AND business_date=?').get(group,date);
  assert.equal(closing.status,'open',`${group} ${date} must reopen`);
  assert.equal(JSON.parse(closing.summary_json).confirmed_bill_amount,total,'Keep original snapshot as historical evidence');
  assert.ok(closing.closed_at && closing.reopened_at && closing.reopened_reason);
};
let server;
try {
  for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
  // Same reference in another source or at another vendor cannot resolve a missing total page.
  const page=fixture('branch-a','bill_page','2026-10-02',0,'INV-001','Shop A','1111111111111');
  assert.equal((await db.closeDay({sourceId:page.source_id,businessDate:page.date})).error,'day_has_unresolved_items');
  fixture('branch-b','bill','2026-10-02',100,'INV-001','Shop A','1111111111111');
  fixture('branch-a','bill','2026-10-02',100,'INV-001','Shop B','2222222222222');
  fixture('branch-a','bill','2026-10-02',100,'INV-001','Shop A','2222222222222');
  let days=await db.listDays({sourceId:'branch-a',start:page.date,end:page.date});
  assert.equal(days[0].unmatched_count,3); // two unmatched bills + orphan page
  assert.equal((await db.closeDay({sourceId:page.source_id,businessDate:page.date})).error,'day_has_unresolved_items');
  const all=(await db.listItems({limit:1000})).rows;
  assert.equal(uiDocuments(all).isOrphanPage(all.find(r=>r.id===page.id)),true);
  assert.deepEqual(uiDocuments(all).docPages(await row(page.id)).map(r=>r.id),[page.id]);
  // The actual payable page can arrive next day. It must hydrate into the page-day pool.
  const payable=fixture('branch-a','bill','2026-10-03',100,'INV-001','Shop A','1111111111111');
  const context=await db.getItemContext({id:page.id,limit:1});
  assert.equal(context.item.document_has_payable,1);
  assert.deepEqual(JSON.parse(context.item.document_related_ids_json).sort((a,b)=>a-b),[page.id,payable.id]);
  days=await db.listDays({sourceId:'branch-a',start:page.date,end:page.date});
  assert.equal(days[0].unmatched_count,2);
  const pool=[await row(page.id)];
  const hydrator = new Function('mergeItems','api','fetchItemById','matchItemIds',line('async function hydrateMatchMembers(')+';return hydrateMatchMembers;')((...groups)=>[...new Map(groups.flat().map(r=>[r.id,r])).values()],async()=>{throw new Error('No missing match members');},row,()=>[]);
  const hydrated=await hydrator([],pool);
  assert.ok(hydrated.some(r=>r.id===payable.id));
  assert.equal(uiDocuments(hydrated).isOrphanPage(pool[0]),false);
  // Without supplier identity, invoice number alone remains unproven even in one group.
  const anonymous=fixture('anonymous','bill_page','2026-10-02',0,'R-1',null);
  fixture('anonymous','bill','2026-10-02',100,'R-1',null);
  assert.equal((await row(anonymous.id)).document_has_payable,0);

  // Concurrent images by other senders do not end A's own image/text context.
  const bill=fixture('chat','bill','2026-10-02');
  const vision={category:'bill',bill_total_value:100,raw_text:'ร้านผัก รวม 100 บาท',summary:'ผัก'};
  const announcement={id:999,message_type:'text',sender_user_id:'A',event_timestamp_ms:bill.event_timestamp_ms+60000,text:'ค่าผัก ยอด 100 บาท'};
  const foreign={message_type:'image',sender_user_id:'B',capture_item_id:999,event_timestamp_ms:bill.event_timestamp_ms+30000};
  for(const provider of ['mock','openai']) {
    const result=await ai.analyzeItem({item:bill,config:{provider},nearbyText:[announcement],imageContext:[foreign],visionAnalyzer:async()=>structuredClone(vision)});
    assert.equal(result.announced_amount,100);
    const blocked=await ai.analyzeItem({item:bill,config:{provider},nearbyText:[announcement],imageContext:[foreign,{...foreign,sender_user_id:'A',capture_item_id:998,event_timestamp_ms:bill.event_timestamp_ms+40000}],visionAnalyzer:async()=>structuredClone(vision)});
    assert.equal(blocked.announced_amount,null,'An unrelated next image by the same sender remains a boundary');
  }
  const message=sql.prepare(`INSERT INTO line_messages(line_message_id,message_type,source_type,source_id,sender_user_id,text,status,event_timestamp_ms,raw_event_json,created_at,updated_at) VALUES (?,?,'group','chat',?,?,'active',?,'{}','2026-10-02','2026-10-02')`);
  message.run('chat-B','image','B',null,foreign.event_timestamp_ms);
  message.run('chat-A','text','A',announcement.text,announcement.event_timestamp_ms);
  assert.ok(await db.bindRecentBillAnnouncement({sourceType:'group',sourceId:'chat',senderUserId:'A',lineMessageId:'chat-A',text:announcement.text,eventTimestampMs:announcement.event_timestamp_ms}));

  // Independent tables can share numeric IDs. Only item-bucket overlap is deduplicated.
  const count=rows=>new Function('workBucketKeys','bucketRows',line('const dayWorkCount=')+';return dayWorkCount();')(()=>Object.keys(rows),key=>rows[key]);
  assert.equal(count({review:[{id:100,bill_item_id:1,slip_item_id:2}],bill:[{id:100}],leftover:[{id:100}]}),2);
  assert.equal(count({review:[{id:100,match_group_key:'group-a'},{id:101,match_group_key:'group-a'},{id:-100,review_type:'reimbursement',reimbursement_item_id:100}],ai_pending:[{id:100}],leftover:[{id:100}]}),3);

  // Actual mutation response and process navigation use the transfer anchor/bill owner.
  const navBill=fixture('nav-bill','bill','2026-10-01'),navSlip=fixture('nav-slip','transfer','2026-10-02');
  const match=await db.setItemMatch({billItemId:navBill.id,slipItemId:navSlip.id,status:'pending',createdBy:'admin-web'});
  assert.equal(match.transaction_business_date,'2026-10-02');
  assert.equal(match.bill_source_id,'nav-bill');
  let destination;
  const S={selected:null,start:'2026-10-01',source:'nav-bill',pool:[navBill,navSlip]};
  const open=async(date,group)=>{destination={date,group};S.start=date;S.source=group;return true;};
  const api=async()=>({data:match});
  const $=()=>({hidden:false,querySelector:()=>({classList:{add(){},remove(){}},scrollIntoView(){}})});
  const buildPair=source=>new Function('S','api','$','dateOf','openDay','render','toast','writeDaySelection','group','let pairBillToSlip;'+source.replace('async function pairBillToSlip(','pairBillToSlip=async function(')+';return pairBillToSlip;')(S,api,$,r=>r.date,open,()=>{},()=>{},()=>{},String);
  for(const prefix of ['async function pairBillToSlip(','pairBillToSlip=async function(']) {
    await buildPair(line(prefix))(navSlip,navBill,99);
    assert.deepEqual(destination,{date:'2026-10-02',group:'nav-bill'});
  }
  const contextNav=await db.getItemContext({id:navBill.id,limit:1});
  assert.equal(contextNav.item.active_transaction.transaction_business_date,'2026-10-02');
  const locationSource=line('function processLocation(');
  const jumpStart=html.indexOf('async function jumpToProcess(');
  const jumpSource=html.slice(jumpStart,html.indexOf('\nlet lightboxZoom=',jumpStart));
  const processLocationFn=new Function('activeMatchForItem','confirmedMatchForItem','matchBillIds','item','isSlip','isOrphanPage',locationSource+';return processLocation;')(()=>null,()=>null,m=>[m.bill_item_id],id=>S.pool.find(r=>r.id===id),r=>r.category==='transfer',()=>false);
  const jump=new Function('S','item','toast','activeMatchForItem','fetchItemById','fetchItemByIdStrict','mergeItems','processLocation','dateOf','openDay','render','writeDaySelection','requestAnimationFrame','$','setTimeout',jumpSource+';return jumpToProcess;')(S,id=>S.pool.find(r=>r.id===id),()=>{},()=>null,async()=>contextNav.item,async()=>contextNav.item,(a,b)=>[...a.filter(r=>r.id!==b[0].id),...b],processLocationFn,r=>r.date,open,()=>{},()=>{},()=>{},$,()=>{});
  S.start='2026-10-01';await jump(navBill.id);
  assert.deepEqual(destination,{date:'2026-10-02',group:'nav-bill'});

  // Reopen original transaction anchors before changing any match state; keep snapshots.
  for(const action of ['amount','category','reject','unsend','reassign','ai']) {
    const group='invalidate-'+action,b=fixture(group,'bill','2026-10-01'),s=fixture(group+'-slips','transfer','2026-10-02');
    await db.setItemMatch({billItemId:b.id,slipItemId:s.id,status:'confirmed',createdBy:'admin-web',reviewNote:'fictional verified'});
    assert.equal((await db.closeDay({sourceId:group,businessDate:'2026-10-02'})).status,'closed');
    if(action==='amount') await db.updateItemMetadata({id:b.id,billTotalText:'200',billTotalValue:200,editedBy:'fictional'});
    if(action==='category') await db.updateItemMetadata({id:b.id,category:'other',categoryEditedBy:'fictional'});
    if(action==='reject') await db.setItemMatch({billItemId:b.id,slipItemId:s.id,status:'rejected',createdBy:'admin-web'});
    if(action==='unsend') await db.markUnsent('fictional-'+s.id);
    if(action==='reassign') {const replacement=fixture(group+'-slips','transfer','2026-10-04');await db.setItemMatch({billItemId:b.id,slipItemId:replacement.id,status:'pending',createdBy:'admin-web',replaceExisting:true});}
    if(action==='ai') await persistAnalysis({id:b.id,provider:'mock',analysis:{category:'bill',bill_total_value:200}});
    assertClosingOpen(group,'2026-10-02');
  }
  for(const action of ['bill-edit','earliest-slip-unsend']) {
    const group='aggregate-'+action,b1=fixture(group,'bill','2026-09-30',40),b2=fixture(group+'-other-bill','bill','2026-10-01',60),s1=fixture(group+'-slips','transfer','2026-10-02',70),s2=fixture(group+'-slips','transfer','2026-10-03',30);
    const result=await db.setItemMatchGroup({billItemIds:[b1.id,b2.id],slipItemIds:[s1.id,s2.id],status:'confirmed',createdBy:'admin-web',reviewNote:'fictional verified'});
    assert.ok(!result.error,JSON.stringify(result));
    const groupedContext=await db.getItemContext({id:b2.id,limit:1});
    assert.equal(groupedContext.item.active_transaction.transaction_source_id,group);
    const reviewRows=await db.listMatches({sourceId:group,status:'confirmed',start:'2026-10-02',end:'2026-10-02'});
    assert.deepEqual([...new Set(reviewRows.map(r=>r.bill_item_id))].sort((a,b)=>a-b),[b1.id,b2.id]);
    assert.equal((await db.listMatches({sourceId:group+'-other-bill',status:'confirmed',start:'2026-10-02',end:'2026-10-02'})).length,0);
    assert.equal((await db.closeDay({sourceId:group,businessDate:'2026-10-02'})).status,'closed');
    if(action==='bill-edit') await db.updateItemMetadata({id:b2.id,billTotalText:'200',billTotalValue:200,editedBy:'fictional'});
    else await db.markUnsent('fictional-'+s1.id);
    assertClosingOpen(group,'2026-10-02');
  }
  const legacyBill=fixture('legacy-repair','bill','2026-10-01'),legacySlip=fixture('legacy-repair-slips','transfer','2026-10-02');
  await db.setItemMatch({billItemId:legacyBill.id,slipItemId:legacySlip.id,status:'confirmed',createdBy:'admin-web',reviewNote:'fictional verified'});
  assert.equal((await db.closeDay({sourceId:'legacy-repair',businessDate:'2026-10-02'})).status,'closed');
  sql.prepare('UPDATE capture_items SET bill_total_value=200 WHERE id=?').run(legacyBill.id);
  execFileSync(process.execPath,['--input-type=module','-e', "const db=await import('./src/db.js');await db.initDatabase();"],{cwd:root,env:{...process.env,CAPTURE_DATA_DIR:scratch,CAPTURE_DB_PATH:process.env.CAPTURE_DB_PATH},stdio:'pipe'});
  assertClosingOpen('legacy-repair','2026-10-02');
  // Manual values/category are the effective inputs to AI state transitions.
  const manual=fixture('manual','bill','2026-10-03');
  await db.updateItemMetadata({id:manual.id,billTotalText:'100',billTotalValue:100,editedBy:'fictional'});
  const manualSlip=fixture('manual','transfer','2026-10-04');
  await db.setItemMatch({billItemId:manual.id,slipItemId:manualSlip.id,status:'confirmed',createdBy:'admin-web',reviewNote:'fictional verified'});
  let updated=await persistAnalysis({id:manual.id,provider:'mock',analysis:{category:'bill',bill_total_value:null,page_count:2,summary:'อ่านยอดไม่ออก'}});
  assert.equal(updated.bill_total_value,100);assert.equal(updated.category,'bill');assert.equal(updated.match_status,'confirmed');
  const other=fixture('manual-other','bill','2026-10-03');
  await db.updateItemMetadata({id:other.id,category:'other',categoryEditedBy:'fictional'});
  updated=await persistAnalysis({id:other.id,provider:'mock',analysis:{category:'bill',bill_total_value:null,amount_conflict:true}});
  assert.equal(updated.category,'other');assert.equal(updated.match_status,'unmatched');assert.equal(updated.amount_review_flag,0);
  const protectedBill=fixture('protected-bill','bill','2026-10-03');
  await db.updateItemMetadata({id:protectedBill.id,category:'bill',categoryEditedBy:'fictional'});
  updated=await persistAnalysis({id:protectedBill.id,provider:'mock',analysis:{category:'other',bill_total_value:null}});
  assert.equal(updated.category,'bill');assert.equal(updated.bill_total_value,100);assert.equal(updated.match_status,'unmatched');
  const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
  const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const apiToken='fictional-accounting-regression-token';let output='';
  server=spawn(process.execPath,['src/server.js'],{cwd:root,env:{...globalThis.process.env,DOTENV_CONFIG_PATH:path.join(scratch,'no-env'),CAPTURE_DATA_DIR:scratch,CAPTURE_DB_PATH:path.join(scratch,'line-bill-capture.sqlite'),HOST:'127.0.0.1',PORT:String(port),ADMIN_AUTH_DISABLED:'1',AI_WORKER_ENABLED:'false',AI_PROVIDER:'mock',OPENAI_API_KEY:'',LINE_BILL_CAPTURE_CHANNEL_ACCESS_TOKEN:'',LINE_BILL_CAPTURE_ACCOUNTING_EXPORT_TOKEN:apiToken,LINE_BILL_CAPTURE_SILENT_MODE:'1',DECISION_REASON_REQUIRED:'0'},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',value=>output+=value);server.stderr.on('data',value=>output+=value);
  let healthy;
  for(let attempt=0;attempt<100;attempt++){try{healthy=await fetch(`http://127.0.0.1:${port}/health`);if(healthy.ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}
  assert.ok(healthy?.ok,output);
  const base=`http://127.0.0.1:${port}`;
  const apiContext=await(await fetch(`${base}/api/admin/items/${navBill.id}/context?limit=1`)).json();
  assert.equal(apiContext.data.item.active_transaction.transaction_business_date,'2026-10-02');
  const apiPages=await(await fetch(`${base}/api/admin/items?source_id=branch-a&start=2026-10-02&end=2026-10-02`)).json();
  assert.equal(apiPages.data.find(r=>r.id===page.id).document_has_payable,1);
  assert.deepEqual(JSON.parse(apiPages.data.find(r=>r.id===page.id).document_related_ids_json).sort((a,b)=>a-b),[page.id,payable.id]);
  const exportResponse=await fetch(`${base}/accounting-export/rounds/${encodeURIComponent('invalidate-amount:2026-10-02')}/snapshot`,{headers:{Authorization:`Bearer ${apiToken}`}});
  assert.equal(exportResponse.status,409,'Reopened evidence must not be exported as closed');
  const apiBill=fixture('api-nav','bill','2026-10-01'),apiSlip=fixture('api-nav-slip','transfer','2026-10-02');
  const mutation=await fetch(`${base}/api/admin/matches`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bill_item_id:apiBill.id,slip_item_id:apiSlip.id,status:'pending',score:99})});
  assert.equal(mutation.status,200);
  const mutated=await mutation.json();assert.equal(mutated.data.transaction_business_date,'2026-10-02');assert.equal(mutated.data.bill_source_id,'api-nav');
  console.log('Branch/document hydration, concurrent sender, navigation, typed workload and protected-state/closing regressions passed');
} finally {if(server){const ended=once(server,'exit');server.kill('SIGTERM');await ended;}sql.close();fs.rmSync(scratch,{recursive:true,force:true});}
