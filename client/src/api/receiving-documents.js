import apiClient from './client';

const base = '/receiving-documents';
const path = (id) => `${base}/${encodeURIComponent(id)}`;
const data = async (request) => (await request).data.data;

// ใช้ auth/interceptors เดิม และไม่ retry คำขอเขียนอัตโนมัติ
export const receivingDocumentsAPI = {
  expected: (date, scope = {}) => data(apiClient.get(`${base}/expected`, { params: { date, ...scope } })),
  list: (filters = {}) => data(apiClient.get(base, { params: filters })),
  create: (body) => data(apiClient.post(base, body)),
  get: (id) => data(apiClient.get(path(id))),
  update: (id, body) => data(apiClient.put(path(id), body)),
  uploadImage: (id, pageNo, imageDataUrl) => data(apiClient.post(`${path(id)}/images`, {
    page_no: pageNo, image_data_url: imageDataUrl,
  })),
  ocr: (id) => data(apiClient.post(`${path(id)}/ocr`, {}, { timeout: 70000 })),
  signature: (id, role, imageDataUrl, name) => data(apiClient.post(`${path(id)}/signatures`, {
    role, image_data_url: imageDataUrl, ...(name ? { name } : {}),
  })),
  confirm: (id, unmatchedOk = false) => data(apiClient.post(`${path(id)}/confirm`, { unmatched_ok: unmatchedOk })),
  void: (id, reason) => data(apiClient.post(`${path(id)}/void`, { reason })),
  image: async (id, imageId) => (await apiClient.get(`${path(id)}/images/${encodeURIComponent(imageId)}`, {
    responseType: 'blob',
  })).data,
};
