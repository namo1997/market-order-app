import assert from 'node:assert/strict';
import test from 'node:test';
import { listInboxImports } from '../src/inboxList.js';

test('legacy inbox readers retain their bounded array contract', async () => {
  const calls = [];
  const rows = [{ id: 8 }];
  const result = await listInboxImports({ query: async (...args) => { calls.push(args); return [rows]; } });
  assert.equal(result, rows);
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /LIMIT 100/);
});

test('pagination reports the true filtered total and binds provider/date/page inputs', async () => {
  const calls = [];
  const responses = [[{ total: '316' }], [{ provider: 'GRAB_DAILY', total: '316' }, { provider: 'SCB', total: '42' }], [{ id: 101 }]];
  const result = await listInboxImports({ query: async (...args) => { calls.push(args); return [responses.shift()]; } }, {
    paginated: '1', provider: 'GRAB_DAILY', from: '2026-10-01', to: '2026-10-31', page: '3', page_size: '50'
  });
  assert.equal(result.total, 316);
  assert.equal(result.rows.length, 1);
  assert.equal(result.providers[1].total, 42);
  assert.deepEqual(calls[0][1], ['2026-10-01', '2026-10-31', 'GRAB_DAILY']);
  assert.deepEqual(calls[1][1], ['2026-10-01', '2026-10-31']);
  assert.deepEqual(calls[2][1], ['2026-10-01', '2026-10-31', 'GRAB_DAILY', 50, 100]);
  assert.match(calls[2][0], /ORDER BY created_at DESC, id DESC LIMIT \? OFFSET \?/);
  assert.doesNotMatch(calls[2][0], /GRAB_DAILY|2026-10/);
});

test('invalid or unbounded inbox filters are rejected before SQL', async () => {
  let calls = 0;
  const connection = { query: async () => { calls++; return [[]]; } };
  for (const patch of [{ page: '0' }, { page: '1e3' }, { page_size: '101' }, { page: '100001' }, { provider: "X' OR 1=1" }, { from: '2026-02-30' }, { from: '2026-11-02', to: '2026-11-01' }]) {
    await assert.rejects(listInboxImports(connection, { paginated: '1', ...patch }), { statusCode: 400 });
  }
  assert.equal(calls, 0);
});
