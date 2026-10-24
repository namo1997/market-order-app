import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceivingHarness, deltaActor as user } from './helpers/receiving-fake-db.mjs';

// Device test 2026-10-24: a walk-in draft left empty for a shop was resumed by the queue/create
// request that selected the shop's order, and came back without its order lines (draft #74 on staging).
const create = (h, uuid, patch = {}) => h.invoke('createDocument', { user, body: {
  client_uuid: uuid, delivery_date: h.today, kind: 'manual_receipt', product_group_id: 3, order_item_ids: [], resume_draft: true, ...patch } });
const orderIds = result => result.body.data.lines.map(line => line.order_item_id);

test('an empty walk-in draft resumed with the shop\'s order gets the order lines once', async () => {
  const h = await createReceivingHarness({ testDate: '2026-10-20', prepareCount: false });
  const first = await create(h, 'resume-empty');
  assert.equal(first.statusCode, 201); assert.equal(first.body.data.lines.length, 0);
  const second = await create(h, 'resume-with-order', { order_item_ids: [50, 51] });
  assert.equal(second.statusCode, 200); assert.equal(second.body.data.id, first.body.data.id);
  assert.deepEqual(orderIds(second), [50, 51]);
  assert.equal(second.body.data.kind, 'manual_receipt');
  const third = await create(h, 'resume-again', { order_item_ids: [50, 51] });
  assert.equal(third.body.data.lines.length, 2, 'no duplicate lines on a later resume');
  assert.ok(h.state.audits.some(a => a.action === 'resume_order_lines' && a.document_id === first.body.data.id));
});

test('a draft with an earlier order selection and a counted draft keep their lines', async () => {
  const h = await createReceivingHarness({ testDate: '2026-10-20', prepareCount: false });
  const partial = await create(h, 'resume-partial', { order_item_ids: [50] });
  assert.equal(partial.statusCode, 201);
  const resumed = await create(h, 'resume-partial-more', { order_item_ids: [50, 51] });
  assert.equal(resumed.body.data.id, partial.body.data.id); assert.deepEqual(orderIds(resumed), [50]);

  const other = await createReceivingHarness({ testDate: '2026-10-20', prepareCount: false });
  const empty = await create(other, 'resume-counted');
  other.state.documents.find(d => d.id === empty.body.data.id).counted_complete_at = '2026-10-20 08:00:00';
  const after = await create(other, 'resume-counted-order', { order_item_ids: [50, 51] });
  assert.equal(after.body.data.id, empty.body.data.id); assert.equal(after.body.data.lines.length, 0);
});

test('a line already holding an ordered product is linked instead of duplicated', async () => {
  const h = await createReceivingHarness({ testDate: '2026-10-20', prepareCount: false });
  const first = await create(h, 'resume-held');
  const docId = first.body.data.id;
  h.state.lines.push({ id: 900, document_id: docId, line_no: 1, bill_text: 'หมูสามชั้น', product_id: 7, product_name: 'หมูสามชั้น',
    order_item_id: null, unit_text: 'กก.', unit_id: 2, unit_multiplier: 1, quantity_billed: null, quantity_received: 0,
    unit_price: null, base_unit_price: null, amount: null, match_source: 'manual', match_confidence: null, is_user_edited: true });
  const resumed = await create(h, 'resume-held-order', { order_item_ids: [50, 51] });
  assert.equal(resumed.body.data.id, docId);
  const lines = resumed.body.data.lines;
  assert.equal(lines.length, 2);
  assert.equal(lines.find(line => line.id === 900).order_item_id, 50, 'the held product line is linked to its order item');
  assert.equal(lines.find(line => line.id !== 900).order_item_id, 51, 'the other ordered item is appended');
});
