import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestPeriodMonth, validatePeriodMonth, cents } from '../src/pnl/domain.js';
import { buildReport, loadReportData } from '../src/pnl/report.js';
import { migratePnl } from '../src/pnl/schema.js';

test('Thai period suggestions are advisory, handle BE years, abbreviations and year rollover', () => {
  for (const [text, date, expected] of [
    ['สรุปยอดชำระ supplier ประจำเดือน สิงหาคม 2569','2026-09-05','2026-08'],
    ['ค่าไฟเดือน ก.ย.','2026-09-06',null],
    ['ประจำเดือน ธันวาคม','2027-01-04','2026-12'],
    ['ไม่มีเดือนในข้อความ','2026-09-05',null],
    ['ค่าไฟเดือน มิ.ย. พ.ศ. 2569','2026-09-05','2026-06'],
    ['เดือน พฤษภาคม 2569','2026-09-05',null],
    ['เดือน ตุลาคม 2569','2026-09-05',null],
    ['เดือน สิงหาคม 2570','2026-09-05',null],
    ['เดือน สิงหาคม','2026-09-05','2026-08']
  ]) assert.equal(suggestPeriodMonth(text,date),expected,text);
});
test('period validation normalizes same month and accepts exactly three months back across year', () => {
  assert.equal(validatePeriodMonth(null,'2027-01-04'),null);
  assert.equal(validatePeriodMonth('2027-01','2027-01-04'),null);
  assert.equal(validatePeriodMonth('2026-10','2027-01-04'),'2026-10-01');
  for (const value of ['2027-02','2026-09','2026-13','2026-1','2026-12-01','',42,{},undefined])
    assert.throws(()=>validatePeriodMonth(value,'2027-01-04'),{code:'INVALID_PERIOD_MONTH',statusCode:422});
});
const data = {
  now:new Date('2026-10-10T00:00:00Z'),branches:[{id:1,name:'A'},{id:2,name:'B'}],categories:[{code:'OTHER'}],
  rounds:[{id:1,branch_id:1,business_date:'2026-09-05',status:'closed',reimbursement_count:4},
    {id:2,branch_id:1,business_date:'2026-08-01',status:'closed'},
    {id:3,branch_id:2,business_date:'2026-08-01',status:'closed'},
    {id:4,branch_id:1,business_date:'2026-09-06',status:'open'}],
  receipts:[{branch_id:1,receipt_date:'2026-08-01',status:'CLOSED',gross_sales_expected:100}],
  items:[{stable_key:'supplier',round_id:1,branch_id:1,business_date:'2026-09-05',amount:'467281.73',description:'สรุปยอดชำระ supplier ประจำเดือน สิงหาคม 2569'},
    {stable_key:'unassigned',round_id:1,branch_id:null,business_date:'2026-09-05',amount:'100.03'},
    {stable_key:'excluded',round_id:1,branch_id:1,business_date:'2026-09-05',amount:50},
    {stable_key:'open',round_id:4,branch_id:1,business_date:'2026-09-06',amount:999}]
};
const overrides = data.items.map(row=>({stable_key:row.stable_key,period_month:'2026-08-01',category_code:'OTHER',excluded:row.stable_key==='excluded'}));
test('moving preserves two-month full totals and source decrease equals destination increase', () => {
  const expense = report => cents(report.totals.cogs)+cents(report.totals.opex);
  const before = ['2026-08','2026-09'].map(month=>buildReport({...data,month}));
  const after = ['2026-08','2026-09'].map(month=>buildReport({...data,month,overrides}));
  // Before override, the excluded item is still counted; preserve its exclusion in both baselines.
  const baseline = ['2026-08','2026-09'].map(month=>buildReport({...data,month,overrides:overrides.map(row=>({...row,period_month:null}))}));
  assert.equal(expense(after[0])+expense(after[1]),expense(baseline[0])+expense(baseline[1]));
  assert.equal(expense(after[0])-expense(baseline[0]),expense(baseline[1])-expense(after[1]));
  assert.equal(after[0].totals.opex,467381.76);assert.equal(after[1].totals.opex,0);
  assert.equal(before[1].items[0].suggested_period_month,'2026-08');assert.equal(before[1].items[0].period_month,null);
  assert.equal(after[0].moved_in.count,3);assert.equal(after[1].moved_out.count,3);
  assert.equal(after[1].moved_out.items[0].period_month,'2026-08');
  assert.equal(after[0].reimbursement_count,0);assert.equal(after[1].reimbursement_count,4);
  assert.equal(after[0].items[0].category_code,'OTHER');assert.equal(after[0].excluded_total,50);
});
test('moved in matched expenses prorate branch days using cents and exclude unassigned/open/excluded', () => {
  const report=buildReport({...data,month:'2026-08',overrides});
  assert.equal(report.totals_matched.opex,Math.round(46728173/31)/100);
  assert.equal(report.matched_unassigned_excluded_total,100.03);
  assert.equal(report.branch_columns.reduce((sum,row)=>sum+cents(row.matched.opex),0),cents(report.totals_matched.opex));
  assert.equal(buildReport({...data,month:'2026-08',overrides,branchId:2}).moved_in.count,0);
  assert.equal(buildReport({...data,month:'2026-08',overrides,receipts:[]}).totals_matched.opex,0);
  assert.equal(buildReport({...data,month:'2026-09',overrides}).totals_matched.opex,0);
  const restored=buildReport({...data,month:'2026-09',overrides:overrides.map(row=>({...row,period_month:null}))});
  assert.equal(restored.moved_out.count,0);assert.equal(restored.items.length,3);
});
test('report queries load both date and destination groups including closed external rounds and overrides', async () => {
  const calls=[];const connection={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},query:async(sql,args)=>{calls.push([sql,args]);return [[]];}};
  await loadReportData(connection,'2026-08');
  for (const table of ['pnl_expense_items i JOIN pnl_expense_rounds','pnl_item_overrides o JOIN pnl_expense_items']) {
    const [sql,args]=calls.find(([sql])=>sql.includes(table));assert.ok(sql.includes('OR o.period_month=?'));assert.deepEqual(args,['2026-08-01','2026-08-31','2026-08-01']);
  }
  const [sql]=calls.find(([sql])=>sql.startsWith('SELECT r.*'));assert.ok(sql.includes("r.status='closed' AND EXISTS"));
});
test('period column DDL and information_schema ensure are idempotent for existing databases', async () => {
  let hasColumn=false;const calls=[];
  const connection={query:async(sql)=>{calls.push(sql);if(sql.includes('information_schema.COLUMNS'))return [[{cnt:hasColumn?1:0}]];
    if(sql.startsWith('ALTER TABLE pnl_item_overrides ADD COLUMN'))hasColumn=true;return [[]];}};
  await migratePnl(connection);await migratePnl(connection);
  assert.equal(calls.filter(sql=>sql.startsWith('ALTER TABLE pnl_item_overrides ADD COLUMN')).length,1);
  assert.ok(calls.find(sql=>sql.startsWith('CREATE TABLE IF NOT EXISTS pnl_item_overrides')).includes('period_month DATE NULL'));
});
