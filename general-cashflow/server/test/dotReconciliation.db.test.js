import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { loadDotData, buildDotReport, parseDotQuery } from '../src/dotReconciliation.js';

// Opt-in disposable loopback fixture only. Never consume app or production DB env.
const port = process.env.CASHFLOW_DOT_FIXTURE_PORT;
test('real MySQL release-schema reconciliation fixture', { skip: !port }, async t => {
  assert.match(port, /^\d{4,5}$/);
  assert.ok(Number(port) > 1024 && Number(port) < 65536);
  assert.equal(existsSync(new URL('../.env', import.meta.url)), false);
  Object.assign(process.env, {
    CASHFLOW_DB_HOST: '127.0.0.1', CASHFLOW_DB_PORT: port,
    CASHFLOW_DB_USER: 'root', CASHFLOW_DB_PASSWORD: '',
    CASHFLOW_DB_NAME: 'cashflow_dot_fixture', CASHFLOW_SEED_DEMO_USERS: 'false',
    CASHFLOW_ADMIN_USERNAME: 'synthetic_fixture_admin',
    CASHFLOW_ADMIN_PASSWORD: 'TEST_ONLY_NOT_A_REAL_CREDENTIAL',
    CASHFLOW_ADMIN_PIN: '', CASHFLOW_CASHIER_PIN: ''
  });
  const mysql = (await import('mysql2/promise')).default;
  const bootstrap = await mysql.createConnection({host:'127.0.0.1',port:Number(port),user:'root',password:''});
  try { await bootstrap.query('DROP DATABASE IF EXISTS cashflow_dot_fixture'); } finally { await bootstrap.end(); }
  const { migrateDatabase, getPool, closePool } = await import('../src/db.js');
  await migrateDatabase();
  const pool = getPool();
  try {
    const [[{ id: kk }]] = await pool.query("SELECT id FROM branches WHERE code='KK'");
    const [[{ id: sk }]] = await pool.query("SELECT id FROM branches WHERE code='SK'");
    const [[{ id: cash }]] = await pool.query("SELECT id FROM payment_channels WHERE code='CASH'");
    const [[{ id: delivery }]] = await pool.query("SELECT id FROM payment_channels WHERE code='GRAB'");
    const [foreign] = await pool.query("INSERT INTO branches(code,name) VALUES('OUTSIDE_FIXTURE','Synthetic outside scope')");
    const receipt = async (day, branch, status='SUBMITTED') => (await pool.query(
      'INSERT INTO daily_receipts(receipt_date,branch_id,status,gross_sales_expected,morning_change_amount,clickhouse_synced_at) VALUES(?,?,?,1000,200,?)',
      [day,branch,status,`${day} 22:00:00`]))[0].insertId;
    const line = async (id, channel, expected, cashier, actual) => (await pool.query(
      'INSERT INTO daily_receipt_lines(receipt_id,payment_channel_id,expected_amount,cashier_amount,statement_amount) VALUES(?,?,?,?,?)',
      [id,channel,expected,cashier,actual]))[0].insertId;
    const historyIds=[];
    for(let i=0;i<55;i++) {
      const day=new Date(Date.UTC(2026,6,1+i)).toISOString().slice(0,10);
      const id=await receipt(day,kk); historyIds.push(id);
      const l=await line(id,cash,'1000.00',i===0?'1300.00':i===1?'1300.01':'1200.00','1200.00');
      await pool.query('INSERT INTO receipt_line_reconciliations(receipt_line_id,manual_checked_without_reference) VALUES(?,1)',[l]);
    }
    const foreignReceipt=await receipt('2026-10-01',foreign.insertId);
    const target=await receipt('2026-10-01',kk);
    const draft=await receipt('2026-10-01',sk,'DRAFT');
    const c=await line(target,cash,'400.00','600.00','600.00');
    await pool.query('INSERT INTO receipt_line_reconciliations(receipt_line_id,manual_checked_without_reference) VALUES(?,1)',[c]);
    const d=await line(target,delivery,'600.00','600.00','480.00');
    await pool.query("INSERT INTO receipt_line_reconciliations(receipt_line_id,expected_gross_amount,expected_net_amount,fee_amount,settlement_source,settlement_status,settlement_date) VALUES(?,600,480,120,'BANK_STATEMENT','MATCHED_AUTO','2026-10-02')",[d]);
    const [imp]=await pool.query('INSERT INTO statement_imports(receipt_id,payment_channel_id,original_name,stored_path) VALUES(?,?,?,?)',[target,delivery,'SYNTHETIC statement','SYNTHETIC']);
    await pool.query("INSERT INTO statement_transactions(import_id,receipt_id,receipt_line_id,payment_channel_id,transaction_date,amount,unique_hash,raw_payload,match_status) VALUES(?,?,?,?,'2026-10-02',480,?,?,'matched_auto')",[imp.insertId,target,d,delivery,'f'.repeat(64),JSON.stringify({source:'kbank_monthly_grab_statement'})]);
    const fingerprint = async () => JSON.stringify((await pool.query('SELECT id,status,updated_at FROM daily_receipts ORDER BY id'))[0]);
    const before=await fingerprint();
    const now=new Date('2026-10-02T03:00:00Z');const q=parseDotQuery({},now);
    const first=buildDotReport(await loadDotData(pool,q,['KK','SK']),q,now);
    await t.test('schema SQL yields exact decimals, dates and strict historical boundary',()=>{
      const r=first.rows.find(r=>r.receipt_id===target);
      assert.equal(r.actual_reconciled_variance,'0.00');
      assert.equal(r.lines.find(l=>l.line_id===d).actual_amount,'480.00');
      assert.deepEqual(r.lines.find(l=>l.line_id===d).bank_received_dates,['2026-10-02']);
      assert.ok(first.rows.some(r=>r.receipt_id===historyIds[1]));
      assert.ok(!first.rows.some(r=>r.receipt_id===historyIds[0]));
      assert.equal(first.rows.find(r=>r.receipt_id===draft).cashier_total,null);
      assert.ok(first.rows.every(r=>['KK','SK'].includes(r.branch_code)));
    });
    await t.test('real pagination scans all candidates and pins the completed day',async()=>{
      assert.ok(first.pagination.next_cursor);
      let cursor=first.pagination.next_cursor, pages=1;
      while(cursor!==null){const query=parseDotQuery({day:first.day,cursor},now);const next=buildDotReport(await loadDotData(pool,query,['KK','SK']),query,now);cursor=next.pagination.next_cursor;assert.ok(++pages<=3);}
      assert.equal(pages,2);
    });
    await t.test('cross-branch batch membership blocks proof without reading outside amounts',async()=>{
      const foreignLine=await line(foreignReceipt,delivery,'9999.00','9999.00','9999.00');
      await pool.query("INSERT INTO receipt_line_reconciliations(receipt_line_id,settlement_batch_key,settlement_batch_allocated_net_amount) VALUES(?,'synthetic-cross-branch',9999)",[foreignLine]);
      await pool.query("UPDATE receipt_line_reconciliations SET settlement_batch_key='synthetic-cross-branch',settlement_batch_allocated_net_amount=480 WHERE receipt_line_id=?",[d]);
      const loaded=await loadDotData(pool,q,['KK','SK']);
      assert.ok(!loaded.receipts.some(r=>r.id===foreignReceipt));assert.ok(!loaded.lines.some(l=>l.id===foreignLine));
      const r=buildDotReport(loaded,q,now).rows.find(r=>r.receipt_id===target);
      assert.equal(r.lines.find(l=>l.line_id===d).actual_amount,null);assert.ok(r.issues.includes('SETTLEMENT_BATCH_OUTSIDE_APPROVED_BRANCHES'));
    });
    await t.test('database rejects writes inside read-only transaction and reads leave statuses unchanged',async()=>{
      const conn=await pool.getConnection();
      try{await conn.query('START TRANSACTION READ ONLY');await assert.rejects(conn.query('UPDATE daily_receipts SET status=\'CLOSED\' WHERE id=?',[target]),e=>e.code==='ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION');await conn.rollback();}finally{conn.release();}
      assert.equal(await fingerprint(),before);
    });
  } finally { await closePool(); }
});
