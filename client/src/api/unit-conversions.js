import apiClient from './client';

const unwrapData = (response, fallback = []) => {
  if (response?.data?.data !== undefined) return response.data.data;
  if (response?.data !== undefined) return response.data;
  return fallback;
};

export const unitConversionsAPI = {
  getConversions: async () => {
    const response = await apiClient.get('/unit-conversions');
    return unwrapData(response);
  },
  createConversion: async (payload) => {
    const response = await apiClient.post('/unit-conversions', payload);
    return response.data;
  },
  updateConversion: async (id, payload) => {
    const response = await apiClient.put(`/unit-conversions/${id}`, payload);
    return response.data;
  },
  deleteConversion: async (id) => {
    const response = await apiClient.delete(`/unit-conversions/${id}`);
    return response.data;
  }
};
