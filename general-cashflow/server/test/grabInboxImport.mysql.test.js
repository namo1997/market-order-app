import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import express from 'express';
import multer from 'multer';
import { createGrabInboxImportHandler } from '../src/grabInboxRoute.js';
import { withGrabInboxImport } from '../src/grabInboxImport.js';

const port = process.env.CASHFLOW_GRAB_FIXTURE_PORT;
test('real MySQL Grab HTTP imports, idempotency, locks and rollback', { skip: !port }, async (t) => {
  const root = process.env.CASHFLOW_GRAB_FIXTURE_ROOT;
  assert.match(root || '', /^\/Volumes\/SSD Files\/SOLAO\/cashflow\/tmp\/grab-gate-[a-f0-9]{8}$/);
  const identity = JSON.parse(await fs.readFile(path.join(root, 'identity.json'), 'utf8'));
  assert.equal(identity.scope, 'new-disposable-instance-for-grab-release-gate');
  assert.equal(Number(port), identity.port);
  assert.equal(identity.datadir, path.join(root, 'data'));
  assert.equal(existsSync(new URL('../.env', import.meta.url)), false);
  const mysql = (await import('mysql2/promise')).default;
  const admin = await mysql.createConnection({ host: '127.0.0.1', port: Number(port), user: 'root', password: '', dateStrings: true });
  const [[serverIdentity]] = await admin.query('SELECT @@datadir AS datadir, @@port AS port, @@server_uuid AS uuid');
  assert.equal(await fs.realpath(serverIdentity.datadir), await fs.realpath(identity.datadir));
  assert.equal(serverIdentity.port, identity.port); assert.equal(serverIdentity.uuid, identity.serverUuid);
  const [present] = await admin.query("SHOW DATABASES LIKE 'cashflow_grab_fixture'");
  assert.equal(present.length, 0, 'fixture schema must not already exist');
  Object.assign(process.env, { CASHFLOW_DB_HOST: '127.0.0.1', CASHFLOW_DB_PORT: port, CASHFLOW_DB_USER: 'root',
    CASHFLOW_DB_PASSWORD: '', CASHFLOW_DB_NAME: 'cashflow_grab_fixture', CASHFLOW_SEED_DEMO_USERS: 'false',
    CASHFLOW_ADMIN_USERNAME: 'synthetic_fixture_admin', CASHFLOW_ADMIN_PASSWORD: 'TEST_ONLY_NOT_A_REAL_CREDENTIAL',
    CASHFLOW_ADMIN_PIN: '', CASHFLOW_CASHIER_PIN: '' });
  const { migrateDatabase, getPool, logAudit, closePool } = await import('../src/db.js');
  let server;
  try {
    await migrateDatabase(); // only the identity-checked NEW disposable instance
    const pool = getPool();
    const uploads = path.join(root, 'uploads'); await fs.mkdir(uploads);
    const app = express(); const upload = multer({ dest: uploads });
    const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
    app.post('/grab', upload.single('file'), wrap(createGrabInboxImportHandler({ getPool, logAudit })));
    app.post('/grab-fail-audit', upload.single('file'), wrap(createGrabInboxImportHandler({ getPool,
      logAudit: async () => { throw new Error('SYNTHETIC_AUDIT_FAILURE'); } })));
    app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ success: false, message: error.message }));
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const originalRoot = process.env.CASHFLOW_GRAB_FIXTURE_DIR;
    assert.ok(originalRoot && originalRoot.startsWith('/Volumes/SSD Files/SOLAO/cashflow/'));
    const kkName = 'THGFIST000009lx-20261023.pdf', skName = '3-C6CELAM2TCAUVX-20261013.pdf';
    const kkPdf = await fs.readFile(path.join(originalRoot, kkName));
    const skPdf = await fs.readFile(path.join(originalRoot, skName));
    const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
    assert.equal(sha(kkPdf), 'ad2e58b71cd5e4d7978d94be7e0f1dadc921d1ec119d1fe9db2d0d57902fbe4e');
    assert.equal(sha(skPdf), '65cc58815166a1fb7d054dddaef0f57f39097d5267a3a07c73a2c037d86fc692');
    const derived = (tag) => Buffer.concat([kkPdf, Buffer.from(`\n% SYNTHETIC TEST DERIVATIVE ${tag}\n`)]);
    const post = async (buffer, name, message, route = '/grab') => {
      const form = new FormData(); form.set('message_id', message); form.set('sender_email', 'no-reply@grab.com');
      form.set('subject', 'SYNTHETIC release gate'); form.set('file', new Blob([buffer], { type: 'application/pdf' }), name);
      const response = await fetch(base + route, { method: 'POST', body: form });
      return { status: response.status, body: await response.json() };
    };
    const scalar = async (sql, params = []) => Number((await pool.query(sql, params))[0][0].n);
    const counts = async () => Object.fromEntries(await Promise.all(['bank_inbox_imports','bank_inbox_transactions','attachments','audit_logs']
      .map(async (table) => [table, await scalar(`SELECT COUNT(*) AS n FROM ${table}`)])));
    const receipt = async (branch, date, cashier) => {
      const [[b]] = await pool.query('SELECT id FROM branches WHERE code = ?', [branch]);
      const [[c]] = await pool.query("SELECT id FROM payment_channels WHERE code = 'GRAB'");
      const [r] = await pool.query("INSERT INTO daily_receipts(receipt_date,branch_id,status,gross_sales_expected) VALUES(?,?,'SUBMITTED',?)", [date,b.id,cashier]);
      const [l] = await pool.query('INSERT INTO daily_receipt_lines(receipt_id,payment_channel_id,expected_amount,cashier_amount,statement_amount) VALUES(?,?,777,?,0)', [r.insertId,c.id,cashier]);
      await pool.query('INSERT INTO receipt_line_reconciliations(receipt_line_id) VALUES(?)', [l.insertId]);
      return { receiptId: r.insertId, lineId: l.insertId, channelId: c.id };
    };
    const kk = await receipt('KK', '2026-10-23', '11696.00');
    const sk = await receipt('SK', '2026-10-13', '10940.00');
    const financialSnapshot = async (entry) => JSON.stringify([
      (await pool.query('SELECT * FROM daily_receipts WHERE id=?', [entry.receiptId]))[0],
      (await pool.query('SELECT * FROM daily_receipt_lines WHERE id=?', [entry.lineId]))[0],
      (await pool.query('SELECT * FROM receipt_line_reconciliations WHERE receipt_line_id=?', [entry.lineId]))[0]
    ]);
    const lockFree = async (checksum) => {
      const [[r]] = await admin.query('SELECT IS_USED_LOCK(?) AS holder', ['grab:' + checksum.slice(0,59)]);
      assert.equal(r.holder, null);
    };
    await t.test('malformed PDF rolls back with no imports, attachments, audit or receipt changes', async () => {
      const before = await counts(), money = await financialSnapshot(kk);
      const result = await post(Buffer.from('%PDF-broken'), kkName, 'malformed');
      assert.equal(result.status, 422); assert.deepEqual(await counts(), before); assert.equal(await financialSnapshot(kk), money);
    });
    await t.test('real KK PDF commits exact cents, original evidence and expected-only settlement', async () => {
      const result = await post(kkPdf, kkName, 'same-message'); assert.equal(result.status, 201); assert.equal(result.body.data.linked, true);
      const [[row]] = await pool.query('SELECT l.*,r.expected_gross_amount,r.expected_net_amount,r.fee_amount,r.settlement_source,r.settlement_status FROM daily_receipt_lines l JOIN receipt_line_reconciliations r ON r.receipt_line_id=l.id WHERE l.id=?', [kk.lineId]);
      assert.equal(row.expected_amount, '11696.00'); assert.equal(row.cashier_amount, '11696.00');
      assert.equal(row.statement_amount, '0.00'); assert.equal(row.expected_net_amount, '8632.84'); assert.equal(row.fee_amount, '3063.16');
      assert.equal(row.settlement_source, 'GRAB_REPORT'); assert.equal(row.settlement_status, 'READY_FOR_STATEMENT');
      const [[imp]] = await pool.query('SELECT source_message_id,archive_checksum,file_data FROM bank_inbox_imports WHERE id=?', [result.body.data.id]);
      assert.match(imp.source_message_id, /^grab:[a-f0-9]{64}$/); assert.equal(imp.archive_checksum, sha(kkPdf)); assert.deepEqual(imp.file_data, kkPdf);
      const [[tx]] = await pool.query('SELECT raw_payload FROM bank_inbox_transactions WHERE inbox_import_id=?', [result.body.data.id]);
      const payload = typeof tx.raw_payload === 'string' ? JSON.parse(tx.raw_payload) : tx.raw_payload;
      assert.equal(payload.source_message_id, 'same-message'); assert.equal(payload.marketing_fee_amount, 770.44);
    });
    await t.test('repeat/forwarded PDF is a no-write duplicate; second attachment in same message commits', async () => {
      const before = await counts(); const duplicate = await post(kkPdf, kkName, 'forwarded-message');
      assert.equal(duplicate.status, 200); assert.equal(duplicate.body.duplicate, true); assert.deepEqual(await counts(), before);
      const second = await post(skPdf, skName, 'same-message'); assert.equal(second.status, 201); assert.equal(second.body.data.storeId, 'ff32e3d6-5cea-4517-b543-4d7db1e528c6');
      assert.equal(await scalar('SELECT COUNT(*) AS n FROM bank_inbox_imports'), before.bank_inbox_imports + 1);
    });
    await t.test('concurrent identical attachments commit once and release native advisory lock', async () => {
      const pdf = derived('concurrency'); const before = await counts();
      const results = await Promise.all([post(pdf, kkName, 'concurrent-one'), post(pdf, kkName, 'concurrent-two')]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200,201]);
      assert.equal((await counts()).bank_inbox_imports, before.bank_inbox_imports + 1); await lockFree(sha(pdf));
    });
    await t.test('audit failure rolls back all actual handler SQL and preserves financial rows', async () => {
      await pool.query('UPDATE daily_receipt_lines SET expected_amount=777 WHERE id=?', [kk.lineId]);
      const before = await counts(), money = await financialSnapshot(kk), pdf = derived('audit-failure');
      const result = await post(pdf, kkName, 'audit-failure', '/grab-fail-audit'); assert.equal(result.status, 500);
      assert.deepEqual(await counts(), before); assert.equal(await financialSnapshot(kk), money); await lockFree(sha(pdf));
    });
    await t.test('native lock contention returns retryable 503 without writes', async () => {
      const pdf = derived('lock-contention'), key = 'grab:' + sha(pdf).slice(0,59), before = await counts();
      const [[r]] = await admin.query('SELECT GET_LOCK(?,0) AS acquired', [key]); assert.equal(r.acquired, 1);
      try { const result = await post(pdf, kkName, 'lock-contention'); assert.equal(result.status, 503); assert.deepEqual(await counts(), before); }
      finally { await admin.query('SELECT RELEASE_LOCK(?)', [key]); }
      await lockFree(sha(pdf));
    });
    await t.test('bank proof and payout date are preserved; Grab pseudo-statement is excluded', async () => {
      const [imp] = await pool.query('INSERT INTO statement_imports(receipt_id,payment_channel_id,original_name,stored_path) VALUES(?,?,?,?)', [kk.receiptId,kk.channelId,'SYNTHETIC bank statement','SYNTHETIC']);
      for (const [amount, source, tag] of [['8632.84','kbank_monthly_grab_statement','bank'], ['500.00','grab_daily_report','pseudo']]) {
        await pool.query("INSERT INTO statement_transactions(import_id,receipt_id,receipt_line_id,payment_channel_id,transaction_date,amount,unique_hash,raw_payload,match_status) VALUES(?,?,?,?,'2026-10-24',?,?,?,'matched_auto')", [imp.insertId,kk.receiptId,kk.lineId,kk.channelId,amount,sha(Buffer.from(tag)),JSON.stringify({source})]);
      }
      await pool.query("UPDATE receipt_line_reconciliations SET settlement_date='2026-10-24' WHERE receipt_line_id=?", [kk.lineId]);
      const result = await post(derived('bank-proof'), kkName, 'bank-proof'); assert.equal(result.status, 201);
      const [[row]] = await pool.query('SELECT l.statement_amount,r.matched_amount,r.settlement_date,r.settlement_source,r.settlement_status FROM daily_receipt_lines l JOIN receipt_line_reconciliations r ON r.receipt_line_id=l.id WHERE l.id=?', [kk.lineId]);
      assert.equal(row.statement_amount, '8632.84'); assert.equal(row.matched_amount, '8632.84'); assert.equal(row.settlement_date, '2026-10-24');
      assert.equal(row.settlement_source, 'BANK_STATEMENT'); assert.equal(row.settlement_status, 'MATCHED_AUTO');
    });
    await t.test('CLOSED receipt and snapshot stay immutable; incoming evidence remains pending', async () => {
      await pool.query("UPDATE daily_receipts SET status='CLOSED',closed_reconciliation_snapshot=? WHERE id=?", [JSON.stringify({synthetic:'closed snapshot'}),sk.receiptId]);
      const before = await financialSnapshot(sk), pdf = Buffer.concat([skPdf,Buffer.from('\n% SYNTHETIC closed fixture\n')]);
      const result = await post(pdf, skName, 'closed-evidence'); assert.equal(result.status, 201); assert.equal(result.body.data.linked, false);
      assert.equal(await financialSnapshot(sk), before);
      const [[row]] = await pool.query('SELECT status FROM bank_inbox_imports WHERE id=?', [result.body.data.id]); assert.equal(row.status, 'PENDING_REVIEW');
    });
    await t.test('legacy raw-message identity and FAILED rows remain unchanged', async () => {
      for (const [tag,status] of [['legacy','AUTO_LINKED'],['failed','FAILED']]) {
        const pdf=derived(tag), before = await counts();
        await pool.query("INSERT INTO bank_inbox_imports(provider,source_message_id,original_name,stored_path,archive_checksum,status) VALUES('GRAB_DAILY',?,?,?,?,?)", [tag,kkName,'SYNTHETIC',sha(pdf),status]);
        const result=await post(pdf,kkName,'new-'+tag); assert.equal(result.status,status==='FAILED'?409:200);
        assert.equal((await counts()).bank_inbox_imports,before.bank_inbox_imports+1);
        const [[row]]=await pool.query('SELECT source_message_id,status FROM bank_inbox_imports WHERE archive_checksum=?',[sha(pdf)]);
        assert.equal(row.source_message_id,tag); assert.equal(row.status,status); await lockFree(sha(pdf));
      }
    });
    await t.test('killed fixture connection releases lock and recovers the same key without duplicate or CLOSED changes', async () => {
      const checksum=sha(Buffer.from('synthetic-disconnect'));
      const before=await counts(), closedBefore=await financialSnapshot(sk);
      let killedId, rejection;
      try {
        await withGrabInboxImport({pool,messageId:'disconnect',checksum},async(connection,id)=>{
          await connection.query("INSERT INTO bank_inbox_imports(provider,source_message_id,original_name,stored_path,archive_checksum) VALUES('GRAB_DAILY',?,?,?,?)",[id,'SYNTHETIC','SYNTHETIC',checksum]);
          const [[own]]=await connection.query('SELECT CONNECTION_ID() AS id'); killedId=own.id;
          await admin.query('KILL CONNECTION ?', [killedId]); return {id};
        });
      } catch(error) { rejection=error; }
      assert.ok(rejection, 'commit on killed connection must fail');
      const started=Date.now(), observations=[];
      // KILL acknowledges the request before all thread cleanup necessarily
      // completes. Observe bounded server-side release; never manually release it.
      do {
        const [[lock]]=await admin.query('SELECT IS_USED_LOCK(?) AS holder',['grab:'+checksum.slice(0,59)]);
        const [threads]=await admin.query('SELECT ID,COMMAND FROM information_schema.PROCESSLIST WHERE ID=?',[killedId]);
        observations.push({elapsedMs:Date.now()-started,holder:lock.holder,threadPresent:threads.length>0,command:threads[0]?.COMMAND||null});
        if(lock.holder===null)break;
        await new Promise(resolve=>setTimeout(resolve,20));
      } while(Date.now()-started<2000);
      await fs.writeFile(path.join(root,'disconnect-lock-observation.json'),JSON.stringify({boundMs:2000,killedId,
        rejectionCode:rejection.code||null,observations},null,2),{flag:'wx',mode:0o600});
      assert.equal(observations.at(-1).holder,null,'killed connection retained its lock beyond 2 seconds');
      assert.equal(observations.at(-1).threadPresent,false,'killed session still present after lock cleanup');
      assert.equal(await scalar('SELECT COUNT(*) AS n FROM bank_inbox_imports WHERE archive_checksum=?',[checksum]),0);
      assert.deepEqual(await counts(),before,'uncommitted imports or audit must not survive disconnect');
      const recover=()=>withGrabInboxImport({pool,messageId:'disconnect',checksum},async(connection,id)=>{
        const [row]=await connection.query("INSERT INTO bank_inbox_imports(provider,source_message_id,original_name,stored_path,archive_checksum) VALUES('GRAB_DAILY',?,?,?,?)",[id,'SYNTHETIC','SYNTHETIC',checksum]);
        return {id:row.insertId};
      });
      const recovered=await recover();assert.equal(recovered.duplicate,false);await lockFree(checksum);
      const repeated=await recover();assert.equal(repeated.duplicate,true);assert.equal(repeated.data.id,recovered.data.id);
      assert.equal(await scalar('SELECT COUNT(*) AS n FROM bank_inbox_imports WHERE archive_checksum=?',[checksum]),1);
      assert.equal(await financialSnapshot(sk),closedBefore,'recovery must not alter CLOSED data');
      assert.equal((await counts()).audit_logs,before.audit_logs);
    });

  } finally {
    if(server) await new Promise((resolve)=>server.close(resolve));
    await closePool(); await admin.end();
  }
});
