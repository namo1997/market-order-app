import apiClient from './client';
const base = '/receiving-admin';
const data = async request => (await request).data.data;
export const receivingAdminAPI = {
  list: (params, signal) => data(apiClient.get(base, { params, signal })),
  options: signal => data(apiClient.get(`${base}/options`, { signal })),
  get: (id, signal) => data(apiClient.get(`${base}/${encodeURIComponent(id)}`, { signal })),
};
