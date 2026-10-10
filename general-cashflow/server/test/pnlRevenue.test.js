import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { loadMissingPosRevenue } from '../src/pnl/revenue.js';
import { buildReport } from '../src/pnl/report.js';
import { createPnlRouter } from '../src/pnl/routes.js';
import { cents } from '../src/pnl/domain.js';
const now = new Date('2026-10-03T17:01:00Z'); // Oct 4 Bangkok; three elapsed days.
const branches = [{id:1, code:'A', name:'A', clickhouse_branch_id:'fictional-A'}, {id:2, code:'B', name:'B', clickhouse_branch_id:'fictional-B'}];
const receipt = {id:1, branch_id:1, receipt_date:'2026-10-01', gross_sales_expected:'0.00', status:'OPEN'};
const pos = (date, amount, code='A') => ({businessDate:date, branchCode:code, grossSalesExpected:amount, billCount:1});
test('POS fills only absent branch/date receipts: zero/open wins, sparse dates, today/future/unknown/duplicates excluded', async () => {
  let calls=0;
  const result=await loadMissingPosRevenue({month:'2026-10', branches, receipts:[receipt], now, branchId:1, fetchSalesRange:async (args)=>{
    calls++;assert.equal(args.from,'2026-10-01');assert.equal(args.to,'2026-10-03');assert.deepEqual(args.branches,[branches[0]]);assert.ok(args.signal instanceof AbortSignal);
    return [pos('2026-10-01',999),pos('2026-10-02',0.1),pos('2026-10-02',999),pos('2026-10-03',0.2),pos('2026-10-04',999),pos('2026-11-01',999),pos('2026-10-03',999,'B'),pos('2026-10-03',999,'UNKNOWN')];
  }});
  assert.equal(calls,1);assert.equal(result.posRevenue.length,2);assert.equal(result.posRevenueStatus.status,'available');
  const report=buildReport({month:'2026-10',branches,receipts:[receipt],posRevenue:result.posRevenue,now});
  assert.equal(report.totals.revenue,.3);assert.equal(report.totals.receipt_revenue,0);assert.equal(report.totals.pos_without_receipt_revenue,.3);
  assert.equal(report.completeness[0].revenue_days,0);assert.equal(report.completeness[0].revenue_available_days,2);
  assert.deepEqual(report.completeness[0].revenue_unavailable,['2026-10-01']);
});
test('existing CLOSED receipt suppresses fallback and future/current day never requests partial sales', async () => {
  const closed={...receipt,status:'CLOSED',gross_sales_expected:'10.00'};
  const report=buildReport({month:'2026-10',now,branches,receipts:[closed],posRevenue:[{...closed,source:'POS_WITHOUT_RECEIPT',gross_sales_expected:999}]});
  assert.equal(report.totals.revenue,10);assert.equal(report.revenue_pos_without_receipt.length,0);
  for (const month of ['2026-10','2026-11']) {
    const result=await loadMissingPosRevenue({month,now:new Date('2026-09-30T17:01:00Z'),branches,receipts:[],fetchSalesRange:()=>{throw new Error('Must not fetch');}});
    assert.equal(result.posRevenueStatus.status,'not_needed');
  }
  const complete=await loadMissingPosRevenue({month:'2026-10',now,branches:[branches[0]],receipts:[1,2,3].map(d=>({...closed,receipt_date:`2026-10-0${d}`})),fetchSalesRange:()=>{throw new Error('Must not fetch');}});
  assert.equal(complete.posRevenueStatus.status,'not_needed');
});
test('failed/invalid upstream and missing branch mapping leave missing revenue explicit without leaking errors', async () => {
  for (const fetchSalesRange of [async()=>{throw new Error('PRIVATE upstream response');},async()=>[pos('2026-10-02',null)]]) {
    const result=await loadMissingPosRevenue({month:'2026-10',now,branches,receipts:[],fetchSalesRange});
    assert.equal(result.posRevenueStatus.code,'PNL_POS_UNAVAILABLE');assert.deepEqual(result.posRevenue,[]);assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  }
  const result=await loadMissingPosRevenue({month:'2026-10',now,branches:[{id:3,code:'C'}],receipts:[],fetchSalesRange:()=>{throw new Error('Must not fetch');}});
  assert.deepEqual(result.posRevenueStatus.unmapped_branch_ids,[3]);assert.deepEqual(result.posRevenue,[]);
});
test('fallback with closed LINE participates in matched totals without claiming a closed receipt; source and branch invariants', () => {
  const data={month:'2026-10',now,branches,receipts:[{...receipt,status:'CLOSED',gross_sales_expected:10}],
    posRevenue:[{branch_id:1,receipt_date:'2026-10-02',source:'POS_WITHOUT_RECEIPT',gross_sales_expected:20.01},{branch_id:2,receipt_date:'2026-10-02',source:'POS_WITHOUT_RECEIPT',gross_sales_expected:30.02}],
    rounds:[{id:1,branch_id:1,business_date:'2026-10-02',status:'closed'},{id:2,branch_id:2,business_date:'2026-10-02',status:'closed'}],
    items:[{round_id:1,branch_id:1,business_date:'2026-10-02',amount:2.01}],categories:[]};
  const report=buildReport(data);assert.equal(report.totals.revenue,60.03);assert.equal(report.totals_matched.revenue,50.03);
  assert.equal(report.totals_matched.receipt_revenue,0);assert.equal(report.completeness[0].revenue_days,1);assert.equal(report.completeness[0].matched_days,1);
  for(const mode of ['totals','totals_matched']) {
    assert.equal(cents(report[mode].receipt_revenue)+cents(report[mode].pos_without_receipt_revenue),cents(report[mode].revenue));
    assert.equal(report.branch_columns.reduce((n,b)=>n+cents(mode==='totals'?b.revenue:b.matched.revenue),0),cents(report[mode].revenue));
  }
  assert.equal(buildReport({...data,branchId:1}).totals.pos_without_receipt_revenue,20.01);
  const after=buildReport({...data,receipts:[...data.receipts,{branch_id:1,receipt_date:'2026-10-02',gross_sales_expected:19,status:'CLOSED'}]});
  assert.equal(after.totals.revenue,59.02);assert.equal(after.totals.pos_without_receipt_revenue,30.02);
});
test('actual report HTTP route supplies fallback after read transaction, keeps receipt evidence and performs no mutation',async()=>{
  const calls=[];
  const connection={release(){},async beginTransaction(){calls.push('BEGIN');},async commit(){calls.push('COMMIT');},async rollback(){throw Error('unexpected');},async query(sql){
    assert.ok(sql.startsWith('SELECT')); calls.push(sql);
    if(sql.includes('FROM branches'))return [[branches[0]]];
    if(sql.includes('FROM daily_receipts'))return [[receipt]];
    return [[]];
  }};
  const pool={async getConnection(){return connection;},query:connection.query};
  const app=express();app.use('/api/pnl',createPnlRouter({getPool:()=>pool,config:{},authenticate:(req,res,next)=>{req.user={id:1,role:'admin'};next();},requirePermission:()=> (req,res,next)=>next(),logAudit:()=>{throw Error('No audit mutation');},fetchSalesRange:async()=>[pos('2026-08-02',12.34)]}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  try{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/pnl/report?month=2026-08`);assert.equal(response.status,200);
    const {data}=await response.json();assert.equal(data.totals.pos_without_receipt_revenue,12.34);assert.equal(data.revenue_pos_without_receipt[0].source,'POS_WITHOUT_RECEIPT');
    assert.equal(data.pos_revenue_status.status,'available');assert.ok(calls.includes('COMMIT'));
  }finally{await new Promise(resolve=>server.close(resolve));}
});
