import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { groupQueue, lookbackDays } from '../src/models/receiving-queue-policy.js';
import { ensureQueueTables, QUEUE_DDL } from '../src/models/receiving-queue-schema.js';
import * as store from '../src/models/receiving-followups-store.js';
import { queueDb } from './helpers/receiving-queue-db.mjs';
import { createReceivingHarness } from './helpers/receiving-fake-db.mjs';
import { toBangkokDateKey, addDaysToDateKey } from '../src/utils/bangkok-date.js';

const today = '2026-10-17';
const user = { id: 12, name: 'ผู้รับ', role: 'user', branch_id: 1, department_id: 10 };
const manager = { ...user, role: 'admin' };
const row = (id, values = {}) => ({ order_item_id:id, product_id:id, product_name:`ผัก ${id}`, product_group_id:id,
  product_group_name:`ร้าน ${id}`, branch_id:1, department_id:10, order_date:today,
  quantity_ordered:'0.30', received_quantity:'0', unit_name:'กก.', ...values });
const group = () => groupQueue([row(1, { order_date:'2026-10-16' })], today)[0];
const now = new Date('2026-10-17T05:30:00.000Z');
const actor = { userId:12, userName:'ผู้รับ' };

test('queue: lead days, exact decimal remainder, partial precedence and sorted all suppliers; completed/cancelled absent', () => {
  const result = groupQueue([
    row(1, { order_date:'2026-10-16', received_quantity:'0.10', is_received:true }),
    row(2), row(3, { received_quantity:'0.10' }), row(4), row(5, { received_quantity:'0.30' }),
    row(6), row(7, { product_group_id:6, received_quantity:'0.30' })
  ], today, [{ supplier_key:'pg:3',lead_days:2 }, { supplier_key:'pg:4',lead_days:2 }, { supplier_key:'pg:6',lead_days:2 }]);
  assert.deepEqual(result.map(item => item.status), ['overdue','due_today','partial','partial','upcoming']);
  assert.equal(result[0].due_date,'2026-10-16'); assert.equal(result[0].overdue_days,1);
  assert.equal(result[0].items[0].remaining_quantity,'0.20'); assert.equal(result[0].items[0].is_received,false);
  assert.equal(result[2].due_date,'2026-10-19'); assert.equal(result[2].lead_days,2);
  assert.ok(result.every(item => item.supplier_key && item.supplier_name && item.items));
  assert.equal(lookbackDays(),7); assert.equal(lookbackDays('14'),14); assert.equal(lookbackDays('x'),7); assert.equal(lookbackDays('9999'),7);
});

test('expected real model: includes 7-day backlog, excludes future/old/cancelled/full and enforces branch/department', async () => {
  const h = await createReceivingHarness({ testDate: today });
  const template = h.state.orderItems[0];
  h.state.orderItems = [
    { ...template,id:1,order_date:addDaysToDateKey(h.today,-2),quantity:.3,received_quantity:.1,is_received:true },
    { ...template,id:2,order_date:addDaysToDateKey(h.today,-7) },
    { ...template,id:3,order_date:addDaysToDateKey(h.today,-8) },
    { ...template,id:4,order_date:addDaysToDateKey(h.today,1) },
    { ...template,id:5,order_status:'cancelled' },
    { ...template,id:6,received_quantity:10 },
    { ...template,id:7,branch_id:2,department_id:20 },
    { ...template,id:8,department_id:30 }
  ];
  const result = await h.invoke('getExpected',{user,query:{date:h.today}});
  assert.equal(result.statusCode,200);
  assert.deepEqual(Array.from(result.body.data[0].items, item => item.order_item_id),[1,2]);
  assert.equal(result.body.data[0].items[0].remaining_quantity, undefined);
  assert.equal(result.body.data[0].items[0].has_pending, true);
});

test('followup: concurrent manual dedupe uses locked scope and sliding full hour, preserves actor/note/snapshot', async () => {
  const {db,state} = queueDb(); const args = { group:group(), actor, note:'มะนาวยังไม่มา', now };
  const results = await Promise.all([store.saveFollowup(db,args),store.saveFollowup(db,args)]);
  assert.deepEqual(results.map(item => item.created),[true,false]); assert.equal(state.rows.length,1);
  assert.equal(results[0].followup.id,results[1].followup.id);
  assert.equal(results[0].followup.actor_user_id,12); assert.equal(results[0].followup.note,args.note);
  assert.equal(results[0].followup.pending_items[0].order_item_id,1);
  assert.match(results[0].followup.created_at,/Z$/);
  const before = await store.saveFollowup(db,{...args,now:new Date(now.getTime()+3599999)});
  assert.equal(before.created,false);
  const after = await store.saveFollowup(db,{...args,now:new Date(now.getTime()+3600000)});
  assert.equal(after.created,true); assert.equal(state.rows.length,2);
  const cross = await store.saveFollowup(db,{...args,group:{...group(),department_id:20}});
  assert.equal(cross.created,true);
  assert.ok(state.queries.some(q => /scope_key = \? FOR UPDATE/.test(q.sql)));
});

test('followup: auto overdue once per order set across days/resolution, only overdue lines; manual dedupes with auto', async () => {
  const {db,state} = queueDb();
  const g = group(); g.items.push({...g.items[0],order_item_id:2,due_status:'upcoming'});
  const first = await store.saveFollowup(db,{group:g,source:'overdue',now});
  assert.equal(first.followup.source,'overdue'); assert.equal(first.followup.pending_items.length,1);
  assert.equal((await store.saveFollowup(db,{group:g,actor,now})).created,false);
  await store.updateFollowup(db,{user:manager,id:first.followup.id,status:'resolved',now});
  assert.equal((await store.saveFollowup(db,{group:g,source:'overdue',now:new Date('2026-10-20T05:30:00Z')})).created,false);
  assert.equal(state.rows.length,1);
  assert.equal(await store.saveFollowup(db,{group:{...g,items:[g.items[1]]},source:'overdue',now}),null);
});

test('followup: failed insert rolls back and releases scope; manual followed by automatic records marker', async () => {
  const {db,state} = queueDb(); state.failInsert=true;
  await assert.rejects(store.saveFollowup(db,{group:group(),actor,now}),/SYNTHETIC/);
  assert.equal(state.rows.length,0); state.failInsert=false;
  await store.saveFollowup(db,{group:group(),actor,now});
  await store.saveFollowup(db,{group:group(),source:'overdue',now});
  assert.ok(state.rows[0].auto_key); assert.equal(state.rows.length,1);
  assert.equal((await store.saveFollowup(db,{group:group(),source:'overdue',now:new Date(now.getTime()+86400000)})).created,false);
});

test('inbox: admin/accounting can list/acknowledge/resolve; pending count persists until resolved; 403/404/409/422', async () => {
  const {db} = queueDb(); const created = await store.saveFollowup(db,{group:group(),actor,now});
  for (const role of ['admin','super_admin','accounting','accountant']) {
    const result = await store.listFollowups(db,{user:{...user,role},status:'open'});
    assert.equal(result.items.length,1); assert.equal(result.pending_count,1); assert.equal(result.notification.channel,'in_app');
  }
  for (const fn of [() => store.listFollowups(db,{user}),() => store.updateFollowup(db,{user,id:1,status:'resolved'})]) await assert.rejects(fn, {code:'FORBIDDEN'});
  await assert.rejects(store.listFollowups(db,{user:manager,status:'bad'}),{code:'VALIDATION_FAILED'});
  await assert.rejects(store.updateFollowup(db,{user:manager,id:999,status:'resolved'}),{code:'NOT_FOUND'});
  await assert.rejects(store.updateFollowup(db,{user:manager,id:'1 OR 1=1',status:'resolved'}),{code:'VALIDATION_FAILED'});
  await store.updateFollowup(db,{user:manager,id:created.followup.id,status:'acknowledged',now});
  assert.equal((await store.listFollowups(db,{user:manager,status:'pending'})).pending_count,1);
  assert.equal((await store.listFollowups(db,{user:manager,status:'open'})).items.length,0);
  await store.updateFollowup(db,{user:manager,id:created.followup.id,status:'resolved',now});
  assert.equal((await store.listFollowups(db,{user:manager,status:'pending'})).pending_count,0);
  await assert.rejects(store.updateFollowup(db,{user:manager,id:1,status:'acknowledged'}),{code:'NOT_DRAFT'});
  assert.equal((await store.updateFollowup(db,{user:manager,id:1,status:'resolved'})).status,'resolved');
});

test('queue schema: idempotent additive tables, no old ALTER, production requires explicit migration', async () => {
  const {db,state} = queueDb();
  await ensureQueueTables(db,{force:true}); await ensureQueueTables(db,{force:true});
  assert.equal(state.queries.length,QUEUE_DDL.length*2);
  assert.ok(state.queries.every(q => q.sql.startsWith('CREATE TABLE IF NOT EXISTS')));
  assert.ok(QUEUE_DDL.some(sql => sql.includes('UNIQUE KEY uq_receiving_followup_auto')));
  const before = state.queries.length;
  await ensureQueueTables(db,{env:{NODE_ENV:'production'}}); assert.equal(state.queries.length,before);
});

test('Bangkok due dates: UTC midnight boundary, month/year rollover independent of machine zone', () => {
  assert.equal(toBangkokDateKey(new Date('2026-10-16T17:00:00Z')),today);
  assert.equal(toBangkokDateKey(new Date('2026-10-16T16:59:59Z')),'2026-10-16');
  assert.equal(groupQueue([row(1,{order_date:'2026-12-31'})],'2027-01-02',[{supplier_key:'pg:1',lead_days:2}])[0].status,'due_today');
});


test('expected real model: lead config applied, automatically records overdue only on current Bangkok business day', async () => {
  const events = [];
  const h = await createReceivingHarness({ testDate: today, queueLeads:[{supplier_key:'pg:3',lead_days:2}], saveQueueFollowup: async args => { events.push(args); } });
  h.state.orderItems = [{...h.state.orderItems[0],order_date:addDaysToDateKey(h.today,-3)}];
  const result = await h.invoke('getExpected',{user});
  assert.equal(result.statusCode,200); assert.equal(result.body.data[0].lead_days,2);
  assert.equal(result.body.data[0].status,'overdue'); assert.equal(events.length,1); assert.equal(events[0].source,'overdue');
  await h.invoke('getExpected',{user,query:{date:addDaysToDateKey(h.today,-1)}}); assert.equal(events.length,1);
});
