// Run only against a newly created socket-only disposable SSD instance.
import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { createGoogleAccountsStore } from '../src/models/google-accounts.model.js';

test('real disposable MySQL: Google schema twice, unique email, FK, mapping and disable', async () => {
  const socket = process.env.GOOGLE_AUTH_IT_SOCKET;
  assert.match(socket || '', /^\/Volumes\/SSD Files\/SOLAO\/market-order-system\/runs\/receiving-google-login\/mysql\/m\.sock$/);
  const db = await mysql.createConnection({ socketPath: socket, user: 'root' });
  try {
    const [[identity]] = await db.query('SELECT @@datadir AS datadir, @@skip_networking AS no_network');
    assert.equal(identity.datadir.replace(/\/$/, ''), socket.replace(/\/m\.sock$/, '/data'));
    assert.equal(Number(identity.no_network), 1);
    await db.query('CREATE DATABASE IF NOT EXISTS google_auth_it');
    await db.query('USE google_auth_it');
    await db.query('CREATE TABLE departments (id INT PRIMARY KEY, branch_id INT NOT NULL) ENGINE=InnoDB');
    await db.query('CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(100), department_id INT, is_active BOOLEAN) ENGINE=InnoDB');
    await db.query('INSERT INTO departments (id, branch_id) VALUES (4, 3)');
    await db.query("INSERT INTO users (id, name, department_id, is_active) VALUES (1, 'admin fixture', 4, TRUE), (7, 'staff fixture', 4, TRUE)");
    const store = createGoogleAccountsStore(db);
    await store.ensure(); await createGoogleAccountsStore(db).ensure();
    await store.add({ email: ' STAFF@GMAIL.COM ', user_id: 7, created_by: 1, department_id: 4 });
    assert.equal((await store.find('staff@gmail.com')).user_id, 7);
    await assert.rejects(store.add({ email: 'staff@gmail.com', user_id: 7, created_by: 1 }), e => e.status === 409);
    await assert.rejects(db.query('INSERT INTO user_google_accounts (email, user_id, created_by) VALUES (?, ?, ?)',
      ['foreign@gmail.com', 999, 1]), e => e.code === 'ER_NO_REFERENCED_ROW_2');
    const listed = await store.list();
    assert.equal(listed.length, 1); assert.equal(listed[0].department_id, 4); assert.equal(listed[0].branch_id, 3);
    assert.equal(listed[0].created_by, 1);
    await store.disable('STAFF@gmail.com'); await store.disable('staff@gmail.com');
    assert.equal(Number((await store.find('staff@gmail.com')).active), 0);
  } finally { await db.end(); }
});
