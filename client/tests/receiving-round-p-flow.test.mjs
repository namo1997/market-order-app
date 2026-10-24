import test from 'node:test';
import assert from 'node:assert/strict';
import { doc, row, open, text, field } from './review-a-port-harness.mjs';
import { harness } from './receiving-harness.mjs';
import { canVoid } from '../src/pages/receiving/receiving-utils.js';

test('O1 warns before persisting blind count; edit cancels, confirm writes once; no order/bill quantities leak', async () => {
  const initial = doc({ counted_complete_at:null, kind:'manual_receipt', lines:[row(1,{unit_text:'ถุง'})] });
  const requests=[];
  const h=await open(initial,{count:async(id,body)=>{
    requests.push(body);
    return body.check_only ? {count_warnings:[{product_id:1,quantity:body.lines[0].counted_quantity,unit:'ถุง'}]}
      : {...initial,counted_complete_at:'2026-10-20T00:00:00Z',lines:[{...initial.lines[0],counted_quantity:'10144',quantity_received:'10144'}]};
  }});
  const input=h.find(n=>n.props.id==='count-1'); input.props.onChange({target:{value:'10144'}}); await h.settle();
  await h.click('ยืนยันการนับ');
  assert.equal(requests.length,1);assert.equal(requests[0].check_only,true);
  assert.match(text(h),/จำนวน 10144 ถุง ถูกต้องไหม/);assert.doesNotMatch(text(h),/สั่ง 2|บิล 2|ราคา/);
  await h.click('แก้ไข');assert.equal(requests.length,1);assert.equal(h.find(n=>n.props.id==='count-1').props.value,'10144');
  await h.click('ยืนยันการนับ');await h.click('ยืนยัน จำนวนนี้ถูกต้อง');
  assert.equal(requests.filter(r=>!r.check_only).length,1);assert.match(text(h),/สรุปก่อนเซ็น/);
});
test('#4 one outside-order reason per receipt and the free note persist through real review PUT', async()=>{
  // Owner 2026-10-24 (ข้อ 3): no reason select on every row; one optional reason for the items outside the order.
  const none=await open(doc({lines:[row(1,{order_item_id:null,quantity_ordered:null})]}));
  assert.equal(none.visible().some(n=>n.type==='select'),false,'a receipt with no order at all asks no reason');
  const h=await open(doc({lines:[row(1,{order_item_id:null,quantity_ordered:null}),row(2,{review_decision:'accept'})]}));
  assert.equal(h.visible().filter(n=>n.type==='select').length,1); assert.match(text(h),/ของนอกใบสั่ง 1 รายการ · เหตุผล \(ไม่บังคับ\)/);
  const select=h.find(n=>n.type==='select'&&h.all(n).some(o=>h.text(o)==='โทรสั่ง'));
  select.props.onChange({target:{value:'โทรสั่ง'}});await h.settle();
  assert.equal(h.visible().some(n=>n.type==='textarea'),false,'a chosen reason alone leaves the note collapsed');
  assert.equal(h.find(n=>n.type==='select').props.value,'โทรสั่ง');
  await h.click('เพิ่มหมายเหตุ ผัก 1');
  const textarea=h.find(n=>n.type==='textarea');assert.equal(textarea.props.maxLength,300);assert.equal(textarea.props.autoFocus,true);assert.equal(textarea.props.value,'โทรสั่ง');
  textarea.props.onChange({target:{value:'โทรสั่ง เพิ่มน้ำแข็ง'}});await h.settle();
  await h.click('ยืนยันรับ 2');
  assert.equal(h.calls.find(c=>c[0]==='update')[2].lines[0].note,'โทรสั่ง เพิ่มน้ำแข็ง');
});
test('#4 manual receipt summary notes can be edited and saved before signing',async()=>{
  const h=await open(doc({kind:'manual_receipt',lines:[row(1,{review_decision:'missing_bill'})]}));
  assert.equal(h.visible().some(n=>n.type==='textarea'),false,'Q2: summary cards start with the note collapsed');
  await h.click('เพิ่มหมายเหตุ ผัก 1');
  h.find(n=>n.type==='textarea').props.onChange({target:{value:'ซื้อผิด'}});await h.settle();
  await h.click('ไปเซ็นรับของ');assert.equal(h.calls.find(c=>c[0]==='update')[2].lines[0].note,'ซื้อผิด');
});
test('#5 UI mirrors inclusive accounting 7-day policy and shows disabled reason for owner after Bangkok midnight',async()=>{
  const reference={status:'confirmed',receiver_user_id:1,confirmed_at:'2026-10-12T17:00:00Z'};
  assert.equal(canVoid(reference,{id:2,role:'accounting'},new Date('2026-10-20T16:59:59Z')),true);
  assert.equal(canVoid(reference,{id:2,role:'accounting'},new Date('2026-10-20T17:00:00Z')),false);
  assert.equal(canVoid(reference,{id:1,role:'user'},new Date('2026-10-13T16:59:59Z')),true);
  assert.equal(canVoid(reference,{id:1,role:'user'},new Date('2026-10-13T17:00:00Z')),false);
  const h=await open(doc({...reference,confirmed_at:'2020-01-01T00:00:00Z'}),{},{user:{id:1,role:'user'}});
  assert.match(text(h),/แก้ข้ามวันให้ฝ่ายบัญชีหรือแอดมิน/);
});
test('#7 queue renders carryover age without quantity before counting',async()=>{
  const h=await harness('ShopWorkspace',{groups:[{supplier_key:'pg:1',supplier_name:'ร้าน',items:[{order_item_id:1,product_name:'ผัก',has_pending:true,age_days:90}]}],current:{supplier_key:'pg:1'},waiting:1,onChoose(){},onReceive(){},onFollowup(){}});
  assert.match(text(h),/ค้าง 90 วัน/);assert.doesNotMatch(text(h),/สั่ง \d|บิล \d/);
});
test('#9 archive fetches existing GET API through adapter and renders image links with Thai empty/error states',async()=>{
  let requested=0;
  const h=await harness('LegacyBillPhotos',{}, {legacyBillPhotos:async date=>{requested++;assert.equal(date,'2026-10-20');return [{id:3,image_data_url:'data:image/png;base64,c3lu',product_name:'ผัก'}];}}, {}, {}, {}, null,'../src/pages/admin/receiving/LegacyBillPhotos.jsx');
  h.find(n=>n.type==='input').props.onChange({target:{value:'2026-10-20'}});await h.settle();
  await h.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await h.settle();
  assert.equal(requested,1);assert.equal(h.find(n=>n.type==='a').props.href,'#legacy-bill-3');
  h.find(n=>n.type==='a').props.onClick();await h.settle();assert.equal(h.find(n=>n.type==='img').props.src,'data:image/png;base64,c3lu');
});
