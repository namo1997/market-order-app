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
  // คืน { data, total } — total = จำนวนที่ตรงเงื่อนไขทั้งหมด (ไม่ติด limit)
  listWithMeta: async (params = {}) => {
    const searchParams = new URLSearchParams();
    if (params.search) searchParams.append('search', params.search);
    if (params.limit) searchParams.append('limit', String(params.limit));
    const response = await apiClient.get(`/product-unit-settings?${searchParams.toString()}`);
    const data = unwrapData(response);
    const list = Array.isArray(data) ? data : [];
    const total = Number(response?.data?.total);
    return { data: list, total: Number.isFinite(total) ? total : list.length };
  },
  save: async (productId, payload) => {
    const response = await apiClient.put(`/product-unit-settings/${productId}`, payload);
    return response.data?.data ?? response.data;
  },
  // ส่ง force_unit_change เมื่อผู้ดูแลยืนยันเปลี่ยนหน่วยฐานของสินค้าที่มีข้อมูลอ้างอิง
  saveForce: async (productId, payload) => {
    const response = await apiClient.put(`/product-unit-settings/${productId}`, {
      ...payload,
      force_unit_change: true
    });
    return response.data?.data ?? response.data;
  }
};
