import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createHttpServer} from '../src/http.mjs';

test('HTTP route requires bearer and completes MCP handshake', async () => {
  const token = 'b'.repeat(48);
  const config = {branches: [{code: 'KK'}], clients: [{name: 'owner', token_sha256: createHash('sha256').update(token).digest('hex'), branches: ['KK']}], urls: {}, bearers: {hrmsByBranch: {}}};
  const server = createHttpServer(config);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
  try {
    const body = JSON.stringify({jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'test', version: '1'}}});
    const denied = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json'}, body});
    assert.equal(denied.status, 401);
    const allowed = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`}, body});
    assert.equal(allowed.status, 200);
    assert.match(await allowed.text(), /solao-business-mcp/);
    const modern = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/list'}, body: JSON.stringify({jsonrpc: '2.0', id: 2, method: 'tools/list', params: {_meta: {'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': {name: 'modern-test', version: '1'}, 'io.modelcontextprotocol/clientCapabilities': {}}}})});
    assert.equal(modern.status, 200);
    assert.equal((await modern.json()).result.tools.length, 15);
    const blockedOrigin = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${token}`, origin: 'https://evil.example'}, body});
    assert.equal(blockedOrigin.status, 403);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
