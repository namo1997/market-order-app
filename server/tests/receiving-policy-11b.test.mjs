import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createReceivingHarness, deltaActor as user, makePngDataUrl, readyDeltaBill } from './helpers/receiving-fake-db.mjs';

// Policy 11b: confirming a receiving document keeps the bill price on the document line and never
// writes order_items.actual_price (the purchase-walk price used by reports and accounting-export).
const item = h => h.state.orderItems.find(row => row.id === 50);

for (const prior of [null, 8.5]) {
  test(`11b confirm leaves actual_price untouched (prior ${prior}); bill price stays on the document line; void keeps it`, async () => {
    const h = await createReceivingHarness();
    item(h).actual_price = prior;
    const id = await readyDeltaBill(h, user, `p11b-${prior}`, '2.25', '12.00');
    assert.equal(item(h).actual_price, prior);
    assert.equal(item(h).received_quantity, 2.25);
    const line = h.state.lines.find(row => row.document_id === Number(id));
    assert.equal(Number(line.unit_price), 12);
    assert.equal(Number(line.prev_order_actual_price ?? null), Number(prior ?? 0) || 0);
    assert.equal(line.applied_order_actual_price ?? null, prior, 'snapshot records "unchanged"');
    assert.equal((await h.invoke('voidDocument', { user, params: { id }, body: { reason: 'p11b' } })).statusCode, 200);
    assert.equal(item(h).actual_price, prior);
    assert.equal(item(h).received_quantity ?? 0, 0);
  });
}

test('11b a purchase-walk price set after confirm survives void of the new-policy document', async () => {
  const h = await createReceivingHarness();
  const id = await readyDeltaBill(h, user, 'p11b-walk', '2.25', '12.00');
  item(h).actual_price = 9.75; // purchase walk confirms its own price later
  assert.equal((await h.invoke('voidDocument', { user, params: { id }, body: { reason: 'p11b' } })).statusCode, 200);
  assert.equal(item(h).actual_price, 9.75);
});

test('11b two bills on one order item never change a purchase-walk price; voiding either keeps it', async () => {
  const h = await createReceivingHarness();
  item(h).actual_price = 11.5; item(h).is_purchased = true;
  const ids = [await readyDeltaBill(h, user, 'p11b-a', '2.25', '10.00'), await readyDeltaBill(h, user, 'p11b-b', '3.50', '14.00')];
  assert.equal(item(h).actual_price, 11.5);
  for (const id of ids) assert.equal((await h.invoke('voidDocument', { user, params: { id }, body: { reason: 'p11b' } })).statusCode, 200);
  assert.equal(item(h).actual_price, 11.5);
});

for (const prior of [null, 8.5]) {
  test(`11b void of a legacy document that wrote actual_price still restores prior ${prior}`, async () => {
    const h = await createReceivingHarness();
    item(h).actual_price = prior;
    const id = await readyDeltaBill(h, user, `p11b-legacy-${prior}`, '2.25', '12.00');
    // Rewrite state to what the pre-11b confirm produced: price written + snapshot of the write.
    item(h).actual_price = 12;
    const line = h.state.lines.find(row => row.document_id === Number(id));
    line.prev_order_actual_price = prior; line.applied_order_actual_price = 12;
    assert.equal((await h.invoke('voidDocument', { user, params: { id }, body: { reason: 'legacy' } })).statusCode, 200);
    assert.equal(item(h).actual_price, prior);
    assert.equal(item(h).received_quantity ?? 0, 0);
  });
}

test('11b void of a legacy document keeps a purchase-walk price edited after confirm', async () => {
  const h = await createReceivingHarness();
  const id = await readyDeltaBill(h, user, 'p11b-legacy-edited', '2.25', '12.00');
  item(h).actual_price = 13.25; // purchase walk replaced the legacy-written 12
  const line = h.state.lines.find(row => row.document_id === Number(id));
  line.prev_order_actual_price = null; line.applied_order_actual_price = 12;
  assert.equal((await h.invoke('voidDocument', { user, params: { id }, body: { reason: 'legacy' } })).statusCode, 200);
  assert.equal(item(h).actual_price, 13.25);
});

test('11b price mismatch (price_review) still creates the followup issue and writes no actual_price', async () => {
  const followups = [];
  const h = await createReceivingHarness({ saveQueueFollowup: async args => { followups.push(args); return { created: true }; } });
  const created = await h.invoke('createDocument', { user, body: { client_uuid: 'p11b-price', delivery_date: h.today, kind: 'bill', order_item_ids: [50] } });
  assert.equal(created.statusCode, 201);
  const id = String(created.body.data.id);
  const changed = await h.invoke('updateDocument', { user, params: { id }, body: { lines: [{ id: created.body.data.lines[0].id, line_no: 1,
    bill_text: 'p11b', product_id: 7, order_item_id: 50, quantity_received: '2', unit_price: '99.00', review_decision: 'price_review' }] } });
  assert.equal(changed.statusCode, 200, JSON.stringify(changed.body));
  assert.equal((await h.invoke('addSignature', { user, params: { id }, body: { role: 'receiver', image_data_url: makePngDataUrl() } })).statusCode, 200);
  assert.equal((await h.invoke('confirmDocument', { user, params: { id } })).statusCode, 200);
  assert.equal(followups.length, 1);
  assert.equal(followups[0].group.items[0].review_decision, 'price_review');
  assert.equal(followups[0].group.items[0].document_id, Number(id));
  assert.equal(item(h).actual_price, null);
});

test('11b accounting-export and report SQL keep treating order_items.actual_price as the purchase-walk price', async () => {
  const exportSrc = await readFile(new URL('../src/models/accounting-export.model.js', import.meta.url), 'utf8');
  assert.match(exportSrc, /actual_price > 0/);
  assert.match(exportSrc, /COALESCE\(oi\.is_purchased, false\) = true/);
  const settlement = await readFile(new URL('../src/models/receiving-documents-settlement.js', import.meta.url), 'utf8');
  assert.doesNotMatch(settlement, /UPDATE order_items\s+SET actual_price/, 'confirm must not write actual_price');
});
