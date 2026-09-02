import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const appDir = path.resolve(serverDir, '..');
const compose = spawnSync('docker', ['compose', '-f', 'docker-compose.preview.yml', 'up', '-d', '--wait'], {
  cwd: appDir, stdio: 'inherit'
});
if (compose.status !== 0) process.exit(compose.status || 1);

const common = {
  ...process.env,
  CASHFLOW_DB_HOST: '127.0.0.1', CASHFLOW_DB_PORT: '3317',
  CASHFLOW_DB_USER: 'cashflow_preview', CASHFLOW_DB_PASSWORD: 'cashflow-preview',
  CASHFLOW_DB_NAME: 'general_cashflow_preview',
  CASHFLOW_HOST: '127.0.0.1', CASHFLOW_PORT: '8100',
  CASHFLOW_CORS_ORIGIN: 'http://127.0.0.1:5178,http://localhost:5178',
  CASHFLOW_PREVIEW_MODE: '1', CASHFLOW_DECISION_REASON_REQUIRED: '1',
  CASHFLOW_SHADOW_API_KEY: process.env.CASHFLOW_PREVIEW_AI_ENABLED === '1' ? (process.env.CASHFLOW_SHADOW_API_KEY || '') : '',
  CASHFLOW_OPENAI_API_KEY: process.env.CASHFLOW_PREVIEW_AI_ENABLED === '1' ? (process.env.CASHFLOW_OPENAI_API_KEY || '') : '',
  CASHFLOW_BRIEF_API_KEY: process.env.CASHFLOW_PREVIEW_AI_ENABLED === '1' ? (process.env.CASHFLOW_BRIEF_API_KEY || '') : '',
  CASHFLOW_SEED_DEMO_USERS: 'true'
};
const children = [
  spawn(process.execPath, ['src/server.js'], { cwd: serverDir, env: common, stdio: 'inherit' }),
  spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1'], {
    cwd: path.join(appDir, 'client'), env: { ...common, VITE_CASHFLOW_API_URL: 'http://127.0.0.1:8100/api' }, stdio: 'inherit'
  })
];
console.log('\nLocal cashflow preview: http://127.0.0.1:5178');
console.log('Production writes and Shadow AI are disabled unless CASHFLOW_PREVIEW_AI_ENABLED=1.\n');
const stop = () => children.forEach((child) => child.kill('SIGTERM'));
process.on('SIGINT', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });
await Promise.race(children.map((child) => new Promise((resolve) => child.once('exit', resolve))));
stop();
