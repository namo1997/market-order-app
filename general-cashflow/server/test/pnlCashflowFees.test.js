import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCashflowFees } from '../src/pnl/cashflowFees.js';
import { buildReport } from '../src/pnl/report.js';
test('closed noncash fees once; batch allocation not aggregate; marketing is not added twice',()=>{
 const row={id:1,branch_id:1,receipt_date:'2026-08-01',status:'CLOSED',channel_code:'GRAB',fee_amount:100,marketing_fee_amount:30};
 const result=buildCashflowFees([row,row,{...row,id:2,settlement_batch_key:'batch',fee_amount:999,settlement_batch_allocated_fee_amount:25},{...row,id:3,channel_code:'CASH'},{...row,id:4,status:'DRAFT'},{...row,id:5,fee_amount:null}]);
 assert.deepEqual(result.cashflowExpenses.map(r=>r.amount),[100,25]);assert.deepEqual(result.cashflowFeeStatus.missing_receipt_line_ids,[5]);
 const report=buildReport({month:'2026-08',branches:[{id:1}],cashflowExpenses:result.cashflowExpenses,categories:[{code:'MARKETING'}],now:new Date('2026-10-10')});
 assert.equal(report.totals.opex,125);assert.equal(report.totals_matched.opex,0);
});
