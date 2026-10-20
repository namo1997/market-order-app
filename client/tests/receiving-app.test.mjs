import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBase, bangkokDate, createReceivingApi } from '../src/receiving-app/api.mjs';

const ok = data => ({ status: 200, data: { success: true, data } });
test('API URL defaults empty and normalizes server origin', () => {
  assert.equal(normalizeBase(''), '');
  assert.equal(normalizeBase(' http://192.168.1.10:3000/ '), 'http://192.168.1.10:3000');
  assert.equal(normalizeBase('https://example.test/'), 'https://example.test');
});
for (const url of ['not a url', 'file:///etc/passwd', 'javascript:alert(1)', 'https://name:pass@example.test', 'https://example.test/api', 'https://example.test/?a=1', 'https://example.test/#x']) {
  test(`reject unsafe or non-origin URL: ${url.split(':')[0]} case ${url.length}`, () => assert.throws(() => normalizeBase(url)));
}
test('Bangkok date changes at 17:00 UTC independently of host timezone', () => {
  assert.equal(bangkokDate(new Date('2026-10-15T16:59:59Z')), '2026-10-15');
  assert.equal(bangkokDate(new Date('2026-10-15T17:00:00Z')), '2026-10-16');
});
test('empty base never performs a request', async () => {
  let calls = 0;
  const api = createReceivingApi('', async () => { calls++; });
  await assert.rejects(api.branches(), /ตั้งค่า/);
  assert.equal(calls, 0);
});
test('existing department login and expected contract with logout', async () => {
  const calls = [];
  const user = { id: 1, branch: 'จำลอง', department: 'ครัว' };
  const api = createReceivingApi('http://127.0.0.1:3000', async options => {
    calls.push(options);
    if (options.method === 'POST') return ok({ token: 'mock-session', user });
    return ok([]);
  });
  await api.branches();
  await api.departments('1/2');
  assert.equal(await api.login(2), user);
  await api.expected();
  assert.equal(calls[0].url, 'http://127.0.0.1:3000/api/auth/branches');
  assert.equal(calls[1].url, 'http://127.0.0.1:3000/api/auth/departments/1%2F2');
  assert.deepEqual(calls[2].data, { departmentId: 2 });
  assert.match(calls[3].url, /\/api\/receiving-documents\/expected\?date=\d{4}-\d{2}-\d{2}$/);
  assert.equal(calls[3].headers.Authorization, 'Bearer mock-session');
  assert.equal(calls[3].readTimeout, 15000);
  assert.equal(calls[3].disableRedirects, true);
  assert.equal(calls[3].connectTimeout, 15000);
  api.logout();
  await api.branches();
  assert.equal(calls.at(-1).headers.Authorization, undefined);
});
for (const status of [401, 403, 404, 409, 422, 503]) {
  test(`HTTP ${status} produces safe error without exposing server internals`, async () => {
    const api = createReceivingApi('https://example.test', async () => ({ status,
      data: { success: false, code: 'EXPECTED_ERROR', message: 'SQL stack private internals' } }));
    await assert.rejects(api.expected(), error => {
      assert.equal(error.status, status);
      assert.equal(error.code, 'EXPECTED_ERROR');
      assert.doesNotMatch(error.message, /SQL|stack|private/);
      return true;
    });
  });
}
test('401 expires memory session and triggers login again', async () => {
  let expired = 0;
  let fail = false;
  let last;
  const api = createReceivingApi('https://example.test', async options => {
    last = options;
    if (options.method === 'POST') return ok({ token: 'mock-session', user: { id: 1 } });
    return fail ? { status: 401, data: {} } : ok([]);
  }, () => expired++);
  await api.login(1);
  fail = true;
  await assert.rejects(api.expected());
  assert.equal(expired, 1);
  fail = false;
  await api.branches();
  assert.equal(last.headers.Authorization, undefined);
});
test('malformed JSON envelope, connection failure and invalid login fail safely', async () => {
  for (const transport of [async () => ({ status: 200, data: '<html>' }), async () => { throw new Error('private transport detail'); }]) {
    await assert.rejects(createReceivingApi('https://example.test', transport).branches(), /เชื่อมต่อไม่สำเร็จ/);
  }
  await assert.rejects(createReceivingApi('https://example.test', async () => ok({ user: {} })).login(1));
});
