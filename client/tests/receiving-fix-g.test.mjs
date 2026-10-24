import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';
import { shopStatusLabel, sortShops } from '../src/pages/receiving/receiving-queue.js';
import { bangkokDate } from '../src/pages/receiving/receiving-utils.js';

const live=[];
afterEach(()=>{ for(const h of live.splice(0)) h.unmount(); });
const track=h=>{live.push(h);return h;};
const user={id:12,role:'user',branch_id:1,department_id:10,name:'ผู้รับ'};
const shop=(patch={})=>({supplier_key:'pg:3',supplier_name:'ร้านทดสอบ',status:'due_today',due_date:'2026-10-18',
  has_partial:true,receipt_summary:{short:3,over:1,received_items:4},
  items:[7,8,10,9].map((product_id,i)=>({order_item_id:50+i,product_id,product_name:`สินค้า ${product_id}`,unit_name:'กก.',has_pending:true})),...patch});
function clock(instant) {
  let now=instant;const timers=new Map();let id=0;
  class FixedDate extends Date { constructor(...args){super(...(args.length?args:[now]));} static now(){return Date.parse(now);} }
  return { set:value=>{now=value;}, runtime:{Date:FixedDate,
    setInterval:(fn,ms)=>{const key=++id;timers.set(key,{fn,ms});return key;},clearInterval:key=>timers.delete(key)},
    tick:()=>{for(const {fn,ms} of [...timers.values()])if(ms===30000)fn();}, timers };
}

for(const scope of ['department','branch']){
  test(`G2 ${scope}: real homepage counts confirmed shortages/over, shows partial pending work, keeps blind items without quantities`,async()=>{
    const c=clock('2026-10-19T01:00:00Z');const requests=[];
    const h=track(await harness('Receiving',{}, {expected:async(date,options)=>{requests.push(options.scope);return [shop()];}}, {user},{},c.runtime));
    if(scope==='branch')await h.radio('branch');
    assert.equal(requests.at(-1),scope);
    const text=h.text(h.visible());
    assert.match(text,/รอรับ 4 รายการ/);assert.match(text,/ขาด3 รายการ/);assert.match(text,/เกิน1 รายการ/);
    assert.match(text,/รับแล้วบางส่วน · ค้าง 4 รายการ/);assert.match(text,/เลยกำหนด 1 วัน/);
    await h.click('เลือกร้าน ร้านทดสอบ');
    assert.match(h.text(h.visible()),/รอนับของจริง/);
    assert.doesNotMatch(h.text(h.visible()),/รับแล้ว \d+ \/ สั่ง|ขาด \d+ กก/);
    h.api.expected=async()=>[shop({receipt_summary:undefined,has_partial:false})];
    await h.click('โหลดใหม่');
    // Owner 2026-10-22 redesign: zero short/over counts are not shown.
    assert.doesNotMatch(h.text(h.visible()),/ขาด\d+ รายการ|เกิน\d+ รายการ/);
    assert.doesNotMatch(h.text(h.visible()),/รับแล้วบางส่วน/);
  });

  test(`G2 ${scope}: fully received over-only summaries remain visible without receive/followup actions or waiting-shop counts`,async()=>{
    const h=track(await harness('Receiving',{}, {expected:async()=>[shop({summary_only:true,items:[],receipt_summary:{short:0,over:1,received_items:1}})]},{user}));
    if(scope==='branch')await h.radio('branch');
    assert.match(h.text(h.visible()),/รอรับ 0 ร้าน/);assert.match(h.text(h.visible()),/เกิน1 รายการ/);
    assert.equal(h.visible().filter(n=>n.props.className==='rc-queue-shop').length,0);
    assert.ok(!h.visible().some(n=>n.props['aria-label']==='รับของ ร้านทดสอบ'||n.props['aria-label']==='ตามของ ร้านทดสอบ'));
    await h.click('ตัวเลือก');
    assert.ok(!h.visible().some(n=>n.type==='option'&&h.text(n)==='ร้านทดสอบ'),'summary-only shops cannot create empty branch receipts through settings');
  });

  for(const signal of ['timer','focus'])test(`G3 ${scope}: ${signal} at Bangkok midnight reloads live date and corrects stale due_today badges`,async()=>{
    const c=clock('2026-10-18T16:59:59Z');const requests=[];
    const h=track(await harness('Receiving',{}, {expected:async(date,options)=>{requests.push({date,scope:options.scope});return [shop({has_partial:false})];}},{user},{},c.runtime));
    if(scope==='branch')await h.radio('branch');
    // Owner 2026-10-22 redesign: a shop due today carries no badge; only exceptions are labelled.
    assert.doesNotMatch(h.text(h.visible()),/เลยกำหนด/);
    c.set('2026-10-18T17:00:00Z');
    if(signal==='timer')c.tick();else h.dispatch({type:'focus'});
    await h.settle();
    assert.deepEqual(requests.at(-1),{date:'2026-10-19',scope});
    assert.match(h.text(h.visible()),/เลยกำหนด 1 วัน/);assert.doesNotMatch(h.text(h.visible()),/ควรถึงวันนี้/);
    h.unmount();assert.equal(c.timers.size,0);
  });

  test(`G3 ${scope}: explicit historical date survives foreground/midnight while overdue labels use current Bangkok date`,async()=>{
    const c=clock('2026-10-18T16:59:59Z');const requests=[];
    const h=track(await harness('Receiving',{}, {expected:async(date,options)=>{requests.push({date,scope:options.scope});return [shop()];}},{user},{},c.runtime));
    if(scope==='branch')await h.radio('branch');
    await h.click('ตัวเลือก');await h.select('วันที่','2026-10-17');await h.click('ตกลง');
    c.set('2026-10-18T17:00:00Z');h.dispatch({type:'focus'});await h.settle();
    assert.deepEqual(requests.at(-1),{date:'2026-10-17',scope});assert.match(h.text(h.visible()),/เลยกำหนด 1 วัน/);
  });
}

test('G3 due-date labels/sort ignore stale statuses, preserve lead time, and cross Bangkok year boundary independently of host timezone',()=>{
  assert.equal(bangkokDate(new Date('2026-12-31T16:59:59Z')),'2026-12-31');
  const next=bangkokDate(new Date('2026-12-31T17:00:00Z'));assert.equal(next,'2027-01-01');
  assert.equal(shopStatusLabel(shop({due_date:'2026-12-31'}),next),'เลยกำหนด 1 วัน');
  assert.equal(shopStatusLabel(shop({due_date:'2027-01-01',status:'overdue'}),next),'ควรถึงวันนี้');
  assert.equal(shopStatusLabel(shop({due_date:'2027-01-02',has_partial:false}),next),'ถึง 2 ม.ค.');
  assert.equal(shopStatusLabel(shop({due_date:'2027-01-02'}),next),'รับไปบางส่วน');
  assert.deepEqual(sortShops([shop({supplier_key:'future',due_date:'2027-01-02',has_partial:false}),shop({supplier_key:'old',due_date:'2026-12-31'})],next).map(s=>s.supplier_key),['old','future']);
});
