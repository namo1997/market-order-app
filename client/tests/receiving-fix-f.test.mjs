import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { harness, track, cleanup, doc, row } from './review-a-port-harness.mjs';
import { receiptDecisionText, qtyText } from '../src/pages/receiving/review-a.js';
import { auditDescription, receivedLineValue } from '../src/pages/admin/receiving/receiving-detail.js';
afterEach(cleanup);
const lines = [row(1, { product_name:'ขา B', counted_quantity:'9.00', quantity_received:'9.00', quantity_billed:'10.00', unit_price:'60.00', amount:'600.00', review_decision:'short' }),
  row(2, { product_name:'อกไก่', counted_quantity:'5.00', quantity_received:'0.00', quantity_billed:null, unit_price:null, amount:null, review_decision:'not_received', return_status:'waiting' }),
  row(3, { quantity_received:'5.00', quantity_billed:null, unit_price:null, amount:null, review_decision:'missing_bill' })];
const fixture = doc({ status:'confirmed', lines, audits:[{id:1,action:'blind_count',line_count:4},
  {id:2,action:'edit_after_bill_reveal',decisions:[lines[0]]}, {id:3,action:'edit_after_bill_reveal',decisions:[lines[1]]}].map(audit=>({...audit,actor_name:'ผู้รับทดสอบ',created_at:'2026-10-19 00:21:00'})),
  issues:[{id:71,document_id:5,type:'shortage',status:'open',product_name:'ขา B'},
    {id:72,document_id:5,type:'wrong_item',auto_key:'auto-5-bill-request',status:'waiting_supplier'},
    {id:73,document_id:5,type:'return',status:'resolved',product_name:'อกไก่'}] });
const detail = patch => harness('ReceivingDocumentView', {doc:fixture,followups:{items:[]},...patch}, {}, {}, {}, {}, null,
  '../src/pages/admin/receiving/ReceivingDocumentView.jsx').then(track);
test('F1 renders real count and historical decision snapshots, actors and timestamps; legacy edits stay factual',async()=>{
  const h=await detail(); const text=h.text(h.all().find(n=>n.type==='ol'));
  assert.match(text,/บันทึกการนับ 4 รายการ/);
  assert.match(text,/ตัดสินใจ ขา B: รับ 9 กก\. · แจ้งร้านขาด 1 กก\./);
  assert.match(text,/ตัดสินใจ อกไก่: ไม่รับ · คืนร้าน 5 กก\./);
  assert.doesNotMatch(text,/กิจกรรมเอกสาร/);
  assert.match(text,/ผู้รับทดสอบ/);assert.match(text,/00:21/);
  assert.equal(auditDescription({action:'edit_after_bill_reveal',line_count:1}),'แก้ไขหลังเปิดบิล 1 รายการ');
  for(const action of ['blind_count','edit_after_bill_reveal','create','ocr','upload_image','sign','confirm','void']) assert.doesNotMatch(auditDescription({action}),/ยังไม่รองรับ/);
  assert.equal(auditDescription({action:'future'}),'เหตุการณ์ที่ยังไม่รองรับ');
});
test('F2 every row displays the exact shared app decision including return status and undecided rows',async()=>{
  const h=await detail(); const rows=h.all().filter(n=>n.type==='tr').slice(1);
  rows.forEach((node,i)=>assert.equal(h.text(h.all(node).filter(n=>n.type==='td').at(-1)),receiptDecisionText(lines[i])));
  const summary=track(await harness('ReviewSummary',{doc:fixture}));
  for(const line of lines) assert.ok(summary.text(summary.visible()[0]).includes(receiptDecisionText(line)));
  for(const decision of ['accept','over','wrong_product','price_review',null]) assert.ok(receiptDecisionText({...lines[0],review_decision:decision}));
  assert.match(receiptDecisionText({...lines[1],return_status:'collected'}),/ร้านมารับแล้ว · รอหลักฐาน/);
  assert.equal(receiptDecisionText({...lines[0],review_decision:null}),'ยังไม่ตัดสินใจ');
});
test('F3 rendered 600 bill and 540 received are separate; unpriced 5 is pending and returned 5 has received value zero',async()=>{
  const h=await detail();const heads=h.all().filter(n=>n.type==='th').map(n=>h.text(n));
  assert.ok(heads.includes('ยอดตามบิล (บาท)'));assert.ok(heads.includes('มูลค่ารับ (บาท)'));
  const cells=h.all().filter(n=>n.type==='tr').slice(1).map(n=>h.all(n).filter(c=>c.type==='td').map(c=>h.text(c)));
  assert.deepEqual(cells[0].slice(7,9),['600.00','540.00']);assert.equal(cells[1][8],'0.00');assert.equal(cells[2][8],'รอราคา');
  assert.equal(receivedLineValue({...lines[0],quantity_received:'0.30',unit_price:'1',amount:'0.30'}),'0.30');
  assert.equal(receivedLineValue({...lines[0],quantity_received:'2',quantity_billed:'3',unit_price:null,amount:'1.00'}),'0.67');
  assert.equal(receivedLineValue({...lines[0],quantity_received:null}),null);
  assert.equal(receivedLineValue({...lines[0],quantity_received:'broken'}),null);
});
test('F4 shows all three document issues including closed ones with working deep links; followup failures do not hide issues',async()=>{
  for(const props of [{},{followupError:true,followups:null}]){
    const h=await detail(props);const text=h.text(h.visible()[0]);assert.match(text,/ปัญหารับของจากใบนี้ · 3 เรื่อง/);
    for(const id of [71,72,73]) assert.ok(h.all().some(n=>n.type==='a'&&n.props.to===`/admin/receiving/issues?issue=${id}`));
    assert.match(text,/ของขาด/);assert.match(text,/ขอบิล/);assert.match(text,/คืนของ/);assert.match(text,/ปิดเรื่องแล้ว/);
  }
  const empty=await detail({doc:{...fixture,issues:[]}});assert.match(empty.text(empty.visible()[0]),/ยังไม่มีปัญหารับของจากใบนี้/);
});
test('F4 issue query link opens the selected issue detail through the existing accounting page',async()=>{
  const calls=[];const issue={id:73,type:'return',status:'resolved',branch_id:1,document_id:5,quantity:'5.00',amount:'0.00',version:1,
    due_at:'2026-10-19T01:00:00Z',created_at:'2026-10-18T01:00:00Z',updated_at:'2026-10-18T01:00:00Z',note:'',evidence:[],history:[],supplier_name:'ร้านทดสอบ',product_name:'อกไก่'};
  const h=track(await harness('ReceivingIssues',{}, {list:async()=>({items:[],next_before_id:null}),
    detail:async id=>{calls.push(id);return issue;},assignees:async()=>({items:[]})}, {user:{id:7,role:'accounting',branch_id:1}},
    {location:{pathname:'/admin/receiving/issues',search:'?issue=73'}}, {URLSearchParams,fetch:()=>{throw Error('network forbidden');},__shell:{Capacitor:{isNativePlatform:()=>false}}},null,'../src/receiving-app/ReceivingIssues.jsx'));
  assert.deepEqual(calls,['73']);assert.match(h.text(h.visible()[0]),/อกไก่/);assert.match(h.text(h.visible()[0]),/ปิดเรื่องแล้ว/);
});
test('F5 quantity cells share app compact formatting while monetary cells keep cents; empty table spans all columns',async()=>{
  const h=await detail();const cells=h.all().filter(n=>n.type==='tr')[1];
  assert.deepEqual(h.all(cells).filter(n=>n.type==='td').slice(2,7).map(n=>h.text(n)),['9','9','10','2','60.00']);
  for(const [input,expected]of [['9.00','9'],['1.50','1.5'],['0.00','0'],['0.01','0.01'],[null,'—']]) assert.equal(qtyText(input),expected);
  const empty=await detail({doc:{...fixture,lines:[]}});assert.equal(empty.all().find(n=>n.type==='td').props.colSpan,10);
});
