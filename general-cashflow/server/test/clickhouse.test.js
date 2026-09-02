import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchExpectedSales, fetchExpectedSalesRange } from '../src/clickhouse.js';
import { config } from '../src/config.js';

test('expected sales collapse ReplacingMergeTree versions before totaling POS documents', async () => {
  const originalFetch = global.fetch;
  const originalConfig = { ...config.clickhouse };
  const queries = [];

  Object.assign(config.clickhouse, {
    host: 'clickhouse.test',
    port: '8123',
    user: 'test',
    password: 'test',
    database: 'test',
    secure: false,
    shopId: 'shop',
    tzOffset: 7
  });
  global.fetch = async (_url, options) => {
    queries.push(options.body);
    return {
      ok: true,
      json: async () => ({
        data: queries.length === 1
          ? [{ bill_count: '109', gross_sales: 74768.5, cash_sales: 17427.5, non_cash_sales: 57341 }]
          : []
      })
    };
  };

  try {
    const result = await fetchExpectedSales({
      receiptDate: '2026-08-04',
      clickhouseBranchId: 'branch'
    });

    assert.equal(result.billCount, 109);
    assert.equal(result.grossSales, 74768.5);
    assert.match(queries[0], /FROM docpayment FINAL/);
    assert.match(queries[0], /FROM doc AS d FINAL/);
    assert.match(queries[1], /FROM docpayment AS dp FINAL/);
    assert.match(queries[1], /INNER JOIN doc AS d FINAL/);
  } finally {
    global.fetch = originalFetch;
    Object.assign(config.clickhouse, originalConfig);
  }
});

test('monthly expected sales groups POS documents by business date and branch', async () => {
  const originalFetch = global.fetch;
  const originalConfig = { ...config.clickhouse };
  let query = '';

  Object.assign(config.clickhouse, {
    host: 'clickhouse.test',
    port: '8123',
    user: 'test',
    password: 'test',
    database: 'test',
    secure: false,
    shopId: 'shop',
    tzOffset: 7
  });
  global.fetch = async (_url, options) => {
    query = options.body;
    return {
      ok: true,
      json: async () => ({
        data: [
          { business_date: '2026-07-01', clickhouse_branch_id: 'kk-id', bill_count: '10', gross_sales: 1234.5 }
        ]
      })
    };
  };

  try {
    const rows = await fetchExpectedSalesRange({
      from: '2026-07-01',
      to: '2026-07-31',
      branches: [
        { code: 'KK', clickhouse_branch_id: 'kk-id' },
        { code: 'SK', clickhouse_branch_id: 'sk-id' }
      ]
    });
    assert.deepEqual(rows, [{
      businessDate: '2026-07-01',
      branchCode: 'KK',
      billCount: 10,
      grossSalesExpected: 1234.5
    }]);
    assert.match(query, /FROM doc AS d FINAL/);
    assert.match(query, /BETWEEN toDate\('2026-07-01'\) AND toDate\('2026-07-31'\)/);
    assert.match(query, /IN \('kk-id', 'sk-id'\)/);
  } finally {
    global.fetch = originalFetch;
    Object.assign(config.clickhouse, originalConfig);
  }
});
