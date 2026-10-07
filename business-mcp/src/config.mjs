import { createHash, timingSafeEqual } from 'node:crypto';

const code = value => typeof value === 'string' && /^[A-Z0-9_-]{1,24}$/.test(value);
const jsonArray = (value, label) => {
  if (!value) return [];
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw new Error(`${label} must be valid JSON`); }
  if (!Array.isArray(parsed)) throw new Error(`${label} must be an array`);
  return parsed;
};

export function loadConfig(env = process.env) {
  const branches = jsonArray(env.BUSINESS_BRANCH_MAP_JSON, 'BUSINESS_BRANCH_MAP_JSON');
  const clients = jsonArray(env.BUSINESS_MCP_CLIENTS_JSON, 'BUSINESS_MCP_CLIENTS_JSON');
  const seen = new Set();
  for (const branch of branches) {
    if (!code(branch?.code) || seen.has(branch.code)) throw new Error('Invalid or duplicate branch code');
    seen.add(branch.code);
    if (branch.market_order_id != null && !Number.isSafeInteger(branch.market_order_id)) throw new Error('Invalid market_order_id');
    for (const key of ['hrms_id', 'cashflow_code', 'line_source_id']) {
      if (branch[key] != null && (typeof branch[key] !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(branch[key]))) throw new Error(`Invalid ${key}`);
    }
  }
  const clientNames = new Set();
  const clientHashes = new Set();
  for (const client of clients) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(client?.name || '') || clientNames.has(client.name) || (client.token_sha256 != null && (!/^[a-f0-9]{64}$/.test(client.token_sha256) || clientHashes.has(client.token_sha256))) || !Array.isArray(client.branches) || !client.branches.length || client.branches.some(b => !seen.has(b))) throw new Error('Invalid MCP client policy');
    clientNames.add(client.name);
    if (client.token_sha256) clientHashes.add(client.token_sha256);
    if (client.employee_ids != null && (!Array.isArray(client.employee_ids) || client.employee_ids.some(id => !/^[A-Za-z0-9_-]{1,64}$/.test(String(id))))) throw new Error('Invalid employee_ids');
    for (const key of ['min_date', 'max_date']) if (client[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(client[key]) || Number.isNaN(Date.parse(client[key])) || new Date(client[key]).toISOString().slice(0, 10) !== client[key])) throw new Error(`Invalid ${key}`);
    if (client.min_date && client.max_date && client.min_date > client.max_date) throw new Error('Invalid client date scope');
  }
  const urls = {};
  for (const [key, value] of Object.entries({market: env.MARKET_ORDER_BASE_URL, hrms: env.HRMS_MCP_URL, cashflow: env.CASHFLOW_BASE_URL, line: env.LINE_BILL_BASE_URL})) {
    if (!value) continue;
    const url = new URL(value);
    if (url.protocol !== 'https:' && !(env.BUSINESS_ALLOW_LOCAL_HTTP === 'true' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error(`${key} URL must be HTTPS`);
    if (url.username || url.password || url.search || url.hash) throw new Error(`${key} URL must not contain credentials or query`);
    urls[key] = url.toString().replace(/\/$/, '');
  }
  const hrmsTokens = env.HRMS_MCP_TOKENS_JSON ? JSON.parse(env.HRMS_MCP_TOKENS_JSON) : {};
  if (!hrmsTokens || Array.isArray(hrmsTokens) || typeof hrmsTokens !== 'object') throw new Error('Invalid HRMS_MCP_TOKENS_JSON');
  return {branches, clients, urls, bearers: {hrmsByBranch: hrmsTokens, cashflow: env.CASHFLOW_DOT_BEARER, line: env.LINE_BILL_EXPORT_BEARER}};
}

export function clientForBearer(config, header) {
  const token = /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(header || '')?.[1];
  if (!token) return null;
  const digest = createHash('sha256').update(token).digest();
  return config.clients.find(client => client.token_sha256 && timingSafeEqual(digest, Buffer.from(client.token_sha256, 'hex'))) || null;
}

export function requireScope(config, client, requested = []) {
  if (!client) throw new Error('Unauthorized');
  const codes = requested.length ? requested : client.branches;
  if (!Array.isArray(codes) || !codes.length || codes.some(c => !client.branches.includes(c))) throw new Error('Branch outside client scope');
  return [...new Set(codes)].map(c => config.branches.find(b => b.code === c));
}
