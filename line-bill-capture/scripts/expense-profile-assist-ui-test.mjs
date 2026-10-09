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

// Exercise the real attach/refresh/apply flow: no proposals is not proof that empty facts are complete.
function assistHarness(fields, suggestions, hiddenKeys = []) {
  const tasks = [], observers = [], controls = new Map(), events = new Map();
  class Node {
    constructor(tag) { this.tag=tag;this.textContent='';this.className='';this.children=[];this.attrs=new Map(); }
    append(...nodes) { this.children.push(...nodes); }
    setAttribute(k,v) { this.attrs.set(k,v); }
    removeAttribute(k) { this.attrs.delete(k); }
    getAttribute(k) { return this.attrs.get(k)||null; }
    querySelector(selector) { return this.children.find(n=>selector===n.tag || selector==='.'+n.className) || null; }
    focus() {}
  }
  const form=new Node('form'), fieldset=new Node('fieldset');
  fieldset.before=node=>form.children.unshift(node);form.append(fieldset);
  const dialog={open:true,querySelector(selector){return selector==='.expense-profile-form'?form:form.querySelector(selector);},append(){},addEventListener(type,fn){events.set(type,fn);}};
  for(const key of new Set([...Object.keys(fields),...Object.keys(suggestions)])) controls.set('expense-profile-'+key,{disabled:false,getAttribute(){return null;},setAttribute(){},closest(){return hiddenKeys.includes(key)?{open:false}:null;}});
  const record={loaded:true,busy:false,edit:0,fields:structuredClone(fields),suggestions:structuredClone(suggestions)};
  const hooks={dialog,getRow:()=>({id:7}),isStale:()=>false,rerender(){form.children=[fieldset];observers[0]();},store:{record:()=>record,set(_id,key,value,suggestion){record.fields[key]={...suggestion,value};record.edit++;},request:async()=>({data:{}})}};
  const domContext=vm.createContext({window:{},document:{head:new Node('head'),createElement:tag=>new Node(tag),getElementById:id=>controls.get(id)||null},MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}disconnect(){}},queueMicrotask:fn=>tasks.push(fn)});
  vm.runInContext(source,domContext);domContext.window.ExpenseProfileAssist.attach(hooks);
  const flush=async()=>{while(tasks.length) {tasks.shift()();await Promise.resolve();}};
  return {record,dialog,async render(){observers[0]();await flush();},async refresh(){events.get('input')();await flush();},async apply(){form.querySelector('.expense-profile-assist-bar').querySelector('button').onclick();await flush();},status:()=>form.querySelector('.expense-profile-assist-bar').querySelector('p').textContent,button:()=>form.querySelector('.expense-profile-assist-bar').querySelector('button')};
}
const emptyAssist=assistHarness({supplier_name:blank,purpose:blank},{});
await emptyAssist.render();assert.doesNotMatch(emptyAssist.status(),/ครบแล้ว|เติม.*ครบ/,'zero suggestions with empty facts must not say filled all');assert.equal(emptyAssist.button().getAttribute('aria-disabled'),'true');
const unavailableAssist=assistHarness({supplier_name:blank,purpose:typed('กรอกเอง')},{supplier_name:suggestion('ร้าน ก')},['supplier_name']);
await unavailableAssist.render();assert.doesNotMatch(unavailableAssist.status(),/ครบแล้ว|เติม.*ครบ/,'hidden unavailable suggestion is not completion');assert.equal(unavailableAssist.button().getAttribute('aria-disabled'),'true');
const appliedAssist=assistHarness({supplier_name:blank,purpose:blank},{supplier_name:suggestion('ร้าน ก')});
await appliedAssist.render();assert.match(appliedAssist.status(),/อีก 1 ช่อง/);await appliedAssist.apply();assert.equal(appliedAssist.record.fields.supplier_name.value,'ร้าน ก');assert.equal(appliedAssist.record.fields.purpose.value,null);assert.match(appliedAssist.status(),/เติม 1 ช่องแล้ว/);assert.doesNotMatch(appliedAssist.status(),/ครบแล้ว/);
console.log('expense assist actual status flow: empty/no-applicable suggestions never claim all fields filled; explicit adoption retains count');
