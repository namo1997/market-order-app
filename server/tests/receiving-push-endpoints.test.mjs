import test from 'node:test';
import {expressRequest} from './helpers/express-request.mjs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import express from 'express';
import * as push from '../src/services/receiving-push.js';
import * as errors from '../src/services/receiving-ocr.service.js';

test('push endpoints: real Express auth 401, registration/revoke 200, validation 422/413, role 403, detail branch 404, safe 500', async () => {
  let role = 'accounting', fail = false;
  const token = 'synthetic-registration-for-http-tests';
  const context = vm.createContext({ console }); const retained = [];
  const synth = values => {
    const mod = new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
    retained.push(mod); return mod;
  };
  const db = { async query(sql, args) {
    if (fail) throw Object.assign(Error(`SQL ${token}`), { sql: token });
    if (sql.includes('SELECT u.id')) return [[{ id: 7, role, branch_id: 1 }]];
    if (sql.startsWith('SELECT id,supplier_name')) {
      assert.match(sql, /WHERE id=\? AND branch_id=\?/); assert.equal(args[1], 1);
      return [args[0] === 9 ? [{ id: 9, status: 'open', branch_id: 1, pending_items_json: '[]', note: 'ตามของ' }] : []];
    }
    return [{}];
  } };
  const auth = new vm.SourceTextModule(await readFile(new URL('../src/middleware/auth.js', import.meta.url), 'utf8'), { context });
  await auth.link(() => synth({ verifyToken: value => {
    if (value !== 'synthetic-valid-session') throw Error('invalid/expired'); return { id: 7, role: 'user', branch_id: 999 };
  } })); await auth.evaluate();
  const routes = new vm.SourceTextModule(await readFile(new URL('../src/routes/receiving-push.routes.js', import.meta.url), 'utf8'), { context });
  await routes.link(name => {
    if (name === 'express') return synth({ default: express });
    if (name.endsWith('/database.js')) return synth({ default: db });
    if (name.endsWith('/auth.js')) return auth;
    if (name.endsWith('/receiving-push.js')) return synth(push);
    if (name.endsWith('/receiving-push-schema.js')) return synth({ ensurePushTables: async () => {} });
    if (name.endsWith('/receiving-fcm.js')) return synth({ createFcm: () => ({ configured: () => false }) });
    if (name.endsWith('/receiving-ocr.service.js')) return synth(errors);
    throw Error(name);
  }); await routes.evaluate();
  const app = express(); app.use('/api/receiving-push', routes.namespace.default);
  const root = '/api/receiving-push';
  async function call(path, method = 'GET', body, authorization = 'Bearer synthetic-valid-session') {
    const res = await expressRequest(app, root + path, { method, headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
      body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const data = await res.json(); return { status: res.status, data, cache: res.headers.get('cache-control') };
  }
  for (const [path, method] of [['/capabilities', 'GET'], ['/devices', 'POST'], ['/devices', 'DELETE'], ['/followups/9', 'GET']]) {
    for (const authValue of [null, 'Bearer invalid', 'Bearer expired']) assert.equal((await call(path, method, method === 'GET' ? undefined : '{broken', authValue)).status, 401);
  }
  assert.equal((await call('/capabilities')).data.data.fcm, false);
  for (const method of ['POST', 'DELETE']) assert.equal((await call('/devices', method, { token, user_id: 999, branch_id: 999 })).status, 200);
  assert.equal((await call('/devices', 'POST', { token: 'short' })).status, 422);
  assert.equal((await call('/devices', 'POST', '{malformed')).status, 422);
  assert.equal((await call('/devices', 'POST', { token: 'x'.repeat(9000) })).status, 413);
  const detail = await call('/followups/9'); assert.equal(detail.status, 200); assert.equal(detail.data.data.id, 9); assert.match(detail.cache, /no-store/);
  assert.equal((await call('/followups/10')).status, 404, 'other branch and missing IDs indistinguishable');
  assert.equal((await call('/followups/nope')).status, 422);
  role = 'user';
  for (const path of ['/capabilities', '/followups/9']) assert.equal((await call(path)).status, 403);
  for (const method of ['POST', 'DELETE']) assert.equal((await call('/devices', method, { token })).status, 403);
  role = 'admin'; assert.equal((await call('/followups/10')).status, 404, 'admin push detail restricted to own branch');
  fail = true; const failure = await call('/devices', 'POST', { token });
  assert.equal(failure.status, 500); assert.doesNotMatch(JSON.stringify(failure.data), /SQL|synthetic-registration|stack/);
});
