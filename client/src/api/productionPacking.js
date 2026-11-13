import apiClient from './client';

// จัดของตามใบสั่ง (ครัวกลาง → สาขา)
const withDate = (date) => `date=${encodeURIComponent(date)}`;

export const productionPackingAPI = {
  getOverview: async (date) => (await apiClient.get(`/production/packing?${withDate(date)}`)).data,
  getBranch: async (date, branchId) => (await apiClient.get(`/production/packing/branches/${branchId}?${withDate(date)}`)).data,
  scan: async (date, branchId, code) => (await apiClient.post(`/production/packing/branches/${branchId}/scan?${withDate(date)}`, { code })).data,
  adjust: async (date, branchId, productId, delta) => (
    await apiClient.post(`/production/packing/branches/${branchId}/adjust?${withDate(date)}`, { product_id: productId, delta })
  ).data,
  removeEntry: async (date, branchId, entryId) => (
    await apiClient.delete(`/production/packing/branches/${branchId}/entries/${entryId}?${withDate(date)}`)
  ).data,
  setPacked: async (date, branchId, packed) => (
    await apiClient.put(`/production/packing/branches/${branchId}/packed?${withDate(date)}`, { packed })
  ).data
};
