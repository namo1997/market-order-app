import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileMonthRange } from '../src/mobileAdminState.js';

test('phone current month stops at today rather than showing future rows first', () => {
  assert.deepEqual(mobileMonthRange('2026-10', '2026-10-11'), { from: '2026-10-01', to: '2026-10-11' });
});
test('phone historical and future selections preserve full calendar months and leap years', () => {
  assert.deepEqual(mobileMonthRange('2028-02', '2028-03-01'), { from: '2028-02-01', to: '2028-02-29' });
  assert.deepEqual(mobileMonthRange('2027-01', '2026-12-31'), { from: '2027-01-01', to: '2027-01-31' });
});
