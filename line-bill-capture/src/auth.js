import crypto from 'crypto';

// PIN authentication for the admin UI and admin API.
//
// The PIN itself lives ONLY in the ADMIN_PIN env var (Railway) — never in code or git.
// A PIN is low entropy by nature (a few digits), so the rate limiter below is not optional:
// it is what makes a short PIN safe against brute force.

const PIN = String(process.env.ADMIN_PIN || '').trim();
const SESSION_HOURS = Number(process.env.ADMIN_SESSION_HOURS || 24 * 30);
const MAX_FAILS = Number(process.env.ADMIN_MAX_FAILS || 5);
const LOCK_MINUTES = Number(process.env.ADMIN_LOCK_MINUTES || 15);
const COOKIE = 'lbc_session';

// Signing key: a per-boot random secret unless one is configured, mixed with the PIN so that
// changing the PIN invalidates every existing session. Never derive the key from the PIN alone —
// a 4-digit key would be trivially brute-forced offline from a single captured cookie.
const SESSION_SECRET = String(process.env.ADMIN_SESSION_SECRET || '').trim() || crypto.randomBytes(32).toString('hex');
const signingKey = crypto.createHmac('sha256', SESSION_SECRET).update(`pin:${PIN}`).digest();

export const isAuthConfigured = () => PIN.length > 0;

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
  if (!isAuthConfigured()) return false;
  const candidate = String(pin || '').trim();
  if (!candidate) return false;
  if (!equals(candidate, PIN)) {
    recordFail(req);
    return false;
  }
  clearFails(req);
  return true;
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

export const clearSessionCookie = (res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
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
<h1 style="margin:0 0 8px;font-size:16px;color:#b91c1c">ยังไม่ได้ตั้งค่า ADMIN_PIN</h1>
<p style="margin:0;font-size:13px;line-height:1.6;color:#475467">
ระบบล็อกไว้เพื่อความปลอดภัย ตั้งค่า <code>ADMIN_PIN</code> ที่ Railway →
service <b>line-bill-capture</b> → Variables แล้วรอ redeploy สักครู่</p>
</div></body></html>`;

// Gate for the admin UI: serve the PIN page instead of the app when not signed in.
export const requireAuthPage = (req, res, next) => {
  if (!isAuthConfigured()) return res.status(503).type('html').send(notConfiguredPage());
  if (isSignedIn(req)) return next();
  return res.status(401).type('html').send(loginPage());
};

// Gate for the admin API: JSON 401 so the frontend can react.
export const requireAuthApi = (req, res, next) => {
  if (!isAuthConfigured()) {
    return res.status(503).json({ success: false, message: 'ADMIN_PIN is not configured' });
  }
  if (isSignedIn(req)) return next();
  return res.status(401).json({ success: false, message: 'ต้องใส่ PIN ก่อนใช้งาน' });
};
