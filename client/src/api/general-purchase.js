import apiClient from './client';

const unwrap = (response) => response?.data;

export const generalPurchaseAPI = {
  getAll: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.status) params.append('status', filters.status);
    if (filters.branch) params.append('branch', filters.branch);
    if (filters.department) params.append('department', filters.department);
    if (filters.limit) params.append('limit', filters.limit);
    const query = params.toString();
    const response = await apiClient.get(`/general-purchase${query ? `?${query}` : ''}`);
    return unwrap(response);
  },

  getById: async (id) => {
    const response = await apiClient.get(`/general-purchase/${id}`);
    return unwrap(response);
  },

  create: async ({ header, items, requestedBy }) => {
    const response = await apiClient.post('/general-purchase', { header, items, requestedBy });
    return unwrap(response);
  },

  approve: async (id, note = '') => {
    const response = await apiClient.post(`/general-purchase/${id}/approve`, { note });
    return unwrap(response);
  },

  reject: async (id, reason = '') => {
    const response = await apiClient.post(`/general-purchase/${id}/reject`, { reason });
    return unwrap(response);
  },

  issuePO: async (id, payload) => {
    const response = await apiClient.post(`/general-purchase/${id}/issue-po`, payload);
    return unwrap(response);
  },

  receive: async (id, payload) => {
    const response = await apiClient.post(`/general-purchase/${id}/receive`, payload);
    return unwrap(response);
  }
};
