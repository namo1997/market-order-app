import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPnlMoney, sumPnlRows, thaiMonth, previousMonth } from '../src/profitLoss.js';
test('P&L currency formatting retains unknown, negative and cents; row total uses cents',()=>{
 assert.equal(formatPnlMoney(null),'—');assert.equal(formatPnlMoney(1234.5),'1,234.50');assert.equal(formatPnlMoney(-12),'-12.00');
 assert.equal(sumPnlRows([{amount:'0.1'},{amount:'0.2'}]),.3);assert.equal(previousMonth('2026-01'),'2025-12');
 assert.equal(thaiMonth(new Date('2026-09-30T17:00:01Z')),'2026-10');
});
