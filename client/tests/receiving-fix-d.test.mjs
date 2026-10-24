import test, {afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {open,doc,row,text,btn,harness,armPad,track,cleanup,chooseFile} from './review-a-port-harness.mjs';
import {issueQuantity,receiptExplanation,evidenceAction,canAttachIssue} from '../src/receiving-app/issue-labels.mjs';
afterEach(cleanup);
const runtime={URLSearchParams,__shell:{Capacitor:{isNativePlatform:()=>false}},fetch:()=>{throw Error('No outbound network');}};
const staff={id:12,role:'user',branch_id:1};
const issue=patch=>({id:1,type:'shortage',status:'open',branch_id:1,document_id:5,quantity:'1.00',unit_text:'กก.',amount:'60.00',product_name:'ขา B',bill_text:'ทB',version:1,note:'',evidence:[],history:[],created_at:'2026-10-18T00:00:00Z',due_at:'2026-10-19T00:00:00Z',...patch});

for(const scope of ['department','branch']) for(const status of ['waiting','collected']) test(`D1 real button -> in-app confirmation -> update -> confirmed receipt (${scope}/${status})`,async()=>{
  const h=await open(doc({scope,lines:[row(1,{counted_quantity:'5',quantity_received:'5',quantity_billed:null,unit_price:null,amount:null})]}),{}, {}, {}, {confirm:()=>{throw Error('Native dialog must not be used');}});
  await h.click('ไม่รับ · คืนร้าน 5 กก.');
  assert.match(text(h),/ยืนยันคืนร้าน/);assert.match(text(h),/คืน 5 กก./);assert.equal(h.calls.length,0);
  await h.select('ร้านมารับหรือยัง',status);await h.click('กลับไปตรวจรายการ');assert.equal(h.calls.length,0);
  await h.click('ไม่รับ · คืนร้าน 5 กก.');await h.select('ร้านมารับหรือยัง',status);
  await h.click('ยืนยันไม่รับและคืนร้าน');
  assert.equal(h.calls.length,1);const saved=h.calls[0][2].lines[0];
  assert.equal(saved.review_decision,'not_received');assert.equal(Number(saved.quantity_received),0);assert.equal(saved.remember_alias,false);assert.equal(saved.return_status,status);
  assert.match(text(h),/นับได้5/);assert.match(text(h),/ตัดสินใจครบแล้ว/);
  await h.click('ดูสรุปก่อนเซ็น');assert.match(text(h),status==='collected'?/ร้านมารับแล้ว/:/รอร้านมารับ/);
  await h.click('ไปเซ็นรับของ');
  // Exercise the real signature pad before the final confirmation handler.
  await armPad(h);
  await h.find(n=>n.type==='canvas').props.onPointerDown({button:0,pointerType:'mouse',pointerId:1,clientX:10,clientY:10,preventDefault(){}});
  h.find(n=>n.type==='canvas').props.onPointerUp();await h.settle();await h.click('บันทึกเซ็น');
  await h.click('ยืนยันรับสินค้า');assert.equal(h.calls.filter(c=>c[0]==='confirm').length,1);assert.match(text(h),/รับของเรียบร้อย/);
});

test('D1 failed return keeps dialog and retries; no successful decision shown before request succeeds',async()=>{
  let fails=true;const writes=[];
  const initial=doc({lines:[row(1,{quantity_billed:null})]});
  const h=await open(initial,{update:async(id,body)=>{writes.push(body);if(fails)throw {response:{status:422}};return {...initial,lines:initial.lines.map((line,i)=>({...line,...body.lines[i]}))};}});
  await h.click('ไม่รับ · คืนร้าน 2 กก.');await h.click('ยืนยันไม่รับและคืนร้าน');assert.match(text(h),/ยืนยันคืนร้าน/);
  fails=false;await h.click('ยืนยันไม่รับและคืนร้าน');assert.equal(writes.length,2);assert.match(text(h),/ตัดสินใจครบแล้ว/);
});

test('D1 undo return restores received count and clears return status before choosing receive',async()=>{
  const h=await open(doc({lines:[row(1,{counted_quantity:'5',quantity_received:'5',quantity_billed:null})]}));
  await h.click('ไม่รับ · คืนร้าน 5 กก.');await h.click('ยืนยันไม่รับและคืนร้าน');
  await h.click('เลิกทำการตัดสินใจ');
  const restored=h.calls.at(-1)[2].lines[0];assert.equal(Number(restored.quantity_received),5);assert.equal(restored.review_decision,null);assert.equal(restored.return_status,null);
  await h.click('รับ 5 กก. · ให้บัญชีขอบิลจากร้าน');assert.equal(h.calls.at(-1)[2].lines[0].review_decision,'missing_bill');assert.match(text(h),/นับได้5/);
});

test('D2 D3 D5 cards have units, one pending-price label, readable bill text and secondary navigation',async()=>{
  const item=issue({type:'wrong_item',quantity:'5.00',amount:'0',note:'ไม่มีในบิล · ให้บัญชีขอบิลจากร้าน'});
  const h=track(await harness('ReceivingIssues',{embedded:true},{list:async()=>({items:[item],next_before_id:null}),detail:async()=>item},{user:staff},{},runtime,null,'../src/receiving-app/ReceivingIssues.jsx'));
  // Owner 2026-10-24 "ตัวหนังสือต้องน้อยๆ": the card is four lines; quantity and the pending price live in the detail.
  assert.doesNotMatch(text(h),/รอราคา|5 กก\.|ไม่มีในบิล/);assert.match(text(h),/ขอบิลจากร้านและแนบหลักฐาน/);
  assert.ok(btn(h,'เปิดเรื่อง 1').props.className.includes('ri-secondary'));
  await h.click('เปิดเรื่อง 1');assert.match(text(h),/เรื่อง #1/);
  assert.match(text(h),/จำนวน5 กก\./);assert.match(text(h),/มูลค่ารอราคา/);assert.equal(text(h).split('รอราคา').length-1,1);
  for(const node of h.all().filter(n=>h.text(n)==='ขา B'||h.text(n)==='ชื่อในบิล: ทB')) assert.ok(node.props.className.includes('receiving-bill-text'));
});

test('D5 detail uses human decisions, units and protected refresh; bill aliases always use Sarabun class',async()=>{
  let reads=0;const data=issue({line_id:11,note:'เทียบบิล: นับ 9.00, รับ 9.00, บิล 10.00, ตัดสินใจ short',receipt_line:{counted_quantity:'9.00',quantity_received:'9.00',quantity_billed:'10.00',review_decision:'short',unit_text:'กก.'}});
  const h=track(await harness('ReceivingIssueDetail',{id:1,user:staff,api:{detail:async()=>{reads++;return data;}}},{},{},{},runtime,null,'../src/receiving-app/ReceivingIssueDetail.jsx'));
  const facts=h.all().filter(n=>n.type==='div'&&h.all(n).some(c=>c.type==='dt')).map(n=>h.text(n));
  for(const expected of ['จำนวน1 กก.','นับได้9 กก.','รับจริง9 กก.','ในบิล10 กก.','การรับของรับของและแจ้งร้านว่าขาด'])assert.ok(facts.includes(expected),expected);
  assert.doesNotMatch(text(h),/บรรทัด ID|ตัดสินใจ short|โหลดเรื่องใหม่/);
  assert.ok(h.find(n=>n.type==='p'&&h.text(n)==='ชื่อในบิล: ทB').props.className.includes('receiving-bill-text'));
  await h.click('รีเฟรช');assert.equal(reads,2);
});

for(const type of ['shortage','wrong_item','return']) test(`D6 staff can record ${type} evidence with real form and API; cannot close`,async()=>{
  const data=issue({type,note:type==='wrong_item'?'ไม่มีในบิล · ให้บัญชีขอบิลจากร้าน':''});const calls=[];
  const h=track(await harness('ReceivingIssueDetail',{id:1,user:staff,api:{detail:async()=>data,attach:async(id,body)=>{calls.push([id,body]);return {id:1};}}},{},{},{},runtime,null,'../src/receiving-app/ReceivingIssueDetail.jsx'));
  assert.doesNotMatch(text(h),/ติดตามและปิดเรื่อง/);await h.click(evidenceAction(data));
  assert.equal(btn(h,'บันทึกหลักฐาน').props.disabled,true);await chooseFile(h);
  if(type==='return')await h.select('ชื่อคนมารับคืน','SYNTHETIC คนขับ');
  else {assert.doesNotMatch(text(h),/ชื่อคนมารับคืน|ลายเซ็น/);await h.select('หมายเหตุ','SYNTHETIC ร้านส่งมาแล้ว');}
  await h.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await h.settle();assert.equal(calls.length,1);assert.equal(calls[0][0],1);assert.ok(calls[0][1].image_data_url);assert.match(text(h),/บันทึกหลักฐานแล้ว/);
});

test('D6 other branches, closed issues and unrelated types do not expose staff evidence action',()=>{
  for(const type of ['return','shortage','wrong_item'])assert.equal(canAttachIssue({...staff,branch_id:2},issue({type})),false);
  assert.equal(canAttachIssue(staff,issue({type:'damaged'})),false);
  assert.equal(issueQuantity({quantity:'5.50',unit_text:'ถุง'}),'5.5 ถุง');
  assert.doesNotMatch(receiptExplanation(issue({receipt_line:{}})),/null|undefined/);
});

test('D2 D3 D5 stylesheet keeps compact secondary actions, Sarabun and shared accessible theme tokens',async()=>{
  const css=await readFile(new URL('../src/receiving-app/receiving-issues.css',import.meta.url),'utf8');
  assert.match(css,/receiving-bill-text\s*\{\s*font-family:'Sarabun'/);assert.match(css,/ri-open-issue[^}]*justify-self:start; width:auto/);
  assert.match(css,/ri-secondary[^}]*background:var\(--sg-surface\); color:var\(--sg-text\)/);
});
