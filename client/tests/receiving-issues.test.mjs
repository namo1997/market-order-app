import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {issueTypes,issueStatuses,issueResolutions,issueAge,localDue,canManageIssues} from '../src/receiving-app/issue-labels.mjs';
const read=path=>readFile(new URL(path,import.meta.url),'utf8');
test('issues transport uses existing authenticated client with protected binary requests and encoded IDs',async()=>{
  const calls=[];const client=Object.fromEntries(['get','post','put'].map(method=>[method,async(...args)=>{calls.push([method,...args]);return {data:args[1]?.responseType==='blob'?'blob':{data:{ok:true}}};}]));
  const context=vm.createContext({encodeURIComponent});const retained=[];
  const module=new vm.SourceTextModule(await read('../src/api/receiving-issues.js'),{context});
  await module.link(()=>{const m=new vm.SyntheticModule(['default'],function(){this.setExport('default',client);},{context});retained.push(m);return m;});await module.evaluate();
  const api=module.namespace.receivingIssuesAPI;
  await api.list({status:'pending',branch_id:2});await api.detail('1/2');await api.create({type:'return'});await api.update(1,{version:1});await api.attach(1,{client_uuid:'same-key'});assert.equal(await api.binary(1,2,'signature'),'blob');
  assert.equal(calls[1][1],'/receiving-issues/1%2F2');assert.equal(calls[3][0],'put');assert.equal(calls[5][2].responseType,'blob');assert.equal(calls[5][2].params.kind,'signature');
});
test('issue language and Bangkok dates: all types/resolutions and manager roles',()=>{
  assert.equal(Object.keys(issueTypes).length,5);assert.equal(Object.keys(issueStatuses).length,4);assert.equal(Object.keys(issueResolutions).length,5);
  for(const role of ['admin','super_admin','accounting','accountant'])assert.equal(canManageIssues({role}),true);
  assert.equal(canManageIssues({role:'user'}),false);assert.equal(localDue('2026-10-18T17:00:00Z'),'2026-10-19T00:00');assert.equal(issueAge('2026-10-17T00:00:00Z',Date.parse('2026-10-18T00:00:00Z')),1);
});
test('issue UI wiring: separate accounting route/mobile entry, terminal guard, server version and protected evidence',async()=>{
  const [app,shell,page,detail,evidence,css]=await Promise.all(['../src/App.jsx','../src/receiving-app/ReceivingApp.jsx','../src/receiving-app/ReceivingIssues.jsx','../src/receiving-app/ReceivingIssueDetail.jsx','../src/receiving-app/ReturnEvidenceForm.jsx','../src/receiving-app/receiving-issues.css'].map(read));
  assert.match(app,/\/admin\/receiving\/issues/);assert.match(shell,/<ReceivingIssues[^>]+embedded/);assert.match(page,/before_id:next/);assert.match(page,/min_age_days/);assert.match(page,/beforeunload/);
  assert.match(detail,/version:row.version/);assert.match(detail,/!closed/);assert.match(detail,/URL.revokeObjectURL/);assert.match(evidence,/crypto.randomUUID/);assert.match(evidence,/signature_data_url/);assert.match(evidence,/collector_name/);
  assert.match(css,/#1E3168/);assert.match(css,/#C8941C/);assert.match(css,/#F7F5F0/);assert.match(css,/safe-area-inset-bottom/);assert.match(css,/prefers-color-scheme:dark/);
});

test('issue components: list/filter -> waiting supplier -> close with selected resolution and fresh version; errors retain form',async()=>{
  const {harness}=await import('./receiving-harness.mjs');
  let row={id:1,type:'shortage',status:'open',branch_id:1,document_id:11,quantity:'1.00',amount:'20.00',version:1,due_at:'2026-10-19T01:00:00Z',created_at:'2026-10-18T01:00:00Z',updated_at:'2026-10-18T01:00:00Z',owner_user_id:7,note:'',evidence:[],history:[],supplier_name:'ร้านผัก'};
  const calls=[];let fail=false;
  const h=await harness('ReceivingIssues',{}, {list:async filters=>{calls.push(['list',filters]);return {items:[row],next_before_id:null};},detail:async()=>({...row}),assignees:async()=>({items:[{id:7,name:'บัญชี'}]}),update:async(id,body)=>{calls.push(['update',id,body]);if(fail)throw Error('mock failure');row={...row,...body,version:row.version+1};return row;}},
    {user:{id:7,role:'accounting',branch_id:1}}, {}, {__shell:{Capacitor:{isNativePlatform:()=>false}},URLSearchParams,fetch:()=>{throw Error('network forbidden');}},null,'../src/receiving-app/ReceivingIssues.jsx');
  await h.select('ประเภท','shortage');assert.equal(calls.at(-1)[1].type,'shortage');
  await h.click('ดู/จัดการเรื่อง 1');await h.select('สถานะ','waiting_supplier');
  await h.find(n=>n.type==='form'&&n.props.onSubmit).props.onSubmit({preventDefault(){}});await h.settle();assert.equal(row.status,'waiting_supplier');assert.equal(row.version,2);
  await h.select('สถานะ','resolved');await h.select('ทางจบ','credit_note');await h.select('เลขที่บิลใหม่','CN-123');
  fail=true;await h.find(n=>n.type==='form'&&n.props.onSubmit).props.onSubmit({preventDefault(){}});await h.settle();assert.equal(calls.filter(call=>call[0]==='update').length,1);await h.click('ยืนยันปิดเรื่อง');assert.match(h.text(h.visible()),/บันทึกไม่ได้/);await h.click('กลับไปตรวจข้อมูล');assert.equal(h.find(n=>n.type==='input'&&n.props.maxLength===255).props.value,'CN-123');
  fail=false;await h.find(n=>n.type==='form'&&n.props.onSubmit).props.onSubmit({preventDefault(){}});await h.settle();await h.click('ยืนยันปิดเรื่อง');
  assert.equal(row.resolution,'credit_note');assert.equal(calls.at(-1)[2].version,2);assert.equal(h.all().some(n=>n.type==='form'&&n.props.onSubmit),false);h.unmount();
});

test('issue staff component: own return proof entry without accounting close controls; linked reminder cannot bypass resolution',async()=>{
  const {harness}=await import('./receiving-harness.mjs');
  const row={id:1,type:'return',status:'open',branch_id:1,document_id:11,quantity:'1.00',amount:'20.00',version:1,due_at:'2026-10-19T01:00:00Z',created_at:'2026-10-18T01:00:00Z',updated_at:'2026-10-18T01:00:00Z',note:'',evidence:[],history:[],supplier_name:'ร้านผัก'};
  const h=await harness('ReceivingIssueDetail',{id:1,user:{id:12,role:'user',branch_id:1},api:{detail:async()=>row}}, {}, {}, {},{__shell:{Capacitor:{isNativePlatform:()=>false}},fetch:()=>{throw Error('network forbidden');}},null,'../src/receiving-app/ReceivingIssueDetail.jsx');
  assert.doesNotMatch(h.text(h.visible()),/ติดตามและปิดเรื่อง/);await h.click('บันทึกการคืน (รูป + ลายเซ็นคนมารับ)');assert.match(h.text(h.visible()),/ชื่อคนมารับคืน/);assert.equal(h.find(n=>n.type==='button'&&h.text(n)==='บันทึกหลักฐาน').props.disabled,true);h.unmount();
});

test('native followup acknowledgement uses PATCH through the same authenticated transport',async()=>{
  const {createReceivingApi}=await import('../src/receiving-app/api.mjs');const calls=[];
  const api=createReceivingApi('https://fixture.example',async options=>{calls.push(options);return {status:200,data:{success:true,data:{ok:true}}};});
  await api.client.patch('/receiving-followups/1',{status:'acknowledged'});
  assert.equal(calls[0].method,'PATCH');assert.equal(calls[0].data.status,'acknowledged');
});

test('return proof component: photo/name/signature, failed submit retains draft and UUID, retry records once',async()=>{
  const {harness,armPad}=await import('./receiving-harness.mjs');let fail=true;const calls=[];let saved=0;
  const h=await harness('ReturnEvidenceForm',{issue:{id:1,type:'return'},api:{attach:async(id,body)=>{calls.push([id,body]);if(fail)throw Error('mock failure');return {id:1};}},onSaved:async()=>saved++},{},{},{},{__shell:{Capacitor:{isNativePlatform:()=>false}},fetch:()=>{throw Error('network forbidden');}},null,'../src/receiving-app/ReturnEvidenceForm.jsx');
  const file=new Blob([new Uint8Array([255,216,255,217])],{type:'image/jpeg'});
  h.find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[file],value:'fixture.jpg'}});await h.settle();
  await h.select('ชื่อคนมารับคืน','สมชาย');
  await armPad(h);let pad=h.find(n=>n.type==='canvas');pad.props.onPointerDown({button:0,pointerType:'mouse',pointerId:1,clientX:10,clientY:10,preventDefault(){}});await h.settle();
  assert.ok(!h.visible().some(n=>n.type==='button'&&h.text(n)==='บันทึกหลักฐาน'),'evidence form is unreachable while the signing sheet holds ink');
  await h.click('บันทึกเซ็น');
  const submit=()=>h.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
  await submit();await h.settle();assert.match(h.text(h.visible()),/บันทึกไม่สำเร็จ/);assert.equal(h.find(n=>n.type==='input'&&n.props.maxLength===255).props.value,'สมชาย');
  fail=false;await submit();await h.settle();assert.equal(saved,1);assert.equal(calls.length,2);assert.equal(calls[0][1].client_uuid,calls[1][1].client_uuid);assert.equal(calls[1][1].signature_data_url,'synthetic-signature');assert.equal(h.find(n=>n.type==='button'&&h.text(n)==='บันทึกหลักฐาน').props.disabled,true);h.unmount();
});

test('integration issues route is unique and ledger legacy followup links retain read-only context',async()=>{
 const app=await read('../src/App.jsx');assert.equal((app.match(/path="\/admin\/receiving\/issues"/g)||[]).length,1);assert.doesNotMatch(app,/ReceivingIssuesPlaceholder/);
 const {harness}=await import('./receiving-harness.mjs');
 const h=await harness('ReceivingIssues',{}, {list:async()=>({items:[],next_before_id:null}),followups:async()=>({items:[{id:90,supplier_name:'ร้านเดิม',note:'ตรวจบิลเดิม',pending_items:[{order_item_id:5,product_name:'ผัก',quantity_received:'2',unit_name:'กก.'}]}]})}, {user:{id:7,role:'accounting',branch_id:1}}, {location:{search:'?followup_id=90'}},{URLSearchParams,__shell:{Capacitor:{isNativePlatform:()=>false}},fetch:()=>{throw Error('network forbidden');}},null,'../src/receiving-app/ReceivingIssues.jsx');
 assert.match(h.text(h.visible()),/เรื่องตามของ #90/);assert.match(h.text(h.visible()),/ตรวจบิลเดิม/);h.unmount();
});
