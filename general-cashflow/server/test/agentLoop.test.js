// ทดสอบ tool loop ของ agent โดยไม่ยิง OpenAI จริง
//
// ใช้ mock HTTP server ที่ตอบรูปแบบเดียวกับ Responses API เพื่อพิสูจน์ว่า
// การส่ง request, การวนเรียก tool, การอ่าน structured output และการนับ usage ถูกต้อง
// เทสต์ชุดนี้จึงรันได้ใน CI โดยไม่ต้องมี API key และไม่มีค่าใช้จ่าย

import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { resolveAgentConfig, runStructuredAgent } from '../src/agents/openai.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline'],
  properties: { headline: { type: 'string' } }
};

let server;
let baseUrl;
let received = [];
let scriptedResponses = [];

const respond = (payload) => ({
  id: 'resp_test',
  status: 'completed',
  usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 80 }, output_tokens: 20 },
  ...payload
});

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received.push({ url: req.url, body: JSON.parse(body || '{}') });
      const next = scriptedResponses.shift() || respond({ output_text: JSON.stringify({ headline: 'ok' }) });
      if (next._killSocket) {
        // จำลองอาการที่เจอจริง: ส่ง header แล้วตัด socket กลางทาง undici จะโยน 'terminated'
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '9999' });
        res.write('{"partial"');
        res.socket.destroy();
        return;
      }
      res.writeHead(next._status || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(next));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const testConfig = () => {
  process.env.CASHFLOW_OPENAI_BASE_URL = baseUrl;
  process.env.CASHFLOW_TEST_API_KEY = 'test-key-not-real';
  received = [];
  return resolveAgentConfig({ prefix: 'CASHFLOW_TEST', defaultModel: 'test-model', defaultEffort: 'low' });
};

test('business rules are sent as a stable instructions field so the prefix can cache', async () => {
  const config = testConfig();
  scriptedResponses = [respond({ output_text: JSON.stringify({ headline: 'สรุปแล้ว' }) })];

  const { result, usage } = await runStructuredAgent({
    config,
    instructions: 'กฎธุรกิจคงที่',
    input: '{"date":"2026-08-16"}',
    schema: SCHEMA,
    schemaName: 'brief'
  });

  assert.equal(result.headline, 'สรุปแล้ว');
  assert.equal(received.length, 1);
  // กฎต้องอยู่ใน instructions ไม่ใช่ปนกับข้อมูลของวันนั้นใน input
  assert.equal(received[0].body.instructions, 'กฎธุรกิจคงที่');
  assert.match(JSON.stringify(received[0].body.input), /2026-08-16/);
  assert.doesNotMatch(JSON.stringify(received[0].body.input), /กฎธุรกิจคงที่/);
  // usage ต้องรายงาน cached token เพื่อให้ตรวจได้ว่า cache ติดจริง
  assert.equal(usage.cached_input_tokens, 80);
});

test('strict json schema and reasoning effort are always sent', async () => {
  const config = testConfig();
  scriptedResponses = [respond({ output_text: JSON.stringify({ headline: 'x' }) })];

  await runStructuredAgent({ config, instructions: 'r', input: 'i', schema: SCHEMA, schemaName: 'brief' });

  const body = received[0].body;
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.name, 'brief');
  assert.equal(body.reasoning.effort, 'low');
  assert.equal(body.model, 'test-model');
});

test('the agent answers a tool call and feeds the result back before finishing', async () => {
  const config = testConfig();
  scriptedResponses = [
    respond({
      output: [{
        type: 'function_call',
        call_id: 'call_1',
        name: 'get_receipt_detail',
        arguments: JSON.stringify({ receipt_id: 42 })
      }]
    }),
    respond({ output_text: JSON.stringify({ headline: 'ดูรายละเอียดแล้ว' }) })
  ];

  const seen = [];
  const { result, toolTrail, rounds, usage } = await runStructuredAgent({
    config,
    instructions: 'r',
    input: 'i',
    schema: SCHEMA,
    schemaName: 'brief',
    tools: [{ type: 'function', name: 'get_receipt_detail', strict: true, parameters: SCHEMA }],
    onToolCall: async (name, args) => {
      seen.push({ name, args });
      return { lines: [{ channel: 'GRAB', cashier: 6480.5 }] };
    }
  });

  assert.equal(result.headline, 'ดูรายละเอียดแล้ว');
  assert.equal(rounds, 2);
  assert.deepEqual(seen, [{ name: 'get_receipt_detail', args: { receipt_id: 42 } }]);
  assert.equal(toolTrail[0].ok, true);
  // usage ต้องรวมทุกรอบ ไม่ใช่แค่รอบสุดท้าย
  assert.equal(usage.output_tokens, 40);

  // รอบที่สองต้องแนบผลลัพธ์ของ tool กลับไปให้โมเดล
  const secondInput = JSON.stringify(received[1].body.input);
  assert.match(secondInput, /function_call_output/);
  assert.match(secondInput, /6480\.5/);
});

test('a tool that throws is reported back to the model instead of killing the run', async () => {
  const config = testConfig();
  scriptedResponses = [
    respond({
      output: [{ type: 'function_call', call_id: 'call_1', name: 'boom', arguments: '{}' }]
    }),
    respond({ output_text: JSON.stringify({ headline: 'ยังตอบได้' }) })
  ];

  const { result, toolTrail } = await runStructuredAgent({
    config,
    instructions: 'r',
    input: 'i',
    schema: SCHEMA,
    schemaName: 'brief',
    tools: [{ type: 'function', name: 'boom', strict: true, parameters: SCHEMA }],
    onToolCall: async () => { throw new Error('DB timeout'); }
  });

  assert.equal(result.headline, 'ยังตอบได้');
  assert.equal(toolTrail[0].ok, false);
  assert.match(toolTrail[0].error, /DB timeout/);
  assert.match(JSON.stringify(received[1].body.input), /DB timeout/);
});

test('tools are withdrawn on the final round so the model must answer', async () => {
  const config = testConfig();
  // โมเดลพยายามเรียก tool ไม่หยุด
  scriptedResponses = Array.from({ length: 3 }, () => respond({
    output: [{ type: 'function_call', call_id: 'c', name: 'loop', arguments: '{}' }]
  }));
  scriptedResponses.push(respond({ output_text: JSON.stringify({ headline: 'ถูกบังคับให้สรุป' }) }));

  const { result } = await runStructuredAgent({
    config,
    instructions: 'r',
    input: 'i',
    schema: SCHEMA,
    schemaName: 'brief',
    tools: [{ type: 'function', name: 'loop', strict: true, parameters: SCHEMA }],
    onToolCall: async () => ({ more: true }),
    maxToolRounds: 3
  });

  assert.equal(result.headline, 'ถูกบังคับให้สรุป');
  // request สุดท้ายต้องไม่มี tools ติดไปด้วย
  assert.equal(received.at(-1).body.tools, undefined);
});

test('an incomplete response fails loudly instead of returning half a brief', async () => {
  const config = testConfig();
  scriptedResponses = [{
    id: 'resp_test',
    status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' },
    output_text: '{"headl'
  }];

  await assert.rejects(
    () => runStructuredAgent({ config, instructions: 'r', input: 'i', schema: SCHEMA, schemaName: 'brief' }),
    /incomplete.*max_output_tokens/
  );
});

test('an API error surfaces the provider message', async () => {
  const config = testConfig();
  scriptedResponses = [{ _status: 401, error: { message: 'Incorrect API key provided' } }];

  await assert.rejects(
    () => runStructuredAgent({ config, instructions: 'r', input: 'i', schema: SCHEMA, schemaName: 'brief' }),
    /Incorrect API key/
  );
  // key ผิดลองใหม่กี่รอบก็ผิดเหมือนเดิม ต้องยิงครั้งเดียวแล้วเลิก
  assert.equal(received.length, 1);
});

// เจอจากการยิงจริง: 2 ครั้งแรกล้มไป 1 ด้วย network error ชั่วคราว
// cron ยิงวันละครั้ง ถ้าไม่ลองใหม่คือไม่มีสรุปทั้งวัน
test('a transient 500 is retried and then succeeds', async () => {
  const config = { ...testConfig(), retryBaseDelayMs: 1 };
  scriptedResponses = [
    { _status: 500, error: { message: 'internal server error' } },
    respond({ output_text: JSON.stringify({ headline: 'สำเร็จรอบสอง' }) })
  ];

  const { result } = await runStructuredAgent({
    config, instructions: 'r', input: 'i', schema: SCHEMA, schemaName: 'brief'
  });

  assert.equal(result.headline, 'สำเร็จรอบสอง');
  assert.equal(received.length, 2);
});

test('rate limiting is retried but a bad request is not', async () => {
  const rateLimited = { ...testConfig(), retryBaseDelayMs: 1 };
  scriptedResponses = [
    { _status: 429, error: { message: 'Rate limit reached' } },
    respond({ output_text: JSON.stringify({ headline: 'ผ่าน' }) })
  ];
  const { result } = await runStructuredAgent({
    config: rateLimited, instructions: 'r', input: 'i', schema: SCHEMA, schemaName: 'brief'
  });
  assert.equal(result.headline, 'ผ่าน');
  assert.equal(received.length, 2);

  const badRequest = { ...testConfig(), retryBaseDelayMs: 1 };
  scriptedResponses = [{ _status: 400, error: { message: 'Invalid schema' } }];
  await assert.rejects(
    () => runStructuredAgent({ config: badRequest, instructions: 'r', input: 'i', schema: SCHEMA, schemaName: 'brief' }),
    /Invalid schema/
  );
  assert.equal(received.length, 1);
});

// อาการที่ทำให้การยิงจริงล้ม 1 ใน 3 ครั้ง: socket ถูกตัดกลางการอ่าน response
// undici โยน Error('terminated') เปล่าๆ ซึ่งไม่มีคำว่า network หรือ fetch อยู่เลย
test('a socket terminated mid-response is retried', async () => {
  const config = { ...testConfig(), retryBaseDelayMs: 1 };
  scriptedResponses = [
    { _killSocket: true },
    respond({ output_text: JSON.stringify({ headline: 'รอดจาก terminated' }) })
  ];

  const { result } = await runStructuredAgent({
    config, instructions: 'r', input: 'i', schema: SCHEMA, schemaName: 'brief'
  });

  assert.equal(result.headline, 'รอดจาก terminated');
  assert.equal(received.length, 2);
});

test('retries give up after the configured limit', async () => {
  const config = { ...testConfig(), retryBaseDelayMs: 1, maxRetries: 2 };
  scriptedResponses = Array.from({ length: 5 }, () => ({ _status: 503, error: { message: 'unavailable' } }));

  await assert.rejects(
    () => runStructuredAgent({ config, instructions: 'r', input: 'i', schema: SCHEMA, schemaName: 'brief' }),
    /unavailable/
  );
  // ครั้งแรก + ลองใหม่ 2 = 3
  assert.equal(received.length, 3);
});

test('max_output_tokens keeps a floor that leaves room for reasoning tokens', () => {
  process.env.CASHFLOW_TEST_MAX_OUTPUT_TOKENS = '10';
  const config = resolveAgentConfig({ prefix: 'CASHFLOW_TEST', defaultModel: 'm' });
  // ตั้งต่ำเกินไปจะถูกดันขึ้นเป็นขั้นต่ำ เพราะ reasoning token นับรวมกับ output
  assert.equal(config.maxOutputTokens, 1000);
  delete process.env.CASHFLOW_TEST_MAX_OUTPUT_TOKENS;
});

test('an agent can share another agent key instead of issuing its own', () => {
  process.env.CASHFLOW_MATCH_API_KEY = 'match-key-not-real';
  delete process.env.CASHFLOW_CASHIER_IMAGE_API_KEY;

  const shared = resolveAgentConfig({
    prefix: 'CASHFLOW_CASHIER_IMAGE',
    defaultModel: 'm',
    shareKeyWith: 'CASHFLOW_MATCH'
  });
  assert.equal(shared.enabled, true);

  // key ของตัวเองต้องชนะ key ที่ยืมมาเสมอ
  process.env.CASHFLOW_CASHIER_IMAGE_API_KEY = 'own-key-not-real';
  const own = resolveAgentConfig({
    prefix: 'CASHFLOW_CASHIER_IMAGE',
    defaultModel: 'm',
    shareKeyWith: 'CASHFLOW_MATCH'
  });
  assert.equal(own.apiKey, 'own-key-not-real');

  delete process.env.CASHFLOW_MATCH_API_KEY;
  delete process.env.CASHFLOW_CASHIER_IMAGE_API_KEY;
});

test('the agent refuses to run without an API key', async () => {
  const config = resolveAgentConfig({ prefix: 'CASHFLOW_MISSING', defaultModel: 'm' });
  assert.equal(config.enabled, false);
  await assert.rejects(
    () => runStructuredAgent({ config, instructions: 'r', input: 'i', schema: SCHEMA, schemaName: 'brief' }),
    /not configured/
  );
});
