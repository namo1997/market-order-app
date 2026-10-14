import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { groupLoginBranches } from '../../client/src/utils/loginBranches.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('all branches remain selectable, including Lamphun and future branch codes', async () => {
  const branches = ['KK', 'PRODUCT1', 'SK', 'PRODUCT2', 'CENTRAL', 'BR001', 'LP', 'NEW', '', 'BR001'].map((code, id) => ({ id, code, name: code === 'LP' ? 'สาขาลำพูน' : code }));
  const groups = groupLoginBranches(branches);
  assert.ok(groups.storefrontBranches.some(b => b.code === 'LP'));
  assert.ok(groups.storefrontBranches.some(b => b.code === 'NEW'));
  const displayed = [...groups.storefrontBranches, ...groups.kitchenBranches, groups.storeBranch, groups.centralBranch].filter(Boolean);
  assert.deepEqual(displayed.map(b => b.id).sort((a,b) => a-b), branches.map(b => b.id));
  const login = await read('../../client/src/pages/auth/Login.jsx');
  assert.match(login, /groupLoginBranches\(branches\)/);
  assert.match(login, /storefrontBranches\.map\(/);
  assert.doesNotMatch(login, /code === 'KK' \|\| code === 'SK'/);
});

// Load the real webhook/controller with isolated model and network dependencies.
// These tests never connect to a database or LINE, including when run on Railway.
async function webhookHarness(mode) {
  const requests = [], captures = [], tasks = [];
  const context = vm.createContext({
    process: { env: { LINE_OA_MODE: mode, LINE_OA_CHANNEL_SECRET: 'test-secret', LINE_OA_CHANNEL_ACCESS_TOKEN: 'fake-token', LINE_CAPTURE_GROUP_NAMES: 'Test Group' } },
    Buffer, console, setTimeout, clearTimeout,
    setImmediate: fn => tasks.push(fn),
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      assert.equal(options.method || 'GET', 'GET', 'capture must never send a POST');
      return { ok: true, json: async () => ({ groupName: 'Test Group', displayName: 'Tester' }) };
    }
  });
  const synthetic = (values) => new vm.SyntheticModule(Object.keys(values), function () { for (const [k,v] of Object.entries(values)) this.setExport(k,v); }, { context });
  const controller = new vm.SourceTextModule(await read('../src/controllers/line-chatbot.controller.js'), { context });
  const capture = new vm.SourceTextModule(await read('../src/services/line-group-capture.service.js'), { context });
  await controller.link(async (specifier) => {
    if (specifier === 'crypto') return synthetic({ default: crypto });
    if (specifier.endsWith('line-group-capture.service.js')) return capture;
    if (specifier.endsWith('line-group-message-archive.model.js')) return synthetic({ upsertMessage: async value => captures.push(value), storeContent: async () => {}, markContentError: async () => {} });
    if (specifier.endsWith('chatbot-query-log.model.js')) return synthetic({ logChatbotQuery: async () => {} });
    if (specifier.endsWith('chatbot-memory.model.js')) return synthetic({ getChatbotMemory: async () => null, upsertChatbotMemory: async () => {} });
    if (specifier.endsWith('clickhouse.service.js')) return synthetic({ queryClickHouse: async () => { throw new Error('Silent webhook must not query sales'); } });
    if (/\/(branch|admin|supplier)\.model\.js$/.test(specifier)) return synthetic({});
    throw new Error(`Unexpected dependency: ${specifier}`);
  });
  await controller.evaluate();
  return { requests, captures, async invoke(valid = true) {
    const body = Buffer.from(JSON.stringify({ events: [
      { type: 'message', source: { type: 'group', groupId: 'fake-group', userId: 'fake-user' }, message: { id: 'fake-message', type: 'text', text: 'ยอดขายวันนี้' } },
      { type: 'message', source: { type: 'user', userId: 'fake-user' }, replyToken: 'fake-reply', message: { id: 'fake-direct', type: 'text', text: 'ช่วยเหลือ' } },
      { type: 'follow', replyToken: 'fake-reply', source: { type: 'user', userId: 'fake-user' } }
    ] }));
    let status;
    const res = { status(value) { status = value; return this; }, json() { return this; } };
    await controller.namespace.handleWebhook({ body, headers: { 'x-line-signature': valid ? crypto.createHmac('sha256', 'test-secret').update(body).digest('base64') : 'invalid' } }, res, error => { throw error; });
    for (const task of tasks.splice(0)) task();
    // Drain the asynchronous capture processor and its stubbed requests.
    for (let i = 0; i < 30; i++) await Promise.resolve();
    return status;
  } };
}

for (const mode of [undefined, '', 'capture_only', 'reply', 'typo', 'REPLY']) {
  test(`LINE remains silent and still archives allowed groups with mode=${String(mode)}`, async () => {
    const h = await webhookHarness(mode);
    assert.equal(await h.invoke(), 200);
    assert.equal(h.captures.length, 1);
    assert.equal(h.captures[0].textContent, 'ยอดขายวันนี้');
    assert.ok(h.requests.length > 0);
    assert.ok(h.requests.every(r => !r.url.includes('/message/reply') && !r.url.includes('/message/push')));
  });
}

test('invalid LINE signature does not capture or reply', async () => {
  const h = await webhookHarness('reply');
  assert.equal(await h.invoke(false), 401);
  assert.equal(h.captures.length, 0);
  assert.equal(h.requests.length, 0);
});

test('legacy reply helper cannot reach LINE Reply API', async () => {
  const source = await read('../src/controllers/line-chatbot.controller.js');
  assert.doesNotMatch(source, /api\.line\.me\/v2\/bot\/message\/(reply|push|multicast|broadcast)/);
  assert.match(source, /reason: 'capture_only'/);
});
