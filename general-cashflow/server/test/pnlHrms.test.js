import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHrmsExpenses, loadHrmsExpenses } from '../src/pnl/hrms.js';
import { buildReport } from '../src/pnl/report.js';
const fixture = () => ({ month:'2026-08', now:new Date('2026-10-10T00:00:00Z'),
 branches:[{id:1,code:'KK',name:'คันคลอง'}], branchMap:{KK:'KK',Office:'CENTRAL',Factory:'PRODUCTION'},
 run:{month:'2026-08',status:'LOCKED',period_start:'2026-07-26',period_end:'2026-08-25',total_net:12000,
 items:[{id:'p1',item_status:'LOCKED',branch:'KK',net_pay:12000,employee_name:'PRIVATE',account_number:'SECRET'}]},
 advances:{paymentMonth:'2026-08',scope:{mode:'GLOBAL'},employees:[{employeeId:'a',branchName:'KK',principal:3000,interest:90,repayment:3090}],totals:{principal:3000}} });
test('paid net + advance principal once, no interest or deduction addback and no personal fields',()=>{
 const result=buildHrmsExpenses(fixture());
 assert.equal(result.hrmsStatus.net_pay,12000);assert.equal(result.hrmsStatus.advance_principal,3000);
 assert.equal(result.hrmsExpenses.reduce((s,r)=>s+r.amount,0),15000);
 assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.ok(!JSON.stringify(result).includes('SECRET'));
 assert.equal(result.hrmsStatus.payment_basis,'OWNER_CONFIRMED_PAID');
 const report=buildReport({...fixture(),hrmsExpenses:result.hrmsExpenses,categories:[{code:'STAFF',is_cogs:false}]});
 assert.equal(report.totals.opex,15000);assert.equal(report.totals_matched.opex,15000);
 assert.equal(report.category_rows.find(r=>r.code==='STAFF').amount,15000);
 const overlap=buildReport({...fixture(),hrmsExpenses:result.hrmsExpenses,manual:[{id:1,branch_id:1,category_code:'STAFF',amount:1000}]});
 assert.equal(overlap.hrms_possible_overlap_total,1000);assert.equal(overlap.totals.opex,16000);
});
test('central, production and unmapped retain amounts; branch filter removes other buckets',()=>{
 const f=fixture();f.run.items=[{id:'1',item_status:'LOCKED',branch:'Office',net_pay:4000},{id:'2',item_status:'LOCKED',branch:'Factory',net_pay:5000},{id:'3',item_status:'LOCKED',branch:'Missing',net_pay:3000}];
 const result=buildHrmsExpenses(f);assert.deepEqual(result.hrmsStatus.unmapped_branches,['Missing']);
 const report=buildReport({...f,hrmsExpenses:result.hrmsExpenses,categories:[{code:'STAFF'}]});
 assert.equal(report.branch_columns.reduce((s,r)=>s+r.opex,0),15000);
 assert.equal(report.branch_columns.find(r=>r.key==='PRODUCTION').opex,5000);
 assert.equal(buildReport({...f,branchId:1,hrmsExpenses:result.hrmsExpenses}).totals.opex,3000);
});
test('draft payroll excluded, future advances excluded, malformed or restricted payload fails closed',()=>{
 const f=fixture();f.run.status='REVIEW';assert.equal(buildHrmsExpenses(f).hrmsStatus.net_pay,0);
 f.now=new Date('2026-08-10T00:00:00Z');assert.equal(buildHrmsExpenses(f).hrmsExpenses.length,0);
 f.advances.scope.mode='BRANCH';assert.throws(()=>buildHrmsExpenses(f));
 for(const change of [(f)=>f.run.total_net=10,(f)=>f.run.items.push(f.run.items[0]),(f)=>f.run.items[0].net_pay=null,(f)=>f.run.items[0].item_status='CALCULATED']){const bad=fixture();change(bad);assert.throws(()=>buildHrmsExpenses(bad));}
});
test('GET-only server adapter, no writes or upstream error/credential disclosure',async()=>{
 const f=fixture();const calls=[];
 const config={hrmsBaseUrl:'https://hrms.example',hrmsToken:`e30.${Buffer.from(JSON.stringify({role:'ADMIN'})).toString('base64url')}.PRIVATE_TOKEN`,hrmsBranchMap:JSON.stringify(f.branchMap)};
 const result=await loadHrmsExpenses({...f,config,fetchImpl:async(url,options)=>{calls.push({url:String(url),...options});return {ok:true,json:async()=>String(url).includes('/summary?')?f.advances:String(url).includes('/tips/')?{run:null,pools:[],allocations:[]}:{run:f.run}};}});
 assert.equal(result.hrmsStatus.status,'available');assert.equal(calls.length,3);
 assert.ok(calls.every(c=>c.method==='GET'&&c.redirect==='error'&&c.signal));
 assert.ok(!JSON.stringify(result).includes('PRIVATE_TOKEN'));
 const failure=await loadHrmsExpenses({...f,config,fetchImpl:async()=>{throw new Error('PRIVATE_TOKEN upstream secret');}});
 assert.deepEqual(failure,{hrmsExpenses:[],hrmsStatus:{status:'unavailable',code:'PNL_HRMS_UNAVAILABLE'}});
 assert.equal((await loadHrmsExpenses({...f,config:{}})).hrmsStatus.status,'not_configured');
 const restricted={...config,hrmsToken:`e30.${Buffer.from(JSON.stringify({role:'PAYROLL_REVIEWER'})).toString('base64url')}.fixture`};
 assert.equal((await loadHrmsExpenses({...f,config:restricted,fetchImpl:async()=>{assert.fail('restricted token must not request company payroll');}})).hrmsStatus.status,'unavailable');
});

test('uncategorized payroll text still warns about HRMS overlap, excluded funding does not',()=>{
 const f=fixture(); const report=buildReport({...f,rounds:[{id:1,status:'closed'}],items:[{stable_key:'fund',round_id:1,branch_id:1,business_date:'2026-08-31',supplier_name:'เงินเดือน',amount:330000},{stable_key:'wage',round_id:1,branch_id:1,business_date:'2026-08-18',description:'ค่าแรงรายวัน',amount:360}],overrides:[{stable_key:'fund',excluded:true}]});
 assert.equal(report.hrms_possible_overlap_total,360);assert.equal(report.excluded_total,330000);
});

test('finalized separate tips include temporary recipients once, draft tips excluded and totals verified',()=>{
 const f=fixture();f.tips={run:{status:'FINALIZED',payout_month:'2026-08'},pools:[{id:'pool',branch_id:'branch',branch_name:'KK',amount:500,status:'FINALIZED'}],allocations:[{id:'a',pool_id:'pool',branch_id:'branch',payout_amount:300},{id:'temp',pool_id:'pool',branch_id:'branch',payout_amount:200,is_temporary:true}]};
 assert.equal(buildHrmsExpenses(f).hrmsStatus.separate_tips,500);
 assert.equal(buildHrmsExpenses(f).hrmsExpenses.reduce((s,r)=>s+r.amount,0),15500);
 f.tips.run.status='DRAFT';assert.equal(buildHrmsExpenses(f).hrmsStatus.separate_tips,0);
 f.tips.run.status='FINALIZED';f.tips.allocations.push(f.tips.allocations[0]);assert.throws(()=>buildHrmsExpenses(f));
 f.tips.allocations.pop();f.tips.pools[0].amount=499;assert.throws(()=>buildHrmsExpenses(f));
});
