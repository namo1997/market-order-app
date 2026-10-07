import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/receipt-substitute-void.js',import.meta.url),'utf8');
const context = vm.createContext({document:{getElementById:()=>null}});
vm.runInContext(source+'\nthis.VoidDraft=ReceiptSubstituteVoidDraft;this.candidates=receiptSubstituteVoidCandidates;',context);
const receipt={id:72,generated_document_type:'receipt_substitute',status:'active',updated_at:'2026-10-07T08:20:00Z'};
assert.deepEqual(JSON.parse(JSON.stringify(context.candidates([receipt,receipt,{...receipt,id:73,status:'unsent'},{...receipt,id:74,status:'duplicate'},{id:75,generated_document_type:'batch_payment_line'},null]))),[receipt]);
let calls=0, resolve;
let payload;
const draft=new context.VoidDraft(receipt,async(url,options)=>{calls++;assert.equal(url,'/api/admin/items/72/receipt-substitute/void');assert.equal(options.method,'POST');payload=JSON.parse(options.body);return new Promise(done=>{resolve=done;});});
assert.equal(await draft.submit(),null);assert.equal(calls,0,'empty reason cannot mutate');assert.match(draft.error,/เหตุผล/);
draft.reason='  สร้างใบแทนผิดรายการ  ';
const pending=draft.submit();assert.equal(draft.busy,true);await draft.submit();assert.equal(calls,1,'repeat submit cannot make a second request');
assert.deepEqual(payload,{reason:'สร้างใบแทนผิดรายการ',expected_updated_at:receipt.updated_at});
resolve({success:true,data:{item_id:72,source_slip_item_id:70,voided:true,idempotent:false}});
assert.equal((await pending).voided,true);assert.equal(draft.busy,false);await draft.submit();assert.equal(calls,1,'completed command is not resubmitted');

let attempts=0;
const retry=new context.VoidDraft(receipt,async()=>{attempts++;if(attempts===1){const error=new Error('closed');error.details={code:'round_closed'};throw error;}return{success:true,data:{item_id:72,source_slip_item_id:70,voided:true,idempotent:true}};});
retry.reason='เหตุผลที่ผู้ตรวจกรอกไว้';
assert.equal(await retry.submit(),null);assert.equal(retry.reason,'เหตุผลที่ผู้ตรวจกรอกไว้');assert.equal(retry.busy,false);assert.match(retry.error,/ปิดแล้ว/);
assert.equal((await retry.submit()).idempotent,true);assert.equal(attempts,2);
console.log('receipt-substitute void UI: selection guards, reason, optimistic payload, duplicate submit and preserved retry passed');
