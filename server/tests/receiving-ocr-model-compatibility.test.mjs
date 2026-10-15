import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBillWithVision, getOcrModelParameters } from '../src/services/receiving-ocr-provider.js';

const images = [{ page_no: 1, image_data_url: 'data:image/jpeg;base64,/9j/2Q==' }];
const success = () => ({ ok: true, json: async () => ({
  choices: [{ finish_reason: 'stop', message: { content: '{"lines":[]}' } }]
}) });
const failure = (status, error) => ({ ok: false, status, json: async () => ({ error }) });
const run = (fetchImpl, extra = {}) => extractBillWithVision({
  images, model: 'gpt-6.1-sol', apiKey: 'mock-only', fetchImpl, ...extra
});

test('R2 model parameter helper recognizes GPT major versions and o-series without a version ceiling', () => {
  for (const model of ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-5.6-terra', 'gpt-5', 'GPT-12-next', 'o1', 'o3', 'O4-mini']) {
    assert.deepEqual(getOcrModelParameters(model), { max_completion_tokens: 65536 }, model);
  }
  for (const model of ['gpt-4o-mini', 'gpt-4.1', 'gpt-50oops', 'o3oops', 'other-model', undefined]) {
    assert.deepEqual(getOcrModelParameters(model), { temperature: 0.1, max_completion_tokens: 16384 }, String(model));
  }
});

test('R2 HTTP 400 unsupported temperature retries once, removing only that parameter', async () => {
  const requests = [];
  const result = await run(async (_url, options) => {
    requests.push({ body: JSON.parse(options.body), signal: options.signal });
    return requests.length === 1
      ? failure(400, { code: 'unsupported_value', param: 'temperature',
        message: "Unsupported value: 'temperature' does not support 0.1 with this model." })
      : success();
  }, { model: 'gpt-4o-mini' });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body.temperature, 0.1);
  const { temperature, ...expected } = requests[0].body;
  assert.deepEqual(requests[1].body, expected);
  assert.equal(requests[1].signal, requests[0].signal);
  assert.equal(result.model, 'gpt-4o-mini');
});

test('R2 HTTP 400 unsupported completion budget retries successfully from code or message', async () => {
  for (const error of [
    { code: 'unsupported_parameter', param: 'max_completion_tokens' },
    { message: "Unsupported parameter: 'max_completion_tokens' is not supported with this model. Use 'max_tokens' instead." },
    { message: "The parameter 'max_completion_tokens' is not supported with this model." }
  ]) {
    const requests = [];
    await run(async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return requests.length === 1 ? failure(400, error) : success();
    });
    assert.equal(requests.length, 2);
    const { max_completion_tokens, ...expected } = requests[0];
    assert.equal(max_completion_tokens, 65536);
    assert.deepEqual(requests[1], expected);
  }
});

test('R2 other HTTP 400 errors, absent parameters and schema/model errors never retry', async () => {
  for (const error of [
    { code: 'invalid_value', param: 'temperature', message: 'temperature must be numeric' },
    { code: 'invalid_request_error', message: 'Invalid image data' },
    { code: 'context_length_exceeded', message: 'Too many tokens' },
    { code: 'unsupported_parameter', param: 'max_tokens' },
    { code: 'unsupported_parameter', param: 'temperature' },
    { code: 'unsupported_parameter', param: 'response_format' },
    { code: 'unsupported_parameter', param: 'model' },
    { message: 'Invalid max_completion_tokens: must be a positive integer' }
  ]) {
    let calls = 0;
    await assert.rejects(run(async () => { calls += 1; return failure(400, error); }),
      (err) => err.code === 'OCR_UNAVAILABLE' && /HTTP 400/.test(err.message));
    assert.equal(calls, 1);
  }
});

test('R2 HTTP statuses other than 400 never retry even with unsupported parameter details', async () => {
  for (const status of [401, 403, 422, 429, 500, 503]) {
    let calls = 0;
    await assert.rejects(run(async () => {
      calls += 1;
      return failure(status, { code: 'unsupported_parameter', param: 'max_completion_tokens' });
    }), (err) => err.code === 'OCR_UNAVAILABLE' && err.message.includes(`HTTP ${status}`));
    assert.equal(calls, 1);
  }
});

test('R2 second unsupported parameter failure stops at two requests', async () => {
  let calls = 0;
  await assert.rejects(run(async () => {
    calls += 1;
    return failure(400, { code: 'unsupported_parameter', param: calls === 1 ? 'temperature' : 'max_completion_tokens' });
  }, { model: 'gpt-4o-mini' }), (err) => err.code === 'OCR_UNAVAILABLE');
  assert.equal(calls, 2);
});

test('R2 malformed error JSON and transport failures fail closed without retry', async () => {
  for (const fetchResult of [
    async () => ({ ok: false, status: 400, json: async () => { throw new SyntaxError('bad JSON'); } }),
    async () => { throw new Error('mock transport failure'); }
  ]) {
    let calls = 0;
    await assert.rejects(run(async () => { calls += 1; return fetchResult(); }),
      (err) => err.code === 'OCR_UNAVAILABLE');
    assert.equal(calls, 1);
  }
});

test('R2 retry shares one timeout budget using deterministic mock timers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  let secondStarted;
  const reachedSecond = new Promise((resolve) => { secondStarted = resolve; });
  const pending = run(async (_url, options) => {
    calls += 1;
    if (calls === 1) {
      t.mock.timers.tick(30);
      return failure(400, { code: 'unsupported_parameter', param: 'max_completion_tokens' });
    }
    secondStarted();
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('mock abort')), { once: true }));
  }, { timeoutMs: 50 });
  const rejected = assert.rejects(pending, (err) => err.code === 'OCR_UNAVAILABLE' && /Timeout/.test(err.message));
  await reachedSecond;
  t.mock.timers.tick(20);
  await rejected;
  assert.equal(calls, 2);
});

test('R2 provider error bodies are neither logged nor exposed to callers', async (t) => {
  const logs = [];
  for (const method of ['log', 'warn', 'error', 'debug', 'info']) t.mock.method(console, method, (...args) => logs.push(args));
  let calls = 0;
  await assert.rejects(run(async () => {
    calls += 1;
    return failure(400, { code: 'invalid_request_error', message: `mock-private-body ${images[0].image_data_url}` });
  }), (err) => err.code === 'OCR_UNAVAILABLE' && !/mock-private-body|base64|mock-only/.test(err.message));
  assert.equal(calls, 1);
  assert.deepEqual(logs, []);
});
