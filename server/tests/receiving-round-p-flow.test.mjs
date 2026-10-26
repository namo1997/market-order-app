import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createReceivingHarness, deltaActor as user, makePngDataUrl, makeJpegDataUrl, settlementRows } from './helpers/receiving-fake-db.mjs';
import { mayVoid, receiptNote, appendReceiptNote, removeReceiptNote } from '../src/models/receiving-void-policy.js';
import { RECEIVING_GROUP_SQL } from '../src/models/receiving-group-sql.js';
const date = '2026-10-20';

async function draft(h, uuid, item = 50) {
  const created = await h.invoke('createDocument', { user, body: { client_uuid: uuid, delivery_date: date, kind: 'bill', product_group_id: 3, order_item_ids: [item] } });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  return created.body.data;
}
async function ready(h, uuid, quantity = '2', note) {
  const doc = await draft(h, uuid), id = String(doc.id);
  const update = await h.invoke('updateDocument', { user, params: { id }, body: { lines: [{ id: doc.lines[0].id, quantity_received: quantity, unit_price: '10', ...(note ? { note } : {}) }] } });
  assert.equal(update.statusCode, 200, JSON.stringify(update.body));
  assert.equal((await h.invoke('addSignature', { user, params: { id }, body: { role: 'receiver', image_data_url: makePngDataUrl() } })).statusCode, 200);
  assert.equal((await h.invoke('confirmDocument', { user, params: { id } })).statusCode, 200);
  return id;
}
test('O1 count preflight: strict >999 and >5x last receipt, same supplier/product/unit, blind and no writes', async () => {
  const h = await createReceivingHarness({ testDate: date, prepareCount: false });
  const doc = await draft(h, 'p-count');
  const raw = h.state.documents.find(d => d.id === doc.id);
  h.state.documents.push({ ...raw, id: 900, status: 'confirmed', confirmed_at: '2026-10-19T00:00:00Z' });
  h.state.lines.push({ ...h.state.lines[0], id: 900, document_id: 900, quantity_received: '10' });
  const original = settlementRows(h.state);
  for (const [qty, warned] of [['50',false],['50.01',true],['10144',true]]) {
    const result = await h.invoke('saveCount', { user, params: { id: doc.id }, body: { client_uuid: doc.client_uuid, check_only: true, lines: [{ id: doc.lines[0].id, counted_quantity: qty }] } });
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    assert.equal(result.body.data.count_warnings.length, Number(warned));
    assert.deepEqual(settlementRows(h.state), original);
    assert.doesNotMatch(JSON.stringify(result.body), /quantity_ordered|quantity_billed|last_quantity|doc_ref/);
  }
  h.state.lines.find(line => line.id === 900).quantity_received = '0.29';
  for (const [qty, warned] of [['1.45',false],['1.46',true]]) {
    const result = await h.invoke('saveCount', { user, params: { id: doc.id }, body: { client_uuid: doc.client_uuid, check_only: true, lines: [{ id: doc.lines[0].id, counted_quantity: qty }] } });
    assert.equal(result.body.data.count_warnings.length, Number(warned), 'strict 5x comparison uses integer precision');
  }
  h.state.documents.find(d => d.id === 900).product_group_id = 4;
  for (const [qty, warned] of [['999',false],['999.01',true]]) {
    const result = await h.invoke('saveCount', { user, params: { id: doc.id }, body: { client_uuid: doc.client_uuid, check_only: true, lines: [{ id: doc.lines[0].id, counted_quantity: qty }] } });
    assert.equal(result.body.data.count_warnings.length, Number(warned));
  }
  const saved = await h.invoke('saveCount', { user, params: { id: doc.id }, body: { client_uuid: doc.client_uuid, lines: [{ id: doc.lines[0].id, counted_quantity: '10144' }] } });
  assert.equal(saved.statusCode, 200, 'server never blocks unusually high count');
});
// Owner 2026-10-26 "ยกเลิกการถ่าย": a page photographed by mistake is removed from a draft; pages renumber and the read resets.
test('a saved bill page can be deleted from a draft; pages renumber, the read resets, confirmed receipts refuse', async () => {
  const h = await createReceivingHarness({ testDate: date, prepareCount: false });
  const doc = await draft(h, 'p-page-delete');
  for (const page_no of [1, 2]) assert.equal((await h.invoke('uploadImage', { user, params: { id: doc.id }, body: { page_no, image_data_url: makeJpegDataUrl(640, 480) } })).statusCode, 201);
  const pages = () => h.state.images.filter(i => i.document_id === doc.id).sort((a, b) => a.page_no - b.page_no).map(i => [i.id, i.page_no]);
  const [[firstId]] = pages();
  h.state.documents.find(d => d.id === doc.id).ocr_status = 'done';
  const removed = await h.invoke('deleteImage', { user, params: { id: doc.id, imageId: firstId } });
  assert.equal(removed.statusCode, 200, JSON.stringify(removed.body)); assert.equal(removed.body.data.pages_left, 1);
  assert.deepEqual(pages().map(([, n]) => n), [1], 'the remaining page becomes page 1');
  assert.equal(h.state.documents.find(d => d.id === doc.id).ocr_status, 'none', 'the bill is read again from what is left');
  assert.equal((await h.invoke('deleteImage', { user, params: { id: doc.id, imageId: 9999 } })).statusCode, 404);
  h.state.documents.find(d => d.id === doc.id).status = 'confirmed';
  assert.equal((await h.invoke('deleteImage', { user, params: { id: doc.id, imageId: pages()[0][0] } })).statusCode, 409);
  assert.equal(pages().length, 1);
});
// Owner 2026-10-23: a wrongly read bill row is removed with the count; order rows are not.
test('count removes non-order rows named in deleted_line_ids and refuses order rows and unknown ids', async () => {
  const h = await createReceivingHarness({ testDate: date, prepareCount: false });
  const doc = await draft(h, 'p-delete');
  h.state.lines.push({ ...h.state.lines.find(line => line.document_id === doc.id), id: 777, order_item_id: null, product_id: 9, product_name: 'กะเพราไช้', line_no: 9, counted_quantity: null });
  const lines = doc.lines.map(line => ({ id: line.id, counted_quantity: '1' }));
  const refused = await h.invoke('saveCount', { user, params: { id: doc.id }, body: { client_uuid: doc.client_uuid, deleted_line_ids: [doc.lines[0].id], lines } });
  assert.equal(refused.statusCode, 422); assert.match(refused.body.message, /ใบสั่ง/);
  assert.equal((await h.invoke('saveCount', { user, params: { id: doc.id }, body: { client_uuid: doc.client_uuid, deleted_line_ids: [4242], lines } })).statusCode, 422);
  const check = await h.invoke('saveCount', { user, params: { id: doc.id }, body: { client_uuid: doc.client_uuid, check_only: true, deleted_line_ids: [777], lines } });
  assert.equal(check.statusCode, 200, JSON.stringify(check.body)); assert.ok(h.state.lines.some(line => line.id === 777), 'preflight never deletes');
  const saved = await h.invoke('saveCount', { user, params: { id: doc.id }, body: { client_uuid: doc.client_uuid, deleted_line_ids: [777], lines } });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal(h.state.lines.some(line => line.id === 777), false);
  assert.deepEqual(saved.body.data.lines.map(line => line.id).sort(), doc.lines.map(line => line.id).sort());
});
test('O1 preflight new outside-order item rolls back temporary line and rejects invalid/scope/status', async () => {
  const h = await createReceivingHarness({ testDate: date, prepareCount: false });
  const created = await h.invoke('createDocument', { user, body: { client_uuid: 'p-new-count', delivery_date: date, kind: 'manual_receipt', product_group_id: 3 } });
  const doc = created.body.data, params = { id: doc.id };
  const body = { check_only: true, client_uuid: doc.client_uuid, lines: [{ product_id: 7, unit_text: 'ถุง', counted_quantity: '10144' }] };
  const before = settlementRows(h.state);
  assert.equal((await h.invoke('saveCount', { user, params, body: structuredClone(body) })).body.data.count_warnings.length, 1);
  assert.deepEqual(settlementRows(h.state), before);
  assert.equal((await h.invoke('saveCount', { user: { ...user, branch_id: 2, department_id: 20 }, params, body })).statusCode, 403);
  assert.equal((await h.invoke('saveCount', { user, params: { id: 999 }, body })).statusCode, 404);
  assert.equal((await h.invoke('saveCount', { user, params, body: { ...body, check_only: 'yes' } })).statusCode, 422);
  h.state.documents[0].status = 'confirmed';
  assert.equal((await h.invoke('saveCount', { user, params, body })).statusCode, 409);
});
test('#4 note PUT accepts 300/preserves omission/clears/rejects nontext and 301 with rollback', async () => {
  const h = await createReceivingHarness({ testDate: date });
  const doc = await draft(h, 'p-notes'), params = { id: doc.id };
  const update = note => h.invoke('updateDocument', { user, params, body: { lines: [{ id: doc.lines[0].id, note }] } });
  assert.equal((await update('ก'.repeat(300))).body.data.lines[0].note.length, 300);
  assert.equal((await h.invoke('updateDocument', { user, params, body: { lines: [{ id: doc.lines[0].id }] } })).body.data.lines[0].note.length, 300);
  const before = settlementRows(h.state);
  for (const note of ['ก'.repeat(301), {}, 4]) assert.equal((await update(note)).statusCode, 422);
  assert.deepEqual(settlementRows(h.state), before);
  assert.equal((await update(null)).body.data.lines[0].note, null);
});
test('#4 appended notes survive out-of-order voids of three receipts, original notes and totals restored', async () => {
  const h = await createReceivingHarness({ testDate: date });
  h.state.orderItems.find(i => i.id === 50).receive_notes = 'หมายเหตุเดิม';
  const ids = [];
  for (let n=0;n<3;n++) {
    ids.push(await ready(h, `p-chain-${n}`, '2', `โทรสั่ง ${n}`));
  }
  const item = () => h.state.orderItems.find(i => i.id === 50);
  assert.equal(item().receive_notes, ['หมายเหตุเดิม', ...ids.map((id,n) => receiptNote(id, `โทรสั่ง ${n}`))].join('\n'));
  for (const index of [0,2,1]) {
    assert.equal((await h.invoke('voidDocument', { user, params: { id: ids[index] }, body: { reason: 'แก้จำนวน' } })).statusCode, 200);
    assert.ok(!item().receive_notes.includes(`เอกสาร #${ids[index]}:`));
  }
  assert.equal(item().receive_notes, 'หมายเหตุเดิม');
  assert.equal(item().received_quantity, null);
});
test('#5 void role policy includes accounting day 7, rejects day 8/future, owner Bangkok same day and admin always', () => {
  const args = { today: date, referenceDay: '2026-10-13', role: 'accounting' };
  assert.equal(mayVoid(args), true);
  assert.equal(mayVoid({ ...args, referenceDay: '2026-10-12' }), false);
  assert.equal(mayVoid({ ...args, referenceDay: '2026-10-21' }), false);
  assert.equal(mayVoid({ ...args, role: 'accountant' }), false);
  assert.equal(mayVoid({ ...args, role: 'user', isOwner: true }), false);
  assert.equal(mayVoid({ ...args, role: 'user', isOwner: true, referenceDay: date }), true);
  assert.equal(mayVoid({ ...args, isAdmin: true, referenceDay: '2020-01-01' }), true);
});
test('#5 accounting void day 7 restores stock and audits; day 8 or other branch cannot write', async () => {
  for (const [day, actor, code] of [['2026-10-13',{ ...user, id: 13, role:'accounting' },200],['2026-10-12',{ ...user, role:'accounting' },403],['2026-10-13',{ ...user, branch_id:2, department_id:20, role:'accounting' },403]]) {
    const h=await createReceivingHarness({testDate:date}); const id=await ready(h,'p-void');
    h.state.documents[0].confirmed_at=`${day}T05:00:00Z`;
    const before=settlementRows(h.state);
    const result=await h.invoke('voidDocument',{user:actor,params:{id},body:{reason:'แก้ข้ามวัน'}});
    assert.equal(result.statusCode,code,JSON.stringify(result.body));
    if(code===200) { assert.equal(h.state.inventoryBalances.get('7:10').quantity,5); assert.ok(h.state.audits.some(a=>a.action==='void')); }
    else assert.deepEqual(settlementRows(h.state),before);
  }
});
test('#6 legacy and queue interpolate identical fixed multi-group/internal resolution SQL in priority order', async () => {
  const legacy=await readFile(new URL('../src/models/order.model.js',import.meta.url),'utf8');
  const queue=await readFile(new URL('../src/models/receiving-documents-helpers.js',import.meta.url),'utf8');
  for (const source of [legacy,queue]) assert.ok(source.includes('${RECEIVING_GROUP_SQL}'));
  const terms=['oi.source_product_group_id','pgws.source_department_id = wbm.source_department_id','pgs_scope.department_id = d.id','pg_map.linked_department_id = wbm.source_department_id','      p.product_group_id'];
  assert.deepEqual(terms.map(t=>RECEIVING_GROUP_SQL.indexOf(t)),terms.map(t=>RECEIVING_GROUP_SQL.indexOf(t)).sort((a,b)=>a-b));
  assert.ok(terms.every(t=>RECEIVING_GROUP_SQL.includes(t)));
  assert.match(queue,/withdraw_branch_source_mappings wbm ON wbm.target_branch_id = b.id/);
});
test('#7 carryover remains pending through day 90 only; completed/noncarryover/other branch excluded and age stays blind', async () => {
  const h=await createReceivingHarness({testDate:date});
  const base=h.state.orderItems.find(i=>i.id===50);
  h.state.orderItems=[8,90,91].map((days,i)=>({...base,id:100+i,order_date:new Date(Date.parse(date)-days*86400000).toISOString().slice(0,10),allow_pending_carryover:1}));
  h.state.orderItems.push({...h.state.orderItems[0],id:200,allow_pending_carryover:0},{...h.state.orderItems[0],id:201,received_quantity:10,is_received:true},{...h.state.orderItems[0],id:202,branch_id:2,department_id:20});
  const response=await h.invoke('getExpected',{user,query:{date}});
  assert.equal(response.statusCode,200,JSON.stringify(response.body));
  const items=response.body.data.flatMap(g=>g.items);
  assert.deepEqual(items.map(i=>i.age_days).sort((a,b)=>a-b),[8,90]);
  assert.doesNotMatch(JSON.stringify(items),/quantity_ordered|quantity_billed|received_quantity/);
});
test('#9 archive model uses SELECT only; legacy write routes and price policy stay for rollout #10/#11', async () => {
  const source=await readFile(new URL('../src/models/order.model.js',import.meta.url),'utf8');
  const archive=source.slice(source.indexOf('export const listReceivingBillPhotos'),source.indexOf('export const countReceivingBillPhotos'));
  assert.doesNotMatch(archive,/await ensure|INSERT|UPDATE|CREATE|ALTER|DELETE/);
  const routes=await readFile(new URL('../src/routes/orders.routes.js',import.meta.url),'utf8');
  assert.match(routes,/router.get\('\/receiving\/bill-photos'/);
  assert.match(routes,/router.put\('\/receiving'/);
});
test('#4 legacy receipt notes with doc_ref rebase correctly before voiding a successor',async()=>{
 const h=await createReceivingHarness({testDate:date});
 const first=await ready(h,'P-legacy');
 const item=()=>h.state.orderItems.find(i=>i.id===50);
 h.state.documents.find(d=>d.id===Number(first)).doc_ref='OLD-INV';
 item().receive_notes=`รับสินค้าตามเอกสาร #${first} (OLD-INV)`;
 const second=await ready(h,'P-after-legacy','2','สั่งนอกรอบ');
 for(const id of [first,second]) assert.equal((await h.invoke('voidDocument',{user,params:{id},body:{reason:'แก้'}})).statusCode,200);
 assert.equal(item().received_quantity,null);assert.equal(item().receive_notes,null);
});
