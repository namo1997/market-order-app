import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('cashier chooses a branch while named Admin uses a six-digit PIN', async () => {
  const appSource = await fs.readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const apiSource = await fs.readFile(new URL('../src/api.js', import.meta.url), 'utf8');

  assert.match(appSource, /เลือกสาขาของคุณ/);
  assert.match(appSource, /cashier-pin-keypad/);
  assert.match(appSource, /กรอก PIN 6 หลัก/);
  assert.match(appSource, /api\.loginBranches\(\)/);
  assert.match(appSource, /api\.branchLogin\(branchId\)/);
  assert.match(appSource, /api\.adminPinLogin\(pin, adminUsername\)/);
  assert.match(appSource, /แตะสาขาที่คุณทำงานเพื่อเข้าใช้งาน/);
  assert.match(appSource, /พนักงานแคชเชียร์/);
  assert.doesNotMatch(appSource, /api\.cashierLogin\([^)]*pin/);
  assert.match(apiSource, /cashiers: \(\) => request\('\/auth\/cashiers'\)/);
  assert.match(apiSource, /adminPinLogin: \(pin, username\) => json\('POST', '\/auth\/admin-pin', \{ pin, username \}\)/);
  assert.match(apiSource, /cashierSettings: \(\) => request\('\/settings\/cashiers'\)/);
  assert.match(apiSource, /updateCashierSettings/);
  assert.match(apiSource, /SENSITIVE_FIELD/);
  assert.match(apiSource, /\[REDACTED\]/);
});
