import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {harness} from './receiving-harness.mjs';
import {issueAge,issueTime,localDue,issueAgeLabel,issueEvidenceLabel,issueNextAction} from '../src/receiving-app/issue-labels.mjs';
const manager={id:7,role:'accounting',branch_id:1};
const staff={id:8,role:'user',branch_id:1};
const runtime={URLSearchParams,fetch:()=>{throw Error('Outbound calls forbidden');},__shell:{Capacitor:{isNativePlatform:()=>false}}};
const fixture=patch=>({id:81,document_id:501,type:'return',status:'open',supplier_name:'ร้านสมมติ',product_name:'สินค้าทดสอบ',quantity:'2.50',unit_text:'กก.',amount:'125.00',version:3,branch_id:1,owner_name:null,owner_user_id:null,created_at:'2026-10-18T01:00:00Z',due_at:'2026-10-20T01:00:00Z',note:'',history:[],evidence:[],...patch});
const text=h=>h.text(h.visible());
const detail=(api={},user=manager)=>harness('ReceivingIssueDetail',{id:81,user,api:{detail:async()=>fixture(),assignees:async()=>({items:[]}),...api}}, {},{}, {},runtime,null,'../src/receiving-app/ReceivingIssueDetail.jsx');
const submit=async h=>{await h.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await h.settle();};

test('UI4 missing dates, evidence and age stay unknown; zero and no evidence remain explicit',()=>{
  for(const value of [null,undefined,'','bad-date']){assert.equal(issueTime(value),'ยังไม่ระบุ');assert.equal(localDue(value),'');assert.equal(issueAge(value),null);}
  assert.equal(issueAge('2026-10-18T01:00:00Z',Date.parse('2026-10-18T01:00:00Z')),0);
  assert.equal(issueAgeLabel({created_at:null}),'ยังไม่ทราบอายุเรื่อง');
  assert.equal(issueEvidenceLabel({}),'หลักฐานยังไม่ทราบ');assert.equal(issueEvidenceLabel({evidence_count:0}),'ยังไม่มีหลักฐาน');assert.equal(issueEvidenceLabel({evidence_count:2}),'หลักฐาน 2 ชุด');
});

test('UI4 next actions distinguish types, permissions, review and terminal reference work',()=>{
  assert.match(issueNextAction(fixture(),manager),/ติดตามร้านมารับคืน/);
  assert.match(issueNextAction(fixture({receipt_line:{return_status:'collected'}}),staff),/แนบรูปและลายเซ็น/);
  assert.match(issueNextAction(fixture({evidence_count:1}),manager),/ตรวจหลักฐานและบันทึกทางจบ/);
  assert.equal(issueNextAction(fixture({evidence_count:1}),staff),'รอบัญชีตรวจหลักฐาน');
  assert.match(issueNextAction(fixture({type:'shortage'}),staff),/ตามของที่ขาด/);
  assert.match(issueNextAction(fixture({type:'wrong_item',note:'ไม่มีในบิล'}),staff),/ขอบิลจากร้าน/);
  for(const type of ['damaged','over','wrong_item'])assert.match(issueNextAction(fixture({type}),manager),/ตกลงวิธีแก้/);
  assert.match(issueNextAction(fixture({status:'resolved',resolution:'credit_note',resolution_ref_pending:true}),manager),/เพิ่มเลขที่/);
  assert.match(issueNextAction(fixture({status:'resolved',resolution:'returned'}),staff),/ดูทางจบ/);
  assert.match(issueNextAction(fixture({status:'cancelled'}),manager),/ยกเลิก/);
});

test('UI4 list hierarchy retains source, owner, age, evidence and next action in both views',async()=>{
  for(const embedded of [true,false]){
    const h=await harness('ReceivingIssues',{embedded},{list:async()=>({items:[fixture({created_at:null,due_at:null})],next_before_id:null})},{user:manager},{},runtime,null,'../src/receiving-app/ReceivingIssues.jsx');
    try{const value=text(h);for(const label of ['คืนของ','ร้านสมมติ','ใบรับ #501','ยังไม่ทราบอายุเรื่อง','ยังไม่มอบหมาย','งานถัดไป','ยังไม่มีหลักฐาน'])assert.ok(value.includes(label),label);assert.ok(value.indexOf('คืนของ')<value.indexOf('ร้านสมมติ'));assert.equal(h.find(n=>n.props.className?.includes('ri-page')).props['data-theme'],undefined);}finally{h.unmount();}
  }
});

test('UI4 failed list and detail retry independently without reporting zero results',async()=>{
  let attempts=0;const h=await harness('ReceivingIssues',{}, {list:async()=>{if(++attempts===1)throw Error('offline');return {items:[fixture()],next_before_id:null};}}, {user:manager},{},runtime,null,'../src/receiving-app/ReceivingIssues.jsx');
  try{assert.match(text(h),/รายการปัญหารับของ — เรื่อง/);assert.doesNotMatch(text(h),/ไม่มีเรื่องตามตัวกรอง/);await h.click('ลองโหลดรายการอีกครั้ง');assert.match(text(h),/ร้านสมมติ/);assert.equal(attempts,2);}finally{h.unmount();}
  let reads=0;const d=await detail({detail:async()=>{if(++reads===1)throw Error('denied');return fixture();}});
  try{assert.match(text(d),/โหลดเรื่องไม่ได้/);await d.click('ลองโหลดเรื่องอีกครั้ง');assert.match(text(d),/งานถัดไป/);assert.equal(reads,2);}finally{d.unmount();}
});

test('UI4 return confirmation preserves exact stock quantity, version, dirty draft and single write lock',async()=>{
  const writes=[];let complete;const h=await detail({update:async(id,body)=>{writes.push({id,body});await new Promise(resolve=>{complete=resolve;});}});
  try{
    await h.select('สถานะ','resolved');await h.select('ทางจบ','returned');await h.select('จำนวนคืนจากสต๊อก','1.25');await submit(h);
    assert.equal(writes.length,0);for(const label of ['เรื่อง #81','ร้านสมมติ','ใบรับ #501','ยังไม่มีหลักฐาน','ลดสต๊อก 1.25 หน่วยฐาน','ยังไม่มีการลงบัญชีเจ้าหนี้หรือชำระเงินอัตโนมัติ'])assert.ok(text(h).includes(label),label);
    await h.click('กลับไปตรวจข้อมูล');assert.equal(writes.length,0);assert.equal(h.find(n=>n.type==='input'&&n.props.value==='1.25').props.value,'1.25');await submit(h);
    const confirm=h.find(n=>n.type==='button'&&h.text(n)==='ยืนยันปิดเรื่อง');const first=confirm.props.onClick();await h.settle();await confirm.props.onClick();assert.equal(writes.length,1);assert.equal(writes[0].body.stock_return_quantity,'1.25');assert.equal(writes[0].body.version,3);complete();await first;await h.settle();
  }finally{h.unmount();}
});

test('UI4 blank stock return and credit confirmation keep stock effects distinct; 409 keeps modal and draft',async()=>{
  for(const resolution of ['returned','credit_note']){
    let writes=0;const h=await detail({update:async()=>{writes++;throw {response:{status:409}};}});
    try{await h.select('สถานะ','resolved');await h.select('ทางจบ',resolution);if(resolution==='credit_note')await h.select('เลขที่บิลใหม่','SYNTHETIC-CN');await submit(h);assert.match(text(h),resolution==='returned'?/ไม่ลดสต๊อก: ใช้กับของที่ไม่เคยรับเข้าคลังเท่านั้น/:/ใบลดหนี้เปลี่ยนยอดเงิน ไม่เปลี่ยนสต๊อก/);await h.click('ยืนยันปิดเรื่อง');assert.equal(writes,1);assert.ok(h.find(n=>n.type==='dialog'));assert.match(text(h),/เรื่องเปลี่ยนแล้ว/);}finally{h.unmount();}
  }
});

test('UI4 theme bridge and token styles apply only to issues, keeping touch and dialog dimensions',async()=>{
  const read=p=>readFile(new URL(p,import.meta.url),'utf8');
  const css=await read('../src/receiving-app/receiving-issues.css');const shell=await read('../src/pages/admin/receiving/ReceivingAdminShell.jsx');
  assert.match(shell,/issues \? 'receiving-admin solao ri-issues-workspace' : 'receiving-admin'/);
  assert.match(css,/receiving-admin\.ri-issues-workspace/);assert.match(css,/min-height:var\(--sg-touch\)/);assert.match(css,/max-height:calc\(100dvh/);
  assert.doesNotMatch(css,/font-size:\s*\d+px|color-scheme:light/);
});
