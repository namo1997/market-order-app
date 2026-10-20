import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { generateKeyPairSync } from 'node:crypto';
import { loadApp } from './app.mjs';
import { googleConfig, seedGoogle, googleJwksFetch } from './google.mjs';

const server = fileURLToPath(new URL('../server', import.meta.url));
const jwt = createRequire(`${server}/package.json`)('jsonwebtoken');
const client = 'synthetic-pilot.apps.googleusercontent.com';
const config = googleConfig({ GOOGLE_OAUTH_CLIENT_IDS: client,
  PILOT_GOOGLE_EMAILS: JSON.stringify([{ email: ' One@Example.test ', user_id: 1 }, { email: 'two@example.test', user_id: 2 }]) });
// Ephemeral signing material in RAM only; no credentials or saved keys.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'synthetic', alg: 'RS256', use: 'sig' };
const sign = (changes = {}) => jwt.sign({ iss: 'https://accounts.google.com', aud: client,
  sub: 'SYNTHETIC', email: 'one@example.test', email_verified: true, exp: 4102444800, ...changes },
privateKey, { algorithm: 'RS256', keyid: 'synthetic', noTimestamp: true });

// Real Express middleware and body parser without listen(), sockets or HTTP fetch.
function request(app, url, body, bearer) {
  return new Promise((resolve, reject) => {
    const req = new IncomingMessage(new Socket());
    req.method = body === undefined ? 'GET' : 'POST'; req.url = url;
    const data = body === undefined ? '' : JSON.stringify(body);
    req.headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) };
    const res = new ServerResponse(req);
    res.end = chunk => {
      try { resolve({ status: res.statusCode, body: JSON.parse(String(chunk)), headers: res.getHeaders() }); }
      catch (e) { reject(e); }
      return res;
    };
    app.handle(req, res, reject);
    req.push(data); req.push(null);
  });
}
async function harness({ enabled = true, fetchFailure = false, dbFailure = false } = {}) {
  const sql = [], accounts = new Map(); let network = 0;
  let time = Date.UTC(2026, 9, 15);
  const pool = { async query(query, params = []) {
    sql.push({ query, params });
    if (dbFailure) throw new Error('private SQL provider failure');
    if (query.startsWith('CREATE TABLE IF NOT EXISTS user_google_accounts')) return [{}];
    if (query.startsWith('INSERT INTO user_google_accounts')) {
      accounts.set(params[0], { user_id: params[1], active: 1 }); return [{}];
    }
    if (query.startsWith('SELECT user_id, active')) return [[accounts.get(params[0])].filter(Boolean)];
    if (query.startsWith('SELECT u.id')) return [[{ id: params[0], name: `SYNTHETIC ${params[0]}`,
      department_id: params[0], branch_id: params[0] }]];
    throw new Error('Unexpected SQL');
  } };
  const google = enabled ? config : googleConfig();
  const { app, source } = await loadApp(server, pool, { google, now: () => time, googleFetch: async (url, options) => {
    network++; assert.equal(url, 'https://www.googleapis.com/oauth2/v3/certs');
    assert.equal(options.redirect, 'error'); assert.ok(options.signal);
    if (fetchFailure) throw new Error('private provider failure');
    return { ok: true, headers: new Headers(), json: async () => ({ keys: [jwk] }) };
  } });
  if (!dbFailure) await seedGoogle(pool, source, google);
  return { app, sql, accounts, network: () => network, advance: ms => { time += ms; } };
}

test('Google configuration defaults closed and rejects invalid or duplicate mappings without echoing input', () => {
  for (const env of [{}, { GOOGLE_OAUTH_CLIENT_IDS: client }, { PILOT_GOOGLE_EMAILS: '[]' }]) assert.equal(googleConfig(env).enabled, false);
  assert.equal(config.accounts[0].email, 'one@example.test');
  for (const raw of ['bad-private-value', '{}', '[]', '[{"email":"one@example.test","user_id":3}]',
    '[{"email":"bad","user_id":1}]', '[{"email":"a@example.test","user_id":1},{"email":"A@example.test","user_id":2}]']) {
    assert.throws(() => googleConfig({ GOOGLE_OAUTH_CLIENT_IDS: client, PILOT_GOOGLE_EMAILS: raw }), e =>
      e.message.startsWith('Invalid pilot Google configuration') && !e.message.includes('bad-private-value'));
  }
  assert.throws(() => googleConfig({ GOOGLE_OAUTH_CLIENT_IDS: 'https://attacker.test', PILOT_GOOGLE_EMAILS: JSON.stringify(config.accounts) }));
});
test('disabled Google returns explicit 503 without DB/network and department adapter still logs in', async () => {
  const h = await harness({ enabled: false });
  assert.equal((await request(h.app, '/api/auth/google/status')).body.data.enabled, false);
  const disabled = await request(h.app, '/api/auth/google', { id_token: 'synthetic' });
  assert.equal(disabled.status, 503); assert.equal(disabled.body.code, 'GOOGLE_AUTH_NOT_CONFIGURED');
  assert.equal(h.sql.length, 0); assert.equal(h.network(), 0);
  const login = await request(h.app, '/api/auth/login', { departmentId: 2 });
  assert.equal(login.status, 200); assert.equal(login.body.data.user.branch_id, 2);
  assert.equal((await request(h.app, '/api/auth/me', undefined, login.body.data.token)).status, 200);
});
test('Google seeds placeholders and real source controller/verifier issues RAM sessions scoped to mapped SYNTHETIC users', async () => {
  const h = await harness();
  assert.equal(h.sql.filter(q => q.query.startsWith('CREATE')).length, 1);
  for (const q of h.sql.filter(q => q.query.startsWith('INSERT'))) {
    assert.equal(q.query, 'INSERT INTO user_google_accounts (email,user_id,created_by) VALUES (?,?,?)');
    assert.equal(q.params[1], q.params[2]);
  }
  assert.equal((await request(h.app, '/api/auth/google/status')).body.data.enabled, true);
  for (const id of [1, 2]) {
    const r = await request(h.app, '/api/auth/google', { id_token: sign({ email: id === 1 ? 'one@example.test' : 'two@example.test' }),
      user_id: 99, branch_id: 99, department_id: 99, role: 'admin' });
    assert.equal(r.status, 200); assert.equal(r.headers['cache-control'], 'no-store');
    const { user, token } = r.body.data;
    assert.equal(user.id, id); assert.equal(user.branch_id, id); assert.equal(user.department_id, id); assert.equal(user.role, 'user');
    const me = await request(h.app, '/api/auth/me', undefined, token);
    assert.equal(me.status, 200); assert.equal(me.body.data.branch_id, id); assert.equal(me.body.data.role, 'user');
  }
  assert.equal(h.network(), 1);
});
test('Google rejects unlisted/disabled email, forged audience, issuer, expired or unverified claims and malformed input', async () => {
  const h = await harness();
  for (const [changes, status] of [[{ email: 'unknown@example.test' }, 403], [{ aud: 'attacker' }, 401],
    [{ iss: 'https://attacker.test' }, 401], [{ exp: 1 }, 401], [{ email_verified: false }, 401]]) {
    assert.equal((await request(h.app, '/api/auth/google', { id_token: sign(changes) })).status, status);
  }
  h.accounts.get('one@example.test').active = 0;
  assert.equal((await request(h.app, '/api/auth/google', { id_token: sign() })).status, 403);
  assert.equal((await request(h.app, '/api/auth/google', {})).status, 422);
  assert.equal((await request(h.app, '/api/auth/google', { id_token: 'malformed'.repeat(4) })).status, 401);
});
test('Google and department sessions expire after eight hours with a deterministic clock', async () => {
  const h = await harness();
  const google = await request(h.app, '/api/auth/google', { id_token: sign() });
  const department = await request(h.app, '/api/auth/login', { departmentId: 2 });
  h.advance(8 * 3600_000);
  for (const login of [google, department]) {
    const r = await request(h.app, '/api/auth/me', undefined, login.body.data.token);
    assert.equal(r.status, 401); assert.equal(r.body.code, 'UNAUTHORIZED');
  }
});
test('Google parser has local size limit; source rate limiter and sanitized errors remain active', async () => {
  const h = await harness();
  assert.equal((await request(h.app, '/api/auth/google', { id_token: 'x'.repeat(25000) })).status, 413);
  for (let i = 0; i < 9; i++) assert.equal((await request(h.app, '/api/auth/google', {})).status, 422);
  const limited = await request(h.app, '/api/auth/google', {});
  assert.equal(limited.status, 429); assert.equal(limited.body.code, 'GOOGLE_LOGIN_RATE_LIMITED');
  assert.ok(Number(limited.headers['retry-after']) > 0);
  for (const options of [{ fetchFailure: true }, { dbFailure: true }]) {
    const broken = await harness(options);
    const r = await request(broken.app, '/api/auth/google', { id_token: sign() });
    assert.equal(r.status, 503); assert.equal(r.body.code, 'GOOGLE_AUTH_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(r.body), /private|SQL|stack/);
  }
  assert.throws(() => googleJwksFetch('https://attacker.test', {}), /PILOT_OUTBOUND_DISABLED/);
});
