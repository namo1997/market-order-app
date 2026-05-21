import apiClient from './client';

const unwrapData = (response, fallback = []) => {
  if (response?.data?.data !== undefined) return response.data.data;
  if (response?.data !== undefined) return response.data;
  return fallback;
};

export const productUnitSettingsAPI = {
  list: async (params = {}) => {
    const searchParams = new URLSearchParams();
    if (params.search) searchParams.append('search', params.search);
    if (params.limit) searchParams.append('limit', String(params.limit));
    const response = await apiClient.get(`/product-unit-settings?${searchParams.toString()}`);
    return unwrapData(response);
  },
  save: async (productId, payload) => {
    const response = await apiClient.put(`/product-unit-settings/${productId}`, payload);
    return response.data?.data ?? response.data;
  }
};
