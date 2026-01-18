import apiClient from './client';

export const productsAPI = {
  // ดึงรายการสินค้า
  getProducts: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.supplierId) params.append('supplierId', filters.supplierId);
    if (filters.search) params.append('search', filters.search);

    const response = await apiClient.get(`/products?${params.toString()}`);
    return response.data;
  },

  // ดึงข้อมูลสินค้า
  getProductById: async (id) => {
    const response = await apiClient.get(`/products/${id}`);
    return response.data;
  },

  // ดึงรายการ suppliers
  getSuppliers: async () => {
    const response = await apiClient.get('/products/meta/suppliers');
    return response.data;
  },

  // ดึงรายการ units
  getUnits: async () => {
    const response = await apiClient.get('/products/meta/units');
    return response.data;
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
