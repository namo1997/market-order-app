import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { openingTemplate, parseOpeningCsv, openingDate, openingJournals, OPENING_HEADERS } from '../src/ap/opening.js';
import { supplierLedger, postDocument, validateJournal, trialBalance } from '../src/ap/domain.js';
import { compileSnapshot, TABLES } from '../src/ap/snapshot.js';
import { buildApReport, loadApBundle } from '../src/ap/report.js';
import { importAp } from '../scripts/import-ap-snapshot.mjs';
import { importApOpening } from '../scripts/import-ap-opening.mjs';

const suppliers = [
  { key: 'credit:X:1', branch: 'X', name: 'ซัพสมมติ, ก' },
  { key: 'credit:X:2', branch: 'X', name: 'ซัพสมมติ ข' },
  { key: 'credit:Y:1', branch: 'Y', name: 'ซัพสมมติ ก' }
];
const options = { suppliers, month: '2026-09' };
const cell = v => `"${String(v).replaceAll('"','""')}"`;
const row = (s, amount, changes = {}) => {
  const r = { branch: s.branch, key: s.key, name: s.name, amount, date: '2026-08-31', note: '', ...changes };
  return [r.branch,r.key,r.name,r.amount,r.date,r.note].map(cell).join(',');
};
const csv = rows => '\uFEFF' + OPENING_HEADERS.join(',') + '\r\n' + rows.join('\r\n') + '\r\n';
const filled = amounts => csv(suppliers.map((s,i) => row(s, amounts[i])));

test('Thai template has BOM, correct keys and blank amounts; previous-month date handles leap/year', () => {
  const template = openingTemplate(suppliers, '2026-09');
  assert.ok(template.startsWith('\uFEFF'));assert.ok(template.includes('"ซัพสมมติ, ก"'));
  assert.equal(parseOpeningCsv(Buffer.from(template), options).entries.length, 0);
  assert.equal(parseOpeningCsv(template, options).missing.length, 3);
  assert.equal(openingDate('2026-01'), '2025-12-31');
  assert.equal(openingDate('2028-03'), '2028-02-29');
});
test('UTF-8 BOM/quoted commas/newlines/escaped quotes work; blank unknown and zero confirmed', () => {
  const data = parseOpeningCsv(csv([row(suppliers[0], '0', { note: 'บรรทัดหนึ่ง\n"อ้างอิง", สอง' }), row(suppliers[1], '')]), options);
  assert.equal(data.entries[0].amount, '0.00');assert.equal(data.missing.length, 2);
  assert.equal(data.entries[0].note, 'บรรทัดหนึ่ง\n"อ้างอิง", สอง');
  assert.throws(() => parseOpeningCsv(Buffer.from([0xff]), options));
});
test('reject unknown/wrong-branch/wrong-name/duplicate supplier with row number', () => {
  for (const [changes, code] of [[{key:'unknown'},'UNKNOWN_SUPPLIER'],[{branch:'Y'},'UNKNOWN_SUPPLIER'],[{name:'ผิด'},'NAME_MISMATCH']]) {
    assert.throws(() => parseOpeningCsv(csv([row(suppliers[0],'1',changes)]), options), e => e.message.includes(code) && e.csvRow === 2);
  }
  assert.throws(() => parseOpeningCsv(csv([row(suppliers[0],'1'),row(suppliers[0],'2')]), options), /DUPLICATE_SUPPLIER/);
  assert.throws(() => parseOpeningCsv(csv([row(suppliers[0],'1'),row(suppliers[0],'')]), options), /DUPLICATE_SUPPLIER/);
});
test('reject negative, >2 decimals, scientific, grouped, NaN and overflowing money', () => {
  for (const amount of ['-1','-0','0.001','1.999','1e3','1,000.00','NaN','Infinity','1000000000000.00','.50','1.']) {
    assert.throws(() => parseOpeningCsv(csv([row(suppliers[0],amount)]), options), /INVALID_AMOUNT/, amount);
  }
  for (const amount of ['0','0.01','1.2','999999999999.99']) assert.equal(parseOpeningCsv(csv([row(suppliers[0],amount)]), options).entries.length, 1);
});
test('date must be valid ISO and exactly previous day, even when amount is blank', () => {
  for (const date of ['2026-08-30','2026-09-01','2569-08-31','31/08/2569','2026-02-30','']) {
    assert.throws(() => parseOpeningCsv(csv([row(suppliers[0], '', {date})]), options), /DATE/);
  }
  assert.throws(() => parseOpeningCsv(csv([row(suppliers[0],'1',{note:'x'.repeat(1001)})]), options), /NOTE_TOO_LONG/);
});
test('invalid header, column counts and malformed quoted CSV are rejected', () => {
  assert.throws(() => parseOpeningCsv('wrong\n',options), /HEADERS/);
  assert.throws(() => parseOpeningCsv(OPENING_HEADERS.join(',')+'\nX,1',options), /CSV/);
  assert.throws(() => parseOpeningCsv(OPENING_HEADERS.join(',')+'\n"unclosed',options), /CSV/);
});
test('semantic fingerprint stable across BOM/row order/amount format; note changes are audited', () => {
  const a = parseOpeningCsv(filled(['100','0','']),options);
  const b = parseOpeningCsv(csv([row(suppliers[1],'0.00'),row(suppliers[0],'100.00')]).replace('\uFEFF',''),options);
  assert.equal(a.fingerprint,b.fingerprint);
  assert.notEqual(a.fingerprint,parseOpeningCsv(csv([row(suppliers[0],'100',{note:'แก้ข้อมูล'})]),options).fingerprint);
});
test('opening and replacement balance; FIFO removes reversed lot and sorts oldest first', () => {
  const old = openingJournals(parseOpeningCsv(filled(['100','0','0']),options), {id:1}).journals;
  const next = openingJournals(parseOpeningCsv(filled(['150','0','0']),options), {id:2,previous:old});
  const bill = postDocument({key:'bill',sourceKey:'bill',branch:'X',supplier:suppliers[0].key,type:'bill',date:'2026-09-16',amount:'200'});
  const payment = postDocument({key:'paid',sourceKey:'paid',branch:'X',supplier:suppliers[0].key,type:'payment',date:'2026-09-20',amount:'120'});
  const journals = [bill,payment,...old,...next.reversals,...next.journals];
  journals.forEach(validateJournal);
  const [result] = supplierLedger({journals,suppliers,from:'2026-09-01',to:'2026-09-30',branch:'X',complete:true});
  assert.equal(result.opening,'150.00');assert.equal(result.purchases,'200.00');assert.equal(result.paid,'120.00');assert.equal(result.closing,'230.00');
  assert.deepEqual(result.aging,{current:'200.00',days1_30:'30.00',days31_60:'0.00',days61_90:'0.00',days91plus:'0.00'});
  const tb=trialBalance(journals,{from:'2026-09-01',to:'2026-09-30'});
  assert.equal(tb.find(r=>r.account==='AP').closing,'-230.00');
  assert.equal(old[0].lines[1].cr,'100.00');
});
test('opening baseline aging boundaries, advances, and unknown invoice due date remain explicit', () => {
  const journals=openingJournals(parseOpeningCsv(filled(['100','0','0']),options),{id:1}).journals;
  for(const [to,bucket] of [['2026-08-31','current'],['2026-09-30','days1_30'],['2026-10-01','days31_60'],['2026-10-31','days61_90'],['2026-11-30','days91plus']]) {
    const [r]=supplierLedger({journals,suppliers,from:'2026-09-01',to,branch:'X',complete:true});assert.equal(r.aging[bucket],'100.00');
  }
  const payment=postDocument({key:'advance',branch:'X',supplier:suppliers[0].key,type:'payment',date:'2026-09-05',amount:'120'});
  const [r]=supplierLedger({journals:[...journals,payment],suppliers,from:'2026-09-01',to:'2026-09-30',complete:true});
  assert.equal(r.closing,'-20.00');assert.equal(r.advance,'20.00');assert.ok(Object.values(r.aging).every(v=>v==='0.00'));
  const raw=postDocument({key:'legacy',branch:'X',supplier:suppliers[0].key,type:'opening',date:'2026-08-31',amount:'100'});
  assert.equal(supplierLedger({journals:[raw],suppliers,from:'2026-09-01',to:'2026-09-30',complete:true})[0].aging,null);
});

function fixture() {
  const data=Object.fromEntries(TABLES.map(t=>[t,[]]));
  data.branches=[{id:1,code:'X',name:'สาขาสมมติ X'},{id:2,code:'Y',name:'สาขาสมมติ Y'}];
  data.pnl_credit_suppliers=[{id:1,active:1,pattern:'ตัวอย่าง ก',display_name:'ตัวอย่าง ก'},{id:2,active:1,pattern:'ตัวอย่าง ข',display_name:'ตัวอย่าง ข'}];
  data.pnl_categories=[{code:'COGS_FOOD',is_cogs:1,name:'วัตถุดิบ'}];
  return compileSnapshot({data,capturedAt:'2026-10-15T00:00:00Z'},'2026-09');
}
test('report opens only complete branch, exposes missing identities and keeps purchase/payment caveats', () => {
  const bundle=fixture(), s=bundle.suppliers;
  bundle.periodControls=[{branch:'X',openingComplete:true,document:{openingDate:'2026-08-31',openingAgingBasis:'AS_OF_DATE_ESTIMATE'}},
    {branch:'Y',openingComplete:false,document:{openingMissing:s.filter(v=>v.branch==='Y')}}];
  bundle.journals=openingJournals(parseOpeningCsv(csv(s.filter(v=>v.branch==='X').map(v=>row(v,'100'))),{suppliers:s,month:'2026-09'}),{id:1}).journals;
  const r=buildApReport(bundle,{month:'2026-09'});
  assert.equal(r.controls.openingComplete,false);assert.equal(r.controls.missingSuppliers.length,2);
  assert.equal(r.ledger[0].closing,'100.00');assert.equal(r.ledger[0].purchases,null);assert.equal(r.ledger[0].provisional,true);
  assert.equal(r.ledger.find(v=>v.branch==='Y').closing,null);
  assert.equal(r.branchRows[0].closing,'200.00');
  const selected=buildApReport(bundle,{month:'2026-09',branch:'X'});
  assert.equal(selected.controls.openingComplete,true);assert.equal(selected.controls.purchasesComplete,false);
});

// Transactional repository model: exercises the real importer without requiring a socket.
// The separate MySQL test below remains required to verify SQL/locking on the real engine.
function repositoryModel(bundle) {
  let state={imports:[],sources:[],heads:[],lines:[],controls:bundle.metadata.branches.map(b=>({
    batch_id:1,branch_code:b.code,opening_complete:0,purchases_complete:0,payments_complete:0,
    document:JSON.stringify({supplierKeys:bundle.suppliers.filter(s=>s.branch===b.code).map(s=>s.key)})
  }))}, backup;
  const c={failLine:false,get state(){return structuredClone(state);},
    async beginTransaction(){backup=structuredClone(state);},async commit(){backup=null;},async rollback(){state=backup;backup=null;},
    async query(sql,v=[]){
      if(sql.startsWith('SELECT @@')) return [[{datadir:process.env.TMPDIR+'/',socket:process.env.TMPDIR+'/model.sock',offline:1}]];
      if(sql.startsWith('CREATE TABLE')||sql.startsWith('INSERT IGNORE INTO ap_accounts')) return [{}];
      if(sql.startsWith('SELECT id FROM ap_batches')) return [[{id:1}]];
      if(sql.startsWith('SELECT * FROM ap_period_controls')) return [structuredClone(state.controls)];
      if(sql.startsWith('SELECT supplier_key')) return [structuredClone(bundle.suppliers)];
      if(sql.startsWith('SELECT * FROM ap_opening_imports')) return [[state.imports.at(-1)].filter(Boolean)];
      if(sql.startsWith('INSERT INTO ap_opening_imports')) {
        const id=state.imports.length+1;state.imports.push({id,batch_id:v[0],fingerprint:v[1],previous_id:v[2],document:v[3]});return [{insertId:id}];
      }
      if(sql.startsWith('UPDATE ap_opening_imports')) {state.imports.find(r=>r.id===v[1]).document=v[0];return [{}];}
      if(sql.startsWith('INSERT INTO ap_sources')) {
        assert.ok(!state.sources.some(s=>s.key===v[0]));state.sources.push({key:v[0]});return [{}];
      }
      if(sql.startsWith('INSERT INTO ap_source_links'))return [{}];
      if(sql.startsWith('UPDATE ap_period_controls')) {
        const control=state.controls.find(r=>r.branch_code===v[3]);control.opening_complete=Number(v[0]);control.document=v[1];return [{}];
      }
      if(sql.startsWith('INSERT INTO ap_journals')) {
        assert.ok(state.sources.some(s=>s.key===v[1]));assert.ok(!state.heads.some(j=>j.key===v[0]));
        if(v[6]) {assert.ok(state.heads.some(j=>j.key===v[6]));assert.ok(!state.heads.some(j=>j.reverses===v[6]));}
        state.heads.push({key:v[0],sourceKey:v[1],date:v[2],branch:v[3],type:v[4],dueDate:v[5],reverses:v[6],description:v[7],flags:JSON.parse(v[8])});return [{}];
      }
      if(sql.startsWith('INSERT INTO ap_journal_lines')) {
        if(c.failLine)throw new Error('INJECTED_INSERT_FAILURE');
        state.lines.push({journal:v[0],account:v[2],supplier:v[3],dr:v[4],cr:v[5]});return [{}];
      }
      throw new Error('Unhandled model query: '+sql);
    },
    bundle(){return {...bundle,journals:state.heads.map(j=>({...j,lines:state.lines.filter(l=>l.journal===j.key)})),
      periodControls:state.controls.map(c=>({branch:c.branch_code,openingComplete:Boolean(c.opening_complete),document:JSON.parse(c.document)}))};}
  };
  return c;
}
test('importer transaction model: idempotent, append-only replacement/A-B-A, rollback, blanks and zero', async () => {
  assert.ok(process.env.TMPDIR?.startsWith('/Volumes/SSD Files/SOLAO/cashflow/'));
  const bundle=fixture(), c=repositoryModel(bundle), all=bundle.suppliers;
  const a=csv(all.map((s,i)=>row(s,i===0?'100':'0'))), b=csv(all.map((s,i)=>row(s,i===0?'150':'0')));
  const first=await importApOpening(c,a);assert.equal(first.posted,1);assert.equal(first.missing.length,0);
  const before=c.state;
  assert.equal((await importApOpening(c,a)).reused,true);assert.deepEqual(c.state,before);
  const changed=await importApOpening(c,b);assert.equal(changed.reversed,1);assert.equal(changed.posted,1);
  let r=buildApReport(c.bundle(),{month:'2026-09'});assert.equal(r.ledger[0].closing,'150.00');assert.equal(r.ledger[0].aging.days1_30,'150.00');
  assert.equal(r.journals.length,3);r.journals.forEach(validateJournal);
  assert.deepEqual(c.state.heads[0],before.heads[0]);
  await importApOpening(c,a);assert.equal(c.state.imports.length,3);
  r=buildApReport(c.bundle(),{month:'2026-09'});assert.equal(r.ledger[0].closing,'100.00');assert.equal(r.journals.length,5);
  const intact=c.state;
  await assert.rejects(importApOpening(c,csv([row(all[0],'-1')])),/INVALID_AMOUNT/);assert.deepEqual(c.state,intact);
  c.failLine=true;await assert.rejects(importApOpening(c,b),/INJECTED_INSERT_FAILURE/);assert.deepEqual(c.state,intact);c.failLine=false;
  await importApOpening(c,csv([row(all[0],'0')]));
  r=buildApReport(c.bundle(),{month:'2026-09'});assert.equal(r.controls.missingSuppliers.length,3);assert.equal(r.ledger[0].closing,null);
  await importApOpening(c,csv(all.map(s=>row(s,'0'))));
  r=buildApReport(c.bundle(),{month:'2026-09'});assert.ok(r.controls.openingComplete);assert.ok(r.ledger.every(s=>s.closing==='0.00'));
  assert.ok(r.ledger.every(s=>Object.values(s.aging).every(v=>v==='0.00')));r.journals.forEach(validateJournal);
});

const socket=process.env.AP_OPENING_TEST_SOCKET;
test('offline SSD MySQL: transactional import, replay, replacement, A-B-A, zero, partial, rollback and concurrent serialization', {skip:!socket}, async () => {
  assert.ok(socket.startsWith('/Volumes/SSD Files/SOLAO/cashflow/'));
  const connection=await mysql.createConnection({socketPath:socket,user:'root',dateStrings:true});
  const database=`ap_ledger_preview_opening_test_${Date.now()}`;
  let second;
  try {
    const [[guard]]=await connection.query('SELECT @@skip_networking AS offline, @@datadir AS datadir');
    assert.equal(Number(guard.offline),1);assert.ok(guard.datadir.startsWith('/Volumes/SSD Files/SOLAO/cashflow/'));
    await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.changeUser({database});
    const bundle=fixture();await importAp(connection,bundle);
    const all=bundle.suppliers, a=csv(all.map((s,i)=>row(s,i===0?'100':'0'))), b=csv(all.map((s,i)=>row(s,i===0?'150':'0')));
    const first=await importApOpening(connection,a);assert.equal(first.posted,1);assert.equal(first.missing.length,0);
    assert.equal((await importApOpening(connection,a)).reused,true);
    const replaced=await importApOpening(connection,b);assert.equal(replaced.reversed,1);assert.equal(replaced.posted,1);
    let r=buildApReport(await loadApBundle(connection,'2026-09'),{month:'2026-09'});
    assert.equal(r.ledger[0].opening,'150.00');assert.equal(r.ledger[0].closing,'150.00');assert.equal(r.ledger[0].aging.days1_30,'150.00');
    assert.equal(r.balance.difference,'0.00');assert.equal(r.controls.openingComplete,true);assert.equal(r.journals.length,3);
    assert.equal((await importApOpening(connection,a)).reused,false);
    r=buildApReport(await loadApBundle(connection,'2026-09'),{month:'2026-09'});assert.equal(r.ledger[0].closing,'100.00');assert.equal(r.journals.length,5);
    // Validation failure and an insert failure both roll back all mutations.
    await assert.rejects(importApOpening(connection,csv([row(all[0],'-1')])),/INVALID_AMOUNT/);
    const originalQuery=connection.query.bind(connection);
    connection.query=async (sql,values)=>{if(sql.startsWith('INSERT INTO ap_journal_lines'))throw new Error('INJECTED_INSERT_FAILURE');return originalQuery(sql,values);};
    await assert.rejects(importApOpening(connection,b),/INJECTED/);connection.query=originalQuery;
    const [[count]]=await connection.query('SELECT COUNT(*) AS n FROM ap_opening_imports');assert.equal(count.n,3);
    assert.equal((await importApOpening(connection,a)).reused,true);
    second=await mysql.createConnection({socketPath:socket,user:'root',database,dateStrings:true});
    const parallel=await Promise.all([importApOpening(connection,b),importApOpening(second,b)]);
    assert.equal(parallel.filter(v=>v.reused).length,1);
    const partial=await importApOpening(connection,csv([row(all[0],'0')]));assert.equal(partial.missing.length,3);
    r=buildApReport(await loadApBundle(connection,'2026-09'),{month:'2026-09'});
    assert.equal(r.controls.openingComplete,false);assert.equal(r.controls.missingSuppliers.length,3);assert.equal(r.ledger[0].closing,null);
    const zero=await importApOpening(connection,csv(all.map(s=>row(s,'0'))));assert.equal(zero.posted,0);
    r=buildApReport(await loadApBundle(connection,'2026-09'),{month:'2026-09'});
    assert.ok(r.ledger.every(s=>s.closing==='0.00'));assert.equal(r.controls.openingComplete,true);
    assert.ok(r.ledger.every(s=>Object.values(s.aging).every(v=>v==='0.00')));
    const [[unbalanced]]=await connection.query('SELECT COUNT(*) AS n FROM (SELECT journal_key FROM ap_journal_lines GROUP BY journal_key HAVING SUM(debit)<>SUM(credit)) bad');
    assert.equal(unbalanced.n,0);
  } finally {await second?.end();await connection.end();}
});
