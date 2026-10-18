import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { harness, row, doc, signed, text, btn, field, deferred, track, cleanup, open, sign, draw, start, clock, group } from './review-a-port-harness.mjs';
afterEach(cleanup);

// Original tests/receiving-device-r3.test.mjs:81
test("PORT 005: device r3: entire document card opens each status directly, with no document radio or second open action", async () => {
for(const status of ['draft','confirmed','void']){const initial=doc({status});let gets=0;const h=track(await harness('Receiving',{}, {list:async()=>[initial],get:async()=>{gets++;return initial;}}));await h.radio('documents');
await h.click(`เปิดเอกสาร #5 ร้าน 1 ${{draft:'ร่าง',confirmed:'ยืนยันแล้ว',void:'ยกเลิก'}[status]}`);assert.equal(gets,1);assert.match(text(h),/ใบรับ #5/);assert.ok(!h.visible().some(n=>n.type==='input' && n.props.type==='radio' && n.props.name==='document'));}
});

// Original tests/receiving-device-r3.test.mjs:109
test("PORT 006: device r3: checks count distinct items, sort warnings by line and focus the selected item", async () => {
const h=await open(doc({lines:Array.from({length:10},(_,i)=>row(i+1,{review_decision:i<8?'accept':null})),warnings:[{code:'LOW_CONFIDENCE',line_no:9},{code:'LOW_CONFIDENCE',line_no:9},{code:'PRICE_CHANGE',line_no:10}]}));
assert.match(text(h),/ตัดสินใจแล้ว 8\/10/);assert.equal(h.visible().filter(n=>n.props.id?.startsWith('review-row-')).length,2);await h.select('ค้นหาสินค้า / ชื่อในบิล','ดิบ 10');await h.click('ตรวจเรื่องถัดไป');assert.deepEqual(h.scrolled,['review-row-9']);assert.equal(h.focused.length,0);
});

// Original tests/receiving-device-r3.test.mjs:128
test("PORT 007: device r3: bill-only warnings have a bill label and zero item warnings", async () => {
const h=await open(doc({warnings:[{code:'DUPLICATE_BILL'}]}));assert.match(h.text(h.find(n=>n.props['aria-label']==='ข้อสังเกตบิล')),/ข้อสังเกตบิล.*อาจเป็นบิลซ้ำ/);
assert.doesNotMatch(h.text(h.find(n=>n.props.id==='review-row-1')),/อาจเป็นบิลซ้ำ/);assert.match(text(h),/ตัดสินใจแล้ว 0\/1/);assert.equal(h.calls.length,0);
});

// Original tests/receiving-device-r4.test.mjs:90
test("PORT 014: device r4: seven pending decisions share one count across filter and both CTAs; warnings and variance do not inflate it", async () => {
const h=await open(doc({lines:Array.from({length:10},(_,i)=>row(i+1,{review_decision:i<3?'accept':null,quantity_received:i%2?'1':'3'})),warnings:[{code:'LOW_CONFIDENCE',line_no:4},{code:'LOW_CONFIDENCE',line_no:4}]}));
assert.match(text(h),/ตัดสินใจแล้ว 3\/10/);assert.match(text(h),/ต้องตัดสินใจ \(7\)/);assert.match(text(h),/เหลือ 7 รายการ/);assert.equal(btn(h,'ดูสรุปก่อนเซ็น').props.disabled,true);assert.equal(h.visible().filter(n=>n.props.id?.startsWith('review-row-')).length,7);
});

// Original tests/receiving-device-r4.test.mjs:122
test("PORT 016: device r4: save removes a reviewed row even with warnings, undo restores it, and shortages/overages stay separate", async () => {
const h=await open(doc({lines:Array.from({length:8},(_,i)=>row(i+1,{review_decision:i?'accept':null,quantity_received:i?'3':'1'})),warnings:[{code:'LOW_CONFIDENCE',line_no:1}]}));
await h.click('รับ 1 และแจ้งขาด');assert.equal(h.visible().filter(n=>n.props.id?.startsWith('review-row-')).length,0);await h.click('ทั้งหมด');
const saved=h.calls[0][2].lines;assert.equal(saved[0].review_decision,'short');assert.equal(saved[1].quantity_received,'3.00');await h.click('เลิกทำการตัดสินใจ');await h.click('ต้องตัดสินใจ (1)');assert.ok(h.find(n=>n.props.id==='review-row-1'));
});

// Original tests/receiving-device-r4.test.mjs:135
test("PORT 017: device r4: quantities and unmapped products guide to the exact field without the error illustration", async () => {
const h=await open(doc({lines:[row(1,{product_id:null,quantity_received:''})]}));await h.click('แก้ข้อมูลหลังเปิดบิล');assert.equal(field(h,'แก้จำนวนหลังเปิดบิล ผัก 1').props['aria-invalid'],true);
assert.match(text(h),/กรอกจำนวนรับจริง/);assert.ok(field(h,'ค้นหาสินค้า'));assert.ok(!h.visible().some(n=>/error/.test(n.props.src||'')));assert.equal(btn(h,'ตรวจข้อมูลก่อนรับ').props.disabled,true);
});

// Original tests/receiving-device-r4.test.mjs:148
test("PORT 018: device r4: empty document CTA creates an editable row instead of reporting an error", async () => {
const timers=clock();const h=await open(doc({lines:[]}),{getProducts:async()=>({data:[{id:99,name:'เพิ่มใหม่',unit_name:'กก.'}]})},{},timers.runtime);await h.click('เพิ่มรายการหลังเปิดบิล');await h.select('ค้นหาสินค้า','เพิ่ม');await timers.tick(350);await h.settle();await h.click('เพิ่มใหม่');
assert.match(text(h),/รายการเพิ่มหลังเปิดบิล/);await h.click('แก้ข้อมูลหลังเปิดบิล');assert.equal(field(h,'แก้จำนวนหลังเปิดบิล เพิ่มใหม่').props.value,'');assert.equal(h.calls.length,0);
});

// Original tests/receiving-device-r4.test.mjs:155
test("PORT 019: device r4: validation responses use neutral review feedback while server faults retain retry error feedback", async () => {
for(const status of [422,500]){const h=await open(doc(),{update:async()=>{throw {response:{status,data:{code:status===422?'VALIDATION_FAILED':undefined}}};}});await h.click('ยืนยันรับ 2');
const toast=h.find(n=>n.props.className?.includes('sg-toast'));assert.equal(toast.props['data-status'],status===422?'review':'error');assert.match(text(h),/ตัดสินใจแล้ว 0\/1/);assert.doesNotMatch(text(h),/รับของเรียบร้อย/);}
});

// Original tests/receiving-device-ux.test.mjs:53
test("PORT 021: device UX: edits report dirty, save stays protected in flight, success clears both guards", async () => {
const gate=deferred(),dirty=[];const h=await open(doc(),{update:()=>gate.promise},{onDirtyChange:v=>dirty.push(v)});await h.click('แก้ข้อมูลหลังเปิดบิล');await h.select('แก้จำนวนหลังเปิดบิล ผัก 1','1.5');assert.equal(dirty.at(-1),true);
const {promise}=await start(h,'รับ 1.5 และแจ้งขาด');assert.equal(dirty.at(-1),true);assert.ok(h.events.get('beforeunload').size);gate.resolve(doc({lines:[row(1,{quantity_received:'1.5',review_decision:'short'})]}));await promise;await h.settle();assert.equal(dirty.at(-1),false);assert.equal(h.events.get('beforeunload').size,0);
});

// Original tests/receiving-device-ux.test.mjs:69
test("PORT 022: device UX: failed save preserves dirty and unmount resets shell callback and unload listener", async () => {
const dirty=[];const h=await open(doc(),{update:async()=>{throw {request:{}};}},{onDirtyChange:v=>dirty.push(v)});await h.select('เลขที่บิล','KEEP');await h.click('บันทึกหัวบิล');
assert.equal(field(h,'เลขที่บิล').props.value,'KEEP');assert.equal(dirty.at(-1),true);assert.ok(h.events.get('beforeunload').size);h.unmount();assert.equal(dirty.at(-1),false);assert.equal(h.events.get('beforeunload').size,0);
});

// Original tests/receiving-r2.test.mjs:17
test("PORT 032: r2: apply is local; failed API save retains values and unsaved state; only success clears it", async () => {
let fail=true;const dirty=[];const h=await open(doc(),{update:async(id,body)=>{if(fail)throw {response:{status:500}};return doc({lines:body.lines});}},{onDirtyChange:v=>dirty.push(v)});await h.click('แก้ข้อมูลหลังเปิดบิล');await h.select('แก้จำนวนหลังเปิดบิล ผัก 1','1.25');assert.equal(h.calls.length,0);
await h.click('รับ 1.25 และแจ้งขาด');assert.equal(dirty.at(-1),true);assert.equal(field(h,'แก้จำนวนหลังเปิดบิล ผัก 1').props.value,'1.25');assert.match(text(h),/ตัดสินใจแล้ว 0\/1/);fail=false;await h.click('รับ 1.25 และแจ้งขาด');assert.equal(dirty.at(-1),false);assert.match(text(h),/ตัดสินใจแล้ว 1\/1/);
});

// Original tests/receiving-r2.test.mjs:33
test("PORT 033: r2: field validation selects the first invalid row, opens price details and focuses the field", async () => {
const h=await open(doc({lines:[row(1,{unit_price:'-1'})]}));await h.click('แก้ข้อมูลหลังเปิดบิล');const input=field(h,'ราคาบิล ผัก 1');assert.equal(input.props['aria-invalid'],true);assert.ok(input.props['aria-describedby']);assert.match(text(h),/กรอกตัวเลขตั้งแต่ 0/);
assert.equal(btn(h,'ตรวจข้อมูลก่อนรับ').props.disabled,true);assert.equal(h.calls.length,0);
});

// Original tests/receiving-r2.test.mjs:47
test("PORT 034: r2: bill header validation stays open with inline error and focus until corrected", async () => {
const h=await open(doc());await h.select('ส่วนลด','999');await h.click('บันทึกหัวบิล');assert.match(text(h),/ส่วนลดมากกว่ายอดรวม/);assert.equal(field(h,'ส่วนลด').props['aria-invalid'],true);assert.deepEqual(h.focused,['header-discount']);assert.equal(h.calls.length,0);
await h.select('ส่วนลด','1');await h.click('บันทึกหัวบิล');assert.equal(h.calls[0][2].discount,'1.00');assert.equal(field(h,'ส่วนลด').props['aria-invalid'],undefined);
});

// Original tests/receiving-r2.test.mjs:129
test("PORT 037: r2: drafts can save an unmatched product, but review focuses the product before confirmation", async () => {
const h=await open(doc({lines:[row(1,{product_id:null})]}));await h.select('เลขที่บิล','DRAFT');await h.click('บันทึกหัวบิล');assert.equal(h.calls[0][2].lines[0].product_id,null);
assert.ok(field(h,'ค้นหาสินค้า'));assert.equal(btn(h,'ยืนยันสินค้าที่เลือกและรับ').props.disabled,true);assert.equal(btn(h,'ดูสรุปก่อนเซ็น').props.disabled,true);assert.equal(h.calls.filter(c=>c[0]==='confirm').length,0);
});

// Original tests/receiving-r2.test.mjs:167
test("PORT 038: r2: excessive discount points to the header field instead of enabling confirm", async () => {
const h=await open(signed());await h.select('ส่วนลด','1000');assert.equal(btn(h,'ดูสรุปก่อนเซ็น').props.disabled,true);await h.click('บันทึกหัวบิล');
assert.match(text(h),/ส่วนลดมากกว่ายอดรวม/);assert.deepEqual(h.focused,['header-discount']);assert.equal(h.calls.length,0);assert.equal(btn(h,'เซ็นรับ').props.disabled,true);
});

// Original tests/receiving-redesign.test.mjs:72
test("PORT 047: redesign warning: inspect is read only; risky AI requires a separate explicit decision after reasons are visible", async () => {
const h=await open(doc({lines:[row(1,{match:{source:'ai',confidence:0.2}})],warnings:[{code:'LOW_CONFIDENCE',line_no:1}]}));await h.click('แก้ข้อมูลหลังเปิดบิล');assert.equal(h.calls.length,0);assert.match(text(h),/อ่านบิลได้ไม่ชัด/);assert.equal(btn(h,'ดูสรุปก่อนเซ็น').props.disabled,true);
await h.click('ยืนยันสินค้าที่เลือกและรับ');const saved=h.calls[0][2].lines[0];assert.equal(saved.match.source,'manual');assert.equal(saved.quantity_received,'2.00');
});

// Original tests/receiving-review-layout.test.mjs:42
test("PORT 054: review layout: 56 actual component rows remain compact, with no per-row forms or repeated warning paragraphs", async () => {
const h=await open(doc({lines:Array.from({length:56},(_,i)=>row(i+1))}));assert.equal(h.visible().filter(n=>n.props.id?.startsWith('review-row-')).length,56);
assert.equal(h.visible().filter(n=>n.type==='input' && n.props.inputMode==='decimal').length,4);assert.equal(h.visible().filter(n=>n.type==='canvas').length,0);
for(const card of h.visible().filter(n=>n.props.id?.startsWith('review-row-'))){assert.equal(h.all(card).filter(n=>n.type==='input' && n.props.inputMode==='decimal').length,0);assert.equal(h.all(card).filter(n=>n.props.className==='ra-bill-text').length,1);}
await h.click('แก้ข้อมูลหลังเปิดบิล');assert.equal(h.visible().filter(n=>n.type==='input' && n.props.inputMode==='decimal').length,7);assert.equal(h.calls.length,0);
});

// Original tests/receiving-review-state.test.mjs:114
test("PORT 055: review UI: starts with unselected needs filter; opening edit/cancel does not advance; save does", async () => {
const h=await open(doc({lines:Array.from({length:8},(_,i)=>row(i+1))}));assert.equal(btn(h,'ต้องตัดสินใจ (8)').props['aria-pressed'],true);await h.click('แก้ข้อมูลหลังเปิดบิล');await h.click('ปิดช่องแก้ไข');assert.equal(h.calls.length,0);assert.match(text(h),/ตัดสินใจแล้ว 0\/8/);
await h.click('ยืนยันรับ 2');assert.equal(h.visible().filter(n=>n.props.id?.startsWith('review-row-')).length,7);assert.match(text(h),/ตัดสินใจแล้ว 1\/8/);
});

// Original tests/receiving-review-state.test.mjs:141
test("PORT 057: review UI: malformed inline input is rejected with guidance; a valid edit can save or cancel", async () => {
const h=await open(doc());await h.click('แก้ข้อมูลหลังเปิดบิล');await h.select('แก้จำนวนหลังเปิดบิล ผัก 1','1.5');await h.select('แก้จำนวนหลังเปิดบิล ผัก 1','20-');
assert.equal(field(h,'แก้จำนวนหลังเปิดบิล ผัก 1').props.value,'1.5');assert.equal(field(h,'แก้จำนวนหลังเปิดบิล ผัก 1').props['aria-invalid'],true);assert.equal(h.calls.length,0);await h.select('แก้จำนวนหลังเปิดบิล ผัก 1','1.25');await h.click('รับ 1.25 และแจ้งขาด');assert.equal(h.calls[0][2].lines[0].quantity_received,'1.25');
});

// Original tests/receiving-review-state.test.mjs:153
test("PORT 058: review UI: accepted rows leave needs filter immediately; no automatic decision or second next tap", async () => {
const h=await open(doc({lines:Array.from({length:8},(_,i)=>row(i+1))}));await h.click('ยืนยันรับ 2');assert.match(text(h),/ตัดสินใจแล้ว 1\/8/);assert.ok(!h.visible().some(n=>n.props.id==='review-row-1'));
assert.ok(h.find(n=>n.props.id==='review-row-2'));assert.equal(h.calls.length,1);assert.equal(h.calls[0][2].lines[1].review_decision,null);
});

// Original tests/receiving-review-v2.test.mjs:19
test("PORT 059: review v2: cards separate raw bill, product provenance, billed numbers and ordered/received values", async () => {
const h=await open(doc({lines:[row(1,{bill_text:'ดิบจากบิล',quantity_received:'1.25',counted_quantity:'1.25',quantity_billed:'1.5',quantity_ordered:'2'})]}));const card=h.find(n=>n.props.id==='review-row-1');
assert.match(h.text(card),/นับได้1.25.*บิล1.5.*สั่ง2/);assert.match(h.text(card),/ในบิลเขียน ดิบจากบิล → ผัก 1/);assert.match(h.text(card),/ขาด/);assert.equal(h.calls.length,0);
});

// Original tests/receiving-review-v2.test.mjs:32
test("PORT 060: review v2: AI suggestion never silently advances; explicit accept clears pending and undo restores it", async () => {
const h=await open(doc({lines:[row(1,{match:{source:'ai'}})]}));assert.match(text(h),/ตัดสินใจแล้ว 0\/1/);await h.click('ยืนยันสินค้าที่เลือกและรับ');assert.match(text(h),/ตัดสินใจแล้ว 1\/1/);
await h.click('เลิกทำการตัดสินใจ');assert.match(text(h),/ตัดสินใจแล้ว 0\/1/);assert.equal(h.calls.at(-1)[2].lines[0].review_decision,null);assert.equal(h.calls.at(-1)[2].lines[0].quantity_received,'2.00');
});

// Original tests/receiving-review-v2.test.mjs:42
test("PORT 061: review v2: one-tap picker orders first, asks remember by default, cancel changes nothing; undo restores whole row", async () => {
const timers=clock();const h=await open(doc(),{getProducts:async()=>({data:[{id:99,name:'ใหม่',unit_name:'กก.'}]})},{},timers.runtime);await h.click('แก้ข้อมูลหลังเปิดบิล');const choices=h.find(n=>n.props.className==='rc-search-results');assert.match(h.text(choices),/รายการที่สั่งผัก 1/);assert.equal(h.all(choices).filter(n=>n.type==='button').length,1);await h.select('ค้นหาสินค้า','ไม่เลือก');await h.click('ปิดช่องแก้ไข');assert.equal(h.calls.length,0);assert.match(text(h),/ดิบ 1 → ผัก 1/);
await h.click('แก้ข้อมูลหลังเปิดบิล');await h.select('ค้นหาสินค้า','ใหม่');await timers.tick(350);await h.settle();await h.click('ใหม่');assert.equal(h.find(n=>n.type==='input' && n.props.type==='checkbox').props.checked,false);
await h.click('ยืนยันรับ 2');assert.equal(h.calls[0][2].lines[0].remember_alias,false);assert.equal(h.calls[0][2].lines[0].bill_text,'ดิบ 1');
});

// Original tests/receiving-review-v2.test.mjs:59
test("PORT 062: review v2: search whole catalog clears unrelated order link and keeps raw text and decimals", async () => {
const timers=clock();let query;const h=await open(doc({lines:[row(1,{quantity_received:'1.25',counted_quantity:'1.25',quantity_billed:'2.5',amount:'25.00'})]}),{getProducts:async params=>{query=params;return {data:[{id:99,name:'ทั้งแคตตาล็อก',unit_name:'กก.'}]};}},{},timers.runtime);
await h.click('แก้ข้อมูลหลังเปิดบิล');await h.select('ค้นหาสินค้า','ทั้งแคตตาล็อก');await timers.tick(350);await h.settle();await h.click('ทั้งแคตตาล็อก');await h.click('รับ 1.25 และแจ้งขาด');
const saved=h.calls[0][2].lines[0];assert.equal(query.search,'ทั้งแคตตาล็อก');assert.equal(saved.order_item_id,null);assert.equal(saved.bill_text,'ดิบ 1');assert.equal(saved.quantity_received,'1.25');assert.equal(saved.quantity_billed,'2.50');assert.equal(saved.amount,'25.00');
});

// Original tests/receiving-ui.test.mjs:43
test("PORT 069: UI: manual additions, header editing, deletion and courier signature remain reachable", async () => {
const timers=clock();const h=await open(doc(),{getProducts:async()=>({data:[{id:99,name:'เพิ่มเอง',unit_name:'กก.'}]})},{},timers.runtime);await h.click('เพิ่มรายการหลังเปิดบิล');await h.select('ค้นหาสินค้า','เพิ่มเอง');await timers.tick(350);await h.settle();await h.click('เพิ่มเอง');
await h.click('ลบรายการเพิ่ม เพิ่มเอง');assert.match(text(h),/ตัดสินใจแล้ว 0\/1/);await h.select('เลขที่บิล','BILL-EDIT');await h.select('วันที่ในบิล','2026-10-18');await h.click('บันทึกหัวบิล');assert.equal(h.calls[0][2].doc_ref,'BILL-EDIT');assert.equal(h.calls[0][2].doc_date,'2026-10-18');
await h.click('ยืนยันรับ 2');await sign(h);await h.select('ชื่อผู้ส่งของ','คนส่ง');await h.click('บันทึกชื่อผู้ส่ง');await draw(h,1);const courier=h.find(n=>n.props.className==='rc-signature rc-stack' && /ผู้ส่งของ \(ไม่บังคับ\)/.test(h.text(n)));await h.all(courier).find(n=>n.type==='button' && h.text(n)==='บันทึกเซ็น').props.onClick();await h.settle();assert.equal(h.calls.at(-1)[2],'courier');assert.equal(h.calls.at(-1)[4],'คนส่ง');
});

// Original tests/receiving-ui.test.mjs:84
test("PORT 072: UI: corrected quantities clear stale quantity warnings and invalid input turns red", async () => {
const h=await open(doc({warnings:[{code:'QTY_SHORT',line_no:1}],lines:[row(1,{quantity_received:'1'})]}));await h.click('แก้ข้อมูลหลังเปิดบิล');await h.select('แก้จำนวนหลังเปิดบิล ผัก 1','2');
assert.equal(h.find(n=>n.props.id==='review-row-1').props['data-status'],'accept');assert.doesNotMatch(text(h),/รับของน้อยกว่าที่สั่ง/);await h.select('แก้จำนวนหลังเปิดบิล ผัก 1','');assert.equal(field(h,'แก้จำนวนหลังเปิดบิล ผัก 1').props['aria-invalid'],true);assert.equal(h.calls.length,0);
});

// Original tests/receiving-ux-060.test.mjs:21
test("PORT 078: UX060 #1: focus alone leaves CTA available; changing creates an actionable edit, save advances focus without accepting the next row", async () => {
const h=await open(doc());await h.click('แก้ข้อมูลหลังเปิดบิล');field(h,'แก้จำนวนหลังเปิดบิล ผัก 1').props.onFocus();await h.settle();assert.equal(h.calls.length,0);assert.equal(btn(h,'ยืนยันรับ 2').props.disabled,false);
await h.select('แก้จำนวนหลังเปิดบิล ผัก 1','1.5');await h.click('รับ 1.5 และแจ้งขาด');assert.equal(h.calls.length,1);assert.equal(h.calls[0][2].lines[0].quantity_received,'1.50');
});

// Original tests/receiving-ux-060.test.mjs:35
test("PORT 079: UX060 #1: switching rows with invalid input explains the field and returns focus; cancel preserves original quantities", async () => {
const h=await open(doc({lines:[row(),row(2)]}));await h.click('แก้ข้อมูลหลังเปิดบิล');await h.select('แก้จำนวนหลังเปิดบิล ผัก 1','');await h.click('ปิดช่องแก้ไข');await h.click('แก้ข้อมูลหลังเปิดบิล');
assert.equal(field(h,'แก้จำนวนหลังเปิดบิล ผัก 1').props.value,'');assert.match(text(h),/กรอกจำนวนรับจริง/);assert.equal(h.calls.length,0);await h.click('กลับคิว');assert.match(text(h),/มีข้อมูลที่ยังไม่ส่ง/);await h.click('ทำต่อใบเดิม');assert.equal(field(h,'แก้จำนวนหลังเปิดบิล ผัก 1').props.value,'');
});

// Original tests/receiving-ux-060.test.mjs:45
test("PORT 080: UX060 #1: invalid empty quantity keeps enabled save CTA and focuses the field with a reason", async () => {
const h=await open(doc());await h.click('แก้ข้อมูลหลังเปิดบิล');await h.select('แก้จำนวนหลังเปิดบิล ผัก 1','');assert.match(text(h),/กรอกจำนวนรับจริง/);assert.equal(field(h,'แก้จำนวนหลังเปิดบิล ผัก 1').props['aria-invalid'],true);assert.equal(btn(h,'ตรวจข้อมูลก่อนรับ').props.disabled,true);
await h.select('แก้จำนวนหลังเปิดบิล ผัก 1','0');assert.equal(btn(h,'รับ 0 และแจ้งขาด').props.disabled,false);assert.equal(h.calls.length,0);
});

// Original tests/receiving-ux-060.test.mjs:62
test("PORT 081: UX060 #2: warning badge/details/confirm share counts, deduplicate a product warning and name both products", async () => {
const h=await open(doc({lines:[row(),row(2)],warnings:[{code:'LOW_CONFIDENCE',line_no:1},{code:'LOW_CONFIDENCE',line_no:1},{code:'PRICE_CHANGE',line_no:2}]}));
assert.match(text(h),/ตัดสินใจแล้ว 0\/2/);assert.match(h.text(h.find(n=>n.props.id==='review-row-1')),/อ่านบิลได้ไม่ชัด/);assert.equal(h.text(h.find(n=>n.props.id==='review-row-1')).split('อ่านบิลได้ไม่ชัด').length-1,1);assert.match(h.text(h.find(n=>n.props.id==='review-row-2')),/ราคาเปลี่ยน/);
});

// Original tests/receiving-ux-060.test.mjs:87
test("PORT 083: UX060 #5/#13: sheet scrolls only its body and success reserves a fixed GlassBar plus full mobile width", async () => {
const css=await readFile(new URL('../src/pages/receiving/review-a.css',import.meta.url),'utf8');assert.match(css,/ra-footer\s*\{[^}]*position:fixed[^}]*safe-area-inset-bottom/s);assert.match(css,/ra-footer \.sg-primary[^}]*width:100%[^}]*min-height:56px/s);assert.match(css,/ra-document\s*\{[^}]*padding-bottom: calc\(180px/s);
const h=await open(signed({status:'confirmed'}));assert.match(text(h),/รับของเรียบร้อย/);assert.equal(h.visible().filter(n=>n.type==='button' && h.text(n)==='กลับหน้ารับสินค้า').length,1);
});

// Original tests/receiving-ux-060.test.mjs:121
test("PORT 085: UX060 #8/#11/#12: batch tools are disclosed, image count appears once and zero counters have no warning color", async () => {
const h=await open(doc({images:[{id:2,page_no:1}]}),{image:async()=>new Blob()});assert.ok(!h.visible().some(n=>n.type==='input' && n.props.type==='checkbox' && n.props['aria-label']==='เลือกแถว'));
assert.ok(!h.visible().some(n=>n.props['data-status']==='error'));await h.click('ดู / เพิ่มรูปบิล');assert.equal(text(h).split('1/10 หน้า').length-1,1);assert.equal(h.calls.filter(c=>c[0]==='update').length,0);
});

// Original tests/receiving-ux-060.test.mjs:134
test("PORT 086: UX060 #5: create/confirm actions are in a sibling footer outside the scrolling body", async () => {
const h=await open(doc());const root=h.find(n=>n.props.className==='ra-document rc-stack');const footer=h.all(root).find(n=>n.type==='footer');assert.ok(!h.all(root).some(n=>n!==root && ['section','div'].includes(n.type) && h.all(n).includes(footer))); assert.equal(h.all(footer).filter(n=>n.type==='button' && n.props.className?.includes('sg-primary')).length,1);h.budget();
});

// Original tests/receiving-ux-060.test.mjs:150
test("PORT 087: UX060 #10: full editor and header preserve accepted text when malformed text is rejected", async () => {
const h=await open(doc());await h.click('แก้ข้อมูลหลังเปิดบิล');await h.select('แก้จำนวนหลังเปิดบิล ผัก 1','20.5');await h.select('แก้จำนวนหลังเปิดบิล ผัก 1','20-');assert.equal(field(h,'แก้จำนวนหลังเปิดบิล ผัก 1').props.value,'20.5');
await h.select('ส่วนลด','1.25');await h.select('ส่วนลด','1-');assert.equal(field(h,'ส่วนลด').props.value,'1.25');assert.match(text(h),/ตัวเลข/);assert.equal(h.calls.length,0);
});

// Original tests/receiving-ux-061.test.mjs:114
test("PORT 093: UX061 #6: inline editing has one save/cancel location and compact AI hint", async () => {
const h=await open(doc({lines:[row(1,{match:{source:'ai'}})]}));await h.click('แก้ข้อมูลหลังเปิดบิล');assert.equal(h.visible().filter(n=>n.type==='input' && /แก้จำนวน/.test(h.text(h.all().find(l=>l.type==='label' && l.props.htmlFor===n.props.id)))).length,1);
assert.equal(h.visible().filter(n=>n.type==='button' && h.text(n)==='ยืนยันสินค้าที่เลือกและรับ').length,1);assert.ok(!h.visible().some(n=>n.type==='button' && /ใช้ AI/.test(h.text(n))));assert.equal(h.calls.length,0);
});

// Original tests/receiving-ux-062.test.mjs:53
test("PORT 097: UX062 #2: inline 20. stays neutral while focused, 20.5 types normally and blur normalizes 20.", async () => {
const h=await open(doc());await h.click('แก้ข้อมูลหลังเปิดบิล');field(h,'แก้จำนวนหลังเปิดบิล ผัก 1').props.onFocus();await h.select('แก้จำนวนหลังเปิดบิล ผัก 1','20.');assert.equal(field(h,'แก้จำนวนหลังเปิดบิล ผัก 1').props['aria-invalid'],undefined);
await h.select('แก้จำนวนหลังเปิดบิล ผัก 1','20.5');assert.equal(field(h,'แก้จำนวนหลังเปิดบิล ผัก 1').props.value,'20.5');await h.select('แก้จำนวนหลังเปิดบิล ผัก 1','20.');field(h,'แก้จำนวนหลังเปิดบิล ผัก 1').props.onBlur();await h.settle();assert.equal(field(h,'แก้จำนวนหลังเปิดบิล ผัก 1').props.value,'20');
});

// Original tests/receiving-ux-062.test.mjs:65
test("PORT 098: UX062 #2: full edit allows unfinished decimals, rejects 20- and normalizes blur", async () => {
const h=await open(doc());await h.select('ยอดบิล','20.');await h.select('ยอดบิล','20-');assert.equal(field(h,'ยอดบิล').props.value,'20.');assert.equal(field(h,'ยอดบิล').props['aria-invalid'],true);await h.select('ยอดบิล','20.5');await h.select('ยอดบิล','20.');field(h,'ยอดบิล').props.onBlur();await h.settle();assert.equal(field(h,'ยอดบิล').props.value,'20');await h.click('บันทึกหัวบิล');assert.equal(h.calls[0][2].total,'20.00');
});

// Original tests/receiving-ux-062.test.mjs:117
test("PORT 101: UX062 #5: pending zero replaces table header/list; all rows remain reachable, undo restores pending row", async () => {
const h=await open(doc({lines:Array.from({length:8},(_,i)=>row(i+1,{review_decision:'accept'}))}));assert.match(text(h),/ไม่มีรายการในตัวกรองนี้/);assert.equal(h.visible().filter(n=>n.props.id?.startsWith('review-row-')).length,0);await h.click('ทั้งหมด');assert.equal(h.visible().filter(n=>n.props.id?.startsWith('review-row-')).length,8);
await h.click('เลิกทำการตัดสินใจ');await h.click('ต้องตัดสินใจ (1)');assert.equal(h.visible().filter(n=>n.props.id?.startsWith('review-row-')).length,1);assert.equal(h.calls[0][2].lines[0].quantity_received,'2.00');
});

// Original tests/receiving-ux-a07-r2.test.mjs:35
test("PORT 119: A07 R2 #1/#3/#4/#6: card order, live delta, AI action and unchanged bill money share one group", async () => {
const h=await open(doc());await h.click('แก้ข้อมูลหลังเปิดบิล');await h.select('แก้จำนวนหลังเปิดบิล ผัก 1','1.5');const card=h.find(n=>n.props.id==='review-row-1');assert.equal(card.props['data-status'],'short');assert.match(h.text(card),/นับได้2.*บิล2.*สั่ง2/);assert.match(h.text(card),/แก้หลังเปิดบิล: รับ 1.5/);assert.equal(field(h,'ราคาบิล ผัก 1').props.value,'10');assert.equal(h.calls.length,0);
});

// Original tests/receiving-ux-a07-r2.test.mjs:63
test("PORT 121: A07 R2 #2: invalid draft stays visible with field reason, cannot be lost on row or picker change", async () => {
const h=await open(doc());await h.click('แก้ข้อมูลหลังเปิดบิล');await h.select('แก้จำนวนหลังเปิดบิล ผัก 1','');await h.select('ค้นหาสินค้า','ค้นหา');assert.equal(field(h,'แก้จำนวนหลังเปิดบิล ผัก 1').props.value,'');assert.match(text(h),/กรอกจำนวนรับจริง/);await h.click('ปิดช่องแก้ไข');await h.click('แก้ข้อมูลหลังเปิดบิล');assert.equal(field(h,'แก้จำนวนหลังเปิดบิล ผัก 1').props.value,'');assert.equal(h.calls.length,0);
});

// Original tests/receiving-ux-a07-r2.test.mjs:73
test("PORT 122: A07 R2 #2: current product picker and full edit preserve draft quantity, raw bill and exact billed amount", async () => {
const timers=clock();const h=await open(doc({lines:[row(1,{quantity_billed:'2.5',amount:'25.00'})]}),{getProducts:async()=>({data:[{id:77,name:'เลือกใหม่',unit_name:'กก.'}]})},{},timers.runtime);await h.click('แก้ข้อมูลหลังเปิดบิล');await h.select('แก้จำนวนหลังเปิดบิล ผัก 1','1.25');await h.select('ค้นหาสินค้า','เลือกใหม่');await timers.tick(350);await h.settle();await h.click('เลือกใหม่');assert.equal(field(h,'แก้จำนวนหลังเปิดบิล เลือกใหม่').props.value,'1.25');await h.click('รับ 1.25 และแจ้งขาด');const r=h.calls[0][2].lines[0];assert.equal(r.bill_text,'ดิบ 1');assert.equal(r.amount,'25.00');assert.equal(r.quantity_received,'1.25');
});

// Original tests/receiving-ux-a07-r2.test.mjs:104
test("PORT 123: A07 R2 #3: short, over, exact decimals and invalid values update next to the input immediately", async () => {
const h=await open(doc());await h.click('แก้ข้อมูลหลังเปิดบิล');for(const [value,status] of [['1.25','short'],['2.5','over'],['2.00','accept'],['','invalid']]){await h.select('แก้จำนวนหลังเปิดบิล ผัก 1',value);assert.equal(h.find(n=>n.props.id==='review-row-1').props['data-status'],status);}assert.equal(h.calls.length,0);
});

// Original tests/receiving-ux-a07-r2.test.mjs:161
test("PORT 127: A07 R2 #3: full row editor also shows live discrepancy immediately after its received field", async () => {
const h=await open(doc());await h.click('แก้ข้อมูลหลังเปิดบิล');await h.select('แก้จำนวนหลังเปิดบิล ผัก 1','0.75');const card=h.find(n=>n.props.id==='review-row-1');assert.equal(card.props['data-status'],'short');assert.match(h.text(card),/แก้หลังเปิดบิล: รับ 0.75/);assert.equal(btn(h,'รับ 0.75 และแจ้งขาด').props.disabled,false);assert.equal(h.calls.length,0);
});

test('A blind count: a number beyond supported magnitude stays visible, blocks sending, and never crashes rendering', async () => {
  const h=await open(doc({counted_complete_at:null})); await h.click('นับของ');
  await h.select('นับได้ ผัก 1','99999999999999999999999999999');
  assert.equal(field(h,'นับได้ ผัก 1').props.value,'99999999999999999999999999999');
  assert.equal(btn(h,'ยืนยันการนับและเทียบบิล').props.disabled,true); assert.equal(h.calls.length,0);
});

test('A added persisted row: deletion sends only its ID and retains original blind count evidence', async () => {
  const h=await open(doc({lines:[row(),row(2,{counted_quantity:null})]}));
  assert.ok(!h.visible().some(n=>n.type==='button' && h.text(n)==='ลบรายการเพิ่ม ผัก 1'));
  await h.click('ลบรายการเพิ่ม ผัก 2'); await h.select('เลขที่บิล','DELETE'); await h.click('บันทึกหัวบิล');
  const body=h.calls[0][2]; assert.deepEqual(Array.from(body.deleted_line_ids),[2]); assert.equal(body.lines.length,1);
  assert.equal(body.lines[0].id,1); assert.equal(body.lines[0].quantity_received,'2.00');
});
