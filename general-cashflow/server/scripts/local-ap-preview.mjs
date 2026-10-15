import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import express from 'express';
import mysql from 'mysql2/promise';
import { runImport } from './import-ap-snapshot.mjs';
import { createApRouter } from '../src/ap/routes.js';
import { assertPermission } from '../src/domain/permissions.js';

export async function startApPreview(args) {
  const root = args.root, SSD = '/Volumes/SSD Files/SOLAO/cashflow/';
  if (!root?.startsWith(SSD) || !(await fs.realpath(root)).startsWith(SSD)) throw new Error('AP_PREVIEW_REQUIRES_SSD');
  const receipt = JSON.parse(await fs.readFile(`${SSD}reports/ssd-check-ap-ledger-20261015.json`, 'utf8'));
  if (receipt.uuid !== 'AEFCEAC9-3AFD-46A4-9EFE-2785ACC83E0B' || receipt.mount !== '/Volumes/SSD Files') throw new Error('SSD_CHECK_RECEIPT_INVALID');
  if ((await fs.stat(root)).dev !== (await fs.stat('/Volumes/SSD Files')).dev) throw new Error('SSD_DEVICE_MISMATCH');
  const datadir = path.join(root, 'mysql'), socket = path.join(root, 'mysql.sock');
  const temp = path.join(root, 'tmp');
  await fs.mkdir(datadir, { recursive: true, mode: 0o700 });
  await fs.mkdir(temp, { recursive: true, mode: 0o700 });
  const env = { PATH: process.env.PATH, TMPDIR: temp, TMP: temp, TEMP: temp, LC_ALL: 'en_US.UTF-8' };
  const base = ['--no-defaults', `--datadir=${datadir}`, '--mysqlx=OFF', '--auto-generate-certs=OFF', '--caching-sha2-password-auto-generate-rsa-keys=OFF'];
  const execute = argv => new Promise((resolve, reject) => {
    const child = spawn('/opt/homebrew/bin/mysqld', argv, { env, stdio: 'ignore' });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error('MYSQL_INITIALIZE_FAILED')));
  });
  const initialized = path.join(root, 'mysql-initialized');
  const completed = await fs.access(initialized).then(()=>true,()=>false);
  if (!completed) {
    if ((await fs.readdir(datadir)).length) throw new Error('MYSQL_PARTIAL_INITIALIZE_REVIEW_REQUIRED');
    await execute([...base, '--initialize-insecure', `--log-error=${root}/mysql-init.log`]);
    await fs.writeFile(initialized, 'Offline SSD-only initialization completed\n', { mode: 0o600 });
  }
  const child = spawn('/opt/homebrew/bin/mysqld', [...base, `--socket=${socket}`, `--pid-file=${root}/mysql.pid`, '--skip-networking', '--skip-log-bin', `--tmpdir=${temp}`, `--log-error=${root}/mysql.log`], { env, stdio: 'ignore' });
  child.on('error', () => { console.error('AP_MYSQL_START_FAILED'); });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { const c = await mysql.createConnection({ socketPath: socket, user: 'root' }); await c.end(); ready = true; break; }
    catch { await pause(250); }
  }
  if (!ready) { child.kill('SIGTERM'); throw new Error('MYSQL_SOCKET_NOT_READY'); }
  try {
    const output = args.output || `${SSD}reports/ap-ledger-v0`;
    await runImport({ snapshot: args.snapshot, socket, output });
    const pool = mysql.createPool({ socketPath: socket, user: 'root', database: 'ap_ledger_preview_202609', dateStrings: true, connectionLimit: 3 });
    const app = express();
    app.use((req,res,next) => {
      if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || !['127.0.0.1', 'localhost'].includes(req.hostname)) return res.sendStatus(403);
      res.set('Cache-Control','no-store'); res.set('X-Content-Type-Options','nosniff');
      if (req.headers.origin && ![`http://127.0.0.1:${args.port || 5189}`, `http://localhost:${args.port || 5189}`].includes(req.headers.origin)) return res.sendStatus(403);
      if (!['GET','HEAD'].includes(req.method)) return res.status(405).json({ code: 'AP_READ_ONLY' });
      next();
    });
    // Separate local-only review surface, no JWT, credentials or Production config imports.
    app.use('/api/ap', createApRouter({ getPool: () => pool, authenticate: (req,res,next) => { req.user = { role: 'admin' }; next(); },
      requirePermission: permission => (req,res,next) => { try { assertPermission(req.user, permission); next(); } catch (e) { next(e); } } }));
    const dist = path.resolve(import.meta.dirname, '../../client/dist');
    app.get('/', (req,res) => res.redirect('/ap-preview.html'));
    app.use(express.static(dist, { index: false }));
    const server = app.listen(Number(args.port || 5189), '127.0.0.1', () => console.log(`AP read-only preview: http://127.0.0.1:${args.port || 5189}/ap-preview.html`));
    server.on('error', async () => { console.error('AP_LOOPBACK_LISTEN_FAILED'); await pool.end(); child.kill('SIGTERM'); });
    const stop = async () => { server.close(); await pool.end(); child.kill('SIGTERM'); };
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
  } catch (e) { child.kill('SIGTERM'); throw e; }
}
