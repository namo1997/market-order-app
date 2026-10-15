import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ROOT, DEFAULT_OUT, ssdDirectory, ssdPath } from './support/ssd-path.mjs';
import { writeReport } from './support/report.mjs';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prepareOnly = process.argv.includes('--prepare-only');
const playwrightArgs = process.argv.slice(2).filter(argument => argument !== '--prepare-only');
const out = ssdDirectory(process.env.E2E_OUT || DEFAULT_OUT);
const run = ssdDirectory(`${ROOT}/runs/receiving-e2e-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);
const suite = path.join(run, 'e2e');
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/TOKEN|SECRET|PASSWORD|API_KEY|^DB_|^DATABASE|^MYSQL|^RAILWAY|^VITE_|^OPENAI|^GOOGLE_APPLICATION_CREDENTIALS/.test(key)) delete env[key];
}
Object.assign(env, {
  TMPDIR: ssdDirectory(`${run}/tmp`), TMP: `${run}/tmp`, TEMP: `${run}/tmp`,
  npm_config_cache: ssdDirectory(`${ROOT}/cache/receiving-e2e-npm`),
  PLAYWRIGHT_BROWSERS_PATH: ssdDirectory(`${ROOT}/cache/receiving-e2e-browsers`),
  XDG_CACHE_HOME: ssdDirectory(`${ROOT}/cache/receiving-e2e-xdg`),
  E2E_OUT: out, E2E_DIST: path.join(run, 'client/dist'),
  VITE_API_URL: '/api', VITE_ENABLE_DEV_MOCK_AUTH: 'false',
  npm_config_userconfig: path.join(run, 'npmrc-empty'),
});
fs.writeFileSync(env.npm_config_userconfig, '');
const copyFilter = (name) => !/^(?:\.env(?:\..*)?|\.npmrc|\.git|node_modules|dist|test-results|playwright-report)$/.test(path.basename(name));
fs.cpSync(path.join(source, 'e2e'), suite, { recursive: true, filter: copyFilter });
fs.cpSync(path.join(source, 'client'), path.join(run, 'client'), { recursive: true, filter: copyFilter });
const manifest = {
  source, run, suppliedSSDVerification: { at: '2026-10-15T22:02:30+07:00', rc: 0, uuid: 'AEFCEAC9-3AFD-46A4-9EFE-2785ACC83E0B' },
  files: [], steps: [],
};
function inventory(dir) {
  for (const name of fs.readdirSync(dir)) {
    const filename = path.join(dir, name);
    if (fs.statSync(filename).isDirectory()) inventory(filename);
    else manifest.files.push({ path: path.relative(run, filename), sha256: crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex') });
  }
}
inventory(path.join(run, 'client')); inventory(suite);
const manifestPath = path.join(out, `manifest-${path.basename(run)}.json`);
function command(name, cmd, args, cwd, allowFailure = false) {
  const result = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  fs.writeFileSync(ssdPath(`${out}/${path.basename(run)}-${name}.log`), `${result.stdout || ''}${result.stderr || ''}${result.error?.message || ''}`);
  manifest.steps.push({ name, command: [cmd, ...args], rc: result.status, error: result.error?.code });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  process.stdout.write(`${name}: rc=${result.status}; log=${out}/${path.basename(run)}-${name}.log\n`);
  if (result.status !== 0 && !allowFailure) process.exit(result.status || 1);
  return result.status ?? 1;
}
command('client-install', 'npm', ['ci', '--no-audit', '--no-fund'], path.join(run, 'client'));
command('client-build', 'npm', ['run', 'build'], path.join(run, 'client'));
command('e2e-install', 'npm', [fs.existsSync(path.join(suite, 'package-lock.json')) ? 'ci' : 'install', '--no-audit', '--no-fund'], suite);
command('harness', 'node', ['--test', 'support/mock-api.test.mjs'], suite);
command('list', 'node', ['node_modules/@playwright/test/cli.js', 'test', '--list'], suite);
command('browser-install', 'node', ['node_modules/@playwright/test/cli.js', 'install', 'chromium'], suite);
if (prepareOnly) {
  process.stdout.write(`Prepared SSD suite: ${suite}\n`);
  process.exit(0);
}
let failed = false;
for (const round of [1, 2]) {
  env.E2E_ROUND = String(round);
  failed = command(`round-${round}`, 'node', ['node_modules/@playwright/test/cli.js', 'test', ...playwrightArgs], suite, true) !== 0 || failed;
}
process.exitCode = failed ? 1 : 0;
writeReport(out, manifestPath);
process.stdout.write(`Report: ${out}/REPORT.md\n`);
