import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getLineLoginConfig,
  isAllowedSuperAdminLineUser,
  createLineState,
  verifyLineState,
  buildLineAuthorizeUrl,
  exchangeLineCodeForProfile,
  createExchangeCode,
  consumeExchangeCode,
  readCookie
} from '../src/utils/line-login.js';

const env = {
  LINE_LOGIN_CHANNEL_ID: '123',
  LINE_LOGIN_CHANNEL_SECRET: 'secret',
  LINE_LOGIN_REDIRECT_URI: 'https://example.test/api/auth/line/callback',
  LINE_STATE_SECRET: 'state-secret',
  SUPER_ADMIN_LINE_USER_IDS: ' Uaaa , Ubbb '
};

test('ปิด LINE Login เมื่อ config ไม่ครบหรือไม่มีรายชื่อที่อนุญาต', () => {
  assert.equal(getLineLoginConfig(env).enabled, true);
  assert.equal(getLineLoginConfig({ ...env, SUPER_ADMIN_LINE_USER_IDS: '' }).enabled, false);
  assert.equal(getLineLoginConfig({ ...env, LINE_LOGIN_CHANNEL_SECRET: '' }).enabled, false);
});

test('อนุญาตเฉพาะ LINE userId ในรายชื่อ', () => {
  const config = getLineLoginConfig(env);
  assert.equal(isAllowedSuperAdminLineUser('Uaaa', config), true);
  assert.equal(isAllowedSuperAdminLineUser('Ubbb', config), true);
  assert.equal(isAllowedSuperAdminLineUser('Uccc', config), false);
  assert.equal(isAllowedSuperAdminLineUser('', config), false);
});

test('state ต้องตรงกับ nonce ใน cookie และเซ็นด้วย secret เดียวกัน', () => {
  const config = getLineLoginConfig(env);
  const { nonce, state } = createLineState(config);
  assert.equal(verifyLineState(state, nonce, config), true);
  assert.equal(verifyLineState(state, 'x'.repeat(nonce.length), config), false);
  assert.equal(verifyLineState(state, null, config), false);
  assert.equal(verifyLineState(state, nonce, getLineLoginConfig({ ...env, LINE_STATE_SECRET: 'other' })), false);
  assert.equal(verifyLineState('garbage', nonce, config), false);
});

test('ลิงก์ authorize มี redirect_uri และ state', () => {
  const url = new URL(buildLineAuthorizeUrl(getLineLoginConfig(env), 'S'));
  assert.equal(url.origin, 'https://access.line.me');
  assert.equal(url.searchParams.get('client_id'), '123');
  assert.equal(url.searchParams.get('redirect_uri'), env.LINE_LOGIN_REDIRECT_URI);
  assert.equal(url.searchParams.get('state'), 'S');
});

test('แลก code เป็นโปรไฟล์ LINE', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(url);
    if (url.endsWith('/token')) return { ok: true, json: async () => ({ access_token: 'AT' }) };
    assert.equal(opts.headers.Authorization, 'Bearer AT');
    return { ok: true, json: async () => ({ userId: 'Uaaa', displayName: 'โม' }) };
  };
  const profile = await exchangeLineCodeForProfile('C', getLineLoginConfig(env), fetchImpl);
  assert.deepEqual(profile, { userId: 'Uaaa', displayName: 'โม' });
  assert.equal(calls.length, 2);
  await assert.rejects(
    exchangeLineCodeForProfile('C', getLineLoginConfig(env), async () => ({ ok: false, json: async () => ({ error_description: 'bad' }) })),
    /bad/
  );
});

test('โค้ดแลก session ใช้ได้ครั้งเดียวและหมดอายุใน 60 วินาที', () => {
  const code = createExchangeCode({ token: 't' }, 1000);
  assert.deepEqual(consumeExchangeCode(code, 2000), { token: 't' });
  assert.equal(consumeExchangeCode(code, 2000), null);
  const expired = createExchangeCode({ token: 't' }, 1000);
  assert.equal(consumeExchangeCode(expired, 1000 + 61_000), null);
});

test('อ่าน cookie ตามชื่อ', () => {
  assert.equal(readCookie('a=1; market_line_nonce=abc%20d; b=2', 'market_line_nonce'), 'abc d');
  assert.equal(readCookie('', 'x'), null);
});
