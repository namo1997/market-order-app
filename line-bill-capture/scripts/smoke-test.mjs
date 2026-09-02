import crypto from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-bill-capture-smoke-'));
const contentDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-bill-capture-content-'));
const port = 19099;
const secret = 'smoke-test-secret';
// Throwaway credentials for this test server only; real values live in Railway Variables.
const smokePin = 'smoke-pin-1234';
const smokeAccessToken = 'smoke-private-access-token-123456';
const baseUrl = `http://127.0.0.1:${port}`;

const tinyPng = await sharp({
  create: { width: 2, height: 2, channels: 3, background: { r: 255, g: 255, b: 255 } }
}).png().toBuffer();
const billPng = tinyPng;
const altBillPng = Buffer.concat([tinyPng, Buffer.from([1])]);
const noAmountPng = Buffer.concat([tinyPng, Buffer.from([0])]);
const slipPng = Buffer.concat([tinyPng, Buffer.from([2])]);
const secondSlipPng = Buffer.concat([tinyPng, Buffer.from([10])]);
const semanticDuplicateOriginalPng = Buffer.concat([tinyPng, Buffer.from([6])]);
const semanticDuplicateCopyPng = Buffer.concat([tinyPng, Buffer.from([7])]);
const summaryCoverPng = Buffer.concat([tinyPng, Buffer.from([3])]);
const summaryBillAPng = Buffer.concat([tinyPng, Buffer.from([4])]);
const summaryBillBPng = Buffer.concat([tinyPng, Buffer.from([5])]);
const advancePaymentPng = Buffer.concat([tinyPng, Buffer.from([8])]);
const reimbursementPng = Buffer.concat([tinyPng, Buffer.from([9])]);
const reportSlipPng = Buffer.concat([tinyPng, Buffer.from([11])]);
const reportIncomingPng = Buffer.concat([tinyPng, Buffer.from([13])]);
const cashBillPng = Buffer.concat([tinyPng, Buffer.from([12])]);
await fs.writeFile(path.join(contentDir, 'smoke-message-image-bill.png'), billPng);
await fs.writeFile(path.join(contentDir, 'smoke-message-image-bill-alt.png'), altBillPng);
await fs.writeFile(path.join(contentDir, 'smoke-message-image-bill-copy.png'), billPng);
await fs.writeFile(path.join(contentDir, 'smoke-message-image-bill-cross-group.png'), billPng);
await fs.writeFile(path.join(contentDir, 'smoke-message-image-bill-noamount.png'), noAmountPng);
await fs.writeFile(path.join(contentDir, 'smoke-message-image-slip.png'), slipPng);
await fs.writeFile(path.join(contentDir, 'smoke-message-image-slip-second.png'), secondSlipPng);
await fs.writeFile(path.join(contentDir, 'semantic-duplicate-original.png'), semanticDuplicateOriginalPng);
await fs.writeFile(path.join(contentDir, 'semantic-duplicate-copy.png'), semanticDuplicateCopyPng);
await fs.writeFile(path.join(contentDir, 'summary-message-image-summary-cover.png'), summaryCoverPng);
await fs.writeFile(path.join(contentDir, 'summary-message-image-summary-bill-a.png'), summaryBillAPng);
await fs.writeFile(path.join(contentDir, 'summary-message-image-summary-bill-b.png'), summaryBillBPng);
await fs.writeFile(path.join(contentDir, 'smoke-message-image-advance-payment.png'), advancePaymentPng);
await fs.writeFile(path.join(contentDir, 'smoke-message-image-reimbursement.png'), reimbursementPng);
await fs.writeFile(path.join(contentDir, 'report-message-image-report-slip.png'), reportSlipPng);
await fs.writeFile(path.join(contentDir, 'report-message-image-incoming-slip.png'), reportIncomingPng);
await fs.writeFile(path.join(contentDir, 'cash-message-image-bill-cash.png'), cashBillPng);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const signBody = (body) => crypto.createHmac('sha256', secret).update(body).digest('base64');

let sessionCookie = '';

const signIn = async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: smokePin })
  });
  assert(response.ok, 'PIN login should create an admin session');
  sessionCookie = String(response.headers.get('set-cookie') || '').split(';')[0];
  assert(sessionCookie, 'PIN login should return a session cookie');
};

const request = async (url, options = {}) => {
  // admin routes are PIN-gated, so behave like a signed-in browser
  const pathname = new URL(url).pathname;
  if (pathname.startsWith('/api/admin') || pathname.startsWith('/admin')) {
    options = { ...options, headers: { ...(options.headers || {}), cookie: sessionCookie } };
  }
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { response, text, json };
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const waitForHealth = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const result = await request(`${baseUrl}/health`);
      if (result.response.ok && result.json?.service === 'line-bill-capture') return;
    } catch {
      // Server still starting.
    }
    await sleep(250);
  }
  throw new Error(`Service did not become healthy\nstdout:\n${stdout}\nstderr:\n${stderr}`);
};

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
    ADMIN_PIN: smokePin,
    ADMIN_ACCESS_TOKEN: smokeAccessToken,
    AI_PROVIDER: 'mock',
    DECISION_REASON_REQUIRED: '0',
    AI_WORKER_ENABLED: 'true',
    AI_COST_USD_THB_RATE: '35',
    AI_INPUT_USD_PER_MILLION: '1',
    AI_CACHED_INPUT_USD_PER_MILLION: '0.1',
    AI_OUTPUT_USD_PER_MILLION: '6',
    AI_WORKER_START_DELAY_MS: '60000',
    AI_WORKER_INTERVAL_MS: '60000',
    AI_AUTO_MATCH_MIN_SCORE: '90',
    LINE_BILL_CAPTURE_VALIDATION_GROUPS: JSON.stringify({
      Gsummary: { mode: 'bill_summary', supplier: 'เจ๊แววไก่สด', reply_enabled: true }
    }),
    LINE_BILL_CAPTURE_PUSH_MOCK: '1'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let stdout = '';
let stderr = '';
server.stdout.on('data', (chunk) => {
  stdout += chunk.toString();
});
server.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});
server.on('error', (error) => {
  stderr += `${error.stack || error.message}\n`;
});

try {
  await waitForHealth();
  const publicHealth = await fetch(`${baseUrl}/health`).then((response) => response.json());
  assert(!('dataDir' in publicHealth) && !('dbPath' in publicHealth), 'Public health must not expose filesystem paths');
  const anonymousAdmin = await fetch(`${baseUrl}/admin`, { redirect: 'manual' });
  assert(anonymousAdmin.status === 401, 'Anonymous admin page access should be denied');
  const anonymousMobileV2 = await fetch(`${baseUrl}/m2`, { redirect: 'manual' });
  assert(anonymousMobileV2.status === 401, 'Anonymous Mobile V2 access should be denied');
  const anonymousMobileV3 = await fetch(`${baseUrl}/m3`, { redirect: 'manual' });
  assert(anonymousMobileV3.status === 401, 'Anonymous Mobile V3 access should be denied');
  const anonymousApi = await fetch(`${baseUrl}/api/admin/items?limit=1`);
  assert(anonymousApi.status === 401, 'Anonymous admin API access should be denied');
  const accessLink = await fetch(`${baseUrl}/admin?access=${smokeAccessToken}`, { redirect: 'manual' });
  assert(accessLink.status === 303 && accessLink.headers.get('location') === '/admin', 'Private access link should redirect to a clean URL');
  assert(String(accessLink.headers.get('set-cookie') || '').includes('lbc_session='), 'Private access link should create a session');
  const mobileV2AccessLink = await fetch(`${baseUrl}/m2?access=${smokeAccessToken}`, { redirect: 'manual' });
  assert(mobileV2AccessLink.status === 303 && mobileV2AccessLink.headers.get('location') === '/m2', 'Mobile V2 private access link should redirect to a clean URL');
  assert(String(mobileV2AccessLink.headers.get('set-cookie') || '').includes('lbc_session='), 'Mobile V2 private access link should create a session');
  const mobileV3AccessLink = await fetch(`${baseUrl}/m3?access=${smokeAccessToken}`, { redirect: 'manual' });
  assert(mobileV3AccessLink.status === 303 && mobileV3AccessLink.headers.get('location') === '/m3', 'Mobile V3 private access link should redirect to a clean URL');
  assert(String(mobileV3AccessLink.headers.get('set-cookie') || '').includes('lbc_session='), 'Mobile V3 private access link should create a session');
  await signIn();

  const body = JSON.stringify({
    destination: 'smoke',
    events: [
      {
        type: 'message',
        mode: 'active',
        timestamp: 1783425600000,
        source: { type: 'group', groupId: 'Gsmoke', userId: 'Usmoke' },
        webhookEventId: 'smoke-text-1',
        deliveryContext: { isRedelivery: false },
        message: { id: 'smoke-message-text-1', type: 'text', text: 'แจ้งโอนร้านทดสอบ' }
      },
      {
        type: 'message',
        mode: 'active',
        timestamp: 1783425660000,
        source: { type: 'group', groupId: 'Gsmoke', userId: 'Usmoke' },
        webhookEventId: 'smoke-image-bill',
        deliveryContext: { isRedelivery: false },
        message: { id: 'smoke-message-image-bill', type: 'image' }
      },
      {
        type: 'message',
        mode: 'active',
        timestamp: 1783425750000,
        source: { type: 'group', groupId: 'Gsmoke', userId: 'Ualt' },
        webhookEventId: 'smoke-text-alt',
        deliveryContext: { isRedelivery: false },
        message: { id: 'smoke-message-text-alt', type: 'text', text: 'ค่าใช้จ่ายร้านทดสอบ 1,720 บาท' }
      },
      {
        type: 'message',
        mode: 'active',
        timestamp: 1783425720000,
        source: { type: 'group', groupId: 'Gsmoke', userId: 'Ualt' },
        webhookEventId: 'smoke-image-bill-alt',
        deliveryContext: { isRedelivery: false },
        message: { id: 'smoke-message-image-bill-alt', type: 'image' }
      },
      {
        type: 'message',
        mode: 'active',
        timestamp: 1783425780000,
        source: { type: 'group', groupId: 'Gsmoke', userId: 'Usmoke' },
        webhookEventId: 'smoke-image-bill-copy',
        deliveryContext: { isRedelivery: false },
        message: { id: 'smoke-message-image-bill-copy', type: 'image' }
      },
      {
        type: 'message',
        mode: 'active',
        timestamp: 1783425840000,
        source: { type: 'group', groupId: 'Gsmoke', userId: 'Usmoke' },
        webhookEventId: 'smoke-image-bill-noamount',
        deliveryContext: { isRedelivery: false },
        message: { id: 'smoke-message-image-bill-noamount', type: 'image' }
      },
      {
        type: 'message',
        mode: 'active',
        timestamp: 1783425900000,
        source: { type: 'group', groupId: 'Gsmoke', userId: 'Usmoke' },
        webhookEventId: 'smoke-image-slip',
        deliveryContext: { isRedelivery: false },
        message: { id: 'smoke-message-image-slip', type: 'image' }
      },
      {
        type: 'message', mode: 'active', timestamp: 1783425930000,
        source: { type: 'group', groupId: 'Gsmoke', userId: 'Usmoke' },
        webhookEventId: 'smoke-image-slip-second', deliveryContext: { isRedelivery: false },
        message: { id: 'smoke-message-image-slip-second', type: 'image' }
      },
      {
        type: 'message',
        mode: 'active',
        timestamp: 1783425960000,
        source: { type: 'group', groupId: 'Gsmoke', userId: 'Usmoke' },
        webhookEventId: 'smoke-semantic-duplicate-original',
        deliveryContext: { isRedelivery: false },
        message: { id: 'semantic-duplicate-original', type: 'image' }
      },
      {
        type: 'message',
        mode: 'active',
        timestamp: 1783426020000,
        source: { type: 'group', groupId: 'Gsmoke', userId: 'Usmoke' },
        webhookEventId: 'smoke-semantic-duplicate-copy',
        deliveryContext: { isRedelivery: false },
        message: { id: 'semantic-duplicate-copy', type: 'image' }
      },
      {
        type: 'message', mode: 'active', timestamp: 1783426080000,
        source: { type: 'group', groupId: 'Gsmoke', userId: 'Uadvance' },
        webhookEventId: 'smoke-text-advance-payment', deliveryContext: { isRedelivery: false },
        message: { id: 'smoke-message-text-advance-payment', type: 'text', text: 'ตาชั่ง ผลิต' }
      },
      {
        type: 'message', mode: 'active', timestamp: 1783426140000,
        source: { type: 'group', groupId: 'Gsmoke', userId: 'Uadvance' },
        webhookEventId: 'smoke-image-advance-payment', deliveryContext: { isRedelivery: false },
        message: { id: 'smoke-message-image-advance-payment', type: 'image' }
      },
      {
        type: 'message', mode: 'active', timestamp: 1783451400000,
        source: { type: 'group', groupId: 'Gsmoke', userId: 'Ujum' },
        webhookEventId: 'smoke-image-reimbursement', deliveryContext: { isRedelivery: false },
        message: { id: 'smoke-message-image-reimbursement', type: 'image' }
      },
      {
        type: 'message', mode: 'active', timestamp: 1783451460000,
        source: { type: 'group', groupId: 'Gsmoke', userId: 'Ujum' },
        webhookEventId: 'smoke-text-reimbursement', deliveryContext: { isRedelivery: false },
        message: { id: 'smoke-message-text-reimbursement', type: 'text', text: 'คืนเงินสำรองเจ๊เพ็ญซื้อตาชั่ง' }
      }
    ]
  });

  const invalid = await request(`${baseUrl}/api/line-bill-capture/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Line-Signature': 'bad' },
    body
  });
  assert(invalid.response.status === 401, 'Invalid signature should return 401');

  const valid = await request(`${baseUrl}/api/line-bill-capture/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Line-Signature': signBody(body) },
    body
  });
  assert(valid.response.status === 200, 'Valid signature should return 200');

  const largeWebhookBody = JSON.stringify({
    destination: 'smoke',
    events: [{
      type: 'message',
      mode: 'active',
      timestamp: 1783425610000,
      source: { type: 'group', groupId: 'Gsmoke', userId: 'Usmoke' },
      webhookEventId: 'smoke-large-text',
      deliveryContext: { isRedelivery: false },
      message: { id: 'smoke-message-large-text', type: 'text', text: `ข้อความยาว ${'x'.repeat(120_000)}` }
    }]
  });
  const largeWebhook = await request(`${baseUrl}/api/line-bill-capture/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Line-Signature': signBody(largeWebhookBody) },
    body: largeWebhookBody
  });
  assert(largeWebhook.response.status === 200, 'A valid LINE webhook above 100 KB should still return 200');

  const durableItems = await request(`${baseUrl}/api/admin/items?limit=20`);
  const durableMessages = await request(`${baseUrl}/api/admin/messages?limit=20`);
  assert(durableItems.json?.data?.length === 10, 'All image metadata must be durable before webhook 200');
  assert(durableMessages.json?.data?.length === 15, 'All LINE messages must be durable before webhook 200');
  assert(
    durableItems.json.data.every((item) => ['received', 'downloaded', 'duplicate'].includes(item.status)),
    'Durable image metadata should be queued or already downloaded'
  );

  const ingestHealth = await request(`${baseUrl}/health`);
  assert(ingestHealth.json?.ingest?.event_count === 15, 'Health should expose the durable LINE event count');
  assert(ingestHealth.json?.ingest?.last_event_at, 'Health should expose the latest durable LINE event time');

  const duplicate = await request(`${baseUrl}/api/line-bill-capture/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Line-Signature': signBody(body) },
    body
  });
  assert(duplicate.response.status === 200, 'Duplicate webhook should still return 200');

  let messages = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    messages = await request(`${baseUrl}/api/admin/messages?limit=20`);
    if (messages.response.ok && messages.json?.data?.length === 15) break;
    await sleep(250);
  }
  assert(messages.response.ok, 'Admin messages should be readable');
  assert(messages.json.data.length === 15, `Expected 15 messages, got ${messages.json.data.length}`);
  assert(messages.json.data.some((message) => message.sender_user_id === 'Ualt'), 'Alternate sender ID should be preserved');
  assert(messages.json.data.some((message) => message.text === 'ค่าใช้จ่ายร้านทดสอบ 1,720 บาท'), 'Typed amount context should be stored');

  const senders = await request(`${baseUrl}/api/admin/senders?source_id=Gsmoke`);
  assert(senders.response.ok, 'Admin senders should be readable');
  assert(senders.json.data.length === 4, `Expected 4 sender identities, got ${senders.json.data.length}`);
  assert(senders.json.data.some((sender) => sender.user_id === 'Usmoke'), 'Sender directory should expose the LINE user ID');
  assert(senders.json.data.some((sender) => sender.user_id === 'Ualt' && Number(sender.message_count) === 2), 'Sender directory should count alternate sender messages');

  let items = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    items = await request(`${baseUrl}/api/admin/items?limit=20`);
    const rows = items.json?.data || [];
    if (rows.length === 10 && rows.every((item) => ['downloaded', 'duplicate'].includes(item.status))) break;
    await sleep(100);
  }
  assert(items.response.ok, 'Admin items should be readable');
  assert(items.json.data.length === 10, `Expected 10 image items after duplicate, got ${items.json.data.length}`);

  const billItem = items.json.data.find((item) => item.line_message_id === 'smoke-message-image-bill');
  const altBillItem = items.json.data.find((item) => item.line_message_id === 'smoke-message-image-bill-alt');
  const duplicateBillItem = items.json.data.find((item) => item.line_message_id === 'smoke-message-image-bill-copy');
  const noAmountBillItem = items.json.data.find((item) => item.line_message_id === 'smoke-message-image-bill-noamount');
  const slipItem = items.json.data.find((item) => item.line_message_id === 'smoke-message-image-slip');
  const secondSlipItem = items.json.data.find((item) => item.line_message_id === 'smoke-message-image-slip-second');
  const semanticDuplicateOriginal = items.json.data.find((item) => item.line_message_id === 'semantic-duplicate-original');
  const semanticDuplicateCopy = items.json.data.find((item) => item.line_message_id === 'semantic-duplicate-copy');
  const advancePaymentItem = items.json.data.find((item) => item.line_message_id === 'smoke-message-image-advance-payment');
  const reimbursementItem = items.json.data.find((item) => item.line_message_id === 'smoke-message-image-reimbursement');
  assert(billItem && altBillItem && duplicateBillItem && noAmountBillItem && slipItem && secondSlipItem && semanticDuplicateOriginal && semanticDuplicateCopy && advancePaymentItem && reimbursementItem, 'Expected all bill, slip, duplicate, and reimbursement-chain image items');
  const itemContext = await request(`${baseUrl}/api/admin/items/${billItem.id}/context?window_ms=21600000&limit=200`);
  assert(itemContext.response.ok, 'Item context with an explicit time window should be readable');
  assert(itemContext.json.data.messages.some((message) => message.text === 'ค่าใช้จ่ายร้านทดสอบ 1,720 บาท'), 'Item context should include nearby LINE text');
  assert(
    billItem.status === 'downloaded' && altBillItem.status === 'downloaded' && duplicateBillItem.status === 'duplicate' && noAmountBillItem.status === 'downloaded' && slipItem.status === 'downloaded' && semanticDuplicateOriginal.status === 'downloaded' && semanticDuplicateCopy.status === 'downloaded',
    'Mock image content should be downloaded'
  );
  assert(duplicateBillItem.duplicate_of_item_id === billItem.id, 'Duplicate image should point to the first identical image');
  const duplicateHistoryImage = await request(`${baseUrl}/api/admin/items/${duplicateBillItem.id}/image`);
  assert(
    duplicateHistoryImage.response.ok && duplicateHistoryImage.response.headers.get('content-type') === 'image/png',
    'A duplicate image should remain viewable from chat history through its canonical evidence'
  );

  const aiStatus = await request(`${baseUrl}/api/admin/ai/status`);
  assert(aiStatus.response.ok && aiStatus.json.data.provider === 'mock', 'AI status should expose mock provider in smoke');
  assert(aiStatus.json.data.queue.pending_retryable >= 4, 'AI status should expose retryable queue before processing');
  assert(aiStatus.json.data.cost_estimate?.total_thb === 0, 'AI status should expose a zero cost estimate before token usage is recorded');

  const aiRun = await request(`${baseUrl}/api/admin/ai/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 10 })
  });
  assert(aiRun.response.ok, 'Manual AI run should pass');
  assert(aiRun.json.data.processed === 9, `Expected AI to process 9 items, got ${aiRun.json.data.processed}`);
  assert(aiRun.json.data.matched === 1, `Expected AI to propose only the exact bill/slip pair, got ${aiRun.json.data.matched}`);

  const aiItems = await request(`${baseUrl}/api/admin/items?limit=20`);
  const aiBillItem = aiItems.json.data.find((item) => item.line_message_id === 'smoke-message-image-bill');
  const aiAltBillItem = aiItems.json.data.find((item) => item.line_message_id === 'smoke-message-image-bill-alt');
  const aiSlipItem = aiItems.json.data.find((item) => item.line_message_id === 'smoke-message-image-slip');
  const aiSecondSlipItem = aiItems.json.data.find((item) => item.line_message_id === 'smoke-message-image-slip-second');
  const aiAdvancePaymentItem = aiItems.json.data.find((item) => item.line_message_id === 'smoke-message-image-advance-payment');
  const aiReimbursementItem = aiItems.json.data.find((item) => item.line_message_id === 'smoke-message-image-reimbursement');
  assert(aiBillItem.category === 'bill', `Expected AI bill category, got ${aiBillItem.category}`);
  assert(aiAltBillItem.category === 'bill', `Expected AI alternate bill category, got ${aiAltBillItem.category}`);
  assert(aiBillItem.vendor_name === 'ร้านทดสอบ', 'AI should extract bill vendor');
  assert(aiBillItem.bill_total_value === 1720, `Expected AI bill total 1720, got ${aiBillItem.bill_total_value}`);
  assert(aiAltBillItem.bill_total_value === 999, `Expected alternate bill total 999, got ${aiAltBillItem.bill_total_value}`);
  assert(aiAltBillItem.announced_amount === 1720, `Expected announced amount 1720, got ${aiAltBillItem.announced_amount}`);
  assert(aiAltBillItem.amount_review_flag === 1, 'Mismatched announced amount should set review flag');
  const aiNoAmountBillItem = aiItems.json.data.find((item) => item.line_message_id === 'smoke-message-image-bill-noamount');
  assert(aiNoAmountBillItem.match_status === 'needs_amount', 'Bill without a readable total should wait for amount correction');
  const aiSemanticDuplicateOriginal = aiItems.json.data.find((item) => item.line_message_id === 'semantic-duplicate-original');
  const aiSemanticDuplicateCopy = aiItems.json.data.find((item) => item.line_message_id === 'semantic-duplicate-copy');
  assert(aiSemanticDuplicateOriginal.status === 'downloaded', 'First semantic bill should remain downloadable');
  assert(aiSemanticDuplicateCopy.status === 'duplicate', 'Same document identity should be marked duplicate even with different image bytes');
  assert(aiSemanticDuplicateCopy.duplicate_of_item_id === aiSemanticDuplicateOriginal.id, 'Semantic duplicate should point to the first bill');
  assert(aiBillItem.ai_status === 'done' && aiBillItem.ai_confidence > 0, 'AI bill result should have confidence');
  assert(aiBillItem.ai_input_tokens === 100 && aiBillItem.ai_total_tokens === 125, 'AI token usage should be stored per analyzed image');
  assert(aiSlipItem.category === 'transfer', `Expected AI slip transfer category, got ${aiSlipItem.category}`);
  assert(aiSlipItem.slip_amount_value === 1720, `Expected AI slip amount 1720, got ${aiSlipItem.slip_amount_value}`);
  assert(aiSlipItem.slip_amount_confidence > 0, 'AI slip amount should have confidence');
  assert(aiBillItem.matched_item_id === aiSlipItem.id && aiSlipItem.matched_item_id === aiBillItem.id, 'AI should link bill and slip');
  assert(aiBillItem.match_status === 'pending' && aiSlipItem.match_status === 'pending', 'Strong AI match must wait for human confirmation');
  const humanConfirmedAiMatch = await request(`${baseUrl}/api/admin/matches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bill_item_id: aiBillItem.id,
      slip_item_id: aiSlipItem.id,
      status: 'confirmed',
      score: 100,
      reasons: ['smoke human confirmation after AI proposal']
    })
  });
  assert(humanConfirmedAiMatch.response.ok, 'A human reviewer should be able to confirm the AI-proposed pair');
  assert(humanConfirmedAiMatch.json.data.reviewed_by === 'admin-web', 'Human confirmation must record the reviewer');
  assert(aiNoAmountBillItem.matched_item_id == null, 'Bill without a readable total should not be matched');
  assert(aiAdvancePaymentItem.payment_role === 'advance_payment', 'AI should classify the employee-paid slip as an advance payment');
  assert(aiReimbursementItem.payment_role === 'reimbursement', 'AI should classify the company repayment as a reimbursement');
  assert(aiAdvancePaymentItem.reimbursement_related_item_id === aiReimbursementItem.id, 'Advance payment should link to its reimbursement');
  assert(aiReimbursementItem.reimbursement_related_item_id === aiAdvancePaymentItem.id, 'Reimbursement should link back to the advance payment');
  assert(aiAdvancePaymentItem.reimbursement_status === 'pending' && aiReimbursementItem.reimbursement_status === 'pending', 'AI reimbursement link should wait for admin review');
  assert(aiAdvancePaymentItem.matched_item_id == null && aiReimbursementItem.matched_item_id == null, 'Reimbursement-chain slips must not become an unrelated bill-slip pair');

  const reimbursementWithoutReason = await request(`${baseUrl}/api/admin/reimbursements/${aiReimbursementItem.id}/review`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'confirmed', evidence_mode: 'not_required', review_note: '' })
  });
  assert(reimbursementWithoutReason.response.status === 400, 'No-receipt reimbursement review should require a reason');
  const reviewedReimbursement = await request(`${baseUrl}/api/admin/reimbursements/${aiReimbursementItem.id}/review`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'confirmed', evidence_mode: 'not_required', review_note: 'ทดสอบยืนยันว่าเอกสารสองสลิปเพียงพอ' })
  });
  assert(reviewedReimbursement.response.ok, 'A reimbursement chain should allow an audited no-receipt decision');
  assert(reviewedReimbursement.json.data.reimbursement.reimbursement_status === 'confirmed', 'Reviewed reimbursement should leave the pending queue');
  assert(reviewedReimbursement.json.data.reimbursement.reimbursement_evidence_mode === 'not_required', 'Evidence decision should be stored');

  const unsafeTransferRequest = await request(`${baseUrl}/api/admin/items/${aiNoAmountBillItem.id}/request-transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'แจ้งให้โอน\nรายการ: บิลทดสอบ\nยอด: 500.00 บาท' })
  });
  assert(unsafeTransferRequest.response.status === 400, 'Transfer request must require the reviewed image-and-text confirmation');
  const transferRequest = await request(`${baseUrl}/api/admin/items/${aiNoAmountBillItem.id}/request-transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: 'แจ้งให้โอน\nรายการ: บิลทดสอบ\nยอด: 500.00 บาท',
      preview_item_id: aiNoAmountBillItem.id,
      confirmation: 'SEND_IMAGE_AND_TEXT'
    })
  });
  assert(transferRequest.response.ok, 'An unmatched bill should allow an explicit transfer request');
  assert(transferRequest.json.mock === true, 'Smoke transfer request must not contact LINE');
  assert(transferRequest.json.data.status === 'mock_sent', 'Mock transfer request should be audited as mock_sent');
  assert(transferRequest.json.data.includes_image === 1 && transferRequest.json.data.image_item_id === aiNoAmountBillItem.id, 'Transfer request audit must record the attached bill image');
  const imageExpires = Date.now() + 5 * 60 * 1000;
  const imageSignature = crypto.createHmac('sha256', secret).update(`${aiNoAmountBillItem.id}:${imageExpires}`).digest('hex');
  const signedTransferImage = await request(`${baseUrl}/api/line-bill-capture/transfer-request-image/${aiNoAmountBillItem.id}?expires=${imageExpires}&signature=${imageSignature}`);
  assert(signedTransferImage.response.ok && signedTransferImage.response.headers.get('content-type') === 'image/png', 'LINE must be able to fetch the short-lived signed bill image without an admin session');
  const signedTransferPreview = await request(`${baseUrl}/api/line-bill-capture/transfer-request-image/${aiNoAmountBillItem.id}?expires=${imageExpires}&signature=${imageSignature}&variant=preview`);
  assert(
    signedTransferPreview.response.ok && String(signedTransferPreview.response.headers.get('content-type') || '').startsWith('image/jpeg'),
    `LINE preview must be resized to a compatible JPEG (status ${signedTransferPreview.response.status}, type ${signedTransferPreview.response.headers.get('content-type')}, body ${signedTransferPreview.text.slice(0, 300)})`
  );
  const invalidTransferImage = await request(`${baseUrl}/api/line-bill-capture/transfer-request-image/${aiNoAmountBillItem.id}?expires=${imageExpires}&signature=bad`);
  assert(invalidTransferImage.response.status === 403, 'Unsigned transfer-request images must stay private');

  const stageZeroAmountAsOther = await request(`${baseUrl}/api/admin/items/${aiNoAmountBillItem.id}/category`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: 'other', reason: 'stage zero-amount category smoke test', record_learning: false })
  });
  assert(stageZeroAmountAsOther.response.ok, 'Zero-amount fixture should be stageable as other');
  const billWithoutRequiredAmount = await request(`${baseUrl}/api/admin/items/${aiNoAmountBillItem.id}/category`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: 'bill', reason: 'missing required amount smoke test', record_learning: false })
  });
  assert(
    billWithoutRequiredAmount.response.status === 400 && billWithoutRequiredAmount.json?.code === 'document_amount_required',
    'Classifying a zero-amount image as a bill must require a positive amount'
  );
  const slipWithoutRequiredAmount = await request(`${baseUrl}/api/admin/items/${aiNoAmountBillItem.id}/category`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: 'transfer', reason: 'missing required slip amount smoke test', record_learning: false })
  });
  assert(
    slipWithoutRequiredAmount.response.status === 400 && slipWithoutRequiredAmount.json?.code === 'document_amount_required',
    'Classifying a zero-amount image as a slip must require a positive amount'
  );
  const billWithRequiredAmount = await request(`${baseUrl}/api/admin/items/${aiNoAmountBillItem.id}/category`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: 'bill', bill_total_text: '500.00', reason: 'required amount supplied smoke test', record_learning: false })
  });
  assert(
    billWithRequiredAmount.response.ok && billWithRequiredAmount.json.data.bill_total_value === 500,
    'Classifying an image as a bill should save the required amount in the same request'
  );

  const rematchedAmount = await request(`${baseUrl}/api/admin/items/${aiNoAmountBillItem.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vendor_name: 'ร้านทดสอบ', bill_total_text: '1,720.00' })
  });
  assert(rematchedAmount.response.ok, 'Correcting an unmatched amount should pass');
  assert(rematchedAmount.json.data.auto_match_id, 'Correcting an unmatched amount should immediately attempt and return a new match');
  assert(
    Number(rematchedAmount.json.data.auto_match_bill_id) === Number(aiNoAmountBillItem.id)
      && Number(rematchedAmount.json.data.auto_match_slip_id) === Number(aiSecondSlipItem.id),
    'Amount correction should match the corrected bill to the remaining exact slip'
  );
  const releaseRematchedPair = await request(`${baseUrl}/api/admin/matches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bill_item_id: aiNoAmountBillItem.id,
      slip_item_id: aiSecondSlipItem.id,
      status: 'rejected',
      score: 100,
      replace_existing: true,
      reasons: ['release amount-rematch smoke fixture']
    })
  });
  assert(releaseRematchedPair.response.ok, 'Smoke rematch fixture should be releasable for later tests');

  const confirmedTransferRequest = await request(`${baseUrl}/api/admin/items/${aiBillItem.id}/request-transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'ข้อความที่ไม่ควรถูกส่ง', preview_item_id: aiBillItem.id, confirmation: 'SEND_IMAGE_AND_TEXT' })
  });
  assert(confirmedTransferRequest.response.status === 409, 'A bill with a confirmed slip must not request another transfer');

  const flagged = await request(`${baseUrl}/api/admin/items?flagged=1&limit=20`);
  assert(flagged.response.ok, 'Flagged items API should be readable');
  assert(Number(flagged.json.flagged_count) >= 1, 'Flagged count should be exposed in the items API');
  assert(flagged.json.data.some((item) => item.id === aiAltBillItem.id), 'Flagged items should include the unmatched amount conflict');

  const resolvedFlag = await request(`${baseUrl}/api/admin/items/${aiAltBillItem.id}/resolve-flag`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ use_announced: true })
  });
  assert(resolvedFlag.response.ok, 'Using announced amount should resolve the flag');
  assert(resolvedFlag.json.data.bill_total_value === 1720, 'Using announced amount should update bill total');
  assert(resolvedFlag.json.data.amount_review_flag === 0, 'Resolved flag should be cleared');
  assert(resolvedFlag.json.data.flag_resolved_by === 'admin-web', 'Flag resolution actor should be recorded');

  const flagsAfterResolve = await request(`${baseUrl}/api/admin/items?flagged=1&limit=20`);
  assert(!flagsAfterResolve.json.data.some((item) => item.id === aiAltBillItem.id), 'Resolved flag should leave the flagged list');

  const summaryBody = JSON.stringify({
    destination: 'smoke',
    events: [
      {
        type: 'message',
        mode: 'active',
        timestamp: 1783426000000,
        source: { type: 'group', groupId: 'Gsummary', userId: 'Usummary' },
        webhookEventId: 'summary-command',
        deliveryContext: { isRedelivery: false },
        message: { id: 'summary-message-command', type: 'text', text: 'ตรวจบิล' }
      },
      {
        type: 'message',
        mode: 'active',
        timestamp: 1783426010000,
        source: { type: 'group', groupId: 'Gsummary', userId: 'Usummary' },
        webhookEventId: 'summary-image-cover',
        deliveryContext: { isRedelivery: false },
        message: { id: 'summary-message-image-summary-cover', type: 'image' }
      },
      {
        type: 'message',
        mode: 'active',
        timestamp: 1783426020000,
        source: { type: 'group', groupId: 'Gsummary', userId: 'Usummary' },
        webhookEventId: 'summary-image-bill-a',
        deliveryContext: { isRedelivery: false },
        message: { id: 'summary-message-image-summary-bill-a', type: 'image' }
      },
      {
        type: 'message',
        mode: 'active',
        timestamp: 1783426030000,
        source: { type: 'group', groupId: 'Gsummary', userId: 'Usummary' },
        webhookEventId: 'summary-image-bill-b',
        deliveryContext: { isRedelivery: false },
        message: { id: 'summary-message-image-summary-bill-b', type: 'image' }
      }
    ]
  });
  const summaryWebhook = await request(`${baseUrl}/api/line-bill-capture/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Line-Signature': signBody(summaryBody) },
    body: summaryBody
  });
  assert(summaryWebhook.response.status === 200, 'Summary validation webhook should return 200');
  let summaryReady = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const summaryDownloadItems = await request(`${baseUrl}/api/admin/items?source_id=Gsummary&limit=20`);
    const downloadedSummaryImages = (summaryDownloadItems.json?.data || []).filter((item) =>
      String(item.line_message_id || '').startsWith('summary-message-image-')
      && item.status === 'downloaded'
    );
    if (downloadedSummaryImages.length === 3) {
      summaryReady = true;
      break;
    }
    await sleep(100);
  }
  assert(summaryReady, 'Summary validation images should finish downloading before the AI run');
  const summaryAiRun = await request(`${baseUrl}/api/admin/ai/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 10 })
  });
  assert(summaryAiRun.response.ok, 'Summary validation AI run should pass');
  assert(summaryAiRun.json.data.processed === 3, `Expected 3 summary images to process, got ${summaryAiRun.json.data.processed}`);
  assert(summaryAiRun.json.data.group_checks?.some((check) => check.status === 'passed'), 'ตรวจบิล should pass only after summary/detail amounts match');
  const summaryItems = await request(`${baseUrl}/api/admin/items?source_id=Gsummary&limit=20`);
  const summaryCoverItem = summaryItems.json.data.find((item) => item.line_message_id === 'summary-message-image-summary-cover');
  const splitBatch = await request(`${baseUrl}/api/admin/items/${summaryCoverItem.id}/split-batch-payment`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines: [
      { supplier_name: 'ร้านหนึ่ง', payee_name: 'ผู้รับหนึ่ง', bank_name: 'กสิกรไทย', account_no: '111', amount: 100 },
      { supplier_name: 'ร้านจัดรวม', amount: 50, excluded: true, note: 'จัดรวมรอบอื่น' },
      { supplier_name: 'ร้านสอง', payee_name: 'ผู้รับสอง', bank_name: 'กรุงเทพ', account_no: '222', amount: 200 }
    ] })
  });
  assert(splitBatch.response.status === 201, 'A batch payment summary should split into payable rows');
  assert(splitBatch.json.data.child_item_ids.length === 2 && splitBatch.json.data.payable_total === 300, 'Excluded batch rows must not create payable items or affect the total');
  const splitAgain = await request(`${baseUrl}/api/admin/items/${summaryCoverItem.id}/split-batch-payment`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines: [{ supplier_name: 'ซ้ำ', amount: 300 }] })
  });
  assert(splitAgain.response.status === 409, 'A batch payment summary must not be split twice');

  const matches = await request(`${baseUrl}/api/admin/matches?limit=10`);
  assert(matches.response.ok, 'Matches API should be readable');
  assert(matches.json.data.length >= 2, `Expected the primary AI match history, got ${matches.json.data.length}`);
  const primaryAiMatch = matches.json.data.find((row) => row.bill_item_id === aiBillItem.id && row.slip_item_id === aiSlipItem.id);
  assert(primaryAiMatch, 'Matches API should expose the primary bill and slip IDs');
  assert(
    String(primaryAiMatch.reason_json || '').includes('ยอดตรงกัน'),
    'Amount-first matching should be recorded in match reasons'
  );

  const reassignedMatch = await request(`${baseUrl}/api/admin/matches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bill_item_id: aiAltBillItem.id,
      slip_item_id: aiSlipItem.id,
      score: 91,
      status: 'pending',
      reasons: ['smoke reassign']
    })
  });
  assert(reassignedMatch.response.status === 409, 'Reusing a slip without explicit replacement must be blocked');
  assert(reassignedMatch.json.data?.error === 'document_already_used', 'Reuse conflict should identify document_already_used');
  assert(Array.isArray(reassignedMatch.json.data?.conflicts) && reassignedMatch.json.data.conflicts.length, 'Reuse conflict should identify the active transaction');

  const confirmedReassignment = await request(`${baseUrl}/api/admin/matches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bill_item_id: aiAltBillItem.id,
      slip_item_id: aiSlipItem.id,
      score: 91,
      status: 'pending',
      replace_existing: true,
      reasons: ['smoke confirmed reassign']
    })
  });
  assert(confirmedReassignment.response.ok, 'Explicitly confirmed reassignment should pass');

  const reassignedItems = await request(`${baseUrl}/api/admin/items?limit=20`);
  const oldBillAfterReassign = reassignedItems.json.data.find((item) => item.id === aiBillItem.id);
  const altBillAfterReassign = reassignedItems.json.data.find((item) => item.id === aiAltBillItem.id);
  const slipAfterReassign = reassignedItems.json.data.find((item) => item.id === aiSlipItem.id);
  assert(oldBillAfterReassign.match_status === 'unmatched', 'Old bill should become unmatched after slip reassignment');
  assert(altBillAfterReassign.matched_item_id === aiSlipItem.id, 'Alternate bill should point to reassigned slip');
  assert(slipAfterReassign.matched_item_id === aiAltBillItem.id, 'Slip should point to alternate bill after reassignment');

  const blockedGroupReuse = await request(`${baseUrl}/api/admin/match-groups`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bill_item_ids: [aiBillItem.id, aiAltBillItem.id],
      slip_item_ids: [aiSlipItem.id],
      status: 'pending', reasons: ['smoke blocked group reuse']
    })
  });
  assert(blockedGroupReuse.response.status === 409, 'Adding an active document to a new group without confirmation must be blocked');

  const chronologicalBillIds = [aiBillItem, aiAltBillItem]
    .sort((left, right) => Number(left.event_timestamp_ms || 0) - Number(right.event_timestamp_ms || 0) || Number(left.id) - Number(right.id))
    .map((item) => Number(item.id));
  const chronologicalSlipIds = [aiSlipItem, aiSecondSlipItem]
    .sort((left, right) => Number(left.event_timestamp_ms || 0) - Number(right.event_timestamp_ms || 0) || Number(left.id) - Number(right.id))
    .map((item) => Number(item.id));

  const twoBillsOneSlip = await request(`${baseUrl}/api/admin/match-groups`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bill_item_ids: [...chronologicalBillIds].reverse(),
      slip_item_ids: [aiSlipItem.id],
      status: 'pending', replace_existing: true, reasons: ['smoke 2 bills to 1 slip']
    })
  });
  assert(twoBillsOneSlip.response.ok, 'A grouped match should support two bills paid by one slip');
  assert(twoBillsOneSlip.json.data.bill_item_ids.length === 2 && twoBillsOneSlip.json.data.slip_item_ids.length === 1, 'Grouped match should retain all 2:1 members');
  assert(
    JSON.stringify(twoBillsOneSlip.json.data.bill_item_ids) === JSON.stringify(chronologicalBillIds),
    'Grouped bill members should be saved in LINE timestamp order'
  );

  const oneBillTwoSlips = await request(`${baseUrl}/api/admin/match-groups`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bill_item_ids: [aiAltBillItem.id],
      slip_item_ids: [...chronologicalSlipIds].reverse(),
      status: 'pending', replace_existing: true, reasons: ['smoke 1 bill to 2 slips']
    })
  });
  assert(oneBillTwoSlips.response.ok, 'A grouped match should support one bill paid by two slips');
  assert(oneBillTwoSlips.json.data.bill_item_ids.length === 1 && oneBillTwoSlips.json.data.slip_item_ids.length === 2, 'Grouped match should retain all 1:2 members');
  assert(
    JSON.stringify(oneBillTwoSlips.json.data.slip_item_ids) === JSON.stringify(chronologicalSlipIds),
    'Grouped slip members should be saved in LINE timestamp order'
  );
  const mismatchedGroupConfirmation = await request(`${baseUrl}/api/admin/match-groups`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bill_item_ids: [aiAltBillItem.id], slip_item_ids: [aiSlipItem.id, aiSecondSlipItem.id],
      status: 'confirmed', reasons: ['must reject mismatched group total']
    })
  });
  assert(mismatchedGroupConfirmation.response.status === 409, 'A grouped match with different aggregate totals must not be confirmed');
  const groupedRows = await request(`${baseUrl}/api/admin/matches?status=pending&limit=20`);
  const groupKey = oneBillTwoSlips.json.data.match_group_key;
  assert(groupedRows.json.data.filter((row) => row.match_group_key === groupKey).length === 2, 'Grouped match API should expose both slip members under one key');

  const restoreSinglePair = await request(`${baseUrl}/api/admin/matches`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bill_item_id: aiAltBillItem.id, slip_item_id: aiSlipItem.id, score: 91, status: 'pending', replace_existing: true, reasons: ['restore smoke single pair'] })
  });
  assert(restoreSinglePair.response.ok, 'A grouped match should be replaceable by a normal pair');

  const pendingAfterReassign = await request(`${baseUrl}/api/admin/matches?status=pending&limit=10`);
  assert(pendingAfterReassign.json.data.length === 1, 'Only the new reassigned pair should remain pending');
  assert(pendingAfterReassign.json.data[0].bill_item_id === aiAltBillItem.id, 'Pending match should be the reassigned bill');

  const patchedBill = await request(`${baseUrl}/api/admin/items/${aiBillItem.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      category: 'bill',
      vendor_name: 'ร้านทดสอบ',
      bill_total_text: '1,720.00',
      notes: 'smoke test'
    })
  });
  assert(patchedBill.response.ok, 'Bill metadata patch should pass');
  assert(patchedBill.json.data.bill_total_value === 1720, 'Bill total should parse to numeric value');
  assert(Object.hasOwn(patchedBill.json.data, 'auto_matches'), 'Amount patch should report whether rematching found a pair');
  assert(!Object.hasOwn(patchedBill.json.data, 'slip_amount_value') || patchedBill.json.data.slip_amount_value == null, 'Bill edit should not create slip amount');

  const patchedSlip = await request(`${baseUrl}/api/admin/items/${aiSlipItem.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: 'transfer', slip_amount_text: '1,720.00' })
  });
  assert(patchedSlip.response.ok, 'Slip category patch should pass');
  assert(patchedSlip.json.data.slip_amount_value === 1720, 'Slip amount should parse to numeric value');
  assert(Boolean(patchedSlip.json.data.slip_amount_edited_at), 'Manual slip amount should keep an edited timestamp');
  assert(patchedSlip.json.data.slip_amount_edited_by === 'admin-web', 'Manual slip amount should record the editor');

  const incomingTransfer = await request(`${baseUrl}/api/admin/items/${aiSlipItem.id}/category`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: 'incoming_transfer', reason: 'เงินรับเข้าบัญชี ไม่ใช่สลิปจ่าย' })
  });
  assert(incomingTransfer.response.ok && incomingTransfer.json.data.category === 'incoming_transfer', 'Incoming transfer category should be accepted');
  const restoreOutgoingTransfer = await request(`${baseUrl}/api/admin/items/${aiSlipItem.id}/category`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: 'transfer', reason: 'restore outgoing transfer for match test' })
  });
  assert(restoreOutgoingTransfer.response.ok, 'Outgoing transfer category should be restorable');

  const invalidMatch = await request(`${baseUrl}/api/admin/matches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bill_item_id: aiBillItem.id, slip_item_id: 999999, score: 88, status: 'pending' })
  });
  assert(invalidMatch.response.status === 404, 'Match with missing item should return 404');

  const selfMatch = await request(`${baseUrl}/api/admin/matches`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bill_item_id: aiBillItem.id, slip_item_id: aiBillItem.id, status: 'pending' })
  });
  assert(selfMatch.response.status === 400, 'The same image must not be both bill and slip');

  const billAsSlip = await request(`${baseUrl}/api/admin/matches`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bill_item_id: aiBillItem.id, slip_item_id: aiAltBillItem.id, status: 'pending' })
  });
  assert(billAsSlip.response.status === 400, 'A bill-category image must not be accepted as a slip');

  const validMatch = await request(`${baseUrl}/api/admin/matches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bill_item_id: aiBillItem.id,
      slip_item_id: aiSlipItem.id,
      score: 88,
      status: 'pending',
      replace_existing: true,
      reasons: ['smoke test']
    })
  });
  assert(validMatch.response.ok, 'Valid match should pass');

  const rejectedMatch = await request(`${baseUrl}/api/admin/matches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bill_item_id: aiBillItem.id,
      slip_item_id: aiSlipItem.id,
      score: 88,
      status: 'rejected',
      reasons: ['smoke reject'],
      review_note: 'ชื่อผู้รับไม่ตรงกับร้านในบิล',
      ai_learning_approved: true
    })
  });
  assert(rejectedMatch.response.ok && rejectedMatch.json.data.status === 'rejected', 'Rejected pair should remain in match history');
  assert(rejectedMatch.json.data.review_note === 'ชื่อผู้รับไม่ตรงกับร้านในบิล', 'Pair review note should be saved');
  assert(rejectedMatch.json.data.ai_learning_approved === 1, 'Approved review should be marked for AI learning');
  const itemsAfterReject = await request(`${baseUrl}/api/admin/items?limit=20`);
  const billAfterReject = itemsAfterReject.json.data.find((item) => item.id === aiBillItem.id);
  const slipAfterReject = itemsAfterReject.json.data.find((item) => item.id === aiSlipItem.id);
  assert(billAfterReject.match_status === 'unmatched' && billAfterReject.matched_item_id == null, 'Rejected bill should return to the unmatched queue');
  assert(slipAfterReject.match_status === 'unmatched' && slipAfterReject.matched_item_id == null, 'Rejected slip should return to the unmatched queue');

  const aiRematchAfterHumanReject = await request(`${baseUrl}/api/admin/ai/rematch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  });
  assert(aiRematchAfterHumanReject.response.ok, 'AI rematch should complete after a human rejection');
  const historyAfterAiRematch = await request(`${baseUrl}/api/admin/matches?limit=100`);
  const protectedRejectedPair = historyAfterAiRematch.json.data.find(
    (row) => row.bill_item_id === aiBillItem.id && row.slip_item_id === aiSlipItem.id
  );
  assert(protectedRejectedPair?.status === 'rejected', 'AI rematch must not undo a human-rejected pair');

  const rematchedAfterReject = await request(`${baseUrl}/api/admin/matches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bill_item_id: aiBillItem.id,
      slip_item_id: aiSlipItem.id,
      score: 88,
      status: 'pending',
      replace_existing: true,
      reasons: ['smoke rematch after reject']
    })
  });
  assert(rematchedAfterReject.response.ok, 'Rejected documents should be available for a new pending pair');

  const vagueCategoryTeaching = await request(`${baseUrl}/api/admin/items/${aiBillItem.id}/category-learning/review`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'ไม่ใช่บิล' })
  });
  assert(vagueCategoryTeaching.response.ok && vagueCategoryTeaching.json.data.decision === 'clarify', 'A vague category correction must ask a follow-up question');
  const categoryTeaching = await request(`${baseUrl}/api/admin/items/${aiBillItem.id}/category-learning/review`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'เป็นรูปแชท ไม่ใช่เอกสารการเงิน' })
  });
  assert(categoryTeaching.response.ok && categoryTeaching.json.data.decision === 'accept', 'A concrete category correction should be accepted for learning');
  const recategorizedChat = await request(`${baseUrl}/api/admin/items/${aiBillItem.id}/category`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      category: 'other', reason: 'เป็นรูปแชท ไม่ใช่เอกสารการเงิน',
      ai_learning_approved: true, learning_response: categoryTeaching.json.data.understanding
    })
  });
  assert(recategorizedChat.response.ok, 'Recategorizing a matched item as other should pass');
  assert(recategorizedChat.json.data.category === 'other', 'Recategorized item should be other');
  assert(recategorizedChat.json.data.category_edit_reason === 'เป็นรูปแชท ไม่ใช่เอกสารการเงิน', 'Category correction reason should be stored');
  assert(recategorizedChat.json.data.learning?.type === 'category_correction', 'Approved category correction should become an AI learning example');
  assert(recategorizedChat.json.data.match_status === 'unmatched' && recategorizedChat.json.data.matched_item_id == null, 'Non-matchable item should leave its pair');
  const itemsAfterRecategorize = await request(`${baseUrl}/api/admin/items?limit=20`);
  const slipAfterRecategorize = itemsAfterRecategorize.json.data.find((item) => item.id === aiSlipItem.id);
  assert(slipAfterRecategorize.match_status === 'unmatched' && slipAfterRecategorize.matched_item_id == null, 'Counterpart should leave a recategorized item');

  const receiptDraft = await request(`${baseUrl}/api/admin/items/${aiSlipItem.id}/receipt-substitute-draft`);
  assert(receiptDraft.response.ok, 'An unmatched slip should expose a receipt-substitute draft');
  assert(receiptDraft.json.data.payer_name === 'บริษัท โซลาว จำกัด', 'Receipt-substitute payer should be fixed to Solao');
  assert(receiptDraft.json.data.amount === 1720, 'Receipt-substitute amount should come from the slip');

  const createReceiptBody = JSON.stringify({
    slip_item_id: aiSlipItem.id,
    document_date: '2026-07-07',
    payee_name: 'ผู้รับเงินทดสอบ',
    payee_account: 'XXX-X-X1234-X',
    description: 'ค่าขนส่งทดสอบ'
  });
  const createdReceipt = await request(`${baseUrl}/api/admin/receipt-substitutes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: createReceiptBody
  });
  assert(createdReceipt.response.status === 201, 'Creating a receipt substitute should return 201');
  assert(createdReceipt.json.data.item.generated_document_type === 'receipt_substitute', 'Generated bill should retain its document type');
  assert(createdReceipt.json.data.item.bill_total_value === 1720, 'Generated bill amount should equal the slip amount');
  assert(createdReceipt.json.data.match.status === 'confirmed', 'Receipt substitute should immediately close the slip with a confirmed match');

  const duplicateReceipt = await request(`${baseUrl}/api/admin/receipt-substitutes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: createReceiptBody
  });
  assert(duplicateReceipt.response.status === 200 && duplicateReceipt.json.data.created === false, 'Submitting the same slip twice should reuse its receipt substitute');

  const blockedClose = await request(`${baseUrl}/api/admin/days/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ business_date: '2026-07-07', source_id: 'Gsmoke' })
  });
  assert(blockedClose.response.status === 409, 'A day with unresolved documents must not close');

  const reportBody = JSON.stringify({
    destination: 'smoke',
    events: [{
      type: 'message', mode: 'active', timestamp: Date.parse('2026-07-09T10:00:00+07:00'),
      source: { type: 'group', groupId: 'Greport', userId: 'Ureport' },
      webhookEventId: 'report-image-slip', deliveryContext: { isRedelivery: false },
      message: { id: 'report-message-image-report-slip', type: 'image' }
    }, {
      type: 'message', mode: 'active', timestamp: Date.parse('2026-07-09T10:05:00+07:00'),
      source: { type: 'group', groupId: 'Greport', userId: 'Ureport' },
      webhookEventId: 'report-image-incoming', deliveryContext: { isRedelivery: false },
      message: { id: 'report-message-image-incoming-slip', type: 'image' }
    }]
  });
  const reportWebhook = await request(`${baseUrl}/api/line-bill-capture/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Line-Signature': signBody(reportBody) },
    body: reportBody
  });
  assert(reportWebhook.response.ok, 'Report fixture webhook should pass');
  let reportSlip = null;
  let reportIncoming = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const reportItems = await request(`${baseUrl}/api/admin/items?source_id=Greport&limit=10`);
    reportSlip = reportItems.json?.data?.find((item) => item.line_message_id === 'report-message-image-report-slip');
    reportIncoming = reportItems.json?.data?.find((item) => item.line_message_id === 'report-message-image-incoming-slip');
    if (reportSlip?.status === 'downloaded' && reportIncoming?.status === 'downloaded') break;
    await sleep(100);
  }
  assert(reportSlip?.status === 'downloaded' && reportIncoming?.status === 'downloaded', 'Report fixture images should download');
  const reportAiRun = await request(`${baseUrl}/api/admin/ai/run`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 2 })
  });
  assert(reportAiRun.response.ok && reportAiRun.json.data.processed === 2, 'Report slips should be analyzed');
  const classifyReportIncome = await request(`${baseUrl}/api/admin/items/${reportIncoming.id}/category`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: 'incoming_transfer', reason: 'หลักฐานเงินรับเข้าสำหรับทดสอบรายงาน' })
  });
  assert(classifyReportIncome.response.ok, 'Report income should be classified before closing');
  const reportReceipt = await request(`${baseUrl}/api/admin/receipt-substitutes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      slip_item_id: reportSlip.id,
      document_date: '2026-07-09',
      payee_name: 'ผู้รับเงินรายงาน',
      description: 'ค่าใช้จ่ายสำหรับทดสอบรายงาน'
    })
  });
  assert(reportReceipt.response.status === 201 && reportReceipt.json.data.match.status === 'confirmed', 'Clean report fixture should create a confirmed transaction');
  const closeForReport = await request(`${baseUrl}/api/admin/days/close`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ business_date: '2026-07-09', source_id: 'Greport' })
  });
  assert(closeForReport.response.ok, 'A fully resolved day should close before printing its report');
  const dayReport = await request(`${baseUrl}/admin/day-report?date=2026-07-09&group=Greport&autoprint=0`);
  assert(dayReport.response.ok, 'A closed day should render its printable report');
  assert(dayReport.text.includes('ใบสรุปกระทบยอดประจำวัน'), 'The report should contain the financial summary page');
  assert(dayReport.text.includes('รายการรับเงินเข้า') && dayReport.text.includes('หลักฐานเงินรับเข้า'), 'The report should include incoming-transfer summary and evidence');
  assert(dayReport.text.includes('evidence-sheet') && dayReport.text.includes('transaction-card'), 'The report should contain compact transaction evidence pages');
  assert(dayReport.text.includes('/api/admin/items/'), 'The report should reference captured document images');

  const cashBody = JSON.stringify({
    destination: 'smoke',
    events: [{
      type: 'message', mode: 'active', timestamp: Date.parse('2026-07-10T11:00:00+07:00'),
      source: { type: 'group', groupId: 'Gcash', userId: 'Ucash' },
      webhookEventId: 'cash-image-bill', deliveryContext: { isRedelivery: false },
      message: { id: 'cash-message-image-bill-cash', type: 'image' }
    }]
  });
  const cashWebhook = await request(`${baseUrl}/api/line-bill-capture/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Line-Signature': signBody(cashBody) }, body: cashBody
  });
  assert(cashWebhook.response.ok, 'Cash bill fixture webhook should pass');
  let cashBill = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const cashItems = await request(`${baseUrl}/api/admin/items?source_id=Gcash&limit=10`);
    cashBill = cashItems.json?.data?.find((item) => item.line_message_id === 'cash-message-image-bill-cash');
    if (cashBill?.status === 'downloaded') break;
    await sleep(100);
  }
  assert(cashBill?.status === 'downloaded', 'Cash bill fixture image should download');
  const cashAiRun = await request(`${baseUrl}/api/admin/ai/run`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 1 })
  });
  assert(cashAiRun.response.ok && cashAiRun.json.data.processed === 1, 'Cash bill should be analyzed before manual confirmation');
  const analyzedCashItems = await request(`${baseUrl}/api/admin/items?source_id=Gcash&limit=10`);
  cashBill = analyzedCashItems.json.data.find((item) => item.id === cashBill.id);
  assert(cashBill.category === 'bill' && cashBill.bill_total_value === 1720, 'Cash payment must start from a readable bill amount');
  const incompleteCash = await request(`${baseUrl}/api/admin/items/${cashBill.id}/cash-payment`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipient_name: '', note: '' })
  });
  assert(incompleteCash.response.status === 400, 'Cash payment must require recipient and note');
  const confirmedCash = await request(`${baseUrl}/api/admin/items/${cashBill.id}/cash-payment`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient_name: 'ผู้รับเงินสดทดสอบ', note: 'จ่ายสดหน้าร้าน รับสินค้าแล้ว' })
  });
  assert(confirmedCash.response.status === 201, 'A human should be able to confirm a full cash payment');
  assert(confirmedCash.json.data.payment.amount === 1720, 'Cash amount must be derived from the full bill amount');
  assert(confirmedCash.json.data.payment.business_date === '2026-07-10', 'Cash payment must use the bill round date');
  const cashRecipientHistory = await request(`${baseUrl}/api/admin/cash-payments/recipients`);
  assert(cashRecipientHistory.response.ok, 'Cash recipient history should be available to the admin form');
  assert(cashRecipientHistory.json.data.some((row) => row.recipient_name === 'ผู้รับเงินสดทดสอบ' && row.payment_count === 1), 'Recipient history should include confirmed cash payments');
  const cashListed = await request(`${baseUrl}/api/admin/items?source_id=Gcash&limit=10`);
  cashBill = cashListed.json.data.find((item) => item.id === cashBill.id);
  assert(cashBill.match_status === 'confirmed' && cashBill.cash_payment_id, 'Cash-paid bill should appear as confirmed without a fake slip');
  assert(cashBill.cash_recipient_name === 'ผู้รับเงินสดทดสอบ', 'Cash recipient should be exposed to both admin clients');
  const cashMatchConflict = await request(`${baseUrl}/api/admin/matches`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bill_item_id: cashBill.id, slip_item_id: aiSecondSlipItem.id, status: 'pending' })
  });
  assert(cashMatchConflict.response.status === 409, 'A cash-paid bill must not also be matched to a transfer slip');
  const editedCash = await request(`${baseUrl}/api/admin/items/${cashBill.id}/cash-payment`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient_name: 'ร้านทดสอบ', note: 'แก้หมายเหตุหลังตรวจเงินสด' })
  });
  assert(editedCash.response.ok && editedCash.json.data.payment.recipient_name === 'ร้านทดสอบ', 'Cash payment recipient and note should be editable');
  const voidWithoutReason = await request(`${baseUrl}/api/admin/items/${cashBill.id}/cash-payment/void`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: '' })
  });
  assert(voidWithoutReason.response.status === 400, 'Voiding a cash payment should require an audit reason');
  const voidedCash = await request(`${baseUrl}/api/admin/items/${cashBill.id}/cash-payment/void`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'ทดสอบยกเลิกก่อนยืนยันใหม่' })
  });
  assert(voidedCash.response.ok && voidedCash.json.data.item.match_status === 'unmatched', 'Voided cash bill should return to the unmatched bill queue');
  const reconfirmedCash = await request(`${baseUrl}/api/admin/items/${cashBill.id}/cash-payment`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient_name: 'ร้านทดสอบ', note: 'ยืนยันจ่ายสดสำหรับปิดรอบ' })
  });
  assert(reconfirmedCash.response.status === 201, 'A voided cash bill should allow a new audited confirmation');
  const closeCashDay = await request(`${baseUrl}/api/admin/days/close`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ business_date: '2026-07-10', source_id: 'Gcash' })
  });
  assert(closeCashDay.response.ok, 'A day containing only a confirmed cash bill should close');
  assert(closeCashDay.json.data.summary.confirmed_cash_count === 1, 'Closed-day snapshot should count cash transactions separately');
  assert(closeCashDay.json.data.summary.confirmed_cash_amount === 1720, 'Closed-day snapshot should include the cash total');
  const cashReport = await request(`${baseUrl}/admin/day-report?date=2026-07-10&group=Gcash&autoprint=0`);
  assert(cashReport.response.ok, 'A closed cash day should render its printable report');
  assert(cashReport.text.includes('เงินสด') && cashReport.text.includes('ร้านทดสอบ'), 'Cash report should show payment method and recipient');

  const invalidReset = await request(`${baseUrl}/api/admin/ai/reset-all`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start: '2026-99-99', end: '2026-99-99' })
  });
  assert(invalidReset.response.status === 400, 'Invalid calendar dates must not trigger an AI reset');

  const resetAll = await request(`${baseUrl}/api/admin/ai/reset-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ all: true })
  });
  assert(resetAll.response.ok && resetAll.json.data.requeued >= 1, 'Full AI reset should queue non-manual images');
  const itemsAfterReset = await request(`${baseUrl}/api/admin/items?limit=20`);
  const manualOtherAfterReset = itemsAfterReset.json.data.find((item) => item.id === aiBillItem.id);
  const queuedDocumentAfterReset = itemsAfterReset.json.data.find((item) => item.id === aiSemanticDuplicateOriginal.id);
  const generatedReceiptAfterReset = itemsAfterReset.json.data.find((item) => item.id === createdReceipt.json.data.item.id);
  assert(manualOtherAfterReset.category === 'other' && manualOtherAfterReset.ai_status === 'pending', 'Manual category should survive while its image is queued for a fresh AI read');
  assert(manualOtherAfterReset.ai_summary == null && manualOtherAfterReset.ai_raw_text == null, 'Fresh AI read must discard stale OCR and summary for a manually categorized image');
  assert(queuedDocumentAfterReset.category === 'pending' && queuedDocumentAfterReset.ai_status === 'pending', 'Non-manual image should be queued for a fresh AI read');
  assert(generatedReceiptAfterReset.ai_status === 'done' && generatedReceiptAfterReset.match_status === 'confirmed', 'Generated receipt substitutes must remain complete and outside the vision queue');
  const pausedAi = await request(`${baseUrl}/api/admin/ai/pause`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_id: 'Gsmoke', paused: true })
  });
  assert(pausedAi.response.ok && pausedAi.json.data.changed >= 1, 'A scoped AI queue should be pausable');
  const itemsWhilePaused = await request(`${baseUrl}/api/admin/items?source_id=Gsmoke&limit=20`);
  assert(itemsWhilePaused.json.data.some((item) => item.ai_status === 'paused'), 'Paused images must stay out of the active AI queue');
  const resumedAi = await request(`${baseUrl}/api/admin/ai/pause`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_id: 'Gsmoke', paused: false })
  });
  assert(resumedAi.response.ok && resumedAi.json.data.changed === pausedAi.json.data.changed, 'Paused AI images should resume without a full reset');
  const itemsAfterResume = await request(`${baseUrl}/api/admin/items?source_id=Gsmoke&limit=20`);
  assert(itemsAfterResume.json.data.every((item) => item.ai_status !== 'paused'), 'Resumed images must return to the active queue');
  const reportItemsAfterReset = await request(`${baseUrl}/api/admin/items?source_id=Greport&limit=10`);
  assert(
    reportItemsAfterReset.json.data
      .filter((item) => item.category !== 'incoming_transfer')
      .every((item) => item.match_status === 'confirmed'),
    'A human-confirmed receipt-substitute transaction must survive a full AI reset'
  );
  assert(
    reportItemsAfterReset.json.data.some((item) => item.id === reportIncoming.id && item.category === 'incoming_transfer'),
    'A manually classified incoming transfer must survive a full AI reset'
  );
  const cashItemsAfterReset = await request(`${baseUrl}/api/admin/items?source_id=Gcash&limit=10`);
  const cashBillAfterReset = cashItemsAfterReset.json.data.find((item) => item.id === cashBill.id);
  assert(
    cashBillAfterReset.match_status === 'confirmed' && cashBillAfterReset.cash_payment_id && cashBillAfterReset.ai_status === 'done',
    'A human-confirmed cash payment must survive AI reset and must not return to the AI queue'
  );

  const holdMs = Number(process.env.SMOKE_HOLD_MS || 0);
  if (Number.isFinite(holdMs) && holdMs > 0) {
    await sleep(holdMs);
  }

  const unsendBody = JSON.stringify({
    destination: 'smoke',
    events: [
      {
        type: 'unsend',
        mode: 'active',
        timestamp: 1783425900000,
        source: { type: 'group', groupId: 'Gsmoke', userId: 'Usmoke' },
        webhookEventId: 'smoke-unsend-1',
        deliveryContext: { isRedelivery: false },
        unsend: { messageId: 'smoke-message-image-slip' }
      }
    ]
  });
  const unsend = await request(`${baseUrl}/api/line-bill-capture/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Line-Signature': signBody(unsendBody) },
    body: unsendBody
  });
  assert(unsend.response.status === 200, 'Unsend webhook should return 200');

  await sleep(500);
  const finalItems = await request(`${baseUrl}/api/admin/items?limit=20`);
  const finalSlip = finalItems.json.data.find((item) => item.line_message_id === 'smoke-message-image-slip');
  assert(finalSlip.status === 'unsent', 'Unsent image should be marked unsent');

  const crossGroupBody = JSON.stringify({
    destination: 'smoke',
    events: [{
      type: 'message', mode: 'active', timestamp: 1783425950000,
      source: { type: 'group', groupId: 'Gother', userId: 'Usmoke' },
      webhookEventId: 'smoke-cross-group-identical-image', deliveryContext: { isRedelivery: false },
      message: { id: 'smoke-message-image-bill-cross-group', type: 'image' }
    }]
  });
  const crossGroup = await request(`${baseUrl}/api/line-bill-capture/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Line-Signature': signBody(crossGroupBody) }, body: crossGroupBody
  });
  assert(crossGroup.response.ok, 'Cross-group resend should ingest');
  let crossItem = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const crossRows = await request(`${baseUrl}/api/admin/items?source_id=Gother&limit=10`);
    crossItem = crossRows.json.data.find((item) => item.line_message_id === 'smoke-message-image-bill-cross-group');
    if (crossItem?.status === 'downloaded') break;
    await sleep(100);
  }
  assert(crossItem?.status === 'downloaded', 'Identical bytes in another group must remain independent evidence');

  const canonicalUnsendBody = JSON.stringify({
    destination: 'smoke',
    events: [{
      type: 'unsend', mode: 'active', timestamp: 1783425960000,
      source: { type: 'group', groupId: 'Gsmoke', userId: 'Usmoke' },
      webhookEventId: 'smoke-unsend-canonical-image', deliveryContext: { isRedelivery: false },
      unsend: { messageId: 'smoke-message-image-bill' }
    }]
  });
  const canonicalUnsend = await request(`${baseUrl}/api/line-bill-capture/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Line-Signature': signBody(canonicalUnsendBody) },
    body: canonicalUnsendBody
  });
  assert(canonicalUnsend.response.ok, 'Unsend of a canonical duplicate image should pass');
  await sleep(200);
  const duplicateRowsAfterUnsend = await request(`${baseUrl}/api/admin/items?source_id=Gsmoke&limit=30`);
  const unsentCanonical = duplicateRowsAfterUnsend.json.data.find((item) => item.line_message_id === 'smoke-message-image-bill');
  const promotedDuplicate = duplicateRowsAfterUnsend.json.data.find((item) => item.line_message_id === 'smoke-message-image-bill-copy');
  assert(unsentCanonical.status === 'unsent', 'Canonical image should retain the LINE unsend state');
  assert(promotedDuplicate.status === 'downloaded' && promotedDuplicate.duplicate_of_item_id == null, 'An active identical copy should become the canonical evidence');
  const hiddenCanonicalImage = await request(`${baseUrl}/api/admin/items/${unsentCanonical.id}/image`);
  const promotedImage = await request(`${baseUrl}/api/admin/items/${promotedDuplicate.id}/image`);
  assert(hiddenCanonicalImage.response.status === 404, 'Unsent canonical image must no longer be served');
  assert(promotedImage.response.ok, 'Promoted duplicate evidence must remain viewable');
  const crossImageAfterUnsend = await request(`${baseUrl}/api/admin/items/${crossItem.id}/image`);
  assert(crossImageAfterUnsend.response.ok, 'Unsend in one group must not delete a blob still referenced by another group');

  const admin = await request(`${baseUrl}/admin`);
  assert(admin.response.status === 200 && admin.text.includes('LINE Bill Capture'), 'Admin page should render');
  assert(admin.text.includes('ปฏิทินประจำเดือน'), 'Admin page should include the monthly calendar');
  assert(admin.text.includes('month-calendar') && admin.text.includes('calendar-run'), 'Monthly calendar styles and drill-down rows should be present');
  assert(admin.text.includes('id="day-prev"') && admin.text.includes('id="day-next"'), 'Desktop day view should expose previous/next day navigation');
  assert(admin.text.includes('จัดเป็นอื่น ๆ'), 'Unmatched bill, slip, and batch rows should expose an Other correction');
  assert(
    admin.text.includes("['unmatched','rejected'].includes(String(row.match_status||''))")
      && admin.text.includes('รวมรายการจากบิลไม่เข้าคู่และสลิปไม่เข้าคู่')
      && !admin.text.includes("candidateRows=S.candidatePools.get(sourceId)"),
    'The multi-document picker must reload and include current unmatched bills and slips'
  );
  assert(
    admin.text.includes('บันทึกยอดและจับคู่ใหม่')
      && admin.text.includes("matchId=Number(response.data?.auto_match_id||0)"),
    'Desktop unmatched bills must allow amount correction and open a new proposed match'
  );
  assert(
    admin.text.includes('printedBillAmount')
      && admin.text.includes('เอกสาร / แจ้ง / โอน')
      && admin.text.includes('ต่างจากเอกสาร'),
    'Flagged match review must distinguish the printed document, announced, and transfer amounts'
  );
  assert(
    admin.text.includes('AI กำลังวิเคราะห์เอกสารนี้')
      && admin.text.includes('ใช้เหตุผล AI เป็นร่าง')
      && admin.text.includes('decisionDocuments')
      && admin.text.includes('context_snapshot:{route:decisionRoute(url),method,request:body,documents,evidence_candidates'),
    'Decision review must request a document-specific Shadow AI rationale before the human commits'
  );
  assert(
    admin.text.includes('dayLeftoverLive=()=>dayWorkCount()')
      && admin.text.includes("S.items.filter(x=>liveItem(x)&&BUCKET_FILTER[k](x))"),
    'Desktop close guard must count the visible live work buckets and ignore unsent/duplicate evidence'
  );

  console.log('smoke ok');
} finally {
  server.kill('SIGTERM');
  await sleep(100);
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.rm(contentDir, { recursive: true, force: true });
}

if (server.exitCode && server.exitCode !== 0 && server.exitCode !== null) {
  throw new Error(`Server exited with ${server.exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}
