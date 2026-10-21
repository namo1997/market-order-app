import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceivingHarness, deltaActor as user, makeJpegDataUrl, makePngDataUrl, settlementRows } from './helpers/receiving-fake-db.mjs';
import * as ocr from '../src/services/receiving-ocr.service.js';
const setup = async (options = {}) => {
  const h = await createReceivingHarness({ prepareCount: false, ...options });
  const response = await h.invoke('createDocument', { user, body: { client_uuid: 'blind-fixture', delivery_date: h.today, product_group_id: 3, order_item_ids: [50, 51] } });
  assert.equal(response.statusCode, 201);
  const doc = response.body.data;
  const params = { id: String(doc.id) };
  const count = (lines = doc.lines.map(line => ({ id: line.id, counted_quantity: line.id === doc.lines[0].id ? '4.50' : '0' })), actor = user) => h.invoke('saveCount', { user: actor, params, body: { client_uuid: doc.client_uuid, lines } });
  return { h, doc, params, count };
};
test('blind API: create/get/list and expected expose no order, bill, OCR, prices or department weights', async () => {
  const { h, doc, params } = await setup();
  h.state.documents[0].ocr_result_json = JSON.stringify({ raw_read: { total: 98765 }, line_reads: [{ bill_text: 'SECRET', bill_read: { amount: 98765 } }] });
  h.state.documents[0].total = 98765;
  for (const result of [doc, (await h.invoke('getDocumentById', { user, params })).body.data, ...(await h.invoke('listDocuments', { user })).body.data]) {
    assert.equal(result.total, null); assert.equal(result.ocr.status, 'locked'); assert.equal(result.blind, true);
    for (const line of result.lines || []) for (const key of ['quantity_received', 'quantity_billed', 'quantity_ordered', 'unit_price', 'amount', 'bill_read', 'departments']) assert.equal(key in line, false, key);
    assert.doesNotMatch(JSON.stringify(result), /98765|SECRET/);
  }
  const groups = (await h.invoke('getExpected', { user, query: { date: h.today } })).body.data;
  for (const line of groups.flatMap(group => group.items)) {
    assert.equal(typeof line.has_pending, 'boolean');
    for (const key of ['quantity_ordered', 'remaining_quantity', 'received_quantity', 'requested_price', 'actual_price']) assert.equal(key in line, false, key);
  }
});
test('blind API: direct OCR, update, image, signature and confirm are blocked before any count, including admin', async () => {
  const { h, params } = await setup();
  const uploaded = await h.invoke('uploadImage', { user, params, body: { page_no: 1, image_data_url: makeJpegDataUrl() } });
  assert.equal(uploaded.statusCode, 201);
  for (const actor of [user, { ...user, role: 'admin' }]) for (const [name, body, extra] of [
    ['updateDocument', { total: '10', lines: [] }, {}],
    ['getImageBinary', {}, { imageId: String(uploaded.body.data.image_id) }],
    ['addSignature', { role: 'receiver', image_data_url: makePngDataUrl() }, {}], ['confirmDocument', {}, {}],
  ]) assert.equal((await h.invoke(name, { user: actor, params: { ...params, ...extra }, body })).statusCode, 409, name);
  assert.equal(h.state.inventoryTransactions.length, 0); assert.equal(h.state.documents[0].ocr_attempt_count || 0, 0);
});
test('blind API: empty, missing, duplicate, negative, malformed, huge counts and wrong UUID reject atomically', async () => {
  const { h, doc, params, count } = await setup();
  const good = doc.lines.map(line => ({ id: line.id, counted_quantity: '1' }));
  for (const lines of [[], good.slice(1), [good[0], good[0]], ...['', null, '-1', '1e2', '100000000', 'NaN'].map(value => [{ ...good[0], counted_quantity: value }, good[1]])]) {
    assert.equal((await count(lines)).statusCode, 422);
    assert.equal(h.state.documents[0].counted_complete_at, undefined);
    assert.ok(h.state.lines.every(line => line.counted_quantity == null));
  }
  assert.equal((await h.invoke('saveCount', { user, params, body: { client_uuid: 'wrong', lines: good } })).statusCode, 422);
});
test('blind API: 0 is intentional; complete count reveals bill and immutable provenance; retry same UUID is idempotent', async () => {
  const { h, count } = await setup();
  const saved = await count(); assert.equal(saved.statusCode, 200);
  assert.equal(saved.body.data.lines[0].counted_quantity, '4.50'); assert.equal(saved.body.data.lines[1].counted_quantity, '0.00');
  assert.equal(saved.body.data.lines[0].counted_by, user.id); assert.ok(saved.body.data.counted_complete_at);
  const before = structuredClone(h.state);
  assert.equal((await count()).statusCode, 200); assert.deepEqual(h.state, before);
  assert.equal((await count(saved.body.data.lines.map(line => ({ id: line.id, counted_quantity: '9' })))).statusCode, 409);
});
test('blind API: cross department/branch are denied, unknown is 404, confirmed/void reject count', async () => {
  const { h, params, count } = await setup();
  for (const actor of [{ ...user, department_id: 30 }, { ...user, branch_id: 2, department_id: 20 }]) assert.equal((await count(undefined, actor)).statusCode, 403);
  assert.equal((await h.invoke('saveCount', { user, params: { id: '9999' }, body: {} })).statusCode, 404);
  for (const status of ['confirmed', 'void']) { h.state.documents[0].status = status; assert.equal((await count()).statusCode, 409); }
});
test('blind API: failure halfway through count rolls back counts, receipt quantities, audit and reveal', async () => {
  let writes = 0;
  const { h, count } = await setup({ queryHook: sql => { if (sql.replace(/\s+/g, ' ').includes('SET counted_quantity = ?') && ++writes === 2) throw Error('fixture count failure'); } });
  const before = structuredClone(h.state);
  assert.equal((await count()).statusCode, 500); assert.deepEqual(h.state, before);
});
test('blind API: simultaneous count retries serialize to one snapshot and one audit', async () => {
  const { h, count } = await setup({ serializeTransactions: true });
  const results = await Promise.all([count(), count()]); assert.deepEqual(results.map(result => result.statusCode), [200, 200]);
  assert.equal(h.state.audits.filter(audit => audit.action === 'blind_count').length, 1);
});
test('blind API: OCR preserves count IDs and values, manual correction is audited after reveal and cannot rewrite original count', async () => {
  const { h, doc, params, count } = await setup();
  await count(); await h.invoke('uploadImage', { user, params, body: { page_no: 1, image_data_url: makeJpegDataUrl() } });
  ocr.setCustomOcrProvider(async () => ({ doc_date: h.today, total: 900, confidence: 1,
    lines: [{ bill_text: 'หมูสามชั้น', quantity_billed: 6, unit_text: 'กก.', unit_price: 150, amount: 900 }] }));
  try {
    const read = await h.invoke('runOcr', { user, params }); assert.equal(read.statusCode, 200);
    const line = read.body.data.lines.find(line => line.id === doc.lines[0].id);
    assert.equal(line.counted_quantity, '4.50'); assert.equal(Number(line.quantity_received), 4.5); assert.equal(Number(line.quantity_billed), 6);
    const edited = await h.invoke('updateDocument', { user, params, body: { lines: [{ id: line.id, quantity_received: '4.75', review_decision: 'short' }] } });
    assert.equal(edited.statusCode, 200); assert.equal(edited.body.data.lines[0].counted_quantity, '4.50');
    assert.ok(h.state.audits.some(audit => audit.action === 'edit_after_bill_reveal'));
    assert.equal((await h.invoke('updateDocument', { user, params, body: { lines: [{ id: line.id, counted_quantity: '8' }] } })).statusCode, 422);
  } finally { ocr.setCustomOcrProvider(null); }
});
test('blind API: branch totals redact allocation weights; count allocates exact hundredths with original evidence', async () => {
  const h = await createReceivingHarness({ prepareCount: false });
  const created = await h.invoke('createDocument', { user, body: { client_uuid: 'branch-blind', scope: 'branch', product_group_id: 3, delivery_date: h.today, order_item_ids: [50, 51] } });
  assert.equal(created.statusCode, 201); const doc = created.body.data;
  assert.ok(doc.lines.every(line => !('departments' in line)));
  const saved = await h.invoke('saveCount', { user: { ...user, department_id: 30 }, params: { id: doc.id }, body: { client_uuid: doc.client_uuid, lines: doc.lines.map(line => ({ id: line.id, counted_quantity: '0.01' })) } });
  assert.equal(saved.statusCode, 200); assert.equal(saved.body.data.lines[0].counted_quantity, '0.01');
});
test('blind API: count-first manual product does not need an order and input names cannot spoof catalog', async () => {
  const h = await createReceivingHarness({ prepareCount: false });
  const created = await h.invoke('createDocument', { user, body: { client_uuid: 'manual-count', delivery_date: h.today, kind: 'manual_receipt' } });
  assert.equal((await h.invoke('saveCount', { user, params: { id: created.body.data.id }, body: { client_uuid: 'manual-count', lines: [{ product_id: 7, counted_quantity: '1', unit_text: 'x'.repeat(101) }] } })).statusCode, 422);
  const saved = await h.invoke('saveCount', { user, params: { id: created.body.data.id }, body: { client_uuid: 'manual-count', lines: [{ product_id: 7, product_name: 'spoof', counted_quantity: '2.25', unit_text: 'กก.' }] } });
  assert.equal(saved.statusCode, 200); assert.notEqual(saved.body.data.lines[0].product_name, 'spoof'); assert.equal(saved.body.data.lines[0].counted_quantity, '2.25');
});
test('blind decisions: signature/confirm require every decision and all post-reveal edits invalidate signatures', async () => {
  const { h, params, count } = await setup(); await count();
  assert.equal((await h.invoke('addSignature', { user, params, body: { role: 'receiver', image_data_url: makePngDataUrl() } })).statusCode, 409);
  const lines = h.state.lines.map(line => ({ id: line.id, review_decision: 'accept' }));
  assert.equal((await h.invoke('updateDocument', { user, params, body: { lines } })).statusCode, 200);
  assert.equal((await h.invoke('addSignature', { user, params, body: { role: 'receiver', image_data_url: makePngDataUrl() } })).statusCode, 200);
  assert.equal((await h.invoke('updateDocument', { user, params, body: { lines: [{ id: lines[0].id, quantity_received: '3' }] } })).statusCode, 200);
  assert.equal((await h.invoke('confirmDocument', { user, params })).statusCode, 422);
  assert.equal(h.state.documents[0].receiver_signature, null);
});
test('blind exceptions: confirm creates a document-linked followup through the existing store; failure rolls back whole settlement', async () => {
  let shouldFail = true; const followups = [];
  const { h, params, count } = await setup({ saveQueueFollowup: async args => {
    followups.push(args); if (shouldFail) throw Error('fixture followup failed'); return { created: true };
  } }); await count();
  const lines = h.state.lines.map(line => ({ id: line.id, review_decision: 'short', remember_alias: true }));
  await h.invoke('updateDocument', { user, params, body: { lines } });
  await h.invoke('addSignature', { user, params, body: { role: 'receiver', image_data_url: makePngDataUrl() } });
  const before = settlementRows(h.state);
  assert.equal((await h.invoke('confirmDocument', { user, params })).statusCode, 500); assert.deepEqual(settlementRows(h.state), before);
  shouldFail = false; assert.equal((await h.invoke('confirmDocument', { user, params })).statusCode, 200);
  assert.equal(followups.at(-1).group.items[0].document_id, Number(params.id));
  assert.equal(followups.at(-1).group.items[0].review_decision, 'short');
  assert.equal((await h.invoke('confirmDocument', { user, params })).statusCode, 409);
  assert.equal(followups.length, 2);
});
test('blind evidence: a new bill image invalidates decisions and signatures while preserving the original count', async () => {
  const { h, params, count } = await setup(); await count();
  const lines = h.state.lines.map(line=>({id:line.id,review_decision:'accept'}));
  await h.invoke('updateDocument',{user,params,body:{lines}});
  await h.invoke('addSignature',{user,params,body:{role:'receiver',image_data_url:makePngDataUrl()}});
  assert.ok(h.state.documents[0].receiver_signature);
  assert.equal((await h.invoke('uploadImage',{user,params,body:{page_no:1,image_data_url:makeJpegDataUrl()}})).statusCode,201);
  assert.equal(h.state.documents[0].receiver_signature,null); assert.ok(h.state.lines.every(line=>line.review_decision===null));
  assert.equal(Number(h.state.lines[0].counted_quantity),4.5);
});

test('A1 missing bill: explicit accept persists, accounting link failure rolls back settlement and retry is single-use', async () => {
  let fails = true; const followups = [];
  const { h, params, count } = await setup({ saveQueueFollowup: async args => {
    followups.push(args); if (fails) throw Error('mock accounting link failure'); return { created: true };
  } });
  await count();
  const lines = h.state.lines.map(line => ({ id: line.id, review_decision: 'missing_bill', remember_alias: false }));
  assert.equal((await h.invoke('updateDocument', { user, params, body: { lines } })).statusCode, 200);
  assert.equal((await h.invoke('addSignature', { user, params, body: { role: 'receiver', image_data_url: makePngDataUrl() } })).statusCode, 200);
  const before = settlementRows(h.state);
  assert.equal((await h.invoke('confirmDocument', { user, params })).statusCode, 500);
  assert.deepEqual(settlementRows(h.state), before);
  fails = false;
  assert.equal((await h.invoke('confirmDocument', { user, params })).statusCode, 200);
  assert.equal(followups.at(-1).group.items[0].review_decision, 'missing_bill');
  assert.equal(followups.at(-1).group.items[0].quantity_billed, null);
  assert.equal((await h.invoke('confirmDocument', { user, params })).statusCode, 409);
});
test('A1 manual bill: quantity entered by a person remains explicit evidence after GET without pretending OCR ran', async () => {
  const { h, params, count } = await setup(); await count();
  const id = h.state.lines[0].id;
  const initial = (await h.invoke('getDocumentById', { user, params })).body.data;
  assert.equal(initial.lines[0].bill_entered_manually, false);
  const saved = await h.invoke('updateDocument', { user, params, body: { lines: [{ id, quantity_billed: '5', review_decision: 'short' }] } });
  assert.equal(saved.statusCode, 200); assert.equal(saved.body.data.lines[0].bill_entered_manually, true);
  const reopened = (await h.invoke('getDocumentById', { user, params })).body.data;
  assert.equal(reopened.ocr.status, 'none'); assert.equal(reopened.lines[0].bill_entered_manually, true);
  assert.equal(reopened.lines[0].quantity_billed, '5'); assert.equal(reopened.lines[0].counted_quantity, '4.50');
});
test('A1 reject missing bill: requires zero and alias off, retains immutable count and makes no inventory movement', async () => {
  const { h, params, count } = await setup(); await count();
  const id = h.state.lines[0].id;
  const before = structuredClone(h.state);
  for (const patch of [{ quantity_received: '4.5', remember_alias: false }, { quantity_received: '0', remember_alias: true }]) {
    assert.equal((await h.invoke('updateDocument', { user, params, body: { lines: [{ id, review_decision: 'not_received', ...patch }] } })).statusCode, 422);
    assert.deepEqual(h.state, before);
  }
  const saved = await h.invoke('updateDocument', { user, params, body: { lines: h.state.lines.map(line => ({ id: line.id, quantity_received: '0', remember_alias: false, review_decision: 'not_received' })) } });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body)); assert.equal(saved.body.data.lines[0].counted_quantity, '4.50');
  assert.equal((await h.invoke('addSignature', { user, params, body: { role: 'receiver', image_data_url: makePngDataUrl() } })).statusCode, 200);
  // Preserve the existing invariant: a receipt must contain some received goods.
  assert.equal((await h.invoke('confirmDocument', { user, params })).statusCode, 422);
  const other = h.state.lines[1];
  assert.equal((await h.invoke('updateDocument', { user, params, body: { lines: [{ id: other.id, quantity_received: '1', review_decision: 'accept' }] } })).statusCode, 200);
  assert.equal((await h.invoke('addSignature', { user, params, body: { role: 'receiver', image_data_url: makePngDataUrl() } })).statusCode, 200);
  assert.equal((await h.invoke('confirmDocument', { user, params })).statusCode, 200);
  assert.ok(h.state.inventoryTransactions.length > 0);
  assert.ok(h.state.inventoryTransactions.every(tx => Number(tx.product_id) !== Number(h.state.lines[0].product_id)));
  assert.equal(Number(h.state.lines[0].counted_quantity), 4.5);
});
test('scan-first: a bill draft switches to no-bill before the count with a kind-only update; nothing else is editable', async () => {
  const { h, doc, params, count } = await setup();
  assert.equal(doc.kind, 'bill');
  // Any other blind edit keeps being refused, including a kind change mixed with other fields.
  for (const body of [{ total: '10' }, { kind: 'manual_receipt', total: '10' }, { kind: 'bill' }, { kind: 'manual_receipt', lines: [] }])
    assert.equal((await h.invoke('updateDocument', { user, params, body })).statusCode, 409, JSON.stringify(body));
  const before = structuredClone(h.state.lines);
  const switched = await h.invoke('updateDocument', { user, params, body: { kind: 'manual_receipt' } });
  assert.equal(switched.statusCode, 200, JSON.stringify(switched.body));
  assert.equal(switched.body.data.kind, 'manual_receipt'); assert.equal(switched.body.data.blind, true);
  assert.equal(switched.body.data.ocr.status, 'locked'); assert.equal(switched.body.data.counted_complete_at ?? null, null);
  assert.deepEqual(h.state.lines, before); assert.equal(h.state.audits.at(-1).action, 'switch_to_manual');
  // Repeating the switch is refused (already manual, still blind); the count itself still works and records the missing bill.
  assert.equal((await h.invoke('updateDocument', { user, params, body: { kind: 'manual_receipt' } })).statusCode, 409);
  const counted = await count(); assert.equal(counted.statusCode, 200);
  assert.ok(h.state.lines.every(line => line.review_decision === 'missing_bill'));
});
test('scan-first: the pre-count switch needs document access and a draft', async () => {
  const { h, params } = await setup();
  assert.equal((await h.invoke('updateDocument', { user: { ...user, department_id: 30 }, params, body: { kind: 'manual_receipt' } })).statusCode, 403);
  h.state.documents[0].status = 'confirmed';
  assert.equal((await h.invoke('updateDocument', { user, params, body: { kind: 'manual_receipt' } })).statusCode, 409);
  assert.equal(h.state.documents[0].kind, 'bill');
});

// Owner 2026-10-21: "สแกนบิลแล้วอ่านเลย · แสดงชื่อสินค้าแต่ไม่แสดงจำนวน".
test('early read: a bill is read before the count; blind view gains product names only, never bill numbers', async () => {
  const { h, doc, params } = await setup();
  await h.invoke('uploadImage', { user, params, body: { page_no: 1, image_data_url: makeJpegDataUrl() } });
  ocr.setCustomOcrProvider(async () => ({ doc_date: h.today, total: 4321, subtotal: 4321, confidence: 1,
    lines: [{ bill_text: 'ผักชีฝรั่งพิเศษ', quantity_billed: 37, unit_text: 'กก.', unit_price: 117, amount: 4329 }] }));
  try {
    const read = await h.invoke('runOcr', { user, params }); assert.equal(read.statusCode, 200);
    const blind = read.body.data;
    assert.equal(blind.blind, true); assert.equal(blind.total, null); assert.equal(blind.ocr.status, 'locked'); assert.equal(blind.early_read, 'done');
    const added = blind.lines.find(line => line.bill_name === 'ผักชีฝรั่งพิเศษ'); assert.ok(added, 'unmatched bill row shows its printed name');
    for (const line of blind.lines) for (const key of ['quantity_received', 'quantity_billed', 'unit_price', 'amount', 'bill_text', 'bill_read', 'match_confidence']) assert.equal(key in line, false, key);
    // Only the bill-derived parts: image hashes and timestamps can contain these digits by chance.
    const billParts = ({ lines, subtotal, discount, vat, total, warnings, doc_ref, doc_date }) => JSON.stringify({ lines, subtotal, discount, vat, total, warnings, doc_ref, doc_date });
    assert.doesNotMatch(billParts(blind), /4321|4329|117|\b37\b/);
    const again = (await h.invoke('getDocumentById', { user, params })).body.data;
    assert.equal(again.early_read, 'done'); assert.ok(again.lines.some(line => line.bill_name === 'ผักชีฝรั่งพิเศษ'));
    const counted = await h.invoke('saveCount', { user, params, body: { client_uuid: doc.client_uuid, lines: again.lines.map(line => ({ id: line.id, counted_quantity: line.id === added.id ? '36' : '0' })) } });
    assert.equal(counted.statusCode, 200);
    const revealed = counted.body.data.lines.find(line => line.id === added.id);
    assert.equal(Number(revealed.counted_quantity), 36);
    assert.equal(Number(revealed.quantity_billed), 37); assert.equal(Number(revealed.quantity_received), 36);
  } finally { ocr.setCustomOcrProvider(null); }
});
test('early read stays blocked for no-bill receipts before the count', async () => {
  const { h, params } = await setup();
  await h.invoke('uploadImage', { user, params, body: { page_no: 1, image_data_url: makeJpegDataUrl() } });
  assert.equal((await h.invoke('updateDocument', { user, params, body: { kind: 'manual_receipt' } })).statusCode, 200);
  assert.equal((await h.invoke('runOcr', { user, params })).statusCode, 409);
  assert.equal(h.state.documents[0].ocr_attempt_count || 0, 0);
});
