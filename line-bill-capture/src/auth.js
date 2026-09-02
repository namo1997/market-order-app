import crypto from 'crypto';

// PIN authentication for the admin UI and admin API.
//
// The PIN itself lives ONLY in the ADMIN_PIN env var (Railway) — never in code or git.
// A PIN is low entropy by nature (a few digits), so the rate limiter below is not optional:
// it is what makes a short PIN safe against brute force.

const PIN = String(process.env.ADMIN_PIN || '').trim();
const ACCESS_TOKEN = String(process.env.ADMIN_ACCESS_TOKEN || '').trim();
const AUTH_DISABLED = String(process.env.ADMIN_AUTH_DISABLED || '').trim() === '1'
  && ['127.0.0.1', '::1', 'localhost'].includes(String(process.env.HOST || '').trim().toLowerCase());
const SESSION_HOURS = Number(process.env.ADMIN_SESSION_HOURS || 24 * 30);
const MAX_FAILS = Number(process.env.ADMIN_MAX_FAILS || 5);
const LOCK_MINUTES = Number(process.env.ADMIN_LOCK_MINUTES || 15);
const COOKIE = 'lbc_session';
const OPERATOR_COOKIE = 'lbc_operator';
const OPERATOR_NAMES = (() => {
  const raw = String(process.env.ADMIN_OPERATOR_NAMES || '').trim();
  if (!raw) return [];
  let values = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) values = parsed;
  } catch {
    values = raw.split(',');
  }
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 20);
})();

// Signing key: a per-boot random secret unless one is configured, mixed with the PIN so that
// changing the PIN invalidates every existing session. Never derive the key from the PIN alone —
// a 4-digit key would be trivially brute-forced offline from a single captured cookie.
const SESSION_SECRET = String(process.env.ADMIN_SESSION_SECRET || '').trim() || crypto.randomBytes(32).toString('hex');
const signingKey = crypto.createHmac('sha256', SESSION_SECRET)
  .update(`pin:${PIN}\naccess:${ACCESS_TOKEN}`)
  .digest();

export const isAuthConfigured = () => PIN.length > 0 || ACCESS_TOKEN.length >= 24;

const equals = (a, b) => {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

const sign = (payload) => crypto.createHmac('sha256', signingKey).update(payload).digest('hex');

const makeToken = () => {
  const expiresAt = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  const payload = String(expiresAt);
  return `${payload}.${sign(payload)}`;
};

const makeOperatorToken = (name) => {
  const payload = Buffer.from(JSON.stringify({ name, expiresAt: Date.now() + SESSION_HOURS * 60 * 60 * 1000 }))
    .toString('base64url');
  return `${payload}.${sign(`operator:${payload}`)}`;
};

const tokenIsValid = (token) => {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return false;
  if (!equals(signature, sign(payload))) return false;
  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
};

const readCookie = (req, name) => {
  const raw = String(req.headers.cookie || '');
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
};

export const isSignedIn = (req) => isAuthConfigured() && tokenIsValid(readCookie(req, COOKIE));

export const getAdminOperator = (req) => {
  if (!OPERATOR_NAMES.length) return 'admin-web';
  const [payload, signature] = String(readCookie(req, OPERATOR_COOKIE) || '').split('.');
  if (!payload || !signature || !equals(signature, sign(`operator:${payload}`))) return '';
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const name = String(parsed?.name || '').trim();
    return Number(parsed?.expiresAt || 0) > Date.now() && OPERATOR_NAMES.includes(name) ? name : '';
  } catch {
    return '';
  }
};

export const hasAdminOperators = () => OPERATOR_NAMES.length > 0;
export const checkAdminOperator = (name) => OPERATOR_NAMES.includes(String(name || '').trim());

// --- rate limiting: in-memory is fine for a single Railway instance ---
const attempts = new Map();

const clientKey = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';

export const lockedFor = (req) => {
  const entry = attempts.get(clientKey(req));
  if (!entry || !entry.lockedUntil) return 0;
  const left = entry.lockedUntil - Date.now();
  return left > 0 ? Math.ceil(left / 1000) : 0;
};

const recordFail = (req) => {
  const key = clientKey(req);
  const entry = attempts.get(key) || { fails: 0, lockedUntil: 0 };
  entry.fails += 1;
  if (entry.fails >= MAX_FAILS) {
    entry.lockedUntil = Date.now() + LOCK_MINUTES * 60 * 1000;
    entry.fails = 0;
  }
  attempts.set(key, entry);
};

const clearFails = (req) => attempts.delete(clientKey(req));

export const checkPin = (req, pin) => {
  if (!PIN) return false;
  const candidate = String(pin || '').trim();
  if (!candidate) return false;
  if (!equals(candidate, PIN)) {
    recordFail(req);
    return false;
  }
  clearFails(req);
  return true;
};

export const checkAccessToken = (token) => {
  if (ACCESS_TOKEN.length < 24) return false;
  return equals(String(token || '').trim(), ACCESS_TOKEN);
};

export const setSessionCookie = (req, res) => {
  const secure = req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https');
  res.setHeader('Set-Cookie', [
    `${COOKIE}=${encodeURIComponent(makeToken())}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    `Max-Age=${Math.floor(SESSION_HOURS * 3600)}`
  ].filter(Boolean).join('; '));
};

export const setOperatorCookie = (req, res, name) => {
  const operator = String(name || '').trim();
  if (!checkAdminOperator(operator)) return false;
  const secure = req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https');
  res.append('Set-Cookie', [
    `${OPERATOR_COOKIE}=${encodeURIComponent(makeOperatorToken(operator))}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    `Max-Age=${Math.floor(SESSION_HOURS * 3600)}`
  ].filter(Boolean).join('; '));
  return true;
};

export const clearSessionCookie = (res) => {
  res.setHeader('Set-Cookie', [
    `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    `${OPERATOR_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  ]);
};

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export const safeAdminNext = (value, fallback = '/admin') => {
  const next = String(value || '').trim();
  if (!next.startsWith('/') || next.startsWith('//')) return fallback;
  return ['/admin', '/m', '/m2', '/m3'].some((prefix) => next === prefix || next.startsWith(`${prefix}/`) || next.startsWith(`${prefix}?`))
    ? next
    : fallback;
};

export const operatorPage = (nextPath = '/admin', message = '') => {
  const next = safeAdminNext(nextPath);
  const cards = OPERATOR_NAMES.map((name) => `<button class="person" name="operator" value="${escapeHtml(name)}" type="submit"><span>${escapeHtml(name).slice(0, 1)}</span><strong>${escapeHtml(name)}</strong></button>`).join('');
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>เลือกผู้ใช้งาน · Bill Capture</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;600;700&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:22px;background:#f4f6f8;font-family:'IBM Plex Sans Thai',system-ui,sans-serif;color:#172033}.panel{width:min(520px,100%);padding:26px;background:#fff;border:1px solid #dde3ea;border-radius:16px;box-shadow:0 14px 40px #17203314}.brand{display:flex;align-items:center;gap:11px;margin-bottom:24px}.mark{width:38px;height:38px;display:grid;place-items:center;border-radius:9px;background:#171a1f;color:#fff;font-weight:700}.brand strong{font-size:16px}.brand small{display:block;color:#687386;font-size:12px;font-weight:400}h1{margin:0 0 4px;font-size:20px}p{margin:0 0 18px;color:#687386;font-size:13px}.people{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.person{min-height:112px;display:grid;place-items:center;align-content:center;gap:8px;border:1px solid #dce2e9;border-radius:12px;background:#fff;color:#172033;font:inherit;cursor:pointer;transition:.15s}.person:hover,.person:focus-visible{border-color:#171a1f;box-shadow:0 5px 16px #17203314;transform:translateY(-1px);outline:none}.person span{width:44px;height:44px;display:grid;place-items:center;border-radius:50%;background:#eef2f6;font-size:19px;font-weight:700}.person strong{font-size:15px}.err{margin:0 0 14px;padding:10px;border:1px solid #fecaca;border-radius:9px;background:#fef2f2;color:#b91c1c;font-size:12px}@media(max-width:360px){.people{grid-template-columns:1fr}.person{min-height:82px;grid-template-columns:44px auto;justify-content:start;padding:14px 18px}}</style></head><body><main class="panel"><div class="brand"><span class="mark">฿</span><div><strong>Bill Capture</strong><small>ใช้ได้ทั้งคอมและโทรศัพท์</small></div></div><h1>เลือกผู้ใช้งาน</h1><p>ชื่อที่เลือกจะบันทึกในประวัติการตรวจและการแก้ไข</p>${message ? `<div class="err">${escapeHtml(message)}</div>` : ''}<form class="people" method="POST" action="/api/auth/operator"><input type="hidden" name="next" value="${escapeHtml(next)}">${cards}</form></main></body></html>`;
};

const page = (message = '') => `<!doctype html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Bill Capture</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f6f8;
font-family:'IBM Plex Sans Thai',system-ui,sans-serif;color:#0f172a}
.card{width:min(340px,92vw);padding:26px 24px;background:#fff;border:1px solid #e3e8ef;border-radius:14px;box-shadow:0 10px 30px #0f172a14;text-align:center}
.mark{width:34px;height:34px;margin:0 auto 12px;border-radius:9px;background:#0f172a;color:#fff;display:grid;place-items:center;font-weight:700}
h1{margin:0 0 4px;font-size:16px}p.sub{margin:0 0 18px;font-size:12px;color:#667085}
input{width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:9px;font:inherit;font-size:22px;font-weight:700;
text-align:center;letter-spacing:.35em;-moz-appearance:textfield}
input::-webkit-outer-spin-button,input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
input:focus{outline:2px solid #2563eb;outline-offset:1px;border-color:#2563eb}
button{width:100%;margin-top:12px;padding:11px;border:0;border-radius:9px;background:#2563eb;color:#fff;font:inherit;font-weight:700;cursor:pointer}
button:hover{background:#1d4ed8}
.err{margin-top:12px;padding:9px;border-radius:8px;background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;font-size:12px;font-weight:600}
</style></head><body>
<form class="card" method="POST" action="/api/auth/login">
<div class="mark">฿</div><h1>Bill Capture</h1><p class="sub">ใส่ PIN เพื่อเข้าใช้งาน</p>
<input name="pin" type="password" inputmode="numeric" autocomplete="current-password" autofocus aria-label="PIN">
<button type="submit">เข้าสู่ระบบ</button>
${message ? `<div class="err">${message}</div>` : ''}
</form></body></html>`;

export const loginPage = (message) => page(message);

export const notConfiguredPage = () => `<!doctype html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Bill Capture</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f6f8;font-family:system-ui,sans-serif;color:#0f172a">
<div style="max-width:420px;padding:24px;background:#fff;border:1px solid #fecaca;border-radius:12px">
<h1 style="margin:0 0 8px;font-size:16px;color:#b91c1c">ยังไม่ได้ตั้งค่าการเข้าถึงหลังบ้าน</h1>
<p style="margin:0;font-size:13px;line-height:1.6;color:#475467">
ระบบล็อกไว้เพื่อความปลอดภัย ตั้งค่า <code>ADMIN_ACCESS_TOKEN</code> หรือ <code>ADMIN_PIN</code> ที่ Railway →
service <b>line-bill-capture</b> → Variables แล้วรอ redeploy สักครู่</p>
</div></body></html>`;

const accessLinkRequiredPage = () => `<!doctype html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Bill Capture</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f6f8;font-family:system-ui,sans-serif;color:#0f172a">
<div style="max-width:420px;padding:24px;background:#fff;border:1px solid #e3e8ef;border-radius:12px">
<h1 style="margin:0 0 8px;font-size:16px">ลิงก์หลังบ้านไม่ถูกต้อง</h1>
<p style="margin:0;font-size:13px;line-height:1.6;color:#475467">เปิดจากลิงก์ส่วนตัวของ Bill Capture อีกครั้งเพื่อเข้าใช้งาน</p>
</div></body></html>`;

// Gate for the admin UI: serve the PIN page instead of the app when not signed in.
export const requireAuthPage = (req, res, next) => {
  if (AUTH_DISABLED) return next();
  if (!isAuthConfigured()) return res.status(503).type('html').send(notConfiguredPage());
  if (isSignedIn(req)) {
    if (hasAdminOperators() && !getAdminOperator(req)) {
      const target = safeAdminNext(req.originalUrl || req.url || req.path);
      return res.redirect(303, `/auth/operator?next=${encodeURIComponent(target)}`);
    }
    return next();
  }
  const accessToken = String(req.query?.access || '').trim();
  if (accessToken) {
    if (!checkAccessToken(accessToken)) return res.status(401).type('html').send(accessLinkRequiredPage());
    setSessionCookie(req, res);
    const cleanQuery = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query || {})) {
      if (key === 'access') continue;
      if (Array.isArray(value)) value.forEach((entry) => cleanQuery.append(key, entry));
      else if (value != null) cleanQuery.set(key, String(value));
    }
    const suffix = cleanQuery.toString();
    const target = `${req.path}${suffix ? `?${suffix}` : ''}`;
    return hasAdminOperators()
      ? res.redirect(303, `/auth/operator?next=${encodeURIComponent(safeAdminNext(target))}`)
      : res.redirect(303, target);
  }
  if (PIN) return res.status(401).type('html').send(loginPage());
  return res.status(401).type('html').send(accessLinkRequiredPage());
};

// Gate for the admin API: JSON 401 so the frontend can react.
export const requireAuthApi = (req, res, next) => {
  if (AUTH_DISABLED) return next();
  if (!isAuthConfigured()) {
    return res.status(503).json({ success: false, message: 'Admin access is not configured' });
  }
  if (isSignedIn(req)) {
    if (hasAdminOperators() && !getAdminOperator(req)) {
      return res.status(428).json({ success: false, code: 'operator_required', message: 'กรุณาเลือกผู้ใช้งานก่อน', operator_url: '/auth/operator' });
    }
    return next();
  }
  return res.status(401).json({ success: false, message: 'ต้องเปิดจากลิงก์หลังบ้านก่อนใช้งาน' });
};
