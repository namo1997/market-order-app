import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const data = await fs.mkdtemp(path.join(os.tmpdir(), 'lbc-operator-only-'));
const probe = net.createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const child = spawn(process.env.NODE_BINARY || 'node', ['src/server.js'], {
  cwd: root,
  env: {
    ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'test',
    CAPTURE_DATA_DIR: data, CAPTURE_DB_PATH: path.join(data, 'fictional.sqlite'),
    ADMIN_AUTH_DISABLED: '0', ADMIN_AUTH_MODE: 'operator_only',
    ADMIN_OPERATOR_NAMES: '["fictional-user","dot"]',
    ADMIN_PIN: 'fictional-disabled-pin', ADMIN_ACCESS_TOKEN: 'fictional-disabled-access-token-12345',
    ADMIN_SESSION_SECRET: 'fictional-operator-only-secret',
    AI_WORKER_ENABLED: 'false', AI_PROVIDER: 'mock', OPENAI_API_KEY: '',
    LINE_BILL_CAPTURE_CHANNEL_SECRET: 'fictional-webhook-secret',
    LINE_BILL_CAPTURE_CHANNEL_ACCESS_TOKEN: '', LINE_BILL_CAPTURE_SILENT_MODE: '1'
  }, stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
child.stdout.on('data', b => output += b);
child.stderr.on('data', b => output += b);
const base = `http://127.0.0.1:${port}`;
const request = (route, options = {}) => fetch(base + route, { redirect: 'manual', signal: AbortSignal.timeout(5000), ...options });
const choose = (operator, next = '/admin') => request('/api/auth/operator', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ operator, next })
});
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await request('/health')).ok) { ready = true; break; } } catch {}
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready, output);
  for (const route of ['/admin?view=board&month=2026-09', '/m3/search?q=fixture']) {
    const res = await request(route);
    assert.equal(res.status, 303);
    assert.equal(new URL(res.headers.get('location'), base).searchParams.get('next'), route);
  }
  const picker = await request('/auth/operator?next=%2Fm3%2Fsearch');
  assert.equal(picker.status, 200);
  const html = await picker.text();
  assert.match(html, /value="dot"/);
  assert(!html.includes('name="pin"'));
  assert.equal((await choose('unknown')).status, 400);
  assert.equal((await request('/api/admin/groups')).status, 401);
  assert.equal((await request('/api/admin/items/1/image')).status, 401);
  assert.equal((await request('/api/auth/login', { method: 'POST' })).status, 410);

  const selected = await choose('dot', '/m3/search?q=fixture');
  assert.equal(selected.status, 303);
  assert.equal(selected.headers.get('location'), '/m3/search?q=fixture');
  const cookies = selected.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  assert(cookies.every(c => c.includes('HttpOnly') && c.includes('SameSite=Lax')));
  const cookie = cookies.map(c => c.split(';')[0]).join('; ');
  assert.equal((await request('/api/admin/groups', { headers: { cookie } })).status, 200);
  assert.equal((await request('/admin', { headers: { cookie } })).status, 200);
  const sessionOnly = cookies.find(c => c.startsWith('lbc_session=')).split(';')[0];
  assert.equal((await request('/api/admin/groups', { headers: { cookie: sessionOnly } })).status, 401);
  assert.equal((await request('/api/admin/groups', { headers: { cookie: 'lbc_session=%broken; lbc_operator=%broken' } })).status, 401);
  const logout = await request('/api/auth/logout', { method: 'POST', headers: { cookie } });
  assert.equal(logout.status, 200);
  assert(logout.headers.getSetCookie().every(c => c.includes('Max-Age=0')));
  const cleared = logout.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  assert.equal((await request('/api/admin/groups', { headers: { cookie: cleared } })).status, 401);
  const external = await choose('dot', 'https://example.com');
  assert.equal(external.headers.get('location'), '/admin');
  assert.equal((await request('/api/line-bill-capture/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"events":[]}'
  })).status, 401);

  process.env.ADMIN_AUTH_MODE = 'operator_only';
  process.env.ADMIN_OPERATOR_NAMES = '["dot"]';
  process.env.ADMIN_SESSION_SECRET = 'fictional-unit-secret';
  const auth = await import('../src/auth.js');
  const headers = {};
  const req = { headers: { 'x-forwarded-proto': 'https' } };
  const res = { setHeader: (k, v) => headers[k] = v, append: (k, v) => headers[k] += '; ' + v };
  auth.setSessionCookie(req, res);
  auth.setOperatorCookie(req, res, 'dot');
  assert(headers['Set-Cookie'].includes('Secure'));
  assert.equal(auth.checkPin(req, 'fictional-disabled-pin'), false);
  assert.equal(auth.checkAccessToken('fictional-disabled-access-token-12345'), false);
  assert.equal(auth.checkAdminOperator('dot'), true);
  console.log('Operator-only HTTP/session/dot/deep-link/logout/webhook regressions passed (fictional DB).');
} finally {
  const stopped = once(child, 'exit');
  if (child.exitCode === null) { child.kill('SIGTERM'); await stopped; }
}
