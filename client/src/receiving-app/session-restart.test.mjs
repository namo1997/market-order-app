import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from '../../tests/receiving-harness.mjs';
import { SESSION_KEY } from './session.mjs';

const base = 'http://127.0.0.1:8841';
const token = '00000000-0000-4000-8000-000000000007'; // Synthetic pilot UUID, never a real credential.
const user = { id: 1, name: 'ผู้รับจำลอง', role: 'user', branch_id: 1, department_id: 1, branch: 'สาขาจำลอง', department: 'ครัว' };
const ok = data => ({ status: 200, data: { success: true, data } });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function pilot() {
  let valid = false, available = true, clock = 1800000000000, expires;
  return {
    restart() { valid = false; },
    expire() { clock += 8 * 3600_000; },
    available(value) { available = value; },
    async request(options) {
      if (!available) return { status: 503, data: { success: false } };
      const path = new URL(options.url).pathname;
      if (path === '/api/auth/branches') return ok([{ id: 1, name: user.branch }]);
      if (path === '/api/auth/departments/1') return ok([{ id: 1, name: user.department }]);
      if (path === '/api/auth/login') {
        assert.equal(options.method, 'POST');
        assert.equal(options.data.departmentId, 1);
        valid = true; expires = clock + 8 * 3600_000;
        return ok({ token, user });
      }
      assert.equal(path, '/api/auth/me');
      assert.equal(options.headers.Authorization, `Bearer ${token}`);
      return valid && clock < expires ? ok(user) : { status: 401, data: { success: false, code: 'UNAUTHORIZED' } };
    },
  };
}

// Each call bundles/mounts the real ReceivingApp + PilotLogin + API + store anew.
// Only native surfaces and the receiving page are mocked. Preferences alone persist.
async function open(preferences, server, { validation, saving } = {}) {
  const requests = [], pages = [];
  const document = { documentElement: { dataset: {}, classList: { add() {} } }, querySelector: () => ({}) };
  const window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    MutationObserver: class { observe() {} disconnect() {} } };
  const shell = {
    Preferences: {
      get: async ({ key }) => ({ value: preferences.get(key) }),
      set: async ({ key, value }) => {
        if (key === SESSION_KEY && saving) { saving.entered = true; await saving.promise; }
        preferences.set(key, value);
      },
      remove: async ({ key }) => { preferences.delete(key); },
    },
    Network: { getStatus: async () => ({ connected: true }), addListener: async () => ({ remove() {} }) },
    Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => false },
    CapacitorHttp: { request: async options => {
      requests.push(options);
      if (options.url.endsWith('/auth/me') && validation) await validation.promise;
      return server.request(options);
    } },
    alerts: {}, signInGoogle: async () => { throw Error('pilot must not use Google'); }, signOutGoogle: async () => {},
    exitReceivingApp: async () => {}, setBackHandlerReady: async () => {}, setSystemTheme: async () => {},
    page: props => { pages.push(props); },
  };
  const h = await harness('ReceivingApp', {}, {}, {}, window,
    { __shell: shell, document, URLSearchParams,
      fetch: () => { throw Error('Must use mocked native transport'); } }, null, '../src/receiving-app/ReceivingApp.jsx');
  return { ...h, requests, pages, client: () => shell.client };
}
const hasLogin = h => h.all().some(node => node.type === 'h2' && h.text(node) === 'เข้าใช้งาน');
async function login(h) {
  assert.equal(hasLogin(h), true);
  await h.click(user.branch); await h.click(user.department);
  return h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
}

test('pilot process restart: branch/department login waits for save; UUID restores before login can render', async () => {
  const preferences = new Map([['receiving.apiBaseUrl', `${base}/`]]), server = pilot(), saving = deferred();
  const first = await open(preferences, server, { saving });
  await first.click(user.branch); await first.click(user.department);
  const submitting = first.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  await first.settle(); assert.equal(saving.entered, true);
  assert.equal(preferences.has(SESSION_KEY), false);
  assert.equal(first.pages.length, 0);
  saving.resolve(); await submitting; await first.settle();
  const saved = JSON.parse(preferences.get(SESSION_KEY));
  assert.equal(saved.origin, base); assert.equal(saved.token, token);
  assert.deepEqual(saved.user, user);
  assert.ok(first.pages.length > 0); assert.equal(hasLogin(first), false);
  first.unmount();

  for (let restart = 0; restart < 2; restart++) {
    const validation = deferred(), reopened = await open(preferences, server, { validation });
    assert.match(reopened.text(reopened.all()), /กำลังเปิดแอป/);
    assert.equal(hasLogin(reopened), false); assert.equal(reopened.pages.length, 0);
    assert.deepEqual(reopened.requests.map(request => new URL(request.url).pathname), ['/api/auth/me']);
    validation.resolve(); await reopened.settle();
    assert.equal(hasLogin(reopened), false); assert.ok(reopened.pages.length > 0); assert.ok(reopened.client());
    assert.match(reopened.text(reopened.all()), /สาขาจำลอง \/ ครัว/);
    // A transient login render would mount PilotLogin and request /branches.
    assert.equal(reopened.requests.length, 1);
    reopened.unmount();
  }
});

for (const reason of ['restart', 'expire']) {
  test(`pilot ${reason}: server 401 revokes UUID session and correctly renders login`, async () => {
    const preferences = new Map([['receiving.apiBaseUrl', base]]), server = pilot();
    const first = await open(preferences, server); await login(first); await first.settle(); first.unmount();
    server[reason]();
    const reopened = await open(preferences, server);
    assert.equal(reopened.requests[0].url, `${base}/api/auth/me`);
    assert.equal(hasLogin(reopened), true); assert.equal(preferences.has(SESSION_KEY), false);
    assert.equal(reopened.pages.length, 0); assert.equal(reopened.client(), null);
    reopened.unmount();
  });
}

test('pilot unavailable: 503 keeps saved UUID; next restart validates with the original server', async () => {
  const preferences = new Map([['receiving.apiBaseUrl', base]]), server = pilot();
  const first = await open(preferences, server); await login(first); await first.settle(); first.unmount();
  server.available(false);
  const unavailable = await open(preferences, server);
  assert.equal(preferences.has(SESSION_KEY), true); assert.equal(hasLogin(unavailable), false);
  unavailable.unmount(); server.available(true);
  const recovered = await open(preferences, server);
  assert.equal(hasLogin(recovered), false); assert.ok(recovered.pages.length > 0);
  assert.equal(recovered.requests.length, 1); recovered.unmount();
});
