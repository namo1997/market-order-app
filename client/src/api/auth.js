import apiClient from './client';

export const authAPI = {
  // ดึงรายการสาขา
  getBranches: async () => (await apiClient.get('/auth/branches')).data,

  login: async (departmentId) => {
    try {
      console.log('🌐 Calling API with departmentId:', departmentId);
      const response = await apiClient.post('/auth/login', { departmentId });
      console.log('🌐 API Response:', response);
      console.log('🌐 API Response.data:', response.data);
      return response.data;
    } catch (error) {
      console.error('🌐 API Error:', error);
      console.error('🌐 Error response:', error.response);
      return error.response?.data || { success: false, message: 'Connection failed' };
    }
  },

  getCurrentUser: async () => {
    const response = await apiClient.get('/auth/me');
    return response.data;
  },

  loginSuperAdmin: async (pin) => {
    try {
      const response = await apiClient.post('/auth/super-admin', { pin });
      return response.data;
    } catch (error) {
      return error.response?.data || { success: false, message: 'Connection failed' };
    }
  },

  // Helpers for Login Step Flow
  getDepartments: async (branchId) => (await apiClient.get(`/auth/departments/${branchId}`)).data,
};
