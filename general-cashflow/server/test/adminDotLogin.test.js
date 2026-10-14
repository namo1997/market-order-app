import assert from 'node:assert/strict';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import { config } from '../src/config.js';
import { loginAdminWithPin } from '../src/auth.js';

// Isolated DB fixture: no network, no Production credentials or writes.
test('only dot bypasses PIN, creates its own Admin identity, and respects disabled accounts', async () => {
  const originalCreatePool = mysql.createPool;
  const originalPin = config.seed.adminPin;
  let user = null;
  let queries = 0;
  let inserts = 0;
  mysql.createPool = () => ({ query: async (sql, params) => {
    queries++;
    if (sql.startsWith('INSERT')) {
      inserts++;
      user = { id: 42, username: params[0], full_name: params[2], role: params[3], is_active: 1 };
      return [{ affectedRows: 1 }];
    }
    return [user ? [user] : []];
  }});
  config.seed.adminPin = '123456';
  try {
    for (const username of ['admin_sa', 'admin_mo', 'admin_ja', 'admin_pen', 'admin_jum', 'unknown', undefined]) {
      assert.equal(await loginAdminWithPin({ username, pin: '' }), null);
    }
    assert.equal(queries, 0, 'unauthorized requests must never access the DB');
    const result = await loginAdminWithPin({ username: 'admin_dot', pin: '' });
    assert.equal(result.user.username, 'admin_dot');
    assert.equal(result.user.full_name, 'dot');
    assert.equal(result.user.role, 'admin');
    assert.equal(jwt.verify(result.token, config.jwt.secret).username, 'admin_dot');
    assert.equal(inserts, 1);
    await loginAdminWithPin({ username: 'admin_dot', pin: '' });
    assert.equal(inserts, 1, 'repeat login must not create duplicates');
    user.is_active = 0;
    assert.equal(await loginAdminWithPin({ username: 'admin_dot', pin: '' }), null);
    user.is_active = 1;
    user.role = 'cashier';
    assert.equal(await loginAdminWithPin({ username: 'admin_dot', pin: '' }), null);
    user = { id: 43, username: 'admin_sa', full_name: 'สา', role: 'admin', is_active: 1 };
    assert.equal(await loginAdminWithPin({ username: 'admin_sa', pin: '000000' }), null);
    assert.equal((await loginAdminWithPin({ username: 'admin_sa', pin: '123456' })).user.username, 'admin_sa');
    config.seed.adminPin = '';
    assert.equal(await loginAdminWithPin({ username: 'admin_sa', pin: '' }), null);
  } finally {
    mysql.createPool = originalCreatePool;
    config.seed.adminPin = originalPin;
  }
});
