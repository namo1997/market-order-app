import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { root, reports, repo, receipt, ssdDir, json, cleanEnv, command, sourceCopy, dependencies } from './common.mjs';
import { googleConfig } from './google.mjs';
import { pilotOptions, codexConfig } from './codex-ocr.mjs';

const args = process.argv.slice(2);
const google = googleConfig(process.env);
const options = pilotOptions(args);
const { port, ocr, seed: seedProfile } = options;
const codex = ocr === 'codex' ? codexConfig(process.env) : null;
const id = `receiving-pilot-${new Date().toISOString().replace(/[-:.]/g, '')}-${process.pid}`;
const run = `${root}/runs/${id}`;
const evidence = `${reports}/${id}`;
let mysqlChild, apiChild;
let stopping = false;
const children = [];
async function stop() {
  if (stopping) return;
  stopping = true;
  // Only direct child handles are signalled, never global PID files or pkill.
  for (const child of [...children].reverse()) {
    if (child.exitCode !== null || child.signalCode) continue;
    const closed = once(child, 'close').catch(() => {});
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 12000);
    await closed; clearTimeout(timer);
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  void stop().then(() => process.exit(signal === 'SIGINT' ? 130 : 143));
});
function start(executable, params, env, log) {
  const output = createWriteStream(log, { mode: 0o600 });
  const child = spawn(executable, params, { cwd: run, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false });
  child.once('error', () => { child.pilotFailed = true; });
  child.once('close', () => output.end());
  return child;
}
const summary = { label: 'SYNTHETIC', run, evidence, ssdReceipt: receipt, portRequested: port, ocr, seedProfile };
try {
  for (const dir of [evidence, run, `${run}/tmp`, `${root}/cache/npm`, `${run}/data`, `${run}/files`]) await ssdDir(dir);
  const env = cleanEnv(`${run}/tmp`);
  for (const name of ['src', 'tests', 'scripts', 'package.json', 'package-lock.json']) {
    await sourceCopy(`${repo}/server/${name}`, `${run}/source/server/${name}`);
  }
  // Regression tests read sibling client source; no client build or APK rebuild.
  for (const name of ['src', 'tests', 'public', 'index.html', 'package.json', 'package-lock.json']) {
    await sourceCopy(`${repo}/client/${name}`, `${run}/source/client/${name}`);
  }
  await sourceCopy(`${repo}/pilot`, `${run}/source/pilot`);
  summary.dependencies = await dependencies(`${run}/source/server`, env, `${evidence}/npm-ci.log`);
  await json(`${evidence}/prepared.json`, summary);
  process.stdout.write(`SSD snapshot: ${run}/source\nEvidence: ${evidence}\n`);
  if (args.includes('--prepare-only')) process.exit(0);
  const mysqld = '/opt/homebrew/bin/mysqld';
  await access(mysqld);
  const socket = `${run}/m.sock`;
  // macOS sockaddr_un has a short path limit. Keep this socket name short.
  if (Buffer.byteLength(socket) >= 104) throw new Error('MySQL socket path too long');
  const mysqlArgs = ['--no-defaults', `--datadir=${run}/data`, `--tmpdir=${run}/tmp`,
    `--socket=${socket}`, '--skip-networking', '--mysqlx=OFF', '--skip-log-bin',
    '--auto-generate-certs=OFF', '--caching-sha2-password-auto-generate-rsa-keys=OFF',
    `--log-error=${evidence}/mysqld.log`, `--pid-file=${run}/mysqld.pid`,
    `--secure-file-priv=${run}/files`, '--innodb-buffer-pool-size=32M',
    '--innodb-redo-log-capacity=32M', '--default-time-zone=+00:00'];
  // Fresh socket-only disposable server, root has no password; no credential read.
  await command(mysqld, [...mysqlArgs, '--initialize-insecure'], { cwd: run, env, log: `${evidence}/mysql-init.log` });
  mysqlChild = start(mysqld, mysqlArgs, env, `${evidence}/mysql-process.log`);
  const mysql = createRequire(`${run}/source/server/package.json`)('mysql2/promise');
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (mysqlChild.exitCode !== null || mysqlChild.pilotFailed) break;
    let connection;
    try {
      connection = await mysql.createConnection({ socketPath: socket, user: 'root', connectTimeout: 1000 });
      const [[identity]] = await connection.query('SELECT @@datadir AS datadir,@@skip_networking AS skip_networking,VERSION() AS version');
      if (identity.datadir.replace(/\/$/, '') !== `${run}/data` || Number(identity.skip_networking) !== 1) throw new Error('Wrong MySQL identity');
      await connection.query('CREATE DATABASE receiving_pilot CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
      summary.mysql = identity; ready = true; break;
    } catch (e) {
      if (!['ENOENT', 'ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST'].includes(e.code)) throw e;
      await new Promise(r => setTimeout(r, 200));
    } finally { await connection?.end(); }
  }
  if (!ready) throw new Error('Disposable MySQL not ready; inspect mysqld.log; do not use another DB');
  await json(`${evidence}/instance.json`, { ...summary, socket });
  apiChild = start(process.execPath, ['--experimental-vm-modules', `${run}/source/pilot/serve.mjs`, run, String(port)],
    { ...env, PILOT_OCR: ocr, PILOT_SEED: seedProfile,
      ...(codex ? { PILOT_CODEX_MODEL: codex.model, PILOT_CODEX_EFFORT: codex.effort,
        ...Object.fromEntries(['HOME', 'CODEX_HOME'].flatMap(k => process.env[k] ? [[k, process.env[k]]] : [])) } : {}),
      ...(google.enabled ? { GOOGLE_OAUTH_CLIENT_IDS: google.clientIds,
      PILOT_GOOGLE_EMAILS: JSON.stringify(google.accounts) } : {}) }, `${evidence}/server.log`);
  let current;
  for (let i = 0; i < 200; i++) {
    if (apiChild.exitCode !== null || apiChild.pilotFailed) break;
    try { current = JSON.parse(await readFile(`${evidence}/ready.json`, 'utf8')); break; }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    await new Promise(r => setTimeout(r, 200));
  }
  if (!current) throw new Error('Pilot API failed to start; inspect server.log');
  await json(`${reports}/current.json`, current);
  process.stdout.write(`SYNTHETIC pilot ready (OCR ${ocr}, seed ${seedProfile})\nGoogle login: ${current.googleEnabled ? 'enabled' : 'disabled (configuration incomplete)'}\nMac: ${current.base}\nEmulator: ${current.emulatorBase}\nLAN: ${current.lanBases.join(', ')}\nStop: Ctrl+C (stops API and this MySQL only)\n`);
  await Promise.race([once(apiChild, 'close'), once(mysqlChild, 'close')]);
  if (!stopping) throw new Error('Pilot child stopped unexpectedly');
} catch (e) {
  process.exitCode = 1; summary.error = e.message;
  process.stderr.write(`${e.message}\n`);
} finally {
  await stop();
  try { await json(`${evidence}/result.json`, { ...summary, stopped: true }); } catch { /* no fallback */ }
}
