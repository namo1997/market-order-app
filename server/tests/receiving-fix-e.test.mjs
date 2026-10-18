import test from 'node:test';
import assert from 'node:assert/strict';
import { listLedger, ledgerDetail, ledgerIssueSummary } from '../src/models/receiving-admin.model.js';
import { receiptValue } from '../src/models/receiving-admin-values.js';
import { reviewLedger, decimalString, scaledInteger } from '../src/utils/receiving-value.js';
import { aggregateBranchLines } from '../src/models/receiving-branch-policy.js';

const lines=[
  {id:1,document_id:5,quantity_billed:'10',quantity_received:'9',unit_price:'60',amount:'600'},
  {id:2,document_id:5,quantity_billed:null,quantity_received:'5',unit_price:null,amount:null,review_decision:'missing_bill'},
  {id:3,document_id:5,quantity_billed:null,quantity_received:'5',unit_price:null,amount:null,review_decision:'missing_bill'},
];
const doc={id:5,status:'confirmed',total:'600.00',discount:'0',vat:'0',lines};
test('E2 shared app/accounting ledger: 600 bill - 60 shortage = 540 known received + 2 unpriced lines',()=>{
  assert.deepEqual(receiptValue(doc),{received_known:'540.00',received_net:'540.00',pending_price_count:2});
  const value=reviewLedger(doc);assert.equal(value.bill,60000n);assert.equal(value.adjustment,-6000n);
  assert.equal(value.bill+value.adjustment,value.receivedNet);
});

test('E2 exact money covers decimals, six-place prices, discount/tax, returns, unknown prices and absent coverage',()=>{
  assert.equal(decimalString(scaledInteger('0.1')+scaledInteger('0.2')),'0.30');
  assert.equal(receiptValue({...doc,discount:'10',vat:'7'}).received_net,'537.00');
  assert.equal(receiptValue({...doc,lines:[{quantity_received:'3',quantity_billed:'3',unit_price:'0.335000'}]}).received_known,'1.01');
  const returned={...doc,lines:[{quantity_received:'0',quantity_billed:'10',unit_price:'60',amount:'600',review_decision:'not_received'}]};
  assert.equal(receiptValue(returned).received_known,'0.00');assert.equal(receiptValue(returned).pending_price_count,0);
  assert.equal(receiptValue({...doc,lines:[]}),null);assert.equal(receiptValue({...doc,blind:true}),null);
  assert.deepEqual(receiptValue({...doc,lines:[lines[1]]}),{received_known:'0.00',received_net:'0.00',pending_price_count:1});
  assert.equal(receiptValue({...doc,lines:[{...lines[0],unit_price:'invalid'}]}),null);
});

test('E2 branch-wide accounting groups the same product/unit as the app before rounding and counting pending prices',()=>{
  const parts=[1,2].map(id=>({id,product_id:10,unit_id:1,branch_weight:'1',order_item_id:id,branch_department_id:id,
    counted_quantity:'1',quantity_received:'1',quantity_billed:'1',amount:'0.34',unit_price:'0.335000'}));
  const unpriced=parts.map(line=>({...line,id:line.id+2,product_id:20,quantity_billed:null,amount:null,unit_price:null,review_decision:'missing_bill'}));
  const branch={...doc,receiving_scope:'branch',total:'0.68',lines:[...parts,...unpriced]};
  const app=reviewLedger({...branch,lines:aggregateBranchLines(branch.lines)});
  assert.equal(app.received,67n);assert.equal(app.pendingPrices.length,1);
  assert.deepEqual(receiptValue(branch),{received_known:'0.67',received_net:'0.67',pending_price_count:1});
  assert.equal(receiptValue({...branch,receiving_scope:'department'}).received_known,'0.68');
});

test('E2 detail endpoint preserves department lines while its value matches the branch app ledger',async()=>{
  const parts=[1,2].map(id=>({id,line_no:id,product_id:10,unit_id:1,branch_weight:'1',order_item_id:id,branch_department_id:id,
    counted_quantity:'1',quantity_received:'1',quantity_billed:'1',amount:'0.34',unit_price:'0.335000'}));
  const db={async query(sql){
    if(sql.includes('FROM receiving_documents rd'))return [[{...doc,branch_id:1,department_id:1,receiving_scope:'branch',total:'0.68'}]];
    if(sql.includes('FROM receiving_document_lines'))return [parts];
    if(sql.includes('FROM receiving_document_images')||sql.includes('FROM receiving_document_audits'))return [[]];
    throw Error('Unexpected SQL');
  }};
  const detail=await ledgerDetail(db,{user:{role:'accounting'},id:5});
  assert.equal(detail.lines.length,2);assert.equal(detail.receipt_value.received_net,'0.67');
  assert.deepEqual(detail.lines.map(line=>line.id),[1,2]);
});

test('E2 list uses complete filtered confirmed coverage across pages, independent from current page and draft/void headers',async()=>{
  const queries=[];
  const db={async query(sql,values){queries.push({sql,values});
    assert.match(sql.trim(),/^SELECT/);
    if(sql.includes('AS total_count'))return [[{total_count:4,today_count:2,draft_count:1,confirmed_total:'600.30',unknown_total_count:0}]];
    if(sql.includes('LIMIT ? OFFSET ?'))return [[{...doc,branch_id:1,department_id:1,receiving_scope:'department',total:'600.00'}]];
    if(sql.includes('WHERE line.document_id IN'))return [lines];
    if(sql.includes('AS ledger_document_id'))return [[...lines.map(line=>({...line,ledger_document_id:5,total:'600',discount:'0',vat:'0'})),
      {ledger_document_id:6,id:4,total:'0.30',quantity_received:'0.30',quantity_billed:'0.30',unit_price:'1'},
      {ledger_document_id:7,id:null,total:'50'}]];
    throw Error('Unexpected SQL');
  }};
  const value=await listLedger(db,{user:{role:'accounting'},query:{supplier:"ร้าน ' %",page_size:'1'},today:'2026-10-18'});
  assert.deepEqual(value.items[0].receipt_value,{received_known:'540.00',received_net:'540.00',pending_price_count:2});
  assert.equal(value.summary.received_known_total,'540.30');assert.equal(value.summary.pending_price_count,2);
  assert.equal(value.summary.unvalued_document_count,1);
  const summary=queries.find(q=>q.sql.includes('AS ledger_document_id'));
  assert.match(summary.sql,/rd.status = 'confirmed'/);assert.doesNotMatch(summary.sql,/LIMIT|ร้าน/);
  assert.deepEqual(summary.values,["ร้าน ' %"]);
  const page=queries.find(q=>q.sql.includes('WHERE line.document_id IN'));
  assert.match(page.sql,/IN \(\?\)/);assert.deepEqual(page.values,[5]);
});

test('E2 blind draft cannot leak valuation or query lines; empty confirmed population totals zero with complete coverage',async()=>{
  const queries=[];
  const db={async query(sql){queries.push(sql);
    if(sql.includes('AS total_count'))return [[{total_count:1,draft_count:1}]];
    if(sql.includes('LIMIT ? OFFSET ?'))return [[{...doc,status:'draft',counted_complete_at:null}]];
    if(sql.includes('AS ledger_document_id'))return [[]];
    throw Error('Blind draft lines must not be queried');
  }};
  const value=await listLedger(db,{user:{role:'accountant'}});
  assert.equal(value.items[0].receipt_value,null);assert.equal(value.items[0].total,null);
  assert.equal(value.summary.received_known_total,'0.00');assert.equal(value.summary.pending_price_count,0);
  assert.ok(!queries.some(sql=>sql.includes('WHERE line.document_id IN')));
});

test('E3 issue count includes all pending types and branches for ledger roles; staff rejects before SQL',async()=>{
  const queries=[];const db={async query(sql){queries.push(sql);return [[{pending_issue_count:3}]];}};
  for(const role of ['admin','super_admin','accounting','accountant'])assert.deepEqual(await ledgerIssueSummary(db,{user:{role}}),{pending_issue_count:3});
  assert.match(queries[0],/FROM receiving_issues/);assert.match(queries[0],/status IN \('open', 'waiting_supplier'\)/);
  assert.doesNotMatch(queries[0],/LIMIT|type =|branch_id=/);
  await assert.rejects(ledgerIssueSummary(db,{user:{role:'user'}}),{code:'FORBIDDEN'});assert.equal(queries.length,4);
});
