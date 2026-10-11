import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestPeriodMonth, normalize, cents, classify } from '../src/pnl/domain.js';
import { buildReport } from '../src/pnl/report.js';
import { migratePnl, CREDIT_SUPPLIER_SEEDS, TAX_RULE_SEEDS } from '../src/pnl/schema.js';
const creditSuppliers=[{pattern:normalize('น้ำแข็ง'),active:1}];
test('credit and utility advice respects payment windows, exclusions, overrides, explicit priority and year boundary',()=>{
 const advice=(description,date,options={})=>suggestPeriodMonth(description,date,{creditSuppliers,...options});
 assert.equal(advice('ค่าน้ำแข็ง','2026-09-05').suggested_period_month,'2026-08');
 assert.match(advice('ค่าน้ำแข็ง','2026-09-05').suggested_period_reason,/ซัพเครดิต/);
 assert.equal(advice('ค่าน้ำแข็ง','2026-09-20').suggested_period_month,null);
 assert.equal(advice('น้ำแข็ง','2026-09-11',{category_code:'UTILITIES'}).suggested_period_month,'2026-08'); // ledger: credit paid days 1–15 = previous month
 assert.equal(advice('น้ำแข็ง','2026-09-16').suggested_period_month,null);
 assert.equal(advice('ค่าไฟ','2026-09-06').suggested_period_month,'2026-08');
 assert.equal(advice('บริการ','2026-09-07',{category_code:'UTILITIES'}).suggested_period_month,'2026-08');
 assert.equal(advice('บริการ','2026-09-08',{category_code:'UTILITIES'}).suggested_period_month,null); // ledger: utilities paid after day 7 stay
 assert.equal(advice('ค่าไฟ','2026-09-16').suggested_period_month,null);
 assert.equal(advice('ตลาดสดทั่วไป','2026-09-03').suggested_period_month,null);
 for(const options of [{period_month:'2026-07'},{excluded:true},{creditSuppliers:[{pattern:'น้ำแข็ง',active:0}]}])assert.equal(advice('น้ำแข็ง','2026-09-05',options).suggested_period_month,null);
 assert.equal(advice('น้ำแข็งเดือน กรกฎาคม','2026-09-05').suggested_period_month,'2026-07');
 assert.equal(advice('ค่าไฟเดือน กันยายน','2026-09-05').suggested_period_month,null);
 assert.equal(advice('น้ำแข็ง','2027-01-05').suggested_period_month,'2026-12');
});
test('report advises classified utilities but never suggests excluded/period-overridden items',()=>{
 const report=buildReport({month:'2026-09',rounds:[{id:1,status:'closed'}],creditSuppliers,
 rules:[{pattern:'โทรศัพท์',match_field:'purpose',category_code:'UTILITIES',priority:100}],
 items:['น้ำแข็ง','โทรศัพท์','น้ำแข็ง','น้ำแข็ง'].map((description,n)=>({stable_key:String(n),description,business_date:'2026-09-05',round_id:1,amount:1})),
 overrides:[{stable_key:'2',excluded:true},{stable_key:'3',period_month:'2026-08-01'}]});
 assert.equal(report.items[0].suggested_period_month,'2026-08');assert.equal(report.items[1].suggested_period_month,'2026-08');
 assert.equal(report.items[2].suggested_period_month,null);assert.equal(report.moved_out.items[0].suggested_period_month,null);
});
test('tax rules win generic rules and preserve explicit category overrides',()=>{
 const rules=TAX_RULE_SEEDS.map(([match_field,pattern],id)=>({id,match_field,pattern:normalize(pattern),category_code:'TAX',priority:50}));
 rules.push({id:10,match_field:'purpose',pattern:normalize('ตลาด'),category_code:'COGS_FOOD',priority:200});
 for(const [field,pattern] of TAX_RULE_SEEDS){const item={description:field==='purpose'?`${pattern} ตลาด`:'ตลาด',supplier_name:field==='supplier'?pattern:''};assert.equal(classify(item,rules).category_code,'TAX');assert.equal(classify(item,rules,{category_code:'OTHER'}).category_code,'OTHER');}
});
test('tax separates operating profit in month/matched and branch totals including manual and recurring',()=>{
 const report=buildReport({month:'2026-09',now:new Date('2026-10-11'),branches:[{id:1,name:'A'}],
 categories:[{code:'COGS_FOOD',is_cogs:1},{code:'OTHER'},{code:'TAX',pnl_group:'TAX'}],
 receipts:[{branch_id:1,receipt_date:'2026-09-05',status:'CLOSED',gross_sales_expected:1000}],rounds:[{id:1,branch_id:1,business_date:'2026-09-05',status:'closed'}],
 items:[['COGS_FOOD','100.01'],['OTHER','200.02'],['TAX','30.03']].map(([category_code,amount],n)=>({stable_key:String(n),round_id:1,branch_id:1,business_date:'2026-09-05',category_code,amount})),
 overrides:[{stable_key:'0',category_code:'COGS_FOOD'},{stable_key:'1',category_code:'OTHER'},{stable_key:'2',category_code:'TAX'}],
 manual:[{id:1,branch_id:1,category_code:'TAX',amount:'60.01'}],recurring:[{id:2,branch_id:null,category_code:'TAX',amount:'90.02',start_month:'2026-09-01'}]});
 assert.equal(report.totals.tax,180.06);assert.equal(report.totals.opex,200.02);assert.equal(report.totals.operating_profit,699.97);assert.equal(report.totals.net_profit_after_tax,519.91);
 assert.equal(report.totals_matched.tax,35.03);
 for(const matched of [false,true]){const total=matched?report.totals_matched:report.totals;const rows=report.category_rows.map(row=>matched?row.matched:row);
 assert.equal(total.net_profit,total.net_profit_after_tax);assert.equal(cents(total.operating_profit)-cents(total.tax),cents(total.net_profit_after_tax));
 assert.equal(rows.reduce((sum,row)=>sum+cents(row.amount),0),cents(total.cogs)+cents(total.opex)+cents(total.tax));
 for(const field of ['tax','opex','operating_profit','net_profit_after_tax','net_profit'])assert.equal(report.branch_columns.reduce((sum,row)=>sum+cents((matched?row.matched:row)[field]),0),cents(total[field]));}
});
test('version seeds survive deletion; column guards and transaction rollback are idempotent',async()=>{
 const flags=new Set(),suppliers=new Map(),rules=new Map(),columns=new Set();let backup;let fail=false;const ddl=[];
 const connection={async beginTransaction(){backup={flags:new Set(flags),suppliers:new Map(suppliers),rules:new Map(rules)};},async commit(){},async rollback(){for(const [target,old] of [[flags,backup.flags],[suppliers,backup.suppliers],[rules,backup.rules]]){target.clear();for(const entry of old)target instanceof Map?target.set(...entry):target.add(entry);}},async query(sql,args=[]){
 if(sql.includes('information_schema.COLUMNS'))return [[{cnt:columns.has(args.join(':'))?1:0}]];
 if(sql.startsWith('ALTER TABLE')&&sql.includes('ADD COLUMN')){ddl.push(sql);columns.add(sql.includes('pnl_group')?'pnl_categories:pnl_group':'pnl_item_overrides:period_month');}
 if(sql.startsWith('SELECT TABLE_NAME'))return [[{TABLE_NAME:'pnl_category_rules'}]];
 if(sql.startsWith('INSERT IGNORE INTO pnl_seed_versions')){if(flags.has(args[0]))return [{affectedRows:0}];flags.add(args[0]);return [{affectedRows:1}];}
 if(sql.startsWith('INSERT IGNORE INTO pnl_credit_suppliers')){if(fail)throw new Error('fixture');suppliers.set(args[0],args[1]);}
 if(sql.startsWith('INSERT IGNORE INTO pnl_category_rules'))rules.set(args.join(':'),args);
 return [[]];}};
 fail=true;await assert.rejects(migratePnl(connection));assert.equal(flags.size,0);fail=false;
 await migratePnl(connection);assert.equal(suppliers.size,CREDIT_SUPPLIER_SEEDS.length);assert.equal(rules.size,TAX_RULE_SEEDS.length);
 const supplier=[...suppliers.keys()][0],rule=[...rules.keys()][0];suppliers.delete(supplier);rules.delete(rule);
 await migratePnl(connection);assert.equal(suppliers.has(supplier),false);assert.equal(rules.has(rule),false);assert.equal(ddl.length,2);
});

test('tax seeds do not capture purchase tax invoices and credit cash purchases stay in month', async () => {
  const { TAX_RULE_SEEDS } = await import('../src/pnl/schema.js');
  const { normalize, classify, suggestPeriodMonth } = await import('../src/pnl/domain.js');
  const rules = TAX_RULE_SEEDS.map(([match_field, pattern], index) => ({ id: index + 1, match_field, pattern: normalize(pattern), category_code: 'TAX', priority: 50 }));
  const fuel = classify({ supplier_name: 'บริษัท ไทยธนากรุ๊ป(เชียงใหม่) จำกัด', description: 'ใบเสร็จ/ใบกำกับภาษีค่าน้ำมันดีเซล', amount: '2000.00' }, rules);
  assert.equal(fuel.category_code, null);
  const land = classify({ supplier_name: 'เทศบาลเมืองสุเทพ', description: 'ภาษีที่ดินลานจอดรถ', amount: '18701.76' }, rules);
  assert.equal(land.category_code, 'TAX');
  const credit = [{ pattern: normalize('น้ำแข็ง'), active: 1 }];
  assert.equal(suggestPeriodMonth('ค่าน้ำแข็ง', '2026-09-03', { supplier_name: 'ร้านน้ำแข็ง', payment_method: 'cash', creditSuppliers: credit }).suggested_period_month, null);
  assert.equal(suggestPeriodMonth('ค่าน้ำแข็ง', '2026-09-03', { supplier_name: 'ร้านน้ำแข็ง', payment_method: 'transfer', creditSuppliers: credit }).suggested_period_month, '2026-08');
});

test('utility advice ignores electrical shops and non-utility water purchases', async () => {
  const { suggestPeriodMonth } = await import('../src/pnl/domain.js');
  const ctx = (supplier_name) => ({ supplier_name, payment_method: 'transfer', creditSuppliers: [] });
  assert.equal(suggestPeriodMonth('ปลั๊ก', '2026-09-09', ctx('บริษัท ดลไฟฟ้า2018 จำกัด')).suggested_period_month, null);
  assert.equal(suggestPeriodMonth('ค่าน้ำมันรถ', '2026-09-03', ctx('ปั๊ม')).suggested_period_month, null);
  assert.equal(suggestPeriodMonth('ค่าไฟ โซลาว', '2026-09-06', ctx('การไฟฟ้าส่วนภูมิภาค')).suggested_period_month, '2026-08');
  assert.equal(suggestPeriodMonth('ค่าน้ำประปา', '2026-09-06', ctx('การประปาส่วนภูมิภาค')).suggested_period_month, '2026-08');
});
