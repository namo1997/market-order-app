import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('Google login is server configured and keeps branch access without an unused password form', async () => {
  const appSource = await fs.readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const apiSource = await fs.readFile(new URL('../src/api.js', import.meta.url), 'utf8');

  assert.match(appSource, /accounts\.google\.com\/gsi\/client/);
  assert.match(appSource, /api\.googleLoginConfig\(\)/);
  assert.match(appSource, /api\.googleLogin\(response\.credential\)/);
  assert.match(appSource, /เข้าใช้งานแคชเชียร์/);
  assert.doesNotMatch(appSource, /<Field label="Username"/);
  assert.doesNotMatch(appSource, /<Field label="Password"/);
  assert.match(apiSource, /googleLoginConfig: \(\) => request\('\/auth\/google\/config'\)/);
  assert.match(apiSource, /googleLogin: \(credential\) => json\('POST', '\/auth\/google'/);
});
