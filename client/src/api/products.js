import apiClient from './client';

const unwrapData = (response, fallback = []) => {
  if (response?.data?.data !== undefined) return response.data.data;
  if (response?.data !== undefined) return response.data;
  return fallback;
};

export const productsAPI = {
  // ดึงรายการสินค้า
  getProducts: async (filters = {}) => {
    const params = new URLSearchParams();
    const productGroupId = filters.productGroupId ?? filters.supplierId;
    if (productGroupId) {
      params.append('productGroupId', productGroupId);
    }
    if (filters.supplierMasterId) {
      params.append('supplier_master_id', filters.supplierMasterId);
    }
    if (filters.bypassScope) {
      params.append('bypass_scope', 'true');
    }
    if (filters.search) params.append('search', filters.search);
    if (filters.internalOutput) params.append('internal_output', 'true');
    if (filters.transformOutput) params.append('transform_output', 'true');

    const response = await apiClient.get(`/products?${params.toString()}`);
    return response.data;
  },

  // ดึงข้อมูลสินค้า
  getProductById: async (id) => {
    const response = await apiClient.get(`/products/${id}`);
    return response.data;
  },

  // ดึงรายการกลุ่มสินค้า
  getProductGroups: async () => {
    const response = await apiClient.get('/products/meta/product-groups');
    return unwrapData(response);
  },

  // Deprecated alias: keep for old code paths only
  getSuppliers: async () => {
    return productsAPI.getProductGroups();
  },

  // ดึงรายการซัพพลายเออร์
  getSupplierMasters: async () => {
    const response = await apiClient.get('/products/meta/supplier-masters');
    return unwrapData(response);
  },

  // ดึงรายการ units
  getUnits: async () => {
    const response = await apiClient.get('/products/meta/units');
    return unwrapData(response);
  },

  // Admin CRUD
  createProduct: async (data) => {
    const response = await apiClient.post('/products', data);
    return response.data;
  },

  updateProduct: async (id, data) => {
    const response = await apiClient.put(`/products/${id}`, data);
    return response.data;
  },

  deleteProduct: async (id) => {
    const response = await apiClient.delete(`/products/${id}`);
    return response.data;
  }
};
