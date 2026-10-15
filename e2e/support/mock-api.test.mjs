// Validate the route harness without a browser. These are NOT server or UI tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockAPI, DATE, LINE, ocrDocument } from './mock-api.mjs';

async function harness(doc = null) {
  let handler;
  const api = await mockAPI({ route: async (pattern, callback) => { assert.equal(pattern, '**/*'); handler = callback; } }, 'http://127.0.0.1:43000', doc);
  const request = async (method, pathname, body) => {
    let response;
    await handler({
      request: () => ({ url: () => pathname.startsWith('http') ? pathname : `http://127.0.0.1:43000${pathname}`,
        method: () => method, postData: () => body ? JSON.stringify(body) : null, postDataJSON: () => body }),
      fulfill: async value => { response = value; }, abort: async reason => { response = { aborted: reason }; },
      continue: async () => { response = { continued: true }; },
    });
    return response;
  };
  return { api, request };
}
const base = '/api/receiving-documents';
const create = { client_uuid: '00000000-0000-4000-8000-000000000501', delivery_date: DATE, kind: 'bill' };

test('mock contract: auth, expected, create, images, OCR, PUT decimal normalization, signatures, confirm and void', async () => {
  const { api, request } = await harness();
  for (const url of ['/api/auth/branches', '/api/auth/departments/71', '/api/auth/me', '/api/auth/line/super-admin/status']) assert.equal((await request('GET', url)).status, 200);
  assert.equal((await request('POST', '/api/auth/login', { departmentId: 72 })).json.success, true);
  assert.equal((await request('GET', `${base}/expected?date=${DATE}`)).json.data[0].items[0].quantity_ordered, '2.5');
  assert.equal((await request('POST', base, create)).json.data.status, 'draft');
  assert.deepEqual((await request('GET', `${base}?date=${DATE}`)).json.data[0].lines, undefined);
  assert.equal((await request('GET', `${base}/501`)).json.data.id, 501);
  assert.equal((await request('POST', `${base}/501/images`, { page_no: 1, image_data_url: 'data:image/jpeg;base64,/9j/2Q==' })).json.data.image_id, 601);
  assert.equal((await request('GET', `${base}/501/images/601`)).contentType, 'image/jpeg');
  assert.equal((await request('POST', `${base}/501/ocr`)).json.data.total, '392.00');
  assert.equal((await request('PUT', `${base}/501`, { lines: [{ ...LINE, quantity_received: '2.50', quantity_billed: '2.50' }], deleted_line_ids: [] })).json.data.lines[0].quantity_received, '2.5');
  assert.equal((await request('POST', `${base}/501/confirm`)).json.code, 'SIGNATURE_REQUIRED');
  await request('POST', `${base}/501/signatures`, { role: 'receiver', image_data_url: 'data:image/png;base64,eA==' });
  await request('POST', `${base}/501/signatures`, { role: 'courier', name: 'ผู้ส่งทดสอบ', image_data_url: 'data:image/png;base64,eA==' });
  assert.equal((await request('POST', `${base}/501/confirm`)).json.data.status, 'confirmed');
  assert.equal((await request('POST', `${base}/501/confirm`)).json.code, 'NOT_DRAFT');
  assert.equal((await request('POST', `${base}/501/void`, { reason: ' ' })).status, 422);
  assert.equal((await request('POST', `${base}/501/void`, { reason: 'ทดสอบ' })).json.data.status, 'void');
  assert.equal((await request('POST', `${base}/501/void`, { reason: 'ทดสอบซ้ำ' })).status, 409);
  assert.deepEqual(api.unexpected, []);
});

test('mock contract: lost create response and concurrent duplicate client_uuid return a single document', async () => {
  const { api, request } = await harness();
  api.failNext('POST', base, 0, '', { abort: true, commit: true });
  assert.equal((await request('POST', base, create)).aborted, 'internetdisconnected');
  const docs = await Promise.all([request('POST', base, create), request('POST', base, create)]);
  assert.deepEqual(docs.map(result => result.json.data.id), [501, 501]);
});

test('mock contract: deterministic gates expose in-flight mutation before completing', async () => {
  const { api, request } = await harness(ocrDocument({ has_receiver_signature: true }));
  const release = api.pauseNext('POST', '/confirm');
  const pending = request('POST', `${base}/501/confirm`);
  await api.waitFor('POST', '/confirm'); assert.equal(api.doc.status, 'draft');
  release(); assert.equal((await pending).json.data.status, 'confirmed');
});

test('mock contract: requested HTTP 401/403/404/409/422/429/503 errors use exact error envelopes', async () => {
  const { api, request } = await harness(ocrDocument());
  for (const [status, code] of [[401, 'UNAUTHORIZED'], [403, 'FORBIDDEN'], [404, 'NOT_FOUND'], [409, 'NOT_DRAFT'], [422, 'VALIDATION_FAILED'], [429, 'RATE_LIMITED'], [503, 'OCR_UNAVAILABLE']]) {
    api.failNext('POST', '/ocr', status, code);
    const result = await request('POST', `${base}/501/ocr`);
    assert.equal(result.status, status); assert.equal(result.json.success, false); assert.equal(result.json.code, code);
  }
});

test('mock contract: unknown API fails closed, external origins blocked, static origin allowed', async () => {
  const { api, request } = await harness();
  assert.equal((await request('GET', '/api/unknown')).status, 500);
  assert.equal((await request('GET', 'https://example.invalid/resource')).aborted, 'blockedbyclient');
  assert.equal((await request('GET', '/assets/client.js')).continued, true);
  assert.equal(api.unexpected.length, 1); assert.equal(api.blocked.length, 1);
});

test('mock contract: missing document is 404 and seeded binary image remains mocked', async () => {
  const missing = await harness(); assert.equal((await missing.request('GET', `${base}/501`)).status, 404);
  const seeded = await harness(ocrDocument());
  const image = await seeded.request('GET', `${base}/501/images/601`);
  assert.equal(image.status, 200); assert.equal(image.body.subarray(0, 4).toString('hex'), '89504e47');
});
