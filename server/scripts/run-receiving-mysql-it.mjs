import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, realpath, stat, writeFile, access, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Do not import database.js, dotenv, or ssd-workspace (its run also invokes diskutil).
const mount = '/Volumes/SSD Files';
const root = `${mount}/SOLAO/market-order-system`;
const reportRoot = `${root}/reports/receiving-mysql-integration`;
const source = fileURLToPath(new URL('../', import.meta.url));
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
const run = `${root}/runs/mysql-it-${stamp}`;
const reports = `${reportRoot}/${stamp}`;
const socket = `${run}/m.sock`;
const mysqld = '/opt/homebrew/bin/mysqld';
let daemon;
let daemonExited;
const summary = { run, reports, receipt: 'Claude 2026-10-15 21:45:50 rc=0', mysqlStarted: false, rounds: [] };

async function ssdDirectory(dir, exclusive = false) {
  if (await realpath(mount) !== mount) throw new Error('SSD mount unavailable or redirected');
  if (!dir.startsWith(`${root}/`)) throw new Error('Refusing output outside SSD project');
  // Verify existing ancestors before mkdir, including pre-existing symlinks.
  let ancestor = path.dirname(dir);
  while (true) {
    try { await access(ancestor); break; } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      ancestor = path.dirname(ancestor);
    }
  }
  const resolvedAncestor = await realpath(ancestor);
  if (resolvedAncestor !== mount && !resolvedAncestor.startsWith(`${mount}/`)) {
    throw new Error('Output ancestor escapes SSD');
  }
  if ((await stat(ancestor)).dev !== (await stat(mount)).dev) throw new Error('Different device');
  await mkdir(dir, { recursive: !exclusive, mode: 0o700 });
  if (await realpath(dir) !== dir || (await stat(dir)).dev !== (await stat(mount)).dev) {
    throw new Error('Output escaped SSD');
  }
}

// Allowlist environment: no database/cloud credentials or inherited NODE_OPTIONS.
const env = Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'SYSTEMROOT'].flatMap(k =>
  process.env[k] ? [[k, process.env[k]]] : []));
Object.assign(env, {
  NODE_ENV: 'test', TZ: 'UTC', SOLAO_LOCAL_SIMULATION: '1',
  TMPDIR: `${run}/tmp`, TMP: `${run}/tmp`, TEMP: `${run}/tmp`,
  npm_config_cache: `${run}/cache`, npm_config_logs_dir: `${run}/cache/_logs`,
  RECEIVING_IT_MYSQL_SOCKET: socket, RECEIVING_IT_MYSQL_DATABASE: 'receiving_it',
  SOLAO_TEST_OUTPUT_DIR: reports, SOLAO_ARTIFACTS_DIR: reports
});

function command(executable, args, logName, cwd = run, childEnv = env) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(`${reports}/${logName}`, { flags: 'wx', mode: 0o600 });
    const child = spawn(executable, args, { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGTERM'), 120000);
    child.stdout.on('data', b => { output.write(b); process.stdout.write(b); });
    child.stderr.on('data', b => { output.write(b); process.stderr.write(b); });
    child.once('error', e => { clearTimeout(timer); output.end(); reject(e); });
    child.once('close', code => { clearTimeout(timer); output.end(() => resolve(code ?? 1)); });
  });
}

async function verifyDependencyLinks(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isSymbolicLink() && !(await realpath(file)).startsWith(`${run}/`)) {
      throw new Error('Dependency symlink escapes disposable SSD run');
    }
    if (entry.isDirectory()) await verifyDependencyLinks(file);
  }
}

async function dependencies() {
  const lock = await readFile(`${summary.source}/package-lock.json`);
  // Reuse an exact-lockfile dependency installation already on SSD when offline.
  const previousRuns = (await readdir(`${root}/runs`)).sort().reverse();
  for (const previous of previousRuns) {
    if (previous.startsWith('mysql-it-')) continue;
    for (const relative of ['source/server', 'source']) {
      const candidate = `${root}/runs/${previous}/${relative}`;
      try {
        if (!lock.equals(await readFile(`${candidate}/package-lock.json`))) continue;
        const resolved = await realpath(`${candidate}/node_modules`);
        if (!resolved.startsWith(`${root}/runs/`)) continue;
        if (await command('/usr/bin/rsync', ['-a', `${resolved}/`, `${summary.source}/node_modules/`],
          'dependencies-copy.log')) throw new Error('Dependency copy failed');
        await verifyDependencyLinks(`${summary.source}/node_modules`);
        summary.dependencies = { mode: 'SSD exact-lockfile copy', source: resolved,
          lockSha256: createHash('sha256').update(lock).digest('hex') };
        return;
      } catch (e) {
        if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
      }
    }
  }
  if (await command('npm', ['ci', '--offline', '--no-audit', '--no-fund',
    `--cache=${root}/cache/npm`], 'npm-ci.log', summary.source)) {
    throw new Error('Offline npm ci failed; prepare exact-lockfile dependencies on SSD first');
  }
  await verifyDependencyLinks(`${summary.source}/node_modules`);
  summary.dependencies = { mode: 'npm ci --offline' };
}

async function stop() {
  if (!daemon || daemon.exitCode !== null || daemon.signalCode) return;
  daemon.kill('SIGTERM');
  let timer;
  const stopped = await Promise.race([
    daemonExited.then(() => true), new Promise(r => { timer = setTimeout(() => r(false), 15000); })
  ]);
  clearTimeout(timer);
  if (!stopped) { daemon.kill('SIGKILL'); await daemonExited; }
  summary.mysqlStopped = true;
}
process.once('SIGINT', () => { void stop().then(() => process.exit(130)); });
process.once('SIGTERM', () => { void stop().then(() => process.exit(143)); });

try {
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: source, encoding: 'utf8' }).trim();
  if (branch !== 'receiving/server') throw new Error('Expected current receiving/server branch');
  await ssdDirectory(`${root}/runs`);
  await ssdDirectory(reportRoot);
  await ssdDirectory(run, true);
  await ssdDirectory(reports, true);
  for (const name of ['data', 'tmp', 'cache', 'files', 'source']) await ssdDirectory(`${run}/${name}`);
  await writeFile(`${reports}/ssd-receipt.json`, JSON.stringify({
    suppliedBy: 'Claude', checkedAt: '2026-10-15 21:45:50 Asia/Bangkok', rc: 0,
    mount, uuid: 'AEFCEAC9-3AFD-46A4-9EFE-2785ACC83E0B', freeBytes: 125127749632,
    verificationReusedAt: new Date().toISOString(), rechecked: false
  }, null, 2), { flag: 'wx', mode: 0o600 });
  summary.source = `${run}/source/server`;
  const copyRc = await command('/usr/bin/rsync', ['-a',
    '--exclude=.env*', '--exclude=.git', '--exclude=node_modules', '--exclude=*.log',
    '--exclude=*.db', '--exclude=*.sqlite*', '--exclude=uploads', '--exclude=reports',
    source, `${summary.source}/`], 'snapshot.log');
  if (copyRc) throw new Error(`Snapshot failed rc=${copyRc}`);
  // Legacy release tests import/read sibling client source. Preserve repo layout.
  const clientRc = await command('/usr/bin/rsync', ['-a',
    '--exclude=.env*', '--exclude=node_modules', '--exclude=dist', '--exclude=build',
    '--exclude=.gradle', '--exclude=*.keystore', '--exclude=*.log',
    path.resolve(source, '../client') + '/', `${run}/source/client/`], 'snapshot-client.log');
  if (clientRc) throw new Error(`Client source snapshot failed rc=${clientRc}`);
  await dependencies();
  const hashes = {};
  async function hashSources(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.env')) continue;
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await hashSources(file);
      if (entry.isFile()) hashes[path.relative(`${run}/source`, file)] =
        createHash('sha256').update(await readFile(file)).digest('hex');
    }
  }
  await hashSources(`${run}/source`);
  await writeFile(`${reports}/source-sha256.json`, JSON.stringify(hashes, null, 2), { flag: 'wx', mode: 0o600 });
  summary.validationRc = await command(process.execPath, ['--experimental-vm-modules',
    'scripts/validate-receiving-mysql-it.mjs'], 'validation.log', summary.source);
  if (summary.validationRc) throw new Error('Harness source validation failed');
  for (let round = 1; round <= 2; round++) {
    const regressionRc = await command('/bin/sh', ['-c',
      'node --experimental-vm-modules --test --test-reporter=tap tests/*.test.mjs'],
    `regression-${round}.log`, summary.source);
    summary.rounds.push({ round, regressionRc, integrationRc: null });
  }
  const baseArgs = ['--no-defaults', `--datadir=${run}/data`, `--tmpdir=${run}/tmp`,
    `--socket=${socket}`, '--skip-networking', '--mysqlx=OFF', '--skip-log-bin',
    '--auto-generate-certs=OFF', '--caching-sha2-password-auto-generate-rsa-keys=OFF',
    `--log-error=${reports}/mysqld.log`, `--pid-file=${run}/mysqld.pid`,
    `--secure-file-priv=${run}/files`, '--innodb-buffer-pool-size=32M',
    '--innodb-redo-log-capacity=32M', '--default-time-zone=+00:00'];
  summary.initializeRc = await command(mysqld, [...baseArgs, '--initialize-insecure'], 'mysql-init.log');
  if (summary.initializeRc) {
    const noSocket = { ...env };
    delete noSocket.RECEIVING_IT_MYSQL_SOCKET;
    summary.optInDisabled = [];
    for (let round = 1; round <= 2; round++) {
      const rc = await command(process.execPath, ['--experimental-vm-modules', '--test',
        '--test-reporter=tap', 'tests/integration/receiving-mysql.it.mjs'],
      `opt-in-disabled-${round}.log`, summary.source, noSocket);
      summary.optInDisabled.push({ round, rc });
    }
    throw new Error('mysqld initialization failed; opt-in-disabled logs are NOT integration results');
  }
  const daemonLog = createWriteStream(`${reports}/mysql-process.log`, { flags: 'wx', mode: 0o600 });
  daemon = spawn(mysqld, baseArgs, { cwd: run, env, stdio: ['ignore', 'pipe', 'pipe'] });
  summary.mysqlStarted = true;
  daemon.stdout.pipe(daemonLog, { end: false });
  daemon.stderr.pipe(daemonLog, { end: false });
  daemonExited = new Promise(resolve => {
    daemon.once('error', e => { summary.startError = e.message; resolve(); });
    daemon.once('close', () => { daemonLog.end(); resolve(); });
  });
  const mysql = await import(new URL('./source/server/node_modules/mysql2/promise.js', `file://${run}/`).href);
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (daemon.exitCode !== null || summary.startError) break;
    try {
      const c = await mysql.createConnection({ socketPath: socket, user: 'root', connectTimeout: 1000 });
      try {
        const [[identity]] = await c.query('SELECT @@datadir AS datadir, @@skip_networking AS skip_networking, VERSION() AS version');
        if (path.resolve(identity.datadir) !== `${run}/data` || Number(identity.skip_networking) !== 1) {
          throw new Error('MySQL identity mismatch');
        }
        summary.mysql = identity;
        await c.query('CREATE DATABASE receiving_it CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
        ready = true;
      } finally { await c.end(); }
      break;
    } catch (e) {
      if (!['ENOENT', 'ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST'].includes(e.code)) throw e;
      await new Promise(r => setTimeout(r, 200));
    }
  }
  if (!ready) throw new Error('MySQL socket did not become ready; inspect mysqld.log (sandbox may prohibit bind)');
  summary.setupRc = await command(process.execPath, ['--experimental-vm-modules',
    'scripts/setup-receiving-mysql-it.mjs'], 'schema-setup.log', summary.source);
  if (summary.setupRc) throw new Error('Schema setup failed');
  for (let round = 1; round <= 2; round++) {
    const integrationRc = await command(process.execPath, ['--experimental-vm-modules', '--test',
      '--test-reporter=tap', 'tests/integration/receiving-mysql.it.mjs'], `integration-${round}.log`, summary.source);
    summary.rounds[round - 1].integrationRc = integrationRc;
  }
  process.exitCode = summary.rounds.some(r => r.integrationRc || r.regressionRc) ? 1 : 0;
} catch (e) {
  summary.error = e.message;
  process.stderr.write(`${e.message}\n`);
  process.exitCode = 1;
} finally {
  await stop();
  // If directory validation itself failed, do not create report folders as fallback.
  try { await writeFile(`${reports}/result.json`, JSON.stringify(summary, null, 2), { flag: 'wx', mode: 0o600 }); }
  catch { /* The terminal error remains the evidence if SSD could not be used. */ }
  process.stdout.write(`Reports: ${reports}\n`);
}
