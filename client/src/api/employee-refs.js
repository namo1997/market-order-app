import apiClient from './client';

const unwrap = (response) => response?.data;

export const employeeRefsAPI = {
  getAll: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.isActive != null) params.append('is_active', filters.isActive ? '1' : '0');
    if (filters.isHead != null) params.append('is_head', filters.isHead ? '1' : '0');
    if (filters.role) params.append('role', filters.role);
    if (filters.branchName) params.append('branch_name', filters.branchName);
    if (filters.departmentName) params.append('department_name', filters.departmentName);
    if (filters.search) params.append('search', filters.search);
    if (filters.limit) params.append('limit', filters.limit);
    const query = params.toString();
    const response = await apiClient.get(`/employee-refs${query ? `?${query}` : ''}`);
    return unwrap(response);
  },

  sync: async () => {
    const response = await apiClient.post('/employee-refs/sync');
    return unwrap(response);
  },

  stats: async () => {
    const response = await apiClient.get('/employee-refs/stats');
    return unwrap(response);
  }
};
