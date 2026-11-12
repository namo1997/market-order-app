import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createHttpServer} from '../src/http.mjs';

const password = 'owner-secret-long-random-value';
const env = {BUSINESS_PUBLIC_URL: 'https://mcp.example', BUSINESS_OAUTH_SIGNING_KEY: Buffer.alloc(48, 9).toString('base64url'), BUSINESS_OAUTH_PASSWORD_SHA256: createHash('sha256').update(password).digest('hex'), BUSINESS_OAUTH_CLIENT_NAME: 'owner'};
const config = {branches: [{code: 'KK'}], clients: [{name: 'owner', branches: ['KK']}], urls: {}, bearers: {hrmsByBranch: {}}};
const claudeCallback = 'https://claude.ai/api/mcp/auth_callback';
const verifier = 'c'.repeat(64);
const codeChallenge = createHash('sha256').update(verifier).digest('base64url');

async function withServer(run) {
  const server = createHttpServer(config, env);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {await run(`http://127.0.0.1:${server.address().port}`);} finally {await new Promise(resolve => server.close(resolve));}
}
const register = (base, redirectUris, method = 'none') => fetch(`${base}/oauth/register`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({client_name: 'Claude', redirect_uris: redirectUris, token_endpoint_auth_method: method, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code']})});
const authorizeQuery = (clientId, extra = {}) => {
  const params = {client_id: clientId, redirect_uri: claudeCallback, response_type: 'code', state: 'claude-state', code_challenge: codeChallenge, code_challenge_method: 'S256', ...extra};
  for (const [key, value] of Object.entries(params)) if (value === undefined) delete params[key];
  return new URLSearchParams(params);
};
// Stateless legacy calls may answer as one SSE `message` event; modern-envelope calls answer as plain JSON.
const rpcResult = text => JSON.parse(text.startsWith('event:') ? /^data: (.+)$/m.exec(text)[1] : text);
const listTools = (url, accessToken) =>fetch(url, {method: 'POST', headers: {authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}})});

test('DCR accepts only the exact Claude hosted-app callbacks', async () => {
  await withServer(async base => {
    for (const uri of [claudeCallback, 'https://claude.com/api/mcp/auth_callback']) {
      const response = await register(base, [uri]);
      assert.equal(response.status, 201, uri);
      assert.deepEqual((await response.json()).redirect_uris, [uri]);
    }
    for (const uri of ['http://claude.ai/api/mcp/auth_callback', 'https://claude.ai/api/mcp/auth_callback/', 'https://claude.ai/api/mcp/auth_callback?x=1', 'https://claude.ai/api/mcp/auth_callback#x', 'https://claude.ai/api/mcp/other', 'https://claude.ai.evil.example/api/mcp/auth_callback', 'https://evil.example/api/mcp/auth_callback', 'https://claude.ai:8443/api/mcp/auth_callback', 'http://localhost:3118/callback']) {
      assert.equal((await register(base, [uri])).status, 400, uri);
    }
    assert.equal((await register(base, [claudeCallback, 'https://claude.com/api/mcp/auth_callback'])).status, 400, 'one redirect URI per client');
  });
});

test('Claude connects with the bare Gateway URL through discovery, PKCE, refresh and MCP', async () => {
  await withServer(async base => {
    const resourceMetadata = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
    assert.equal(resourceMetadata.resource, env.BUSINESS_PUBLIC_URL, 'Claude requires resource to equal the URL the user enters');
    assert.deepEqual(resourceMetadata.authorization_servers, [env.BUSINESS_PUBLIC_URL]);
    const unauthenticated = await fetch(`${base}/`, {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'});
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.headers.get('www-authenticate'), `Bearer resource_metadata="${env.BUSINESS_PUBLIC_URL}/.well-known/oauth-protected-resource", scope="business.read"`);

    const client = await (await register(base, [claudeCallback])).json();
    // Claude may normalise the bare origin with a trailing slash; scope comes from the 401 challenge but may be omitted.
    const page = await fetch(`${base}/oauth/authorize?${authorizeQuery(client.client_id, {resource: `${env.BUSINESS_PUBLIC_URL}/`})}`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /form-action 'self' [^;]*https:\/\/claude\.ai\/api\/mcp\/auth_callback[^;]*https:\/\/claude\.com\/api\/mcp\/auth_callback;/);
    assert.doesNotMatch(page.headers.get('content-security-policy'), /\$\{/);
    const html = await page.text();
    assert.match(html, /Claude \(<strong>claude\.ai<\/strong>\) ขอสิทธิ์/);
    const tx = /name="tx" value="([^"]+)"/.exec(html)?.[1];
    assert.ok(tx);

    const wrongPassword = await fetch(`${base}/oauth/authorize`, {method: 'POST', redirect: 'manual', body: new URLSearchParams({tx, password: 'wrong', consent: 'yes'})});
    assert.equal(wrongPassword.status, 401);
    const tx2 = /name="tx" value="([^"]+)"/.exec(await (await fetch(`${base}/oauth/authorize?${authorizeQuery(client.client_id, {scope: 'business.read'})}`)).text())?.[1];
    const consent = await fetch(`${base}/oauth/authorize`, {method: 'POST', redirect: 'manual', body: new URLSearchParams({tx: tx2, password, consent: 'yes'})});
    assert.equal(consent.status, 302);
    const redirect = new URL(consent.headers.get('location'));
    assert.equal(`${redirect.origin}${redirect.pathname}`, claudeCallback);
    assert.equal(redirect.searchParams.get('state'), 'claude-state');
    assert.equal(redirect.searchParams.get('iss'), env.BUSINESS_PUBLIC_URL);

    const exchange = await fetch(`${base}/oauth/token`, {method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({grant_type: 'authorization_code', code: redirect.searchParams.get('code'), client_id: client.client_id, redirect_uri: claudeCallback, code_verifier: verifier})});
    assert.equal(exchange.status, 200);
    const tokens = await exchange.json();
    assert.equal(tokens.scope, 'business.read');
    assert.ok(tokens.refresh_token);

    for (const path of ['/', '/mcp']) {
      const call = await listTools(`${base}${path}`, tokens.access_token);
      assert.equal(call.status, 200, path);
      assert.equal(rpcResult(await call.text()).result.tools.length, 17, path);
    }

    const refreshed = await fetch(`${base}/oauth/token`, {method: 'POST', body: new URLSearchParams({grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id, resource: `${env.BUSINESS_PUBLIC_URL}/mcp`})});
    assert.equal(refreshed.status, 200);
    const foreign = await fetch(`${base}/oauth/token`, {method: 'POST', body: new URLSearchParams({grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id, resource: 'https://other.example'})});
    assert.equal(foreign.status, 400);
    assert.equal((await foreign.json()).error, 'invalid_grant');
  });
});

test('authorization still rejects a foreign resource, missing read scope and mismatched redirect', async () => {
  await withServer(async base => {
    const client = await (await register(base, [claudeCallback])).json();
    for (const extra of [{resource: 'https://other.example'}, {resource: ''}, {resource: `${env.BUSINESS_PUBLIC_URL}/other`}, {scope: 'business.write'}, {scope: ''}, {redirect_uri: 'https://claude.com/api/mcp/auth_callback'}, {code_challenge_method: 'plain'}]) {
      const response = await fetch(`${base}/oauth/authorize?${authorizeQuery(client.client_id, extra)}`);
      assert.equal(response.status, 400, JSON.stringify(extra));
    }
  });
});

test('ChatGPT consent page names its host and MCP paths answer unsupported methods with 405', async () => {
  await withServer(async base => {
    const callback = 'https://chatgpt.com/connector_platform_oauth_redirect';
    const client = await (await register(base, [callback])).json();
    const query = authorizeQuery(client.client_id, {redirect_uri: callback, resource: env.BUSINESS_PUBLIC_URL, scope: 'business.read'});
    assert.match(await (await fetch(`${base}/oauth/authorize?${query}`)).text(), /ChatGPT \(<strong>chatgpt\.com<\/strong>\) ขอสิทธิ์/);
    for (const [method, path] of [['GET', '/'], ['GET', '/mcp'], ['DELETE', '/mcp']]) {
      const response = await fetch(`${base}${path}`, {method});
      assert.equal(response.status, 405, `${method} ${path}`);
      assert.equal(response.headers.get('allow'), 'POST');
    }
    assert.equal((await fetch(`${base}/mcp/extra`, {method: 'POST'})).status, 404);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  });
});
