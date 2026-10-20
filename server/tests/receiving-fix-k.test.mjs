import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceivingHarness, deltaActor as user, makePngDataUrl, settlementRows } from './helpers/receiving-fake-db.mjs';
import { issueDb } from './helpers/receiving-issues-db.mjs';
import { scanConfirmedIssues } from '../src/services/receiving-issues-followup.js';

const create = (h, uuid, patch = {}, actor = user) => h.invoke('createDocument', { user: actor, body: {
  client_uuid: uuid, delivery_date: h.today, kind: 'bill', product_group_id: 3, order_item_ids: [50, 51], resume_draft: true, ...patch } });

test('K2 restart/different UUID resumes oldest supplier/date/department draft, retaining count/kind and no new create audit', async () => {
  const h = await createReceivingHarness({ testDate: '2026-10-20', prepareCount: false });
  const first = await create(h, 'round-k-first'); assert.equal(first.statusCode, 201);
  const before = structuredClone(h.state);
  const second = await create(h, 'round-k-restart', { kind: 'manual_receipt' });
  assert.equal(second.statusCode, 200); assert.equal(second.body.data.id, first.body.data.id);
  assert.equal(second.body.data.kind, 'bill'); assert.deepEqual(h.state, before);
});

test('K2 simultaneous different UUIDs use transactional scope lock and return exactly one draft; same UUID retry still works', async () => {
  const queries = [];
  const h = await createReceivingHarness({ testDate: '2026-10-20', prepareCount: false, serializeTransactions: true, queryHook: sql => queries.push(sql) });
  const responses = await Promise.all([create(h, 'round-k-race-a'), create(h, 'round-k-race-b')]);
  assert.deepEqual(responses.map(r => r.statusCode), [201, 200]);
  assert.equal(responses[0].body.data.id, responses[1].body.data.id); assert.equal(h.state.documents.length, 1);
  assert.equal(queries.filter(q => q === 'SELECT id FROM branches WHERE id = ? FOR UPDATE').length, 2);
  assert.equal((await create(h, 'round-k-race-a')).body.data.id, responses[0].body.data.id);
});

test('K2 separate supplier/date/scope and terminal documents never resume; branch draft shared across departments within same branch', async () => {
  const h = await createReceivingHarness({ testDate: '2026-10-20', prepareCount: false });
  const first = await create(h, 'round-k-isolate'); const id = first.body.data.id;
  for (const [uuid, patch] of [['supplier', { product_group_id: 4 }], ['date', { delivery_date: '2026-10-18' }], ['branch', { scope: 'branch' }]]) {
    const result = await create(h, `round-k-${uuid}`, patch); assert.equal(result.statusCode, 201); assert.notEqual(result.body.data.id, id);
  }
  const branch = await create(h, 'round-k-branch-again', { scope: 'branch', order_item_ids: [] });
  assert.equal(branch.statusCode, 422, 'invalid order selection must fail before reusing a draft');
  const resumed = await create(h, 'round-k-branch-other-dept', { scope: 'branch' }, { ...user, department_id: 30 });
  assert.equal(resumed.statusCode, 200); assert.equal(resumed.body.data.scope, 'branch');
  for (const status of ['confirmed', 'void']) {
    h.state.documents.filter(d => d.receiving_scope !== 'branch').forEach(d => { d.status = status; });
    assert.equal((await create(h, `round-k-${status}`)).statusCode, 201);
  }
});

test('K2 invalid resume flag/scope failures and failed create roll back without orphan drafts', async () => {
  let fail = true;
  const h = await createReceivingHarness({ testDate: '2026-10-20', prepareCount: false, queryHook: sql => { if (fail && sql.startsWith('INSERT INTO receiving_document_audits')) throw Error('synthetic audit failure'); } });
  const before = structuredClone(h.state);
  assert.equal((await create(h, 'round-k-rollback')).statusCode, 500);
  assert.deepEqual(settlementRows(h.state), settlementRows(before)); assert.deepEqual(h.state.documents, []); assert.deepEqual(h.state.lines, []); assert.deepEqual(h.state.audits, []); fail = false;
  assert.equal((await create(h, 'round-k-invalid', { resume_draft: 'true' })).statusCode, 422);
  assert.equal((await create(h, 'round-k-cross', {}, { ...user, department_id: 30 })).statusCode, 403);
  assert.equal((await create(h, 'round-k-valid')).statusCode, 201);
});

test('K2 supplier ID and name fallback isolate department/branch drafts; anonymous receipts stay separate', async () => {
  const h = await createReceivingHarness({ testDate: '2026-10-20', prepareCount: false });
  for (const identity of [{ product_group_id: null, supplier_master_id: 8 }, { product_group_id: null, supplier_name_text: 'ร้านทดสอบ K' }]) {
    const body = { ...identity, order_item_ids: [] };
    const first = await create(h, `round-k-id-${h.state.nextDocId}`, body); assert.equal(first.statusCode, 201);
    const resumed = await create(h, `round-k-retry-${h.state.nextDocId}`, body); assert.equal(resumed.statusCode, 200); assert.equal(resumed.body.data.id, first.body.data.id);
    assert.equal((await create(h, `round-k-dept-${h.state.nextDocId}`, body, { ...user, department_id: 30 })).statusCode, 201);
    assert.equal((await create(h, `round-k-branch-${h.state.nextDocId}`, body, { ...user, branch_id: 2, department_id: 20 })).statusCode, 201);
  }
  for (const uuid of ['round-k-anonymous-1', 'round-k-anonymous-2']) assert.equal((await create(h, uuid, { product_group_id: null, order_item_ids: [] })).statusCode, 201);
});

async function counted(options = {}) {
  let h, scan;
  const issue = issueDb();
  h = await createReceivingHarness({ testDate: '2026-10-20', prepareCount: false, ...options, afterReceivingConfirm: (_, id) => { scan = (async () => {
    issue.state.docs = structuredClone(h.state.documents);
    issue.state.lines = structuredClone(h.state.lines);
    issue.state.audits = h.state.audits.filter(a => a.action === 'confirm').map(a => ({ ...a, details_json: JSON.stringify(a.details) }));
    await scanConfirmedIssues(issue.db, id, new Date('2026-10-20T01:00:00Z'));
  })(); return scan; } });
  const created = await create(h, 'round-k-count'); assert.equal(created.statusCode, 201);
  const doc = created.body.data, params = { id: String(doc.id) };
  assert.equal((await h.invoke('saveCount', { user, params, body: { client_uuid: doc.client_uuid, lines: doc.lines.map((line,i) => ({ id: line.id, counted_quantity: i ? '0' : '40' })) } })).statusCode, 200);
  h.state.documents[0].ocr_status = 'done';
  const lines = h.state.lines; lines[0].quantity_billed = 40; lines[0].unit_price = 60; lines[0].amount = 2400;
  lines[1].quantity_billed = null; lines[1].unit_price = null; lines[1].amount = null;
  const decide = patches => h.invoke('updateDocument', { user, params, body: { lines: patches } });
  return { h, issue, doc, params, lines, decide, waitScan: () => scan };
}

test('K4/K5 confirmed 40/40/10 plus undelivered zero keeps pending order, adds stock once, and post-confirm hook opens no false bill/return/over claim', async () => {
  const { h, issue, params, lines, decide, waitScan } = await counted();
  assert.equal((await decide([{ id: lines[0].id, review_decision: 'over_order' }, { id: lines[1].id, review_decision: 'not_delivered' }])).statusCode, 200);
  assert.equal((await h.invoke('addSignature', { user, params, body: { role: 'receiver', image_data_url: makePngDataUrl() } })).statusCode, 200);
  assert.equal((await h.invoke('confirmDocument', { user, params })).statusCode, 200);
  await waitScan();
  assert.equal(h.state.orderItems.find(i => i.id === 50).received_quantity, 40);
  assert.equal(Number(h.state.orderItems.find(i => i.id === 51).received_quantity || 0), 0);
  assert.equal(h.state.orderItems.find(i => i.id === 51).is_received, false);
  assert.equal(h.state.inventoryBalances.get('7:10').quantity, 45); assert.equal(h.state.aliases.length, 0);
  assert.deepEqual(issue.state.issues, []); assert.equal(issue.state.scans.length, 1);
  const before = settlementRows(h.state);
  await h.invoke('confirmDocument', { user, params }); assert.deepEqual(settlementRows(h.state), before);
  assert.deepEqual(issue.state.issues, []);
  await scanConfirmedIssues(issue.db, Number(params.id)); assert.equal(issue.state.scans.length, 1);
});

test('K4 forged undelivered positive count/received/bill or alias is rejected and whole edit rolls back; access/terminal/missing guards remain', async () => {
  const { h, lines, params, decide } = await counted();
  const before = structuredClone(h.state);
  assert.equal((await decide([{ id: lines[0].id, review_decision: 'not_delivered' }])).statusCode, 422);
  assert.deepEqual(h.state, before);
  for (const patch of [{ quantity_received: '1' }, { quantity_billed: '1' }, { remember_alias: true }]) {
    assert.equal((await decide([{ id: lines[1].id, ...patch, review_decision: 'not_delivered' }])).statusCode, 422); assert.deepEqual(h.state, before);
  }
  const body = { lines: [{ id: lines[1].id, review_decision: 'not_delivered' }] };
  assert.equal((await h.invoke('updateDocument', { user: { ...user, branch_id: 2 }, params, body })).statusCode, 403);
  assert.equal((await h.invoke('updateDocument', { user, params: { id: '99999' }, body })).statusCode, 404);
  h.state.documents[0].status = 'confirmed'; assert.equal((await h.invoke('updateDocument', { user, params, body })).statusCode, 409);
});

test('K5 malformed over-order decision cannot hide a bill shortage and failed decision persistence rolls back', async () => {
  let fail = false;
  const { h, lines, decide } = await counted({ queryHook: sql => { if (fail && sql.startsWith('UPDATE receiving_document_lines SET review_decision')) throw Error('synthetic K decision failure'); } });
  const before = structuredClone(h.state);
  assert.equal((await decide([{ id: lines[0].id, quantity_billed: '41', review_decision: 'over_order' }])).statusCode, 422); assert.deepEqual(h.state, before);
  fail = true;
  assert.equal((await decide([{ id: lines[0].id, review_decision: 'over_order' }])).statusCode, 500); assert.deepEqual(h.state, before);
});

test('K4/K5 branch allocations keep explicit zero/over-order choices and confirm audits bill comparison without spurious issues', async () => {
  const h = await createReceivingHarness({ testDate: '2026-10-20', prepareCount: false });
  const first = h.state.orderItems.find(i => i.id === 50); first.quantity = 6;
  h.state.orderItems.push({ ...structuredClone(first), id: 60, order_id: 3, quantity: 4, department_id: 30, department_name: 'สโตร์', received_quantity: null });
  const created = await create(h, 'round-k-allocation', { scope: 'branch', order_item_ids: [50, 60, 51] });
  assert.equal(created.statusCode, 201); const doc = created.body.data, params = { id: String(doc.id) };
  assert.equal((await h.invoke('saveCount', { user, params, body: { client_uuid: doc.client_uuid, lines: doc.lines.map((l,i) => ({ id: l.id, counted_quantity: i ? '0' : '40' })) } })).statusCode, 200);
  h.state.documents[0].ocr_status = 'done';
  h.state.lines.forEach(l => { l.quantity_billed = l.product_id === first.product_id ? l.quantity_received : null; l.unit_price = l.product_id === first.product_id ? 60 : null; l.amount = l.product_id === first.product_id ? Number(l.quantity_received)*60 : null; });
  const update = await h.invoke('updateDocument', { user, params, body: { lines: doc.lines.map((l,i) => ({ id: l.id, review_decision: i ? 'not_delivered' : 'over_order' })) } });
  assert.equal(update.statusCode, 200);
  assert.deepEqual(h.state.lines.filter(l => l.product_id === first.product_id).map(l => l.review_decision), ['over_order','over_order']);
  assert.equal((await h.invoke('addSignature', { user, params, body: { role: 'receiver', image_data_url: makePngDataUrl() } })).statusCode, 200);
  assert.equal((await h.invoke('confirmDocument', { user, params })).statusCode, 200);
  const audit = h.state.audits.find(a => a.action === 'confirm'); assert.deepEqual(audit.details.issue_candidates, []);
  assert.equal(h.state.inventoryBalances.get('7:10').quantity, 29); assert.equal(h.state.inventoryBalances.get('7:30').quantity, 16);
});
