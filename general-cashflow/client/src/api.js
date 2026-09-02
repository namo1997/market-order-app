const resolveApiBaseUrl = () => {
  const envUrl = import.meta.env.VITE_CASHFLOW_API_URL;
  if (typeof window === 'undefined') {
    return envUrl || 'http://localhost:8100/api';
  }

  if (!envUrl) {
    return `${window.location.protocol}//${window.location.hostname}:8100/api`;
  }

  try {
    const parsed = new URL(envUrl);
    const envIsLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    const pageIsLoopback = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (envIsLoopback && !pageIsLoopback) {
      return `${window.location.protocol}//${window.location.hostname}:8100/api`;
    }
  } catch {
    return envUrl;
  }

  return envUrl;
};

const API_BASE_URL = resolveApiBaseUrl();
export const AUTH_EXPIRED_EVENT = 'cashflow:auth-expired';

let authToken = localStorage.getItem('cashflow_token') || '';

const MUTATION_EXEMPT = [
  '/auth/login', '/auth/google', '/auth/cashier', '/decision-contexts', '/decisions', '/reconciliations/statement-preview'
];

const normalizeDecisionPath = (path) => String(path || '')
  .split('?')[0]
  .replace(/\/\d+(?=\/|$)/g, '/:id')
  .replace(/\/[0-9a-f-]{24,}(?=\/|$)/gi, '/:id');

const decisionActionKey = (path, method) => {
  const route = normalizeDecisionPath(path);
  const verb = String(method || 'GET').toLowerCase();
  const known = {
    'post:/branches': 'settings.branch.create',
    'post:/receiving-accounts': 'settings.receiving_account.create',
    'put:/receiving-accounts/:id': 'settings.receiving_account.update',
    'put:/payment-channels/:id': 'settings.payment_channel.update',
    'post:/daily-receipts/from-clickhouse': 'receipt.create_from_pos',
    'post:/daily-receipts/backfill-clickhouse': 'receipt.backfill_from_pos',
    'put:/daily-receipts/:id/submit': 'receipt.submit',
    'put:/daily-receipts/:id/cashier-amounts': 'receipt.cashier_amounts.update',
    'put:/daily-receipts/:id/statement-amounts': 'receipt.statement_amounts.update',
    'put:/daily-receipts/:id/review-note': 'receipt.review_note.update',
    'post:/daily-receipts/:id/misc-items': 'receipt.misc_item.create',
    'delete:/daily-receipts/:id/misc-items/:id': 'receipt.misc_item.delete',
    'post:/daily-receipts/:id/attachments': 'receipt.attachment.upload',
    'put:/reconciliations/:id/settlement': 'reconciliation.settlement.update',
    'post:/reconciliations/:id/confirm-grab-report': 'reconciliation.grab.confirm',
    'put:/reconciliations/:id/manual-check': 'reconciliation.manual_check',
    'put:/reconciliations/:id/adjustment': 'reconciliation.adjustment.update',
    'post:/reconciliations/:id/evidence': 'reconciliation.evidence.upload',
    'post:/reconciliations/statement-confirm': 'reconciliation.statement.confirm',
    'put:/daily-receipts/:id/check': 'receipt.check',
    'put:/daily-receipts/:id/request-correction': 'receipt.request_correction',
    'put:/daily-receipts/:id/close': 'receipt.close',
    'post:/daily-receipts/:id/post-close-adjustments': 'receipt.post_close_adjustment',
    'post:/reports/morning-brief/refresh': 'report.morning_brief.refresh'
  };
  return known[`${verb}:${route}`] || `cashflow.${verb}.${route.replace(/^\//, '').replaceAll('/', '.')}`;
};

const summarizeBody = (body) => {
  if (!body) return {};
  if (body instanceof FormData) {
    const summary = {};
    for (const [key, value] of body.entries()) {
      summary[key] = value instanceof File
        ? { name: value.name, type: value.type, size: value.size }
        : String(value).slice(0, 300);
    }
    return summary;
  }
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return { text: body.slice(0, 500) }; }
  }
  return { type: typeof body };
};

export const setAuthToken = (token) => {
  authToken = token || '';
  if (token) localStorage.setItem('cashflow_token', token);
  else localStorage.removeItem('cashflow_token');
};

export const clearAuthSession = () => {
  authToken = '';
  localStorage.removeItem('cashflow_token');
  localStorage.removeItem('cashflow_user');
};

export const hasAuthToken = () => Boolean(authToken || localStorage.getItem('cashflow_token'));

const notifyAuthExpired = () => {
  clearAuthSession();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
  }
};

const rawRequest = async (path, options = {}) => {
  const headers = { ...(options.headers || {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || 'Request failed');
    error.details = payload.details;
    error.status = response.status;
    if (response.status === 401) {
      error.authExpired = true;
      notifyAuthExpired();
    }
    throw error;
  }
  return payload.data;
};

const request = async (path, options = {}) => {
  const method = String(options.method || 'GET').toUpperCase();
  const route = String(path || '').split('?')[0];
  const needsDecision = !['GET', 'HEAD', 'OPTIONS'].includes(method)
    && !MUTATION_EXEMPT.some((entry) => route === entry || route.startsWith(`${entry}/`));
  if (!needsDecision) return rawRequest(path, options);

  const actionKey = decisionActionKey(path, method);
  const bodySummary = summarizeBody(options.body);
  const entityId = route.match(/\/(\d+)(?:\/|$)/)?.[1] || '';
  const context = await rawRequest('/decision-contexts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action_key: actionKey,
      entity_type: route.split('/').filter(Boolean)[0] || 'unknown',
      entity_id: entityId,
      page_url: window.location.href,
      context_snapshot: { route, method, request: bodySummary }
    })
  });
  return rawRequest(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'X-Decision-Id': context.id,
      'X-Decision-Reason-Code': 'shadow_observed_human_action'
    }
  });
};

const fileNameFromDisposition = (value) => {
  const match = String(value || '').match(/filename\*=UTF-8''([^;]+)/i);
  if (match) return decodeURIComponent(match[1]);
  const fallback = String(value || '').match(/filename="?([^"]+)"?/i);
  return fallback?.[1] || 'attachment';
};

const requestBlob = async (path, options = {}) => {
  const headers = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const response = await fetch(`${API_BASE_URL}${path}`, { headers, signal: options.signal });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.message || 'Request failed');
    error.status = response.status;
    if (response.status === 401) {
      error.authExpired = true;
      notifyAuthExpired();
    }
    throw error;
  }

  return {
    blob: await response.blob(),
    fileName: fileNameFromDisposition(response.headers.get('Content-Disposition')),
    focusPage: Number(response.headers.get('X-Evidence-Focus-Page')) || null
  };
};

const attachmentFileUrl = (attachmentId, variant = 'document') => {
  const params = new URLSearchParams({
    variant,
    access_token: authToken || localStorage.getItem('cashflow_token') || ''
  });
  return `${API_BASE_URL}/attachments/${attachmentId}/file?${params.toString()}`;
};

const json = (method, path, body) =>
  request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });

export const api = {
  login: (payload) => json('POST', '/auth/login', payload),
  googleLoginConfig: () => request('/auth/google/config'),
  googleLogin: (credential) => json('POST', '/auth/google', { credential }),
  cashierLogin: (payload = {}) => json('POST', '/auth/cashier', payload),
  me: () => request('/auth/me'),
  branches: () => request('/branches'),
  createBranch: (payload) => json('POST', '/branches', payload),
  paymentChannels: () => request('/payment-channels'),
  updatePaymentChannel: (id, payload) => json('PUT', `/payment-channels/${id}`, payload),
  receivingAccounts: () => request('/receiving-accounts'),
  createReceivingAccount: (payload) => json('POST', '/receiving-accounts', payload),
  updateReceivingAccount: (id, payload) => json('PUT', `/receiving-accounts/${id}`, payload),
  receipts: (filters) => {
    const params = new URLSearchParams();
    Object.entries(filters || {}).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return request(`/daily-receipts?${params.toString()}`);
  },
  receipt: (id) => request(`/daily-receipts/${id}`),
  openTables: (id) => request(`/daily-receipts/${id}/open-tables`),
  createFromClickHouse: (payload) => json('POST', '/daily-receipts/from-clickhouse', payload),
  submitReceipt: (id, payload) => json('PUT', `/daily-receipts/${id}/submit`, payload),
  updateCashierAmounts: (id, payload) => json('PUT', `/daily-receipts/${id}/cashier-amounts`, payload),
  updateStatementAmounts: (id, payload) => json('PUT', `/daily-receipts/${id}/statement-amounts`, payload),
  updateReviewNote: (id, note) => json('PUT', `/daily-receipts/${id}/review-note`, { note }),
  checkReceipt: (id, payload) => json('PUT', `/daily-receipts/${id}/check`, payload),
  closeReceipt: (id, payload) => json('PUT', `/daily-receipts/${id}/close`, payload),
  postCloseAdjustment: (id, payload) => json('POST', `/daily-receipts/${id}/post-close-adjustments`, payload),
  requestCorrection: (id, payload) => json('PUT', `/daily-receipts/${id}/request-correction`, payload),
  addMiscItem: (receiptId, payload) => json('POST', `/daily-receipts/${receiptId}/misc-items`, payload),
  removeMiscItem: (receiptId, itemId) => request(`/daily-receipts/${receiptId}/misc-items/${itemId}`, { method: 'DELETE' }),
  reconciliation: (filters) => {
    const params = new URLSearchParams();
    Object.entries(filters || {}).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return request(`/reports/reconciliation?${params.toString()}`);
  },
  uploadAttachments: (receiptId, files, type) => {
    const form = new FormData();
    Array.from(files || []).forEach((file) => form.append('files', file));
    form.append('attachment_type', type || 'other');
    return request(`/daily-receipts/${receiptId}/attachments`, {
      method: 'POST',
      body: form
    });
  },
  attachmentFile: (attachmentId, variant = 'document', options = {}) => {
    const params = new URLSearchParams({ variant });
    if (options.focusDate) params.set('focus_date', String(options.focusDate).slice(0, 10));
    if (Number.isFinite(Number(options.focusAmount))) params.set('focus_amount', Number(options.focusAmount).toFixed(2));
    return requestBlob(`/attachments/${attachmentId}/file?${params.toString()}`, options);
  },
  attachmentFileUrl,
  saveSettlement: (lineId, payload) => json('PUT', `/reconciliations/${lineId}/settlement`, payload),
  confirmGrabReport: (lineId, payload = {}) => json('POST', `/reconciliations/${lineId}/confirm-grab-report`, payload),
  manualCheckWithoutReference: (lineId, checked, amounts = {}) =>
    json('PUT', `/reconciliations/${lineId}/manual-check`, { checked, ...amounts }),
  updateReconciliationAdjustment: (lineId, payload) =>
    json('PUT', `/reconciliations/${lineId}/adjustment`, payload),
  classifyStatementTransaction: (transactionId, payload) =>
    json('PUT', `/statement-transactions/${transactionId}/classify`, payload),
  uploadSettlementEvidence: (lineId, file) => {
    const form = new FormData();
    form.append('file', file);
    return request(`/reconciliations/${lineId}/evidence`, { method: 'POST', body: form });
  },
  previewStatement: ({ receiptLineId, receivingAccountId, file }) => {
    const form = new FormData();
    form.append('receipt_line_id', receiptLineId);
    form.append('receiving_account_id', receivingAccountId);
    form.append('file', file);
    return request('/reconciliations/statement-preview', {
      method: 'POST',
      body: form
    });
  },
  confirmStatement: ({ receiptLineId, receivingAccountId, selectedHashes, customerDepositHashes, file }) => {
    const form = new FormData();
    form.append('receipt_line_id', receiptLineId);
    form.append('receiving_account_id', receivingAccountId);
    form.append('selected_hashes', JSON.stringify(selectedHashes || []));
    form.append('customer_deposit_hashes', JSON.stringify(customerDepositHashes || []));
    form.append('file', file);
    return request('/reconciliations/statement-confirm', { method: 'POST', body: form });
  },
  morningBrief: ({ date, refresh } = {}) => {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    if (refresh) params.set('refresh', '1');
    const query = params.toString();
    return request(`/reports/morning-brief${query ? `?${query}` : ''}`);
  },
  refreshMorningBrief: ({ date } = {}) => json('POST', '/reports/morning-brief/refresh', { date }),
  inboxImports: () => request('/inbox-imports'),
  inboxImportTransactions: (id) => request(`/inbox-imports/${id}/transactions`),
  inboxImportFile: (id) => requestBlob(`/inbox-imports/${id}/file`),
  agentHealth: () => request('/agents/health'),
  decisions: (filters = {}) => {
    const query = new URLSearchParams(filters).toString();
    return request(`/decisions${query ? `?${query}` : ''}`);
  },
  answerDecisionFollowup: (id, answer) => json('POST', `/decisions/${id}/follow-up`, { answer })
};
