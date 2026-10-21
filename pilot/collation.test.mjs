import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { root, ssdDir, cleanEnv, command } from './common.mjs';
import { loadApp } from './app.mjs';
import { seed } from './seed.mjs';

// Real MySQL, disposable, socket-only, on the SSD. The database default is utf8mb4_0900_ai_ci and the
// fixture tables mirror Production: core tables utf8mb4_unicode_ci, supplier_masters and product_group_*
// utf8mb4_0900_ai_ci, receiving tables (created by the real ensure) utf8mb4_unicode_ci. Before the fix,
// GET /api/receiving-admin/suppliers failed here with ER_CANT_AGGREGATE_2COLLATIONS (staging 58e637fc).
const server = fileURLToPath(new URL('../server', import.meta.url));
const mysqld = '/opt/homebrew/bin/mysqld';
const cleanups = [];
after(async () => { for (const fn of cleanups.reverse()) await fn().catch(() => {}); });

async function startMysql() {
  await access(mysqld);
  const id = `collation-test-${new Date().toISOString().replace(/[-:.]/g, '')}-${process.pid}`;
  const run = `${root}/runs/${id}`;
  for (const dir of [run, `${run}/data`, `${run}/tmp`, `${run}/files`]) await ssdDir(dir);
  const socket = `${run}/m.sock`;
  assert.ok(Buffer.byteLength(socket) < 104, 'socket path too long for macOS');
  const env = cleanEnv(`${run}/tmp`);
  const args = ['--no-defaults', `--datadir=${run}/data`, `--tmpdir=${run}/tmp`, `--socket=${socket}`,
    '--skip-networking', '--mysqlx=OFF', '--skip-log-bin', '--auto-generate-certs=OFF',
    '--caching-sha2-password-auto-generate-rsa-keys=OFF', `--log-error=${run}/mysqld.log`,
    `--pid-file=${run}/mysqld.pid`, `--secure-file-priv=${run}/files`, '--innodb-buffer-pool-size=32M',
    '--innodb-redo-log-capacity=32M', '--default-time-zone=+00:00'];
  await command(mysqld, [...args, '--initialize-insecure'], { cwd: run, env, log: `${run}/mysql-init.log` });
  const child = spawn(mysqld, args, { cwd: run, env, stdio: 'ignore' });
  cleanups.push(async () => {
    if (child.exitCode !== null || child.signalCode) return;
    const closed = new Promise(resolve => child.once('close', resolve));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 12000);
    await closed; clearTimeout(timer);
  });
  const mysql = createRequire(`${server}/package.json`)('mysql2/promise');
  for (let i = 0; i < 150; i++) {
    let connection;
    try {
      connection = await mysql.createConnection({ socketPath: socket, user: 'root', connectTimeout: 1000 });
      const [[identity]] = await connection.query('SELECT @@datadir AS datadir,@@skip_networking AS skip_networking');
      assert.equal(identity.datadir.replace(/\/$/, ''), `${run}/data`, 'wrong MySQL identity');
      assert.equal(Number(identity.skip_networking), 1);
      await connection.query('CREATE DATABASE collation_pilot CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
      await connection.end();
      const pool = mysql.createPool({ socketPath: socket, user: 'root', database: 'collation_pilot', connectionLimit: 4, timezone: 'Z' });
      cleanups.push(() => pool.end());
      return pool;
    } catch (error) {
      await connection?.end().catch(() => {});
      if (!['ENOENT', 'ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST'].includes(error.code)) throw error;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  throw new Error('Disposable MySQL did not become ready');
}

const pool = await startMysql();
const { app, source } = await loadApp(server, pool);
await seed(server, pool, source, { profile: 'all', date: '2026-10-20' });
const listener = await new Promise((resolve, reject) => {
  const http = app.listen(0, '127.0.0.1', () => resolve(http));
  http.once('error', reject);
});
cleanups.push(() => new Promise(resolve => listener.close(resolve)));
const base = `http://127.0.0.1:${listener.address().port}`;
const login = await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ departmentId: 3 }) })).json();
const headers = { authorization: `Bearer ${login.data.token}` };
const get = async url => { const response = await fetch(`${base}${url}`, { headers }); return { status: response.status, body: await response.json() }; };

test('the pilot database reproduces the Production collation mix', async () => {
  const [[db]] = await pool.query('SELECT @@collation_database AS collation');
  assert.equal(db.collation, 'utf8mb4_0900_ai_ci');
  const [rows] = await pool.query('SELECT TABLE_NAME AS name, TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
  const collation = Object.fromEntries(rows.map(row => [row.name, row.collation]));
  for (const name of ['branches', 'departments', 'users', 'units', 'products', 'product_groups', 'orders', 'order_items']) {
    assert.equal(collation[name], 'utf8mb4_unicode_ci', name);
  }
  for (const name of ['supplier_masters', 'product_supplier_master_links', 'product_group_links', 'product_group_scopes']) {
    assert.equal(collation[name], 'utf8mb4_0900_ai_ci', name);
  }
  for (const name of Object.keys(collation).filter(table => /^receiving_|^supplier_product_alias/.test(table))) {
    assert.equal(collation[name], 'utf8mb4_unicode_ci', name);
  }
  assert.ok(Object.keys(collation).some(name => name === 'receiving_documents'));
});

test('the unfixed shape of the registry statements fails on this database with ER_CANT_AGGREGATE_2COLLATIONS', async () => {
  await assert.rejects(pool.query('SELECT sm.id FROM supplier_masters sm JOIN product_groups pg ON TRIM(pg.name) = TRIM(sm.name)'),
    /Illegal mix of collations \(utf8mb4_unicode_ci,IMPLICIT\) and \(utf8mb4_0900_ai_ci,IMPLICIT\) for operation '='/);
  // MySQL reports the UNION flavour without the collation pair (same ER_CANT_AGGREGATE_2COLLATIONS family).
  await assert.rejects(pool.query(`SELECT name FROM (SELECT sm.name AS name FROM supplier_masters sm UNION ALL SELECT pg.name FROM product_groups pg) x`),
    /Illegal mix of collations for operation 'UNION'/);
});

test('GET /api/receiving-admin/suppliers answers 200 as the SYNTHETIC accounting user (registry with twin shop merged)', async () => {
  const { status, body } = await get('/api/receiving-admin/suppliers');
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body.data.items.map(item => item.supplier_key), ['sm:1', 'pg:1']);
  const found = await get(`/api/receiving-admin/suppliers?q=${encodeURIComponent('น้ำแข็ง')}`);
  assert.equal(found.status, 200);
  assert.deepEqual(found.body.data.items.map(item => item.supplier_key), ['sm:1']);
  assert.equal((await get('/api/receiving-admin/suppliers?kind=master')).status, 200);
  assert.equal((await get('/api/receiving-admin/suppliers?kind=group')).status, 200);
});

test('registry detail and receiving supplier search/products also run on the mixed collations', async () => {
  const detail = await get('/api/receiving-admin/suppliers/pg:2');
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.equal(detail.body.data.supplier_key, 'sm:1');
  const search = await get(`/api/receiving-documents/suppliers?branch_id=1&department_id=3&q=${encodeURIComponent('น้ำแข็ง')}`);
  assert.equal(search.status, 200, JSON.stringify(search.body));
  assert.ok(search.body.data.some(item => item.supplier_key === 'sm:1'));
  assert.ok(!search.body.data.some(item => item.supplier_key === 'pg:2'), 'the twin group is shown through its master only');
  const all = await get('/api/receiving-documents/suppliers?branch_id=1&department_id=3');
  assert.equal(all.status, 200, JSON.stringify(all.body));
});
