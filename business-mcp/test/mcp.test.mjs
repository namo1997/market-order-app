import test from 'node:test';
import assert from 'node:assert/strict';
import {createMcpHandler} from '@modelcontextprotocol/server';
import {createBusinessServer} from '../src/server.mjs';

test('MCP initialize, tools/list and read-only tool call work over HTTP transport', async () => {
  const config = {branches: [{code: 'KK'}]};
  const client = {name: 'test', branches: ['KK'], allow_person_details: false, employee_ids: []};
  const handler = createMcpHandler(() => createBusinessServer(config, client), {responseMode: 'json'});
  const send = async (id, method, params) => {
    const response = await handler.fetch(new Request('https://example.invalid/mcp', {
      method: 'POST', headers: {'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18'},
      body: JSON.stringify({jsonrpc: '2.0', id, method, params})
    }));
    assert.equal(response.status, 200);
    const text = await response.text();
    if ((response.headers.get('content-type') || '').includes('text/event-stream')) {
      const data = text.split(/\r?\n/).filter(line => line.startsWith('data:')).at(-1)?.slice(5).trim();
      return JSON.parse(data);
    }
    return JSON.parse(text);
  };
  const initialized = await send(1, 'initialize', {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'test', version: '1'}});
  assert.equal(initialized.result.serverInfo.name, 'solao-business-mcp');
  const listed = await send(2, 'tools/list', {});
  assert.ok(listed.result.tools.some(tool => tool.name === 'business_get_overview' && tool.annotations.readOnlyHint === true));
  assert.deepEqual(listed.result.tools.find(tool => tool.name === 'business_get_overview')._meta.securitySchemes, [{type: 'oauth2', scopes: ['business.read']}]);
  const called = await send(3, 'tools/call', {name: 'business_describe_sources', arguments: {}});
  assert.equal(called.result.structuredContent.read_only, true);
  await handler.close();
});
