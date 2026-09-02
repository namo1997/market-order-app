import assert from 'node:assert/strict';
import { summarizeCompleteness } from '../src/ingest-completeness.js';

const sourceA = 'sankampaeng';
const sourceB = 'kanklong';
const siblingRows = ['2026-07-26', '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02', '2026-08-03']
  .map((business_date) => ({ source_id: sourceB, business_date, message_count: 2 }));
const missing = summarizeCompleteness([
  { source_id: sourceA, business_date: '2026-07-26', message_count: 4 },
  { source_id: sourceA, business_date: '2026-08-03', message_count: 5 },
  ...siblingRows
]);
assert.equal(missing.status, 'risk');
assert.equal(missing.anomalies.length, 1);
assert.equal(missing.anomalies[0].start_date, '2026-07-27');
assert.equal(missing.anomalies[0].end_date, '2026-08-02');
assert.equal(missing.anomalies[0].missing_days, 7);

const restored = summarizeCompleteness([
  ...siblingRows,
  ...['2026-07-26', '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02', '2026-08-03']
    .map((business_date) => ({ source_id: sourceA, business_date, message_count: 2 }))
]);
assert.equal(restored.status, 'ok');
assert.equal(restored.anomalies.length, 0);

console.log('Ingest completeness tests passed');
