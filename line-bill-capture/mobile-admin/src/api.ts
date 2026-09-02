export type Row = Record<string, any>;

const actionKeyFor = (path: string, method: string) => {
  const route = path.split('?')[0].replace('/api/admin', '').replace(/\/\d+(?=\/|$)/g, '/:id');
  const verb = method.toLowerCase();
  const known: Record<string, string> = {
    'post:/ai/run': 'ai.queue.run', 'post:/ai/rematch': 'ai.matches.rebuild',
    'post:/ai/requeue': 'ai.items.requeue', 'post:/ai/reset-all': 'ai.analysis.reset',
    'post:/ai/pause': 'ai.queue.pause', 'post:/days/close': 'day.close',
    'post:/days/reopen': 'day.reopen', 'post:/senders/refresh': 'senders.refresh',
    'post:/items/deduplicate': 'documents.deduplicate',
    'post:/items/:id/request-transfer': 'line.transfer_request.send',
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

export async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || `HTTP ${response.status}`);
  }
  return payload.data as T;
}

const mutateWithDecision = async (path: string, body: unknown, method = 'POST') => {
  const route = path.split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:id');
  const actionKey = actionKeyFor(path, method);
  const decision = await request<Row>('/api/admin/decision-contexts', {
    method: 'POST',
    body: JSON.stringify({
      action_key: actionKey,
      entity_id: path.match(/\/(\d+)(?:\/|$)/)?.[1] || '',
      page_url: window.location.href,
      context_snapshot: { route, method, request: body }
    })
  });
  const reason = window.prompt('เหตุผลที่ทำรายการนี้ (อ้างอิงหลักฐานหรือบริบทที่ใช้ตัดสินใจ)');
  if (!reason?.trim()) {
    await request(`/api/admin/decisions/${decision.id}/cancel`, { method: 'POST' }).catch(() => undefined);
    const error = new Error('ยกเลิกการทำรายการ');
    (error as any).code = 'decision_cancelled';
    throw error;
  }
  return request<Row>(path, {
    method,
    headers: {
      'X-Decision-Id': decision.id,
      'X-Decision-Reason-Code': 'legacy_mobile_reason',
      'X-Decision-Reason-Text': encodeURIComponent(reason.trim())
    },
    body: JSON.stringify(body)
  });
};

export const api = {
  groups: () => request<Row[]>('/api/admin/groups'),
  days: (start: string, end: string, sourceId = '') =>
    request<Row[]>(`/api/admin/days?${params({ start, end, source_id: sourceId })}`),
  items: async (filters: Record<string, unknown>) => {
    const rows: Row[] = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await request<Row[]>(`/api/admin/items?${params({ limit: 1000, offset, live: 1, ...filters })}`);
      rows.push(...page);
      if (page.length < 1000) break;
    }
    return rows;
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
  aiStatus: () => request<Row>('/api/admin/ai/status'),
  mutate: (path: string, body: unknown, method = 'POST') =>
    mutateWithDecision(path, body, method)
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
