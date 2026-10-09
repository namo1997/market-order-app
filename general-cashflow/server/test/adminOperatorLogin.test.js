import assert from 'node:assert/strict';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import { config } from '../src/config.js';
import { loginAdminWithPin } from '../src/auth.js';

test('new Admin operators require the existing PIN and retain distinct, active identities', async (t) => {
  const users = new Map();
  const calls = [];
  const fakePool = {
    async query(sql, values) {
      calls.push({ sql, values });
      const username = values[0];
      if (sql.startsWith('SELECT')) return [[...(users.has(username) ? [users.get(username)] : [])]];
      assert.match(sql, /INSERT INTO users/);
      assert.equal(values[3], 'admin');
      users.set(username, { id: users.size + 1, username, full_name: values[2], role: values[3], is_active: 1 });
      return [{ affectedRows: 1 }];
    }
  };
  t.mock.method(mysql, 'createPool', () => fakePool);
  const originalPin = config.seed.adminPin;
  config.seed.adminPin = '123456';
  t.after(() => { config.seed.adminPin = originalPin; });

  for (const [username, fullName] of [['admin_pen', 'เพ็ญ'], ['admin_jum', 'จุ๋ม']]) {
    const before = calls.length;
    for (const pin of ['', '12345', '654321']) {
      assert.equal(await loginAdminWithPin({ username, pin }), null);
    }
    assert.equal(calls.length, before, 'invalid PIN must not query or create a user');
    const result = await loginAdminWithPin({ username, pin: '123456' });
    assert.equal(result.user.username, username);
    assert.equal(result.user.full_name, fullName);
    const claims = jwt.verify(result.token, config.jwt.secret);
    assert.equal(claims.username, username);
    assert.equal(claims.full_name, fullName);
    assert.equal(claims.role, 'admin');
    assert.equal(claims.pin, undefined);
    const repeated = await loginAdminWithPin({ username, pin: '123456' });
    assert.equal(repeated.user.id, result.user.id);
    users.get(username).is_active = 0;
    assert.equal(await loginAdminWithPin({ username, pin: '123456' }), null);
    users.get(username).is_active = 1;
    users.get(username).role = 'cashier';
    assert.equal(await loginAdminWithPin({ username, pin: '123456' }), null);
  }
  assert.notEqual(users.get('admin_pen').id, users.get('admin_jum').id);
  const beforeUnknown = calls.length;
  assert.equal(await loginAdminWithPin({ username: 'admin_unknown', pin: '123456' }), null);
  assert.equal(calls.length, beforeUnknown);
  assert.equal(calls.filter(({ sql }) => sql.includes('INSERT INTO users')).length, 2);
});
