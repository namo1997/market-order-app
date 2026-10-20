import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceivingHarness, makePngDataUrl } from './helpers/receiving-fake-db.mjs';
import { toBangkokDateKey } from '../src/utils/bangkok-date.js';
import { groupQueue, withReceiptSummary } from '../src/models/receiving-queue-policy.js';
import { readFile } from 'node:fs/promises';

const user = { id:12, name:'ผู้รับทดสอบ', role:'user', branch_id:1, department_id:10 };
const plain = value => JSON.parse(JSON.stringify(value));
async function fixture(scope, options = {}) {
  const h = await createReceivingHarness({ testDate:'2026-10-19', ...options });
  const template = h.state.orderItems[0];
  h.state.orderItems = [7,8,10,11,9].map((product_id, i) => ({ ...template, id:50+i,
    product_id, product_name:`สินค้า ${product_id}`, quantity:10, is_internal:false }));
  if (scope === 'branch') h.state.orderItems.push({ ...h.state.orderItems[0], id:60, department_id:30, department_name:'สโตร์' });
  const created = await h.invoke('createDocument', { user, body:{ client_uuid:`fix-g-${scope}`, scope,
    delivery_date:h.today, product_group_id:3, order_item_ids:scope === 'branch' ? [50,51,52,53,60] : [50,51,52,53] } });
  assert.equal(created.statusCode,201,JSON.stringify(created.body));
  return { h, id:created.body.data.id, created:created.body.data };
}

for (const scope of ['department','branch']) {
  test(`G1 ${scope}: cumulative full-row saves audit only changed decisions; equivalent decimals and repeats stay empty; audit failure rolls back`, async () => {
    let rejectAudit = false;
    const { h, id, created } = await fixture(scope, { prepareCount:false, queryHook:sql => {
      if (rejectAudit && sql.includes('INSERT INTO receiving_document_audits')) throw Error('synthetic audit failure');
    } });
    const counted = await h.invoke('saveCount', { user, params:{id}, body:{ client_uuid:created.client_uuid,
      lines:created.lines.map(line => ({ id:line.id, counted_quantity:'9' })) } });
    assert.equal(counted.statusCode,200);
    let lines = counted.body.data.lines.map(line => ({ id:line.id, quantity_received:line.quantity_received,
      quantity_billed:'10', unit_price:'1', review_decision:null }));
    const update = () => h.invoke('updateDocument', { user, params:{id}, body:{lines:structuredClone(lines)} });
    const events = () => h.state.audits.filter(a => a.action === 'edit_after_bill_reveal');
    for (let i=0; i<lines.length; i++) {
      lines[i].review_decision='short';
      assert.equal((await update()).statusCode,200);
      // Branch snapshots contain only the physical rows of this changed product.
      const expected = h.state.lines.filter(line => line.document_id === id && line.product_id === counted.body.data.lines[i].product_id).map(line => line.id);
      assert.deepEqual(plain(events().at(-1).details.decisions.map(line => line.id)),expected);
    }
    const firstSnapshot = JSON.stringify(events()[0].details.decisions);
    assert.equal((await update()).statusCode,200);
    assert.equal(events().at(-1).details.decisions.length,0);
    lines=lines.map(line => ({...line,quantity_received:'9.00',quantity_billed:'10.00'}));
    assert.equal((await update()).statusCode,200);
    assert.equal(events().at(-1).details.decisions.length,0);
    lines[0].quantity_received='8';
    assert.equal((await update()).statusCode,200);
    assert.ok(events().at(-1).details.decisions.every(line => line.product_name === counted.body.data.lines[0].product_name));
    assert.equal(JSON.stringify(events()[0].details.decisions),firstSnapshot);
    const before=JSON.stringify({lines:h.state.lines,audits:h.state.audits});
    rejectAudit=true; lines[0].quantity_received='7';
    assert.equal((await update()).statusCode,500);
    assert.equal(JSON.stringify({lines:h.state.lines,audits:h.state.audits}),before);
  });

  test(`G2 ${scope}: confirmed partial, zero return and completed over count once; drafts/foreign scope stay blind; void removes summary`, async () => {
    const { h, id, created } = await fixture(scope);
    const expected = () => h.invoke('getExpected', { user, query:{date:h.today,scope} });
    assert.ok((await expected()).body.data.every(group => group.receipt_summary === undefined));
    const quantities = {7:scope === 'branch' ? '18' : '9',8:'5',10:'0',11:'12'};
    const edited = await h.invoke('updateDocument', { user, params:{id}, body:{lines:created.lines.map(line => ({id:line.id,
      quantity_received:quantities[line.product_id], quantity_billed:line.product_id === 7 && scope === 'branch' ? '20' : '10',
      unit_price:'1', remember_alias:false, review_decision:line.product_id === 10 ? 'not_received' : line.product_id === 11 ? 'over' : 'short'}))} });
    assert.equal(edited.statusCode,200,JSON.stringify(edited.body));
    assert.ok((await expected()).body.data.every(group => group.receipt_summary === undefined),'draft decisions do not affect counts');
    assert.equal((await h.invoke('addSignature',{user,params:{id},body:{role:'receiver',image_data_url:makePngDataUrl()}})).statusCode,200);
    assert.equal((await h.invoke('confirmDocument',{user,params:{id}})).statusCode,200);
    const result=await expected(); assert.equal(result.statusCode,200,JSON.stringify(result.body));
    const shop=result.body.data.find(group => group.supplier_key === 'pg:3');
    assert.deepEqual(plain(shop.receipt_summary),{short:3,over:1,received_items:4});
    assert.equal(shop.has_partial,true); assert.equal(shop.items.length,4);
    assert.doesNotMatch(JSON.stringify(shop),/quantity_ordered|received_quantity|remaining_quantity|quantity_billed|unit_price|has_confirmed_receipt/);
    const foreign=await h.invoke('getExpected',{user:{...user,branch_id:2,department_id:20},query:{date:h.today,scope}});
    assert.equal(foreign.statusCode,200); assert.ok(foreign.body.data.every(group => !group.receipt_summary));
    const otherDepartment=await h.invoke('getExpected',{user:{...user,department_id:30},query:{date:h.today}});
    assert.ok(otherDepartment.body.data.every(group => scope === 'branch' || !group.receipt_summary));
    assert.equal((await h.invoke('voidDocument',{user:{...user,role:'admin'},params:{id},body:{reason:'ทดสอบคืนค่า'}})).statusCode,200);
    assert.ok((await expected()).body.data.every(group => group.receipt_summary === undefined));
  });

  test(`G3 ${scope}: 18 October becomes one day overdue at Bangkok midnight, including year rollover and lead times`, async () => {
    for (const [instant,status,days] of [['2026-10-18T16:59:59Z','due_today',0],['2026-10-18T17:00:00Z','overdue',1]]) {
      const date=toBangkokDateKey(new Date(instant));
      const h=await createReceivingHarness({testDate:date});
      h.state.orderItems[0].order_date='2026-10-18';
      if(scope === 'branch') h.state.orderItems.push({...h.state.orderItems[0],id:60,department_id:30});
      const response=await h.invoke('getExpected',{user,query:{scope}});
      assert.equal(response.statusCode,200,JSON.stringify(response.body));
      const shop=response.body.data.find(group => group.supplier_key === 'pg:3');
      assert.equal(shop.due_date,'2026-10-18');assert.equal(shop.status,status);assert.equal(shop.overdue_days,days);
    }
    const h=await createReceivingHarness({testDate:'2027-01-01',queueLeads:[{supplier_key:'pg:3',lead_days:1}]});
    h.state.orderItems[0].order_date='2026-12-31';
    const shop=(await h.invoke('getExpected',{user,query:{scope}})).body.data.find(group => group.supplier_key==='pg:3');
    assert.equal(shop.due_date,'2027-01-01');assert.equal(shop.status,'due_today');
  });
}

test('G2 completed over-only shop remains a summary, never pending allocation/followup work; SQL uses indexed confirmed relation',async()=>{
  const {h,id,created}=await fixture('department');
  h.state.orderItems=h.state.orderItems.filter(row=>row.id===50);
  h.state.lines=h.state.lines.filter(line=>line.order_item_id===50);
  const line=created.lines[0];
  assert.equal((await h.invoke('updateDocument',{user,params:{id},body:{lines:[{id:line.id,quantity_received:'12',quantity_billed:'10',unit_price:'1',review_decision:'over'}]}})).statusCode,200);
  assert.equal((await h.invoke('addSignature',{user,params:{id},body:{role:'receiver',image_data_url:makePngDataUrl()}})).statusCode,200);
  assert.equal((await h.invoke('confirmDocument',{user,params:{id}})).statusCode,200);
  const shop=(await h.invoke('getExpected',{user,query:{date:h.today}})).body.data[0];
  assert.equal(shop.summary_only,true);assert.equal(shop.items.length,0);assert.equal(shop.receipt_summary.over,1);
  const source=await readFile(new URL('../src/models/receiving-documents-helpers.js',import.meta.url),'utf8');
  assert.match(source,/receipt_line\.order_item_id = oi\.id AND receipt_doc\.status = 'confirmed'/);
  assert.match(source,/receipt_doc\.branch_id = b\.id/);
});

test('G2 branch summaries retain both directions for the same product across departments, exclude untouched and void receipts, and never net deficits away',()=>{
  const row={branch_id:1,department_id:10,product_group_id:3,product_id:7,unit_id:2,quantity_ordered:'0.30',has_confirmed_receipt:1};
  const rows=[{...row,order_item_id:1,received_quantity:'0.10'},
    {...row,department_id:30,order_item_id:2,received_quantity:'0.50'},
    {...row,product_id:8,order_item_id:3,received_quantity:'0',has_confirmed_receipt:0}];
  const summary=withReceiptSummary([],rows,true)[0];
  assert.deepEqual(summary.receipt_summary,{short:1,over:1,received_items:1});
  assert.equal(summary.items.length,0);
  assert.deepEqual(withReceiptSummary([],rows.map(row=>({...row,has_confirmed_receipt:0})),true),[]);
});

test('G3 mysql DATE objects and ISO timestamps keep their Bangkok due date across midnight',()=>{
  const row={branch_id:1,department_id:10,product_group_id:3,product_id:7,order_item_id:1,quantity_ordered:'10',received_quantity:'0'};
  for(const order_date of ['2026-10-18',new Date('2026-10-18T00:00:00Z'),'2026-10-17T17:00:00Z']){
    const before=groupQueue([{...row,order_date}],'2026-10-18')[0];
    const after=groupQueue([{...row,order_date}],'2026-10-19')[0];
    assert.equal(before.due_date,'2026-10-18');assert.equal(before.status,'due_today');
    assert.equal(after.due_date,'2026-10-18');assert.equal(after.status,'overdue');assert.equal(after.overdue_days,1);
  }
});
