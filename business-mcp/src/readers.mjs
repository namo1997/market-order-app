const MAX_BYTES = 2_000_000;

export async function readJson(url, bearer, fetchImpl = fetch, method = 'GET', body) {
  const headers = {accept: 'application/json'};
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (body) headers['content-type'] = 'application/json';
  const response = await fetchImpl(url, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000), redirect: 'error'
  });
  if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
  const contentLength = Number(response.headers?.get?.('content-length') || 0);
  if (contentLength > MAX_BYTES) throw new Error('Upstream response too large');
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Upstream response too large');
  return JSON.parse(text);
}

function url(base, path, params = {}) {
  const target = new URL(path, `${base}/`);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) target.searchParams.set(key, String(value));
  return target.toString();
}

export async function readMarket(config, branch, from, to, fetchImpl = fetch) {
  if (!config.urls.market || !branch.market_order_id) throw new Error('Market Order binding missing');
  const result = await readJson(url(config.urls.market, 'api/public/reports/sales', {start: from, end: to, branch_id: branch.market_order_id, limit: 20}), null, fetchImpl);
  if (result.success !== true || !result.data?.summary) throw new Error('Unexpected Market Order response');
  const data = result.data;
  if (String(data.branch_id) !== String(branch.market_order_id)) throw new Error('Market Order branch mismatch');
  return {
    source: 'MARKET_ORDER_CLICKHOUSE', status: 'OK', basis: 'AS_REPORTED',
    period: {kind: 'SALE_DATE', from: data.start, to: data.end},
    summary: {bill_count: data.summary.bill_count ?? null, revenue_thb: data.summary.total_revenue ?? null, menu_count: data.summary.menu_count ?? null},
    freshness: null,
    limitations: ['รายงานต้นทางอาจมีความล่าช้าและข้อจำกัดการนับซ้ำ', 'ยอดขายไม่ใช่ยอดรับเงินจริง'],
    detail: {
      previous_period: {from: data.prev_start, to: data.prev_end, summary: data.prev_summary},
      last_year: {from: data.last_year_start, to: data.last_year_end, summary: data.last_year_summary},
      daily: Array.isArray(data.daily) ? data.daily.slice(0, 32) : [],
      by_branch: Array.isArray(data.by_branch) ? data.by_branch.slice(0, 20) : [],
      by_group: Array.isArray(data.by_group) ? data.by_group.slice(0, 100) : [],
      by_hour: Array.isArray(data.by_hour) ? data.by_hour.slice(0, 24) : [],
      by_weekday: Array.isArray(data.by_weekday) ? data.by_weekday.slice(0, 7) : [],
      bill_distribution: Array.isArray(data.bill_dist) ? data.bill_dist.slice(0, 50) : [],
      top_items: Array.isArray(data.items) ? data.items.slice(0, 20) : [],
      truncated: {groups: (data.by_group?.length || 0) > 100, items: Number(data.summary.menu_count || 0) > 20}
    }
  };
}

export async function readCashflow(config, day, cursor, fetchImpl = fetch) {
  if (!config.urls.cashflow || !config.bearers.cashflow) throw new Error('Cash Flow binding missing');
  const result = await readJson(url(config.urls.cashflow, 'integrations/dot/reconciliation', {day, cursor}), config.bearers.cashflow, fetchImpl);
  if (result.source !== 'GENERAL_CASHFLOW' || result.read_only !== true || result.day !== day || !Array.isArray(result.rows)) throw new Error('Unexpected Cash Flow response');
  return result;
}

function parseMcpResponse(text, contentType) {
  if (contentType.includes('text/event-stream')) {
    const event = text.split(/\r?\n\r?\n/).map(block => block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')).filter(Boolean).at(-1);
    if (!event) throw new Error('Empty HRMS MCP response');
    return JSON.parse(event);
  }
  return JSON.parse(text);
}

export async function callHrms(config, branch, name, args = {}, fetchImpl = fetch) {
  const bearer = config.bearers.hrmsByBranch?.[branch.code];
  if (!config.urls.hrms || !bearer || !branch.hrms_id) throw new Error('HRMS scoped binding missing');
  const response = await fetchImpl(config.urls.hrms, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: {authorization: `Bearer ${bearer}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name, arguments: args}})
  });
  if (!response.ok) throw new Error(`HRMS HTTP ${response.status}`);
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('HRMS response too large');
  const envelope = parseMcpResponse(text, response.headers.get('content-type') || '');
  if (envelope.error || envelope.result?.isError) throw new Error('HRMS MCP tool failed');
  const data = envelope.result?.structuredContent?.result ?? JSON.parse(envelope.result?.content?.find(c => c.type === 'text')?.text || '{}');
  if (data?.policy?.branch_scope !== branch.hrms_id) throw new Error('HRMS branch scope mismatch');
  return data;
}

export async function readLineRounds(config, branch, from, to, offset = 0, fetchImpl = fetch) {
  if (!config.urls.line || !config.bearers.line || !branch.line_source_id) throw new Error('LINE Bill binding missing');
  const result = await readJson(url(config.urls.line, 'accounting-export/rounds', {from, to, branch: branch.line_source_id, limit: 100, offset}), config.bearers.line, fetchImpl);
  if (result.success !== true || !Array.isArray(result.data) || !result.pagination) throw new Error('Unexpected LINE Bill response');
  if (result.data.some(row => row.source_id !== branch.line_source_id)) throw new Error('LINE Bill branch mismatch');
  return result;
}

export async function readLineSnapshot(config, branch, roundId, fetchImpl = fetch) {
  if (!config.urls.line || !config.bearers.line || !branch.line_source_id || !roundId.startsWith(`${branch.line_source_id}:`)) throw new Error('LINE Bill round outside scope');
  const result = await readJson(url(config.urls.line, `accounting-export/rounds/${encodeURIComponent(roundId)}/snapshot`), config.bearers.line, fetchImpl);
  if (result.success !== true || result.data?.source_id !== branch.line_source_id || result.data?.status !== 'closed') throw new Error('Unexpected LINE Bill snapshot');
  return result.data;
}
