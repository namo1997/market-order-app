import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { harness, row, doc, signed, text, btn, field, track, cleanup, open, sign, draw, group, queueFlow, summary } from './review-a-port-harness.mjs';
afterEach(cleanup);

// Original tests/receiving-redesign.test.mjs:165
test("PORT 053: redesign next shop: confirmed document opened from history returns to expected queue using document supplier identity", async () => {
const initial=signed({status:'confirmed'});const h=track(await harness('Receiving',{}, {list:async()=>[initial],expected:async()=>[group(1,true),group(2)],get:async()=>initial}));await h.radio('documents');await h.click('เปิดเอกสาร #5 ร้าน 1 ยืนยันแล้ว');await h.click('ไปร้านถัดไป');assert.ok(h.find(n=>n.props.className==='rc-current-shop' && /ร้าน 2/.test(h.text(n))));assert.equal(h.calls.filter(c=>c[0]==='confirm').length,0);
});

// Original tests/receiving-review-v2.test.mjs:72
test("PORT 063: review v2: raw missing values remain unknown while derived amount is explicitly labelled", async () => {
const h=await open(doc({lines:[row(1,{quantity_billed:null,quantity_ordered:null,unit_price:null,amount:null})]}));const card=h.find(n=>n.props.id==='review-row-1');assert.match(h.text(card),/บิล—/);assert.match(h.text(card),/สั่ง—/);assert.doesNotMatch(h.text(card),/บิล0/);
await h.click('รับ 2 กก. · ให้บัญชีขอบิลจากร้าน');await h.click('ดูสรุปก่อนเซ็น');assert.match(text(h),/ยังไม่มีราคา/);assert.match(text(h),/รอตรวจราคา/);
});

// Original tests/receiving-ux-060.test.mjs:103
test("PORT 084: UX060 #7/#9: absent price displays dash; explicit zero stays zero and bill fields are one tap away", async () => {
for(const price of [null,'0']){const h=await open(doc({lines:[row(1,{unit_price:price,amount:price})]}));await h.click('แก้');assert.equal(field(h,'ราคาบิล ผัก 1').props.value,price??'');await h.click(price===null?'ยืนยันรับ 2':'รับ 2 และส่งตรวจราคา');await h.click('ดูสรุปก่อนเซ็น');assert.equal(/ยังไม่มีราคา/.test(text(h)),price===null);}
});

// Original tests/receiving-ux-061.test.mjs:22
test("PORT 088: UX061 #1: review work is separate; warning counts persist across review/save/sign/confirm", async () => {
const h=await open(doc({warnings:[{code:'DUPLICATE_BILL'}]}));assert.match(text(h),/อาจเป็นบิลซ้ำ/);await h.click('ยืนยันรับ 2');assert.match(text(h),/อาจเป็นบิลซ้ำ/);await sign(h);assert.match(text(h),/อาจเป็นบิลซ้ำ/);await draw(h);await h.click('บันทึกเซ็น');assert.match(text(h),/อาจเป็นบิลซ้ำ/);assert.equal(btn(h,'ยืนยันรับสินค้า').props.disabled,false);
});

// Original tests/receiving-ux-061.test.mjs:39
test("PORT 089: UX061 #1: server changes after save are displayed before confirmation; next attempt uses refreshed summary", async () => {
const h=await open(doc(),{update:async()=>signed({discount:'1',warnings:[{code:'DUPLICATE_BILL'}]})});await h.click('ยืนยันรับ 2');await h.click('ดูสรุปก่อนเซ็น');assert.match(text(h),/อาจเป็นบิลซ้ำ/);assert.match(text(h),/รวมรายการสุทธิ 19.00 บาท/);assert.equal(h.calls.filter(c=>c[0]==='confirm').length,0);await h.click('ไปเซ็นรับของ');assert.match(text(h),/รวมรายการสุทธิ 19.00 บาท/);
});

// Original tests/receiving-ux-061.test.mjs:66
test("PORT 090: UX061 #2: confirmation, success, details and reopening retain missing-price context beside matching totals", async () => {
const missing=signed({lines:[row(1,{unit_price:null,amount:null,review_decision:'accept'})]});const h=await open(missing);await sign(h);assert.equal(text(h).split('ยังไม่มีราคา').length-1,1);await h.click('ยืนยันรับสินค้า');assert.match(text(h),/รับของเรียบร้อย/);assert.match(text(h),/รอตรวจราคา/);
const reopened=await open({...missing,status:'confirmed'});assert.equal(text(reopened).split('ยังไม่มีราคา').length-1,1);assert.match(text(reopened),/มูลค่าที่รับ \(ส่วนที่ทราบราคา\).*รายการรอราคา/);
});

// Original tests/receiving-ux-061.test.mjs:78
test("PORT 091: UX061 #3: success/edit bars reserve nowrap secondary labels, flexible primary and 48px touch targets", async () => {
const css=await readFile(new URL('../src/pages/receiving/review-a.css',import.meta.url),'utf8');assert.match(css,/ra-footer \.sg-primary[^}]*width:100%[^}]*min-height:56px/s);assert.match(css,/ra-document>button[^}]*min-height:48px/s);assert.match(css,/ra-row-actions[^}]*display:grid/s);
const h=await open(signed({status:'confirmed'}));assert.ok(btn(h,'กลับหน้ารับสินค้า'));assert.equal(h.visible().filter(n=>n.type==='button' && h.text(n)==='ยืนยันรับสินค้า').length,0);
});

// Original tests/receiving-ux-061.test.mjs:141
test("PORT 095: UX061 #1: explicit draft save announces refreshed warning counts", async () => {
const h=await open(doc(),{update:async()=>doc({doc_ref:'NEW',warnings:[{code:'DUPLICATE_BILL'},{code:'LOW_CONFIDENCE'}]})});await h.select('เลขที่บิล','NEW');await h.click('บันทึกหัวบิล');const warning=h.find(n=>n.props['aria-label']==='ข้อสังเกตบิล');assert.match(h.text(warning),/อาจเป็นบิลซ้ำ/);assert.match(h.text(warning),/อ่านบิลได้ไม่ชัด/);assert.equal(field(h,'เลขที่บิล').props.value,'NEW');
});

// Original tests/receiving-ux-062.test.mjs:26
test("PORT 096: UX062 #1/#4: signing shows one compact summary/disclosure, short pending-price context and no warning badge stack", async () => {
const h=await open(signed({lines:[row(1,{review_decision:'accept',unit_price:null,amount:null})]}));await sign(h);assert.equal(h.visible().filter(n=>n.props['aria-label']==='สรุปก่อนเซ็น').length,1);assert.equal(text(h).split('ยังไม่มีราคา').length-1,1);assert.equal(h.visible().filter(n=>n.type==='details' && /รายละเอียดสรุป/.test(h.text(n))).length,1);assert.equal(btn(h,'ยืนยันรับสินค้า').props.disabled,false);
});

// Original tests/receiving-ux-062.test.mjs:108
test("PORT 100: UX062 #4: one warning summary on review and confirmation; confirmation footer stays short", async () => {
const h=await open(signed({warnings:[{code:'DUPLICATE_BILL'},{code:'DUPLICATE_BILL'}]}));assert.equal(text(h).split('อาจเป็นบิลซ้ำ').length-1,1);await sign(h);assert.equal(text(h).split('อาจเป็นบิลซ้ำ').length-1,1);const footer=h.find(n=>n.type==='footer');assert.equal(h.text(footer),'ยืนยันรับสินค้า');h.budget();
});

// Original tests/receiving-ux-063.test.mjs:108
test("PORT 105: UX063 #3: pending-price badge and received status belong to receipt card; explicit zero stays priced", async () => {
for(const price of [null,'0']){const h=await open(signed({status:'confirmed',lines:[row(1,{review_decision:'accept',unit_price:price,amount:price})]}));assert.match(text(h),/รับของเรียบร้อย/);assert.equal(/ยังไม่มีราคา/.test(text(h)),price===null);assert.equal(text(h).split('รับของเรียบร้อย').length-1,1);}
});

// Original tests/receiving-ux-063.test.mjs:131
test("PORT 106: UX063 #4: short title and nonzero attention; full counts remain accessible in details; review shows one disclosure", async () => {
const h=await open(signed({warnings:[{code:'DUPLICATE_BILL'}]}));await h.click('ดูสรุปก่อนเซ็น');assert.equal(h.visible().filter(n=>n.type==='details' && /รายละเอียดสรุป/.test(h.text(n))).length,1);assert.match(text(h),/รับ 1 จาก 1 รายการ/);assert.equal(text(h).split('อาจเป็นบิลซ้ำ').length-1,1);assert.doesNotMatch(text(h),/ข้อเตือนสินค้า 0/);
});

// Original tests/receiving-ux-064.test.mjs:46
test("PORT 108: UX064 #1: last confirmation waits for fresh queue, then returns home without suggesting a next shop", async () => {
const {h,queue,confirmations}=await queueFlow([group(1)]);assert.match(text(h),/กำลังโหลดคิวล่าสุด/);assert.equal(btn(h,'กลับหน้ารับสินค้า').props.disabled,true);assert.doesNotMatch(text(h),/ไปร้านถัดไป/);
queue.resolve([group(1,true)]);await h.settle();assert.equal(btn(h,'กลับหน้ารับสินค้า').props.disabled,false);await h.click('กลับหน้ารับสินค้า');assert.match(text(h),/รับครบทุกร้านแล้ว/);assert.equal(confirmations(),1);
});

// Original tests/receiving-ux-064.test.mjs:55
test("PORT 109: UX064 #1: fresh queue can add a pending shop absent from stale queue; next action selects it", async () => {
const {h,queue,confirmations}=await queueFlow([group(1)]);queue.resolve([group(1,true),group(2)]);await h.settle();await h.click('ไปร้านถัดไป');assert.ok(h.find(n=>n.props.className==='rc-current-shop' && /ร้าน 2/.test(h.text(n))));assert.equal(confirmations(),1);
});

// Original tests/receiving-ux-064.test.mjs:64
test("PORT 110: UX064 #1: queue failure offers one retry, keeps receipt accessible, never guesses from old groups or reconfirms", async () => {
const {h,queue,confirmations}=await queueFlow([group(1),group(2)]);queue.reject({request:{}});await h.settle();assert.ok(btn(h,'ลองโหลดคิวใหม่'));assert.doesNotMatch(text(h),/ไปร้านถัดไป/);assert.match(text(h),/รับของเรียบร้อย/);assert.ok(h.visible().some(n=>n.type==='img' && /ลายเซ็นผู้รับ/.test(n.props.alt||'')));
h.api.expected=async()=>[group(1,true)];await h.click('ลองโหลดคิวใหม่');assert.ok(btn(h,'กลับหน้ารับสินค้า'));assert.equal(confirmations(),1);
});

// Original tests/receiving-ux-064.test.mjs:75
test("PORT 111: UX064 #1: list refresh failure also prevents stale queue labels until successful retry", async () => {
const {h,queue,confirmations,fixList}=await queueFlow([group(1),group(2)],{listFails:true});queue.resolve([group(1,true)]);await h.settle();assert.ok(btn(h,'ลองโหลดคิวใหม่'));assert.doesNotMatch(text(h),/ไปร้านถัดไป/);fixList();await h.click('ลองโหลดคิวใหม่');assert.ok(btn(h,'กลับหน้ารับสินค้า'));assert.equal(confirmations(),1);
});

// Original tests/receiving-ux-064.test.mjs:84
test("PORT 112: UX064 #1: receipt remains accessible while the queue is still loading", async () => {
const {h,queue,confirmations}=await queueFlow([group(1)]);assert.match(text(h),/รับของเรียบร้อย/);assert.match(text(h),/รวมรายการ/);assert.ok(h.visible().some(n=>n.type==='img' && /ลายเซ็นผู้รับ/.test(n.props.alt||'')));assert.equal(btn(h,'กลับหน้ารับสินค้า').props.disabled,true);queue.resolve([group(1,true)]);await h.settle();assert.equal(confirmations(),1);
});

// Original tests/receiving-ux-064.test.mjs:91
test("PORT 113: UX064 #2: lead includes only product/bill warnings; one price notice and all warning details remain", async () => {
const h=await open(signed({lines:[row(1,{review_decision:'over',quantity_received:'3'}),row(2,{review_decision:'accept',unit_price:null,amount:null})],warnings:[{code:'PRICE_CHANGE'}]}));await h.click('ดูสรุปก่อนเซ็น');assert.equal(text(h).split('ยังไม่มีราคา').length-1,1);assert.match(text(h),/รับ 3 เป็นของเกิน/);assert.match(text(h),/ราคาเปลี่ยน/);assert.equal(h.visible().filter(n=>n.props.className==='rc-price-notice').length,1);
});

// Original tests/receiving-ux-064.test.mjs:109
test("PORT 114: UX064 #2: price-only attention is shown solely by PriceNotice; explicit zero needs no price warning", async () => {
for(const amount of [null,'0']){const h=await summary({lines:[row(1,{review_decision:'accept',unit_price:null,amount})]});assert.equal(text(h).split('ยังไม่มีราคา').length-1,amount===null?1:0);assert.equal(/รอตรวจราคา/.test(text(h)),amount===null);}
});

// Original tests/receiving-ux-064.test.mjs:118
test("PORT 115: UX064 #2: unchanged net total is inside closed summary details; bill and item totals stay prominent", async () => {
for(const patch of [{},{discount:null,vat:''},{total:'25'},{total:null}]){const h=await summary(patch);const ledger=h.find(n=>n.props.className==='ra-ledger');assert.match(h.text(ledger),/ยอดบิล/);assert.match(h.text(ledger),/มูลค่าที่รับ \(ส่วนที่ทราบราคา\)20.00 บาท/);assert.doesNotMatch(h.text(ledger),/รวมรายการสุทธิ/);const details=h.find(n=>n.type==='details');assert.ok(!details.props.open);assert.match(h.text(details),/รวมรายการสุทธิ 20.00 บาท/);assert.equal(text(h).split('รวมรายการสุทธิ').length-1,1);}
});

// Original tests/receiving-ux-064.test.mjs:131
test("PORT 116: UX064 #2: discount/tax retain prominent net, including adjustments that cancel; all amounts stay exact", async () => {
for(const [discount,vat,total] of [['1.25','0','18.75'],['0','1.40','21.40'],['1','1','20.00']]){const h=await summary({discount,vat,total});const ledger=h.text(h.find(n=>n.props.className==='ra-ledger'));assert.ok(ledger.includes(`มูลค่าที่รับ (ส่วนที่ทราบราคา)${total} บาท`));assert.match(h.text(h.find(n=>n.type==='details')),new RegExp(`รวมรายการสุทธิ ${total} บาท`));assert.equal(text(h).split('รวมรายการสุทธิ').length-1,1);}
});

// Original tests/receiving-ux-064.test.mjs:143
test("PORT 117: UX064 #2: invalid money keeps visible net placeholder and validation feedback", async () => {
const h=await summary({discount:'invalid'});assert.match(text(h),/รวมรายการสุทธิ — บาท/);assert.match(text(h),/ตรวจตัวเลข/);assert.ok(!h.visible().some(n=>n.type==='details'));
const edit=await open(signed({discount:'invalid'}));assert.equal(field(edit,'ส่วนลด').props['aria-invalid'],true);assert.equal(btn(edit,'ดูสรุปก่อนเซ็น').props.disabled,true);
});

// Original tests/receiving-ux-064.test.mjs:158
test("PORT 118: UX064 #2: summary after saving signature shows pending price only once, keeps acknowledgement and net details", async () => {
const h=await open(signed({has_receiver_signature:false}),{get:async()=>signed({lines:[row(1,{review_decision:'accept',unit_price:null,amount:null})]})});await sign(h);await draw(h);await h.click('บันทึกเซ็น');assert.match(text(h),/บันทึกลายเซ็นแล้ว.*สรุปเปลี่ยน/);assert.equal(text(h).split('ยังไม่มีราคา').length-1,1);assert.match(h.text(h.find(n=>n.type==='details' && h.all(n).some(c=>c.type==='summary' && h.text(c)==='รายละเอียดสรุป'))),/รวมรายการสุทธิ 0.00 บาท/);await h.click('รับทราบสรุปและกลับไปเซ็น');assert.equal(text(h).split('ยังไม่มีราคา').length-1,1);assert.equal(h.calls.filter(c=>c[0]==='signature').length,1);
});
