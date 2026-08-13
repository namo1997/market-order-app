import crypto from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-bill-capture-smoke-'));
const contentDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-bill-capture-content-'));
const port = 19099;
const secret = 'smoke-test-secret';
// throwaway PIN for this test server only; the real one lives in the ADMIN_PIN env var on Railway
const smokePin = 'smoke-pin-1234';
const baseUrl = `http://127.0.0.1:${port}`;

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
);
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
await fs.writeFile(path.join(contentDir, 'smoke-message-image-bill.png'), billPng);
await fs.writeFile(path.join(contentDir, 'smoke-message-image-bill-alt.png'), altBillPng);
await fs.writeFile(path.join(contentDir, 'smoke-message-image-bill-copy.png'), billPng);
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const signBody = (body) => crypto.createHmac('sha256', secret).update(body).digest('base64');

let sessionCookie = '';

const signIn = async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: smokePin })
  });
  if (!response.ok) return; // auth not enabled: admin routes are open, nothing to sign in to
  sessionCookie = String(response.headers.get('set-cookie') || '').split(';')[0];
};

const request = async (url, options = {}) => {
  // admin routes are PIN-gated, so behave like a signed-in browser
  if (url.includes('/api/admin') || url.endsWith('/admin')) {
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
    AI_PROVIDER: 'mock',
    AI_WORKER_ENABLED: 'true',
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
  // PIN auth is built but not enabled yet (see server.js); when it is switched on,
  // restore: await signIn(); plus the 401 assertion for anonymous admin access.
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
        timestamp: 1783425690000,
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

  const durableItems = await request(`${baseUrl}/api/admin/items?limit=20`);
  const durableMessages = await request(`${baseUrl}/api/admin/messages?limit=20`);
  assert(durableItems.json?.data?.length === 10, 'All image metadata must be durable before webhook 200');
  assert(durableMessages.json?.data?.length === 14, 'All LINE messages must be durable before webhook 200');
  assert(
    durableItems.json.data.every((item) => ['received', 'downloaded', 'duplicate'].includes(item.status)),
    'Durable image metadata should be queued or already downloaded'
  );

  const ingestHealth = await request(`${baseUrl}/health`);
  assert(ingestHealth.json?.ingest?.event_count === 14, 'Health should expose the durable LINE event count');
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
    if (messages.response.ok && messages.json?.data?.length === 14) break;
    await sleep(250);
  }
  assert(messages.response.ok, 'Admin messages should be readable');
  assert(messages.json.data.length === 14, `Expected 14 messages, got ${messages.json.data.length}`);
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

  const aiStatus = await request(`${baseUrl}/api/admin/ai/status`);
  assert(aiStatus.response.ok && aiStatus.json.data.provider === 'mock', 'AI status should expose mock provider in smoke');
  assert(aiStatus.json.data.queue.pending_retryable >= 4, 'AI status should expose retryable queue before processing');

  const aiRun = await request(`${baseUrl}/api/admin/ai/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 10 })
  });
  assert(aiRun.response.ok, 'Manual AI run should pass');
  assert(aiRun.json.data.processed === 9, `Expected AI to process 9 items, got ${aiRun.json.data.processed}`);
  assert(aiRun.json.data.matched === 2, `Expected AI to propose 2 pairs, got ${aiRun.json.data.matched}`);

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
  assert(aiBillItem.match_status === 'confirmed' && aiSlipItem.match_status === 'confirmed', 'Strong AI match should be auto-confirmed');
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

  const transferRequest = await request(`${baseUrl}/api/admin/items/${aiNoAmountBillItem.id}/request-transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'แจ้งให้โอน\nรายการ: บิลทดสอบ\nยอด: 500.00 บาท' })
  });
  assert(transferRequest.response.ok, 'An unmatched bill should allow an explicit transfer request');
  assert(transferRequest.json.mock === true, 'Smoke transfer request must not contact LINE');
  assert(transferRequest.json.data.status === 'mock_sent', 'Mock transfer request should be audited as mock_sent');

  const confirmedTransferRequest = await request(`${baseUrl}/api/admin/items/${aiBillItem.id}/request-transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'ข้อความที่ไม่ควรถูกส่ง' })
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
  await sleep(500);
  const summaryAiRun = await request(`${baseUrl}/api/admin/ai/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 10 })
  });
  assert(summaryAiRun.response.ok, 'Summary validation AI run should pass');
  assert(summaryAiRun.json.data.processed === 3, `Expected 3 summary images to process, got ${summaryAiRun.json.data.processed}`);
  assert(summaryAiRun.json.data.group_checks?.some((check) => check.status === 'passed'), 'ตรวจบิล should pass only after summary/detail amounts match');

  const matches = await request(`${baseUrl}/api/admin/matches?limit=10`);
  assert(matches.response.ok, 'Matches API should be readable');
  assert(matches.json.data.length === 2, `Expected 2 AI matches, got ${matches.json.data.length}`);
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
  assert(reassignedMatch.response.ok, 'Reassigning a used slip should pass');

  const reassignedItems = await request(`${baseUrl}/api/admin/items?limit=20`);
  const oldBillAfterReassign = reassignedItems.json.data.find((item) => item.id === aiBillItem.id);
  const altBillAfterReassign = reassignedItems.json.data.find((item) => item.id === aiAltBillItem.id);
  const slipAfterReassign = reassignedItems.json.data.find((item) => item.id === aiSlipItem.id);
  assert(oldBillAfterReassign.match_status === 'unmatched', 'Old bill should become unmatched after slip reassignment');
  assert(altBillAfterReassign.matched_item_id === aiSlipItem.id, 'Alternate bill should point to reassigned slip');
  assert(slipAfterReassign.matched_item_id === aiAltBillItem.id, 'Slip should point to alternate bill after reassignment');

  const twoBillsOneSlip = await request(`${baseUrl}/api/admin/match-groups`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bill_item_ids: [aiBillItem.id, aiAltBillItem.id],
      slip_item_ids: [aiSlipItem.id],
      status: 'pending', reasons: ['smoke 2 bills to 1 slip']
    })
  });
  assert(twoBillsOneSlip.response.ok, 'A grouped match should support two bills paid by one slip');
  assert(twoBillsOneSlip.json.data.bill_item_ids.length === 2 && twoBillsOneSlip.json.data.slip_item_ids.length === 1, 'Grouped match should retain all 2:1 members');

  const oneBillTwoSlips = await request(`${baseUrl}/api/admin/match-groups`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bill_item_ids: [aiAltBillItem.id],
      slip_item_ids: [aiSlipItem.id, aiSecondSlipItem.id],
      status: 'pending', reasons: ['smoke 1 bill to 2 slips']
    })
  });
  assert(oneBillTwoSlips.response.ok, 'A grouped match should support one bill paid by two slips');
  assert(oneBillTwoSlips.json.data.bill_item_ids.length === 1 && oneBillTwoSlips.json.data.slip_item_ids.length === 2, 'Grouped match should retain all 1:2 members');
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
    body: JSON.stringify({ bill_item_id: aiAltBillItem.id, slip_item_id: aiSlipItem.id, score: 91, status: 'pending', reasons: ['restore smoke single pair'] })
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
  assert(!Object.hasOwn(patchedBill.json.data, 'slip_amount_value') || patchedBill.json.data.slip_amount_value == null, 'Bill edit should not create slip amount');

  const patchedSlip = await request(`${baseUrl}/api/admin/items/${aiSlipItem.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: 'transfer' })
  });
  assert(patchedSlip.response.ok, 'Slip category patch should pass');

  const invalidMatch = await request(`${baseUrl}/api/admin/matches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bill_item_id: aiBillItem.id, slip_item_id: 999999, score: 88, status: 'pending' })
  });
  assert(invalidMatch.response.status === 404, 'Match with missing item should return 404');

  const validMatch = await request(`${baseUrl}/api/admin/matches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bill_item_id: aiBillItem.id,
      slip_item_id: aiSlipItem.id,
      score: 88,
      status: 'pending',
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

  const rematchedAfterReject = await request(`${baseUrl}/api/admin/matches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bill_item_id: aiBillItem.id,
      slip_item_id: aiSlipItem.id,
      score: 88,
      status: 'pending',
      reasons: ['smoke rematch after reject']
    })
  });
  assert(rematchedAfterReject.response.ok, 'Rejected documents should be available for a new pending pair');

  const recategorizedChat = await request(`${baseUrl}/api/admin/items/${aiBillItem.id}/category`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: 'other', reason: 'เป็นรูปแชท ไม่ใช่บิล' })
  });
  assert(recategorizedChat.response.ok, 'Recategorizing a matched item as other should pass');
  assert(recategorizedChat.json.data.category === 'other', 'Recategorized item should be other');
  assert(recategorizedChat.json.data.category_edit_reason === 'เป็นรูปแชท ไม่ใช่บิล', 'Category correction reason should be stored');
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

  const closeForReport = await request(`${baseUrl}/api/admin/days/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ business_date: '2026-07-07', source_id: 'Gsmoke' })
  });
  assert(closeForReport.response.ok, 'A day should close before printing its report');
  const dayReport = await request(`${baseUrl}/admin/day-report?date=2026-07-07&group=Gsmoke&autoprint=0`);
  assert(dayReport.response.ok, 'A closed day should render its printable report');
  assert(dayReport.text.includes('ใบสรุปกระทบยอดประจำวัน'), 'The report should contain the financial summary page');
  assert(dayReport.text.includes('evidence-sheet') && dayReport.text.includes('transaction-card'), 'The report should contain compact transaction evidence pages');
  assert(dayReport.text.includes('/api/admin/items/'), 'The report should reference captured document images');

  const resetAll = await request(`${baseUrl}/api/admin/ai/reset-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  assert(resetAll.response.ok && resetAll.json.data.requeued >= 1, 'Full AI reset should queue non-manual images');
  const itemsAfterReset = await request(`${baseUrl}/api/admin/items?limit=20`);
  const manualOtherAfterReset = itemsAfterReset.json.data.find((item) => item.id === aiBillItem.id);
  const queuedDocumentAfterReset = itemsAfterReset.json.data.find((item) => item.id === aiSemanticDuplicateOriginal.id);
  assert(manualOtherAfterReset.category === 'other' && manualOtherAfterReset.ai_status === 'done', 'Manual category correction should survive the full AI reset');
  assert(queuedDocumentAfterReset.category === 'pending' && queuedDocumentAfterReset.ai_status === 'pending', 'Non-manual image should be queued for a fresh AI read');

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

  const admin = await request(`${baseUrl}/admin`);
  assert(admin.response.status === 200 && admin.text.includes('LINE Bill Capture'), 'Admin page should render');
  assert(admin.text.includes('ปฏิทินประจำเดือน'), 'Admin page should include the monthly calendar');
  assert(admin.text.includes('month-calendar') && admin.text.includes('calendar-run'), 'Monthly calendar styles and drill-down rows should be present');

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
