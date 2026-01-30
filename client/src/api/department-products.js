import apiClient from './client';

const unwrapData = (response, fallback = []) => {
  if (response?.data?.data !== undefined) return response.data.data;
  return fallback;
};

export const departmentProductsAPI = {
  getMyDepartmentProducts: async () => {
    const response = await apiClient.get('/department-products/my');
    return unwrapData(response);
  },
  getDepartmentProducts: async (departmentId) => {
    const response = await apiClient.get(`/department-products/admin/${departmentId}`);
    return unwrapData(response);
  },
  getAvailableProducts: async (departmentId) => {
    const response = await apiClient.get(`/department-products/admin/available/${departmentId}`);
    return unwrapData(response);
  },
  addDepartmentProduct: async (departmentId, productId) => {
    const response = await apiClient.post('/department-products/admin', {
      department_id: departmentId,
      product_id: productId
    });
    return response.data;
  },
  copyFromStockTemplate: async (departmentId) => {
    const response = await apiClient.post(
      '/department-products/admin/copy-from-stock-template',
      { department_id: departmentId }
    );
    return response.data;
  },
  deleteDepartmentProduct: async (id) => {
    const response = await apiClient.delete(`/department-products/admin/${id}`);
    return response.data;
  }
};
