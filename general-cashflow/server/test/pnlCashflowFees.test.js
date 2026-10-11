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

const grabRow = (adjustment = 70) => ({ id: 10, branch_id: 1, branch_code:'KK', receipt_date: '2026-08-04', status: 'CLOSED',
  channel_code: 'GRAB', cashier_amount: 1000, expected_gross_amount: 1000, expected_net_amount: 800 + adjustment,
  fee_amount: 200 - adjustment, grab_report_payload: {
    cashier_amount: 1000, net_amount: 800 + adjustment, commission_and_tax_amount: 120,
    additional_commission_amount: 30, marketing_fee_amount: 40, merchant_delivery_discount_amount: 10,
    income_adjustment_amount: adjustment
  } });
const scbRow = () => ({ id: 11, branch_id: 1, receipt_date: '2026-08-25', status: 'CLOSED',
  channel_code: 'CREDIT_CARD_SCB', cashier_amount: 1500, expected_gross_amount: 1510, fee_amount: 50,
  expected_net_amount: 1460, statement_amount: 1460, matched_amount: 1460,
  settlement_source: 'BANK_SETTLEMENT', settlement_status: 'MATCHED_AUTO', bank_match_count: 1, bank_match_amount: 1460 });

test('Grab sheet basis separates positive and negative income adjustments without counting marketing twice', () => {
  const rows = [grabRow(), { ...grabRow(-5), id: 12, receipt_date: '2026-08-16' }];
  const original = structuredClone(rows);
  const settlement = buildCashflowFees(rows), sheet = buildCashflowFees(rows, { basis: 'sheet' });
  assert.deepEqual(settlement.cashflowExpenses.map(row => row.amount), [130, 205]);
  assert.deepEqual(sheet.cashflowExpenses.map(row => row.amount), [200, 200]);
  assert.equal(sheet.cashflowFeeStatus.grab_income_adjustment_total, 65);
  assert.deepEqual(rows, original);
  const data = {month:'2026-08', branches:[{id:1}], categories:[{code:'MARKETING'}],
    receipts:[{id:1,branch_id:1,receipt_date:'2026-08-04',status:'CLOSED',gross_sales_expected:1000}],
    rounds:[{id:1,branch_id:1,business_date:'2026-08-04',status:'closed'}],now:new Date('2026-10-11')};
  const report = buildReport({...data, cashflowExpenses:sheet.cashflowExpenses});
  assert.equal(report.cashflow_fee_total,400); assert.equal(report.totals.net_profit,600);
  assert.equal(report.totals_matched.net_profit,800); assert.equal(report.branch_columns[0].matched.opex,200);
});

test('missing, stale and inconsistent Grab reports visibly fall back to stored fee; batch allocation wins', () => {
  const rows = [
    {...grabRow(),grab_report_payload:null}, {...grabRow(),id:11,grab_report_payload:'invalid'},
    {...grabRow(),id:12,grab_report_payload:{...grabRow().grab_report_payload,cashier_amount:1100}},
    {...grabRow(),id:13,grab_report_payload:{...grabRow().grab_report_payload,marketing_fee_amount:null}},
    {...grabRow(),id:14,grab_report_payload:{...grabRow().grab_report_payload,income_adjustment_amount:90}},
    {...grabRow(),id:15,settlement_batch_key:'two-days',settlement_batch_allocated_fee_amount:25},
    {...grabRow(),id:16,fee_amount:null}
  ];
  const result=buildCashflowFees(rows,{basis:'sheet'});
  assert.equal(result.cashflowFeeStatus.status,'partial');
  assert.deepEqual(result.cashflowFeeStatus.missing_grab_report_line_ids,[10,11,12,13,14,15]);
  assert.deepEqual(result.cashflowFeeStatus.missing_receipt_line_ids,[16]);
  assert.deepEqual(result.cashflowExpenses.map(row=>row.amount),[130,130,130,130,130,25]);
  assert.equal(result.cashflowFeeStatus.grab_income_adjustment_total,0);
});

test('SCB stale gross is corrected only in report using one matched bank transaction; closing inputs stay untouched', () => {
  const row=scbRow(), original=structuredClone(row);
  const result=buildCashflowFees([row,row]);
  assert.equal(result.cashflowExpenses.length,1); assert.equal(result.cashflowExpenses[0].amount,40);
  assert.deepEqual(result.cashflowFeeStatus.scb_report_corrections,[{receipt_line_id:11,branch_id:1,
    business_date:'2026-08-25',stored_fee:50,reported_fee:40,gross_amount:1500,net_amount:1460}]);
  assert.deepEqual(row,original);
});

test('SCB never infers fee from unproven money, multiple matches, a batch or another channel', () => {
  for(const changes of [{settlement_source:'MANUAL'},{settlement_status:'EXCEPTION'}, {bank_match_count:0},
    {bank_match_count:2},{bank_match_amount:1450},{statement_amount:0},{matched_amount:null},
    {cashier_amount:1000},{settlement_batch_key:'batch',settlement_batch_allocated_fee_amount:50},
    {channel_code:'CREDIT_CARD_KTC'}]) {
    const result=buildCashflowFees([{...scbRow(),...changes}]);
    assert.equal(result.cashflowExpenses[0].amount,50); assert.deepEqual(result.cashflowFeeStatus.scb_report_corrections,[]);
  }
});

test('fee details and warning totals follow branch filter; valid zero fees may still have an income adjustment', () => {
  const row=grabRow(200);
  const result=buildCashflowFees([row,{...grabRow(),id:20,branch_id:2},scbRow()],{basis:'sheet',branchId:2});
  assert.deepEqual(result.cashflowExpenses.map(row=>row.branch_id),[2]);
  assert.equal(result.cashflowFeeStatus.grab_income_adjustment_total,70);
  assert.deepEqual(result.cashflowFeeStatus.scb_report_corrections,[]);
  assert.equal(buildCashflowFees([row],{basis:'sheet'}).cashflowExpenses[0].amount,200);
  assert.equal(buildCashflowFees([row]).cashflowExpenses.length,0);
});

test('SK Sheet keeps net deductions including its income adjustment; KK uses gross commissions', () => {
  const result=buildCashflowFees([grabRow(),{...grabRow(35),id:20,branch_id:2,branch_code:'SK'}],{basis:'sheet'});
  assert.deepEqual(result.cashflowExpenses.map(row=>row.amount),[200,165]);
  assert.equal(result.cashflowFeeStatus.grab_income_adjustment_total,105);
  assert.equal(result.cashflowFeeStatus.grab_adjustment_outside_profit_total,70);
  assert.deepEqual(result.cashflowFeeStatus.grab_income_adjustments.map(row=>row.treatment),['outside_profit','netted_fee']);
});
