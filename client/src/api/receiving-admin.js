import apiClient from './client';
const base = '/receiving-admin';
const data = async request => (await request).data.data;
const supplier = key => `${base}/suppliers/${encodeURIComponent(key)}`;
export const receivingAdminAPI = {
  list: (params, signal) => data(apiClient.get(base, { params, signal })),
  options: signal => data(apiClient.get(`${base}/options`, { signal })),
  issuesSummary: signal => data(apiClient.get(`${base}/issues-summary`, { signal })),
  get: (id, signal) => data(apiClient.get(`${base}/${encodeURIComponent(id)}`, { signal })),
  // Supplier registry and confirmed aliases (accounting/admin only; server enforces).
  suppliers: (params, signal) => data(apiClient.get(`${base}/suppliers`, { params, signal })),
  supplier: (key, signal) => data(apiClient.get(supplier(key), { signal })),
  supplierProducts: (key, q, signal) => data(apiClient.get(`${supplier(key)}/product-search`, { params: q ? { q } : {}, signal })),
  supplierProductOptions: key => data(apiClient.get(`${supplier(key)}/product-options`)),
  previewSupplierProducts: (key, body) => data(apiClient.post(`${supplier(key)}/products/preview`, body)),
  createSupplierProducts: (key, body) => data(apiClient.post(`${supplier(key)}/products`, body)),
  saveSupplierProfile: (key, body) => data(apiClient.put(`${supplier(key)}/profile`, body)),
  createAlias: (key, body) => data(apiClient.post(`${supplier(key)}/aliases`, body)),
  updateAlias: (key, id, body) => data(apiClient.put(`${supplier(key)}/aliases/${encodeURIComponent(id)}`, body)),
  customerNames: key => data(apiClient.get(`${supplier(key)}/customer-names`)),
  createCustomerName: (key, body) => data(apiClient.post(`${supplier(key)}/customer-names`, body)),
  setCustomerNameActive: (key, id, active) => data(apiClient.post(`${supplier(key)}/customer-names/${encodeURIComponent(id)}/${active ? 'enable' : 'disable'}`)),
  billRefPattern: key => data(apiClient.get(`${supplier(key)}/bill-ref-pattern`)),
  saveBillRefPattern: (key, refPattern) => data(apiClient.put(`${supplier(key)}/bill-ref-pattern`, { ref_pattern: refPattern })),
  setAliasActive: (key, id, active) => data(apiClient.post(`${supplier(key)}/aliases/${encodeURIComponent(id)}/${active ? 'enable' : 'disable'}`)),
};
