import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read, makePngDataUrl, createReceivingHarness } from './helpers/receiving-fake-db.mjs';

const owner = { id: 12, name: 'ผู้รับทดสอบ', role: 'user', branch_id: 1, department_id: 10 };
const setup = async () => {
  const logs = [];
  const h = await createReceivingHarness({ logCalls: logs });
  const created = await h.invoke('createDocument', { user: owner, body: {
    client_uuid: 'signature-read-fixture', delivery_date: h.today, kind: 'manual_receipt'
  } });
  assert.equal(created.statusCode, 201);
  return { h, logs, id: String(created.body.data.id) };
};

test('Signature read: both roles return exact PNG bytes, private no-store, no logs or mutations in every status', async () => {
  const { h, id, logs } = await setup();
  const images = { receiver: makePngDataUrl(300, 100), courier: makePngDataUrl(400, 120) };
  for (const [role, image_data_url] of Object.entries(images)) {
    const saved = await h.invoke('addSignature', { user: owner, params: { id }, body: { role, image_data_url } });
    assert.equal(saved.statusCode, 200);
  }
  for (const status of ['draft', 'confirmed', 'void']) {
    h.state.documents[0].status = status;
    const before = structuredClone(h.state);
    for (const role of ['receiver', 'courier']) {
      const res = await h.invoke('getSignatureBinary', { user: owner, params: { id, role } });
      const expected = Buffer.from(images[role].split(',')[1], 'base64');
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.binaryBody, expected);
      assert.equal(res.body, undefined);
      assert.equal(res.headers['content-type'], 'image/png');
      assert.equal(res.headers['content-length'], String(expected.length));
      assert.equal(res.headers['cache-control'], 'private, no-store');
    }
    assert.deepEqual(structuredClone(h.state), before);
  }
  assert.deepEqual(logs, []);
});

test('Signature read: cross-branch AND same-branch cross-department return 403 for both roles; admin exceptions match images', async () => {
  const { h, id, logs } = await setup();
  for (const role of ['receiver', 'courier']) {
    await h.invoke('addSignature', { user: owner, params: { id }, body: { role, image_data_url: makePngDataUrl() } });
    for (const foreign of [{ branch_id: 2, department_id: 20 }, { branch_id: 1, department_id: 30 }]) {
      const res = await h.invoke('getSignatureBinary', { user: { ...owner, ...foreign }, params: { id, role } });
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.code, 'FORBIDDEN');
      assert.equal(res.binaryBody, undefined);
    }
    for (const adminRole of ['admin', 'super_admin']) {
      const res = await h.invoke('getSignatureBinary', {
        user: { ...owner, role: adminRole, branch_id: 2, department_id: 20 }, params: { id, role }
      });
      assert.equal(res.statusCode, 200);
      assert.ok(res.binaryBody.length);
    }
  }
  assert.deepEqual(logs, []);
});

test('Signature read: absent document/signature return 404; invalid role/id return 422 with no binary or logs', async () => {
  const { h, id, logs } = await setup();
  h.state.documents[0].courier_signature = Buffer.alloc(0);
  for (const [params, status, code] of [
    [{ id, role: 'receiver' }, 404, 'NOT_FOUND'],
    [{ id, role: 'courier' }, 404, 'NOT_FOUND'],
    [{ id: '99999', role: 'receiver' }, 404, 'NOT_FOUND'],
    [{ id, role: 'receiver_signature FROM users' }, 422, 'VALIDATION_FAILED'],
    [{ id: '1 OR 1=1', role: 'receiver' }, 422, 'VALIDATION_FAILED'],
  ]) {
    const res = await h.invoke('getSignatureBinary', { user: owner, params });
    assert.equal(res.statusCode, status);
    assert.equal(res.body.code, code);
    assert.equal(res.binaryBody, undefined);
    assert.equal(res.headers['cache-control'], 'private, no-store');
    assert.deepEqual(Object.keys(res.body).sort(), ['code', 'message', 'success']);
  }
  assert.deepEqual(logs, []);
});

test('Signature read route: real auth middleware blocks missing, invalid and expired credentials with 401 before handler', async () => {
  const context = vm.createContext({});
  const synthetic = values => new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, { context });
  const auth = new vm.SourceTextModule(await read('../src/middleware/auth.js'), { context });
  await auth.link(() => synthetic({ verifyToken: () => { throw new Error('Invalid or expired fixture'); } }));
  await auth.evaluate();
  const middleware = [];
  const routes = [];
  const router = { use: fn => middleware.push(fn) };
  for (const method of ['get', 'post', 'put', 'delete']) router[method] = (path, handler) => routes.push({ method, path, handler });
  let invoked = 0;
  const handler = () => { invoked++; };
  const module = new vm.SourceTextModule(await read('../src/routes/receiving-documents.routes.js'), { context });
  await module.link(name => name === 'express'
    ? synthetic({ default: { Router: () => router, json: () => (_req, _res, next) => next() } })
    : name.endsWith('/auth.js') ? auth : synthetic({ getSignatureBinary: handler }));
  await module.evaluate();
  const route = routes.find(item => item.method === 'get' && item.path === '/:id/signatures/:role');
  assert.equal(route.handler, handler);
  assert.equal(middleware[0], auth.namespace.authenticate);
  for (const role of ['receiver', 'courier']) {
    for (const headers of [{}, { authorization: 'Bearer invalid-fixture' }, { authorization: 'Bearer expired-fixture' }]) {
      let status;
      let body;
      middleware[0]({ headers, params: { id: '1', role } }, {
        status(code) { status = code; return this; }, json(value) { body = value; }
      }, route.handler);
      assert.equal(status, 401);
      assert.equal(body.success, false);
    }
  }
  assert.equal(invoked, 0);
});
