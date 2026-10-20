import test from 'node:test';
import assert from 'node:assert/strict';
import { createFcm } from '../src/services/receiving-fcm.js';
import { currentPushUser, registerDevice, createPushDispatcher, tokenHash } from '../src/services/receiving-push.js';
import { PUSH_DDL, ensurePushTables } from '../src/models/receiving-push-schema.js';
import { listFollowups, updateFollowup } from '../src/models/receiving-followups-store.js';

const token = 'synthetic-device-token-for-unit-tests';
const user = { id: 7, role: 'accounting', branch_id: 1 };
test('push registration: binds authenticated user, token rotation/reassignment, idempotent delete, bounded validation and 403', async () => {
  const devices = new Map();
  const db = { async query(sql, args) {
    if (sql.startsWith('INSERT')) { devices.set(args[0], { token: args[1], user_id: args[2] }); }
    else if (devices.get(args[0])?.user_id === args[1]) devices.delete(args[0]);
    return [{}];
  } };
  for (let i = 0; i < 2; i++) assert.deepEqual(await registerDevice(db, user, token), { registered: true });
  assert.equal(devices.size, 1); assert.equal(devices.get(tokenHash(token)).user_id, 7);
  await registerDevice(db, { ...user, id: 8 }, token); assert.equal(devices.size, 1);
  await registerDevice(db, user, token, true); assert.equal(devices.size, 1, 'another user cannot unregister token');
  await registerDevice(db, { ...user, id: 8 }, token, true);
  await registerDevice(db, { ...user, id: 8 }, token, true); assert.equal(devices.size, 0);
  await registerDevice(db, user, token + '-rotated'); assert.equal(devices.size, 1);
  for (const invalid of ['', 'short', 'x'.repeat(4097), 'a'.repeat(30) + '\n'])
    await assert.rejects(registerDevice(db, user, invalid), e => e.statusCode === 422);
  await assert.rejects(registerDevice(db, { ...user, role: 'user' }, token), e => e.statusCode === 403);
});
test('push recipient role and branch come from active DB user, never client body', async () => {
  let rows = [user];
  const db = { async query(sql, args) {
    assert.match(sql, /u.is_active=true/); assert.match(sql, /d.is_active=true/); assert.match(sql, /b.is_active=true/);
    assert.deepEqual(args, [7]); return [rows];
  } };
  assert.deepEqual(await currentPushUser(db, 7), user);
  rows = []; await assert.rejects(currentPushUser(db, 7), e => e.statusCode === 403);
  rows = [{ ...user, role: 'user' }]; await assert.rejects(currentPushUser(db, 7), e => e.statusCode === 403);
});

function dispatcherDb() {
  const state = { jobs: [{ id: 9, branch_id: 1, user_id: 7, token, token_hash: tokenHash(token) }], rows: new Map(), valid: true, queries: [], removed: false };
  const db = { async query(sql, args = []) {
    state.queries.push({ sql, args });
    if (sql.startsWith('SELECT f.id,f.branch_id')) {
      assert.match(sql, /d.branch_id=f.branch_id/); assert.match(sql, /u.is_active=true/);
      assert.match(sql, /f.status='open'/); assert.match(sql, /INTERVAL 30 DAY/);
      assert.deepEqual(args, ['admin', 'super_admin', 'accounting', 'accountant']);
      return [state.jobs];
    }
    const key = sql.startsWith('UPDATE receiving_push_deliveries SET state=?') ? `${args[1]}:${args[2]}` : `${args[0]}:${args[1]}`;
    if (sql.startsWith('INSERT IGNORE')) { if (!state.rows.has(key)) state.rows.set(key, { state: 'pending', attempts: 0, ready: true }); return [{}]; }
    if (sql.includes("SET state='sending'")) {
      const row = state.rows.get(key);
      if (!['pending', 'sending'].includes(row.state) || row.attempts >= 3 || !row.ready) return [{ affectedRows: 0 }];
      row.state = 'sending'; row.attempts++; row.ready = false; return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('SELECT f.id FROM')) {
      assert.match(sql, /p.user_id=\?/); assert.match(sql, /d.branch_id=f.branch_id/);
      assert.match(sql, /b.is_active=true/);
      return [state.valid ? [{ id: 9 }] : []];
    }
    if (sql.startsWith('UPDATE receiving_push_deliveries SET state=?')) { state.rows.get(key).state = args[0]; return [{}]; }
    if (sql.startsWith('DELETE')) { state.removed = true; return [{}]; }
    throw Error(`Unmocked SQL ${sql}`);
  } };
  return { db, state };
}
test('push dispatch: manual/overdue IDs data-only, same-branch role filter, durable dedupe across replicas/restart', async () => {
  const { db, state } = dispatcherDb(); let sends = 0, discoveries = 0;
  const args = { db, discoverOverdue: async () => discoveries++, fcm: { configured: () => true, send: async (recipient, data) => {
    sends++; assert.equal(recipient, token);
    assert.deepEqual(data, { kind: 'followup', followup_id: '9', user_id: '7', branch_id: '1', channel: 'receiving_urgent_question003_v1' });
    return { sent: true };
  } } };
  await Promise.all([createPushDispatcher(args).tick(), createPushDispatcher(args).tick()]);
  await createPushDispatcher(args).tick();
  assert.equal(sends, 1); assert.equal(discoveries, 3);
  assert.equal([...state.rows.values()][0].state, 'sent');
});
test('push retry: persistent bounded attempts, lease wait, unregistered removal, role/ownership change prevents send', async () => {
  for (const result of [{ retry: true }, { invalid: true }, { sent: true }]) {
    const { db, state } = dispatcherDb(); let sends = 0;
    const dispatcher = createPushDispatcher({ db, fcm: { configured: () => true, send: async () => { sends++; return result; } } });
    await dispatcher.tick(); await dispatcher.tick(); assert.equal(sends, 1, 'lease blocks immediate retry');
    for (let i = 0; i < 5; i++) { [...state.rows.values()][0].ready = true; await dispatcher.tick(); }
    assert.equal(sends, result.retry ? 3 : 1); assert.equal(state.removed, Boolean(result.invalid));
  }
  const { db, state } = dispatcherDb(); state.valid = false;
  await createPushDispatcher({ db, fcm: { configured: () => true, send: () => { throw Error('must not send'); } } }).tick();
  assert.equal([...state.rows.values()][0].state, 'failed');
});
test('push without config: no credentials read, network, send or outbox queries; overdue discovery still runs', async () => {
  const fail = () => { throw Error('must stay offline'); };
  const fcm = createFcm({ env: {}, read: fail, fetcher: fail });
  assert.equal(fcm.configured(), false); assert.deepEqual(await fcm.send(token, {}), { disabled: true });
  let discoveries = 0;
  await createPushDispatcher({ db: { query: fail }, fcm, discoverOverdue: async () => discoveries++ }).tick();
  assert.equal(discoveries, 1);
});
test('FCM HTTP: mocked OAuth caching, data-only high priority, timeout, retry, unregistered and redacted failures', async () => {
  for (const status of [200, 401, 429, 500, 400, 404]) {
    let oauth = 0, sends = 0;
    const fcm = createFcm({ env: { RECEIVING_FCM_SERVICE_ACCOUNT_FILE: '/owner-provided-outside-git' },
      now: () => 1000000, sign: () => 'synthetic-signature', read: async () => JSON.stringify({ project_id: 'synthetic-project', client_email: 'fixture@example.invalid', private_key: 'synthetic-placeholder' }),
      fetcher: async (url, options) => {
        assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
        if (url.includes('oauth2')) { oauth++; return { ok: true, json: async () => ({ access_token: 'synthetic-access', expires_in: 3600 }) }; }
        sends++; const body = JSON.parse(options.body);
        assert.equal(body.message.token, token); assert.equal(body.message.notification, undefined);
        assert.equal(body.message.android.priority, 'high'); assert.equal(body.message.android.ttl, '86400s');
        return { ok: status === 200, status, json: async () => ({ error: { message: token, details: [{ errorCode: status === 404 ? 'UNREGISTERED' : 'OTHER' }] } }) };
      } });
    const result = await fcm.send(token, { kind: 'followup' });
    assert.doesNotMatch(JSON.stringify(result), /synthetic-device-token/);
    if (status === 200) assert.equal(result.sent, true);
    else { assert.equal(result.invalid, status === 404); assert.equal(result.retry, [401, 429, 500].includes(status)); }
    await fcm.send(token, {}); assert.equal(sends, 2); assert.equal(oauth, status === 401 ? 2 : 1);
  }
  const fcm = createFcm({ env: { RECEIVING_FCM_SERVICE_ACCOUNT_FILE: '/owner' }, read: async () => { throw Error(token); } });
  assert.deepEqual(await fcm.send(token, {}), { retry: true });
});
test('FCM transport timeouts and malformed provider JSON are bounded and redacted', async () => {
  for (const brokenJson of [false, true]) {
    let requests = 0;
    const fcm = createFcm({ env: { RECEIVING_FCM_SERVICE_ACCOUNT_FILE: '/synthetic-owner-path' },
      sign: () => 'synthetic-signature',
      read: async () => JSON.stringify({ project_id: 'synthetic-project', client_email: 'fixture@example.invalid', private_key: 'synthetic-placeholder' }),
      fetcher: async (url, options) => {
        requests++;
        assert.ok(options.signal instanceof AbortSignal);
        assert.equal(options.redirect, 'error');
        if (!brokenJson) throw new DOMException(token, 'TimeoutError');
        return { ok: true, json: async () => { throw new SyntaxError(token); } };
      } });
    assert.deepEqual(await fcm.send(token, { kind: 'followup' }), { retry: true });
    assert.equal(requests, 1, 'one attempt per dispatcher lease; never an unbounded network loop');
  }
});

test('push additive schema is idempotent with indexes and production opt-in', async () => {
  const calls = []; const db = { query: async sql => calls.push(sql) };
  await ensurePushTables(db, { NODE_ENV: 'production' }); assert.equal(calls.length, 0);
  await ensurePushTables(db, {}); await ensurePushTables(db, {});
  assert.equal(calls.length, PUSH_DDL.length * 2);
  for (const sql of PUSH_DDL) { assert.match(sql, /^CREATE TABLE IF NOT EXISTS/); assert.match(sql, /PRIMARY KEY/); assert.match(sql, /INDEX/); }
});
test('accounting inbox list/count/update are branch scoped; absent branch fails closed', async () => {
  const calls = [];
  const db = { async query(sql, args) {
    calls.push(sql); assert.match(sql, /AND branch_id = \?/); assert.equal(args.at(-1), 1);
    return [sql.includes('COUNT') ? [{ pending_count: 0 }] : []];
  }, async getConnection() { return { query: db.query, beginTransaction: async () => {}, rollback: async () => {}, release() {} }; } };
  assert.deepEqual((await listFollowups(db, { user })).items, []);
  await assert.rejects(updateFollowup(db, { user, id: 9, status: 'resolved' }), e => e.statusCode === 404);
  assert.equal(calls.length, 3);
  await assert.rejects(listFollowups(db, { user: { ...user, branch_id: null } }), e => e.statusCode === 403);
});
