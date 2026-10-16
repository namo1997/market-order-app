import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createNativeGoogleAuth } from './google-auth.mjs';
import { createReceivingApi } from './api.mjs';

test('native Google uses build web client ID, ID token and clears provider credentials', async () => {
  const calls = [];
  const auth = createNativeGoogleAuth({ clientId: ' web.test ', isNative: () => true, plugin: {
    async initialize(value) { calls.push(['initialize', value]); },
    async login(value) { calls.push(['login', value]); return { result: { idToken: 'mock-google-id' } }; },
    async logout(value) { calls.push(['logout', value]); },
  } });
  assert.equal(await auth.signIn(), 'mock-google-id'); await auth.signIn(); await auth.signOut();
  assert.deepEqual(calls[0][1], { google: { webClientId: 'web.test', mode: 'online' } });
  assert.equal(calls.filter(c => c[0] === 'initialize').length, 1);
  assert.equal(calls.filter(c => c[0] === 'logout').length, 3);
  assert.equal(calls[1][1].options.autoSelectEnabled, false);
});
test('native Google missing configuration and web runtime fail before provider call', async () => {
  for (const [clientId, native] of [['', true], ['web.test', false]]) {
    const auth = createNativeGoogleAuth({ clientId, isNative: () => native, plugin: {} });
    await assert.rejects(auth.signIn());
  }
});
test('native cancel/malformed result hides provider details and clears credentials', async () => {
  for (const login of [async () => { throw new Error('private provider token'); }, async () => ({ result: {} })]) {
    let cleared = 0;
    const auth = createNativeGoogleAuth({ clientId: 'web.test', isNative: () => true,
      plugin: { initialize: async () => {}, login, logout: async () => cleared++ } });
    await assert.rejects(auth.signIn(), error => !/private|token/.test(error.message)); assert.equal(cleared, 1);
  }
});
test('native exchange uses /auth/google and server-mapped scope with in-memory bearer', async () => {
  const calls = [], user = { id: 7, department_id: 4, branch_id: 3 };
  const api = createReceivingApi('https://example.test', async options => { calls.push(options);
    return { status: 200, data: { success: true, data: options.method === 'POST' ? { token: 'mock-session', user } : [] } };
  });
  assert.deepEqual(await api.loginGoogle('mock-google-id'), user); await api.expected();
  assert.equal(calls[0].url, 'https://example.test/api/auth/google');
  assert.deepEqual(calls[0].data, { id_token: 'mock-google-id' });
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(calls[1].headers.Authorization, 'Bearer mock-session');
  api.logout(); await api.expected(); assert.equal(calls.at(-1).headers.Authorization, undefined);
});
test('native Google UI remains a separate build branch and Android configuration suppresses credential logs in both variants', async () => {
  const read = path => readFile(new URL(path, import.meta.url), 'utf8');
  const app = await read('./ReceivingApp.jsx');
  assert.match(app, /ใช้บัญชี Google ที่ผู้ดูแลเพิ่มสิทธิ์ให้/); assert.match(app, /api\.loginGoogle/);
  assert.doesNotMatch(app, /api\.login\(|api\.branches\(|api\.departments\(/);
  assert.match(app, /const pilot = import\.meta\.env\.VITE_RECEIVING_AUTH_MODE === 'pilot'/);
  assert.match(app, /!user && \(pilot \? <PilotLogin/);
  assert.equal((app.match(/>ทดลองภายใน</g) || []).length, 1);
  assert.match(app, /รุ่น 0\.6\.3-debug \(12\)/);
  const gradle = await read('../../android/app/build.gradle');
  for (const variant of ['debug', 'release']) assert.match(gradle, new RegExp(variant + ' \\{[^}]*minifyEnabled true'));
  assert.match(gradle, /debuggable false/);
  assert.match(await read('../../android/app/proguard-rules.pro'), /assumenosideeffects class android\.util\.Log/);
  const activity = await read('../../android/app/src/main/java/th/co/solao/receiving/MainActivity.java');
  assert.match(activity, /implements ModifiedMainActivityForSocialLoginPlugin/);
  assert.match(activity, /handleGoogleLoginIntent\(requestCode, data\)/);
  assert.equal(JSON.parse(await read('../../capacitor.config.json')).loggingBehavior, 'none');
});
