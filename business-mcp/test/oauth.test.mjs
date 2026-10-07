import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createHttpServer} from '../src/http.mjs';

test('owner OAuth PKCE flow yields scoped MCP access and supports refresh', async () => {
  const password = 'owner-secret-long-random-value';
  const config = {branches: [{code: 'KK'}], clients: [{name: 'owner', token_sha256: '0'.repeat(64), branches: ['KK']}], urls: {}, bearers: {hrmsByBranch: {}}};
  const env = {BUSINESS_PUBLIC_URL: 'https://mcp.example', BUSINESS_OAUTH_SIGNING_KEY: Buffer.alloc(48, 7).toString('base64url'), BUSINESS_OAUTH_PASSWORD_SHA256: createHash('sha256').update(password).digest('hex'), BUSINESS_OAUTH_CLIENT_NAME: 'owner'};
  const server = createHttpServer(config, env);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const metadata = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
    assert.equal(metadata.resource, env.BUSINESS_PUBLIC_URL);
    const blocked = await fetch(`${base}/mcp`, {method: 'POST'});
    assert.equal(blocked.status, 401);
    assert.match(blocked.headers.get('www-authenticate'), /resource_metadata/);
    const callback = 'https://chatgpt.com/connector_platform_oauth_redirect';
    const registered = await (await fetch(`${base}/oauth/register`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({redirect_uris: [callback], token_endpoint_auth_method: 'none'})})).json();
    assert.ok(registered.client_id);
    const verifier = 'v'.repeat(50);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const query = new URLSearchParams({client_id: registered.client_id, redirect_uri: callback, response_type: 'code', state: 'state-1', code_challenge: challenge, code_challenge_method: 'S256', resource: env.BUSINESS_PUBLIC_URL, scope: 'business.read'});
    const form = await (await fetch(`${base}/oauth/authorize?${query}`)).text();
    const tx = /name="tx" value="([^"]+)"/.exec(form)?.[1];
    assert.ok(tx);
    const consent = await fetch(`${base}/oauth/authorize`, {method: 'POST', redirect: 'manual', headers: {'content-type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({tx, password, consent: 'yes'})});
    assert.equal(consent.status, 302);
    const redirect = new URL(consent.headers.get('location'));
    assert.equal(redirect.searchParams.get('state'), 'state-1');
    assert.equal(redirect.searchParams.get('iss'), env.BUSINESS_PUBLIC_URL);
    const code = redirect.searchParams.get('code');
    const tokenResponse = await fetch(`${base}/oauth/token`, {method: 'POST', body: new URLSearchParams({grant_type: 'authorization_code', code, client_id: registered.client_id, redirect_uri: callback, code_verifier: verifier, resource: env.BUSINESS_PUBLIC_URL})});
    assert.equal(tokenResponse.status, 200);
    const tokens = await tokenResponse.json();
    const replay = await fetch(`${base}/oauth/token`, {method: 'POST', body: new URLSearchParams({grant_type: 'authorization_code', code, client_id: registered.client_id, redirect_uri: callback, code_verifier: verifier, resource: env.BUSINESS_PUBLIC_URL})});
    assert.equal(replay.status, 400);
    const call = await fetch(`${base}/mcp`, {method: 'POST', headers: {authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}})});
    assert.equal(call.status, 200);
    assert.match(await call.text(), /business_get_overview/);
    const refresh = await fetch(`${base}/oauth/token`, {method: 'POST', body: new URLSearchParams({grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: registered.client_id, resource: env.BUSINESS_PUBLIC_URL})});
    assert.equal(refresh.status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
