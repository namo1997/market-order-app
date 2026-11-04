import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

// Run the actual helper and its declaration from server.js without starting the
// server, migrations, schedulers or a database. Do not inject the missing regex.
const source = await fs.readFile(new URL('../src/server.js', import.meta.url), 'utf8');
const start = source.indexOf('const attachKrungthaiKtcEvidence = async ');
const end = source.indexOf('\nconst autoLinkKrungthaiKtcImport = ', start);
assert.ok(start > 0 && end > start, 'Actual KTC evidence helper must be found');
const declaration = source.match(/^const DATE_PATTERN = .+;$/m)?.[0] || '';
const actualHelper = vm.runInNewContext(`${declaration}\n${source.slice(start, end)}\nattachKrungthaiKtcEvidence;`);
const parsed = (transactions) => ({ transactions, files: [] });

test('actual KTC evidence helper filters/deduplicates report dates without an unresolved constant', async () => {
  const calls = [];
  const connection = { query: async (sql, params) => { calls.push({ sql, params }); return [[]]; } };
  const result = await actualHelper(connection, { sourceDate: '2026-10-25', parsed: parsed([
    { receiptDate: '2026-10-23', transactionDate: '2026-10-24' },
    { transactionDate: '2026-10-24' }, { transactionDate: 'not-a-date' }, { receiptDate: '2026-10-23' }
  ]) });
  assert.deepEqual(Array.from(result.receiptDates), ['2026-10-23', '2026-10-24']);
  assert.equal(result.attachedCount, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(Array.from(calls[0].params), ['2026-10-23', '2026-10-24']);
  assert.match(calls[0].sql, /b.code = 'KK'/);
  assert.match(calls[0].sql, /pc.code = 'CREDIT_CARD_KTC'/);
  assert.doesNotMatch(calls[0].sql, /UPDATE|INSERT|DELETE/);
});

test('actual KTC evidence helper retains source-date fallback and no-date no-query behavior', async () => {
  const calls = [];
  const connection = { query: async (_sql, dates) => { calls.push(Array.from(dates)); return [[]]; } };
  const result = await actualHelper(connection, { sourceDate: '2026-10-17', parsed: parsed([{ transactionDate: 'invalid' }]) });
  assert.deepEqual(Array.from(result.receiptDates), ['2026-10-17']);
  assert.deepEqual(calls, [['2026-10-17']]);
  const empty = await actualHelper(connection, { parsed: parsed([]) });
  assert.equal(empty.attachedCount, 0);
  assert.equal(empty.receiptDates.length, 0);
  assert.equal(calls.length, 1);
});
