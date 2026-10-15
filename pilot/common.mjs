import { access, mkdir, realpath, stat, writeFile, cp, readFile, readdir } from 'node:fs/promises';
import { constants, createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = '/Volumes/SSD Files/SOLAO/market-order-system';
export const reports = `${root}/reports/receiving-pilot`;
export const repo = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
export const receipt = { suppliedBy: 'Claude', checkedAt: '2026-10-15 23:58:17 Asia/Bangkok',
  rc: 0, mount: '/Volumes/SSD Files', uuid: 'AEFCEAC9-3AFD-46A4-9EFE-2785ACC83E0B',
  freeBytes: 113487831040, rechecked: false };

// Availability/containment only. Reuse the supplied identity receipt; no diskutil,
// ssd-workspace check/run, mount creation, symlink fallback, or internal outputs.
export async function ssdDir(dir) {
  const mount = receipt.mount;
  if (!dir.startsWith(`${root}/`)) throw new Error('Output must be inside SSD project');
  const device = (await stat(mount)).dev;
  if (device === (await stat('/')).dev || await realpath(mount) !== mount) {
    throw new Error('SSD unavailable; stop, never create a replacement mount directory');
  }
  let ancestor = dir;
  while (true) {
    try { await access(ancestor); break; }
    catch (e) { if (e.code !== 'ENOENT') throw e; ancestor = path.dirname(ancestor); }
  }
  if (await realpath(ancestor) !== ancestor || (await stat(ancestor)).dev !== device) {
    throw new Error('SSD output ancestor redirected or on another device');
  }
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (await realpath(dir) !== dir || (await stat(dir)).dev !== device) throw new Error('SSD path escaped');
  await access(dir, constants.W_OK);
  return dir;
}

export async function json(file, value) {
  await ssdDir(path.dirname(file));
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export function cleanEnv(tmp) {
  const env = Object.fromEntries(['PATH', 'LANG', 'LC_ALL'].flatMap(k => process.env[k] ? [[k, process.env[k]]] : []));
  return { ...env, NODE_ENV: 'test', TZ: 'UTC', SOLAO_LOCAL_SIMULATION: '1',
    TMPDIR: tmp, TMP: tmp, TEMP: tmp, npm_config_cache: `${root}/cache/npm`,
    npm_config_logs_dir: `${root}/cache/npm/_logs`, npm_config_update_notifier: 'false',
    XDG_CACHE_HOME: tmp, XDG_CONFIG_HOME: tmp };
}

export function command(executable, args, { cwd, env, log, input, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const out = log ? createWriteStream(log, { mode: 0o600 }) : null;
    const child = spawn(executable, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdin.on('error', () => {});
    child.stdin.end(input || ''); // EOF never accepts an Android license.
    child.stdout.on('data', b => { out?.write(b); if (capture) stdout += b; });
    child.stderr.on('data', b => { out?.write(b); });
    child.once('error', e => { out?.end(); reject(e); });
    child.once('close', code => {
      const finish = () => code === 0 ? resolve(stdout) : reject(new Error(`${path.basename(executable)} rc=${code}; see ${log || 'terminal prerequisites'}`));
      if (out) out.end(finish); else finish();
    });
  });
}

export async function sourceCopy(from, to) {
  await ssdDir(path.dirname(to));
  await cp(from, to, { recursive: true, filter: async file => {
    const name = path.basename(file);
    if (name.startsWith('.env') || ['node_modules', '.git', '.DS_Store', 'dist', 'build',
      'uploads', 'reports', '.gradle'].includes(name) || /\.(db|sqlite.*|log|keystore)$/.test(name)) return false;
    if ((await realpath(file)) !== file) throw new Error('Source symlinks are not allowed in pilot snapshot');
    return true;
  } });
}

export async function dependencies(server, env, log) {
  const lock = await readFile(`${server}/package-lock.json`);
  // Copy exact-lock dependencies from an existing SSD run; never link to Mac.
  for (const name of (await readdir(`${root}/runs`)).sort().reverse()) {
    const candidate = `${root}/runs/${name}/source/server`;
    if (candidate === server) continue;
    try {
      if (!(await readFile(`${candidate}/package-lock.json`)).equals(lock)) continue;
      const modules = await realpath(`${candidate}/node_modules`);
      if (!modules.startsWith(`${root}/runs/`)) continue;
      await cp(modules, `${server}/node_modules`, { recursive: true, dereference: true });
      return 'exact-lock SSD dependency copy';
    } catch (e) { if (!['ENOENT', 'ENOTDIR'].includes(e.code)) throw e; }
  }
  await command('npm', ['ci', '--no-audit', '--no-fund'], { cwd: server, env, log });
  return 'npm ci on SSD';
}

export const bangkokDate = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());
