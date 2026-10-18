import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reviewLedger, rowDecision, orderDifference } from '../src/pages/receiving/review-a.js';
import { issueTime, localDue, issueAmount, issueTypeLabel } from '../src/receiving-app/issue-labels.mjs';
import { harness, row, doc, text, btn, open, sign, cleanup, track } from './review-a-port-harness.mjs';
afterEach(cleanup);
const read = file => readFile(new URL(file, import.meta.url), 'utf8');
const fixture = () => doc({total:'600',lines:[
  row(1,{product_name:'ขา B',bill_text:'ทB',quantity_ordered:'10',quantity_billed:'10',counted_quantity:'9',quantity_received:'9',unit_price:'60',amount:'600',review_decision:'short'}),
  row(2,{product_name:'ปีกกลาง',quantity_ordered:'10',quantity_billed:null,counted_quantity:'5',quantity_received:'5',unit_price:null,amount:null,review_decision:'missing_bill'}),
  row(3,{product_name:'ปีกบน',quantity_billed:null,counted_quantity:'5',quantity_received:'5',unit_price:null,amount:null,review_decision:'missing_bill'}),
  row(4,{product_name:'อกไก่',quantity_billed:null,counted_quantity:'5',quantity_received:'0',unit_price:null,amount:null,review_decision:'not_received'}),
]});

test('C1 C2 C3 C4: staff cards immediately load own branch, closed tab reloads and names/times have clear labels',async()=>{
  const calls=[];const item={id:1,type:'shortage',status:'open',product_name:'ขา B',bill_text:'ทB',supplier_name:'ร้านไก่',quantity:'1.00',amount:'60.00',created_at:'2026-10-18T15:57:00Z',due_at:'2026-10-19T15:57:00Z'};
  const h=track(await harness('ReceivingIssues',{embedded:true},{list:async filters=>{calls.push(filters);return {items:filters.status==='closed'?[]:[item],next_before_id:null};}},{user:{id:1,role:'user',branch_id:1}},{},{URLSearchParams,__shell:{Capacitor:{isNativePlatform:()=>false}},fetch:()=>{throw Error('network forbidden');}},null,'../src/receiving-app/ReceivingIssues.jsx'));
  assert.equal(calls[0].status,'pending');assert.equal(calls[0].branch_id,1);
  assert.equal(h.visible().filter(n=>n.type==='table').length,0);
  assert.equal(h.visible().filter(n=>n.type==='article').length,1);
  assert.match(text(h),/เรื่องค้างของสาขาฉัน/);assert.match(text(h),/ขา B/);assert.match(text(h),/ชื่อในบิล: ทB/);
  assert.match(text(h),/เปิดเรื่อง 18 ต.ค. 2569 22:57/);assert.match(text(h),/กำหนดตาม 19 ต.ค. 2569 22:57/);
  assert.doesNotMatch(text(h),/รหัสสาขา|อายุเรื่องอย่างน้อย|โหลดรายการ/);
  await h.click('ปิดแล้ว');assert.equal(calls.at(-1).status,'closed');assert.match(text(h),/ไม่มีเรื่อง/);
  await h.click('ค้าง');assert.equal(calls.at(-1).status,'pending');assert.equal(h.visible().filter(n=>n.type==='article').length,1);
});

test('C1 C2: embedded manager also sees only selected branch; web accounting keeps full filters',async()=>{
  for(const embedded of [true,false]){
    const calls=[];const h=track(await harness('ReceivingIssues',{embedded},{list:async f=>{calls.push(f);return {items:[],next_before_id:null};}},{user:{role:'accountant',branch_id:3}},{},{URLSearchParams,__shell:{Capacitor:{isNativePlatform:()=>false}},fetch:()=>{throw Error('network forbidden');}},null,'../src/receiving-app/ReceivingIssues.jsx'));
    if(embedded){assert.equal(calls[0].branch_id,3);assert.doesNotMatch(text(h),/รหัสสาขา/);}else{assert.match(text(h),/รหัสสาขา/);await h.select('รหัสสาขา','2');assert.equal(calls.at(-1).branch_id,'2');}
  }
});

test('C4: Bangkok midnight has one conversion, offset and Z inputs agree and due edit round-trips',()=>{
  for(const [utc,date] of [['2026-10-18T16:59:59Z','18 ต.ค. 2569 23:59'],['2026-10-18T17:00:00Z','19 ต.ค. 2569 00:00']]){
    assert.equal(issueTime(utc),date);const local=localDue(utc);assert.equal(Date.parse(`${local}:00+07:00`),Date.parse(utc)-Date.parse(utc)%60000);
  }
  assert.equal(issueTime('2026-10-18T22:57:00+07:00'),issueTime('2026-10-18T15:57:00Z'));
});

test('C6: 600 bill - 60 shortage = 540 known received plus two pending prices; rejection adds no value',async()=>{
  const data=fixture(),ledger=reviewLedger(data);
  assert.equal(ledger.bill,60000n);assert.equal(ledger.decisionAdjustment,-6000n);assert.equal(ledger.receivedNet,54000n);
  assert.equal(ledger.bill+ledger.adjustment,ledger.receivedNet);assert.equal(ledger.pendingPrices.length,2);
  assert.deepEqual(ledger.pendingPrices.map(r=>r.name),['ปีกกลาง','ปีกบน']);
  const h=track(await harness('ReviewSummary',{doc:data}));const dl=h.find(n=>n.type==='dl');
  assert.match(h.text(dl),/ยอดบิล600.00 บาท/);assert.match(h.text(dl),/ปรับตามการตัดสินใจ-60.00 บาท/);assert.match(h.text(dl),/มูลค่าที่รับ \(ส่วนที่ทราบราคา\)540.00 บาท/);assert.match(h.text(dl),/รายการรอราคา \(2\)/);assert.doesNotMatch(h.text(dl),/รวมรายการ/);
});

test('C6: exact decimals, free goods, amount-only bills, tax and header differences reconcile',()=>{
  const l=reviewLedger(doc({total:'0.30',lines:[row(1,{quantity_received:'1',quantity_billed:'1',unit_price:'0.1',amount:'0.1'}),row(2,{quantity_received:'1',quantity_billed:'1',unit_price:'0.2',amount:'0.2'})]}));
  assert.equal(l.receivedNet,30n);assert.equal(l.adjustment,0n);
  const free=reviewLedger(doc({lines:[row(1,{quantity_billed:null,unit_price:'0',amount:null,review_decision:'missing_bill'})]}));assert.equal(free.missingPrice,false);assert.equal(free.received,0n);
  const proportional=reviewLedger(doc({total:'10',discount:'1',vat:'2',lines:[row(1,{quantity_billed:'3',quantity_received:'2',unit_price:null,amount:'9'})]}));
  assert.equal(proportional.receivedNet,700n);assert.equal(proportional.decisionAdjustment,-300n);assert.equal(proportional.bill+proportional.adjustment,700n);
  const mismatch=reviewLedger(doc({total:'100',lines:[row(1,{amount:'20'})]}));assert.equal(mismatch.reconciliation,-8000n);assert.equal(mismatch.bill+mismatch.adjustment,mismatch.receivedNet);
  const half=reviewLedger(doc({lines:[row(1,{quantity_billed:'1',quantity_received:'1',unit_price:'0.005',amount:'0.01'})]}));assert.equal(half.received,1n);
});

test('C7 C8: plain staff actions show received quantity, shortage and missing-bill order context',()=>{
  const data=fixture();assert.equal(rowDecision(data.lines[0],data).action,'รับ 9 กก. · แจ้งร้านขาด 1 กก.');
  assert.equal(rowDecision(data.lines[1],data).action,'รับ 5 กก. · ให้บัญชีขอบิลจากร้าน');
  assert.equal(orderDifference(data.lines[1]),'ขาดจากใบสั่ง 5 kg');
  assert.equal(orderDifference({...data.lines[1],quantity_ordered:null}),'');
});

test('C9: reject asks first, cancellation makes no API write; confirmation keeps original count',async()=>{
  let allow=false;const prompts=[];const h=await open(doc({lines:[row(1,{quantity_billed:null})]}),{},{},{},{confirm:message=>{prompts.push(message);return allow;}});
  await h.click('ไม่รับ · คืนร้าน 2 กก.');assert.equal(h.calls.length,0);assert.match(prompts[0],/คืนร้าน 2 กก./);
  allow=true;await h.click('ไม่รับ · คืนร้าน 2 กก.');assert.equal(h.calls[0][2].lines[0].quantity_received,'0.00');assert.equal(h.calls[0][2].lines[0].review_decision,'not_received');assert.match(text(h),/นับได้2/);
});

test('C9: reload lives in More, cancelling retains edits, accepting reloads once and clears unsaved changes',async()=>{
  let allow=false,reads=0;const h=await open(doc(),{get:async()=>{reads++;return doc();}},{},{},{confirm:()=>allow});
  const more=h.find(n=>n.type==='details'&&h.all(n).some(child=>child.type==='summary'&&h.text(child)==='เพิ่มเติม'));
  assert.ok(h.all(more).some(n=>n.type==='button'&&h.text(n)==='โหลดเอกสารล่าสุด'));
  await h.click('แก้');await h.select('แก้จำนวนหลังเปิดบิล ผัก 1','1.5');await h.click('โหลดเอกสารล่าสุด');assert.equal(reads,0);assert.match(text(h),/แก้หลังเปิดบิล: รับ 1.5/);
  allow=true;await h.click('โหลดเอกสารล่าสุด');assert.equal(reads,1);assert.doesNotMatch(text(h),/แก้หลังเปิดบิล: รับ 1.5/);assert.equal(h.events.get('beforeunload').size,0);
});

test('C10: issue navigation exists on queue and disappears when editing/after confirm',async()=>{
  const h=track(await harness('Receiving',{chrome:'embedded',onOpenIssues(){}}));assert.ok(btn(h,'ติดตามปัญหา / คืนของ'));
  const source=await read('../src/receiving-app/ReceivingApp.jsx');assert.match(source,/issuePage && <nav/);assert.match(source,/onOpenIssues=\{/);
  const editor=await open(doc());assert.doesNotMatch(text(editor),/ติดตามปัญหา \/ คืนของ/);
});

test('C1 C11: issue styles use shared theme tokens and signature remains 200px with original drawing handlers',async()=>{
  const css=await read('../src/receiving-app/receiving-issues.css');assert.match(css,/@import '..\/design\/tokens.css'/);assert.match(css,/small[^}]*color:var\(--sg-muted\)/);assert.doesNotMatch(css,/color-scheme:light|background:white/);
  const review=await read('../src/pages/receiving/review-a.css');assert.match(review,/rc-signature canvas[^}]*height:200px; min-height:200px/);
  const h=await open(doc({lines:[row(1,{review_decision:'accept'})]}));await sign(h);const canvas=h.find(n=>n.type==='canvas');assert.equal(typeof canvas.props.onPointerDown,'function');assert.equal(canvas.props.width,'760');assert.equal(canvas.props.height,'240');
});


test('C5: a bill-request amount of zero stays pending rather than appearing free',()=>{
  assert.equal(issueTypeLabel({type:'wrong_item',note:'ไม่มีในบิล · ให้บัญชีขอบิลจากร้าน'}),'ไม่มีในบิล · ขอบิล');
  assert.equal(issueAmount({type:'wrong_item',note:'ไม่มีในบิล · ให้บัญชีขอบิลจากร้าน',amount:'0.00'}),'รอตรวจราคา');
  assert.equal(issueAmount({type:'shortage',amount:'0.00'}),'0.00 บาท');
  assert.equal(issueAmount({type:'wrong_item',note:'ไม่มีในบิล',amount:'10.00'}),'10.00 บาท');
});

test('C1: shared light/dark text, muted text and main controls meet AA against every card surface',()=>{
  const lum=hex=>{const v=hex.match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2];};
  for(const [fg,bg] of [['182444','ffffff'],['3e4758','ffffff'],['3e4758','f7f5f0'],['ffffff','1e3168'],['f7f5f0','1b2334'],['e0e5ee','1b2334'],['e0e5ee','101522'],['132247','b8caff']]){
    const a=lum(fg),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);assert.ok(ratio>=4.5,`${fg}/${bg}: ${ratio}`);
  }
});
