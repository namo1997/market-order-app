import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('production stays awake and retains its deployment readiness check', async () => {
  const config = JSON.parse(await readFile(new URL('../../railway.json', import.meta.url), 'utf8'));
  assert.equal(config.deploy.sleepApplication, false);
  assert.equal(config.deploy.healthcheckPath, '/health');
  assert.ok(config.deploy.healthcheckTimeout >= 100);
});
