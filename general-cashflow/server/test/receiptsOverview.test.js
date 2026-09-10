import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOverviewQuery, buildReceiptsOverview, bankTransactionEvidence, confirmedBankTransactionTotal } from '../src/domain/receiptsOverview.js';
import { loadOverviewData } from '../src/receiptsOverview.js';
import { hasPermission } from '../src/domain/permissions.js';

const q = (changes = {}) => parseOverviewQuery({ from:'2026-08-31', to:'2026-09-02', ...changes }, '2026-09-01');
const receipt = (id, branch = 1, date = '2026-08-31') => ({ id, branch_id:branch, branch_code:branch === 1 ? 'KK' : 'SK', branch_name:`สาขา ${branch}`, receipt_date:date, status:'CLOSED', gross_sales_expected:1000, morning_change_amount:100, misc_total:0, clickhouse_synced_at:'2026-09-01', closed_reconciliation_snapshot:{version:1,reconciled_total:1100,variance_total:0} });
const line = (id, receipt_id, extra = {}) => ({ id, receipt_id, payment_channel_id:2, channel_code:'CREDIT_CARD_KTC', channel_label:'บัตร KTC', channel_kind:'credit_card', receiving_account_id:1, cashier_amount:1000, statement_amount:980, expected_gross_amount:1000, fee_amount:20, expected_net_amount:980, settlement_status:'MATCHED_AUTO', settlement_source:'BANK_STATEMENT', ...extra });
const tx = (id, receipt_line_id, extra = {}) => ({ id,receipt_line_id,transaction_date:'2026-09-01',amount:980,account_id:1,match_status:'matched_auto',unique_hash:`bank-${id}`,import_name:'Historical_bank.pdf',raw_payload:{Time:'12:00',Description:'EDC'},...extra });
const fixture = () => ({ branches:[{id:1,code:'KK',name:'คันคลอง',is_active:1},{id:2,code:'SK',name:'สันกำแพง',is_active:1}], channels:[{id:1,code:'CASH',label:'เงินสด'},{id:2,code:'CREDIT_CARD_KTC',label:'บัตร KTC'},{id:3,code:'GRAB',label:'Grab'}], receipts:[receipt(1)], lines:[line(1,1)], transactions:[tx(1,1)], adjustments:[] });
const build = (data, query) => buildReceiptsOverview(data, query, { today:'2026-09-01' });

test('overview validates real dates, bounded ranges, filters and pagination',()=>{
  for(const input of [{from:'2026-02-30'}, {page:0}, {page_size:101}, {branch_id:'1 OR 1'}, {basis:'other'}, {from:'2024-01-01'}, {to:'2026-08-01'}]) assert.throws(()=>q(input));
  assert.equal(parseOverviewQuery({},'2026-09-07').to,'2026-09-30');
});
test('sale and receipt dates cross months without losing earlier sales',()=>{
  const data=fixture();
  const sale=build(data,q({from:'2026-08-31',to:'2026-08-31',branch_id:1}));
  assert.equal(sale.summary.received,980);
  const received=build(data,q({basis:'received',from:'2026-09-01',to:'2026-09-01'}));
  assert.equal(received.rows[0].date,'2026-09-01');
  assert.equal(received.rows[0].receipts[0].date,'2026-08-31');
  assert.equal(received.summary.received,980);
  assert.equal(received.summary.cashier,null);
});
test('matched Grab reports, inferred dates and manual values never prove bank receipt',()=>{
  const data=fixture(); data.lines[0]=line(1,1,{channel_code:'GRAB',payment_channel_id:3,settlement_source:'GRAB_REPORT',settlement_date:'2026-09-01'});
  data.transactions=[tx(1,1,{import_name:'Grab report.pdf',raw_payload:{source:'grab_daily_report'}})];
  assert.equal(bankTransactionEvidence(data.transactions[0]),false);
  const result=build(data,q({branch_id:1,from:'2026-08-31',to:'2026-08-31'}));
  assert.equal(result.rows[0].lines[0].received,null);
  assert.equal(result.rows[0].lines[0].variance,null);
  assert.equal(result.rows[0].lines[0].expected_date,null);
  assert.equal(build(data,q({basis:'received'})).summary.received,null);
});
test('K SHOP email and its bank statement count the physical QR receipt only once',()=>{
  const email=tx(1,1,{amount:93503,account_id:null,import_name:'KSHOP daily email (auto)',raw_payload:{merchant_id:'KB000001590548',body:'daily settlement'}});
  const bank=tx(2,1,{amount:93503,import_name:'Statement result.csv',raw_payload:{source:'overview_bank_statement',overview_verified:true,inbox_import_id:1943,Time:'12:00',Description:'Thai QR Payment'}});
  assert.equal(bankTransactionEvidence(email),false);
  assert.equal(bankTransactionEvidence(bank),true);
  assert.equal(confirmedBankTransactionTotal([email,bank]),93503);
});
test('cash counts remove float once and adjustments do not create money events',()=>{
  const data=fixture(); data.lines=[line(1,1,{payment_channel_id:1,channel_code:'CASH',channel_kind:'cash',cashier_amount:1100,statement_amount:1100,manual_checked_without_reference:1})]; data.transactions=[];
  data.adjustments=[{receipt_id:1,receipt_line_id:1,revision:1,amount:15,reconciled_total_after:1115,variance_total_after:15,variance_total_before:0,reconciled_total_before:1100}];
  const result=build(data,q({receipt_id:1}));
  assert.equal(result.rows[0].received,1000); assert.equal(result.rows[0].confirmed_variance,15);
  assert.equal(build(data,q({basis:'received'})).summary.received,1000);
});
test('closing acknowledges existing variances without leaving false follow-up work',()=>{
  const data=fixture();
  data.receipts[0].closed_reconciliation_snapshot={version:1,reconciled_total:975,variance_total:-25};
  const result=build(data,q({receipt_id:1}));
  assert.equal(result.rows[0].confirmed_variance,-25);
  assert.equal(result.rows[0].attention,false);
  assert.deepEqual(result.rows[0].reasons,[]);
  assert.equal(build(data,q({receipt_id:1,tab:'followups'})).rows.length,0);
});
test('unused fallback channel never creates hidden totals or follow-up work',()=>{
  const data=fixture();
  data.lines.push(line(2,1,{payment_channel_id:4,channel_code:'OTHER_UNKNOWN',channel_label:'จ่ายหน้าร้าน',channel_kind:'other',cashier_amount:4375,statement_amount:null,expected_gross_amount:0,expected_net_amount:0,settlement_source:'NONE',settlement_status:'PENDING'}));
  const row=build(data,q({receipt_id:1})).rows[0];
  assert.equal(row.lines.some(l=>l.channel_code==='OTHER_UNKNOWN'),false);
  assert.equal(row.cashier,1000);
  assert.equal(row.reasons.some(reason=>reason.includes('ยอดคาดรับสุทธิ')),false);
});
test('closed receipts still flag missing money proof and evidence imported after closing',()=>{
  const missing=fixture();missing.transactions=[];
  assert.equal(build(missing,q({receipt_id:1})).rows[0].attention,true);
  assert.ok(build(missing,q({receipt_id:1})).rows[0].reasons.includes('รอหลักฐานเงินเข้า'));

  const late=fixture();late.receipts[0].closed_at='2026-09-01T09:00:00.000Z';
  late.transactions=[tx(1,1,{amount:900,created_at:'2026-09-01T10:00:00.000Z'})];
  const row=build(late,q({receipt_id:1})).rows[0];
  assert.equal(row.attention,true);
  assert.ok(row.reasons.includes('หลักฐานย้อนหลังไม่ตรง'));
});
test('batch sale allocation differs from physical bank transaction dates without double counting',()=>{
  const data=fixture(); data.receipts.push(receipt(2,1,'2026-09-01'));
  data.lines=[line(1,1,{settlement_batch_key:'batch',settlement_batch_allocated_net_amount:980,settlement_batch_allocated_fee_amount:20}),line(2,2,{settlement_batch_key:'batch',settlement_batch_allocated_net_amount:980,settlement_batch_allocated_fee_amount:20})];
  data.transactions=[tx(1,1,{amount:1960})];
  const sale=build(data,q({branch_id:1})); assert.equal(sale.summary.received,1960);
  assert.equal(sale.rows.find(r=>r.receipt_id===2).received,980);
  const received=build(data,q({basis:'received'})); assert.equal(received.summary.received,1960); assert.equal(received.rows.length,1);
  assert.deepEqual(received.rows[0].receipt_ids.sort(),[1,2]);
  const saleLedger=build(data,q({tab:'transactions',branch_id:1}));
  assert.equal(saleLedger.summary.received,1960);assert.equal(saleLedger.rows.length,2);
  assert.equal(build(data,q({tab:'transactions',from:'2026-08-31',to:'2026-08-31'})).summary.received,980);
  const receivedLedger=build(data,q({tab:'transactions',basis:'received'}));
  assert.equal(receivedLedger.rows.length,1);assert.deepEqual(receivedLedger.rows[0].sale_dates,['2026-08-31','2026-09-01']);
  data.transactions[0].amount=1000;
  assert.equal(build(data,q({receipt_id:1})).rows[0].received,null);
});
test('multiple bank receipts keep amounts once and do not repeat channel gross/fees',()=>{
  const data=fixture(); data.transactions=[tx(1,1,{amount:480}),tx(2,1,{amount:500,transaction_date:'2026-09-02'})];
  const result=build(data,q({tab:'transactions',basis:'received'}));
  assert.equal(result.rows.length,2); assert.equal(result.summary.received,980); assert.equal(result.summary.cashier,null);
  assert.equal(result.rows[0].before,null);
});
test('duplicate bank identifiers across receipts are counted once and flagged',()=>{
  const data=fixture();data.receipts.push(receipt(2,1,'2026-09-01'));data.lines.push(line(2,2));
  data.transactions.push(tx(2,2,{unique_hash:'bank-1'}));
  const result=build(data,q({basis:'received'}));assert.equal(result.summary.received,980);
  assert.ok(build(data,q({receipt_id:2})).rows[0].reasons.some(r=>r.includes('ซ้ำ')));
});
test('unknown is distinct from zero; missing and future days are visible, totals span pages',()=>{
  const data=fixture();const result=build(data,q({page_size:1}));
  assert.equal(result.pagination.total,6);assert.equal(result.rows.length,1);assert.equal(result.summary.received,980);
  assert.equal(result.rows[0].status,'FUTURE');assert.equal(result.rows[0].attention,false);
  const missing=build(data,q({status:'MISSING'}));assert.equal(missing.pagination.total,3);assert.equal(missing.summary.received,null);
  const detail=build(data,q({receipt_id:1,from:'1900-01-01',to:'1900-01-01'}));assert.equal(detail.rows.length,1);
});
test('channel/account filters exclude whole-receipt POS and closing variance',()=>{
  const result=build(fixture(),q({channel_id:2,account_id:1}));
  assert.equal(result.rows.length,1);assert.equal(result.rows[0].pos,null);assert.equal(result.rows[0].confirmed_variance,null);
});
test('account filter does not include receipts from another destination on the same line',()=>{
  const data=fixture();data.transactions=[tx(1,1,{amount:400,account_id:1}),tx(2,1,{amount:580,account_id:2})];
  const result=build(data,q({account_id:1,receipt_id:1}));
  assert.equal(result.rows[0].received,400);assert.equal(result.rows[0].cashier,null);
});
test('empty default reference fields do not claim an expected net of zero',()=>{
  const data=fixture();data.lines[0].expected_gross_amount=0;data.lines[0].expected_net_amount=0;
  const result=build(data,q({receipt_id:1}));assert.equal(result.rows[0].lines[0].expected,null);assert.equal(result.rows[0].lines[0].variance,null);
});
test('missing cashier input is unknown rather than a no-activity zero',()=>{
  const data=fixture();data.transactions=[];data.lines[0]=line(1,1,{cashier_amount:null,statement_amount:null,expected_gross_amount:0,expected_net_amount:0});
  assert.equal(build(data,q({receipt_id:1})).rows[0].received,null);
  assert.equal(build(data,q({receipt_id:1})).rows[0].cashier_variance,null);
});
test('an unsynced POS total cannot produce a cashier shortage or overage',()=>{
  const data=fixture();data.receipts[0].clickhouse_synced_at=null;
  const row=build(data,q({receipt_id:1})).rows[0];assert.equal(row.pos,null);assert.equal(row.cashier_variance,null);
});
test('ledger sale-date column remains the sale date when money arrives later',()=>{
  const result=build(fixture(),q({tab:'transactions'}));
  assert.equal(result.rows[0].date,'2026-08-31');assert.equal(result.rows[0].received_date,'2026-09-01');
});
test('pending tab retains unknown dates under explicit sales-date basis',()=>{
  const data=fixture();data.transactions=[];
  const result=build(data,q({basis:'received',tab:'followups'}));assert.equal(result.basis,'sale');assert.ok(result.rows.some(r=>r.receipt_id===1));
});
test('follow-ups expose each problem channel with its own amount and waiting state',()=>{
  const data=fixture();data.transactions=[];
  data.lines.push(line(2,1,{payment_channel_id:3,channel_code:'GRAB',settlement_status:'PENDING'}));
  const result=build(data,q({tab:'followups',branch_id:1,from:'2026-08-31',to:'2026-08-31'}));
  assert.equal(result.rows.length,2);assert.ok(result.rows.every(r=>r.lines.length===1 && r.expected===980));
  assert.equal(build(data,q({status:'WAITING_RECEIPT',tab:'followups'})).rows.length,1);
  assert.equal(build(data,q({status:'WAITING_EVIDENCE',tab:'followups'})).rows.length,1);
});
test('summary exposes pending count and known-only pending total across all pages',()=>{
  const data=fixture();data.transactions=[];
  data.lines.push(line(2,1,{payment_channel_id:3,channel_code:'GRAB',settlement_status:'PENDING'}));
  const result=build(data,q({branch_id:1,from:'2026-08-31',to:'2026-08-31'}));
  assert.equal(result.summary.pending_count,1);
  assert.equal(result.summary.pending_expected,1960);
  const unknown=build(fixture(),q({branch_id:1,from:'2026-08-31',to:'2026-08-31'}));
  data.lines.push(line(3,1,{payment_channel_id:3,channel_code:'GRAB',channel_kind:'ewallet',settlement_source:'NONE'}));
  const partial=build(data,q({branch_id:1,from:'2026-08-31',to:'2026-08-31'}));
  assert.equal(partial.summary.pending_count,1);
  assert.equal(partial.summary.pending_expected,1960);
  assert.equal(unknown.summary.pending_count,0);
  assert.equal(unknown.summary.pending_expected,null);
});
test('overview permissions cover reviewers and exclude cashier',()=>{
  for(const role of ['admin','auditor','recorder']) assert.equal(hasPermission(role,'report:overview'),true);
  assert.equal(hasPermission('cashier','report:overview'),false);
});
test('loader starts a read-only snapshot, never writes, and releases on failure',async()=>{
  const calls=[];let released=false;
  const c={query:async(sql)=>{calls.push(sql);if(sql.includes('FROM branches')) throw new Error('test failure');return [[]];},rollback:async()=>calls.push('rollback'),release:()=>{released=true;}};
  await assert.rejects(loadOverviewData({getConnection:async()=>c},q()),/test failure/);
  assert.ok(calls.includes('START TRANSACTION READ ONLY'));assert.ok(calls.includes('rollback'));assert.equal(released,true);
  assert.ok(calls.every(s=>!/^\s*(UPDATE|INSERT|DELETE|ALTER|CREATE|REPLACE)/i.test(s)));
});
