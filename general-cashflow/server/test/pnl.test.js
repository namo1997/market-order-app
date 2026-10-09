import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, classify, cents, amountInput, snapshotItems, parseBranchMap, monthRange } from '../src/pnl/domain.js';
import { buildReport, elapsedDates } from '../src/pnl/report.js';
import { createSync } from '../src/pnl/sync.js';
import { migratePnl } from '../src/pnl/schema.js';

test('normalization, rule priority/id, exclusion and explicit override precedence', () => {
  assert.equal(normalize('  บริษัท ร้าน Ab C จำกัด (มหาชน) บจก. หจก. '), 'abc');
  const item = { supplier_name:'ร้าน ABC', description:'ค่าไฟ', transaction_type:'loan', profile_status:'draft' };
  const rules = [{id:2,priority:1,match_field:'supplier',pattern:'abc',category_code:'OTHER'}, {id:1,priority:1,match_field:'purpose',pattern:'ค่าไฟ',category_code:'UTILITIES'}];
  assert.equal(classify(item,rules).category_code,'UTILITIES');
  assert.equal(classify(item,rules).excluded,true);
  assert.equal(classify(item,rules,{excluded:0,category_code:'STAFF'}).excluded,false);
  assert.equal(classify(item,rules,{excluded:false,category_code:'STAFF'}).category_code,'STAFF');
  assert.equal(classify({transaction_type:null}).excluded,false);
  assert.equal(classify({transaction_type:'unknown'}).unreviewed,true);
  assert.equal(classify({transaction_type:'internal_transfer',profile_status:'reviewed'}).unreviewed,false);
  assert.equal(classify({transaction_type:'refund_adjustment'}).excluded,true);
});
test('money operands are rounded to cents before summation and amount/month validation is strict', () => {
  assert.equal(cents('0.1')+cents('0.2'),30); assert.equal(amountInput('0.01'),'0.01');
  for(const value of ['0','-1','1.001','1e3','NaN']) assert.throws(()=>amountInput(value),{code:'INVALID_AMOUNT'});
  for(const value of ['2026-00','2026-13','foo']) assert.throws(()=>monthRange(value),{code:'INVALID_MONTH'});
  assert.equal(monthRange('2024-02').to,'2024-02-29');
  assert.deepEqual(parseBranchMap('bad'),{}); assert.deepEqual(parseBranchMap('[]'),{});
});
test('report formula/category/branch invariants, unknown and central, closed-only LINE and manual soft delete', () => {
  const data = { month:'2026-10', now:new Date('2026-10-03T18:00:00Z'), branches:[{id:1,name:'สาขาทดสอบ'}],
    categories:[{code:'COGS_FOOD',is_cogs:1},{code:'OTHER',is_cogs:0}],
    receipts:[{branch_id:1,receipt_date:'2026-10-01',gross_sales_expected:'100.00',status:'CLOSED'}, {branch_id:1,receipt_date:'2026-10-02',gross_sales_expected:'50.00',status:'SUBMITTED'}],
    rounds:[{id:1,branch_id:1,business_date:'2026-10-01',status:'closed',reimbursement_count:1,incoming_transfer_count:2},{id:2,branch_id:1,business_date:'2026-10-02',status:'open',reimbursement_count:0,incoming_transfer_count:0}],
    items:[{round_id:1,stable_key:'a',branch_id:1,amount:'0.1',supplier_name:'อาหาร'}, {round_id:1,stable_key:'b',branch_id:null,amount:'0.2'}, {round_id:1,stable_key:'c',branch_id:1,amount:'20',transaction_type:'loan'}, {round_id:2,stable_key:'d',branch_id:1,amount:'999'}],
    rules:[{id:1,priority:100,match_field:'supplier',pattern:'อาหาร',category_code:'COGS_FOOD'}],
    manual:[{id:1,branch_id:null,category_code:'OTHER',amount:'1.01'}, {id:2,branch_id:1,category_code:'OTHER',amount:'50',deleted_at:'2026-10-01'}], closes:[{branch_id:1,revision_number:3}] };
  const report=buildReport(data);
  assert.equal(report.totals.revenue,150); assert.equal(report.totals.cogs,.1); assert.equal(report.totals.opex,1.21);
  assert.equal(report.totals.gross_profit,149.9); assert.equal(report.totals.net_profit,148.69);
  assert.equal(report.excluded_total,20); assert.equal(report.manual_total,1.01);
  assert.equal(report.reimbursement_count,1); assert.equal(report.incoming_transfer_count,2);
  assert.equal(report.category_rows.reduce((n,row)=>n+cents(row.amount),0),cents(report.totals.cogs)+cents(report.totals.opex));
  for (const field of ['revenue','cogs','opex','gross_profit','net_profit']) assert.equal(report.branch_columns.reduce((n,row)=>n+cents(row[field]),0),cents(report.totals[field]));
  assert.deepEqual(report.completeness[0].expense_missing,['2026-10-02','2026-10-03']);
  assert.equal(report.completeness[0].revenue_days,1); assert.equal(report.completeness[0].month_close_revision,3);
  const filtered=buildReport({...data,branchId:1}); assert.equal(filtered.totals.opex,0);
  assert.equal(buildReport({...data,receipts:[]}).totals.margin_pct,null);
  assert.equal(elapsedDates('2026-10',new Date('2026-09-30T17:01:00Z')).length,0);
  assert.equal(elapsedDates('2026-09',new Date('2026-10-01T00:00:00Z')).length,30);
});
test('snapshot version, stable keys, duplicate bill counted once and payment_without_bill support', () => {
  const data={pnl_fields_version:1,items:[{stable_key:'lbc:bill:1',amount_incl_vat:'12.34'}, {stable_key:'lbc:bill:1',amount_incl_vat:500}],payments_without_bill:[{stable_key:'lbc:payment:2',amount:'4.50'}]};
  const result=snapshotItems(data); assert.equal(result.duplicateKeys,1); assert.equal(result.items.length,2);
  assert.equal(result.items[0].amount,'12.34'); assert.equal(result.items[1].kind,'PAYMENT_WITHOUT_BILL');
  assert.throws(()=>snapshotItems({items:[]}),{code:'LBC_EXPORT_V2_REQUIRED'});
  assert.throws(()=>snapshotItems({pnl_fields_version:1,items:[{amount_incl_vat:1}]}),{code:'LBC_EXPORT_V2_REQUIRED'});
});

// Small stateful SQL adapter: no filesystem/DB/network. Transactions copy state for rollback.
export const fakeSyncDb = () => {
  let state={rounds:[],items:[],runs:[],overrides:[{stable_key:'lbc:bill:1',category_code:'OTHER'}]};
  let backup; let held=false; const calls=[];
  const connection={release(){},async beginTransaction(){backup=structuredClone(state);},async commit(){backup=null;},async rollback(){state=backup;backup=null;},async query(sql,args=[]){
    calls.push([sql,args]);
    if(sql.includes('GET_LOCK')) {const acquired=held?0:1;held=true;return [[{acquired}]];}
    if(sql.includes('RELEASE_LOCK')){held=false;return [[]];}
    if(sql.startsWith('INSERT INTO pnl_sync_runs')){const id=state.runs.length+1;state.runs.push({id,status:'RUNNING'});return [{insertId:id}];}
    if(sql.startsWith('UPDATE pnl_sync_runs')){const row=state.runs.find(r=>r.id===args.at(-1));row.status=sql.includes("status='FAILED'")?'FAILED':'SUCCEEDED';row.args=args;return [{}];}
    if(sql==='SELECT id, code FROM branches')return [[{id:1,code:'TEST'}]];
    if(sql.includes('FROM pnl_expense_rounds WHERE source_id'))return [state.rounds.filter(r=>r.source_id===args[0]&&r.business_date===args[1])];
    if(sql.startsWith('INSERT INTO pnl_expense_rounds')){let row=state.rounds.find(r=>r.source_id===args[0]&&r.business_date===args[1]);if(!row){row={id:state.rounds.length+1};state.rounds.push(row);} Object.assign(row,Object.fromEntries(['source_id','business_date','branch_id','status','revision','fingerprint','snapshot_fingerprint','profile_max_updated_at','item_count','amount_total','reimbursement_count','incoming_transfer_count'].map((k,i)=>[k,args[i]])));return [{}];}
    if(sql.startsWith('SELECT round_id FROM pnl_expense_items'))return [state.items.filter(r=>r.stable_key===args[0]&&r.round_id!==args[1])];
    if(sql.startsWith('DELETE FROM pnl_expense_items')){state.items=state.items.filter(r=>sql.includes('round_id')?r.round_id!==args[0]:r.stable_key!==args[0]);return [{}];}
    if(sql.startsWith('INSERT INTO pnl_expense_items')){state.items.push({stable_key:args[0],round_id:args[1],kind:args[2],amount:args[7]});return [{}];}
    if(sql.startsWith('UPDATE pnl_expense_rounds SET')) {const row=state.rounds.find(r=>r.id===args[2]);const items=state.items.filter(r=>r.round_id===row.id);row.item_count=items.length;row.amount_total=(items.reduce((n,r)=>n+cents(r.amount),0)/100).toFixed(2);return [{}];}
    throw new Error('Unexpected SQL: '+sql);
  }};
  return {pool:{async getConnection(){return connection;}},calls,get state(){return state;}};
};
const round=(date='2026-10-01')=>({id:`test:${date}`,source_id:'test',business_date:date,status:'closed',fingerprint:'list-fingerprint',profile_max_updated_at:null});
const snapshot=(r)=>({...r,pnl_fields_version:1,fingerprint:'snapshot-fingerprint',items:[{stable_key:'lbc:bill:1',amount_incl_vat:10}],reimbursements:[{}],incoming_transfers:[{}]});
const harness=()=>{const db=fakeSyncDb();let rounds=[round()];let snapshots=new Map(rounds.map(r=>[r.id,snapshot(r)]));let requests=[];
 const sync=createSync({getPool:()=>db.pool,config:{baseUrl:'https://example.invalid',token:'fixture-only',branchMap:'{"test":"TEST"}'},fetchImpl:async(url,options)=>{requests.push([url,options]);if(url.includes('/snapshot'))return {ok:true,json:async()=>({success:true,data:snapshots.get(decodeURIComponent(url.split('/').at(-2)))})};return {ok:true,json:async()=>({success:true,data:rounds,pagination:{next_offset:null}})};}});
 return {db,sync,requests,get rounds(){return rounds;},set rounds(v){rounds=v;},snapshots};};
test('sync idempotence compares list fingerprint, revision timestamp invalidates, override survives and reopened round reduces totals', async()=>{
 const h=harness(); await h.sync({month:'2026-10',userId:1});assert.equal(h.db.state.rounds[0].fingerprint,'list-fingerprint');assert.equal(h.db.state.rounds[0].snapshot_fingerprint,'snapshot-fingerprint');
 const inserts=h.db.calls.filter(([s])=>s.startsWith('INSERT INTO pnl_expense_items')).length;
 assert.equal((await h.sync({month:'2026-10',userId:1})).rounds_refetched,0);assert.equal(h.db.calls.filter(([s])=>s.startsWith('INSERT INTO pnl_expense_items')).length,inserts);
 h.rounds[0].fingerprint='changed';h.snapshots.set(h.rounds[0].id,{...snapshot(h.rounds[0]),items:[{stable_key:'lbc:bill:2',amount_incl_vat:20}]});
 await h.sync({month:'2026-10',userId:1});assert.equal(h.db.state.items[0].stable_key,'lbc:bill:2');assert.equal(h.db.state.items.length,1);assert.equal(h.db.state.overrides.length,1);
 h.rounds[0].profile_max_updated_at='2026-10-02';assert.equal((await h.sync({month:'2026-10',userId:1})).rounds_refetched,1);
 h.rounds[0].status='open';await h.sync({month:'2026-10',userId:1});assert.equal(h.db.state.items.length,0);assert.equal(h.db.state.rounds[0].amount_total,'0.00');
 assert.equal(h.requests[0][1].headers.Authorization,'Bearer fixture-only');
});
test('sync deduplicates, counts moves, fixes old round totals and preserves override',async()=>{
 const h=harness();h.snapshots.get(h.rounds[0].id).items.push({stable_key:'lbc:bill:1',amount_incl_vat:999});
 assert.equal((await h.sync({month:'2026-10',userId:1})).duplicate_keys,1);assert.equal(h.db.state.rounds[0].amount_total,'10.00');
 const next=round('2026-10-02');h.rounds.push(next);h.snapshots.set(next.id,snapshot(next));
 assert.equal((await h.sync({month:'2026-10',userId:1})).moved_keys,1);assert.equal(h.db.state.rounds[0].amount_total,'0.00');assert.equal(h.db.state.items[0].round_id,2);assert.equal(h.db.state.overrides.length,1);
});
test('old export failure is recorded without leaking response, transaction rollback and lock release',async()=>{
 for(const change of [s=>delete s.pnl_fields_version,s=>delete s.items[0].stable_key]){
 const h=harness();change(h.snapshots.get(h.rounds[0].id));await assert.rejects(h.sync({month:'2026-10',userId:1}),{code:'LBC_EXPORT_V2_REQUIRED'});assert.equal(h.db.state.runs[0].status,'FAILED');assert.equal(h.db.state.rounds.length,0);assert.ok(h.db.calls.some(([s])=>s.includes('RELEASE_LOCK')));}
 const h=harness();const original=h.db.pool.getConnection;h.db.pool.getConnection=async()=>{const c=await original();const q=c.query.bind(c);return {...c,query:async(s,a)=>{if(s.startsWith('INSERT INTO pnl_expense_items'))throw new Error('private response');return q(s,a);}};};
 await assert.rejects(h.sync({month:'2026-10',userId:1}),{code:'PNL_SYNC_FAILED'});assert.equal(h.db.state.rounds.length,0);assert.equal(h.db.state.runs[0].status,'FAILED');
});
test('concurrent sync uses connection-scoped lock and second returns 409',async()=>{
 const db=fakeSyncDb();let resolve;const wait=new Promise(r=>resolve=r);let ready;const entered=new Promise(r=>ready=r);
 const sync=createSync({getPool:()=>db.pool,config:{baseUrl:'https://example.invalid',token:'fake'},fetchImpl:async()=>{ready();await wait;return {ok:true,json:async()=>({success:true,data:[],pagination:{next_offset:null}})};}});
 const first=sync({month:'2026-10',userId:1});await entered;await assert.rejects(sync({month:'2026-10',userId:2}),{code:'PNL_SYNC_RUNNING',statusCode:409});resolve();await first;
 assert.equal(db.calls.filter(([s])=>s.includes('RELEASE_LOCK')).length,1);
});
test('schema is additive, DECIMAL only, seeds INSERT IGNORE and override is not cascaded',async()=>{
 const calls=[];await migratePnl({query:async(s,p)=>{calls.push([s,p]);}});
 assert.equal(calls.filter(([s])=>s.includes('CREATE TABLE IF NOT EXISTS')).length,7);assert.equal(calls.filter(([s])=>s.startsWith('INSERT IGNORE')).length,8);
 assert.ok(!calls.some(([s])=>s.includes('FLOAT')));assert.ok(calls.some(([s])=>s.includes('duplicate_keys')));assert.ok(calls.some(([s])=>s.includes('snapshot_fingerprint')));
});

test('pagination traverses all pages and network failure is sanitized with FAILED run',async()=>{
 const db=fakeSyncDb();const seen=[];
 const sync=createSync({getPool:()=>db.pool,config:{baseUrl:'https://example.invalid',token:'fake'},fetchImpl:async url=>{const offset=new URL(url).searchParams.get('offset');seen.push(offset);return {ok:true,json:async()=>({success:true,data:[],pagination:{next_offset:offset==='0'?500:null}})};}});
 await sync({month:'2026-10',userId:1});assert.deepEqual(seen,['0','500']);
 const failing=createSync({getPool:()=>db.pool,config:{baseUrl:'https://example.invalid',token:'fake'},fetchImpl:async()=>{throw new Error('secret response');}});
 await assert.rejects(failing({month:'2026-10',userId:1}),{code:'LBC_EXPORT_REQUEST_FAILED'});assert.equal(db.state.runs.at(-1).status,'FAILED');
});
