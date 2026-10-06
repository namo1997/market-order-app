import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// ตรรกะบริสุทธิ์ของ public/expense-profile-assist.js (ส่วนที่ผูกกับ DOM ตรวจใน expense-assist-flow-test.mjs ด้วยเบราว์เซอร์จริง)
const source = fs.readFileSync(new URL('../public/expense-profile-assist.js', import.meta.url), 'utf8');
const context = vm.createContext({ window: {} });
vm.runInContext(`${source}\nthis.applicable = expenseAssistApplicable; this.origin = expenseAssistOriginText;`, context);
const { applicable, origin } = context;
const window = context.window;
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message); checks += 1; };

const suggestion = (value, source = 'paired_document', evidence = [{ item_id: 7 }]) => ({ value, source, evidence });
const record = (fields, suggestions) => ({ fields, suggestions });
const blank = { value: null, source: 'manual', evidence: [] };
const typed = (value) => ({ value, source: 'manual', evidence: [] });

eq(applicable(record({ supplier_name: blank, purpose: typed('ผัก') }, { supplier_name: suggestion('ร้าน ก'), purpose: suggestion('ค่าผัก') })), ['supplier_name'], 'ไม่ทับช่องที่กรอกไว้');
eq(applicable(record({ purpose: typed('   ') }, { purpose: suggestion('ค่าผัก') })), ['purpose'], 'ช่องที่มีแต่ช่องว่างถือว่ายังว่าง');
eq(applicable(record({}, { purpose: suggestion('ค่าผัก') })), ['purpose'], 'ช่องที่ยังไม่มีใน fields ถือว่าว่าง');
eq(applicable(record({}, { supplier_name: suggestion('ร้าน ก'), recipient_name: suggestion('นาย ข') }), (key) => key === 'supplier_name'), ['recipient_name'], 'ข้ามช่องที่ระยะ 1 ซ่อนไว้');
eq(applicable(record({}, { supplier_name: suggestion(null), purpose: suggestion('  '), notes: undefined, branch: { value: 5 } })), [], 'ข้ามข้อเสนอที่ไม่มีค่าที่ใช้ได้');
eq(applicable(record(undefined, undefined)), [], 'ไม่มีข้อมูลก็ไม่ error');
eq(applicable(record({ supplier_name: { value: 'จากชุดที่บันทึกไว้', source: 'paired_document', evidence: [{ item_id: 3 }] } }, { supplier_name: suggestion('ค่าอื่น') })), [], 'ค่าที่บันทึกไว้แล้วไม่ถูกแทน');

eq(origin(suggestion('x', 'paired_document', [{ item_id: 3624 }])), 'เอกสารคู่ #3624', 'ระบุเลขเอกสารคู่');
eq(origin(suggestion('x', 'remembered_pair', [{ item_id: 1 }, { item_id: 2 }])), 'การตรวจก่อนหน้า 2 รายการ', 'ระบุจำนวนรายการที่ตรวจแล้ว');
eq(origin(suggestion('x', 'remembered_pair', Array.from({ length: 8 }, (_, index) => ({ item_id: index + 1 })))), 'การตรวจก่อนหน้า 8+ รายการ', 'เพดานหลักฐาน 8 แสดงเป็น 8+');
eq(origin(suggestion('x', 'bill')), null, 'source เดิมไม่ถูกเปลี่ยนข้อความ');
eq(window.ExpenseProfileAssist.sourceLabels, { paired_document: 'เอกสารคู่', remembered_pair: 'การตรวจก่อนหน้า' }, 'ป้ายที่มาที่ expense-profile.js ใช้');
assert.equal(typeof window.ExpenseProfileAssist.attach, 'function'); checks += 1;
console.log(`expense profile assist UI logic OK (${checks} checks)`);
