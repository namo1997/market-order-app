import { createPublicKey } from 'node:crypto';
import jwt from 'jsonwebtoken';

export class GoogleAuthError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
export const normalizeGoogleEmail = value => {
  if (typeof value !== 'string') throw new GoogleAuthError(422, 'INVALID_GOOGLE_EMAIL');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[\x21-\x7e]+$/.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new GoogleAuthError(422, 'INVALID_GOOGLE_EMAIL');
  }
  return email;
};

// Fixed Google endpoint: token header URLs are never followed. Coalesce refreshes
// and throttle unknown kids so forged tokens cannot force unbounded JWKS traffic.
export function createGoogleIdTokenVerifier({ fetcher = globalThis.fetch, now = Date.now,
  clientIds = () => process.env.GOOGLE_OAUTH_CLIENT_IDS || '' } = {}) {
  let keys = [], expires = 0, refreshAfter = 0, pending;
  async function refresh() {
    if (pending) return pending;
    if (now() < refreshAfter) return;
    refreshAfter = now() + 30000;
    pending = (async () => {
      try {
        const response = await fetcher('https://www.googleapis.com/oauth2/v3/certs', {
          signal: AbortSignal.timeout(5000), redirect: 'error',
        });
        if (!response.ok) throw new Error('JWKS unavailable');
        const body = await response.json();
        if (!Array.isArray(body.keys) || body.keys.length > 20) throw new Error('Invalid JWKS');
        keys = body.keys.filter(k => k.kty === 'RSA' && k.use === 'sig' && k.alg === 'RS256');
        const age = Number(/max-age=(\d+)/i.exec(response.headers?.get('cache-control') || '')?.[1] || 300);
        expires = now() + Math.min(Math.max(age, 30), 3600) * 1000;
      } catch { throw new GoogleAuthError(503, 'GOOGLE_AUTH_UNAVAILABLE'); }
    })();
    try { await pending; } finally { pending = null; }
  }
  return async idToken => {
    const audience = clientIds().split(',').map(v => v.trim()).filter(Boolean);
    if (!audience.length) throw new GoogleAuthError(503, 'GOOGLE_AUTH_NOT_CONFIGURED');
    if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > 16384) {
      throw new GoogleAuthError(422, 'INVALID_ID_TOKEN');
    }
    let decoded;
    try { decoded = jwt.decode(idToken, { complete: true }); }
    catch { throw new GoogleAuthError(401, 'INVALID_GOOGLE_TOKEN'); }
    if (decoded?.header?.alg !== 'RS256' || typeof decoded.header.kid !== 'string' || decoded.header.kid.length > 256) {
      throw new GoogleAuthError(401, 'INVALID_GOOGLE_TOKEN');
    }
    if (now() >= expires || !keys.some(k => k.kid === decoded.header.kid)) await refresh();
    const key = keys.find(k => k.kid === decoded.header.kid);
    if (!key || now() >= expires) throw new GoogleAuthError(401, 'INVALID_GOOGLE_TOKEN');
    try {
      const claims = jwt.verify(idToken, createPublicKey({ key, format: 'jwk' }), {
        algorithms: ['RS256'], audience, issuer: ['accounts.google.com', 'https://accounts.google.com'],
        clockTimestamp: Math.floor(now() / 1000), clockTolerance: 0,
      });
      if (!Number.isFinite(claims.exp) || !claims.sub || typeof claims.sub !== 'string' || claims.email_verified !== true) {
        throw new Error('Invalid claims');
      }
      return { email: normalizeGoogleEmail(claims.email), sub: claims.sub };
    } catch { throw new GoogleAuthError(401, 'INVALID_GOOGLE_TOKEN'); }
  };
}
