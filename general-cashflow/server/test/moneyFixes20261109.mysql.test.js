import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Native MySQL gate for the 9 Nov 2026 money fixes. Runs only against a NEW
// disposable instance on the verified SSD whose identity file matches the server.
const port = process.env.CASHFLOW_MONEY_FIXTURE_PORT;
const database = 'cashflow_money_fixture';
const serverSource = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

const sqlTemplateContaining = (needle) => {
  const at = serverSource.indexOf(needle);
  assert.ok(at > 0, `server.js must contain ${needle}`);
  const start = serverSource.lastIndexOf('`', at);
  const end = serverSource.indexOf('`', at);
  return serverSource.slice(start + 1, end);
};

const cardNoteSql = () => {
  const auto = serverSource.match(/const AUTO_CARD_NOTE_SQL = ("[^"]+");/)[1];
  const body = serverSource.match(/const CARD_SETTLEMENT_EXCEPTION_SQL = (`[\s\S]+?`);/)[1];
  return new Function(`const AUTO_CARD_NOTE_SQL = ${auto}; return ${body};`)();
};

test('native MySQL: money-fix SQL and startup replays keep closed and reviewed data', { skip: !port }, async (t) => {
  const root = process.env.CASHFLOW_MONEY_FIXTURE_ROOT;
  assert.match(root || '', /^\/Volumes\/SSD Files\/SOLAO\/cashflow\/tmp\/money-gate-[a-f0-9]{8}$/);
  const identity = JSON.parse(await fs.readFile(path.join(root, 'identity.json'), 'utf8'));
  assert.equal(identity.scope, 'new-disposable-instance-for-money-fixes-20261109');
  assert.equal(Number(port), identity.port);
  assert.equal(existsSync(new URL('../.env', import.meta.url)), false);
  const mysql = (await import('mysql2/promise')).default;
  const admin = await mysql.createConnection({ host: '127.0.0.1', port: Number(port), user: 'root', password: '', dateStrings: true });
  const [[serverIdentity]] = await admin.query('SELECT @@datadir AS datadir, @@port AS port, @@server_uuid AS uuid');
  assert.equal(await fs.realpath(serverIdentity.datadir), await fs.realpath(identity.datadir));
  assert.equal(serverIdentity.uuid, identity.serverUuid);
  const [present] = await admin.query(`SHOW DATABASES LIKE '${database}'`);
  assert.equal(present.length, 0, 'fixture schema must not already exist');

  const env = {
    CASHFLOW_DB_HOST: '127.0.0.1', CASHFLOW_DB_PORT: port, CASHFLOW_DB_USER: 'root', CASHFLOW_DB_PASSWORD: '',
    CASHFLOW_DB_NAME: database, CASHFLOW_SEED_DEMO_USERS: 'false', CASHFLOW_ADMIN_USERNAME: 'synthetic_fixture_admin',
    CASHFLOW_ADMIN_PASSWORD: 'TEST_ONLY_NOT_A_REAL_CREDENTIAL', CASHFLOW_ADMIN_PIN: '', CASHFLOW_CASHIER_PIN: ''
  };
  Object.assign(process.env, env);
  const { migrateDatabase, getPool, closePool } = await import('../src/db.js');
  try {
    await migrateDatabase();
    const pool = getPool();
    const id = async (sql, params) => (await pool.query(sql, params))[0][0].id;
    const kk = await id("SELECT id FROM branches WHERE code = 'KK'");
    const ktc = await id("SELECT id FROM payment_channels WHERE code = 'CREDIT_CARD_KTC'");
    const qr = await id("SELECT id FROM payment_channels WHERE code = 'QR_KPLUS'");
    const line = async (date, status, channel, cashier, statement) => {
      const [r] = await pool.query('INSERT INTO daily_receipts(receipt_date, branch_id, status) VALUES (?, ?, ?)', [date, kk, status]);
      const [l] = await pool.query(
        'INSERT INTO daily_receipt_lines(receipt_id, payment_channel_id, cashier_amount, statement_amount) VALUES (?, ?, ?, ?)',
        [r.insertId, channel, cashier, statement]);
      await pool.query('INSERT INTO receipt_line_reconciliations(receipt_line_id) VALUES (?)', [l.insertId]);
      return { receiptId: r.insertId, lineId: l.insertId };
    };
    const rlr = async (lineId) => (await pool.query('SELECT * FROM receipt_line_reconciliations WHERE receipt_line_id = ?', [lineId]))[0][0];

    await t.test('startup variance backfill leaves CLOSED receipts and grouped KTC settlements alone', async () => {
      const closed = await line('2026-10-01', 'CLOSED', ktc, 10000, 4000);
      const batch = await line('2026-10-02', 'SUBMITTED', ktc, 10000, 4000);
      const open = await line('2026-10-03', 'SUBMITTED', ktc, 10000, 4000);
      for (const entry of [closed, batch, open]) {
        await pool.query(`UPDATE receipt_line_reconciliations SET settlement_source = 'BANK_SETTLEMENT',
          expected_gross_amount = 10000, expected_net_amount = 9000, settlement_variance_amount = 123.45,
          settlement_batch_key = ? WHERE receipt_line_id = ?`, [entry === batch ? 'KTC-KK-2026-10-02-2026-10-03' : null, entry.lineId]);
      }
      await migrateDatabase();
      assert.equal((await rlr(closed.lineId)).settlement_variance_amount, '123.45');
      assert.equal((await rlr(batch.lineId)).settlement_variance_amount, '123.45');
      assert.equal((await rlr(open.lineId)).settlement_variance_amount, '-5000.00');
    });

    await t.test('KBank monthly QR duplicate check ignores the K SHOP email row but sees a bank row', async () => {
      const qrLine = await line('2026-10-05', 'SUBMITTED', qr, 2500, 0);
      const [imp] = await pool.query("INSERT INTO statement_imports(receipt_id, payment_channel_id, original_name, stored_path) VALUES (?, ?, 'SYNTHETIC', 'SYNTHETIC')", [qrLine.receiptId, qr]);
      await pool.query(`INSERT INTO statement_transactions(import_id, receipt_id, receipt_line_id, payment_channel_id, transaction_date,
        description, reference_no, amount, unique_hash, raw_payload, match_status)
        VALUES (?, ?, ?, ?, '2026-10-05', 'K SHOP daily settlement', 'KB000000000001', 2500, 'synthetic-kshop', ?, 'matched_auto')`,
      [imp.insertId, qrLine.receiptId, qrLine.lineId, qr, JSON.stringify({ merchant_id: 'KB000000000001', body: 'SYNTHETIC email' })]);
      const sql = sqlTemplateContaining("AND NOT (JSON_EXTRACT(raw_payload, '$.merchant_id') IS NOT NULL");
      const params = [qrLine.receiptId, '2026-10-05', 'KB000000000001', 2500];
      assert.equal((await pool.query(sql, params))[0].length, 0, 'K SHOP row must not hide the bank deposit');
      await pool.query(`INSERT INTO statement_transactions(import_id, receipt_id, receipt_line_id, payment_channel_id, transaction_date,
        description, reference_no, amount, unique_hash, raw_payload, match_status)
        VALUES (?, ?, ?, ?, '2026-10-05', 'Thai QR', 'KB000000000001', 2500, 'synthetic-bank', NULL, 'matched_auto')`,
      [imp.insertId, qrLine.receiptId, qrLine.lineId, qr]);
      assert.equal((await pool.query(sql, params))[0].length, 1, 'an existing bank row is still a duplicate');
    });

    await t.test('card settlement note keeps reviewer notes and clears only automatic ones', async () => {
      const set = cardNoteSql();
      const write = (lineId, settlement) => pool.query(`UPDATE receipt_line_reconciliations SET ${set} WHERE receipt_line_id = ?`,
        [settlement.category, settlement.category, settlement.note, settlement.note, lineId]);
      const settled = { category: null, note: null };
      const reviewer = await line('2026-10-06', 'SUBMITTED', ktc, 1000, 975);
      await pool.query("UPDATE receipt_line_reconciliations SET exception_category = 'OTHER', exception_note = 'ผู้ตรวจ: โทรยืนยันกับธนาคารแล้ว' WHERE receipt_line_id = ?", [reviewer.lineId]);
      await write(reviewer.lineId, settled);
      assert.equal((await rlr(reviewer.lineId)).exception_note, 'ผู้ตรวจ: โทรยืนยันกับธนาคารแล้ว');
      const auto = await line('2026-10-07', 'SUBMITTED', ktc, 1000, 975);
      await write(auto.lineId, { category: 'OTHER', note: 'ยอดเข้ายังไม่ครบ ขาด 800.00 บาท' });
      assert.equal((await rlr(auto.lineId)).exception_category, 'OTHER');
      await write(auto.lineId, settled);
      const cleared = await rlr(auto.lineId);
      assert.equal(cleared.exception_category, null);
      assert.equal(cleared.exception_note, null);
    });

    await t.test('repeat-confirm lookup locks stored keys inside a transaction', async () => {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.query('SELECT unique_hash, receipt_line_id FROM statement_transactions WHERE unique_hash IN (?) FOR UPDATE',
          [['synthetic-kshop', 'missing']]);
        assert.deepEqual(rows.map((row) => row.unique_hash), ['synthetic-kshop']);
        await connection.rollback();
      } finally { connection.release(); }
    });

    await t.test('full server startup keeps a reviewer manual check and never touches CLOSED QR lines', async () => {
      const [inbox] = await pool.query(`INSERT INTO bank_inbox_imports(provider, source_message_id, original_name, stored_path, archive_checksum, status)
        VALUES ('KASIKORN_MONTHLY_STATEMENT', 'synthetic-monthly', 'SYNTHETIC.pdf', 'SYNTHETIC', 'synthetic-monthly-checksum', 'AUTO_LINKED')`);
      const lines = {};
      for (const [name, date, status] of [['open', '2026-10-08', 'SUBMITTED'], ['closed', '2026-10-09', 'CLOSED']]) {
        const entry = await line(date, status, qr, 3000, 3000);
        const [imp] = await pool.query("INSERT INTO statement_imports(receipt_id, payment_channel_id, original_name, stored_path) VALUES (?, ?, 'SYNTHETIC bank', 'SYNTHETIC')", [entry.receiptId, qr]);
        await pool.query(`INSERT INTO statement_transactions(import_id, receipt_id, receipt_line_id, payment_channel_id, transaction_date,
          description, reference_no, amount, unique_hash, raw_payload, match_status)
          VALUES (?, ?, ?, ?, ?, 'Thai QR', 'KB000000000002', 3000, ?, ?, 'matched_auto')`,
        [imp.insertId, entry.receiptId, entry.lineId, qr, date, `synthetic-${name}`, JSON.stringify({ Time: '10:00', Description: 'Thai QR' })]);
        await pool.query(`INSERT INTO bank_inbox_transactions(inbox_import_id, receipt_line_id, auto_match_status, source_file_name, transaction_date, amount, unique_hash)
          VALUES (?, ?, 'LINKED', 'SYNTHETIC.pdf', ?, 3000, ?)`, [inbox.insertId, entry.lineId, date, `synthetic-bit-${name}`]);
        await pool.query(`UPDATE receipt_line_reconciliations SET expected_gross_amount = 3000, expected_net_amount = 3000, matched_amount = 3000,
          settlement_source = 'BANK_STATEMENT', settlement_status = ?, manual_checked_without_reference = TRUE
          WHERE receipt_line_id = ?`, [name === 'closed' ? 'EXCEPTION' : 'MATCHED_AUTO', entry.lineId]);
        lines[name] = entry;
      }
      const before = { open: await rlr(lines.open.lineId), closed: await rlr(lines.closed.lineId) };
      const child = spawn(process.execPath, ['src/server.js'], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, ...env, PORT: '0', CASHFLOW_HOST: '127.0.0.1', NODE_ENV: 'test',
          CASHFLOW_UPLOAD_DIR: path.join(root, 'uploads') },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      const ready = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 60_000);
        child.stdout.on('data', () => { if (/API running/.test(output)) { clearTimeout(timer); resolve(true); } });
        child.on('exit', () => { clearTimeout(timer); resolve(/API running/.test(output)); });
      });
      child.kill('SIGTERM');
      await fs.writeFile(path.join(root, 'startup-output.log'), output, { flag: 'w', mode: 0o600 });
      assert.equal(ready, true, `server startup failed:\n${output.slice(-2000)}`);
      assert.doesNotMatch(output, /ER_PARSE_ERROR|ER_BAD_FIELD_ERROR|ReferenceError|TypeError/);
      const after = { open: await rlr(lines.open.lineId), closed: await rlr(lines.closed.lineId) };
      assert.equal(after.open.manual_checked_without_reference, 1, 'unchanged comparison keeps the reviewer manual check');
      assert.deepEqual(after.closed, before.closed, 'CLOSED line is not rewritten at startup');
    });
  } finally {
    await closePool();
    await admin.query(`DROP DATABASE IF EXISTS ${database}`).catch(() => {});
    await admin.end();
  }
});
