import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionStore, sessionExpiry, SESSION_KEY } from './session.mjs';
import { createReceivingApi } from './api.mjs';

const origin = 'https://mock.test';
const now = 1800000000000;
const jwt = (exp = now / 1000 + 3600) => `fixture.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.fixture`;
const user = { id: 7, name: 'ผู้รับจำลอง', role: 'user', branch: 'A', department: 'ครัว', branch_id: 1, department_id: 10 };
const ok = data => ({ status: 200, data: { success: true, data } });
function storage() {
  const values = new Map();
  return { values, get: async ({key}) => ({value: values.get(key)}), set: async ({key,value}) => {values.set(key,value);}, remove: async ({key}) => {values.delete(key);} };
}
const store = preferences => createSessionStore(preferences, { now: () => now });
for (const method of ['login', 'loginGoogle']) {
  test(`session: ${method} survives a new API instance / force-stop simulation and validates server scope`, async () => {
    const preferences = storage(), token = jwt(), calls = [];
    const transport = async options => { calls.push(options); return ok(options.method === 'POST' ? {token, user} : {...user, department: 'อัปเดต'}); };
    const first = createReceivingApi(origin, transport, () => {}, store(preferences));
    await first[method](1);
    // New store and API: no memory is shared except the Preferences backing store.
    const reopened = createReceivingApi(origin, transport, () => {}, store(preferences));
    assert.equal((await reopened.restoreSession()).department, 'อัปเดต');
    assert.equal(calls.at(-1).url, `${origin}/api/auth/me`);
    assert.equal(calls.at(-1).headers.Authorization, `Bearer ${token}`);
    assert.equal(JSON.parse(preferences.values.get(SESSION_KEY)).user.department, 'อัปเดต');
  });
}
test('session: persists only origin, bearer and necessary user fields', async () => {
  const preferences = storage();
  await store(preferences).save(origin, jwt(), {...user, password: 'fixture-only', email: 'fixture@example.test', idToken: 'fixture-only', image: 'not-stored', nested: {}});
  const saved = JSON.parse(preferences.values.get(SESSION_KEY));
  assert.deepEqual(Object.keys(saved).sort(), ['origin','token','user']);
  assert.deepEqual(saved.user, user);
});
for (const value of [jwt(now/1000), jwt(now/1000-1), 'fixture.invalid.fixture', jwt('1800003600'), '']) {
  test(`session: expired or malformed token is removed before any network request (${value.length})`, async () => {
    const preferences = storage(), sessions = store(preferences);
    await sessions.save(origin, value, user);
    let calls = 0;
    const api = createReceivingApi(origin, async () => {calls++;}, () => {}, sessions);
    assert.equal(await api.restoreSession(), null);
    assert.equal(calls, 0); assert.equal(preferences.values.size, 0);
  });
}
test('session: origin switch and corrupt Preferences never send a saved bearer', async () => {
  const preferences = storage(), sessions = store(preferences);
  await sessions.save(origin, jwt(), user);
  assert.equal(await sessions.restore('https://other.test'), null);
  preferences.values.set(SESSION_KEY, '{bad');
  assert.equal(await sessions.restore(origin), null); assert.equal(preferences.values.size, 0);
});
test('session: unexpired offline restore retains login without replaying writes', async () => {
  const preferences = storage(), sessions = store(preferences);
  await sessions.save(origin, jwt(), user);
  const calls = [];
  const api = createReceivingApi(origin, async options => {calls.push(options); throw Error('offline');}, () => {}, sessions);
  assert.deepEqual(await api.restoreSession(), user);
  assert.equal(calls.length, 1); assert.equal(calls[0].method, 'GET'); assert.ok(preferences.values.has(SESSION_KEY));
});
for (const status of [401,403,404]) {
  test(`session: server ${status} on reopen clears saved authentication`, async () => {
    const preferences = storage(), sessions = store(preferences);
    await sessions.save(origin, jwt(), user);
    let unauthorized = 0;
    const api = createReceivingApi(origin, async () => ({status,data:{}}), () => unauthorized++, sessions);
    assert.equal(await api.restoreSession(), null); assert.equal(preferences.values.size, 0);
    assert.equal(unauthorized, status === 401 ? 1 : 0);
  });
}
test('session: 401 during use clears persistent and memory credentials; explicit logout stays logged out on reopen', async () => {
  const preferences = storage(), sessions = store(preferences); let fail = false, last;
  const api = createReceivingApi(origin, async options => {last = options; return fail ? {status:401,data:{}} : ok(options.method === 'POST' ? {token:jwt(),user} : []);}, () => {}, sessions);
  await api.login(10); fail = true; await assert.rejects(api.expected()); assert.equal(preferences.values.size, 0);
  fail = false; await api.expected(); assert.equal(last.headers.Authorization, undefined);
  await api.login(10); await api.logout();
  assert.equal(await createReceivingApi(origin, async () => {throw Error('must not request');}, () => {}, store(preferences)).restoreSession(), null);
});
test('session: logout waits for a pending save and cannot resurrect the bearer', async () => {
  const preferences = storage(); let release;
  const held = new Promise(resolve => {release=resolve;});
  const original = preferences.set;
  preferences.set = async value => {await held; await original(value);};
  const sessions = store(preferences);
  const saved = sessions.save(origin, jwt(), user); const cleared = sessions.clear();
  release(); await Promise.all([saved,cleared]); assert.equal(preferences.values.size, 0);
});
test('session: storage failure prevents reporting a remembered login as successful', async () => {
  const preferences = storage(); preferences.set = async () => {throw Error('private storage detail');};
  let last;
  const api = createReceivingApi(origin, async options => {last=options; return ok({token:jwt(),user});}, () => {}, store(preferences));
  await assert.rejects(api.login(10), error => !error.message.includes('private'));
  await api.branches(); assert.equal(last.headers.Authorization, undefined);
});
test('session: opaque and missing-exp tokens have unknown expiry; known JWT expiry is preserved', () => {
  assert.equal(sessionExpiry('00000000-0000-4000-8000-000000000007'), null);
  assert.equal(sessionExpiry('fixture.e30.fixture'), null);
  assert.equal(sessionExpiry(jwt()), now + 3600000);
});

for (const token of ['00000000-0000-4000-8000-000000000007', 'fixture.e30.fixture']) {
  test(`session: unknown expiry validates with the server on every restart (${token.includes('.') ? 'JWT without exp' : 'pilot UUID'})`, async () => {
    const preferences = storage(), calls = [];
    let status = 200;
    const transport = async options => { calls.push(options); return status === 200 ? ok(user) : { status, data: {} }; };
    await store(preferences).save(origin, token, user);
    for (let attempt = 0; attempt < 2; attempt++) {
      const api = createReceivingApi(origin, transport, () => {}, store(preferences));
      assert.deepEqual(await api.restoreSession(), user);
      assert.equal(calls.at(-1).url, `${origin}/api/auth/me`);
      assert.equal(calls.at(-1).headers.Authorization, `Bearer ${token}`);
    }
    status = 401;
    const rejected = createReceivingApi(origin, transport, () => {}, store(preferences));
    assert.equal(await rejected.restoreSession(), null);
    assert.equal(calls.length, 3);
    assert.equal(preferences.values.size, 0);
  });
}


test('session: logout while restore request is in flight cannot save the bearer again', async () => {
  const preferences = storage(), sessions = store(preferences);
  await sessions.save(origin, jwt(), user);
  let respond, started;
  const waiting = new Promise(resolve => {started=resolve;});
  const api = createReceivingApi(origin, async () => {started();return new Promise(resolve => {respond=resolve;});}, () => {}, sessions);
  const restoring = api.restoreSession(); await waiting;
  await api.logout(); respond(ok(user));
  assert.equal(await restoring, null); assert.equal(preferences.values.size,0);
});
test('session: an old unauthorized response cannot revoke a newer login', async () => {
  const preferences = storage(), sessions = store(preferences); let respond;
  const api = createReceivingApi(origin, async options => options.method === 'POST' ? ok({token:jwt(),user}) : new Promise(resolve => {respond=resolve;}), () => {throw Error('must not expire newer login');}, sessions);
  const old = api.expected(); await api.login(10);
  respond({status:401,data:{}}); await assert.rejects(old);
  assert.ok(preferences.values.has(SESSION_KEY));
});
