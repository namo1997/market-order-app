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

let authToken = localStorage.getItem('cashflow_token') || '';

export const setAuthToken = (token) => {
  authToken = token || '';
  if (token) localStorage.setItem('cashflow_token', token);
  else localStorage.removeItem('cashflow_token');
};

const request = async (path, options = {}) => {
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
    throw error;
  }
  return payload.data;
};

const json = (method, path, body) =>
  request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });

export const api = {
  login: (payload) => json('POST', '/auth/login', payload),
  cashierLogin: (payload = {}) => json('POST', '/auth/cashier', payload),
  me: () => request('/auth/me'),
  branches: () => request('/branches'),
  createBranch: (payload) => json('POST', '/branches', payload),
  paymentChannels: () => request('/payment-channels'),
  updatePaymentChannel: (id, payload) => json('PUT', `/payment-channels/${id}`, payload),
  receipts: (filters) => {
    const params = new URLSearchParams();
    Object.entries(filters || {}).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return request(`/daily-receipts?${params.toString()}`);
  },
  receipt: (id) => request(`/daily-receipts/${id}`),
  createFromClickHouse: (payload) => json('POST', '/daily-receipts/from-clickhouse', payload),
  submitReceipt: (id, payload) => json('PUT', `/daily-receipts/${id}/submit`, payload),
  checkReceipt: (id, payload) => json('PUT', `/daily-receipts/${id}/check`, payload),
  closeReceipt: (id, payload) => json('PUT', `/daily-receipts/${id}/close`, payload),
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
  importStatement: ({ receiptId, paymentChannelId, file }) => {
    const form = new FormData();
    form.append('receipt_id', receiptId);
    if (paymentChannelId) form.append('payment_channel_id', paymentChannelId);
    form.append('file', file);
    return request('/statement-imports', {
      method: 'POST',
      body: form
    });
  }
};
