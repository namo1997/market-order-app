import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {harness} from './receiving-harness.mjs';
import {issueStatusLabel,issueBranchName,issueOwnerName} from '../src/receiving-app/issue-labels.mjs';
const staff={id:12,role:'user',branch_id:1};const accounting={...staff,id:7,role:'accounting'};
const runtime={URLSearchParams,fetch:()=>{throw Error('Outbound network forbidden');},__shell:{Capacitor:{isNativePlatform:()=>false}}};
const row=patch=>({id:1,type:'return',status:'open',branch_id:1,branch_name:'สาขาสันทราย',owner_user_id:7,owner_name:'คุณบัญชี',document_id:5,
  quantity:'1.00',amount:'60.00',product_name:'ขา B',version:1,note:'',evidence:[],evidence_count:0,history:[],
  receipt_line:{return_status:'collected'},created_at:'2026-10-19T00:00:00Z',due_at:'2026-10-20T00:00:00Z',...patch});
const detail=(data,api={},user=accounting)=>harness('ReceivingIssueDetail',{id:1,user,api:{detail:async()=>data,assignees:async()=>({items:[{id:7,name:'คุณบัญชี'}]}),...api}}, {},{}, {}, runtime,null,'../src/receiving-app/ReceivingIssueDetail.jsx');
const submit=async h=>{await h.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await h.settle();};
const text=h=>h.text(h.visible());

test('I1 review label covers evidence on open/waiting rows and terminal statuses remain terminal',()=>{
  for(const status of ['open','waiting_supplier'])assert.equal(issueStatusLabel(row({status,evidence_count:1})),'แนบหลักฐานแล้ว · รอบัญชีตรวจ');
  assert.equal(issueStatusLabel(row({evidence:[{id:1}]})),'แนบหลักฐานแล้ว · รอบัญชีตรวจ');
  assert.equal(issueStatusLabel(row()),'เปิดเรื่อง');assert.equal(issueStatusLabel(row({status:'resolved',evidence_count:1})),'ปิดเรื่องแล้ว');
  assert.equal(issueStatusLabel(row({status:'cancelled',evidence_count:1})),'ยกเลิก');
  assert.equal(issueBranchName({branch_id:99}),'ไม่พบชื่อสาขา');assert.equal(issueOwnerName({owner_user_id:99}),'ไม่พบชื่อผู้รับผิดชอบ');
});

test('I1/I2 staff saves evidence and refreshes stage; all non-submit buttons explicitly opt out, including signature controls',async()=>{
  let data=row(),writes=0;
  const h=await detail(data,{detail:async()=>data,attach:async()=>{writes++;data={...data,evidence_count:1,evidence:[{id:1,created_at:data.created_at}]};},binary:async()=>new Blob(['mock'])},staff);
  assert.match(text(h),/ร้านมารับแล้ว · กรุณาแนบหลักฐาน/);
  await h.click('บันทึกการคืน (รูป + ลายเซ็นคนมารับ)');
  const input=h.find(n=>n.type==='input'&&n.props.type==='file');
  await input.props.onChange({target:{files:[{type:'image/jpeg',size:100,name:'synthetic.jpg'}]}});await h.settle();
  await h.select('ชื่อคนมารับคืน','คนขับทดสอบ');
  for(const button of h.all().filter(n=>n.type==='button'))assert.ok(['button','submit'].includes(button.props.type),h.text(button));
  assert.equal(h.find(n=>n.type==='button'&&h.text(n)==='กลับรายการ').props.type,'button');
  assert.equal(h.find(n=>n.props['aria-label']==='รีเฟรช').props.type,'button');
  const forms=h.all().filter(n=>n.type==='form');assert.equal(forms.length,1);
  assert.equal(h.all(forms[0]).filter(n=>n.type==='button'&&n.props.type==='submit').length,1);
  await submit(h);assert.equal(writes,1);assert.match(text(h),/แนบหลักฐานแล้ว · รอบัญชีตรวจ/);
  assert.doesNotMatch(text(h),/กรุณาแนบหลักฐาน/);
  await h.click('ยกเลิกการกรอกหลักฐาน');await h.click('รีเฟรช');assert.match(text(h),/แนบหลักฐานแล้ว · รอบัญชีตรวจ/);
});

test('I1/I4/I5/I6 accounting list displays review state, names and unambiguous action; employee list shares stage',async()=>{
  for(const embedded of [false,true]) {
    const h=await harness('ReceivingIssues',{embedded},{list:async()=>({items:[row({evidence_count:1})],next_before_id:null})},{user:accounting},{},runtime,null,'../src/receiving-app/ReceivingIssues.jsx');
    assert.match(text(h),/แนบหลักฐานแล้ว · รอบัญชีตรวจ/);assert.match(text(h),/คุณบัญชี/);assert.doesNotMatch(text(h),/ผู้รับผิดชอบ #7/);
    if(!embedded){assert.match(text(h),/สาขาสันทราย/);assert.ok(h.find(n=>n.type==='button'&&h.text(n)==='ดู\/จัดการ'));}
    h.unmount();
  }
  const h=await detail(row({status:'resolved',resolution:'credit_note',resolution_ref:'CN-001',evidence_count:1}));
  assert.match(text(h),/ผู้รับผิดชอบคุณบัญชี/);assert.doesNotMatch(text(h),/ผู้รับผิดชอบ#7|กรุณาแนบหลักฐาน/);
});

test('I3 both accounting pages use shared SOLAO layout/tabs and employee bundle keeps its own shell',async()=>{
  const read=p=>readFile(new URL(p,import.meta.url),'utf8');
  const [ledger,issues,shell,css,page]=await Promise.all(['../src/pages/admin/receiving/AdminReceiving.jsx','../src/pages/admin/receiving/AdminReceivingIssues.jsx','../src/pages/admin/receiving/ReceivingAdminShell.jsx','../src/pages/admin/receiving/receiving-admin.css','../src/receiving-app/ReceivingIssues.jsx'].map(read));
  for(const file of [ledger,issues])assert.match(file,/<ReceivingAdminShell/);
  assert.match(shell,/<Layout mainClassName="ra-layout"/);assert.match(shell,/ใบรับสินค้า/);assert.match(shell,/ปัญหารับของ/);assert.match(shell,/aria-current/);
  assert.match(css,/\.receiving-admin \.ri-page\.ri-accounting\[data-theme='light'\]/);assert.match(css,/--sg-action:#1e3168/);
  assert.doesNotMatch(page,/import.*ReceivingAdminShell/);
});

test('I7/I8 pending credit choice shows Thai warning, requires confirmation and supports reference completion after closure',async()=>{
  let data=row();const writes=[];
  const h=await detail(data,{detail:async()=>data,update:async(id,body)=>{writes.push(body);data={...data,...body,version:data.version+1};return data;}});
  await h.select('สถานะ','resolved');await h.select('ทางจบ','credit_note');await submit(h);
  assert.equal(writes.length,0);assert.match(text(h),/กรุณาใส่เลขที่เอกสาร/);
  const checkbox=h.find(n=>n.type==='input'&&n.props.type==='checkbox');checkbox.props.onChange({target:{checked:true}});await h.settle();
  assert.match(text(h),/ยังขาดเลขที่ใบลดหนี้/);assert.equal(h.find(n=>n.type==='input'&&n.props.maxLength===255&&'disabled' in n.props).props.disabled,true);
  await submit(h);assert.equal(writes.length,0);assert.match(text(h),/ยืนยันปิดเรื่อง/);assert.match(text(h),/กลับมาแก้ทางจบหรือเปิดเรื่องใหม่ไม่ได้/);
  await h.click('กลับไปตรวจข้อมูล');assert.equal(writes.length,0);assert.match(text(h),/ยังขาดเลขที่ใบลดหนี้/);
  await submit(h);await h.click('ยืนยันปิดเรื่อง');assert.equal(writes.length,1);assert.equal(writes[0].resolution_ref_pending,true);
  assert.match(text(h),/ปิดเรื่องแล้ว/);await h.select('เลขที่ใบลดหนี้','CN-TEST-001');await submit(h);
  assert.equal(writes.length,2);assert.deepEqual(Object.keys(writes[1]).sort(),['resolution_ref','version']);assert.equal(writes[1].resolution_ref,'CN-TEST-001');
  assert.doesNotMatch(text(h),/ยังขาดเลขที่ใบลดหนี้/);
});

test('I7 new bill still needs reference and does not offer pending credit choice',async()=>{
  const h=await detail(row());await h.select('สถานะ','resolved');await h.select('ทางจบ','new_bill');await submit(h);
  assert.match(text(h),/กรุณาใส่เลขที่เอกสาร/);assert.equal(h.all().filter(n=>n.props.type==='checkbox').length,0);
});

test('I8 cancellation requires confirmation; cancel/escape do not write, failed close stays in modal with visible error and retries once',async()=>{
  let attempts=0;const h=await detail(row(),{update:async()=>{attempts++;throw {response:{status:409}};}});
  await h.select('สถานะ','cancelled');await h.select('รายละเอียด','เปิดเรื่องซ้ำ');await submit(h);
  let dialog=h.find(n=>n.type==='dialog');dialog.props.onCancel({preventDefault(){}});await h.settle();assert.equal(attempts,0);
  await submit(h);await h.click('ยืนยันยกเลิกเรื่อง');assert.equal(attempts,1);assert.match(text(h),/เรื่องเปลี่ยนแล้ว/);
  await h.click('กลับไปตรวจข้อมูล');assert.equal(attempts,1);
});


test('I3/I7 SOLAO accounting text, controls and inline warnings meet AA palette contrast',()=>{
  const luminance=hex=>{const rgb=hex.match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4);return 0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2];};
  for(const [fg,bg] of [['182444','ffffff'],['182444','f7f5f0'],['3e4758','ffffff'],['ffffff','1e3168'],['805300','fff2d5'],['a12435','ffedf0']]) {
    const a=luminance(fg),b=luminance(bg);assert.ok((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)>=4.5,`${fg}/${bg}`);
  }
});

test('I7 closed accounting list keeps missing credit reference visible for later completion',async()=>{
  const h=await harness('ReceivingIssues',{}, {list:async()=>({items:[row({status:'resolved',resolution:'credit_note',resolution_ref_pending:true})],next_before_id:null})},{user:accounting},{},runtime,null,'../src/receiving-app/ReceivingIssues.jsx');
  await h.select('สถานะ','resolved');assert.match(text(h),/ปิดเรื่องแล้ว.*ยังขาดเลขที่ใบลดหนี้ · ใส่ภายหลัง/);
});

test('I3 accounting wrapper applies shared tabs to managers while staff keeps the employee theme and shell',async()=>{
  for(const user of [staff,accounting]) {
    const h=await harness('AdminReceivingIssues',{}, {list:async()=>({items:[row()],next_before_id:null})},{user},{},runtime,null,'../src/pages/admin/receiving/AdminReceivingIssues.jsx');
    const tabs=h.all().filter(n=>n.type==='nav'&&n.props['aria-label']==='งานรับสินค้า');
    assert.equal(tabs.length,user.role==='accounting'?1:0);
    if(user.role==='accounting')assert.equal(h.find(n=>n.props.className?.includes('ri-accounting')).props['data-theme'],'light');
    else assert.equal(h.find(n=>n.type==='main').props['data-theme'],undefined);
    h.unmount();
  }
});
