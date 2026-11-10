import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bangkokDate, quickDateRange, rangeIncludesToday } from '../../client/src/utils/salesReportDates.js';

test('sales presets use the Thai calendar day regardless of device timezone', () => {
  const lateNightUtc = new Date('2026-11-10T18:30:00Z'); // 01:30 on 11 Nov in Bangkok
  assert.equal(bangkokDate(lateNightUtc), '2026-11-11');
  assert.deepEqual(quickDateRange('today', lateNightUtc), { start: '2026-11-11', end: '2026-11-11' });
  assert.deepEqual(quickDateRange('yesterday', lateNightUtc), { start: '2026-11-10', end: '2026-11-10' });
  assert.deepEqual(quickDateRange('week', lateNightUtc), { start: '2026-11-05', end: '2026-11-11' });
  assert.deepEqual(quickDateRange('last30', lateNightUtc), { start: '2026-10-13', end: '2026-11-11' });
  assert.deepEqual(quickDateRange('month', lateNightUtc), { start: '2026-11-01', end: '2026-11-11' });
  assert.deepEqual(quickDateRange('lastmonth', lateNightUtc), { start: '2026-10-01', end: '2026-10-31' });
});

test('"3 เดือนย้อนหลัง" is three complete months, across year and leap boundaries', () => {
  assert.deepEqual(quickDateRange('last3months', new Date('2026-11-10T05:00:00Z')), { start: '2026-08-01', end: '2026-10-31' });
  assert.deepEqual(quickDateRange('last3months', new Date('2026-01-15T05:00:00Z')), { start: '2025-10-01', end: '2025-12-31' });
  assert.deepEqual(quickDateRange('lastmonth', new Date('2024-03-05T05:00:00Z')), { start: '2024-02-01', end: '2024-02-29' });
});

test('ranges ending today are flagged as an unfinished sales day', () => {
  const now = new Date('2026-11-10T05:00:00Z');
  assert.equal(rangeIncludesToday('2026-11-10', now), true);
  assert.equal(rangeIncludesToday('2026-11-09', now), false);
  assert.equal(rangeIncludesToday('', now), false);
});

test('sales page shows every menu (no hidden ungrouped menus) and uses Thai presets', async () => {
  const page = await readFile(new URL('../../client/src/pages/admin/masters/SalesReport.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /groupedMenuItems/);
  assert.doesNotMatch(page, /getTimezoneOffset/);
  assert.match(page, /quickDateRange\(range\)/);
  assert.match(page, /selectedGroup \? menuItems\.filter/);
});
