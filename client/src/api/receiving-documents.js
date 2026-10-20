import apiClient from './client';

const base = '/receiving-documents';
const path = (id) => `${base}/${encodeURIComponent(id)}`;
const data = async (request) => (await request).data.data;

// ใช้ auth/interceptors เดิม และไม่ retry คำขอเขียนอัตโนมัติ
export const receivingDocumentsAPI = {
  legacyBillPhotos: date => data(apiClient.get('/orders/receiving/bill-photos', { params: { date, scope: 'branch' } })),
  products: (filters) => data(apiClient.get(`${base}/products`, { params: filters })),
  suppliers: (filters = {}) => data(apiClient.get(`${base}/suppliers`, { params: filters })),
  supplierProducts: (supplierKey, scope = {}) => data(apiClient.get(`${base}/supplier-products`, { params: { supplier_key: supplierKey, ...scope } })),
  expected: (date, scope = {}) => data(apiClient.get(`${base}/expected`, { params: { date, ...scope } })),
  list: (filters = {}) => data(apiClient.get(base, { params: filters })),
  create: (body) => data(apiClient.post(base, body)),
  get: (id) => data(apiClient.get(path(id))),
  count: (id, body) => data(apiClient.post(`${path(id)}/count`, body)),
  update: (id, body) => data(apiClient.put(path(id), body)),
  uploadImage: (id, pageNo, imageDataUrl) => data(apiClient.post(`${path(id)}/images`, {
    page_no: pageNo, image_data_url: imageDataUrl,
  })),
  ocr: (id) => data(apiClient.post(`${path(id)}/ocr`, {}, { timeout: 150000 })),
  signature: (id, role, imageDataUrl, name) => data(apiClient.post(`${path(id)}/signatures`, {
    role, image_data_url: imageDataUrl, ...(name ? { name } : {}),
  })),
  signatureImage: async (id, role) => (await apiClient.get(`${path(id)}/signatures/${encodeURIComponent(role)}`, {
    responseType: 'blob',
  })).data,
  confirm: (id, unmatchedOk = false) => data(apiClient.post(`${path(id)}/confirm`, { unmatched_ok: unmatchedOk })),
  void: (id, reason) => data(apiClient.post(`${path(id)}/void`, { reason })),
  image: async (id, imageId) => (await apiClient.get(`${path(id)}/images/${encodeURIComponent(imageId)}`, {
    responseType: 'blob',
  })).data,
};
