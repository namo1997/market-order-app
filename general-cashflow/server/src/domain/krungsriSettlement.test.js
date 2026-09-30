import test from 'node:test';
import assert from 'node:assert/strict';
import { krungsriSettlementAmounts, summarizeKrungsriSettlements } from './krungsriSettlement.js';

const row = (gross, fee, net) => ({ raw_payload: {
  'Transaction amount': gross, 'Service Fee': fee, 'Net Transaction amount': net
} });

test('Krungsri actual receipts are net and fees bridge back to gross', () => {
  const actual = krungsriSettlementAmounts(row('1,279.00', '4.48', '1,274.52').raw_payload);
  assert.deepEqual(actual, { grossAmount: 1279, feeAmount: 4.48, netAmount: 1274.52 });
  assert.equal(actual.netAmount + actual.feeAmount, actual.grossAmount);
});

test('missing or inconsistent settlement fields do not become actual receipts', () => {
  for (const input of [row('100', '', '100'), row('100', '1', undefined), row('100', '1', '100'), row('100', '-1', '101')]) {
    assert.equal(krungsriSettlementAmounts(input.raw_payload), null);
  }
});

test('fees and net receipts aggregate across multiple report files', () => {
  assert.deepEqual(summarizeKrungsriSettlements([
    row('1,279.00', '4.48', '1,274.52'),
    { raw_payload: JSON.stringify(row('1,010.00', '3.54', '1,006.46').raw_payload) }
  ]), { grossAmount: 2289, feeAmount: 8.02, netAmount: 2280.98 });
  assert.equal(summarizeKrungsriSettlements([]), null);
  assert.equal(summarizeKrungsriSettlements([row('100', '1', '99'), row('50', null, '50')]), null);
});
