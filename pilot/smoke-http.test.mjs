import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestJson, uploadAndVerifyImage } from './smoke-http.mjs';

const bytes = Buffer.from([255, 216, 255, 217]);
function responses({ status = 201, data = { image_id: 17 }, binary = bytes, type = 'image/jpeg' } = {}) {
  const calls = [];
  return { calls, fetcher: async (url, options) => {
    calls.push({ url, options });
    return options.method === 'POST' ? new Response(JSON.stringify({ success: true, data }), { status })
      : new Response(binary, { headers: { 'content-type': type } });
  } };
}
test('smoke reproduces old default-200 failure on a valid upload 201 response', async () => {
  await assert.rejects(requestJson('http://pilot', 'POST', '/images', {}, 'synthetic-session', 200,
    responses().fetcher), /HTTP 201, expected 200/);
});
test('smoke upload accepts exactly 201, reads data.image_id and verifies authenticated binary bytes', async () => {
  const mock = responses();
  assert.equal(await uploadAndVerifyImage('http://pilot', '/documents/9/images', bytes, 'synthetic-session', mock.fetcher), 17);
  assert.deepEqual(mock.calls.map(c => c.url), ['http://pilot/documents/9/images', 'http://pilot/documents/9/images/17']);
  for (const { options } of mock.calls) {
    assert.equal(options.headers.Authorization, 'Bearer synthetic-session');
    assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
  }
  assert.equal(JSON.parse(mock.calls[0].options.body).image_data_url, `data:image/jpeg;base64,${bytes.toString('base64')}`);
});
test('smoke retains strict assertions for wrong status, missing image ID, wrong MIME or corrupted binary', async () => {
  for (const change of [{ status: 200 }, { data: {} }, { type: 'application/json' }, { binary: Buffer.from('corrupt') }]) {
    await assert.rejects(uploadAndVerifyImage('http://pilot', '/images', bytes, 'synthetic-session', responses(change).fetcher));
  }
});
