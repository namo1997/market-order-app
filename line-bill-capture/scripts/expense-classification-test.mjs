import assert from 'node:assert/strict';
import os from 'node:os';
import { expenseClassificationSuggestions as classify } from '../src/expense-classification-suggestions.js';
assert.ok(os.tmpdir().startsWith('/Volumes/SSD Files/SOLAO/'), 'Run with SSD snapshot runner');
let checks = 0;
const is = (actual, expected) => { assert.deepEqual(actual,expected); checks++; };
for (const [purpose,type,category] of [
  ['ซื้อผักและหมู','purchase','ingredients'], ['ซื้อกล่องอาหารและถุงพลาสติก','purchase','packaging'],
  ['จ่ายค่าแรง','purchase','personnel'], ['ชำระค่าน้ำประปา','purchase','utilities'],
  ['จ่ายค่าเช่า','purchase','premises'], ['ค่าโฆษณา','purchase','marketing'],
  ['ค่าธรรมเนียมโอน','purchase','fees'], ['ซื้อตู้เย็น','purchase','asset_review'],
  ['ค่าน้ำตาล','purchase','ingredients'], ['ซื้อผักและกล่องอาหาร','purchase','mixed'],
  ['คืนเงินสำรองซื้อผัก','reimbursement','ingredients'], ['ค่ามัดจำซื้อผัก','advance_payment','ingredients'],
  ['คืนเงินค่าอาหาร','refund_adjustment','ingredients'], ['ชำระเงินต้นกู้ซื้ออุปกรณ์','loan',undefined],
  ['โอนระหว่างบัญชีค่าอาหาร','internal_transfer',undefined], ['นำส่งภาษีหัก ณ ที่จ่าย','government_remittance',undefined],
  ['นำส่งเงินหักพนักงานเงินเดือน','government_remittance',undefined]
]) {
  const suggestion = classify({purpose});
  is(suggestion.transaction_type?.value,type); is(suggestion.expense_category?.value,category);
  assert.ok(suggestion.transaction_type.reason.length>0); checks++;
  if (suggestion.expense_category) { assert.ok(suggestion.expense_category.reason.length>0); checks++; }
}
for (const purpose of ['ไม่ใช่ค่าอาหาร','ไม่คืนเงิน','ยกเลิกซื้อผัก','น่าจะเป็นค่าแรง','อาจจะซื้ออาหาร','เงินต้นและดอกเบี้ย','โอนระหว่างบัญชีและคืนเงินสำรอง','จ่ายล่วงหน้าและคืนเงิน']) is(classify({purpose}),{});
is(classify({purpose:'ร้านอาหาร'}),{});
is(classify({purpose:'ค่าโฆษณาร้านอาหาร'}).expense_category.value,'marketing');
for (const aiSummary of ['ธนาคารกสิกรไทย','ผู้รับ ร้านผักอาหารสด','TO ร้านอาหาร','ยอดเงิน 1000 บาท']) is(classify({aiSummary}),{});
is(classify({ billDetail:'ผัก หมู' }),{});
is(classify({billDetail:'ผัก หมู',isBill:true}).expense_category.value,'ingredients');
is(classify({aiSummary:'จ่ายค่าไฟฟ้า'}).expense_category.value,'utilities');
is(classify({purpose:'ซื้อผัก',aiSummary:'นำส่งเงินหักพนักงาน'}),{});
is(classify({purpose:'คืนเงินสำรองซื้อผัก',aiSummary:'จ่ายล่วงหน้าซื้อผัก'}),{});
is(classify({purpose:'ซื้อผัก', recipient_name:'ตู้เย็นธนาคาร',amount:999}).expense_category.value,'ingredients');
const input = {purpose:'ซื้อผัก',billDetail:'กล่องอาหาร',isBill:true}; const before=JSON.stringify(input); classify(input); is(JSON.stringify(input),before);
const sensitive = classify({purpose:'ซื้อผักบัญชี 1234567890'});
assert.doesNotMatch(JSON.stringify(sensitive),/1234567890/); checks++;
is(classify({purpose:'โอนระหว่างบัญชีและค่าธรรมเนียมธนาคาร'}),{});
is(classify({aiSummary:'สลิปโอนเงินให้ คุณไก่'}),{});
console.log(`Expense classification suggestions: ${checks} checks passed; deterministic evidence rules, negation/conflict abstention and no input mutation.`);
