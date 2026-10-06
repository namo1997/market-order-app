import test from 'node:test';
import assert from 'node:assert/strict';
import { findPosDrift } from '../src/domain/posDrift.js';
import { checkPosDrift } from '../src/posDrift.js';

const receipt = (id, date, branch_code, gross, status = 'SUBMITTED', extra = {}) => ({ id, receipt_date: date, branch_id: branch_code === 'KK' ? 1 : 2, branch_code, gross_sales_expected: gross, bill_count: 74, status, clickhouse_synced_at: '2026-09-28 07:14:20', ...extra });

test('a bill added to ClickHouse after the sync is reported as POS drift',()=>{
  const [late, same, gone, unsynced] = findPosDrift([
    receipt(1,'2026-09-23','SK','58222.60'),
    receipt(2,'2026-09-23','KK',69275.8,'CLOSED',{ bill_count:85 }),
    receipt(3,'2026-09-24','SK',100),
    receipt(4,'2026-09-25','SK',100,'DRAFT',{ clickhouse_synced_at:null })
  ], [
    { businessDate:'2026-09-23', branchCode:'SK', grossSalesExpected:59197.6, billCount:75 },
    { businessDate:'2026-09-23', branchCode:'KK', grossSalesExpected:69275.8, billCount:85 }
  ]);
  assert.deepEqual([late.drift, late.changed], [975, true]);
  assert.deepEqual([same.drift, same.changed], [0, false]);
  assert.deepEqual([gone.drift, gone.latest_gross], [-100, 0]);
  assert.equal(unsynced, undefined);
});

test('the drift check records latest totals and refreshes only open receipts',async()=>{
  const queries = [];
  const pool = { query: async (sql, params) => {
    queries.push([sql, params]);
    if (/FROM branches/.test(sql)) return [[{ id:1, code:'KK', clickhouse_branch_id:'a' }, { id:2, code:'SK', clickhouse_branch_id:'b' }]];
    if (/FROM daily_receipts/.test(sql)) return [[receipt(1,'2026-09-23','SK',58222.6), receipt(2,'2026-09-22','SK',100,'CLOSED'), receipt(3,'2026-09-21','KK',50)]];
    return [{}];
  } };
  const refreshed = [];
  const result = await checkPosDrift({ pool, today:'2026-10-06', lookbackDays:30,
    fetchRange: async ({ from, to }) => { assert.equal(from,'2026-09-06'); assert.equal(to,'2026-10-05'); return [
      { businessDate:'2026-09-23', branchCode:'SK', grossSalesExpected:59197.6, billCount:75 },
      { businessDate:'2026-09-22', branchCode:'SK', grossSalesExpected:200, billCount:74 },
      { businessDate:'2026-09-21', branchCode:'KK', grossSalesExpected:50, billCount:74 }]; },
    refreshReceipt: async ({ receiptDate, branch }) => { refreshed.push([receiptDate, branch.code]); } });
  assert.deepEqual(refreshed, [['2026-09-23','SK']]);
  assert.deepEqual(result.changed.map(r => r.receipt_id), [1, 2]);
  assert.equal(queries.filter(([sql]) => /SET pos_latest_gross/.test(sql)).length, 3);
});
