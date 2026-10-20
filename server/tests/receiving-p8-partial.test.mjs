import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceivingHarness, deltaActor as user } from './helpers/receiving-fake-db.mjs';

const setup = async () => {
  const h = await createReceivingHarness({ prepareCount: false });
  Object.assign(h.state.orderItems.find(row => row.id === 50), { quantity: 10, received_quantity: 3 });
  const created = await h.invoke('createDocument', { user, body: { client_uuid: 'p8-fixture', delivery_date: h.today, product_group_id: 3, order_item_ids: [50, 51] } });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const doc = created.body.data; const params = { id: String(doc.id) };
  const count = () => h.invoke('saveCount', { user, params, body: { client_uuid: doc.client_uuid,
    lines: doc.lines.map(line => ({ id: line.id, counted_quantity: '2' })) } });
  return { h, doc, params, count };
};

test('P8: previous receipts stay hidden until the blind count is complete, on every read path', async () => {
  const { h, doc, params } = await setup();
  const reads = [doc, (await h.invoke('getDocumentById', { user, params })).body.data, ...(await h.invoke('listDocuments', { user })).body.data];
  for (const result of reads) {
    assert.equal(result.blind, true);
    for (const line of result.lines || []) for (const key of ['previously_received_quantity', 'quantity_ordered', 'received_quantity']) assert.equal(key in line, false, key);
    assert.doesNotMatch(JSON.stringify(result), /previously_received_quantity/);
  }
});

test('P8: after the count the document reports ordered and previously received so the remainder is derivable', async () => {
  const { h, params, count } = await setup();
  const saved = await count(); assert.equal(saved.statusCode, 200);
  const fetched = (await h.invoke('getDocumentById', { user, params })).body.data;
  for (const lines of [saved.body.data.lines, fetched.lines]) {
    const first = lines.find(line => line.order_item_id === 50);
    assert.equal(Number(first.quantity_ordered), 10); assert.equal(Number(first.previously_received_quantity), 3);
    const untouched = lines.find(line => line.order_item_id === 51);
    assert.equal(Number(untouched.previously_received_quantity), 0); assert.notEqual(untouched.previously_received_quantity, null);
  }
});

test('P8: a confirmed document does not claim a previous figure that already includes its own receipt', async () => {
  const { h, params, count } = await setup();
  await count(); h.state.documents[0].status = 'confirmed';
  const fetched = (await h.invoke('getDocumentById', { user, params })).body.data;
  assert.ok(fetched.lines.every(line => line.previously_received_quantity === null));
});
