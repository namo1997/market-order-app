import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {createMcpHandler} from '@modelcontextprotocol/server';
import {loadConfig, clientForBearer} from './config.mjs';
import {createBusinessServer} from './server.mjs';
import {createOAuth} from './oauth.mjs';

export function createHttpServer(config, env = process.env) {
  if (!config.clients.length || !config.branches.length) throw new Error('MCP client and branch policies are required');
  const oauth = createOAuth(config, env);
  if (!oauth && !config.clients.some(client => client.token_sha256)) throw new Error('No MCP authentication configured');
  const handlers = new Map(config.clients.map(client => [client.name, createMcpHandler(() => createBusinessServer(config, client), {responseMode: 'json'})]));
  return http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const parsed = new URL(req.url || '/', 'http://localhost');
  if (oauth && await oauth.route(req, res, parsed)) return;
  if (req.url === '/health' && req.method === 'GET') {res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify({status: 'ok', service: 'business-mcp'})); return;}
  if (req.url !== '/mcp' || req.method !== 'POST') {res.writeHead(404); res.end(); return;}
  if (req.headers.origin) {res.writeHead(403); res.end(); return;}
  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
  const client = clientForBearer(config, req.headers.authorization) || (bearer && oauth?.verifyToken(bearer));
  if (!client) {res.writeHead(401, oauth ? {'WWW-Authenticate': oauth.challenge} : {}); res.end(); return;}
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 1_000_000) throw new Error('Request too large');
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    const headers = new Headers({'content-type': req.headers['content-type'] || 'application/json', accept: req.headers.accept || 'application/json, text/event-stream'});
    for (const name of ['mcp-protocol-version', 'mcp-method', 'mcp-name']) if (typeof req.headers[name] === 'string') headers.set(name, req.headers[name]);
    const request = new Request('https://business-mcp.invalid/mcp', {method: 'POST', headers, body});
    const answer = await handlers.get(client.name).fetch(request);
    const output = Buffer.from(await answer.arrayBuffer());
    if (answer.status === 400) {
      // Protocol-only diagnostics: never log request bodies, arguments or credentials.
      let error;
      try {error = JSON.parse(output).error;} catch {}
      const message = typeof error?.message === 'string' ? error.message : '';
      const categories = ['Unsupported protocol version', 'Bad Request: Unsupported protocol version', 'Invalid _meta envelope', 'Invalid params', 'Bad Request: Server not initialized', 'Bad Request: Mcp-Session-Id', 'Parse error', 'Bad Request: the request body', 'Invalid Request'];
      console.warn(JSON.stringify({event: 'mcp_transport_rejected', status: 400, code: Number.isInteger(error?.code) ? error.code : null, category: categories.find(value => message.startsWith(value)) || 'other', protocol: /^\d{4}-\d{2}-\d{2}$/.test(req.headers['mcp-protocol-version'] || '') ? req.headers['mcp-protocol-version'] : null}));
    }
    res.writeHead(answer.status, Object.fromEntries([...answer.headers].filter(([name]) => !['transfer-encoding', 'content-length'].includes(name))));
    res.end(output);
  } catch (error) {
    res.writeHead(error.message === 'Request too large' ? 413 : 500, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({error: 'MCP request failed'}));
  }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = createHttpServer(loadConfig());
  server.listen(Number(process.env.PORT || 3000), '0.0.0.0');
}
