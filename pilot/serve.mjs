import { createRequire } from 'node:module';
import { networkInterfaces } from 'node:os';
import { readFile } from 'node:fs/promises';
import { root, reports, ssdDir, json } from './common.mjs';
import { loadApp } from './app.mjs';
import { seed } from './seed.mjs';
import { googleConfig, seedGoogle } from './google.mjs';

const [run, portString] = process.argv.slice(2);
if (!new RegExp(`^${root}/runs/receiving-pilot-[A-Za-z0-9T-]+$`).test(run || '')) throw new Error('Invalid pilot run');
await ssdDir(run);
const evidence = `${reports}/${run.split('/').at(-1)}`;
const instance = JSON.parse(await readFile(`${evidence}/instance.json`, 'utf8'));
if (instance.run !== run || instance.socket !== `${run}/m.sock`) throw new Error('Invalid instance');
const server = `${run}/source/server`;
const mysql = createRequire(`${server}/package.json`)('mysql2/promise');
const pool = mysql.createPool({ socketPath: instance.socket, user: 'root', database: 'receiving_pilot',
  connectionLimit: 8, connectTimeout: 2000, timezone: 'Z' });
pool.on('connection', connection => connection.query("SET SESSION time_zone='+00:00'"));
let listener;
async function close(code) {
  if (listener) await new Promise(r => listener.close(r));
  await pool.end(); process.exit(code);
}
process.once('SIGTERM', () => { void close(0); });
process.once('SIGINT', () => { void close(0); });
try {
  const [[identity]] = await pool.query('SELECT @@datadir AS datadir,@@skip_networking AS skip_networking,DATABASE() AS db');
  if (identity.datadir.replace(/\/$/, '') !== `${run}/data` || Number(identity.skip_networking) !== 1 || identity.db !== 'receiving_pilot') throw new Error('Wrong MySQL identity');
  const google = googleConfig(process.env);
  const { app, source } = await loadApp(server, pool, { google });
  const data = await seed(server, pool, source);
  await seedGoogle(pool, source, google);
  listener = await new Promise((resolve, reject) => {
    const http = app.listen(Number(portString), '0.0.0.0', () => resolve(http));
    http.once('error', reject);
  });
  const port = listener.address().port;
  const lanBases = Object.values(networkInterfaces()).flat().filter(n => n.family === 'IPv4' && !n.internal)
    .map(n => `http://${n.address}:${port}`);
  await json(`${evidence}/ready.json`, { ...instance, seed: data, port, base: `http://127.0.0.1:${port}`,
    emulatorBase: `http://10.0.2.2:${port}`, lanBases, googleEnabled: google.enabled, apiPid: process.pid, readyAt: new Date().toISOString() });
} catch (e) {
  // Error code only. Never dump raw SQL or body from receiving source.
  process.stderr.write(`Pilot startup failed: ${e.code || e.name}\n`);
  await close(1);
}
