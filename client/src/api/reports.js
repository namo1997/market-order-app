import apiClient from './client';

const buildSalesReportParams = ({ start, end, branchId, search, limit }) => {
  const params = new URLSearchParams();
  if (start) params.append('start', start);
  if (end) params.append('end', end);
  if (branchId) params.append('branch_id', branchId);
  if (search) params.append('search', search);
  if (limit) params.append('limit', String(limit));
  return params.toString();
};

export const reportsAPI = {
  getSalesReport: async (filters) => {
    const response = await apiClient.get(`/reports/sales?${buildSalesReportParams(filters)}`);
    return response.data;
  },
  getPublicSalesReport: async (filters) => {
    const response = await apiClient.get(`/public/reports/sales?${buildSalesReportParams(filters)}`);
    return response.data;
  },
  getPublicBranches: async () => {
    const response = await apiClient.get('/public/branches');
    return response.data?.data || [];
  }
};
