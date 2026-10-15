import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceivingApi } from '../src/receiving-app/api.mjs';
import { createTransport } from '../src/receiving-app/transport.mjs';
import { createImageCapture } from '../src/receiving-app/camera.mjs';
import client, { setApiClient } from '../src/receiving-app/client.mjs';

const ok = data => ({ status: 200, data: { success: true, data } });
test('native bridge forwards shared endpoint queries, payloads, auth, OCR timeout and binary envelope', async () => {
  const calls = [];
  const image = new Blob(['jpeg'], { type: 'image/jpeg' });
  const api = createReceivingApi('https://example.test', async options => {
    calls.push(options);
    if (options.url.endsWith('/auth/login')) return ok({ token: 'mock-session', user: { id: 1 } });
    return options.responseType === 'blob' ? { status: 200, data: image } : ok({ id: 7 });
  });
  await api.login(2); setApiClient(api.client);
  assert.deepEqual(await client.get('/receiving-documents', { params: { date: '2026-10-15', branch_id: 3, department_id: 4 } }), { data: { success: true, data: { id: 7 } } });
  await client.post('/receiving-documents/7/ocr', {}, { timeout: 70000 });
  const body = { lines: [{ quantity_received: '0.30' }] };
  await client.put('/receiving-documents/7', body);
  assert.equal((await client.get('/receiving-documents/7/images/9', { responseType: 'blob' })).data, image);
  assert.match(calls[1].url, /date=2026-10-15&branch_id=3&department_id=4$/);
  assert.equal(calls[2].readTimeout, 70000);
  assert.equal(calls[3].data, body);
  assert.equal(calls[3].method, 'PUT');
  for (const call of calls.slice(1)) assert.equal(call.headers.Authorization, 'Bearer mock-session');
});
for (const status of [401, 403, 404, 409, 422, 429, 503]) {
  test(`native bridge preserves shared UI HTTP ${status} recovery without retry or internal details`, async () => {
    let calls = 0;
    const api = createReceivingApi('https://example.test', async () => { calls++; return { status, data: { code: 'NOT_DRAFT', message: 'SQL stack internals' } }; });
    await assert.rejects(api.client.post('/receiving-documents/7/confirm', {}), error => {
      assert.equal(error.response.status, status); assert.equal(error.response.data.code, 'NOT_DRAFT');
      assert.doesNotMatch(error.message, /SQL|stack|internals/); return true;
    });
    assert.equal(calls, 1);
  });
}
test('native timeout is uncertain to shared UI and never automatically retries confirm', async () => {
  let calls = 0;
  const api = createReceivingApi('https://example.test', async () => { calls++; throw Error('private native error'); });
  await assert.rejects(api.client.post('/receiving-documents/7/confirm', {}), error => {
    assert.ok(error.request); assert.equal(error.response, undefined); return true;
  });
  assert.equal(calls, 1);
});
test('native transport decodes authenticated base64 image into exact bytes and forwards redirects/timeouts', async () => {
  let options;
  const transport = createTransport({ isNative: () => true, nativeRequest: async value => {
    options = value; return { status: 200, headers: { 'Content-Type': 'image/png' }, data: 'AAH+/w==' };
  } });
  const response = await transport({ url: 'https://example.test/api/receiving-documents/7/images/9', method: 'GET', responseType: 'blob', headers: { Authorization: 'Bearer mock-session' }, readTimeout: 15000, disableRedirects: true });
  assert.equal(options.responseType, 'arraybuffer'); assert.equal(options.disableRedirects, true);
  assert.equal(options.readTimeout, 15000); assert.equal(options.headers.Authorization, 'Bearer mock-session');
  assert.equal(response.data.type, 'image/png'); assert.deepEqual([...new Uint8Array(await response.data.arrayBuffer())], [0, 1, 254, 255]);
});
test('web transport uses private blob fetch and the requested OCR timeout', async () => {
  const calls = [];
  const transport = createTransport({ isNative: () => false, fetchImpl: async (url, options) => {
    calls.push({ url, options }); return { status: 200, ok: true, blob: async () => new Blob(['private']), json: async () => ({ success: true, data: {} }) };
  } });
  const image = await transport({ url: 'https://example.test/image', method: 'GET', readTimeout: 15000, responseType: 'blob' });
  assert.equal(await image.data.text(), 'private');
  await transport({ url: 'https://example.test/ocr', method: 'POST', data: {}, readTimeout: 70000 });
  assert.equal(calls[0].options.credentials, 'omit'); assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[1].options.body, '{}'); assert.ok(calls[1].options.signal);
});
test('native binary error remains a server status rather than being decoded as an image', async () => {
  const transport = createTransport({ isNative: () => true, nativeRequest: async () => ({ status: 403, data: { code: 'FORBIDDEN' } }) });
  const api = createReceivingApi('https://example.test', transport);
  await assert.rejects(api.client.get('/receiving-documents/7/images/9', { responseType: 'blob' }), error => error.response.status === 403);
});
test('camera web fallback never invokes native permissions', () => {
  assert.equal(createImageCapture({ isNative: () => false, camera: {} }), null);
});
test('camera returns a file for the existing compression/upload pipeline without gallery persistence', async () => {
  const calls = [];
  const capture = createImageCapture({ isNative: () => true, camera: {
    requestPermissions: async options => { calls.push(options); return { camera: 'granted' }; },
    getPhoto: async options => { calls.push(options); return { webPath: 'blob:mock-photo', format: 'jpeg' }; },
  }, fetchImpl: async path => { assert.equal(path, 'blob:mock-photo'); return { ok: true, blob: async () => new Blob(['mock-photo'], { type: 'image/jpeg' }) }; } });
  const file = await capture();
  assert.equal(file.name, 'bill.jpeg'); assert.equal(file.type, 'image/jpeg'); assert.equal(file.size, 10);
  assert.deepEqual(calls[0], { permissions: ['camera'] });
  assert.equal(calls[1].source, 'CAMERA'); assert.equal(calls[1].resultType, 'uri');
  assert.equal(calls[1].saveToGallery, false); assert.equal(calls[1].correctOrientation, true);
});
test('camera cancellation is quiet, permission denial and native failure are safe and retryable', async () => {
  for (const message of ['User cancelled photos app', 'User canceled']) {
    const capture = createImageCapture({ isNative: () => true, camera: {
      requestPermissions: async () => ({ camera: 'granted' }), getPhoto: async () => { throw Error(message); },
    } });
    assert.equal(await capture(), null);
  }
  const denied = createImageCapture({ isNative: () => true, camera: { requestPermissions: async () => ({ camera: 'denied' }) } });
  await assert.rejects(denied(), /อนุญาต/);
  const failed = createImageCapture({ isNative: () => true, camera: { requestPermissions: async () => { throw Error('private native stack'); } } });
  await assert.rejects(failed(), /เปิดกล้องไม่สำเร็จ/);
});
