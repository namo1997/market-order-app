import apiClient from './client';

export const withdrawAPI = {
  getTargets: async () => {
    const response = await apiClient.get('/withdraw/targets');
    return response.data;
  },

  getProducts: async ({ search = '', limit = 200 } = {}) => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (limit) params.append('limit', String(limit));
    const query = params.toString();
    const response = await apiClient.get(`/withdraw/products${query ? `?${query}` : ''}`);
    return response.data;
  },

  getHistory: async ({ limit = 20 } = {}) => {
    const params = new URLSearchParams();
    if (limit) params.append('limit', String(limit));
    const query = params.toString();
    const response = await apiClient.get(`/withdraw/history${query ? `?${query}` : ''}`);
    return response.data;
  },

  getById: async (id) => {
    const response = await apiClient.get(`/withdraw/history/${id}`);
    return response.data;
  },

  update: async (id, { notes, items }) => {
    const response = await apiClient.put(`/withdraw/history/${id}`, { notes, items });
    return response.data;
  },

  createWithdrawal: async ({ target_department_id, notes, items }) => {
    const response = await apiClient.post('/withdraw', {
      target_department_id,
      notes,
      items
    });
    return response.data;
  },

  getSourceMappings: async () => {
    const response = await apiClient.get('/withdraw/source-mappings');
    return response.data;
  },

  saveSourceMappings: async (mappings = []) => {
    const response = await apiClient.put('/withdraw/source-mappings', {
      mappings
    });
    return response.data;
  }
};
