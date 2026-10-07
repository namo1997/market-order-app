export type Row = Record<string, any>;

const normalizeMutationPath = (path: string) => path.split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:id');

const actionKeyFor = (path: string, method: string) => {
  const route = normalizeMutationPath(path).replace('/api/admin', '');
  const verb = method.toLowerCase();
  const known: Record<string, string> = {
    'post:/ai/run': 'ai.queue.run', 'post:/ai/rematch': 'ai.matches.rebuild',
    'post:/ai/requeue': 'ai.items.requeue', 'post:/ai/reset-all': 'ai.analysis.reset',
    'post:/ai/pause': 'ai.queue.pause', 'post:/days/close': 'day.close',
    'post:/days/reopen': 'day.reopen', 'post:/senders/refresh': 'senders.refresh',
    'post:/items/deduplicate': 'documents.deduplicate',
    'post:/items/:id/request-transfer': 'line.transfer_request.send',
    'put:/items/:id/expense-profile': 'document.expense_profile.save',
    'put:/items/:id/category': 'document.category.change',
    'post:/items/:id/category-learning/review': 'document.category_learning.review',
    'patch:/items/:id': 'document.metadata.update',
    'post:/items/:id/cash-payment': 'cash_payment.confirm',
    'patch:/items/:id/cash-payment': 'cash_payment.update',
    'post:/items/:id/cash-payment/void': 'cash_payment.void',
    'post:/items/:id/repair-match-state': 'document.match_state.repair',
    'post:/items/:id/resolve-flag': 'document.amount_flag.resolve',
    'post:/reimbursements/:id/review': 'reimbursement.review',
    'post:/receipt-substitutes': 'receipt_substitute.create',
    'post:/items/:id/receipt-substitute/void': 'receipt_substitute.void',
    'post:/matches': 'match.review', 'post:/matches/:id/learning-feedback': 'match.learning_feedback', 'post:/match-groups': 'match_group.review',
    'post:/items/:id/split-batch-payment': 'batch_payment.split'
  };
  return known[`${verb}:${route}`] || `bill_capture.${verb}.${route.replace(/^\//, '').replaceAll('/', '.')}`;
};

const params = (values: Record<string, unknown>) => {
  const query = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  });
  return query.toString();
};

async function rawPayload<T = any>(path: string, options: RequestInit = {}): Promise<{ data: T; pagination?: Record<string, any> }> {
  const { headers, ...requestOptions } = options;
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...requestOptions,
    headers: { 'Content-Type': 'application/json', ...(headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || `HTTP ${response.status}`);
  }
  return payload as { data: T; pagination?: Record<string, any> };
}

async function rawRequest<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  return (await rawPayload<T>(path, options)).data;
}

export async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const method = String(options.method || 'GET').toUpperCase();
  const route = path.split('?')[0];
  const needsDecision = !['GET', 'HEAD', 'OPTIONS'].includes(method)
    && route !== '/api/admin/decision-contexts'
    && !route.startsWith('/api/admin/decisions/')
    && !route.endsWith('/category-learning/review');
  if (!needsDecision) return rawRequest<T>(path, options);
  const actionKey = actionKeyFor(path, method);
  let body: unknown = {};
  if (typeof options.body === 'string') { try { body = JSON.parse(options.body); } catch { body = {}; } }
  const entityId = route.match(/\/(\d+)(?:\/|$)/)?.[1] || '';
  const decision = await rawRequest<Row>('/api/admin/decision-contexts', {
    method: 'POST', body: JSON.stringify({
      action_key: actionKey, entity_type: route.split('/').filter(Boolean).at(-2) || 'document',
      entity_id: entityId, page_url: window.location.href,
      context_snapshot: { route, method, request: body }
    })
  });
  return rawRequest<T>(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'X-Decision-Id': decision.id,
      'X-Decision-Reason-Code': 'user_action'
    }
  });
}

export const api = {
  groups: () => request<Row[]>('/api/admin/groups'),
  days: (start: string, end: string, sourceId = '') =>
    request<Row[]>(`/api/admin/days?${params({ start, end, source_id: sourceId })}`),
  items: async (filters: Record<string, unknown>) => {
    const rows: Row[] = [];
    const requestedPageSize = Number(filters.limit || 1000);
    const pageSize = Number.isFinite(requestedPageSize) ? Math.max(1, Math.min(500, Math.floor(requestedPageSize))) : 1000;
    const startOffset = Number(filters.offset || 0);
    const queryFilters = { ...filters };
    delete queryFilters.limit;
    delete queryFilters.offset;
    for (let offset = Number.isFinite(startOffset) ? Math.max(0, Math.floor(startOffset)) : 0; ; offset += pageSize) {
      const page = await request<Row[]>(`/api/admin/items?${params({ ...queryFilters, limit: pageSize, offset, live: 1 })}`);
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return rows;
  },
  itemsPage: async (filters: Record<string, unknown>, limit = 100, offset = 0) => {
    const pageSize = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
    const startOffset = Math.max(0, Math.floor(Number(offset) || 0));
    const payload = await rawPayload<Row[]>(`/api/admin/items?${params({ ...filters, limit: pageSize, offset: startOffset, live: 1 })}`);
    const rows = payload.data || [];
    const total = Number(payload.pagination?.total);
    const nextOffset = Number.isFinite(total) && startOffset + rows.length < total ? startOffset + rows.length : null;
    return { rows, pagination: { total: Number.isFinite(total) ? total : rows.length, limit: pageSize, offset: startOffset, next_offset: nextOffset } };
  },
  matches: async (filters: Record<string, unknown>) => {
    const rows: Row[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = await request<Row[]>(`/api/admin/matches?${params({ limit: 500, offset, ...filters })}`);
      rows.push(...page);
      if (page.length < 500) break;
    }
    return rows;
  },
  messages: (filters: Record<string, unknown>) =>
    request<Row[]>(`/api/admin/messages?${params({ limit: 300, ...filters })}`),
  senders: (filters: Record<string, unknown> = {}) =>
    request<Row[]>(`/api/admin/senders?${params({ limit: 300, ...filters })}`),
  context: (id: number) => request<Row>(`/api/admin/items/${id}/context`),
  receiptDraft: (id: number) => request<Row>(`/api/admin/items/${id}/receipt-substitute-draft`),
  aiStatus: () => request<Row>('/api/admin/ai/status'),
  decisions: (filters: Record<string, unknown> = {}) => request<Row[]>(`/api/admin/decisions?${params(filters)}`),
  mutate: (path: string, body: unknown, method = 'POST') =>
    request<Row>(path, { method, body: JSON.stringify(body) })
};

export const imageUrl = (id: number | string) => `/api/admin/items/${id}/image`;

export function bangkokToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

export function addDays(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00+07:00`);
  value.setDate(value.getDate() + amount);
  return value.toISOString().slice(0, 10);
}

export function businessDate(item: Row) {
  const timestamp = Number(item?.event_timestamp_ms || 0);
  if (timestamp) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(timestamp));
  }
  const fallback = String(item?.created_at || item?.created_at_line || '');
  return fallback.slice(0, 10);
}

export function reviewItemPath(item: Row) {
  const query = new URLSearchParams({ date: businessDate(item) || bangkokToday(), source: String(item.source_id || ''), item: String(item.id) });
  return `/review/item/${item.id}?${query}`;
}

export function lineTime(item: Row) {
  const timestamp = Number(item?.event_timestamp_ms || 0);
  if (!timestamp) return String(item?.created_at_line || item?.created_at || '').slice(11, 16);
  return new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
}

export const money = (value: unknown) => Number(value || 0).toLocaleString('th-TH', {
  minimumFractionDigits: 2, maximumFractionDigits: 2
});

export const shortDate = (value: string) => new Intl.DateTimeFormat('th-TH', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok'
}).format(new Date(`${value}T12:00:00+07:00`));
