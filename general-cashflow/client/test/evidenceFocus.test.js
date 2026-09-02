import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evidenceDateCandidates,
  evidenceTextHasAmount,
  findEvidenceRowIndex
} from '../src/evidenceFocus.js';

test('evidenceDateCandidates supports ISO and Thai bank statement date formats', () => {
  assert.deepEqual(evidenceDateCandidates('2026-08-27'), [
    '2026-08-27',
    '27/08/2026',
    '27-08-2026',
    '27/08/26',
    '27-08-26'
  ]);
});

test('evidenceTextHasAmount matches a formatted bank amount exactly', () => {
  assert.equal(evidenceTextHasAmount('Single credit 10,141.34 balance 88,000.00', 10141.34), true);
  assert.equal(evidenceTextHasAmount('Single credit 1,042.00 balance 88,000.00', 10141.34), false);
});

test('findEvidenceRowIndex requires the selected date and amount in the same row', () => {
  const rows = [
    ['26/08/2026', 'Single credit', '5,500.00'],
    ['27/08/2026', 'Single credit', '10,141.34'],
    ['28/08/2026', 'Single credit', '1,042.00']
  ];
  assert.equal(findEvidenceRowIndex(rows, { date: '2026-08-27', amount: 10141.34 }), 1);
});
