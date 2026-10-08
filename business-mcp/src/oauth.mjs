import {createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';

const b64 = value => Buffer.from(value).toString('base64url');
const json = value => b64(JSON.stringify(value));
const digest = value => createHash('sha256').update(value).digest();
const safeEqual = (a, b) => a.length === b.length && timingSafeEqual(a, b);
const sendJson = (res, status, value, headers = {}) => {
  res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers});
  res.end(JSON.stringify(value));
};
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export function createOAuth(config, env = process.env) {
  const publicUrl = String(env.BUSINESS_PUBLIC_URL || '').replace(/\/$/, '');
  const secretText = String(env.BUSINESS_OAUTH_SIGNING_KEY || '');
  const passwordHash = String(env.BUSINESS_OAUTH_PASSWORD_SHA256 || '');
  const ownerName = String(env.BUSINESS_OAUTH_CLIENT_NAME || '');
  if (!publicUrl && !secretText && !passwordHash && !ownerName) return null;
  if (!/^https:\/\/[^/?#]+$/.test(publicUrl) || !/^[A-Za-z0-9_-]{43,}$/.test(secretText) || !/^[a-f0-9]{64}$/.test(passwordHash) || !config.clients.some(c => c.name === ownerName)) throw new Error('Invalid OAuth configuration');
  const key = Buffer.from(secretText, 'base64url');
  if (key.length < 32) throw new Error('OAuth signing key too short');
  const transactions = new Map();
  const codes = new Map();
  const loginAttempts = new Map();
  const sign = value => b64(createHmac('sha256', key).update(value).digest());
  const compact = payload => {const body = json(payload); return `${body}.${sign(body)}`;};
  const unpack = value => {
    if (typeof value !== 'string' || value.length > 4000) return null;
    const [body, signature, extra] = value.split('.');
    if (!body || !signature || extra || !safeEqual(Buffer.from(signature), Buffer.from(sign(body)))) return null;
    try {return JSON.parse(Buffer.from(body, 'base64url').toString());} catch {return null;}
  };
  const token = (type, sub, clientId, ttl) => {
    const now = Math.floor(Date.now() / 1000);
    return compact({typ: type, iss: publicUrl, aud: publicUrl, sub, client_id: clientId, scope: 'business.read', iat: now, exp: now + ttl, jti: b64(randomBytes(18))});
  };
  const verifyToken = value => {
    const claims = unpack(value);
    const now = Math.floor(Date.now() / 1000);
    if (!claims || claims.typ !== 'access' || claims.iss !== publicUrl || claims.aud !== publicUrl || claims.scope !== 'business.read' || !Number.isInteger(claims.exp) || claims.exp <= now || claims.iat > now + 60) return null;
    return config.clients.find(c => c.name === claims.sub) || null;
  };
  const redirectAllowed = uri => {
    try {
      const parsed = new URL(uri);
      return parsed.protocol === 'https:' && parsed.hostname === 'chatgpt.com' && (/^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(parsed.pathname) || parsed.pathname === '/connector_platform_oauth_redirect') && !parsed.hash;
    } catch {return false;}
  };
  const clientForId = id => {
    const record = unpack(id);
    return record?.typ === 'dcr' && redirectAllowed(record.redirect_uri) ? record : null;
  };
  const readBody = async (req, limit = 8192) => {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {size += chunk.length; if (size > limit) throw new Error('Request too large'); chunks.push(chunk);}
    return Buffer.concat(chunks).toString('utf8');
  };
  const metadata = {
    resource: publicUrl,
    authorization_servers: [publicUrl],
    scopes_supported: ['business.read']
  };
  const authorizationMetadata = {
    issuer: publicUrl,
    authorization_response_iss_parameter_supported: true,
    authorization_endpoint: `${publicUrl}/oauth/authorize`,
    token_endpoint: `${publicUrl}/oauth/token`,
    registration_endpoint: `${publicUrl}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['business.read']
  };
  const challenge = `Bearer resource_metadata="${publicUrl}/.well-known/oauth-protected-resource", scope="business.read"`;

  async function route(req, res, parsed) {
    if (req.method === 'GET' && parsed.pathname === '/.well-known/oauth-protected-resource') {sendJson(res, 200, metadata); return true;}
    if (req.method === 'GET' && parsed.pathname === '/.well-known/oauth-authorization-server') {sendJson(res, 200, authorizationMetadata); return true;}
    if (req.method === 'POST' && parsed.pathname === '/oauth/register') {
      try {
        const input = JSON.parse(await readBody(req));
        const redirectUri = input.redirect_uris?.length === 1 ? input.redirect_uris[0] : null;
        const authMethod = input.token_endpoint_auth_method || 'none';
        if (!redirectAllowed(redirectUri) || !['none', 'client_secret_post', 'client_secret_basic'].includes(authMethod) || input.grant_types?.some(g => !['authorization_code', 'refresh_token'].includes(g))) throw new Error('Invalid client');
        const clientId = compact({typ: 'dcr', redirect_uri: redirectUri, auth_method: authMethod});
        sendJson(res, 201, {client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000), redirect_uris: [redirectUri], token_endpoint_auth_method: authMethod, ...(authMethod === 'none' ? {} : {client_secret: sign(`secret:${clientId}`), client_secret_expires_at: 0}), grant_types: ['authorization_code', 'refresh_token'], response_types: ['code']});
      } catch {sendJson(res, 400, {error: 'invalid_client_metadata'});}
      return true;
    }
    if (req.method === 'GET' && parsed.pathname === '/oauth/authorize') {
      for (const [id, record] of transactions) if (record.expires < Date.now()) transactions.delete(id);
      for (const [id, record] of codes) if (record.expires < Date.now()) codes.delete(id);
      if (transactions.size >= 1000) {sendJson(res, 429, {error: 'temporarily_unavailable'}); return true;}
      const q = parsed.searchParams;
      const client = clientForId(q.get('client_id'));
      const state = q.get('state') || '';
      const challengeValue = q.get('code_challenge') || '';
      if (!client || q.get('redirect_uri') !== client.redirect_uri || q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(challengeValue) || !state || state.length > 2048 || q.get('resource') !== publicUrl || !String(q.get('scope') || '').split(' ').includes('business.read')) {sendJson(res, 400, {error: 'invalid_request'}); return true;}
      const tx = b64(randomBytes(24));
      transactions.set(tx, {clientId: q.get('client_id'), redirectUri: client.redirect_uri, state, challenge: challengeValue, expires: Date.now() + 600000});
      const html = `<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SOLAO Business MCP</title><body><main style="font:16px system-ui;max-width:32rem;margin:3rem auto;padding:1rem"><h1>อนุญาตการอ่านข้อมูล SOLAO</h1><p>ChatGPT ขอสิทธิ์ <strong>business.read</strong> สำหรับสาขาที่กำหนดไว้ใน Gateway ไม่มีสิทธิ์แก้ข้อมูล</p><form action="/oauth/authorize" method="post"><input type="hidden" name="tx" value="${esc(tx)}"><label>รหัสผ่านเจ้าของ <input type="password" name="password" required autocomplete="current-password"></label><p><label><input type="checkbox" name="consent" value="yes" required> ยืนยันการเชื่อมต่อแบบอ่านอย่างเดียว</label></p><button type="submit">อนุญาต</button></form></main></body></html>`;
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", 'X-Frame-Options': 'DENY'});
      res.end(html);
      return true;
    }
    if (req.method === 'POST' && parsed.pathname === '/oauth/authorize') {
      try {
        const input = new URLSearchParams(await readBody(req));
        const tx = transactions.get(input.get('tx'));
        transactions.delete(input.get('tx'));
        if (!tx || tx.expires < Date.now() || input.get('consent') !== 'yes') throw new Error('Invalid authorization');
        const ip = req.socket.remoteAddress || 'unknown';
        const recent = (loginAttempts.get(ip) || []).filter(time => time > Date.now() - 60000);
        if (recent.length >= 5) throw new Error('Rate limited');
        recent.push(Date.now()); loginAttempts.set(ip, recent);
        const supplied = digest(input.get('password') || '');
        if (!safeEqual(supplied, Buffer.from(passwordHash, 'hex'))) throw new Error('Invalid authorization');
        const code = b64(randomBytes(32));
        codes.set(code, {...tx, sub: ownerName, expires: Date.now() + 120000});
        const redirect = new URL(tx.redirectUri);
        redirect.searchParams.set('code', code);
        redirect.searchParams.set('state', tx.state);
        redirect.searchParams.set('iss', publicUrl);
        res.writeHead(302, {Location: redirect.toString(), 'Cache-Control': 'no-store'}); res.end();
      } catch {sendJson(res, 401, {error: 'access_denied'});}
      return true;
    }
    if (req.method === 'POST' && parsed.pathname === '/oauth/token') {
      try {
        const input = new URLSearchParams(await readBody(req));
        const grant = input.get('grant_type');
        const basicRaw = /^Basic (.+)$/.exec(req.headers.authorization || '')?.[1];
        const basicDecoded = basicRaw ? Buffer.from(basicRaw, 'base64').toString('utf8') : '';
        const separator = basicDecoded.indexOf(':');
        const basicId = separator >= 0 ? decodeURIComponent(basicDecoded.slice(0, separator)) : null;
        const basicSecret = separator >= 0 ? decodeURIComponent(basicDecoded.slice(separator + 1)) : '';
        const clientId = input.get('client_id') || basicId;
        const client = clientForId(clientId);
        if (!client || input.get('resource') !== publicUrl) throw new Error('Invalid client');
        if (client.auth_method === 'client_secret_post' && !safeEqual(Buffer.from(input.get('client_secret') || ''), Buffer.from(sign(`secret:${clientId}`)))) throw new Error('Invalid client secret');
        if (client.auth_method === 'client_secret_basic') {
          if (basicId !== clientId || !safeEqual(Buffer.from(basicSecret || ''), Buffer.from(sign(`secret:${clientId}`)))) throw new Error('Invalid client secret');
        }
        let sub;
        if (grant === 'authorization_code') {
          const codeValue = input.get('code');
          const record = codes.get(codeValue);
          codes.delete(codeValue);
          const verifier = input.get('code_verifier') || '';
          if (!record || record.expires < Date.now() || record.clientId !== clientId || record.redirectUri !== input.get('redirect_uri') || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || b64(digest(verifier)) !== record.challenge) throw new Error('Invalid grant');
          sub = record.sub;
        } else if (grant === 'refresh_token') {
          const claims = unpack(input.get('refresh_token'));
          if (!claims || claims.typ !== 'refresh' || claims.iss !== publicUrl || claims.aud !== publicUrl || claims.client_id !== clientId || claims.exp <= Math.floor(Date.now() / 1000) || claims.scope !== 'business.read') throw new Error('Invalid grant');
          sub = claims.sub;
        } else throw new Error('Unsupported grant');
        sendJson(res, 200, {access_token: token('access', sub, clientId, 3600), token_type: 'Bearer', expires_in: 3600, refresh_token: token('refresh', sub, clientId, 2592000), scope: 'business.read'});
      } catch {sendJson(res, 400, {error: 'invalid_grant'});}
      return true;
    }
    return false;
  }

  return {route, verifyToken, challenge, publicUrl};
}
