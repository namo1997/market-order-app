import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('cashier enters directly while Admin uses an iPhone-style PIN keypad', async () => {
  const appSource = await fs.readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const apiSource = await fs.readFile(new URL('../src/api.js', import.meta.url), 'utf8');

  assert.match(appSource, /เลือกพนักงาน/);
  assert.match(appSource, /cashier-pin-keypad/);
  assert.match(appSource, /กรอก PIN 6 หลัก/);
  assert.match(appSource, /api\.cashiers\(\)/);
  assert.match(appSource, /api\.cashierLogin\(nextUsername\)/);
  assert.match(appSource, /api\.adminPinLogin\(pin\)/);
  assert.match(appSource, /แตะชื่อของตนเองเพื่อเข้าใช้งานได้ทันที/);
  assert.match(appSource, /พนักงานแคชเชียร์/);
  assert.doesNotMatch(appSource, /api\.cashierLogin\([^)]*pin/);
  assert.match(apiSource, /cashiers: \(\) => request\('\/auth\/cashiers'\)/);
  assert.match(apiSource, /adminPinLogin: \(pin\) => json\('POST', '\/auth\/admin-pin', \{ pin \}\)/);
  assert.match(apiSource, /cashierSettings: \(\) => request\('\/settings\/cashiers'\)/);
  assert.match(apiSource, /updateCashierSettings/);
  assert.match(apiSource, /SENSITIVE_FIELD/);
  assert.match(apiSource, /\[REDACTED\]/);
});
