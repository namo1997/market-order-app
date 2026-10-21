import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceivingHarness, makePngDataUrl, deltaActor as user } from './helpers/receiving-fake-db.mjs';
import { toBangkokDateKey } from '../src/utils/bangkok-date.js';

// Guards the harness business clock: with testDate pinned, row timestamps (confirmed_at) must land on that
// Bangkok day, otherwise mayVoid (owner same-day / accounting 7 days) depends on the day the suite runs.
// Dates are far from "today" on purpose so this fails on any run date if the clock is not pinned.
async function confirmedDoc(h, uuid) {
  const created = await h.invoke('createDocument', { user, body: { client_uuid: uuid, delivery_date: h.today,
    kind: 'bill', product_group_id: 3, order_item_ids: [50] } });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const id = String(created.body.data.id);
  const lines = [{ id: created.body.data.lines[0]?.id, line_no: 1, product_id: 7, order_item_id: 50,
    bill_text: 'SYNTHETIC 7', quantity_received: '10', quantity_billed: '10', unit_price: '10.00' }];
  assert.equal((await h.invoke('updateDocument', { user, params: { id }, body: { lines } })).statusCode, 200);
  assert.equal((await h.invoke('addSignature', { user, params: { id },
    body: { role: 'receiver', image_data_url: makePngDataUrl() } })).statusCode, 200);
  const confirmed = await h.invoke('confirmDocument', { user, params: { id } });
  assert.equal(confirmed.statusCode, 200, JSON.stringify(confirmed.body));
  return id;
}

for (const testDate of ['2026-03-01', '2027-02-28', '2031-12-31']) {
  test(`harness clock pinned to ${testDate}: confirm stamps that Bangkok day and the owner can void same day`, async () => {
    const h = await createReceivingHarness({ testDate });
    const id = await confirmedDoc(h, `clock-${testDate}`);
    const doc = h.state.documents.find(row => String(row.id) === id);
    assert.equal(toBangkokDateKey(doc.confirmed_at), testDate);
    assert.equal(toBangkokDateKey(doc.created_at), testDate);
    const voided = await h.invoke('voidDocument', { user, params: { id }, body: { reason: 'ทดสอบนาฬิกา' } });
    assert.equal(voided.statusCode, 200, JSON.stringify(voided.body));
    assert.equal(toBangkokDateKey(h.state.documents.find(row => String(row.id) === id).voided_at), testDate);
  });
}
