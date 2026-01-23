import apiClient from './client';

export const reportsAPI = {
  getSalesReport: async ({ start, end, branchId, search, limit }) => {
    const params = new URLSearchParams();
    if (start) params.append('start', start);
    if (end) params.append('end', end);
    if (branchId) params.append('branch_id', branchId);
    if (search) params.append('search', search);
    if (limit) params.append('limit', String(limit));
    const response = await apiClient.get(`/reports/sales?${params.toString()}`);
    return response.data;
  }
};
