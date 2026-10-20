import test from 'node:test';
import assert from 'node:assert/strict';
import { issueDb } from './helpers/receiving-issues-db.mjs';
import { createIssue, updateIssue, attachEvidence } from '../src/models/receiving-issues-store.js';
import { makeJpegDataUrl } from './helpers/receiving-fake-db.mjs';
const user = { id: 7, role: 'accounting', branch_id: 1, department_id: 10 };
const now = new Date('2026-10-20T00:00:00Z');
async function setup() {
  const h = issueDb();
  Object.assign(h.state.lines[0], { product_id: 7, quantity_received: '2.00', review_decision: 'accept' });
  return h;
}
async function issue(h, uuid = 'stock-return-0001', extra = {}) {
  const { issue } = await createIssue(h.db, user, { client_uuid: uuid, document_id: 1, line_id: 11, type: 'return', quantity: '1.00', ...extra }, now);
  await attachEvidence(h.db, user, issue.id, { client_uuid: `proof-${uuid}`, image_data_url: makeJpegDataUrl(), collector_name: 'SYNTHETIC' }, now);
  return issue;
}
const close = (h, row, extra = {}) => updateIssue(h.db, user, row.id, { version: row.version, status: 'resolved', resolution: 'returned', stock_return_quantity: '1.00', ...extra }, now);
const stock = h => h.state.inventoryBalances.get('7:10').quantity;

test('explicit physical return subtracts base stock atomically, preserves receipt count, audits; retry/race deducts once', async () => {
  const h = await setup(); const row = await issue(h);
  const result = await Promise.allSettled([close(h, row), close(h, row)]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(result.find(r => r.status === 'rejected').reason.statusCode, 409);
  assert.equal(stock(h), '4.00');
  assert.equal(h.state.lines[0].quantity_received, '2.00');
  assert.equal(h.state.stockReturns.length, 1);
  assert.equal(h.state.inventoryTransactions[0].reference_type, 'receiving_document_return');
  assert.equal(h.state.inventoryTransactions[0].quantity, '-1.00');
  assert.equal(h.state.inventoryTransactions[0].reference_id, '1');
  assert.equal(JSON.parse(h.state.history.at(-1).details_json).stock_return.quantity, '1.00');
});

test('return cap shared across separate issues; base-unit decimal return and insufficient stock rejected', async () => {
  const h = await setup(); const first = await issue(h);
  await close(h, first, { stock_return_quantity: '1.90' });
  assert.equal(stock(h), '3.10');
  const second = await issue(h, 'stock-return-0002');
  await assert.rejects(close(h, second, { stock_return_quantity: '0.20' }), { statusCode: 409 });
  await close(h, second, { stock_return_quantity: '0.10' });
  assert.equal(stock(h), '3.00');
  const f = await setup(); const row = await issue(f);
  f.state.inventoryBalances.get('7:10').quantity = '0.50';
  await assert.rejects(close(f, row), { statusCode: 409 });
  assert.equal(f.state.stockReturns.length, 0);
});

test('credit note and not-received returns do not subtract stock; explicit deduction requires valid received product/location', async () => {
  const h = await setup(); const row = await issue(h);
  await updateIssue(h.db, user, row.id, { version: 1, status: 'resolved', resolution: 'credit_note', resolution_ref: 'SYNTHETIC-CN' }, now);
  assert.equal(stock(h), '5.00'); assert.equal(h.state.stockReturns.length, 0);
  for (const patch of [{ quantity_received: '0.00', review_decision: 'not_received' }, { product_id: null }, { product_id: 999 }]) {
    const f = await setup(); const issueRow = await issue(f); Object.assign(f.state.lines[0], patch);
    await assert.rejects(close(f, issueRow), { statusCode: 422 }); assert.equal(stock(f), '5.00');
  }
  const f = await setup(); const issueRow = await issue(f);
  Object.assign(f.state.lines[0], { quantity_received: '0.00', review_decision: 'not_received' });
  await updateIssue(f.db, user, issueRow.id, { version: 1, status: 'resolved', resolution: 'returned' }, now);
  assert.equal(stock(f), '5.00');
});

test('return rolls every ledger/balance/status/history change back on late failure', async () => {
  const h = await setup(); const row = await issue(h);
  const before = structuredClone({ issues: h.state.issues, history: h.state.history });
  h.state.fail = 'INSERT INTO receiving_issue_history';
  await assert.rejects(close(h, row));
  assert.equal(stock(h), '5.00'); assert.equal(h.state.stockReturns.length, 0); assert.equal(h.state.inventoryTransactions.length, 0);
  assert.deepEqual(h.state.issues, before.issues); assert.deepEqual(h.state.history, before.history);
});

test('branch receipt returns to its frozen line department; voided source, missing proof, forbidden actor fail closed', async () => {
  const h = await setup(); const row = await issue(h);
  Object.assign(h.state.docs[0], { receiving_scope: 'branch', department_id: null });
  h.state.lines[0].branch_department_id = 30;
  h.state.inventoryBalances.set('7:30', { quantity: '3.00' });
  await close(h, row);
  assert.equal(h.state.inventoryBalances.get('7:30').quantity, '2.00'); assert.equal(stock(h), '5.00');
  const f = await setup(); const issueRow = await issue(f); f.state.docs[0].status = 'void';
  await assert.rejects(close(f, issueRow), { statusCode: 409 });
  await assert.rejects(updateIssue(f.db, { ...user, role: 'user' }, issueRow.id, { version: 1, status: 'resolved', resolution: 'returned', stock_return_quantity: '1' }), { statusCode: 403 });
});
