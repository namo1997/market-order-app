import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { harness as pageHarness } from './receiving-harness.mjs';
import { OPTIONAL_RECEIVING_NOTE, hasPendingQuantity, queueStatus, sortShops, shopStatusLabel } from '../src/pages/receiving/receiving-queue.js';

// Keep due-status fixtures coherent and independent of the machine's real day.
class QueueDate extends Date { constructor(...args){super(...(args.length ? args : ['2026-10-18T05:00:00Z']));} }
const harness=(page,props={},api={},auth={})=>pageHarness(page,props,api,auth,{}, {Date:QueueDate});
const group=(id,status,values={})=>({supplier_key:`pg:${id}`,supplier_name:`ร้าน ${id}`,status,
  due_date:status==='overdue'?'2026-10-17':status==='due_today'?'2026-10-18':'2026-10-19',has_partial:status==='partial',overdue_days:1,
  items:[{order_item_id:id,product_id:id,product_name:'มะนาว',quantity_ordered:'0.30',received_quantity:'0.10',unit_name:'กก.'}],...values});
const groups=[group(4,'upcoming'),group(3,'partial'),group(2,'due_today'),group(1,'overdue')];

test('queue: sort priority, Thai labels/date and decimal pending quantity including short received=true',()=>{
  assert.deepEqual(sortShops(groups).map(g=>g.status),['overdue','due_today','partial','upcoming']);
  assert.deepEqual(sortShops(groups).map(shopStatusLabel),['เลยกำหนด 1 วัน','ควรถึงวันนี้','รับไปบางส่วน','ถึง 19 ต.ค.']);
  assert.equal(hasPendingQuantity({...groups[0].items[0],is_received:true}),true);
  assert.equal(hasPendingQuantity({...groups[0].items[0],received_quantity:'0.30'}),false);
});

test('optional receiving shops: calm Thai note, never overdue, no followup button; required shops unchanged',async()=>{
  const optional=group(5,'overdue',{receiving_optional:true});
  assert.equal(queueStatus(optional,'2026-10-18'),'due_today');assert.equal(queueStatus(optional),'due_today');
  assert.equal(shopStatusLabel(optional,'2026-10-18'),'รอรับ');
  assert.equal(queueStatus(group(1,'overdue'),'2026-10-18'),'overdue');
  assert.equal(OPTIONAL_RECEIVING_NOTE,'ไม่บังคับรับ · ถ้าไม่นับ ระบบรับให้อัตโนมัติวันถัดไป');
  const h=await harness('Receiving',{}, {expected:async()=>[optional,group(1,'overdue')]});
  const text=h.text(h.visible());
  const notes=h.visible().filter(n=>n.props?.className==='rc-queue-optional');
  assert.equal(notes.length,1,'note only on the optional shop');assert.ok(text.includes(OPTIONAL_RECEIVING_NOTE));
  assert.ok(text.includes('เลยกำหนด 1 วัน'));
  // Previously asserted a disabled follow-up button for the optional shop; it is now not rendered at all (no wasted row).
  assert.equal(h.visible().some(n=>n.props?.['aria-label']==='ตามของ ร้าน 5'),false,'optional shop has no follow-up button');
  assert.equal(h.visible().filter(n=>typeof n.props?.['aria-label']==='string'&&n.props['aria-label'].startsWith('ตามของ ')).length,1,'only the required shop keeps follow-up');
  assert.notEqual(h.find(n=>n.props?.['aria-label']==='ตามของ ร้าน 1').props.disabled,true);
  assert.ok(h.find(n=>n.props?.['aria-label']==='เลือกร้าน ร้าน 5'),'optional shop can still be selected and received');
  assert.equal(h.visible().some(n=>n.props?.['aria-label']==='รับของ ร้าน 5'),false,'cards no longer carry a second receive button');
  h.unmount();
});

test('home: all suppliers first, badges/actions; tapping card opens only items and primary receives chosen supplier',async()=>{
  const h=await harness('Receiving',{}, {expected:async()=>groups});
  const cards=h.visible().filter(n=>n.props.className?.includes('rc-queue-heading'));
  assert.deepEqual(cards.map(n=>n.props['aria-label']),['เลือกร้าน ร้าน 1','เลือกร้าน ร้าน 2','เลือกร้าน ร้าน 3','เลือกร้าน ร้าน 4']);
  assert.equal(h.visible().filter(n=>n.props.className==='rc-current-shop').length,0);
  assert.match(h.text(h.visible()),/รอรับ 4 ร้าน/);assert.match(h.text(h.visible()),/รอรับ4 รายการ/);
  for(const label of ['เลยกำหนด 1 วัน','ควรถึงวันนี้','รับไปบางส่วน','ถึง 19 ต.ค.'])assert.ok(h.text(h.visible()).includes(label));
  await h.click('เลือกร้าน ร้าน 3');assert.equal(h.visible().filter(n=>n.type==='li').length,1);assert.equal(h.calls.length,0);
  await h.click('เลือกร้าน ร้าน 4');await h.click('เริ่มรับของ ร้าน 4');assert.ok(h.find(n=>n.type==='input'&&n.props.value==='ร้าน 4'));h.unmount();
});

test('followup: optional note, trusted scope payload, pending double tap guard, duplicate timestamp and error retry',async()=>{
  let release;let fail=false;const bodies=[];
  const h=await harness('Receiving',{}, {expected:async()=>[groups[0]],followup:async body=>{
    bodies.push(body); if(fail)throw new Error('ส่งไม่สำเร็จ');
    return new Promise(resolve=>{release=()=>resolve({created:false,followup:{created_at:'2026-10-17T06:40:00Z'}});});
  }});
  await h.click('ตามของ ร้าน 4');const input=h.find(n=>n.type==='input'&&n.props.maxLength===300);input.props.onChange({target:{value:'ขาดมะนาว'}});await h.settle();
  const action=h.find(n=>n.type==='button'&&h.text(n)==='แจ้งบัญชี');
  const request=action.props.onClick();await h.settle();await action.props.onClick();
  assert.equal(bodies.length,1);assert.equal(bodies[0].supplier_key,'pg:4');assert.equal(bodies[0].note,'ขาดมะนาว');assert.equal(bodies[0].branch_id,1);
  assert.equal(h.find(n=>n.type==='button'&&h.text(n)==='แจ้งบัญชี').props.disabled,true);
  release();await request;await h.settle();assert.match(h.text(h.visible()),/แจ้งไปแล้ว เวลา 13:40/);
  fail=true;await h.click('ตามของ ร้าน 4');await h.click('แจ้งบัญชี');assert.match(h.text(h.visible()),/การเชื่อมต่อขัดข้อง/);h.unmount();
});

test('bell: staff cannot see inbox; accounting pending count, acknowledgement and close refresh list',async()=>{
  const item={id:1,supplier_name:'ร้าน 1',branch_id:1,department_id:10,actor_name:'ผู้รับ',source:'manual',status:'open',created_at:'2026-10-17T06:40:00Z',pending_items:[{order_item_id:1,product_name:'มะนาว',remaining_quantity:'1.00'}]};
  const staff=await harness('Receiving',{}, {}, {user:{id:1,role:'user',branch_id:1,department_id:10}});
  assert.equal(staff.visible().some(n=>n.props.className?.includes('rc-followup-bell')),false);staff.unmount();
  let items=[item];const calls=[];
  const h=await harness('Receiving',{}, {followups:async()=>({items,pending_count:items.length}),followupStatus:async(id,status)=>{calls.push([id,status]);items=status==='resolved'?[]:[{...item,status}];}}, {user:{id:1,role:'accounting',branch_id:1,department_id:10}});
  await h.click('แจ้งเตือนตามของ 1 เรื่อง');assert.match(h.text(h.visible()),/เรื่องตามของ/);
  await h.click('รับทราบ ร้าน 1');assert.match(h.text(h.visible()),/รับทราบแล้ว/);assert.equal(h.text(h.all().find(n=>n.props.className?.includes('rc-followup-bell'))),'1');
  await h.click('ปิดเรื่อง ร้าน 1');assert.match(h.text(h.visible()),/ไม่มีเรื่องค้าง/);assert.equal(h.text(h.all().find(n=>n.props.className?.includes('rc-followup-bell'))),'0');
  assert.deepEqual(calls,[[1,'acknowledged'],[1,'resolved']]);h.unmount();
});

test('queue style contract: touch 48px, wrap at 360dp, scoped dark theme; safe-area inherited from existing app bar',async()=>{
  const css=postcss.parse(await readFile(new URL('../src/pages/receiving/receiving.css',import.meta.url),'utf8'));
  let actions,bell,wrap=false;
  css.walkRules(rule=>{if(rule.selector==='.solao .rc-queue-actions > button')actions=rule;if(rule.selector==='.solao .rc-followup-bell')bell=rule;
    if(rule.selector==='.solao .rc-queue-heading'&&rule.parent.type==='atrule'&&rule.parent.params==='(max-width: 380px)')wrap=true;});
  for(const rule of [actions,bell])assert.ok(rule.nodes.some(n=>n.prop==='min-height'&&n.value==='48px'));
  assert.equal(wrap,true);const source=css.toString();assert.match(source,/data-theme='dark'/);const tokens=await readFile(new URL('../src/design/tokens.css',import.meta.url),'utf8');assert.match(tokens,/safe-area-inset-bottom/);assert.match(source,/var\(--sg-safe/);
});


test('lead settings: per-shop day setting, validates integer 0-90 and persists through admin API',async()=>{
  let saved=0;
  const h=await harness('SupplierLeadSettings',{groups,onSaved:()=>{saved++;}});
  await h.select('ร้าน','pg:4');await h.select('ส่งภายในกี่วัน','2');await h.click('บันทึกวันส่ง');
  assert.equal(h.calls[0][0],'setLead');assert.equal(h.calls[0][1],'pg:4');assert.equal(h.calls[0][2],2);assert.equal(saved,1);
  assert.match(h.text(h.visible()),/บันทึกวันส่งแล้ว/);
  await h.select('ส่งภายในกี่วัน','1.5');assert.equal(h.find(n=>n.type==='button'&&h.text(n)==='บันทึกวันส่ง').props.disabled,true);
  h.unmount();
});
