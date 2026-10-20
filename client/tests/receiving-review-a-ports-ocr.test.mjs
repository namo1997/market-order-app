import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { row, doc, text, btn, field, deferred, cleanup, open, start, fakeFile, chooseFile, clock, historyBrowser } from './review-a-port-harness.mjs';
afterEach(cleanup);

// Original tests/receiving-device-r3.test.mjs:36
test("PORT 002: device r3: reopened pilot OCR without doc_kind keeps 10 proposals and review CTA on both tabs", async () => {
const h=await open(doc({ocr:{status:'done'},lines:Array.from({length:10},(_,i)=>row(i+1,{match:{source:'ai'},review_decision:null}))}));
assert.match(text(h),/ตัดสินใจแล้ว 0\/10/);await h.click('ดู / เพิ่มรูปบิล');await h.click('กลับเทียบบิล');assert.match(text(h),/ตัดสินใจแล้ว 0\/10/);
assert.equal(btn(h,'ดูสรุปก่อนเซ็น').props.disabled,true);assert.equal(h.calls.length,0);
});

// Original tests/receiving-device-r3.test.mjs:52
test("PORT 003: device r3: fresh OCR checks merged human rows, and zero-line nonbill alone offers retake", async () => {
const h=await open(doc({images:[{id:2,page_no:1}]}),{ocr:async()=>doc({ocr:{status:'done',warnings:[{code:'NOT_A_BILL'}]},lines:[row()]})});
await h.click('อ่านบิลด้วย AI (คงจำนวนนับ)');assert.match(text(h),/ผัก 1/);assert.match(text(h),/ดิบ 1/);assert.match(text(h),/AI ไม่พบรายการ/);
assert.equal(btn(h,'ยืนยันรับ 2').props.disabled,false);assert.equal(btn(h,'ดูสรุปก่อนเซ็น').props.disabled,true);
});

// Original tests/receiving-device-r3.test.mjs:67
test("PORT 004: device r3: reading pilot mock with 10 rows and no doc_kind lands on review, then keeps review CTA on bill tab", async () => {
const gate=deferred();const h=await open(doc({images:[{id:2,page_no:1}]}),{ocr:()=>gate.promise});const {promise}=await start(h,'อ่านบิลด้วย AI (คงจำนวนนับ)');
gate.resolve(doc({ocr:{status:'done'},lines:Array.from({length:10},(_,i)=>row(i+1,{match:{source:'ai'}}))}));await promise;await h.settle();
assert.match(text(h),/ตัดสินใจแล้ว 0\/10/);await h.click('ดู / เพิ่มรูปบิล');await h.click('กลับเทียบบิล');assert.equal(h.visible().filter(n=>n.props.id?.startsWith('review-row-')).length,10);
});

// Original tests/receiving-device-ux.test.mjs:94
test("PORT 024: device UX: image processing and failed pending upload stay protected until retry succeeds", async () => {
const gate=deferred(),dirty=[];let fail=true;const h=await open(doc(),{uploadImage:async()=>{if(fail)throw {request:{}};}},{onDirtyChange:v=>dirty.push(v)}, {}, {}, ()=>gate.promise);
await h.click('ดู / เพิ่มรูปบิล');h.find(n=>n.type==='input' && n.props.type==='file').props.onClick({preventDefault(){}});await h.settle();assert.equal(dirty.at(-1),true);
gate.resolve(fakeFile());await h.settle();await h.click('กลับเทียบบิล');assert.equal(dirty.at(-1),true);assert.match(text(h),/รอส่ง 1 หน้า/);
fail=false;await h.click('กลับเทียบบิล');assert.equal(dirty.at(-1),false);assert.match(text(h),/ตัดสินใจแล้ว/);
});

// Original tests/receiving-illustrations.test.mjs:87
test("PORT 026: illustrations: reading-bill is tied to the actual OCR promise and never pretends success", async () => {
const gate=deferred();const h=await open(doc({images:[{id:2,page_no:1}]}),{ocr:()=>gate.promise});const {promise}=await start(h,'อ่านบิลด้วย AI (คงจำนวนนับ)');
assert.ok(h.visible().some(n=>/reading-bill/.test(n.props.src||'')));assert.doesNotMatch(text(h),/รับของเรียบร้อย/);
gate.reject({response:{status:503}});await promise;await h.settle();assert.ok(!h.visible().some(n=>/reading-bill/.test(n.props.src||'')));assert.match(text(h),/ยังไม่ทราบผลอ่านบิล/);
});

// Original tests/receiving-illustrations.test.mjs:98
test("PORT 027: illustrations: not-a-bill requires explicit warning and no usable rows; draft and failed OCR remain distinct", async () => {
for(const ocr of [{status:'none'},{status:'failed'},{status:'done',warnings:[{code:'NOT_A_BILL'}]}]){const h=await open(doc({ocr,lines:[]}));
assert.equal(/อ่านบิลไม่สำเร็จ/.test(text(h)),ocr.status==='failed');assert.equal(/AI ไม่พบรายการ/.test(text(h)),ocr.status==='done');
assert.equal(btn(h,'ดูสรุปก่อนเซ็น').props.disabled,true);assert.ok(!h.visible().some(n=>/not-a-bill/.test(n.props.src||'')) || ocr.status==='done');}
});

// Original tests/receiving-illustrations.test.mjs:110
test("PORT 028: illustrations: corrected photo after zero-line OCR offers a real reread instead of skipping to lines", async () => {
let reads=0;const h=await open(doc({lines:[],images:[{id:2,page_no:1}],ocr:{status:'done',warnings:[{code:'NOT_A_BILL'}]}}),{image:async()=>new Blob(['bill']),get:async()=>doc({images:[{id:2,page_no:1},{id:3,page_no:2}]}),ocr:async()=>{reads++;return doc({ocr:{status:'done'}});}});
await h.click('ดู / เพิ่มรูปบิล');await chooseFile(h);await h.settle();
assert.equal(reads,1);assert.match(text(h),/ผัก 1/);assert.doesNotMatch(text(h),/AI ไม่พบรายการ/);
});

// Original tests/receiving-illustrations.test.mjs:119
test("PORT 029: illustrations: reopened failed OCR shows error; explicit non-bill warning shows the bill-check hint", async () => {
const failed=await open(doc({ocr:{status:'failed'}}));assert.match(text(failed),/อ่านบิลไม่สำเร็จ/);assert.doesNotMatch(text(failed),/รับของเรียบร้อย/);
const nonbill=await open(doc({ocr:{status:'done',warnings:[{code:'NOT_A_BILL'}]}}));assert.match(text(nonbill),/AI ไม่พบรายการ/);assert.match(text(nonbill),/ผัก 1/);assert.doesNotMatch(text(nonbill),/อ่านบิลไม่สำเร็จ/);
});

// Original tests/receiving-illustrations.test.mjs:126
test("PORT 030: illustrations: saving edited data before OCR does not show the OCR picture prematurely", async () => {
const gate=deferred();const h=await open(doc({images:[{id:2,page_no:1}]}),{update:()=>gate.promise});await h.select('เลขที่บิล','MANUAL');const {promise}=await start(h,'บันทึกหัวบิล');
assert.ok(!h.visible().some(n=>/reading-bill/.test(n.props.src||'')));assert.equal(h.calls.filter(c=>c[0]==='ocr').length,0);gate.resolve(doc({doc_ref:'MANUAL'}));await promise;await h.settle();
assert.equal(field(h,'เลขที่บิล').props.value,'MANUAL');
});

// Original tests/receiving-r2.test.mjs:66
test("PORT 035: r2: OCR decisions are per line; pending AI blocks confirm and warnings appear beside the row", async () => {
const h=await open(doc({lines:[row(1,{match:{source:'ai'}}),row(2)],ocr:{status:'done',warnings:[{code:'LOW_CONFIDENCE',line_no:1}]}}));
const card=h.find(n=>n.props.id==='review-row-1');assert.match(h.text(card),/อ่านบิลได้ไม่ชัด/);assert.equal(btn(h,'ดูสรุปก่อนเซ็น').props.disabled,true);
await h.click('ยืนยันสินค้าที่เลือกและรับ');assert.equal(h.calls[0][2].lines[0].match.source,'manual');assert.equal(h.calls[0][2].lines[1].review_decision,null);
});

// Original tests/receiving-r2.test.mjs:80
test("PORT 036: r2: OCR reread preserves edited lines and explicitly cleared header; edit/zero remain independent", async () => {
let submitted;const h=await open(doc({doc_ref:'OLD',images:[{id:2,page_no:1}]}),{ocr:async()=>{submitted=h.calls.find(c=>c[0]==='update')[2];return doc({doc_ref:null,lines:[row(1,{quantity_received:'0',quantity_billed:'9',unit_price:'3'})],ocr:{status:'done'}});}});
await h.select('เลขที่บิล','');await h.click('แก้');await h.select('แก้จำนวนหลังเปิดบิล ผัก 1','0');assert.equal(btn(h,'อ่านบิลด้วย AI (คงจำนวนนับ)').props.disabled,true);
await h.click('รับ 0 กก. · แจ้งร้านขาด 2 กก.');await h.click('อ่านบิลด้วย AI (คงจำนวนนับ)');assert.equal(submitted.doc_ref,null);assert.equal(submitted.lines[0].quantity_received,'0.00');assert.match(text(h),/แก้หลังเปิดบิล: รับ 0/);
});

// Original tests/receiving-reading-ui.test.mjs:88
test("PORT 039: OCR: cancel returns to bill, retains one in-flight request, then displays its late result", async () => {
const gate=deferred();let reads=0;const h=await open(doc({images:[{id:2,page_no:1}]}),{ocr:()=>{reads++;return gate.promise;}});const {promise}=await start(h,'อ่านบิลด้วย AI (คงจำนวนนับ)');
await h.click('ยกเลิก');assert.match(text(h),/กำลังอ่านบิลต่อ/);assert.equal(reads,1);assert.equal(btn(h,'อ่านบิลด้วย AI (คงจำนวนนับ)').props.disabled,true);
gate.resolve(doc({doc_ref:'LATE',ocr:{status:'done'},lines:[row(1,{bill_text:'ผลช้า'})]}));await promise;await h.settle();assert.match(text(h),/ผลช้า/);assert.equal(field(h,'เลขที่บิล').props.value,'LATE');assert.equal(reads,1);
});

// Original tests/receiving-reading-ui.test.mjs:100
test("PORT 040: OCR: failure after cancel shows error, permits retry and never claims success", async () => {
const gate=deferred();let calls=0;const h=await open(doc({images:[{id:2,page_no:1}]}),{ocr:()=>{calls++;return gate.promise;}});const {promise}=await start(h,'อ่านบิลด้วย AI (คงจำนวนนับ)');await h.click('ยกเลิก');
gate.reject({response:{status:422,data:{code:'VALIDATION_FAILED'}}});await promise;await h.settle();assert.match(text(h),/ข้อมูลยังไม่ถูกต้อง/);assert.doesNotMatch(text(h),/รับของเรียบร้อย/);
assert.equal(btn(h,'อ่านบิลด้วย AI (คงจำนวนนับ)').props.disabled,false);assert.equal(calls,1);
});

// Original tests/receiving-reading-ui.test.mjs:108
test("PORT 041: OCR: auto upload shows acknowledged captured bill immediately, then awaits the mock provider", async () => {
const gate=deferred();let reads=0;const uploads=[],previews=[];let saved=doc();const h=await open(saved,{image:async(...args)=>{previews.push(args);return new Blob(['bill']);},uploadImage:async(...args)=>{uploads.push(args);saved=doc({images:[{id:9,page_no:1}]});},get:async()=>saved,ocr:()=>{reads++;return gate.promise;}});await h.click('ดู / เพิ่มรูปบิล');await chooseFile(h);
const preview=h.find(n=>n.type==='img' && n.props.alt==='ภาพบิลหน้าแรกที่กำลังอ่าน');assert.ok(preview.props.src.startsWith('blob:'));assert.equal(reads,1);assert.deepEqual(uploads,[[5,1,'data:image/jpeg;base64,c3ludGhldGlj']]);assert.ok(previews.every(args=>args[0]===5 && args[1]===9));assert.ok(previews.length>0);
assert.equal(saved.images.length,1);assert.doesNotMatch(text(h),/รับของเรียบร้อย/);gate.resolve(doc({ocr:{status:'done'}}));await h.settle();
});

// Original tests/receiving-reading-ui.test.mjs:119
test("PORT 042: OCR: reopened pending document polls only reads and adopts the later server result", async () => {
const timers=clock();let gets=0,paid=0;const h=await open(doc({ocr:{status:'pending'}}),{get:async()=>{gets++;return gets===1?doc({ocr:{status:'pending'}}):doc({ocr:{status:'done'},doc_ref:'POLLED'});},ocr:async()=>{paid++;}}, {},timers.runtime);
await timers.tick(3000);await h.settle();await timers.tick(3000);await h.settle();assert.equal(gets,2);assert.equal(paid,0);assert.equal(field(h,'เลขที่บิล').props.value,'POLLED');h.unmount();assert.equal(timers.timeouts.size,0);
});

// Original tests/receiving-reading-ui.test.mjs:142
test("PORT 043: bill viewer: review gallery and nested zoom each consume Back without leaving the document", async () => {
let left=0;const browser=historyBrowser();const h=await open(doc({images:[{id:2,page_no:1}]}),{image:async()=>new Blob(['bill'])},{onBack:()=>left++},{},browser);
await h.click('ดู / เพิ่มรูปบิล');await h.click('เปิดรูปหน้า 1');await h.click('ขยาย');assert.match(text(h),/150%/);browser.history.back();await h.settle();
assert.equal(left,0);assert.equal(h.visible().filter(n=>n.type==='dialog').length,0);assert.equal(browser.history.state.router,'keep');await h.click('เปิดรูปหน้า 1');await h.click('ปิด');assert.equal(left,0);assert.equal(browser.backs,2);
});

// Original tests/receiving-reading-ui.test.mjs:153
test("PORT 044: OCR: repeated taps while cancelled never start a second paid request", async () => {
const gate=deferred();let paid=0;const h=await open(doc({images:[{id:2,page_no:1}]}),{ocr:()=>{paid++;return gate.promise;}});const stale=btn(h,'อ่านบิลด้วย AI (คงจำนวนนับ)');const {promise}=await start(h,'อ่านบิลด้วย AI (คงจำนวนนับ)');await h.click('ยกเลิก');
await stale.props.onClick();await stale.props.onClick();assert.equal(paid,1);gate.resolve(doc({ocr:{status:'done'}}));await promise;await h.settle();assert.equal(paid,1);
});

// Original tests/receiving-redesign.test.mjs:128
test("PORT 050: redesign capture: selected preview changes page, add page remains explicit, OCR starts only after every upload is acknowledged", async () => {
let uploads=0;const h=await open(doc({images:[{id:2,page_no:1},{id:3,page_no:2}]}),{image:async()=>new Blob(['bill']),uploadImage:async()=>{uploads++;throw {request:{}};}});
await h.click('ดู / เพิ่มรูปบิล');await h.click('ดูหน้า 2');assert.equal(h.find(n=>n.props.className==='rc-page-thumbnail' && n.props['data-selected']).props['data-selected'],true);
await chooseFile(h);await h.settle();assert.equal(uploads,1);assert.equal(h.calls.filter(c=>c[0]==='ocr').length,0);assert.match(text(h),/รอส่ง 1 หน้า/);
});

// Original tests/receiving-redesign.test.mjs:148
test("PORT 051: redesign capture: ambiguous OCR after upload requires checking latest result and never resends automatically", async () => {
let paid=0;const h=await open(doc({images:[{id:2,page_no:1}]}),{ocr:async()=>{paid++;throw {request:{}};},get:async()=>doc({images:[{id:2,page_no:1}],ocr:{status:'done'}})});
await h.click('อ่านบิลด้วย AI (คงจำนวนนับ)');assert.equal(btn(h,'อ่านบิลด้วย AI (คงจำนวนนับ)').props.disabled,true);await h.click('ตรวจผลล่าสุด');assert.equal(paid,1);assert.equal(btn(h,'อ่านบิลด้วย AI (คงจำนวนนับ)').props.disabled,false);
});

// Original tests/receiving-review-v2.test.mjs:81
test("PORT 064: review v2: full-screen authenticated bill view zooms without navigation and closes to review", async () => {
const reads=[];const h=await open(doc({images:[{id:9,page_no:1}]}),{image:async(...args)=>{reads.push(args);return new Blob(['bill']);}});await h.click('ดู / เพิ่มรูปบิล');await h.click('เปิดรูปหน้า 1');await h.click('ขยาย');
assert.match(text(h),/150%/);assert.ok(reads.every(args=>args[0]===5 && args[1]===9));assert.ok(!h.visible().some(n=>n.type==='a'));await h.click('ปิด');await h.click('กลับเทียบบิล');assert.match(text(h),/ดิบ 1/);
});

// Original tests/receiving-ui.test.mjs:69
test("PORT 071: UI: camera selection and failed upload retain identical page number on retry before OCR", async () => {
let fail=true;const uploads=[];const h=await open(doc(),{uploadImage:async(...args)=>{uploads.push(args);if(fail)throw {request:{}};}});await h.click('ดู / เพิ่มรูปบิล');await chooseFile(h);await h.click('กลับเทียบบิล');
assert.match(text(h),/การเชื่อมต่อ/);fail=false;await h.click('กลับเทียบบิล');assert.deepEqual(uploads[0],uploads[1]);assert.equal(uploads[0][1],1);assert.equal(h.calls.filter(c=>c[0]==='ocr').length,0);
});

// Original tests/receiving-ui.test.mjs:98
test("PORT 073: UI: injected native camera feeds ImagePages, prevents file chooser and locks duplicate taps", async () => {
const gate=deferred();let captures=0,prevented=0;const h=await open(doc(),{}, {}, {}, {},()=>{captures++;return gate.promise;});await h.click('ดู / เพิ่มรูปบิล');
const input=h.find(n=>n.type==='input' && n.props.type==='file');input.props.onClick({preventDefault(){prevented++;}});input.props.onClick({preventDefault(){prevented++;}});
assert.equal(captures,1);assert.equal(prevented,2);gate.resolve(fakeFile());await h.settle();assert.deepEqual(h.calls.find(c=>c[0]==='upload'),['upload',5,1,'data:image/jpeg;base64,c3ludGhldGlj']);
});

// Original tests/receiving-ui.test.mjs:116
test("PORT 074: UI: native cancellation and permission errors release processing without adding pages", async () => {
for(const fails of [false,true]){const h=await open(doc(),{}, {}, {}, {},async()=>{if(fails)throw Error('กรุณาอนุญาตใช้กล้อง');return null;});await h.click('ดู / เพิ่มรูปบิล');h.find(n=>n.type==='input' && n.props.type==='file').props.onClick({preventDefault(){}});await h.settle();
assert.equal(h.calls.filter(c=>c[0]==='upload').length,0);assert.equal(btn(h,'ถ่าย / เพิ่มรูปบิล').props.disabled,false);assert.equal(/กรุณาอนุญาตใช้กล้อง/.test(text(h)),fails);assert.match(text(h),/0\/10 หน้า/);}
});

// Original tests/receiving-ui.test.mjs:131
test("PORT 075: UI: ML Kit scanner cancellation returns null and returns cleanly to action screen without error", async () => {
let captures=0;const dirty=[];const h=await open(doc({counted_complete_at:null}),{}, {onDirtyChange:v=>dirty.push(v)}, {}, {},async()=>{captures++;return null;});
h.find(n=>n.type==='input' && n.props.type==='file').props.onClick({preventDefault(){}});await h.settle();assert.equal(captures,1);assert.equal(h.all().find(n=>n.props['data-step']).props['data-step'],'images');
assert.equal(h.calls.length,0);assert.ok(!h.visible().some(n=>n.props.role==='alert'));assert.equal(btn(h,'ถ่าย / เพิ่มรูปบิล').props.disabled,false);assert.equal(dirty.at(-1),false);
});

test('A pending OCR: reopened poll locks paid requests and editable values until a read-only terminal result', async () => {
  const timers=clock(); let paid=0, gets=0;
  const h=await open(doc({images:[{id:2,page_no:1}],ocr:{status:'pending'}}), {
    ocr:async()=>{paid++;}, get:async()=>{gets++; if(gets===1)throw {request:{}};return doc({images:[{id:2,page_no:1}],ocr:{status:'done'}});},
  },{},timers.runtime);
  assert.equal(btn(h,'อ่านบิลด้วย AI (คงจำนวนนับ)').props.disabled,true);
  assert.equal(field(h,'เลขที่บิล').props.disabled,true);
  await btn(h,'อ่านบิลด้วย AI (คงจำนวนนับ)').props.onClick(); assert.equal(paid,0);
  await timers.tick(3000); await h.settle(); assert.equal(btn(h,'อ่านบิลด้วย AI (คงจำนวนนับ)').props.disabled,true);
  await timers.tick(3000); await h.settle(); assert.equal(gets,2); assert.equal(paid,0); assert.equal(field(h,'เลขที่บิล').props.disabled,false);
});

test('A OCR cleanup: a late polling response after unmount never adopts data or starts another timer', async () => {
  const timers=clock(),gate=deferred(),changed=[];
  const h=await open(doc({ocr:{status:'pending'}}),{get:()=>gate.promise},{onChanged:v=>changed.push(v)},timers.runtime);
  const pending=timers.tick(3000); h.unmount(); gate.resolve(doc({ocr:{status:'done'}})); await pending;
  assert.equal(changed.length,0); assert.equal(timers.timeouts.size,0);
});
