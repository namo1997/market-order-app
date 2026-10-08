// LINE Login สำหรับ Super Admin — ใช้ LINE Login channel เดียวกับ HRMS
// อนุญาตเฉพาะ LINE userId ที่อยู่ใน SUPER_ADMIN_LINE_USER_IDS (คั่นด้วย comma)
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

const STATE_TYPE = 'MARKET_SUPER_ADMIN_LINE';
const STATE_TTL_SECONDS = 10 * 60;
const EXCHANGE_CODE_TTL_MS = 60 * 1000;
export const LINE_NONCE_COOKIE = 'market_line_nonce';

export const getLineLoginConfig = (env = process.env) => {
  const channelId = String(env.LINE_LOGIN_CHANNEL_ID || '').trim();
  const channelSecret = String(env.LINE_LOGIN_CHANNEL_SECRET || '').trim();
  const redirectUri = String(env.LINE_LOGIN_REDIRECT_URI || '').trim();
  const stateSecret = String(env.LINE_STATE_SECRET || env.JWT_SECRET || '').trim();
  const allowedUserIds = String(env.SUPER_ADMIN_LINE_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return {
    channelId,
    channelSecret,
    redirectUri,
    stateSecret,
    allowedUserIds,
    enabled: Boolean(channelId && channelSecret && redirectUri && stateSecret && allowedUserIds.length > 0)
  };
};

export const isAllowedSuperAdminLineUser = (userId, config) =>
  Boolean(userId) && config.allowedUserIds.includes(String(userId).trim());

// state ผูกกับ nonce ใน cookie ของ browser ที่กดเริ่ม กันคนอื่นส่งลิงก์ callback มาให้กด (login CSRF)
export const createLineState = (config, nonce = crypto.randomBytes(16).toString('hex')) => ({
  nonce,
  state: jwt.sign({ type: STATE_TYPE, nonce }, config.stateSecret, { expiresIn: STATE_TTL_SECONDS })
});

export const verifyLineState = (state, cookieNonce, config) => {
  let payload;
  try {
    payload = jwt.verify(String(state || ''), config.stateSecret);
  } catch {
    return false;
  }
  return Boolean(
    payload &&
      payload.type === STATE_TYPE &&
      cookieNonce &&
      typeof payload.nonce === 'string' &&
      payload.nonce.length === String(cookieNonce).length &&
      crypto.timingSafeEqual(Buffer.from(payload.nonce), Buffer.from(String(cookieNonce)))
  );
};

export const buildLineAuthorizeUrl = (config, state) => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.channelId,
    redirect_uri: config.redirectUri,
    state,
    scope: 'profile openid',
    bot_prompt: 'normal'
  });
  return `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
};

export const exchangeLineCodeForProfile = async (code, config, fetchImpl = fetch) => {
  const tokenRes = await fetchImpl('https://api.line.me/oauth2/v2.1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(code || ''),
      redirect_uri: config.redirectUri,
      client_id: config.channelId,
      client_secret: config.channelSecret
    }).toString()
  });
  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenData?.access_token) {
    throw new Error(tokenData?.error_description || 'แลก LINE token ไม่สำเร็จ');
  }
  const profileRes = await fetchImpl('https://api.line.me/v2/profile', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` }
  });
  const profile = await profileRes.json().catch(() => ({}));
  if (!profileRes.ok || !profile?.userId) {
    throw new Error('อ่านข้อมูลโปรไฟล์ LINE ไม่สำเร็จ');
  }
  return { userId: profile.userId, displayName: profile.displayName || '' };
};

// โค้ดใช้ครั้งเดียวสำหรับส่ง session กลับหน้าเว็บ (ไม่ใส่ JWT ใน URL)
// เก็บในหน่วยความจำของ process (service รันตัวเดียว) อายุ 60 วินาที
const exchangeCodes = new Map();

export const createExchangeCode = (session, now = Date.now()) => {
  for (const [key, entry] of exchangeCodes) {
    if (entry.expiresAt <= now) exchangeCodes.delete(key);
  }
  const code = crypto.randomBytes(24).toString('base64url');
  exchangeCodes.set(code, { session, expiresAt: now + EXCHANGE_CODE_TTL_MS });
  return code;
};

export const consumeExchangeCode = (code, now = Date.now()) => {
  const entry = exchangeCodes.get(String(code || ''));
  if (!entry) return null;
  exchangeCodes.delete(String(code));
  return entry.expiresAt > now ? entry.session : null;
};

export const readCookie = (cookieHeader, name) => {
  for (const part of String(cookieHeader || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
};
