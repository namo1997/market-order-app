import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { authenticate, requirePermission, signToken } from '../src/auth.js';
import { createPnlRouter } from '../src/pnl/routes.js';
import { recurringActive, validateRecurringStart, recurringWarnings } from '../src/pnl/recurring.js';
import { buildReport, loadReportData } from '../src/pnl/report.js';
import { cents } from '../src/pnl/domain.js';
import { migratePnl } from '../src/pnl/schema.js';

const initial = { id: 1, series_id: 1, branch_id: 1, category_code: 'RENT', description: 'ค่าเช่า', amount: '300.01', start_month: '2026-08-01', end_month: null, note: null };
const fixture = () => {
  let state = { rows: [structuredClone(initial)], skips: [] }; let backup; let nextId = 2;
  const audits = [], calls = [];
  const connection = { release() {}, async beginTransaction() { backup = structuredClone(state); }, async commit() { backup = null; }, async rollback() { state = backup; },
    async query(sql, args = []) {
      calls.push([sql, args]);
      if (sql.startsWith('SELECT code')) return [[{ code: args[0] }]];
      if (sql.startsWith('SELECT id FROM branches')) return [[{ id: args[0] }]];
      if (sql.startsWith('SELECT * FROM pnl_recurring_expenses WHERE id=')) return [structuredClone(state.rows.filter((row) => row.id === Number(args[0])))];
      if (sql.startsWith('SELECT * FROM pnl_recurring_expenses WHERE series_id=')) return [structuredClone(state.rows.filter((row) => row.series_id === Number(args[0])).sort((a,b) => a.start_month.localeCompare(b.start_month)))];
      if (sql.startsWith('SELECT e.*')) return [state.rows.filter((row) => recurringActive(row, args[0].slice(0,7))).map((row) => {
        const skip = state.skips.find((s) => s.recurring_id === row.id && s.month_start === args[0]);
        return { ...row, skip_reason: skip?.reason ?? null, skipped_month: skip?.month_start ?? null };
      })];
      if (sql.startsWith('SELECT s.*')) return [structuredClone(state.skips.filter((skip) => state.rows.some((row) => row.id === skip.recurring_id && row.series_id === Number(args[0]))))];
      if (sql.startsWith('SELECT * FROM pnl_recurring_skips')) return [structuredClone(state.skips.filter((row) => row.recurring_id === Number(args[0]) && (sql.includes('>=') ? row.month_start >= args[1] : row.month_start === args[1])))];
      if (sql.startsWith('INSERT INTO pnl_recurring_expenses')) {
        const row = Object.fromEntries(['series_id','branch_id','category_code','description','amount','start_month','end_month','note','created_by'].map((key, i) => [key, args[i]]));
        row.id = nextId++; state.rows.push(row); return [{ insertId: row.id }];
      }
      if (sql.startsWith('UPDATE pnl_recurring_expenses SET series_id')) { state.rows.find((row) => row.id === args[1]).series_id = args[0]; return [{}]; }
      if (sql.startsWith('UPDATE pnl_recurring_expenses SET end_month')) { state.rows.find((row) => row.id === Number(args[2])).end_month = args[0]; return [{}]; }
      if (sql.startsWith('UPDATE pnl_recurring_expenses SET branch_id')) { Object.assign(state.rows.find((row) => row.id === Number(args[6])), Object.fromEntries(['branch_id','category_code','description','amount','note'].map((key, i) => [key, args[i]]))); return [{}]; }
      if (sql.startsWith('INSERT INTO pnl_recurring_skips')) {
        let row = state.skips.find((row) => row.recurring_id === args[0] && row.month_start === args[1]);
        if (!row) { row = { recurring_id: args[0], month_start: args[1] }; state.skips.push(row); }
        Object.assign(row, { reason: args[2], created_by: args[3] }); return [{}];
      }
      if (sql.startsWith('UPDATE pnl_recurring_skips')) { state.skips.filter((row) => row.recurring_id === args[1] && row.month_start >= args[2]).forEach((row) => row.recurring_id = args[0]); return [{}]; }
      if (sql.startsWith('DELETE FROM pnl_recurring_skips')) { state.skips = state.skips.filter((row) => row.recurring_id !== args[0] || row.month_start !== args[1]); return [{}]; }
      throw new Error(`Unexpected SQL ${sql}`);
    }
  };
  return { connection, pool: { query: connection.query.bind(connection), getConnection: async () => connection }, audits, calls, get state() { return state; } };
};
const start = async (options = {}) => {
  const db = fixture(), app = express(); app.use(express.json());
  app.use('/api/pnl', createPnlRouter({ getPool: () => db.pool, config: {}, authenticate, requirePermission, logAudit: async (args) => {
    assert.equal(args.connection, db.connection); assert.equal(typeof args.entityId, 'number'); assert.ok(Number.isSafeInteger(args.entityId)); db.audits.push(args);
  }, ...options }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { db, call: async (method, path, body, role = 'admin') => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/pnl${path}`, { method, headers: { Authorization: `Bearer ${signToken({ id: 1, role })}`, 'Content-Type': 'application/json' }, ...(body && method !== 'GET' ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, ...(await res.json()) };
  }, close: () => new Promise((resolve) => server.close(resolve)) };
};
const payload = { branch_id: 1, category_code: 'RENT', description: 'ค่าเช่าใหม่', amount: '600.01', note: 'ทดสอบ' };

test('active inclusive months and Bangkok create bounds ±12 months', () => {
  assert.equal(recurringActive(initial, '2026-07'), false); assert.equal(recurringActive(initial, '2026-08'), true);
  assert.equal(recurringActive({ ...initial, end_month: '2026-09-01' }, '2026-09'), true);
  assert.equal(recurringActive({ ...initial, end_month: '2026-09-01' }, '2026-10'), false);
  const now = new Date('2026-09-30T17:30:00Z');
  for (const month of ['2025-10', '2027-10']) assert.equal(validateRecurringStart(month, now), `${month}-01`);
  for (const month of ['2025-09', '2027-11']) assert.throws(() => validateRecurringStart(month, now), { code: 'RECURRING_START_OUT_OF_RANGE' });
});
test('recurring version split preserves prior month, transfers future exemptions, keeps history, in-place edit at start', async () => {
  const h = await start(); try {
    assert.equal((await h.call('PUT', '/recurring/1/skips/2026-10', { reason: 'ยกเว้นค่าเช่า' })).status, 200);
    const split = await h.call('PUT', '/recurring/1', { ...payload, effective_month: '2026-09' }); assert.equal(split.status, 200);
    const id = split.data.id; assert.equal(split.data.series_id, 1);
    assert.equal(h.db.state.rows[0].end_month, '2026-08-01'); assert.equal(h.db.state.rows[0].amount, '300.01');
    assert.equal(h.db.state.skips[0].recurring_id, id);
    assert.equal(buildReport({ month: '2026-08', categories: [{ code: 'RENT' }], recurring: h.db.state.rows }).recurring.total, 300.01);
    assert.equal(buildReport({ month: '2026-09', categories: [{ code: 'RENT' }], recurring: h.db.state.rows }).recurring.total, 600.01);
    const history = await h.call('GET', '/recurring/series/1'); assert.equal(history.data.length, 2); assert.equal(history.data[1].skips[0].reason, 'ยกเว้นค่าเช่า');
    const same = await h.call('PUT', `/recurring/${id}`, { ...payload, effective_month: '2026-09', amount: '700' });
    assert.equal(same.data.id, id); assert.equal(h.db.state.rows.length, 2); assert.equal(h.db.state.rows[1].amount, '700.00');
    assert.equal(h.db.audits.at(-1).action, 'pnl.recurring.update');
    const skipped = await h.call('GET', '/recurring?month=2026-10'); assert.equal(skipped.data[0].skipped, true);
    await h.call('DELETE', `/recurring/${id}/skips/2026-10`); assert.equal((await h.call('GET', '/recurring?month=2026-10')).data[0].skipped, false);
    assert.ok(!h.db.calls.some(([sql]) => sql.startsWith('DELETE FROM pnl_recurring_expenses')));
  } finally { await h.close(); }
});
test('stop excludes later months, split inherits original end; invalid effective/stop rolls back without audits', async () => {
  const h = await start(); try {
    assert.equal((await h.call('POST', '/recurring/1/stop', { last_month: '2026-10' })).status, 200);
    assert.equal((await h.call('GET', '/recurring?month=2026-11')).data.length, 0);
    for (const month of ['2026-07', '2026-11']) {
      const before = structuredClone(h.db.state), audits = h.db.audits.length;
      assert.equal((await h.call('PUT', '/recurring/1', { ...payload, effective_month: month })).status, 422);
      assert.equal((await h.call('POST', '/recurring/1/stop', { last_month: month })).status, 422);
      assert.deepEqual(h.db.state, before); assert.equal(h.db.audits.length, audits);
    }
    const split = await h.call('PUT', '/recurring/1', { ...payload, effective_month: '2026-09' });
    assert.equal(split.data.end_month, '2026-10-01');
    assert.equal((await h.call('PUT', '/recurring/1/skips/2026-09', { reason: 'wrong version' })).status, 422);
    assert.equal((await h.call('PUT', `/recurring/${split.data.id}/skips/2026-09`, { reason: ' ' })).status, 422);
    assert.equal((await h.call('PUT', '/recurring/1', payload)).status, 422);
  } finally { await h.close(); }
});
test('create series identity and STAFF guard; all recurring routes deny other roles before DB', async () => {
  const h = await start(); try {
    const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).slice(0,7);
    const created = await h.call('POST', '/recurring', { ...payload, start_month: month });
    assert.equal(created.status, 200); assert.equal(created.data.series_id, created.data.id); assert.equal(h.db.audits.at(-1).action, 'pnl.recurring.create');
    for (const [method, path, body] of [['POST','/recurring',{ ...payload,start_month:month,category_code:'STAFF' }], ['PUT','/recurring/1',{ ...payload,effective_month:'2026-09',category_code:'STAFF' }]]) {
      const res = await h.call(method,path,body); assert.equal(res.status,422); assert.equal(res.code,'STAFF_FROM_HRMS');
    }
    for (const role of ['cashier','auditor','recorder']) for (const [method,path] of [['GET','/recurring?month=2026-09'],['GET','/recurring/series/1'],['POST','/recurring'],['PUT','/recurring/1'],['POST','/recurring/1/stop'],['PUT','/recurring/1/skips/2026-09'],['DELETE','/recurring/1/skips/2026-09']]) {
      const count = h.db.calls.length; assert.equal((await h.call(method,path,{},role)).status,403); assert.equal(h.db.calls.length,count);
    }
  } finally { await h.close(); }
});
test('recurring decisions use existing guard; audit failure rolls back atomic version and skip changes', async () => {
  const guarded = await start({ decisionReasonRequired: true, requireHumanDecision: () => (req,res) => res.status(422).json({code:'decision_reason_required'}) });
  try { for (const [method,path] of [['POST','/recurring'],['PUT','/recurring/1'],['POST','/recurring/1/stop'],['PUT','/recurring/1/skips/2026-09'],['DELETE','/recurring/1/skips/2026-09']]) assert.equal((await guarded.call(method,path,{})).code,'decision_reason_required'); assert.equal(guarded.db.calls.length,0); } finally { await guarded.close(); }
  const h = await start({ logAudit: async () => { throw new Error('fixture failure'); } });
  try { const before = structuredClone(h.db.state); assert.equal((await h.call('PUT','/recurring/1',{...payload,effective_month:'2026-09'})).status,500); assert.deepEqual(h.db.state,before); } finally { await h.close(); }
});
test('duplicate warning ≤5%, exact cents boundary, only counted LINE/category/same branch; skip suppresses', () => {
  const rows = [{ ...initial, amount: '100' }, { ...initial, id: 2, branch_id: null, amount: '100' }];
  const items = [95,105,94.99,105.01].map((amount, i) => ({ stable_key: String(i), amount, branch_id: 1, category_code: 'RENT' }));
  items.push({ stable_key:'other-branch', amount:100, branch_id:2, category_code:'RENT' }, {stable_key:'excluded',amount:100,branch_id:1,category_code:'RENT',excluded:true}, {stable_key:'category',amount:100,branch_id:1,category_code:'OTHER'}, {stable_key:'central',amount:100,branch_id:null,category_code:'RENT'});
  assert.deepEqual(recurringWarnings(rows,items).map((row) => row.stable_key), ['0','1','central']);
  assert.equal(recurringWarnings(rows.map((row) => ({...row,skipped:true})),items).length,0);
});
test('report active/ended/skipped, matched proration and COGS/opex/category/branch invariants', () => {
  const recurring = [{...initial},{...initial,id:2,branch_id:null,amount:'100.01',category_code:'COGS_FOOD'}, {...initial,id:3,branch_id:2,amount:'90.01'}, {...initial,id:4,skipped_month:'2026-09-01',skip_reason:'ยกเว้น'}, {...initial,id:5,end_month:'2026-08-01'}, {...initial,id:6,start_month:'2026-10-01'}];
  const data = { month:'2026-09', now:new Date('2026-10-01T00:00:00Z'), branches:[{id:1},{id:2}], categories:[{code:'RENT',is_cogs:0},{code:'COGS_FOOD',is_cogs:1}], recurring,
    receipts:[{branch_id:1,receipt_date:'2026-09-01',status:'CLOSED',gross_sales_expected:1000},{branch_id:1,receipt_date:'2026-09-02',status:'CLOSED',gross_sales_expected:1000},{branch_id:2,receipt_date:'2026-09-02',status:'CLOSED',gross_sales_expected:1000}],
    rounds:[{id:1,branch_id:1,business_date:'2026-09-01',status:'closed'},{id:2,branch_id:1,business_date:'2026-09-02',status:'closed'},{id:3,branch_id:2,business_date:'2026-09-02',status:'closed'}],
    items:[{stable_key:'line',round_id:1,branch_id:1,business_date:'2026-09-01',amount:300.01}], overrides:[{stable_key:'line',category_code:'RENT'}] };
  const report = buildReport(data); assert.equal(report.recurring.total,490.03); assert.equal(report.recurring.items.length,4); assert.equal(report.recurring.skipped.length,1); assert.equal(report.manual_total,0); assert.equal(report.manual_expenses.length,0);
  assert.equal(report.recurring.duplicate_warnings[0].stable_key,'line'); assert.equal(report.totals.opex,690.03); assert.equal(report.totals.cogs,100.01);
  assert.equal(report.totals_matched.cogs,3.33); assert.equal(report.totals_matched.opex,323.01);
  for (const mode of ['month','matched']) {
    const totals = mode === 'month' ? report.totals : report.totals_matched;
    const rows = report.category_rows.map((row) => mode === 'month' ? row : row.matched);
    assert.equal(rows.reduce((sum,row) => sum+cents(row.amount),0),cents(totals.cogs)+cents(totals.opex));
    for (const row of rows) assert.equal(Object.values(row.branches).reduce((sum,value) => sum+cents(value),0),cents(row.amount));
    for (const field of ['revenue','cogs','opex','net_profit']) assert.equal(report.branch_columns.reduce((sum,row) => sum+cents((mode==='month'?row:row.matched)[field]),0),cents(totals[field]));
  }
  const filtered=buildReport({...data,branchId:1}); assert.equal(filtered.recurring.total,300.01); assert.equal(filtered.recurring.items.length,2);
});
test('additive idempotent MySQL 8 DDL and report reads recurring/skips inside transaction', async () => {
  const calls=[]; const connection={async query(sql,args){calls.push([sql,args]);return sql.includes('information_schema.COLUMNS')?[[{cnt:1}]]:[[]];},async beginTransaction(){calls.push(['BEGIN']);},async commit(){calls.push(['COMMIT']);},async rollback(){calls.push(['ROLLBACK']);}};
  await migratePnl(connection); await migratePnl(connection);
  const ddl=calls.filter(([sql])=>sql.startsWith('CREATE TABLE IF NOT EXISTS pnl_recurring'));
  assert.equal(ddl.length,4); assert.ok(ddl[0][0].includes('DECIMAL(14,2)')); assert.ok(ddl[1][0].includes('PRIMARY KEY (recurring_id, month_start)')); assert.ok(!ddl.some(([sql])=>sql.includes('CASCADE')));
  calls.length=0;await loadReportData(connection,'2026-09');assert.equal(calls[0][0],'BEGIN');assert.equal(calls.at(-1)[0],'COMMIT');
  const [sql,args]=calls.find(([sql])=>sql.startsWith('SELECT e.*'));assert.ok(sql.includes('LEFT JOIN pnl_recurring_skips'));assert.deepEqual(args,['2026-09-01','2026-09-01','2026-09-01']);
});

test('report API returns duplicate LINE links without raw payload or automatic exclusion', async () => {
  const queries=[];
  const connection={release(){},async beginTransaction(){},async commit(){},async rollback(){},async query(sql,args){
    queries.push(sql);
    if(sql.startsWith('SELECT id, code, name'))return [[{id:1,code:'SK',name:'สาขา'}]];
    if(sql.startsWith('SELECT * FROM pnl_categories'))return [[{code:'RENT',is_cogs:0}]];
    if(sql.startsWith('SELECT r.* FROM pnl_expense_rounds'))return [[{id:1,status:'closed',source_id:'fixture-group',branch_id:1,business_date:'2026-09-01'}]];
    if(sql.startsWith('SELECT i.*'))return [[{id:1,stable_key:'line:1',round_id:1,branch_id:1,business_date:'2026-09-01',amount:'300.01',raw_json:'private fixture'}]];
    if(sql.startsWith('SELECT o.*'))return [[{stable_key:'line:1',category_code:'RENT'}]];
    if(sql.startsWith('SELECT e.*'))return [[initial]];
    return [[]];
  }};
  const h=await start({getPool:()=>({getConnection:async()=>connection}),config:{baseUrl:'https://example.invalid',token:'fixture'},fetchSalesRange:async()=>[],logAudit:async()=>{throw new Error('Read must not audit');}});
  try {
    const res=await h.call('GET','/report?month=2026-09');assert.equal(res.status,200);
    assert.equal(res.data.recurring.duplicate_warnings.length,1);
    assert.equal(res.data.recurring.duplicate_warnings[0].source_url,'https://example.invalid/admin?view=day&date=2026-09-01&group=fixture-group');
    assert.equal(res.data.totals.opex,600.02);assert.equal(res.data.items[0].excluded,false);assert.ok(!JSON.stringify(res.data).includes('private fixture'));assert.ok(queries.every(sql=>sql.startsWith('SELECT')));
  } finally {await h.close();}
});
