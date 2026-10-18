import { readFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';

// Credentials are read only at runtime from an owner-provided file outside git.
// Never use provider error text: it can contain the registration token.
const signJwt = (content, key) => { const signer = createSign('RSA-SHA256'); signer.update(content); return signer.sign(key, 'base64url'); };
export function createFcm({ env = process.env, read = readFile, fetcher = fetch, now = Date.now, sign = signJwt } = {}) {
  let credential, access, expires = 0;
  const configured = () => Boolean(env.RECEIVING_FCM_SERVICE_ACCOUNT_FILE);
  const json = async (url, options) => {
    const response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    return { response, data };
  };
  async function auth() {
    if (access && now() < expires) return access;
    credential ||= JSON.parse(await read(env.RECEIVING_FCM_SERVICE_ACCOUNT_FILE, 'utf8'));
    if (!/^[a-z][a-z0-9-]{3,62}$/.test(credential.project_id) ||
        typeof credential.client_email !== 'string' || typeof credential.private_key !== 'string') throw Error('FCM_CONFIG');
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const issued = Math.floor(now() / 1000);
    const content = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: credential.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: issued, exp: issued + 3600 })}`;
    const assertion = `${content}.${sign(content, credential.private_key)}`;
    const { response, data } = await json('https://oauth2.googleapis.com/token', { method: 'POST',
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
    if (!response.ok || !data.access_token) throw Error('FCM_AUTH');
    access = data.access_token; expires = now() + Math.max(0, Number(data.expires_in || 3600) - 60) * 1000;
    return access;
  }
  return { configured, async send(token, data) {
    if (!configured()) return { disabled: true };
    try {
      const bearer = await auth();
      const { response, data: result } = await json(`https://fcm.googleapis.com/v1/projects/${credential.project_id}/messages:send`, {
        method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token, data, android: { priority: 'high', ttl: '86400s' } } }) });
      if (response.ok) return { sent: true };
      if (response.status === 401) { access = null; expires = 0; }
      const invalid = result?.error?.details?.some(detail => detail.errorCode === 'UNREGISTERED');
      return { invalid: Boolean(invalid), retry: !invalid && (response.status === 429 || response.status >= 500 || response.status === 401) };
    } catch { return { retry: true }; }
  } };
}
