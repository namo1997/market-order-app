import assert from 'node:assert/strict';
import test from 'node:test';
import { requireReceiptState } from '../src/receiptState.js';

test('receipt preflight reads identity/status/POS scope in one read without hydration or writes', async () => {
  const calls = [];
  const receipt = { id: 17, status: 'CLOSED', receipt_date: '2026-10-31', branch_id: 2, branch_code: 'SK', clickhouse_branch_id: 'fixture-sk' };
  const connection = { query: async (...args) => { calls.push(args); return [[receipt]]; } };
  assert.equal(await requireReceiptState(connection, 17), receipt);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], [17]);
  assert.match(calls[0][0], /^SELECT/);
  assert.doesNotMatch(calls[0][0], /UPDATE|INSERT|audit_logs|attachments|statement_transactions|FOR UPDATE/);
});

test('missing receipts retain 404 behavior with one query', async () => {
  let calls = 0;
  await assert.rejects(requireReceiptState({ query: async () => { calls++; return [[]]; } }, 99), { statusCode: 404, message: 'Receipt not found.' });
  assert.equal(calls, 1);
});
