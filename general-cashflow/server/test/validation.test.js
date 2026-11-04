import assert from 'node:assert/strict';
import test from 'node:test';
import { bangkokDate, bangkokReportRange, validateDate, validateMoneyInput } from '../src/domain/validation.js';

test('calendar validation rejects impossible days but accepts leap days', () => {
  assert.equal(validateDate('2024-02-29'), '2024-02-29');
  for (const value of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-1-02', '', null]) {
    assert.throws(() => validateDate(value), { statusCode: 400 });
  }
});

test('explicit money input preserves cents and signed values while rejecting malformed values', () => {
  assert.equal(validateMoneyInput('123.45'), 123.45);
  assert.equal(validateMoneyInput('-0.25'), -0.25);
  assert.equal(validateMoneyInput(0), 0);
  for (const value of ['1O0', 'NaN', '1,000', '', null, false, [], Infinity, 1e12, '999999999999.999']) {
    assert.throws(() => validateMoneyInput(value), { statusCode: 400 });
  }
});

test('report date and whole-month defaults follow Bangkok across UTC month and year boundaries', () => {
  const date = new Date('2026-12-31T17:00:00Z');
  assert.equal(bangkokDate(date), '2027-01-01');
  assert.deepEqual(bangkokReportRange(date), { from: '2027-01-01', to: '2027-01-31' });
  assert.deepEqual(bangkokReportRange(new Date('2024-01-31T17:00:00Z')), { from: '2024-02-01', to: '2024-02-29' });
});
