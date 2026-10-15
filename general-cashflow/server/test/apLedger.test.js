import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { cents, decimal, sum, dueDate, paymentPeriod, vatInclusive, postDocument, validateJournal, reverseJournal, uniqueDocuments, threeWayMatch, supplierLedger, trialBalance, isPassThrough } from '../src/ap/domain.js';
import { compileSnapshot, TABLES, statementDirection, readSnapshot, hash } from '../src/ap/snapshot.js';
import { buildApReport } from '../src/ap/report.js';
import { createApRouter } from '../src/ap/routes.js';
import { assertPermission } from '../src/domain/permissions.js';
import { AP_DDL } from '../src/ap/schema.js';
const doc = changes => ({ key: 'lbc:bill:example', amount: '107.00', date: '2026-09-15', branch: 'X', supplier: 's1', type: 'bill', fullTaxInvoice: true, ...changes });
test('integer satang, strict decimal inputs and overflow never produce rounding drift', () => {
  assert.equal(sum(Array.from({length:1000},()=>cents('0.01'))),1000);
  assert.equal(decimal(sum([cents('0.10'),cents('0.20')])),'0.30');
  assert.equal(decimal(cents('-999999999999.99')),'-999999999999.99');
  for(const value of ['1.001','NaN','1e3','Infinity','1000000000000.00']) assert.throws(()=>cents(value));
});
test('all purchase/payment/opening journals balance, VAT is 7/107 only with full evidence', () => {
  assert.deepEqual(vatInclusive('107.00',true),{gross:10700,tax:700,cost:10000,flags:[]});
  assert.equal(vatInclusive('0.08',true).tax,1);
  assert.equal(vatInclusive('107.00',false).tax,0);
  for(const type of ['bill','cash_purchase','payment','opening']) assert.equal(validateJournal(postDocument(doc({type}))).type,type);
  const broken=postDocument(doc({}));broken.lines[0].dr='99.99';assert.throws(()=>validateJournal(broken),/UNBALANCED/);
});
test('void and return append reversals with exact tax lines and cancel trial balance', () => {
  const first=postDocument(doc({}));const reversal=reverseJournal(first,{key:'reverse:1',date:'2026-09-16',reason:'คืนสินค้าทั้งบิล'});
  assert.equal(reversal.reverses,first.key);assert.notEqual(first.lines,reversal.lines);
  assert.ok(trialBalance([first,reversal],{from:'2026-09-01',to:'2026-09-30'}).every(r=>r.closing==='0.00'));
  assert.throws(()=>reverseJournal(first,{key:'reverse:2',date:'2026-09-14',reason:'void'}));
  assert.throws(()=>reverseJournal(first,{key:'reverse:3',date:'2026-09-16',reason:'ลดหนี้บางส่วน',amount:'53.50'}),/EXPLICIT_LINES/);
});
test('credit receiving cycle 1–15 pays 20 and 16–end pays next 5, including year/leap boundary', () => {
  for(const [d,due] of [['2026-09-01','2026-09-20'],['2026-09-15','2026-09-20'],['2026-09-16','2026-10-05'],['2026-09-30','2026-10-05'],['2026-12-31','2027-01-05'],['2028-02-29','2028-03-05']]) assert.equal(dueDate(d),due);
  assert.throws(()=>dueDate('2026-02-29'));
});
test('owner rule only day 5–6 credit payments belong to prior purchase month; never generate receiving date', () => {
  assert.equal(paymentPeriod('2026-09-05',true),'2026-08');assert.equal(paymentPeriod('2026-09-06',true),'2026-08');
  assert.equal(paymentPeriod('2026-01-05',true),'2025-12');
  assert.equal(paymentPeriod('2026-09-07',true),'2026-09');assert.equal(paymentPeriod('2026-09-05',false),'2026-09');
});
test('Keng pass-through is an asset, never expense or VAT; other meat vendors remain purchases', () => {
  assert.equal(isPassThrough('ร้านเนื้อสมมติ'),false);
  const j=postDocument(doc({type:'cash_purchase',supplierName:'พี่เก้ง',description:'เงินจ่ายร้านเนื้อย่าง'}));
  assert.equal(j.lines[0].account,'PASS_THROUGH');assert.equal(j.lines[0].dr,'107.00');assert.equal(j.lines.length,2);
});
test('one canonical LBC source counts once; conflicting duplicate is rejected', () => {
  const a=doc({sourceKey:'lbc:bill:example'});
  assert.equal(uniqueDocuments([a,{...a,key:'other-adapter',amount:'107.0'}]).length,1);
  assert.throws(()=>uniqueDocuments([a,{...a,amount:'108.00'}]),/CONFLICTING_SOURCE/);
});
test('receiving adapter compares stable item, quantity, unit and price; absent documents stay pending', () => {
  const item={itemKey:'order:item:example',quantity:'1.125',unit:'kg',unitPrice:'20.01'};
  assert.equal(threeWayMatch({order_items:[item],receiving_documents:[item],bill_items:[item]}).status,'matched');
  assert.equal(threeWayMatch({order_items:[item],receiving_documents:[{...item,quantity:'1.126'}],bill_items:[{...item,unitPrice:'20.02'}]}).differences.length,2);
  assert.equal(threeWayMatch({order_items:[item]}).status,'pending');
});
test('missing opening/purchase evidence never presents negative movement as certified AP closing or aging', () => {
  const journals=[postDocument(doc({type:'payment'}))];
  const [r]=supplierLedger({journals,suppliers:[{key:'s1',branch:'X'}],from:'2026-09-01',to:'2026-09-30'});
  assert.equal(r.paid,'107.00');assert.equal(r.closing,null);assert.equal(r.opening,null);assert.equal(r.purchases,null);assert.equal(r.aging,null);
});
test('bank matching requires explicit debit evidence; positive amount alone and exact amounts do not match', () => {
  assert.equal(statementDirection({amount:'107.00',raw_payload:{}}),'unknown');
  assert.equal(statementDirection({amount:'107.00',raw_payload:{'ยอดฝาก':'107.00'}}),'incoming');
  assert.equal(statementDirection({amount:'107.00',raw_payload:{debit:'107.00'}}),'outgoing');
  assert.equal(statementDirection({amount:'107.00',raw_payload:{debit:'107.00',credit:'107.00'}}),'unknown');
});
const fixture=()=>{
  const data=Object.fromEntries(TABLES.map(t=>[t,[]]));
  data.branches=[{id:1,code:'X',name:'สาขาสมมติ'}];data.pnl_expense_rounds=[{id:1,status:'closed',branch_id:1,business_date:'2026-09-05'}];
  data.pnl_credit_suppliers=[{id:1,active:1,pattern:'ซัพทดสอบ',display_name:'ซัพทดสอบ'}];
  data.pnl_categories=[{code:'COGS_FOOD',is_cogs:1,name:'วัตถุดิบ'}];
  data.pnl_category_rules=[{id:1,match_field:'supplier',pattern:'ซัพทดสอบ',category_code:'COGS_FOOD',priority:1}];
  data.pnl_expense_items=[{stable_key:'lbc:bill:synthetic',bill_id:'synthetic',round_id:1,branch_id:1,business_date:'2026-09-05',supplier_name:'บริษัท ซัพทดสอบ จำกัด',amount:'107.00',payment_method:'bank_transfer',transaction_type:'purchase',profile_status:'reviewed'}];
  data.statement_transactions=[{id:1,amount:'107.00',transaction_date:'2026-09-05',raw_payload:{'ยอดฝาก':'107.00'}}];
  return {data,checksums:{},capturedAt:'2026-10-13T00:00:00Z'};
};
test('snapshot deterministic import maps paid credit to AP debit only, preserves P&L and deduplicates', () => {
  const input=fixture(),a=compileSnapshot(input,'2026-09'),b=compileSnapshot(input,'2026-09');
  assert.equal(a.fingerprint,b.fingerprint);assert.deepEqual(a,b);
  assert.equal(a.journals.length,1);assert.equal(a.journals[0].type,'payment');assert.equal(a.sources[0].purchasePeriod,'2026-08');
  const r=buildApReport(a,{month:'2026-09',branch:'X'});
  assert.equal(r.reconciliation.pnlLbc,'107.00');assert.equal(r.reconciliation.journalCost,'0.00');assert.equal(r.reconciliation.matchedCount,0);
  assert.equal(r.reconciliation.cases[0].difference,'-107.00');assert.equal(r.branchRows.length,1);
  input.data.pnl_expense_items.push({...input.data.pnl_expense_items[0]});
  const c=compileSnapshot(input,'2026-09');assert.equal(c.journals.length,1);assert.equal(c.metadata.duplicateCount,1);
});
test('snapshot validates compressed-file checksums and refuses missing required tables (SSD fixtures only)', async () => {
  assert.ok(process.env.TMPDIR?.startsWith('/Volumes/SSD Files/SOLAO/cashflow/'), 'Run generated fixtures on the approved SSD');
  const root=await fs.mkdtemp(path.join(process.env.TMPDIR,'ap-snapshot-'));
  const f=fixture(),tables=[];
  for(const name of TABLES){const bytes=gzipSync(JSON.stringify(f.data[name]));await fs.writeFile(path.join(root,`${name}.rows.json.gz`),bytes);tables.push({name,file:`${name}.rows.json.gz`,sha256:hash(bytes),row_count:f.data[name].length});}
  const manifest={tables,snapshot_at_utc:f.capturedAt};
  await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest));
  assert.equal((await readSnapshot(root)).data.pnl_expense_items.length,1);
  await fs.writeFile(path.join(root,'branches.rows.json.gz'),gzipSync('[]'));
  await assert.rejects(readSnapshot(root),/CHECKSUM_FAILED/);
  await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify({...manifest,tables:tables.filter(t=>t.name!=='branches')}));
  await assert.rejects(readSnapshot(root),/REQUIRED_TABLE_MISSING/);
});
test('schema is additive/idempotent with decimal money and no legacy ALTER/DELETE', () => {
  assert.ok(AP_DDL.every(sql=>sql.startsWith('CREATE TABLE IF NOT EXISTS ap_')));
  assert.ok(AP_DDL.some(sql=>sql.includes('DECIMAL(14,2)')));
  assert.ok(AP_DDL.every(sql=>! /\bALTER\b|\bDELETE\b/.test(sql)));
});
test('API protects financial reads with native permissions, rejects writes and sanitizes DB errors', async () => {
  let reads=0;
  const router=createApRouter({ getPool:()=>{reads++;throw new Error('private DB details');},
    authenticate:(req,res,next)=>req.headers['x-test-role'] ? (req.user={role:req.headers['x-test-role']},next()) : res.sendStatus(401),
    requirePermission:p=>(req,res,next)=>{try{assertPermission(req.user,p);next();}catch{res.sendStatus(403);}} });
  // Exercise router middleware directly: no listener, synthetic credentials or network required.
  const call=(role,method='GET')=>new Promise((resolve,reject)=>{
    const req={method,url:'/report?month=2026-09',originalUrl:'/report?month=2026-09',query:{month:'2026-09'},headers:role?{'x-test-role':role}:{}};
    const res={statusCode:200,status(n){this.statusCode=n;return this;},sendStatus(n){resolve({status:n});},json(body){resolve({status:this.statusCode,body});}};
    router.handle(req,res,error=>error?reject(error):reject(new Error('Unexpected fallthrough')));
  });
    assert.equal((await call()).status,401);
    for(const role of ['cashier','auditor','recorder','accountant']) assert.equal((await call(role)).status,403);
    assert.equal(reads,0);
    assert.equal((await call('admin','POST')).status,405);assert.equal(reads,0);
    const r=await call('admin');assert.equal(r.status,503);assert.ok(!JSON.stringify(r.body).includes('private'));
});
