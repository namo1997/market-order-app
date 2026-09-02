import assert from 'node:assert/strict';
import test from 'node:test';
import mysql from 'mysql2/promise';

import { closePool, fetchAccountingExportRows } from '../src/db.js';

test('receiving account adapter queries and returns only the requested branch', async (t) => {
  const accounts = [
    {
      source_id: 'gc:receiving-account:11',
      source_account_id: 'gc-account-11',
      label: 'KK receiving account',
      bank_name: 'Test Bank',
      account_alias: 'KK',
      account_type: 'BANK',
      account_last4: '1111',
      branch_codes: 'KK',
      channel_codes: 'QR_KPLUS',
      is_active: 1,
      updated_at: '2026-08-01 00:00:00',
    },
    {
      source_id: 'gc:receiving-account:22',
      source_account_id: 'gc-account-22',
      label: 'SK receiving account',
      bank_name: 'Test Bank',
      account_alias: 'SK',
      account_type: 'BANK',
      account_last4: '2222',
      branch_codes: 'SK',
      channel_codes: 'QR_KPLUS',
      is_active: 1,
      updated_at: '2026-08-01 00:00:00',
    },
  ];
  let observedSql;
  let observedParams;
  const fakePool = {
    async query(sql, params) {
      observedSql = sql;
      observedParams = params;
      const rows = /WHERE\s+b\.code\s*=\s*\?/i.test(sql)
        ? accounts.filter((row) => row.branch_codes === params[0])
        : accounts;
      return [rows];
    },
    async end() {},
  };
  t.mock.method(mysql, 'createPool', () => fakePool);
  t.after(() => closePool());

  const rows = await fetchAccountingExportRows({
    sourceType: 'receiving_account',
    from: '2026-08-01',
    to: '2026-08-31',
    branch: 'SK',
  });

  assert.match(observedSql, /WHERE\s+b\.code\s*=\s*\?/i);
  assert.deepEqual(observedParams, ['SK']);
  assert.deepEqual(rows.map((row) => row.branch_codes), ['SK']);
  assert.equal(rows.some((row) => row.branch_codes === 'KK'), false);
});
