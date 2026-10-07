import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { previousBangkokDay, parseDotQuery, buildDotReport, loadDotData, createDotHandler, DOT_PATH, cents } from '../src/dotReconciliation.js';

const now = new Date('2026-10-02T03:00:00Z');
const q = parseDotQuery({}, now);
function fixture(overrides = {}) {
  return { branches: [{ code: 'KK', is_active: true }], selectedIds: [1], next_cursor: null,
    receipts: [{ id: 1, receipt_date: '2026-10-01', branch_code: 'KK', status: 'SUBMITTED', gross_sales_expected: '1000.00', morning_change_amount: '200.00', misc_total: '0.00', deposits_received: '0.00', deposits_applied: '0.00', clickhouse_synced_at: '2026-10-01 22:00:00' }],
    lines: [{ id: 10, receipt_id: 1, channel_code: 'CASH', channel_kind: 'cash', expected_amount: '1000.00', cashier_amount: '1200.00', statement_amount: '1200.00', manual_checked_without_reference: 1, reconciliation_adjustment_amount: '0.00' }],
    transactions: [], adjustments: [], ...overrides };
}
const report = d => buildDotReport(d, q, now);
const bankTx = (extra = {}) => ({ id: 90, receipt_line_id: 10, transaction_date: '2026-10-02', amount: '800.00', unique_hash: 'a'.repeat(64), account_id: 1, match_status: 'matched_auto', raw_payload: { source: 'kbank_monthly_grab_statement' }, ...extra });

test('Bangkok midnight, month/year/leap rollover', () => {
  assert.equal(previousBangkokDay(new Date('2026-10-01T16:59:59Z')), '2026-09-30');
  assert.equal(previousBangkokDay(new Date('2026-10-01T17:00:00Z')), '2026-10-01');
  assert.equal(previousBangkokDay(new Date('2026-12-31T17:00:00Z')), '2026-12-31');
  assert.equal(previousBangkokDay(new Date('2024-03-01T00:00:00Z')), '2024-02-29');
});
test('query rejects future, invalid dates, injection, arrays, branch/threshold overrides', () => {
  for (const input of [{day:'2026-02-30'}, {day:'2026-10-02'}, {day:['2026-10-01']}, {cursor:'1 OR 1=1'}, {cursor:['0']}, {cursor:'-1'}, {branch:'SK'}, {threshold:'0'}]) assert.throws(() => parseDotQuery(input,now));
  assert.equal(parseDotQuery({cursor:'51',day:'2026-09-30'},now).cursor,51);
});
test('decimal blanks stay unknown and threshold is exact to the satang', () => {
  for (const v of [null, undefined, '', ' ', false, 'NaN', '1e2', '100.001']) assert.equal(cents(v),null);
  for (const amount of ['100.00', '-100.00', '100.01', '-100.01']) {
    const d=fixture(); d.receipts[0].receipt_date='2026-09-01';
    d.lines[0].cashier_amount=(1200+Number(amount)).toFixed(2);
    assert.equal(report(d).rows.some(r=>r.scope==='HISTORICAL_DIFFERENCE'),Math.abs(Number(amount))>100);
  }
});
test('cash float and received/applied deposits follow existing daily formula', () => {
  const d=fixture(); Object.assign(d.receipts[0],{deposits_received:'500.00',deposits_applied:'100.00',misc_total:'50.00'});
  Object.assign(d.lines[0],{cashier_amount:'1550.00',statement_amount:'1550.00'});
  const r=report(d).rows[0]; assert.equal(r.cashier_variance,'0.00'); assert.equal(r.actual_reconciled_variance,'0.00');
  assert.equal(r.refund_amount,null);
});
test('draft defaults, unverified cash and blank statement do not prove receipts', () => {
  for (const patch of [{manual_checked_without_reference:0},{statement_amount:null},{statement_amount:''}]) {
    const d=fixture();Object.assign(d.lines[0],patch);assert.equal(report(d).rows[0].actual_total,null);
  }
  const d=fixture(); d.receipts[0].status='DRAFT'; const r=report(d).rows[0];
  assert.equal(r.cashier_total,null);assert.equal(r.actual_total,null);assert.equal(r.misc_amount,null);
});
test('missing one channel does not produce a misleading partial total', () => {
  const d=fixture(); d.lines.push({id:11,receipt_id:1,channel_code:'QR_KPLUS',channel_kind:'qr',cashier_amount:null,expected_amount:'100.00'});
  assert.equal(report(d).rows[0].cashier_total,null);assert.equal(report(d).rows[0].actual_total,null);
});
test('opposing cash/card variances do not cancel out of historical review', () => {
  const d=fixture();d.receipts[0].receipt_date='2026-09-01';d.lines[0].cashier_amount='900.00';
  d.lines.push({id:11,receipt_id:1,channel_code:'CREDIT_CARD_SCB',channel_kind:'credit_card',cashier_amount:'300.00',expected_amount:'0.00'});
  const r=report(d).rows.find(r=>r.scope==='HISTORICAL_DIFFERENCE');assert.ok(r);assert.equal(r.cashier_variance,'0.00');
  assert.equal(r.groups.find(g=>g.group==='cash').cashier_pos_variance,'-300.00');
  assert.equal(r.groups.find(g=>g.group==='card').cashier_pos_variance,'300.00');
});
test('incomplete positive delivery report with zero net remains unknown',()=>{
  const d=fixture();Object.assign(d.lines[0],{channel_code:'GRAB',channel_kind:'delivery',cashier_amount:'1000.00',expected_gross_amount:'1000.00',expected_net_amount:'0.00',fee_amount:'0.00',settlement_source:'GRAB_REPORT'});
  assert.equal(report(d).rows[0].lines[0].expected_net_amount,null);assert.ok(report(d).rows[0].issues.includes('INCOMPLETE_DELIVERY_REPORT'));
});
test('delivery report net is expected; only bank evidence proves later settlement', () => {
  const d=fixture(); Object.assign(d.lines[0],{channel_code:'GRAB',channel_kind:'delivery',cashier_amount:'1000.00',expected_gross_amount:'1000.00',expected_net_amount:'800.00',fee_amount:'200.00',settlement_source:'GRAB_REPORT'});
  d.transactions=[bankTx({raw_payload:{source:'grab_daily_report'}})];
  assert.equal(report(d).rows[0].lines[0].actual_amount,null);
  d.transactions=[bankTx()];const l=report(d).rows[0].lines[0];assert.equal(l.actual_amount,'800.00');assert.equal(l.fee_amount,'200.00');assert.equal(l.settlement_variance,'0.00');assert.deepEqual(l.bank_received_dates,['2026-10-02']);
});
test('duplicates suppress actual proof rather than double count', () => {
  const d=fixture();Object.assign(d.lines[0],{channel_code:'QR_KPLUS',channel_kind:'qr'});
  d.transactions=[bankTx(),bankTx({id:91})];const r=report(d).rows[0];assert.equal(r.actual_total,null);assert.ok(r.issues.includes('DUPLICATE_BANK_EVIDENCE'));
});
test('batch requires all allocations and a full bank proof, including sibling days', () => {
  const d=fixture();Object.assign(d.lines[0],{channel_code:'GRAB',channel_kind:'delivery',settlement_batch_key:'batch',settlement_batch_allocated_net_amount:'400.00',settlement_batch_allocated_fee_amount:'100.00'});
  d.lines.push({...d.lines[0],id:11,receipt_id:2});d.transactions=[bankTx()];
  assert.equal(report(d).rows[0].lines[0].actual_amount,'400.00');
  d.lines[1].settlement_batch_allocated_net_amount=null;
  assert.equal(report(d).rows[0].lines[0].actual_amount,null);
});
test('outside-approved-branch batch membership never proves a scoped allocation',()=>{
  const d=fixture();Object.assign(d.lines[0],{channel_code:'GRAB',channel_kind:'delivery',settlement_batch_key:'outside',settlement_batch_allocated_net_amount:'800.00',settlement_batch_allocated_fee_amount:'200.00'});
  d.transactions=[bankTx()];d.blockedBatchKeys=['outside'];
  const r=report(d).rows[0];assert.equal(r.lines[0].actual_amount,null);assert.ok(r.issues.includes('SETTLEMENT_BATCH_OUTSIDE_APPROVED_BRANCHES'));
});
test('closed historic residual survives, latest adjustment supersedes snapshot', () => {
  const d=fixture();Object.assign(d.receipts[0],{receipt_date:'2026-09-01',status:'CLOSED',closed_reconciliation_snapshot:{version:1,variance_total:200}});
  assert.ok(report(d).rows.some(r=>r.scope==='HISTORICAL_DIFFERENCE'));
  d.adjustments=[{receipt_id:1,revision:1,amount:'0.00',variance_total_after:'0.00'}];
  assert.ok(!report(d).rows.some(r=>r.scope==='HISTORICAL_DIFFERENCE'));
});
test('serializer excludes personal data, notes, raw bank payloads and sibling branches', () => {
  const d=fixture();d.receipts[0].full_name='PRIVATE_PERSON';d.receipts[0].review_note='PRIVATE_NOTE';d.lines[0].exception_note='PRIVATE_NOTE';d.receipts.push({...d.receipts[0],id:2,branch_code:'SECRET'});d.selectedIds.push(2);
  const text=JSON.stringify(report(d));for(const privateValue of ['PRIVATE_PERSON','PRIVATE_NOTE','SECRET','raw_payload','account_id'])assert.ok(!text.includes(privateValue));
});
test('empty pages retain continuation and explicitly missing yesterday per branch', () => {
  const d=fixture({receipts:[],lines:[],selectedIds:[],next_cursor:51});const r=report(d);
  assert.equal(r.pagination.complete,false);assert.equal(r.pagination.next_cursor,'51');assert.equal(r.rows[0].status,'MISSING');
  assert.deepEqual(buildDotReport(d,{...q,cursor:50},now).rows,[]);
});
test('loader uses bound inputs/read-only transaction and releases on success/failure', async () => {
  const calls=[];let committed=false,released=false,rolledBack=false;
  const c={query:async(sql,params)=>{const text=typeof sql==='string'?sql:sql.sql;calls.push([text,params]);return [[]];},commit:async()=>{committed=true;},rollback:async()=>{rolledBack=true;},release:()=>{released=true;}};
  await loadDotData({getConnection:async()=>c},q,['KK']);
  assert.ok(committed&&released);assert.equal(calls[1][0],'START TRANSACTION READ ONLY');
  assert.ok(calls.slice(2).every(([sql])=>sql.trim().startsWith('SELECT')));
  assert.ok(calls.some(([,params])=>params?.includes(q.day)));
  c.query=async()=>{throw new Error('SQL private detail');};released=false;
  await assert.rejects(loadDotData({getConnection:async()=>c},q,['KK']));assert.ok(rolledBack&&released);
});
test('populated loader SELECTs include deposits and batch siblings but never personnel',async()=>{
  const calls=[];let selected=0;
  const c={query:async(input,params)=>{
    const sql=typeof input==='string'?input:input.sql;calls.push([sql,params]);
    if(sql.startsWith('SELECT id, code'))return [[{id:1,code:'KK',is_active:true}]];
    if(sql.startsWith('SELECT dr.id'))return [[{id:++selected}]];
    if(sql.startsWith('SELECT DISTINCT'))return [[{id:3,branch_code:'KK',batch_key:'allowed'}, {id:99,branch_code:'OUTSIDE',batch_key:'blocked'}]];
    return [[]];
  },commit:async()=>{},rollback:async()=>{},release:()=>{}};
  const d=await loadDotData({getConnection:async()=>c},q,['KK']);
  assert.deepEqual(d.selectedIds,[1,2]);assert.ok(calls.some(([sql,params])=>sql.includes('dr.gross_sales_expected')&&params[0].includes(3)));
  assert.deepEqual(d.blockedBatchKeys,['blocked']);
  assert.ok(calls.filter(([sql])=>sql.includes('WHERE dr.id IN')||sql.includes('WHERE l.receipt_id IN')||sql.includes('WHERE st.receipt_id IN')).every(([,params])=>!params[0].includes(99)));
  assert.ok(calls.slice(2).every(([sql])=>/^SELECT\b/.test(sql)));
  for(const [sql]of calls)assert.ok(!/\b(users|full_name|booking_reference|account_number|INSERT|UPDATE|DELETE)\b|SELECT\s+\*/i.test(sql));
});

const token='TEST_ONLY_'.padEnd(43,'x');
const activeEnv={CASHFLOW_DOT_TOKEN_SHA256:crypto.createHash('sha256').update(token).digest('hex'),CASHFLOW_DOT_BRANCHES:'KK',CASHFLOW_DOT_EXPIRES_AT:'2026-10-03T00:00:00Z'};
async function request(handler,{method='GET',headers={},query={}}={}) {
  const res={statusCode:200,headers:{},set(k,v){this.headers[k]=v;},removeHeader(){},status(n){this.statusCode=n;return this;},json(x){this.body=x;return this;}};
  await handler({method,headers,query},res);return res;
}
test('disabled, expiry, bad/missing tokens and query-token never acquire data',async()=>{
  let count=0;const loader=async()=>{count++;return fixture();};
  for (const env of [{},{...activeEnv,CASHFLOW_DOT_EXPIRES_AT:'2026-01-01'}, {...activeEnv,CASHFLOW_DOT_BRANCHES:''}]) assert.equal((await request(createDotHandler({env,loader,now:()=>now}))).statusCode,503);
  const h=createDotHandler({env:activeEnv,loader,now:()=>now});
  for(const req of [{},{query:{access_token:token}},{headers:{authorization:'Bearer wrong'}},{headers:{cookie:`token=${token}`}}])assert.equal((await request(h,req)).statusCode,401);
  assert.equal(count,0);
});
test('only GET, valid header and fixed allowed branches; generic failure/no caching',async()=>{
  let count=0;const h=createDotHandler({env:activeEnv,now:()=>now,loader:async(_p,_q,branches)=>{assert.deepEqual(branches,['KK']);count++;return fixture();}});
  const headers={authorization:`Bearer ${token}`};
  for(const method of ['POST','PUT','PATCH','DELETE','HEAD','OPTIONS'])assert.equal((await request(h,{headers,method})).statusCode,405);
  assert.equal((await request(h,{headers:{...headers,origin:'https://evil.example'}})).statusCode,403);
  const res=await request(h,{headers});assert.equal(res.statusCode,200);assert.equal(count,1);assert.equal(res.headers['Cache-Control'],'no-store');
  const broken=createDotHandler({env:activeEnv,now:()=>now,loader:async()=>{throw new Error('secret database password');}});
  assert.deepEqual((await request(broken,{headers})).body,{error:'Reconciliation read failed.'});
});
test('additional read token has its own branch scope without rotating primary token',async()=>{
  const second='GATEWAY_TEST_ONLY_'.padEnd(43,'y');
  const env={...activeEnv,CASHFLOW_DOT_EXTRA_TOKENS_JSON:JSON.stringify([{sha256:crypto.createHash('sha256').update(second).digest('hex'),branches:['SK'],expires_at:'2026-10-03T00:00:00Z'}])};
  const seen=[];
  const h=createDotHandler({env,now:()=>now,loader:async(_pool,_query,branches)=>{seen.push(branches);return fixture();}});
  assert.equal((await request(h,{headers:{authorization:`Bearer ${token}`}})).statusCode,200);
  assert.equal((await request(h,{headers:{authorization:`Bearer ${second}`}})).statusCode,200);
  assert.deepEqual(seen,[['KK'],['SK']]);
});
test('concurrent reads are bounded',async()=>{
  let resolve;const h=createDotHandler({env:activeEnv,now:()=>now,loader:()=>new Promise(r=>{resolve=r;})});const headers={authorization:`Bearer ${token}`};
  const first=request(h,{headers});assert.equal((await request(h,{headers})).statusCode,429);resolve(fixture());await first;
});
test('real Express routing denies write and unauthenticated GET before later middleware',async()=>{
  const app=express();let later=0;app.all(DOT_PATH,createDotHandler({env:activeEnv,now:()=>now,loader:async()=>fixture()}));app.use((_req,res)=>{later++;res.send('later');});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try{const url=`http://127.0.0.1:${server.address().port}${DOT_PATH}`;assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{method:'POST',headers:{authorization:`Bearer ${token}`}})).status,405);assert.equal((await fetch(url,{headers:{authorization:`Bearer ${token}`}})).status,200);assert.equal(later,0);}finally{await new Promise(r=>server.close(r));}
});
