import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const inspect = (overrides = {}) => {
  const env = { ...process.env };
  for (const key of ['CASHFLOW_JWT_SECRET', 'CASHFLOW_ADMIN_PASSWORD', 'CASHFLOW_SEED_DEMO_USERS']) delete env[key];
  return spawnSync(process.execPath, ['--input-type=module', '-e', `import {config} from './src/config.js'; console.log(JSON.stringify({demo:config.seed.demoUsers,password:config.seed.adminPassword}));`], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...env, ...overrides }
  });
};

test('production refuses absent/default/short JWT secrets without printing their value', () => {
  for (const secret of ['', 'cashflow-local-secret', 'short']) {
    const result = inspect({ NODE_ENV: 'production', CASHFLOW_JWT_SECRET: secret });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Production requires CASHFLOW_JWT_SECRET/);
  }
});

test('production safe seed defaults preserve explicit opt-in while local setup remains usable', () => {
  const env = { NODE_ENV: 'production', CASHFLOW_JWT_SECRET: 'x'.repeat(32) };
  assert.deepEqual(JSON.parse(inspect(env).stdout), { demo: false, password: '' });
  assert.deepEqual(JSON.parse(inspect({ ...env, CASHFLOW_SEED_DEMO_USERS: 'true', CASHFLOW_ADMIN_PASSWORD: 'fixture-only' }).stdout), { demo: true, password: 'fixture-only' });
  assert.deepEqual(JSON.parse(inspect({ NODE_ENV: 'test' }).stdout), { demo: true, password: 'admin12345' });
});
