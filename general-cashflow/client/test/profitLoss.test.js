import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPnlMoney, sumPnlRows, thaiMonth, previousMonth } from '../src/profitLoss.js';
test('P&L currency formatting retains unknown, negative and cents; row total uses cents',()=>{
 assert.equal(formatPnlMoney(null),'—');assert.equal(formatPnlMoney(1234.5),'1,234.50');assert.equal(formatPnlMoney(-12),'-12.00');
 assert.equal(sumPnlRows([{amount:'0.1'},{amount:'0.2'}]),.3);assert.equal(previousMonth('2026-01'),'2025-12');
 assert.equal(thaiMonth(new Date('2026-09-30T17:00:01Z')),'2026-10');
});

test('UTC MySQL latest sync rolls over to the Thai date and agrees with ISO convention',async()=>{
 const {formatPnlDateTime}=await import('../src/profitLoss.js');
 const expected=new Date('2026-10-09T19:24:57Z').toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'});
 assert.equal(formatPnlDateTime('2026-10-09 19:24:57'),expected);assert.equal(formatPnlDateTime('2026-10-09T19:24:57Z'),expected);assert.ok(expected.includes('02:24'));assert.equal(formatPnlDateTime(null),'-');assert.equal(formatPnlDateTime('bad'),'-');
});
test('P&L display defaults to matched totals and category/branch values; monthly mode uses full values',async()=>{
 const {pnlView}=await import('../src/profitLoss.js');
 const report={totals:{revenue:300},totals_matched:{revenue:100},branch_columns:[{key:'1',revenue:300,matched:{revenue:100}}],category_rows:[{code:'OTHER',amount:90,branches:{1:90},matched:{amount:30,branches:{1:30}}}]};
 assert.equal(pnlView(report).totals.revenue,100);assert.equal(pnlView(report).branch_columns[0].revenue,100);assert.equal(pnlView(report).category_rows[0].amount,30);assert.equal(pnlView(report).category_rows[0].branches[1],30);
 assert.equal(pnlView(report,'month').totals.revenue,300);assert.equal(pnlView(report,'month').category_rows[0].amount,90);assert.equal(report.category_rows[0].amount,90);
});

test('period controls use three-month bounds across years and Thai Buddhist date/month labels',async()=>{
 const {periodMonthBounds,formatPnlMonth,formatPnlDate}=await import('../src/profitLoss.js');
 assert.deepEqual(periodMonthBounds('2027-01-04'),{min:'2026-10',max:'2027-01'});
 assert.equal(formatPnlMonth('2026-08'),'ส.ค. 2569');assert.equal(formatPnlDate('2026-09-05'),'5 ก.ย. 2569');
});
