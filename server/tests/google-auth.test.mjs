import test from 'node:test';
import {expressRequest} from './helpers/express-request.mjs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createGoogleIdTokenVerifier, normalizeGoogleEmail } from '../src/services/google-id-token.js';
import { createGoogleAccountsStore } from '../src/models/google-accounts.model.js';
import { createGoogleAuthHandlers, googleLoginRateLimit } from '../src/controllers/google-auth.controller.js';
import { runGoogleAccounts } from '../scripts/google-accounts.mjs';

// Ephemeral test keypair: no saved private keys, real credentials or Google API.
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'mock-google', alg: 'RS256', use: 'sig' };
const epoch = 1800000000;
const claims = { iss: 'https://accounts.google.com', aud: 'web.test', sub: 'test-user',
  exp: epoch + 3600, iat: epoch, email: ' Staff@Gmail.com ', email_verified: true };
const sign = (overrides = {}, key = privateKey, header = {}) => jwt.sign(Object.fromEntries(
  Object.entries({ ...claims, ...overrides }).filter(([, value]) => value !== undefined)), key,
  { algorithm: 'RS256', keyid: 'mock-google', header });
function verifier(options = {}) {
  return createGoogleIdTokenVerifier({ now: () => epoch * 1000, clientIds: () => ' web.test, android.test ',
    fetcher: async (url, init) => {
      assert.equal(url, 'https://www.googleapis.com/oauth2/v3/certs');
      assert.equal(init.redirect, 'error'); assert.ok(init.signal);
      return { ok: true, headers: new Headers({ 'cache-control': 'max-age=300' }), json: async () => ({ keys: [jwk] }) };
    }, ...options });
}
test('Google signature/JWKS validates both audiences, issuers and lowercases verified email', async () => {
  const verify = verifier();
  for (const aud of ['web.test', 'android.test']) for (const iss of ['accounts.google.com', 'https://accounts.google.com']) {
    assert.deepEqual(await verify(sign({ aud, iss })), { email: 'staff@gmail.com', sub: 'test-user' });
  }
});
for (const [name, change] of Object.entries({ 'wrong aud': { aud: 'other.test' }, expired: { exp: epoch },
  'future nbf': { nbf: epoch + 1 }, 'wrong iss': { iss: 'https://attacker.test' },
  'email_verified false': { email_verified: false }, 'email_verified string': { email_verified: 'true' },
  'missing exp': { exp: undefined }, 'missing sub': { sub: undefined }, 'invalid email': { email: 'bad' } })) {
  test(`Google rejects ${name}`, async () => {
    await assert.rejects(verifier()(sign(change)), e => e.status === 401 && e.code === 'INVALID_GOOGLE_TOKEN');
  });
}
test('Google rejects wrong signature, unknown kid, algorithm confusion and malformed tokens', async () => {
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  for (const value of [sign({}, other), sign({}, privateKey, { kid: 'unknown' }),
    jwt.sign(claims, crypto.randomBytes(32), { algorithm: 'HS256', keyid: 'mock-google' }), 'x'.repeat(30)]) {
    await assert.rejects(verifier()(value), e => e.status === 401);
  }
  for (const value of [undefined, {}, 'x'.repeat(16385)]) await assert.rejects(verifier()(value), e => e.status === 422);
});
test('Google disabled configuration, timeout and malformed JWKS fail safely', async () => {
  await assert.rejects(verifier({ clientIds: () => '' })(sign()), e => e.code === 'GOOGLE_AUTH_NOT_CONFIGURED');
  for (const fetcher of [async () => { throw new DOMException('timeout private', 'TimeoutError'); },
    async () => ({ ok: false }), async () => ({ ok: true, json: async () => { throw new Error('bad JSON'); } })]) {
    await assert.rejects(verifier({ fetcher })(sign()), e => e.status === 503 && !e.message.includes('private'));
  }
});
test('JWKS cached/coalesced and unknown kids throttled; key rotation after cooldown', async () => {
  let time = epoch * 1000, calls = 0, current = jwk;
  const verify = verifier({ now: () => time, fetcher: async () => { calls++;
    return { ok: true, headers: new Headers({ 'cache-control': 'max-age=300' }), json: async () => ({ keys: [current] }) };
  } });
  await Promise.all([verify(sign()), verify(sign())]); assert.equal(calls, 1);
  for (let i = 0; i < 3; i++) await assert.rejects(verify(sign({}, privateKey, { kid: 'new' })));
  assert.equal(calls, 1);
  time += 31000; current = { ...jwk, kid: 'new' };
  await verify(sign({}, privateKey, { kid: 'new' })); assert.equal(calls, 2);
});

function fakeDb() {
  const rows = new Map(), sql = [];
  const db = { async query(query, params = []) {
    sql.push([query, params]);
    if (query.startsWith('CREATE')) return [{}];
    if (query.startsWith('SELECT id, department_id')) return [params[0] === 7 ? [{ id: 7, department_id: 4 }] : []];
    if (query.startsWith('SELECT user_id')) return [[rows.get(params[0])].filter(Boolean)];
    if (query.startsWith('SELECT g.')) return [[...rows].map(([email, row]) => ({ email, ...row }))];
    if (query.startsWith('INSERT')) {
      if (rows.has(params[0])) throw Object.assign(new Error('SQL private'), { code: 'ER_DUP_ENTRY' });
      rows.set(params[0], { user_id: params[1], active: 1 }); return [{ affectedRows: 1 }];
    }
    if (query.startsWith('UPDATE')) { rows.get(params[0]).active = 0; return [{ affectedRows: 1 }]; }
    throw new Error('Unexpected SQL');
  } };
  return { db, rows, sql };
}
test('allowlist schema is additive, idempotent, indexed and has both user foreign keys', async () => {
  const { db, sql } = fakeDb(), store = createGoogleAccountsStore(db);
  await Promise.all([store.ensure(), store.ensure()]); await store.ensure();
  assert.equal(sql.length, 1);
  for (const pattern of [/CREATE TABLE IF NOT EXISTS/, /email VARCHAR\(254\).*UNIQUE/, /REFERENCES users\(id\)/,
    /FOREIGN KEY \(created_by\)/, /INDEX idx_google_accounts_user/, /updated_at TIMESTAMP/]) assert.match(sql[0][0], pattern);
  assert.doesNotMatch(sql[0][0], /ALTER TABLE|DROP TABLE/);
});
test('allowlist normalized uniqueness, validation, 404/409, disable idempotency and placeholders', async () => {
  const { db, sql } = fakeDb(), store = createGoogleAccountsStore(db);
  await store.add({ email: ' STAFF@GMAIL.COM ', user_id: 7, department_id: 4, created_by: 1 });
  assert.equal((await store.find('staff@gmail.com')).user_id, 7);
  await assert.rejects(store.add({ email: 'staff@gmail.com', user_id: 7, created_by: 1 }), e => e.status === 409);
  await assert.rejects(store.add({ email: 'new@gmail.com', user_id: 8, created_by: 1 }), e => e.status === 404);
  await assert.rejects(store.add({ email: 'new@gmail.com', user_id: 7, department_id: 8, created_by: 1 }), e => e.status === 422);
  await assert.rejects(store.add({ email: 'bad', user_id: 7, created_by: 1 }), e => e.status === 422);
  for (const user_id of [true, [7], {}, '7 OR 1=1', 7.5, -1]) {
    await assert.rejects(store.add({ email: 'new@gmail.com', user_id, created_by: 1 }), e => e.status === 422);
  }
  await assert.rejects(store.disable('missing@gmail.com'), e => e.status === 404);
  await store.disable('staff@gmail.com'); await store.disable('staff@gmail.com');
  assert.equal((await store.find('staff@gmail.com')).active, 0);
  const injection = "x'OR'1'='1@gmail.com";
  await store.find(injection);
  assert.equal(sql.at(-1)[1][0], injection.toLowerCase()); assert.ok(!sql.at(-1)[0].includes(injection.toLowerCase()));
  assert.equal((await store.list()).length, 1);
  assert.throws(() => normalizeGoogleEmail({}), e => e.status === 422);
});

async function routeHarness() {
  const { db, rows } = fakeDb(), store = createGoogleAccountsStore(db);
  rows.set('staff@gmail.com', { user_id: 7, active: 1 });
  const sessionKey = crypto.randomBytes(32), generated = [];
  let active = true, fail = false;
  const user = { id: 7, role: 'user', branch_id: 3, department_id: 4, allowed_product_group_ids: [9] };
  const verifyToken = token => jwt.verify(token, sessionKey, { clockTimestamp: epoch });
  const context = vm.createContext({});
  const synthetic = values => new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, { context });
  const auth = new vm.SourceTextModule(await readFile(new URL('../src/middleware/auth.js', import.meta.url), 'utf8'), { context });
  await auth.link(() => synthetic({ verifyToken })); await auth.evaluate();
  const handlers = createGoogleAuthHandlers({ verify: verifier(), store,
    getUserById: async id => { assert.equal(id, 7); if (fail) throw new Error('SQL secret stack'); return active ? user : null; },
    buildUserPayload: async value => value,
    generateToken: payload => { generated.push(payload); return jwt.sign({ ...payload, iat: epoch, exp: epoch + 300 }, sessionKey); },
  });
  // Evaluate the actual route wiring with isolated production adapters.
  const routes = new vm.SourceTextModule(await readFile(new URL('../src/routes/google-auth.routes.js', import.meta.url), 'utf8'), { context });
  await routes.link(specifier => {
    if (specifier === 'express') return synthetic({ default: express });
    if (specifier.endsWith('/auth.js')) return auth;
    if (specifier.endsWith('google-auth.controller.js')) return synthetic({ createGoogleAuthHandlers: () => handlers, googleLoginRateLimit });
    if (specifier.endsWith('google-accounts.model.js')) return synthetic({ createGoogleAccountsStore: () => store });
    if (specifier.endsWith('google-id-token.js')) return synthetic({ createGoogleIdTokenVerifier: () => verifier() });
    if (specifier.endsWith('database.js')) return synthetic({ default: db });
    if (specifier.endsWith('user.model.js')) return synthetic({ getUserById: () => {} });
    if (specifier.endsWith('auth.controller.js')) return synthetic({ buildUserPayload: () => {} });
    if (specifier.endsWith('jwt.js')) return synthetic({ generateToken: () => {} });
    throw new Error('Unexpected import ' + specifier);
  });
  await routes.evaluate();
  const app = express(); app.use(express.json({ limit: '24kb' })); app.use('/api/auth', routes.namespace.default);
  return { rows, generated, user, setActive: value => { active = value; }, setFail: () => { fail = true; },
    close: async () => {},
    async request(path, body, role) {
      const authToken = role === 'invalid' ? 'invalid' : role === 'expired'
        ? jwt.sign({ id: 1, role: 'admin', exp: 1 }, sessionKey) : role ? jwt.sign({ id: 1, role, iat: epoch, exp: epoch + 300 }, sessionKey) : null;
      const response = await expressRequest(app, `/api/auth${path}`, {
        method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, cache: response.headers.get('cache-control'), data: await response.json() };
    },
  };
}
test('POST /google succeeds with mapped scope only, rejects unlisted/disabled/inactive user and hides failures', async () => {
  const h = await routeHarness();
  try {
    const result = await h.request('/google', { id_token: sign(), user_id: 999, role: 'admin', branch_id: 99 });
    assert.equal(result.status, 200); assert.equal(result.cache, 'no-store');
    assert.equal(result.data.data.user.id, 7); assert.equal(h.generated[0].role, 'user'); assert.equal(h.generated[0].branch_id, 3);
    for (const change of [{ email: 'other@gmail.com' }, {}]) {
      if (!change.email) h.rows.get('staff@gmail.com').active = 0;
      const r = await h.request('/google', { id_token: sign(change) });
      assert.equal(r.status, 403); assert.equal(r.data.code, 'GOOGLE_ACCOUNT_NOT_ALLOWED');
    }
    h.rows.get('staff@gmail.com').active = 1; h.setActive(false);
    assert.equal((await h.request('/google', { id_token: sign() })).status, 403);
    h.setActive(true); h.setFail();
    const failed = await h.request('/google', { id_token: sign() });
    assert.equal(failed.status, 503); assert.doesNotMatch(JSON.stringify(failed.data), /SQL|secret|stack|eyJ/);
    assert.equal((await h.request('/google', {})).status, 422);
    assert.equal((await h.request('/google', { id_token: sign({ aud: 'bad' }) })).status, 401);
  } finally { await h.close(); }
});
test('all allowlist admin endpoints enforce missing/invalid/expired 401 and non-admin 403', async () => {
  const h = await routeHarness();
  try {
    for (const [path, body] of [['/google-accounts', undefined], ['/google-accounts', {}], ['/google-accounts/disable', {}]]) {
      for (const role of [undefined, 'invalid', 'expired']) assert.equal((await h.request(path, body, role)).status, 401);
      assert.equal((await h.request(path, body, 'user')).status, 403);
    }
    for (const role of ['admin', 'super_admin']) assert.equal((await h.request('/google-accounts', undefined, role)).status, 200);
    assert.equal((await h.request('/google-accounts', { email: 'second@gmail.com', user_id: 7, department_id: 4, created_by: 999 }, 'admin')).status, 201);
    assert.equal((await h.request('/google-accounts', { email: 'second@gmail.com', user_id: 7 }, 'admin')).status, 409);
    assert.equal((await h.request('/google-accounts', { email: 'third@gmail.com', user_id: 8 }, 'admin')).status, 404);
    assert.equal((await h.request('/google-accounts', {}, 'admin')).status, 422);
    assert.equal((await h.request('/google-accounts/disable', { email: 'second@gmail.com' }, 'admin')).status, 200);
    assert.equal((await h.request('/google-accounts/disable', { email: 'missing@gmail.com' }, 'admin')).status, 404);
    assert.equal((await h.request('/google-accounts/disable', {}, 'admin')).status, 422);
  } finally { await h.close(); }
});
test('IP rate limit is deterministic, ignores forwarded spoofing, expires and caps memory', () => {
  let time = 0, nextCount = 0, status;
  const limit = googleLoginRateLimit({ now: () => time, max: 2, maxKeys: 1 });
  const res = { set() {}, status(v) { status = v; return this; }, json() {} };
  const req = { ip: '127.0.0.1', headers: { 'x-forwarded-for': 'spoof' } };
  limit(req, res, () => nextCount++); limit(req, res, () => nextCount++); limit(req, res, () => nextCount++);
  assert.equal(status, 429); assert.equal(nextCount, 2);
  limit({ ip: 'other' }, res, () => nextCount++); assert.equal(nextCount, 2);
  time = 60000; limit(req, res, () => nextCount++); assert.equal(nextCount, 3);
});
test('local CLI refuses remote/production DB before connecting and closes the local connection', async () => {
  for (const env of [{ DB_HOST: 'remote.test' }, { DB_HOST: '127.0.0.1', NODE_ENV: 'production' }, {}]) {
    await assert.rejects(runGoogleAccounts(['list'], env, () => { throw new Error('must not connect'); }), /Local only/);
  }
  let ended = 0;
  const { db } = fakeDb(); db.end = async () => ended++;
  await runGoogleAccounts(['list'], { DB_HOST: '127.0.0.1' }, async () => db); assert.equal(ended, 1);
});
