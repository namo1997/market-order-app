import apiClient from './client';

// Owner 2026-11-02 ระบบรวบรวมเจ้าหนี้ (accounting/admin): bills per supplier, read with prices, owed per month.
const base = '/receiving-payables';
const bill = id => `${base}/bills/${encodeURIComponent(id)}`;
const data = async request => (await request).data.data;
export const receivingPayablesAPI = {
  summary: period => data(apiClient.get(`${base}/summary`, { params: period ? { period } : {} })),
  bills: (params = {}) => data(apiClient.get(`${base}/bills`, { params })),
  create: supplierKey => data(apiClient.post(`${base}/bills`, { supplier_key: supplierKey })),
  get: id => data(apiClient.get(bill(id))),
  uploadPage: (id, pageNo, imageDataUrl) => data(apiClient.post(`${bill(id)}/pages`, { page_no: pageNo, image_data_url: imageDataUrl })),
  read: id => data(apiClient.post(`${bill(id)}/read`, {}, { timeout: 150000 })),
  update: (id, body) => data(apiClient.put(bill(id), body)),
  remove: id => data(apiClient.delete(bill(id))),
  page: async (id, pageNo) => (await apiClient.get(`${bill(id)}/pages/${encodeURIComponent(pageNo)}`, { responseType: 'blob' })).data,
};
