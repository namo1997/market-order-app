// ทดสอบโหมด AI_PROVIDER=external + ตัวอ่าน subscription (scripts/subscription-ai-runner.mjs)
// ใช้ claude/codex ปลอมในเครื่อง ไม่เรียก AI จริงและไม่ใช้ LINE จริง
import crypto from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'lbc-external-ai-test-'));
const dataDir = path.join(scratch, 'data');
const contentDir = path.join(scratch, 'content');
const workDir = path.join(scratch, 'runner-work');
const binDir = path.join(scratch, 'bin');
await Promise.all([dataDir, contentDir, workDir, binDir].map((dir) => fs.mkdir(dir, { recursive: true })));
const port = 19000 + Math.floor(Math.random() * 800);
const baseUrl = `http://127.0.0.1:${port}`;
const secret = 'external-ai-test-secret';
const runnerToken = crypto.randomBytes(24).toString('hex');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- claude / codex ปลอม ----------
const answers = `
const answerFor = (prompt) => {
  const id = (prompt.match(/line_message_id=(\\S+)/) || [])[1] || '';
  const amount = id.includes('codex') ? 2450 : 1720;
  const text = amount.toLocaleString('en-US', { minimumFractionDigits: 2 });
  if (id.includes('slip')) return { category: 'transfer', payment_role: 'ordinary_payment', confidence: 0.96, category_confidence: 0.96,
    slip_amount_text: text, slip_amount_value: amount, slip_amount_confidence: 0.95, amount_conflict: false,
    raw_text: 'โอนเงินสำเร็จ ไปยัง ร้านทดสอบ จำนวนเงิน ' + text + ' บาท', summary: 'สลิปโอนร้านทดสอบ ' + text, evidence: ['fake slip'] };
  return { category: 'bill', confidence: 0.94, category_confidence: 0.94, vendor_name: 'ร้านทดสอบ', bill_total_text: text,
    bill_total_value: amount, amount_conflict: false, needs_review: false,
    raw_text: 'ร้านทดสอบ ยอดรวม ' + text, summary: 'บิลร้านทดสอบ ' + text, evidence: ['fake bill'] };
};
const forbidden = Object.keys(process.env).filter((key) => /^(ANTHROPIC_|CLAUDE_CODE_|OPENAI_|CODEX_API_KEY$)|^LBC_RUNNER_TOKEN/.test(key));
if (forbidden.length) { console.error('paid/session env leaked: ' + forbidden.join(',')); process.exit(9); }
`;
const fakeClaude = `#!/usr/bin/env node
const fs = require('fs');
${answers}
const args = process.argv.slice(2);
const prompt = fs.readFileSync(0, 'utf8');
const need = ['-p', '--json-schema', '--tools', '--strict-mcp-config'];
for (const flag of need) if (!args.includes(flag)) { console.error('missing ' + flag); process.exit(8); }
const schema = JSON.parse(args[args.indexOf('--json-schema') + 1]);
if (args[args.indexOf('--allowedTools') + 1] !== 'Read(./**)') { console.error('Read must be limited to the job folder'); process.exit(8); }
if (JSON.stringify(schema).includes('"type":["')) { console.error('schema still has type arrays'); process.exit(8); }
const file = (prompt.match(/\\.\\/(image\\.[a-z]+)/) || [])[1];
if (!file || !fs.existsSync(file)) { console.error('image not in cwd'); process.exit(8); }
const mode = process.env.LBC_FAKE_MODE || 'ok';
if (mode === 'limit') { console.log(JSON.stringify({ type: 'result', is_error: true, result: 'Claude AI usage limit reached|1783500000' })); process.exit(1); }
if (mode === 'garbage') { console.log(JSON.stringify({ type: 'result', is_error: false, result: 'ขอโทษครับ อ่านไม่ออก' })); process.exit(0); }
console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: answerFor(prompt) }));
`;
const fakeCodex = `#!/usr/bin/env node
const fs = require('fs');
${answers}
const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
if (args[0] !== 'exec' || !args.includes('--output-schema') || value('--sandbox') !== 'read-only') { console.error('bad args'); process.exit(8); }
if (!fs.existsSync(value('--image'))) { console.error('image missing'); process.exit(8); }
JSON.parse(fs.readFileSync(value('--output-schema'), 'utf8'));
const prompt = fs.readFileSync(0, 'utf8');
fs.writeFileSync(value('--output-last-message'), JSON.stringify(answerFor(prompt)));
`;
const claudeBin = path.join(binDir, 'claude');
const codexBin = path.join(binDir, 'codex');
await fs.writeFile(claudeBin, fakeClaude, { mode: 0o755 });
await fs.writeFile(codexBin, fakeCodex, { mode: 0o755 });

// ---------- รูปทดสอบ ----------
const png = (shade) => sharp({ create: { width: 4, height: 4, channels: 3, background: { r: shade, g: 255, b: 255 } } }).png().toBuffer();
const imageIds = ['ext-claude-bill', 'ext-claude-slip', 'ext-codex-bill', 'ext-codex-slip', 'ext-limit-bill', 'ext-garbage-bill'];
for (const [index, id] of imageIds.entries()) await fs.writeFile(path.join(contentDir, `${id}.png`), await png(index * 20));

const server = spawn(process.env.NODE_BINARY || 'node', ['src/server.js'], {
  cwd: rootDir,
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    CAPTURE_DATA_DIR: dataDir,
    LINE_BILL_CAPTURE_CHANNEL_SECRET: secret,
    LINE_BILL_CAPTURE_CHANNEL_ACCESS_TOKEN: 'dummy-token',
    LINE_CONTENT_MOCK_DIR: contentDir,
    ADMIN_AUTH_DISABLED: '1',
    DECISION_REASON_REQUIRED: '0',
    AI_PROVIDER: 'external',
    AI_EXTERNAL_RUNNER_TOKEN: runnerToken,
    AI_WORKER_START_DELAY_MS: '100',
    AI_WORKER_INTERVAL_MS: '1000',
    OPENAI_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    LINE_BILL_CAPTURE_PUSH_MOCK: '1'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
server.stdout.on('data', (chunk) => { serverLog += chunk; });
server.stderr.on('data', (chunk) => { serverLog += chunk; });

const http = async (method, route, { token = runnerToken, body } = {}) => {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: response.status, json, text };
};

const sendWebhook = async (events) => {
  const body = JSON.stringify({ destination: 'test', events });
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64');
  const response = await fetch(`${baseUrl}/api/line-bill-capture/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Line-Signature': signature }, body
  });
  assert(response.status === 200, `webhook should accept events (${response.status})`);
};
let eventSeq = 0;
const imageEvent = (groupId, messageId, timestamp) => ({
  type: 'message', mode: 'active', timestamp, source: { type: 'group', groupId, userId: 'Uext' },
  webhookEventId: `wh-${++eventSeq}`, deliveryContext: { isRedelivery: false }, message: { id: messageId, type: 'image' }
});
const textEvent = (groupId, messageId, timestamp, text) => ({
  type: 'message', mode: 'active', timestamp, source: { type: 'group', groupId, userId: 'Uext' },
  webhookEventId: `wh-${++eventSeq}`, deliveryContext: { isRedelivery: false }, message: { id: messageId, type: 'text', text }
});

const listItems = async () => (await http('GET', '/api/admin/items?limit=200', { token: null })).json?.data || [];
const itemByMessage = async (messageId) => (await listItems()).find((item) => item.line_message_id === messageId);
const waitDownloaded = async (messageIds) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const items = await listItems();
    if (messageIds.every((id) => items.find((item) => item.line_message_id === id)?.status === 'downloaded')) return;
    await sleep(150);
  }
  throw new Error(`images not downloaded: ${messageIds.join(',')}`);
};

const runRunner = (agent, extraEnv = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(rootDir, 'scripts', 'subscription-ai-runner.mjs'), 'run',
    '--server', baseUrl, '--agent', agent, '--work-dir', workDir, '--claude-bin', claudeBin, '--codex-bin', codexBin, '--timeout-sec', '60'], {
    env: {
      ...process.env,
      LBC_RUNNER_TOKEN: runnerToken,
      // ต้องถูกตัดออกก่อนเรียก CLI เพื่อไม่ให้ใช้ API แบบเสียเงิน
      ANTHROPIC_API_KEY: 'sk-should-be-stripped',
      OPENAI_API_KEY: 'sk-should-be-stripped',
      CLAUDE_CODE_SESSION_ID: 'parent-session',
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  child.on('close', (code) => resolve({ code, output }));
});

try {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`${baseUrl}/health`)).ok) break; } catch {}
    await sleep(200);
  }

  // 1) token
  assert((await http('GET', '/api/ai-runner/status', { token: null })).status === 401, 'no token must be rejected');
  assert((await http('GET', '/api/ai-runner/status', { token: 'x'.repeat(48) })).status === 401, 'wrong token must be rejected');
  const status = await http('GET', '/api/ai-runner/status');
  assert(status.status === 200 && status.json.data.external_mode === true, `status should report external mode: ${status.text}`);
  const adminStatus = await http('GET', '/api/admin/ai/status', { token: null });
  assert(adminStatus.json?.data?.provider === 'external' && adminStatus.json.data.cost_estimate === null, 'admin status shows external provider without token cost');

  // 2) รูปเข้าแล้ว worker ในเซิร์ฟเวอร์ต้องไม่อ่านเอง
  const t0 = 1783425600000;
  await sendWebhook([
    imageEvent('Gext', 'ext-claude-bill', t0),
    textEvent('Gext', 'ext-claude-text', t0 + 20_000, 'ค่าของร้านทดสอบ 1,720 บาท'),
    imageEvent('Gext', 'ext-claude-slip', t0 + 300_000)
  ]);
  await waitDownloaded(['ext-claude-bill', 'ext-claude-slip']);
  await sleep(1500);
  assert((await itemByMessage('ext-claude-bill')).ai_status === 'pending', 'external mode must leave images for the runner');

  // 3) API จอง/ดาวน์โหลด/คืนคิว
  const claim = await http('POST', '/api/ai-runner/claim', { body: { agent: 'claude', model: 'sonnet' } });
  const task = claim.json?.data?.task;
  assert(task && task.prompt.includes('line_message_id=ext-claude-bill') && task.schema?.properties?.category, `claim returns prompt+schema: ${claim.text}`);
  assert(task.claim === 1 && task.image_path.includes(`/items/${task.item_id}/image`), 'claim token is the attempt count');
  assert((await http('GET', `/api/ai-runner/items/${task.item_id}/image?claim=99`)).status === 409, 'wrong claim cannot read image');
  const imageResponse = await fetch(`${baseUrl}${task.image_path}`, { headers: { Authorization: `Bearer ${runnerToken}` } });
  const imageBytes = Buffer.from(await imageResponse.arrayBuffer());
  assert(imageResponse.ok && imageBytes.equals(await fs.readFile(path.join(contentDir, 'ext-claude-bill.png'))), 'image download returns stored bytes');
  const claimedItem = await itemByMessage('ext-claude-bill');
  assert(claimedItem.ai_status === 'processing' && claimedItem.ai_provider === 'external' && claimedItem.ai_model === 'claude-code:sonnet', 'claimed item marked processing by external runner');
  const stale = await http('POST', `/api/ai-runner/items/${task.item_id}/result`, { body: { claim: 7, analysis: { category: 'bill' } } });
  assert(stale.status === 409 && stale.json.error === 'CLAIM_EXPIRED', 'stale claim result rejected');
  const invalid = await http('POST', `/api/ai-runner/items/${task.item_id}/result`, { body: { claim: task.claim, analysis: 'bill' } });
  assert(invalid.status === 400, 'non-object analysis rejected');
  const released = await http('POST', `/api/ai-runner/items/${task.item_id}/release`, { body: { claim: task.claim } });
  assert(released.status === 200, 'release works');
  const releasedItem = await itemByMessage('ext-claude-bill');
  assert(releasedItem.ai_status === 'pending' && Number(releasedItem.ai_attempt_count) === 0, 'release returns item without spending an attempt');

  // 4) ตัวอ่านด้วย Claude Code (ปลอม) อ่านทั้งบิลและสลิป แล้วระบบจับคู่
  const claudeRun = await runRunner('claude');
  assert(claudeRun.code === 0, `claude runner should succeed:\n${claudeRun.output}`);
  const claudeBill = await itemByMessage('ext-claude-bill');
  const claudeSlip = await itemByMessage('ext-claude-slip');
  assert(claudeBill.ai_status === 'done' && claudeBill.category === 'bill' && Number(claudeBill.bill_total_value) === 1720, `bill read by runner: ${JSON.stringify(claudeBill)}`);
  assert(claudeSlip.ai_status === 'done' && claudeSlip.category === 'transfer' && Number(claudeSlip.slip_amount_value) === 1720, 'slip read by runner');
  assert(Number(claudeBill.ai_total_tokens || 0) === 0, 'subscription reads record no paid tokens');
  const matches = (await http('GET', '/api/admin/matches?limit=50', { token: null })).json?.data || [];
  const paired = matches.find((match) => [match.bill_item_id, match.slip_item_id].includes(claudeBill.id) && [match.bill_item_id, match.slip_item_id].includes(claudeSlip.id));
  assert(paired, `runner finish should propose the bill/slip pair: ${JSON.stringify(matches).slice(0, 400)}`);
  const work = await fs.readdir(path.join(workDir, 'items'));
  assert(work.length === 0, 'temporary image copies are removed after each read');

  // 5) ตัวอ่านด้วย Codex (ปลอม)
  await sendWebhook([
    imageEvent('Gext2', 'ext-codex-bill', t0 + 3_600_000),
    imageEvent('Gext2', 'ext-codex-slip', t0 + 3_900_000)
  ]);
  await waitDownloaded(['ext-codex-bill', 'ext-codex-slip']);
  const codexRun = await runRunner('codex', { LBC_RUNNER_MODEL: 'gpt-5.6-terra' });
  assert(codexRun.code === 0, `codex runner should succeed:\n${codexRun.output}`);
  const codexBill = await itemByMessage('ext-codex-bill');
  assert(codexBill.ai_status === 'done' && Number(codexBill.bill_total_value) === 2450 && codexBill.ai_model === 'codex:gpt-5.6-terra', `codex bill read: ${codexBill.ai_model}`);

  // 6) โควตา subscription หมด → คืนรูปเข้าคิวโดยไม่นับครั้ง แล้วหยุดรอบ
  await sendWebhook([imageEvent('Gext3', 'ext-limit-bill', t0 + 7_200_000)]);
  await waitDownloaded(['ext-limit-bill']);
  const limitRun = await runRunner('claude', { LBC_FAKE_MODE: 'limit' });
  assert(limitRun.code === 75, `usage limit should stop the run with code 75:\n${limitRun.output}`);
  const limitItem = await itemByMessage('ext-limit-bill');
  assert(limitItem.ai_status === 'pending' && Number(limitItem.ai_attempt_count) === 0, 'usage-limit item returned to queue');

  // 7) AI ตอบไม่เป็น JSON → บันทึกล้มเหลวแบบชั่วคราว รอลองใหม่ (รวมรูปที่ค้างจากข้อ 6)
  await sendWebhook([imageEvent('Gext4', 'ext-garbage-bill', t0 + 10_800_000)]);
  await waitDownloaded(['ext-garbage-bill']);
  const garbageRun = await runRunner('claude', { LBC_FAKE_MODE: 'garbage' });
  assert(garbageRun.code === 0, `garbage answers are per-item failures:\n${garbageRun.output}`);
  const garbageItem = await itemByMessage('ext-garbage-bill');
  assert(garbageItem.ai_status === 'failed' && garbageItem.ai_error_kind === 'transient' && garbageItem.ai_next_retry_at, 'bad answer scheduled for retry');
  assert(/External runner: claude/.test(garbageItem.ai_error || ''), 'error message names the runner');

  // 8) admin "รันคิว" ในโหมด external ทำแค่จับคู่ ไม่เรียก AI
  const adminRun = await http('POST', '/api/admin/ai/run', { token: null, body: {} });
  assert(adminRun.json?.data?.external_runner === true && adminRun.json.data.processed === 0, 'admin run does not analyze in external mode');
  assert(!/AI vision request failed|OPENAI_API_KEY is not configured/.test(serverLog), 'server never tried a paid provider');

  console.log('external AI runner test passed');
} finally {
  server.kill('SIGTERM');
  await new Promise((resolve) => { server.once('close', resolve); setTimeout(resolve, 3000); });
  await fs.rm(scratch, { recursive: true, force: true });
}

// 9) ตัวช่วยใน runner และการตั้งค่า (ใน process นี้)
const runner = await import('./subscription-ai-runner.mjs');
assert(runner.extractJsonObject('```json\n{"a":1}\n```').a === 1, 'extract fenced JSON');
assert(runner.extractJsonObject('ok {"a":2} done').a === 2, 'extract embedded JSON');
assert(JSON.stringify(runner.toAnyOfSchema({ type: ['string', 'null'] })) === JSON.stringify({ anyOf: [{ type: 'string' }, { type: 'null' }] }), 'type arrays -> anyOf');
const configScratch = await fs.mkdtemp(path.join(os.tmpdir(), 'lbc-external-config-'));
process.env.CAPTURE_DATA_DIR = configScratch;
try {
  const { getAiConfig } = await import('../src/ai-worker.js');
  const { claimNextExternalTask } = await import('../src/external-ai.js');
  const withEnv = (vars, fn) => {
    const saved = { ...process.env };
    for (const key of ['AI_PROVIDER', 'AI_EXTERNAL_RUNNER_TOKEN', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) delete process.env[key];
    Object.assign(process.env, vars);
    try { return fn(); } finally { process.env = saved; }
  };
  let config = withEnv({ AI_PROVIDER: 'subscription', AI_EXTERNAL_RUNNER_TOKEN: 'short' }, getAiConfig);
  assert(config.provider === 'external' && !config.configured, 'short runner token keeps external mode disabled');
  config = withEnv({ AI_PROVIDER: 'external', AI_EXTERNAL_RUNNER_TOKEN: runnerToken, ANTHROPIC_API_KEY: 'a' }, getAiConfig);
  assert(config.provider === 'external' && config.enabled, 'explicit external wins over API keys');
  process.env.AI_PROVIDER = 'anthropic';
  process.env.ANTHROPIC_API_KEY = 'a';
  const error = await claimNextExternalTask({ agent: 'claude' }).then(() => null, (e) => e);
  assert(error?.status === 409 && error.code === 'PROVIDER_NOT_EXTERNAL', 'runner cannot steal the queue from the paid API worker');
  console.log('external AI config test passed');
} finally {
  await fs.rm(configScratch, { recursive: true, force: true });
}
process.exit(0);
