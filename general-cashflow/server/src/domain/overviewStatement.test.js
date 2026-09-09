import test from 'node:test';
import assert from 'node:assert/strict';
import {overviewStatement} from './overviewStatement.js';
const profile={code:'KASIKORN_DEPOSIT_STATEMENT',label:'KBank'};
test('statement review keeps unknown credits separate and groups actual dates',()=>{
const result=overviewStatement({profile,rows:[{transactionDate:'2026-08-01',amount:10.01,description:'EDC/K SHOP/MYQR merchant'},{transactionDate:'2026-08-01',amount:2.02,description:'EDC/K SHOP/MYQR merchant'},{transactionDate:'2026-08-02',amount:7,description:'จาก X3812 บจก. แกร็บแท็กซี่'},{transactionDate:'2026-08-02',amount:8,description:'บุคคลโอนเงิน'},{transactionDate:'2026-08-02',amount:-20,description:'ถอนเงิน'}]});
assert.equal(result.count,4);assert.equal(result.total,27.03);assert.equal(result.daily[0].amount,12.03);assert.equal(result.rows[3].channel,'เงินเข้าอื่น · ต้องตรวจ');
});
test('unknown format and empty credits fail explicitly',()=>{assert.throws(()=>overviewStatement({profile:{code:'GENERIC'},rows:[]}));assert.throws(()=>overviewStatement({profile,rows:[]}));});

test('account identity uses the full header number and active KBank configuration', async()=>{
const {verifyStatementAccount}=await import('./overviewStatement.js');
const a={id:1,account_number:'0308663108',bank_name:'Kasikornbank',is_active:1};
assert.equal(verifyStatementAccount({accountNumber:'030-8-66310-8'},[a]).status,'MATCHED');
assert.equal(verifyStatementAccount({accountNumber:'3108'},[a]).status,'UNKNOWN');
assert.equal(verifyStatementAccount({accountNumber:'0308663108'},[a,a]).status,'AMBIGUOUS');
assert.equal(verifyStatementAccount({accountNumber:'0308663108'},[{...a,is_active:0}]).status,'UNKNOWN');
assert.equal(verifyStatementAccount({},[a]).status,'MISSING');
assert.equal(verifyStatementAccount({accountNumber:'0308663108'},[{...a,bank_name:'SCB'}]).status,'UNKNOWN');
});
test('alerts cover uncertain Grab, duplicate rows and unusually large transfers without calling missing Grab a shortage',()=>{
 const normal=Array.from({length:5},(_,i)=>({transactionDate:'2026-08-01',amount:100,description:'จาก X3812 บจก. แกร็บแท็กซี่',uniqueHash:`g${i}`}));
 const r=overviewStatement({profile,rows:[...normal,{...normal[0],amount:1000,uniqueHash:'large'},{...normal[0]},{transactionDate:'2026-08-02',amount:50,description:'จาก X3812 บุคคลอื่น'},{transactionDate:'2026-08-02',amount:90,description:'รับเงินจากการขาย เต็มจำนวน/ผ่อนชำระ/คะแนนสะสม'}]});
 assert.equal(r.grab.count,7);assert.equal(r.rows[7].channel,'เงินเข้าอื่น · ต้องตรวจ');assert.equal(r.rows[8].channel,'บัตรกสิกร');assert.ok(r.rows[5].reasons.some(s=>s.includes('3 เท่า')));assert.ok(r.rows[0].reasons.some(s=>s.includes('อาจซ้ำ')));assert.ok(r.rows[6].reasons.some(s=>s.includes('อาจซ้ำ')));
 const noGrab=overviewStatement({profile,rows:[{transactionDate:'2026-08-01',amount:10,description:'EDC/K SHOP/MYQR'}]});assert.equal(noGrab.grab.count,0);assert.equal(noGrab.alerts.length,0);
});
test('Grab branch allocations are unique exact report matches across month boundaries',async()=>{
const {allocateOverviewGrab}=await import('./overviewStatement.js');
const rows=[{row_index:1,date:'2026-08-01',amount:10.01,channel:'GRAB food'},{row_index:2,date:'2026-08-01',amount:20,channel:'GRAB food'},{row_index:3,date:'2026-08-02',amount:30,channel:'GRAB food'}];
const evidence=[{sale_date:'2026-07-31',net:10.01,branch_code:'KK'},{sale_date:'2026-07-31',net:20,branch_code:'SK'},{sale_date:'2026-08-01',net:30,branch_code:'KK'},{sale_date:'2026-08-01',net:30,branch_code:'SK'}];
const result=allocateOverviewGrab(rows,evidence);assert.equal(result[0].branch_code,'KK');assert.equal(result[1].branch_code,'SK');assert.equal(result[0].sale_date,'2026-07-31');assert.equal(result[2].branch_code,null);
assert.equal(allocateOverviewGrab([...rows, {...rows[0],row_index:4}],evidence)[0].branch_code,null);
assert.equal(allocateOverviewGrab(rows,[])[0].branch_code,null);
assert.equal(result.reduce((n,r)=>n+r.amount,0),60.01);
});
test('overview receipt evidence requires bank provenance and remains separate from platform reports',async()=>{
const {bankTransactionEvidence}=await import('./receiptsOverview.js');
const tx={match_status:'matched_manual',transaction_date:'2026-08-01',amount:100,account_id:1,import_name:'Statement sample.csv',raw_payload:{source:'overview_bank_statement',overview_verified:true,inbox_import_id:123}};
assert.equal(bankTransactionEvidence(tx),true);
assert.equal(bankTransactionEvidence({...tx,match_status:'unmatched'}),false);
assert.equal(bankTransactionEvidence({...tx,raw_payload:{source:'grab_daily_report'}}),false);
});
test('Grab PDF wrapped column headers do not shift net income into outstanding balance',async()=>{
const {parseGrabDailyReportText}=await import('./grab.js');
const text=`รายงานธุรกิจรายวัน รายรับทั้งหมด THB 620.00
ยอดรายการ VAT ค่าบริการของ ร้าน โปรโมชัน ร้าน ค่าคอมมิชชันและภาษี ทั้งหมด ค่าคอมมิชชันเพิ่ม เติม ค่าธรรมเนียมการ ตลาด ส่วนลดค่าจัดส่งโดย ร้าน การปรับราย ได้ รายรับทั้งหมด ค้างชำระ Grab
1,000.00 0.00 0.00 -100.00 -200.00 -20.00 -10.00 0.00 -50.00 620.00 0.00
คำสั่งซื้อจากแอปฯ`;
const r=parseGrabDailyReportText(text,'3-C6CELAM2TCAUVX-20260817.pdf');assert.equal(r.netAmount,620);assert.equal(r.cashierAmount,900);assert.equal(r.incomeAdjustmentAmount,-50);assert.equal(r.feeAmount,280);assert.equal(r.outstandingAmount,0);
});
