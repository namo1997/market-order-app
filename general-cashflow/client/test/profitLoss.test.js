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

test('waiting display sorts descending, caps at 15, searches supplier or description without mutating input', async () => {
 const {waitingPnlItems}=await import('../src/profitLoss.js');
 const items=Array.from({length:63},(_,i)=>({stable_key:String(i),amount:i,supplier_name:i===1?'ร้านพิเศษ':'ร้านทั่วไป',description:i===2?'RENT August':'วัตถุดิบ'}));
 const original=structuredClone(items);
 assert.equal(waitingPnlItems(items).items.length,15);assert.equal(waitingPnlItems(items).count,63);
 assert.equal(waitingPnlItems(items).items[0].amount,62);assert.equal(waitingPnlItems(items,'',true).items.length,63);
 assert.equal(waitingPnlItems(items,' ร้านพิเศษ ').items[0].amount,1);assert.equal(waitingPnlItems(items,'rent').items[0].amount,2);
 assert.equal(waitingPnlItems(items,'ไม่มี').count,0);assert.deepEqual(items,original);
});
test('zero categories and special columns require every value to be zero; unknown and offsetting values stay visible', async () => {
 const {isZeroPnlCategory,visiblePnlColumns}=await import('../src/profitLoss.js');
 assert.equal(isZeroPnlCategory({amount:0,branches:{1:0,2:'0'}}),true);
 for(const row of [{amount:0,branches:{1:10,2:-10}},{amount:null,branches:{1:0}},{amount:0,branches:{1:null}}])assert.equal(isZeroPnlCategory(row),false);
 const column=key=>({key,revenue:0,cogs:0,opex:0,gross_profit:0,net_profit:0});
 const view={branch_columns:['1','CENTRAL','UNASSIGNED','PRODUCTION'].map(column),category_rows:[{branches:{1:0,CENTRAL:0,UNASSIGNED:0,PRODUCTION:0}}]};
 assert.deepEqual(visiblePnlColumns(view).map(c=>c.key),['1']);
 view.category_rows.push({branches:{CENTRAL:2,UNASSIGNED:0,PRODUCTION:0}});
 assert.deepEqual(visiblePnlColumns(view).map(c=>c.key),['1','CENTRAL']);
 view.branch_columns[2].revenue=null;view.branch_columns[3].opex=3;
 assert.deepEqual(visiblePnlColumns(view).map(c=>c.key),['1','CENTRAL','UNASSIGNED','PRODUCTION']);
});
test('monthly display uses report matched days, branch days, cents and actual month length; skipped stays zero', async()=>{
 const {pnlMonthlyDisplay,pnlApproximateSources}=await import('../src/profitLoss.js');
 const report={month:'2026-09',matched_days:10,completeness:[{branch_id:1,matched_days:20}]};
 assert.equal(pnlMonthlyDisplay({amount:30000},report,'matched'),10000);
 assert.equal(pnlMonthlyDisplay({amount:30000,branch_id:1},report,'matched'),20000);
 assert.equal(pnlMonthlyDisplay({amount:30000},report,'month'),30000);
 assert.equal(pnlMonthlyDisplay({amount:30000,skipped:true},report,'matched'),0);
 assert.equal(pnlMonthlyDisplay({amount:.01},report,'matched'),0);
 assert.deepEqual(pnlApproximateSources({...report,recurring:{items:[{id:1},{id:2,skipped:true}]},manual_expenses:[{id:3}],moved_in:{items:[{id:4},{id:5,excluded:true}]}}).map(i=>i.id),[1,3,4]);
});


test('V2 comparison colors reflect revenue/profit versus expense, unknown and zero bases', async () => {
 const {pnlChange,formatPnlValue}=await import('../src/profitLoss.js');
 assert.deepEqual(pnlChange(120,100),{amount:20,percent:20,tone:'pnl-positive'});
 assert.equal(pnlChange(120,100,true).tone,'pnl-negative');
 assert.equal(pnlChange(80,100,true).tone,'pnl-positive');
 assert.equal(pnlChange(-80,-100).percent,20);
 assert.equal(pnlChange(80,100).tone,'pnl-negative');
 assert.equal(pnlChange(100,100).tone,'');
 assert.equal(pnlChange(10,0).percent,null);
 assert.equal(pnlChange(10,null).amount,null);
 assert.equal(pnlChange(.3,.1).amount,.2);
 assert.equal(formatPnlValue(0),'–');assert.equal(formatPnlValue(null),'–');assert.equal(formatPnlValue(-2),'-2.00');
});
test('V2 allocation contains loss overrun and ratios keep unknown revenue unknown', async () => {
 const {pnlAllocation,pnlRevenuePercent}=await import('../src/profitLoss.js');
 assert.deepEqual(pnlAllocation({revenue:100,cogs:40,opex:30,net_profit:30}),{cogs:40,opex:30,profit:30,loss:0,revenue:100});
 const loss=pnlAllocation({revenue:100,cogs:100,opex:100,net_profit:-100});
 assert.equal(loss.cogs+loss.opex,100);assert.equal(loss.profit,0);assert.equal(loss.loss,50);assert.equal(loss.revenue,50);
 assert.equal(pnlRevenuePercent(10,0),null);assert.equal(pnlRevenuePercent(null,100),null);assert.equal(pnlRevenuePercent(0,100),0);assert.equal(pnlRevenuePercent(-20,100),-20);
 assert.ok(Object.values(pnlAllocation({revenue:0,cogs:0,opex:0,net_profit:0})).every(Number.isFinite));
});
test('V2 month navigation preserves Gregorian API months and Buddhist labels across years', async () => {
 const {nextMonth,formatPnlMonth}=await import('../src/profitLoss.js');
 assert.equal(nextMonth('2026-12'),'2027-01');assert.equal(previousMonth(nextMonth('2026-12')),'2026-12');
 assert.equal(formatPnlMonth('2026-09','long'),'กันยายน 2569');assert.equal(nextMonth('2026-09'),'2026-10');assert.equal(formatPnlMonth('2027-01'),'ม.ค. 2570');
});
