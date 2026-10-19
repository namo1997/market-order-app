import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceivingHarness, deltaActor as user, makePngDataUrl, settlementRows } from './helpers/receiving-fake-db.mjs';
async function setup(options = {}, kind = 'manual_receipt') {
  const h = await createReceivingHarness({ prepareCount: false, ...options });
  const created = await h.invoke('createDocument', { user, body: { client_uuid: 'round-j-manual', kind, delivery_date: h.today, product_group_id: 3, order_item_ids: [50, 51] } });
  assert.equal(created.statusCode, 201); const doc = created.body.data, params = { id: String(doc.id) };
  const body = { client_uuid: doc.client_uuid, lines: doc.lines.map((line, i) => ({ id: line.id, counted_quantity: i ? '0' : '4.50' })) };
  const count = actor => h.invoke('saveCount', { user: actor || user, params, body: structuredClone(body) });
  const sign = actor => h.invoke('addSignature', { user: actor || user, params, body: { role: 'receiver', image_data_url: makePngDataUrl() } });
  return { h, doc, params, body, count, sign };
}

test('J2 manual receipt counts, signs and settles without bill image or OCR; retries never double stock and void reverses own stock', async () => {
  const { h, params, count, sign } = await setup();
  assert.equal((await sign()).statusCode, 409);
  const result = await count(); assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.data.lines.map(l => l.review_decision), ['missing_bill', 'missing_bill']);
  assert.deepEqual(result.body.data.lines.map(l => l.counted_quantity), ['4.50', '0.00']);
  assert.equal(result.body.data.images.length, 0); assert.equal(result.body.data.ocr.status, 'none');
  const beforeRetry = structuredClone(h.state); assert.equal((await count()).statusCode, 200); assert.deepEqual(h.state, beforeRetry);
  assert.equal((await sign()).statusCode, 200);
  const confirm = () => h.invoke('confirmDocument', { user, params });
  assert.equal((await confirm()).statusCode, 200);
  assert.equal(h.state.orderItems.find(r => r.id === 50).received_quantity, 4.5);
  assert.equal(h.state.inventoryBalances.get('7:10').quantity, 9.5);
  assert.equal(h.state.aliases.length, 0);
  const settled = settlementRows(h.state); await confirm(); assert.deepEqual(settlementRows(h.state), settled);
  assert.equal((await h.invoke('voidDocument', { user: { ...user, role: 'admin' }, params, body: { reason: 'synthetic rollback' } })).statusCode, 200);
  assert.equal(h.state.inventoryBalances.get('7:10').quantity, 5);
});

test('J2 manual count and missing-bill decisions roll back together if acknowledgement fails; scope, validation, missing and terminal guards remain', async () => {
  let fail = true;
  const { h, params, body, count, sign } = await setup({ queryHook: sql => { if (fail && sql.includes('SET review_decision = ?')) throw Error('synthetic acknowledgement failure'); } });
  const before = structuredClone(h.state); assert.equal((await count()).statusCode, 500); assert.deepEqual(h.state, before); assert.equal((await sign()).statusCode, 409);
  fail = false;
  assert.equal((await count({ ...user, branch_id: 2 })).statusCode, 403);
  assert.equal((await h.invoke('saveCount', { user, params, body: { ...body, lines: body.lines.slice(1) } })).statusCode, 422);
  assert.equal((await h.invoke('saveCount', { user, params: { id: '9999' }, body })).statusCode, 404);
  assert.equal((await count()).statusCode, 200);
  assert.equal((await sign({ ...user, department_id: 30 })).statusCode, 403);
  for (const status of ['confirmed', 'void']) { h.state.documents[0].status = status; assert.equal((await count()).statusCode, 409); assert.equal((await sign()).statusCode, 409); }
});

test('J2 manual concurrent count commits one snapshot/acknowledgement; bill counts still require explicit review before signature', async () => {
  const { h, count } = await setup({ serializeTransactions: true });
  assert.deepEqual((await Promise.all([count(), count()])).map(r => r.statusCode), [200, 200]);
  assert.equal(h.state.audits.filter(a => a.action === 'blind_count').length, 1);
  const bill = await setup({}, 'bill'); assert.equal((await bill.count()).statusCode, 200);
  assert.ok(bill.h.state.lines.every(l => !l.review_decision)); assert.equal((await bill.sign()).statusCode, 409);
});

test('J2 branch manual receipt keeps blind totals hidden, acknowledges every allocation, and signs with no images or OCR', async () => {
  const h = await createReceivingHarness({ prepareCount: false });
  const first = h.state.orderItems.find(r => r.id === 50); first.quantity = 6;
  h.state.orderItems.push({ ...structuredClone(first), id: 60, order_id: 3, quantity: 4, department_id: 30, department_name: 'สโตร์', received_quantity: null });
  const created = await h.invoke('createDocument', { user, body: { client_uuid: 'manual-branch-j', kind: 'manual_receipt', scope: 'branch', delivery_date: h.today, product_group_id: 3, order_item_ids: [50, 60] } });
  assert.equal(created.statusCode, 201); const doc = created.body.data, params = { id: String(doc.id) };
  assert.equal(doc.lines.length, 1); assert.equal(doc.lines[0].quantity_ordered, undefined); assert.equal(doc.lines[0].departments, undefined);
  const counted = await h.invoke('saveCount', { user, params, body: { client_uuid: doc.client_uuid, lines: [{ id: doc.lines[0].id, counted_quantity: '5' }] } });
  assert.equal(counted.statusCode, 200); assert.equal(counted.body.data.lines[0].review_decision, 'missing_bill');
  assert.deepEqual(h.state.lines.map(l => Number(l.counted_quantity)), [3, 2]); assert.ok(h.state.lines.every(l => l.review_decision === 'missing_bill'));
  assert.equal((await h.invoke('addSignature', { user, params, body: { role: 'receiver', image_data_url: makePngDataUrl() } })).statusCode, 200);
  assert.equal((await h.invoke('confirmDocument', { user, params })).statusCode, 200);
  assert.equal(h.state.inventoryBalances.get('7:10').quantity, 8); assert.equal(h.state.inventoryBalances.get('7:30').quantity, 2);
});
