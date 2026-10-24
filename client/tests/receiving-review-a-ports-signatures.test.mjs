import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { row, doc, signed, text, btn, deferred, cleanup, open, sign, draw, start, chooseFile, summary } from './review-a-port-harness.mjs';
// Signing surfaces are closed until the receiver taps 'แตะเพื่อเซ็น'; count the pads waiting to be opened.
const pads = h => h.visible().filter(n => n.type === 'button' && h.text(n).startsWith('แตะเพื่อเซ็น')).length;
const gone = (h, label) => !h.visible().some(n => n.type === 'button' && h.text(n) === label);
afterEach(cleanup);

// Original tests/receiving-device-r3.test.mjs:136
test("PORT 008: device r3: review all 10 proposals -> sign -> confirm -> received-success has one primary per step", async () => {
const h = await open(doc({ lines: Array.from({length:10}, (_,i) => row(i+1)) })); h.budget();
await h.click('ยืนยันทั้งหมดที่ตรง'); assert.equal(h.calls.filter(c=>c[0]==='update').length,1);
await sign(h); h.budget(); await draw(h); await h.click('เซ็นและยืนยันรับ');
assert.match(text(h),/รับของเรียบร้อย/); assert.equal(h.calls.filter(c=>c[0]==='confirm').length,1); h.budget();
});

// Original tests/receiving-device-r4.test.mjs:30
test("PORT 009: device r4: acknowledged receiver image equals the submitted image; tabs retain proof; redraw requires a new save", async () => {
const h = await open(signed({has_receiver_signature:false,courier_name:'คนส่ง'})); /* courier named: the receiver sheet only saves (owner 2026-10-24 sign+confirm applies without a courier) */ await sign(h); await draw(h); await h.click('บันทึกเซ็น');
const payload=h.calls.find(c=>c[0]==='signature'); const image=()=>h.find(n=>n.type==='img' && /ลายเซ็นผู้รับ/.test(n.props.alt||''));
assert.equal(image().props.src,payload[3]); await h.click('ตรวจ'); await sign(h); assert.equal(image().props.src,payload[3]);
await h.click('เซ็นใหม่'); assert.equal(btn(h,'ยืนยันรับสินค้า').props.disabled,true);
await draw(h); await h.click('บันทึกเซ็น'); assert.equal(h.calls.filter(c=>c[0]==='signature').length,2); assert.equal(btn(h,'ยืนยันรับสินค้า').props.disabled,false);
});

// Original tests/receiving-device-r4.test.mjs:48
test("PORT 010: device r4: courier signature has its own acknowledged image across closing and reopening the sheet", async () => {
const h = await open(signed()); await sign(h); await draw(h); await h.click('บันทึกเซ็น');
const sent=h.calls.find(c=>c[0]==='signature'); assert.equal(sent[2],'courier');
const proof=()=>h.find(n=>n.type==='img' && /ลายเซ็นผู้ส่ง/.test(n.props.alt||'')); assert.equal(proof().props.src,sent[3]);
await h.click('ตรวจ'); await sign(h); assert.equal(proof().props.src,sent[3]); assert.equal(pads(h),0);
});

// Original tests/receiving-device-r4.test.mjs:59
test("PORT 011: device r4: reopened saved flag fetches a protected image, never an empty signing canvas", async () => {
const reads=[]; const h=await open(signed(),{signatureImage:async(id,role)=>{reads.push([id,role]);return new Blob(['protected']);}});
await sign(h); assert.deepEqual(reads,[[5,'receiver']]); assert.ok(h.find(n=>n.type==='img' && /ลายเซ็นผู้รับ/.test(n.props.alt||'')).props.src.startsWith('blob:'));
assert.equal(pads(h),1); assert.equal(h.calls.filter(c=>c[0]==='signature').length,0);
});

// Original tests/receiving-device-r4.test.mjs:67
test("PORT 012: device r4: image decode failure has an explicit retry and never reverts to a blank canvas", async () => {
let reads=0; const h=await open(signed(),{signatureImage:async()=>{reads++;return new Blob(['protected']);}}); await sign(h);
h.find(n=>n.type==='img' && /ลายเซ็นผู้รับ/.test(n.props.alt||'')).props.onError(); await h.settle();
assert.match(text(h),/แสดงภาพลายเซ็นไม่ได้/); assert.equal(pads(h),1);
await h.click('ลองโหลดใหม่'); assert.equal(reads,2); assert.ok(h.find(n=>n.type==='img' && /ลายเซ็นผู้รับ/.test(n.props.alt||'')));
});

// Original tests/receiving-device-r4.test.mjs:76
test("PORT 013: device r4: failed signature save preserves ink, reports a real error and only shows proof after retry succeeds", async () => {
let fail=true; const saved=[]; /* courier named: the receiver sheet only saves (owner 2026-10-24 sign+confirm applies without a courier) */ const h=await open(signed({has_receiver_signature:false,courier_name:'คนส่ง'}),{signature:async(...args)=>{saved.push(args);if(fail)throw {response:{status:500}};},get:async()=>signed()});
await sign(h); await draw(h); await h.click('บันทึกเซ็น'); assert.match(text(h),/ส่งข้อมูลไม่สำเร็จ/);
assert.equal(btn(h,'บันทึกเซ็น').props.disabled,false); assert.ok(gone(h,'ยืนยันรับสินค้า'),'confirm is unreachable while the signing sheet holds unsaved ink');
assert.ok(!h.visible().some(n=>n.type==='img' && /ลายเซ็นผู้รับ/.test(n.props.alt||'')));
fail=false; await h.click('บันทึกเซ็น'); assert.equal(saved[0][2],saved[1][2]); assert.equal(btn(h,'ยืนยันรับสินค้า').props.disabled,false);
assert.equal(h.find(n=>n.type==='img' && /ลายเซ็นผู้รับ/.test(n.props.alt||'')).props.src,saved[1][2]);
});

// Original tests/receiving-device-r4.test.mjs:108
test("PORT 015: device r4: acknowledged signature survives a failed follow-up read; explicit reload fetches saved proof", async () => {
let fail=true; const h=await open(signed({has_receiver_signature:false}),{get:async()=>{if(fail)throw {request:{}};return signed();}});
await sign(h); await draw(h); await h.click('เซ็นและยืนยันรับ'); assert.match(text(h),/การเชื่อมต่อ/); assert.equal(h.calls.some(c=>c[0]==='confirm'),false,'unknown summary: confirm by hand');
assert.equal(h.find(n=>n.type==='img' && /ลายเซ็นผู้รับ/.test(n.props.alt||'')).props.src,h.calls.find(c=>c[0]==='signature')[3]);
assert.equal(btn(h,'ยืนยันรับสินค้า').props.disabled,false); fail=false; await h.click('โหลดเอกสารล่าสุด'); await sign(h);
assert.ok(h.find(n=>n.type==='img' && /ลายเซ็นผู้รับ/.test(n.props.alt||'')).props.src.startsWith('blob:'));
});

// Original tests/receiving-device-r4.test.mjs:164
test("PORT 020: device r4: pending uploads block sign/confirm; automatic failure waits for explicit retry and new bill requires review", async () => {
let uploads=0,reads=0,fail=true;const h=await open(signed(),{image:async()=>new Blob(['bill']),uploadImage:async()=>{uploads++;if(fail)throw {request:{}};},get:async()=>signed({images:[{id:9,page_no:1}],lines:[row(1,{review_decision:null})]}),ocr:async()=>{reads++;return doc({images:[{id:9,page_no:1}],lines:[row(1,{review_decision:null})]});}}); await h.click('ดู / เพิ่มรูปบิล'); await chooseFile(h);
await h.click('ตรวจ'); assert.equal(btn(h,'ดูสรุปก่อนเซ็น').props.disabled,true); assert.equal(btn(h,'เซ็น').props.disabled,true);
assert.equal(h.calls.filter(c=>['signature','confirm','ocr'].includes(c[0])).length,0); await h.click('ดู / เพิ่มรูปบิล');fail=false;await h.click('กลับเทียบบิล');
assert.equal(uploads,2);assert.equal(reads,1);assert.equal(btn(h,'ดูสรุปก่อนเซ็น').props.disabled,true);
await h.click('ยืนยันรับ 2');assert.equal(btn(h,'ดูสรุปก่อนเซ็น').props.disabled,false);
});

// Original tests/receiving-device-ux.test.mjs:78
test("PORT 023: device UX: sheet edits and unsaved signatures are reported; closing/clearing resets them", async () => {
const dirty=[]; const h=await open(signed(),{}, {onDirtyChange:v=>dirty.push(v)}); await sign(h); await draw(h);
assert.equal(dirty.at(-1),true); assert.ok(gone(h,'ยืนยันรับสินค้า')); await h.click('ล้างเส้น');
assert.equal(dirty.at(-1),false); await h.click('ยกเลิก'); assert.equal(btn(h,'ยืนยันรับสินค้า').props.disabled,false);
await h.select('ชื่อผู้ส่งของ','คุณส่ง'); assert.equal(dirty.at(-1),true); await h.click('บันทึกชื่อผู้ส่ง'); assert.equal(dirty.at(-1),false);
});

// Original tests/receiving-illustrations.test.mjs:138
test("PORT 031: illustrations: received-success only follows confirmed response; request failure never shows it", async () => {
for(const outcome of ['failure','confirmed','draft']){ const gate=deferred(); const h=await open(signed(),{confirm:()=>gate.promise}); await sign(h);
const {promise}=await start(h,'ยืนยันรับสินค้า'); assert.doesNotMatch(text(h),/รับของเรียบร้อย/);
if(outcome==='failure')gate.reject({response:{status:422}});else gate.resolve(signed({status:outcome})); await promise; await h.settle();
assert.equal(/รับของเรียบร้อย/.test(text(h)),outcome==='confirmed'); }
});

// Original tests/receiving-redesign.test.mjs:103
test("PORT 049: redesign full flow: select all, review, both saved signatures, confirmed receipt, next shop; API writes happen only on explicit actions", async () => {
let next=0; const h=await open(doc(),{}, {onNextShop:()=>next++}); assert.equal(h.calls.length,0); await h.click('ยืนยันทั้งหมดที่ตรง'); await sign(h);
// Owner 2026-10-24: with a courier signature the receiver sheet only saves; the footer confirms.
await draw(h,1); await h.click('บันทึกเซ็น'); await draw(h); await h.click('บันทึกเซ็น'); await h.click('ยืนยันรับสินค้า');
assert.deepEqual(h.calls.map(c=>c[0]),['update','signature','signature','confirm']); assert.deepEqual(h.calls.filter(c=>c[0]==='signature').map(c=>c[2]),['courier','receiver']); assert.match(text(h),/รับของเรียบร้อย/);
await h.click('กลับหน้ารับสินค้า'); assert.equal(next,1);
});

// Original tests/receiving-signature-read.test.mjs:19
test("PORT 065: Signature read UI: reopened draft loads both roles via auth API and revokes URLs on close/unmount without storage", async () => {
const reads=[],revoked=[]; let urls=0; const h=await open(signed({has_courier_signature:true}),{signatureImage:async(id,role)=>{reads.push([id,role]);return new Blob(['private']);}}, {}, {URL:{createObjectURL:()=>`blob:proof-${++urls}`,revokeObjectURL:u=>revoked.push(u)}});
await sign(h); assert.deepEqual([...reads].sort(),[[5,'courier'],[5,'receiver']]); assert.equal(pads(h),0);
await h.click('ตรวจ'); assert.deepEqual(revoked.sort(),['blob:proof-1','blob:proof-2']); await sign(h); h.unmount();
assert.equal(revoked.length,4); assert.equal(h.storage.size,0);
});

// Original tests/receiving-signature-read.test.mjs:41
test("PORT 066: Signature read UI: confirmed/void show both images with no signing controls or writes", async () => {
for(const status of ['confirmed','void']){const reads=[];const h=await open(signed({status,has_courier_signature:true}),{signatureImage:async(id,role)=>{reads.push(role);return new Blob(['private']);}});
assert.deepEqual(reads,['receiver','courier']); assert.equal(pads(h),0);
assert.ok(!h.visible().some(n=>n.type==='button' && /บันทึกเซ็น|เซ็นใหม่/.test(h.text(n)))); assert.equal(h.calls.length,0);}
});

// Original tests/receiving-signature-read.test.mjs:59
test("PORT 067: Signature read UI: missing flags never fetch images", async () => {
let reads=0;const h=await open(signed({has_receiver_signature:false,has_courier_signature:false}),{signatureImage:async()=>{reads++;return new Blob();}});await sign(h);
assert.equal(reads,0);assert.equal(pads(h),2);h.unmount();assert.equal(reads,0);
});

// Original tests/receiving-ui.test.mjs:21
test("PORT 068: UI: photo OCR -> edit -> receiver signature -> confirm -> void preserves API flow and action budget", async () => {
const h=await open(doc({images:[{id:2,page_no:1}]}),{image:async()=>new Blob(['bill'])});await h.click('อ่านบิลด้วย AI (คงจำนวนนับ)');await h.click('แก้');
await h.select('แก้จำนวนหลังเปิดบิล ผัก 1','1.5');await h.click('รับ 1.5 กก. · แจ้งร้านขาด 0.5 กก.');await sign(h);await draw(h);await h.click('เซ็นและยืนยันรับ');
assert.match(text(h),/รับของเรียบร้อย/);await h.select('เหตุผลยกเลิก','รับผิดใบ');await h.click('ยกเลิกใบรับ');assert.match(text(h),/ใบรับถูกยกเลิกแล้ว/);
assert.deepEqual(h.calls.map(c=>c[0]),['ocr','update','signature','confirm','void']);h.budget();
});

// Original tests/receiving-ui.test.mjs:61
test("PORT 070: UI: ambiguous confirm switches to a single recovery action and never retries the write", async () => {
let writes=0,reads=0;const h=await open(signed(),{confirm:async()=>{writes++;throw {request:{}};},get:async()=>{reads++;return signed({status:'confirmed'});}});await sign(h);
const stale=btn(h,'ยืนยันรับสินค้า');await h.click('ยืนยันรับสินค้า');assert.match(text(h),/ยังไม่ทราบผลยืนยันรับ/);assert.equal(btn(h,'ยืนยันรับสินค้า').props.disabled,true);
await stale.props.onClick();assert.equal(writes,1);await h.click('ตรวจผลล่าสุด');assert.equal(reads,1);assert.equal(writes,1);assert.match(text(h),/รับของเรียบร้อย/);
});

// Original tests/receiving-ui.test.mjs:180
test("PORT 077: UI r3: confirm and void keep saving visible and locked until the controlled 400ms gate", async () => {
for(const action of ['confirm','void']){const gate=deferred(),dirty=[];let writes=0;const h=await open(signed({status:action==='void'?'confirmed':'draft'}),{[action]:()=>{writes++;return gate.promise;}},{onDirtyChange:v=>dirty.push(v)});
if(action==='confirm')await sign(h);else await h.select('เหตุผลยกเลิก','ผิดใบ');const label=action==='confirm'?'ยืนยันรับสินค้า':'ยกเลิกใบรับ';const stale=btn(h,label);const {promise}=await start(h,label);
assert.match(text(h),/กำลังบันทึก/);assert.equal(dirty.at(-1),true);assert.ok(h.events.get('beforeunload').size);await stale.props.onClick();assert.equal(writes,1);
gate.resolve(signed({status:action==='confirm'?'confirmed':'void'}));await promise;await h.settle();assert.equal(dirty.at(-1),false);assert.equal(h.events.get('beforeunload').size,0);}
});

// Original tests/receiving-ux-061.test.mjs:130
test("PORT 094: UX061 #1: signature refresh also displays changed reasons before proceeding", async () => {
const changed=signed({warnings:[{code:'LOW_CONFIDENCE'}]});const h=await open(signed({has_receiver_signature:false}),{get:async()=>changed});await sign(h);await draw(h);await h.click('เซ็นและยืนยันรับ');assert.equal(h.calls.some(c=>c[0]==='confirm'),false);
assert.match(text(h),/บันทึกลายเซ็นแล้ว.*สรุปเปลี่ยน/);assert.match(text(h),/อ่านบิลได้ไม่ชัด/);assert.ok(!h.visible().some(n=>n.type==='button' && h.text(n)==='ยืนยันรับสินค้า'));
await h.click('รับทราบสรุปและกลับไปเซ็น');assert.equal(btn(h,'ยืนยันรับสินค้า').props.disabled,false);assert.equal(h.calls.filter(c=>c[0]==='signature').length,1);
});

// Original tests/receiving-ux-062.test.mjs:94
test("PORT 099: UX062 #3: changed summary is amber, acknowledgement goes to sign once and clears across steps", async () => {
const h=await open(signed({has_receiver_signature:false}),{get:async()=>signed({discount:'1'})});await sign(h);await draw(h);await h.click('เซ็นและยืนยันรับ');assert.equal(h.calls.some(c=>c[0]==='confirm'),false);
assert.match(text(h),/สรุปเปลี่ยน/);await h.click('รับทราบสรุปและกลับไปเซ็น');await h.click('ตรวจ');await sign(h);
assert.doesNotMatch(text(h),/สรุปเปลี่ยน/);assert.equal(btn(h,'ยืนยันรับสินค้า').props.disabled,false);
});

// Original tests/receiving-ux-063.test.mjs:81
test("PORT 103: UX063 #2: changed summary after signature acknowledges saved ink once and returns to signed page", async () => {
const h=await open(signed({has_receiver_signature:false}),{get:async()=>signed({warnings:[{code:'PRICE_CHANGE'}]})});await sign(h);await draw(h);await h.click('เซ็นและยืนยันรับ');assert.equal(h.calls.some(c=>c[0]==='confirm'),false);
assert.match(text(h),/บันทึกลายเซ็นแล้ว/);assert.match(text(h),/ราคาเปลี่ยน/);await h.click('รับทราบสรุปและกลับไปเซ็น');assert.equal(pads(h),1);
assert.ok(h.find(n=>n.type==='img' && /ลายเซ็นผู้รับ/.test(n.props.alt||'')));assert.equal(h.calls.filter(c=>c[0]==='signature').length,1);
});

// Original tests/receiving-ux-063.test.mjs:98
test("PORT 104: UX063 #2: before-sign changes keep explicit signature destination and never claim ink was saved", async () => {
const h=await open(signed({has_receiver_signature:false}));await h.click('ดูสรุปก่อนเซ็น');assert.doesNotMatch(text(h),/บันทึกลายเซ็นแล้ว/);
assert.equal(h.calls.filter(c=>c[0]==='signature').length,0);await h.click('ไปเซ็นรับของ');assert.ok(h.visible().some(n=>n.type==='canvas'));await h.click('ยกเลิก');assert.equal(btn(h,'ยืนยันรับสินค้า').props.disabled,true);assert.equal(pads(h),2);
});

test('A receiver save: a second tap while signature write is pending cannot send another write or acknowledge early', async () => {
  const gate=deferred(); let writes=0;
  /* courier named: the receiver sheet only saves (owner 2026-10-24 sign+confirm applies without a courier) */
  const h=await open(signed({has_receiver_signature:false,courier_name:'คนส่ง'}),{signature:()=>{writes++;return gate.promise;},get:async()=>signed({courier_name:'คนส่ง'})});
  await sign(h); await draw(h); const stale=btn(h,'บันทึกเซ็น'); const {promise}=await start(h,'บันทึกเซ็น');
  await stale.props.onClick(); assert.equal(writes,1); assert.ok(gone(h,'ยืนยันรับสินค้า'));
  assert.ok(!h.visible().some(n=>n.type==='img' && /ลายเซ็นผู้รับ/.test(n.props.alt||'')));
  gate.resolve(); await promise; await h.settle(); assert.equal(writes,1); assert.equal(btn(h,'ยืนยันรับสินค้า').props.disabled,false);
});
