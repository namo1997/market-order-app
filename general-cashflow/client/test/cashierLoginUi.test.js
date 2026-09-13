import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('cashier entry opens an iPhone-style PIN keypad after staff selection', async () => {
  const appSource = await fs.readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const apiSource = await fs.readFile(new URL('../src/api.js', import.meta.url), 'utf8');

  assert.match(appSource, /เลือกพนักงาน/);
  assert.match(appSource, /cashier-pin-keypad/);
  assert.match(appSource, /กรอก PIN 6 หลัก/);
  assert.match(appSource, /api\.cashiers\(\)/);
  assert.match(appSource, /api\.cashierLogin\(\{ username: cashierUsername, pin \}\)/);
  assert.doesNotMatch(appSource, /api\.cashierLogin\(\)/);
  assert.match(apiSource, /cashiers: \(\) => request\('\/auth\/cashiers'\)/);
});
