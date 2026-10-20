import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { RECEIVING_DDL, receivingDocument, receivingHash, receivingConfigured, receivingSourceUrl, fetchReceivingPage, matchReceiving, matchReceivingDocuments, receivingView, loadReceiving } from '../src/ap/receiving.js';
import { createReceivingSync } from '../src/ap/receivingSync.js';
import { createApRouter } from '../src/ap/routes.js';
import { lbcInvoiceFacts } from '../src/ap/lbcInvoiceFacts.js';
import { snapshotItems } from '../src/pnl/domain.js';
import { assertPermission } from '../src/domain/permissions.js';
const fixture = (change = {}) => ({ document_id: 123, status: 'confirmed', updated_at: '2026-10-20T18:00:00+07:00', confirmed_at: '2026-10-20T17:00:00+07:00', voided_at: null,
  receipt_date: '2026-10-20', branch: { id: 3, code: 'SK', name: 'สาขาสมมติ' }, department: { id: 12, name: 'ครัวสมมติ' }, receiving_scope: 'department',
  supplier: { key: 'sm:7', master_id: 7, product_group_id: null, name: 'บริษัท ผู้ขายสมมติ จำกัด', ap_code: 'AP-TEST', ap_code_source: 'branch_code' },
  doc_kind: 'bill', doc_ref: 'INV-SYNTHETIC', doc_date: '2026-09-04', bill_totals_satang: { subtotal: 955500, discount: 0, vat: 0, total: 955500 },
  received_value_satang: 955500, price_status: 'from_bill', lines: [{ line_id: 1, product_id: 55, product_name: 'สินค้าสมมติ', item_code: null, bill_text: 'สินค้า', quantity_received: '10.00', unit: 'ถุง', unit_price_satang: 2950, amount_satang: 29500, decision: 'accept' }],
  open_issues: [], image_count: 1, ...change });
const lbc = (change = {}) => ({ key: 'lbc:bill:7', sourceType: 'LBC', branch: 'SK', supplierName: 'ผู้ขายสมมติ', apCode: 'AP-TEST', docRef: 'INV-SYNTHETIC', docDate: '2026-09-04', amount: '9555.00', ...change });
const page = (documents, next_cursor = null) => ({ version: 1, generated_at: '2026-10-25T18:00:00+07:00', next_cursor, documents });
const response = payload => new Response(JSON.stringify(payload), { status: 200 });
const config = { url: 'http://127.0.0.1/api/receiving-export/ap/v1/documents', token: 'mock-only' };

test('contract allowlist excludes raw/contact metadata at every level and validates money/dates/status', () => {
  const input = fixture({ raw_ocr: 'private', image: 'private' }); input.supplier.bank_account = 'private'; input.lines[0].raw = 'private';
  const d = receivingDocument(input); assert.equal(JSON.stringify(d).includes('private'), false);
  assert.equal(d.updated_at, '2026-10-20T11:00:00.000Z'); assert.equal(d.lines[0].quantity_received, '10.00');
  assert.equal(receivingHash(d), receivingHash(receivingDocument(structuredClone(input))));
  for (const change of [{ document_id: 0 }, { status: 'draft' }, { received_value_satang: 1.2 }, { received_value_satang: -1 }, { receipt_date: '2026-02-30' }, { updated_at: 'yesterday' }, { status: 'void' }, { image_count: '1' }, { lines: [{...input.lines[0],quantity_received:'1e3'}] }]) assert.throws(() => receivingDocument(fixture(change)), /RECEIVING_INVALID_PAYLOAD/);
  assert.equal(receivingDocument(fixture({ bill_totals_satang: null, received_value_satang: null, price_status: 'needs_accounting_price', doc_kind: 'no_bill' })).received_value_satang, null);
  assert.ok(RECEIVING_DDL.every(sql => sql.startsWith('CREATE TABLE IF NOT EXISTS ap_') && !/\bDELETE\b|\bALTER\b/.test(sql)));
});
test('LBC keeps optional explicit invoice facts only, never invents dates from payment/description', () => {
  assert.deepEqual(lbcInvoiceFacts({business_date:'2026-09-04',description:'INV-SYNTHETIC',bank_account:'private'}),{});
  assert.deepEqual(lbcInvoiceFacts({doc_ref:' INV-X ',invoice_date:'2026-09-04',ap_code:'AP-X',raw:'private'}),{docRef:'INV-X',docDate:'2026-09-04',apCode:'AP-X'});
  assert.deepEqual(lbcInvoiceFacts({doc_date:'2026-02-30'}),{});
  const data = snapshotItems({pnl_fields_version:2,items:[{stable_key:'lbc:bill:7',amount_incl_vat:1,doc_ref:'INV-X',invoice_date:'2026-09-04',bank_account:'private'}]}).items[0];
  assert.equal(data.docRef,'INV-X');assert.equal(data.docDate,'2026-09-04');assert.ok(!JSON.stringify(data).includes('private'));
});
test('match requires branch + supplier + invoice ref + printed date ±3 days + total ±100 satang; ambiguity stays review', () => {
  const d=receivingDocument(fixture());
  assert.equal(matchReceiving(d,[lbc()]).status,'LINKED');
  assert.equal(matchReceiving(d,[lbc({docDate:'2026-09-07',amount:'9556.00'})]).status,'LINKED');
  assert.equal(matchReceiving(d,[lbc({docDate:'2026-09-08'})]).status,'REVIEW');
  assert.equal(matchReceiving(d,[lbc({amount:'9556.01'})]).status,'REVIEW');
  for(const change of [{docRef:null},{docDate:null},{docRef:'OTHER'},{apCode:'OTHER'}]) assert.notEqual(matchReceiving(d,[lbc(change)]).status,'LINKED');
  assert.equal(matchReceiving(d,[lbc({branch:'KK'})]).status,'NO_LBC');
  assert.equal(matchReceiving(d,[lbc(),lbc({key:'lbc:bill:8'})]).status,'REVIEW');
  assert.equal(matchReceiving(d,[lbc({apCode:null})]).status,'LINKED');
  assert.equal(matchReceiving(d,[lbc({docDate:null,date:d.doc_date})]).status,'REVIEW');
  assert.equal(matchReceiving(receivingDocument(fixture({doc_kind:'no_bill'})),[]).status,'REVIEW');
  assert.equal(matchReceiving(receivingDocument(fixture({doc_kind:'statement_only',lines:[]})),[]).status,'REFERENCE');
  const duplicate=matchReceivingDocuments([d,{...d,document_id:124}],[lbc()]);assert.ok(duplicate.every(r=>r.match.status==='REVIEW'&&!r.match.linkedSourceKey));
  const voided=receivingDocument(fixture({status:'void',updated_at:'2026-10-21T18:00:00+07:00',voided_at:'2026-10-21T18:00:00+07:00'}));assert.equal(matchReceiving(voided,[lbc()]).linkedSourceKey,null);
  const view=receivingView(d,matchReceiving(d,[lbc()]),config);assert.equal(view.dueDate,'2026-11-05');assert.equal(view.periodMonth,null);assert.match(view.sourceUrl,/\/admin\/receiving\/documents\/123$/);
});
test('configuration is disabled when incomplete; unsafe URLs never forward auth or form source links', async () => {
  for(const c of [{},{url:config.url},{token:'mock-only'},{...config,url:'https://user:pass@example.invalid/api/receiving-export/ap/v1/documents'},{...config,url:'http://example.invalid/api/receiving-export/ap/v1/documents'},{...config,url:'https://example.invalid/wrong'}]) {
    assert.equal(receivingConfigured(c),false);assert.equal(receivingSourceUrl(c,123),null);
  }
  let calls=0;await assert.rejects(fetchReceivingPage({}, {fetchImpl:()=>{calls++;}}),/RECEIVING_DISABLED/);assert.equal(calls,0);
  for(const payload of [{...page([]),version:2},{...page([]),next_cursor:''},{...page([]),documents:{}},page([fixture({updated_at:'2027-01-01T00:00:00Z'})])]) await assert.rejects(fetchReceivingPage(config,{fetchImpl:async()=>response(payload)}),/RECEIVING_INVALID_PAYLOAD/);
  await assert.rejects(fetchReceivingPage(config,{fetchImpl:async()=>{throw new Error('private upstream');}}),e=>e.message==='RECEIVING_FETCH_FAILED');
});

// Transaction model exercises the actual importer SQL without loading config/dotenv or any database.
function database(sources=[lbc()]) {
  let state={documents:[],history:[],runs:[],audits:[]}, backup;
  const queries=[]; const db={ failHistory:false, failAudit:false, lock:1, sources, queries, get state(){return state;} };
  const connection={release(){},async beginTransaction(){backup=structuredClone(state);},async commit(){backup=null;},async rollback(){state=backup;backup=null;},async query(sql,args=[]){
    queries.push(sql);
    if(sql.includes('GET_LOCK'))return [[{acquired:db.lock}]];
    if(sql.includes('RELEASE_LOCK'))return [[{}]];
    if(sql.startsWith('SELECT watermark'))return [[...state.runs.filter(r=>r.status==='SUCCEEDED'&&r.origin_hash===args[0]).slice(-1)].reverse()];
    if(sql.startsWith('INSERT INTO ap_receiving_sync_runs')){const id=state.runs.length+1;state.runs.push({id,status:'RUNNING',origin_hash:args[0],updated_since:args[1]});return [{insertId:id}];}
    if(sql.startsWith('UPDATE ap_receiving_sync_runs')){const r=state.runs.find(r=>r.id===args.at(-1));if(sql.includes("status='SUCCEEDED'"))Object.assign(r,{status:'SUCCEEDED',watermark:args[0],seen:args[1],changed:args[2]});else Object.assign(r,{status:'FAILED',cursor:args[0],error_code:args[1]});return [{}];}
    if(sql.startsWith('SELECT * FROM ap_receiving_documents'))return [structuredClone(state.documents)];
    if(sql.startsWith('SELECT document FROM ap_receiving_documents'))return [structuredClone(state.documents)];
    if(sql.startsWith('SELECT document FROM ap_sources'))return [db.sources.map(document=>({document}))];
    if(sql.startsWith('SELECT id,status,'))return [[...state.runs].slice(-1)];
    if(sql.startsWith('INSERT INTO ap_receiving_documents')){const names=['document_id','source_updated_at','receipt_date','branch_code','status','content_hash','document','match_status','linked_source_key','sync_run_id'];const row=Object.fromEntries(names.map((n,i)=>[n,args[i]]));const old=state.documents.find(r=>r.document_id===args[0]);if(old)Object.assign(old,row);else state.documents.push(row);return [{}];}
    if(sql.startsWith('INSERT INTO ap_receiving_history')){if(db.failHistory)throw new Error('private SQL failure');state.history.push([...args]);return [{}];}
    throw new Error(`Unhandled SQL: ${sql}`);
  }};
  db.pool={async getConnection(){return connection;}};db.connection=connection;
  db.audit=async event=>{assert.equal(event.connection,connection);assert.equal(typeof event.entityId,'number');if(db.failAudit)throw new Error('private audit error');state.audits.push(event.afterPayload);};
  return db;
}
const harness=(db=database())=>{let docs=[fixture()],badPage=false;const requests=[];
  const sync=createReceivingSync({getPool:()=>db.pool,config,audit:db.audit,fetchImpl:async(url)=>{requests.push(new URL(url));if(badPage)throw new Error('private upstream');return response(page(docs));}});
  return {db,sync,requests,set docs(v){docs=v;},set badPage(v){badPage=v;}};
};
test('import replay, edited receipt and void retain history, unlink without ever creating payment/journal rows', async()=>{
  const h=harness();assert.equal((await h.sync()).changed,1);assert.equal(h.db.state.documents[0].match_status,'LINKED');
  assert.equal((await h.sync()).changed,0);assert.equal(h.db.state.history.length,1);assert.ok(h.requests[1].searchParams.get('updated_since'));
  h.docs=[fixture({updated_at:'2026-10-21T18:00:00+07:00',received_value_satang:100})];assert.equal((await h.sync()).changed,1);
  h.docs=[fixture({status:'void',updated_at:'2026-10-22T18:00:00+07:00',voided_at:'2026-10-22T18:00:00+07:00'})];await h.sync();
  assert.equal(h.db.state.documents[0].linked_source_key,null);assert.equal(h.db.state.documents[0].match_status,'VOID');assert.equal(h.db.state.history.length,3);
  assert.ok(h.db.queries.every(sql=>!/(?:INSERT|UPDATE|DELETE).*\b(?:ap_journals|ap_journal_lines|pnl_|ap_period_controls)/.test(sql)));
  h.docs=[fixture()];assert.equal((await h.sync()).changed,0);assert.equal(h.db.state.documents[0].status,'void');
});
test('duplicate pages, conflicting revision, atomic rollback, failed watermark, lock and audit safety', async()=>{
  const h=harness();await h.sync();const watermark=h.db.state.runs[0].watermark;
  h.docs=[fixture({received_value_satang:5})];await assert.rejects(h.sync(),/RECEIVING_REVISION_CONFLICT/);assert.equal(h.db.state.history.length,1);
  h.docs=[fixture({document_id:124})];h.db.failHistory=true;await assert.rejects(h.sync(),/RECEIVING_SYNC_FAILED/);assert.equal(h.db.state.documents.length,1);
  h.db.failHistory=false;h.db.failAudit=true;await assert.rejects(h.sync(),/RECEIVING_SYNC_FAILED/);assert.equal(h.db.state.documents.length,1);
  h.db.failAudit=false;h.badPage=true;await assert.rejects(h.sync(),/RECEIVING_FETCH_FAILED/);assert.equal(h.db.state.runs.filter(r=>r.status==='SUCCEEDED').at(-1).watermark,watermark);
  h.db.lock=0;await assert.rejects(h.sync(),/RECEIVING_SYNC_RUNNING/);assert.ok(h.db.state.runs.slice(1).every(r=>r.status==='FAILED'));
  await assert.rejects(createReceivingSync({getPool:()=>{throw new Error('should not open');},config})(),/RECEIVING_AUDIT_REQUIRED/);
});
test('new LBC and duplicate receiving evidence reconcile on sync and read without touching accounting', async()=>{
  const h=harness(database([]));await h.sync();assert.equal(h.db.state.documents[0].match_status,'NO_LBC');
  h.db.sources.push(lbc());assert.equal((await h.sync()).changed,1);assert.equal(h.db.state.documents[0].match_status,'LINKED');
  h.docs=[fixture({document_id:124})];await h.sync();assert.ok(h.db.state.documents.every(r=>r.match_status==='REVIEW'));
  const report=await loadReceiving(h.db.connection,{month:'2026-10',branch:'SK',config});assert.equal(report.documents.length,2);assert.ok(report.documents.every(d=>d.matchStatus==='REVIEW'));
  assert.equal((await loadReceiving(h.db.connection,{month:'2026-09',config})).documents.length,0);
});
test('mock HTTP contract pagination imports actual wire payload, auth header and incremental query only locally', async()=>{
  let requests=0;const server=http.createServer((req,res)=>{
    requests++; assert.equal(req.headers.authorization,`Bearer ${config.token}`);
    const u=new URL(req.url,'http://127.0.0.1');assert.equal(u.pathname,'/api/receiving-export/ap/v1/documents');assert.equal(u.searchParams.get('limit'),'500');
    if(requests>2)assert.ok(u.searchParams.get('updated_since'));
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(u.searchParams.has('cursor')?page([fixture()]):page([fixture()],'page-2')));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    const db=database();const sync=createReceivingSync({getPool:()=>db.pool,config:{...config,url:`http://127.0.0.1:${server.address().port}/api/receiving-export/ap/v1/documents`},audit:db.audit});
    assert.equal((await sync()).seen,2);assert.equal(db.state.documents.length,1);assert.equal((await sync()).changed,0);assert.equal(requests,4);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('pagination loops, late-page failure and incompatible duplicate versions never partially import',async()=>{
  for(const mode of ['loop','failure','conflict']) {
    const db=database();let n=0;
    const sync=createReceivingSync({getPool:()=>db.pool,config,audit:db.audit,fetchImpl:async()=>{
      n++;if(n===2&&mode==='failure')throw new Error('private');
      return response(page([fixture(n===2&&mode==='conflict'?{received_value_satang:5}:{})], n===1||mode==='loop'?'repeat':null));
    }});
    await assert.rejects(sync());assert.equal(db.state.documents.length,0);assert.equal(db.state.history.length,0);assert.equal(db.state.runs[0].status,'FAILED');
  }
});

test('admin routes enforce existing permissions, disabled sync avoids DB, decision guard remains active',async()=>{
  let connections=0,decisions=0;
  const build=(receivingConfig={})=>createApRouter({getPool:()=>{connections++;throw new Error('private');},receivingConfig,
    authenticate:(req,res,next)=>req.headers.role?(req.user={role:req.headers.role},next()):res.sendStatus(401),
    requirePermission:p=>(req,res,next)=>{try{assertPermission(req.user,p);next();}catch{res.sendStatus(403);}},
    decisionReasonRequired:true,requireHumanDecision:key=>(req,res)=>{assert.equal(key,'cashflow.post.ap.receiving.sync');decisions++;res.sendStatus(428);}});
  const call=(router,role,method='POST',url='/receiving/sync')=>new Promise((resolve,reject)=>router.handle({method,url,originalUrl:'/api/ap'+url,headers:{role},query:{month:'2026-10'}},{statusCode:200,status(n){this.statusCode=n;return this;},sendStatus(status){resolve({status});},json(body){resolve({status:this.statusCode,body});}},reject));
  const disabled=build();assert.equal((await call(disabled,null)).status,401);
  for(const role of ['cashier','recorder','auditor','accountant'])assert.equal((await call(disabled,role)).status,403);
  assert.equal((await call(disabled,'admin')).body.code,'RECEIVING_DISABLED');assert.equal(connections,0);
  assert.equal((await call(build(config),'admin')).status,428);assert.equal(decisions,1);assert.equal(connections,0);
  assert.equal((await call(disabled,'admin','GET','/receiving/status')).body.data.configured,false);
  assert.equal((await call(disabled,'admin','DELETE')).status,405);
  const r=await call(disabled,'admin','GET','/receiving/documents');assert.equal(r.status,503);assert.ok(!JSON.stringify(r).includes('private'));
});
