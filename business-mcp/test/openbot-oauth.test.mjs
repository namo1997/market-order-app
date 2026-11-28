import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createHttpServer} from '../src/http.mjs';

const password = 'owner-secret-long-random-value';
const env = {BUSINESS_PUBLIC_URL: 'https://mcp.example', BUSINESS_OAUTH_SIGNING_KEY: Buffer.alloc(48, 9).toString('base64url'), BUSINESS_OAUTH_PASSWORD_SHA256: createHash('sha256').update(password).digest('hex'), BUSINESS_OAUTH_CLIENT_NAME: 'owner'};
const config = {branches: [{code: 'KK'}], clients: [{name: 'owner', branches: ['KK']}], urls: {}, bearers: {hrmsByBranch: {}}};
const openbotCallback = 'http://127.0.0.1:28417/mcp-auth';
const verifier = 'o'.repeat(64);
const codeChallenge = createHash('sha256').update(verifier).digest('base64url');

async function withServer(run) {
  const server = createHttpServer(config, env);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {await run(`http://127.0.0.1:${server.address().port}`);} finally {await new Promise(resolve => server.close(resolve));}
}
const register = (base, redirectUris) => fetch(`${base}/oauth/register`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({client_name: 'OpenBot', redirect_uris: redirectUris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code']})});
const rpcResult = text => JSON.parse(text.startsWith('event:') ? /^data: (.+)$/m.exec(text)[1] : text);

test('DCR accepts only the exact OpenBot loopback callback', async () => {
  await withServer(async base => {
    const ok = await register(base, [openbotCallback]);
    assert.equal(ok.status, 201);
    assert.deepEqual((await ok.json()).redirect_uris, [openbotCallback]);
    for (const uri of ['http://127.0.0.1:28418/mcp-auth', 'http://127.0.0.1/mcp-auth', 'http://localhost:28417/mcp-auth', 'http://[::1]:28417/mcp-auth', 'https://127.0.0.1:28417/mcp-auth', 'http://127.0.0.1:28417/mcp-auth/', 'http://127.0.0.1:28417/mcp-auth?x=1', 'http://127.0.0.1:28417/mcp-auth#x', 'http://127.0.0.1:28417/callback', 'http://127.0.0.2:28417/mcp-auth', 'https://openbot.run/oauth/mcp-callback', 'openbot://mcp-auth']) {
      assert.equal((await register(base, [uri])).status, 400, uri);
    }
    assert.equal((await register(base, [openbotCallback, 'https://claude.ai/api/mcp/auth_callback'])).status, 400, 'one redirect URI per client');
  });
});

test('OpenBot connects through the owner consent page, PKCE, refresh and read-only MCP', async () => {
  await withServer(async base => {
    const client = await (await register(base, [openbotCallback])).json();
    const query = new URLSearchParams({client_id: client.client_id, redirect_uri: openbotCallback, response_type: 'code', state: 'openbot-state', code_challenge: codeChallenge, code_challenge_method: 'S256', resource: `${env.BUSINESS_PUBLIC_URL}/mcp`, scope: 'business.read'});
    const page = await fetch(`${base}/oauth/authorize?${query}`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /form-action 'self' [^;]*http:\/\/127\.0\.0\.1:28417\/mcp-auth;/);
    const html = await page.text();
    assert.match(html, /OpenBot \(<strong>127\.0\.0\.1<\/strong>\) ขอสิทธิ์/);
    const tx = /name="tx" value="([^"]+)"/.exec(html)?.[1];
    assert.ok(tx);

    const consent = await fetch(`${base}/oauth/authorize`, {method: 'POST', redirect: 'manual', body: new URLSearchParams({tx, password, consent: 'yes'})});
    assert.equal(consent.status, 302);
    const redirect = new URL(consent.headers.get('location'));
    assert.equal(`${redirect.origin}${redirect.pathname}`, openbotCallback);
    assert.equal(redirect.searchParams.get('state'), 'openbot-state');

    const exchange = await fetch(`${base}/oauth/token`, {method: 'POST', body: new URLSearchParams({grant_type: 'authorization_code', code: redirect.searchParams.get('code'), client_id: client.client_id, redirect_uri: openbotCallback, code_verifier: verifier})});
    assert.equal(exchange.status, 200);
    const tokens = await exchange.json();
    assert.equal(tokens.scope, 'business.read');

    const call = await fetch(`${base}/mcp`, {method: 'POST', headers: {authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}})});
    assert.equal(call.status, 200);
    assert.equal(rpcResult(await call.text()).result.tools.length, 17);

    const refreshed = await fetch(`${base}/oauth/token`, {method: 'POST', body: new URLSearchParams({grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id})});
    assert.equal(refreshed.status, 200);
  });
});

test('an OpenBot client cannot swap its redirect to another callback', async () => {
  await withServer(async base => {
    const client = await (await register(base, [openbotCallback])).json();
    for (const redirect of ['https://claude.ai/api/mcp/auth_callback', 'http://127.0.0.1:28418/mcp-auth']) {
      const query = new URLSearchParams({client_id: client.client_id, redirect_uri: redirect, response_type: 'code', state: 's', code_challenge: codeChallenge, code_challenge_method: 'S256'});
      assert.equal((await fetch(`${base}/oauth/authorize?${query}`)).status, 400, redirect);
    }
  });
});
