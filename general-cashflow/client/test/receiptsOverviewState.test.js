import test from 'node:test';
import assert from 'node:assert/strict';
import { overviewDefaults, overviewMoney, overviewDate, overviewWeekday, overviewRequest } from '../src/receiptsOverviewState.js';
test('overview month boundaries, Thai weekday and missing amounts are explicit',()=>{
  assert.equal(overviewDefaults('2028-02-10').to,'2028-02-29');
  assert.equal(overviewDefaults('2026-09-07').basis,'sale');
  assert.equal(overviewMoney(null),'—');assert.equal(overviewMoney(0),'0.00');
  assert.match(overviewDate('2026-09-07'),/7/);assert.equal(overviewWeekday('2026-09-07'),'วันจันทร์');
});
test('filter changes reset pagination while preserving other filters',()=>{
  const current={...overviewDefaults('2026-09-07'),page:3,branch_id:'2',basis:'received'};
  assert.deepEqual(overviewRequest(current,{tab:'transactions'}),{...current,tab:'transactions',page:1});
  assert.equal(overviewRequest(current,{page:2}).page,2);
});
