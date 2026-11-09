// ทดสอบการใช้ Claude (AI_PROVIDER=anthropic) กับเซิร์ฟเวอร์ Anthropic ปลอมในเครื่อง ไม่เรียก API จริง
import http from 'http';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import crypto from 'crypto';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const requests = [];
let mode = 'ok';
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    requests.push({ url: req.url, headers: req.headers, body: JSON.parse(body || '{}') });
    const reply = (status, json, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(json));
    };
    if (mode === 'rate_limit') return reply(429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, { 'retry-after': '0' });
    const base = { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_details: null,
      usage: { input_tokens: 1000, cache_read_input_tokens: 200, cache_creation_input_tokens: 0, output_tokens: 300 } };
    if (mode === 'refusal') return reply(200, { ...base, content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: '' } });
    const answer = mode === 'review'
      ? { decision: 'accept', understanding: 'เข้าใจแล้ว', question: '' }
      : { category: 'bill', confidence: 0.93, bill_total_value: 1234.5, vendor_name: 'ร้านทดสอบ', summary: 'บิลทดสอบ' };
    return reply(200, { ...base, content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn' });
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'anthropic-provider-test-'));
process.env.CAPTURE_DATA_DIR = scratch;
process.env.CAPTURE_DB_PATH = path.join(scratch, 'test.sqlite');

const { getAiConfig, analyzeItem, reviewCategoryCorrection } = await import('../src/ai-worker.js');
const { toClaudeSchema, prepareClaudeImage } = await import('../src/anthropic-vision.js');

const withEnv = (vars, fn) => {
  const keys = ['AI_PROVIDER', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_VISION_MODEL', 'ANTHROPIC_EFFORT', 'AI_WORKER_ENABLED'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, vars);
  try { return fn(); } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
};

try {
  // 1) เลือก provider
  let c = withEnv({ AI_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'test-key' }, getAiConfig);
  assert(c.provider === 'anthropic' && c.configured && c.enabled, 'AI_PROVIDER=claude must enable anthropic');
  assert(c.model === 'claude-sonnet-5-5' && c.anthropicEffort === 'medium', 'default Claude model/effort');
  c = withEnv({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a' }, getAiConfig);
  assert(c.provider === 'openai', 'explicit openai must stay openai even when ANTHROPIC_API_KEY exists');
  c = withEnv({ ANTHROPIC_API_KEY: 'a' }, getAiConfig);
  assert(c.provider === 'anthropic' && c.configured, 'only ANTHROPIC_API_KEY should auto-select anthropic');
  c = withEnv({ AI_PROVIDER: 'anthropic' }, getAiConfig);
  assert(!c.configured && !c.enabled, 'anthropic without key must stay disabled');
  c = withEnv({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'a', ANTHROPIC_VISION_MODEL: 'claude-opus-5-5', ANTHROPIC_EFFORT: 'high' }, getAiConfig);
  assert(c.model === 'claude-opus-5-5' && c.anthropicEffort === 'high', 'model/effort overrides');

  // 2) แปลง schema ['string','null'] เป็น anyOf
  const converted = toClaudeSchema({ type: 'object', properties: { a: { type: ['string', 'null'] }, list: { type: 'array', items: { type: 'object', properties: { n: { type: ['number', 'null'] } } } } } });
  assert(JSON.stringify(converted.properties.a) === JSON.stringify({ anyOf: [{ type: 'string' }, { type: 'null' }] }), 'nullable string -> anyOf');
  assert(converted.properties.list.items.properties.n.anyOf?.length === 2, 'nested nullable -> anyOf');

  // 3) รูปใหญ่ถูกย่อเป็น JPEG
  const noise = crypto.randomBytes(2200 * 2200 * 3);
  const bigPng = await sharp(noise, { raw: { width: 2200, height: 2200, channels: 3 } }).png().toBuffer();
  assert(bigPng.length > 3_700_000, `fixture should be large (${bigPng.length})`);
  const prepared = await prepareClaudeImage(bigPng, 'image/png');
  assert(prepared.media_type === 'image/jpeg' && Buffer.from(prepared.data, 'base64').length <= 3_700_000, 'large image must be re-encoded');

  // 4) อ่านบิลผ่าน Claude ปลอม
  const imagePath = path.join(scratch, 'bill.png');
  await sharp({ create: { width: 40, height: 40, channels: 3, background: '#ffffff' } }).png().toFile(imagePath);
  const item = { id: 1, line_message_id: 'm1', source_type: 'group', source_id: 'g1', storage_path: imagePath, content_type: 'image/png' };
  const config = withEnv({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-key' }, getAiConfig);
  const analysis = await analyzeItem({ item, config });
  const sent = requests.at(-1);
  assert(sent.url.startsWith('/v1/messages'), 'must call Messages API');
  assert(sent.headers['x-api-key'] === 'test-key' || sent.headers.authorization === 'Bearer test-key', 'must send API key');
  assert(String(sent.headers['anthropic-beta']).includes('server-side-fallback-2026-07-01') && sent.body.fallbacks === 'default', 'refusal fallback enabled');
  assert(sent.body.model === 'claude-sonnet-5-5' && sent.body.output_config?.effort === 'medium', 'model/effort sent');
  assert(sent.body.output_config?.format?.type === 'json_schema', 'structured output requested');
  assert(!JSON.stringify(sent.body.output_config.format.schema).includes('"type":["'), 'no type arrays in schema');
  const imageBlock = sent.body.messages[0].content.find((b) => b.type === 'image');
  assert(imageBlock?.source?.media_type === 'image/png', 'image sent as base64 png');
  assert(analysis.category === 'bill', `analysis category bill (got ${analysis.category})`);
  assert(analysis._usage.input_tokens === 1200 && analysis._usage.cached_input_tokens === 200 && analysis._usage.output_tokens === 300 && analysis._usage.total_tokens === 1500, 'usage mapped');

  // 5) refusal และ 429 ต้องโยน error ที่ระบบจัดประเภทได้
  mode = 'refusal';
  let error = await analyzeItem({ item, config }).then(() => null, (e) => e);
  assert(error && /refused/.test(error.message), 'refusal must throw');
  mode = 'rate_limit';
  error = await analyzeItem({ item, config }).then(() => null, (e) => e);
  assert(error && /HTTP 429/.test(error.message), `429 must surface status for retry (got ${error?.message})`);

  // 6) ตรวจเหตุผลแก้หมวดผ่าน Claude
  mode = 'review';
  const review = await withEnv({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-key' }, () => reviewCategoryCorrection({ item: { ...item, category: 'bill' }, reason: 'รูปนี้คือหน้าจอแจ้งเลขบัญชีร้าน ไม่ใช่บิล', targetCategory: 'other' }));
  assert(review.decision === 'accept' && review.understanding === 'เข้าใจแล้ว', 'category review via Claude');

  console.log('anthropic provider test passed');
} finally {
  server.close();
  await fs.rm(scratch, { recursive: true, force: true });
}
