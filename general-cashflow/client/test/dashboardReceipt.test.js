import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardFiltersEqual, receiptMatchesDashboardFilters } from '../src/dashboardReceipt.js';

test('a dashboard receipt must belong to the selected branch and date', () => {
  const receipt = { branch_id: 2, receipt_date: '2026-07-11T00:00:00.000Z' };

  assert.equal(receiptMatchesDashboardFilters(receipt, { branch_id: '2', date: '2026-07-11' }), true);
  assert.equal(receiptMatchesDashboardFilters(receipt, { branch_id: '1', date: '2026-07-11' }), false);
  assert.equal(receiptMatchesDashboardFilters(receipt, { branch_id: '2', date: '2026-07-12' }), false);
});

test('dashboard filter comparison includes status for stale request protection', () => {
  const original = { branch_id: '1', date: '2026-07-11', status: '' };

  assert.equal(dashboardFiltersEqual(original, { ...original }), true);
  assert.equal(dashboardFiltersEqual(original, { ...original, status: 'SUBMITTED' }), false);
});
